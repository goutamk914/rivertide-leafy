/**
 * Node client for the native macOS helper (`app/native/rivertide-helper`).
 *
 * Speaks the newline-delimited JSON protocol of docs/ARCHITECTURE.md §3.7 over the child's stdio,
 * restarts the helper with exponential backoff whenever it exits, and never throws when the binary
 * is missing (it emits 'unavailable' instead). No Electron imports: main wires it up.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ── Protocol types ─────────────────────────────────────────────────────────────────────────────

export type HelperCommand = 'ping' | 'frontmostApp' | 'paste' | 'typeText' | 'focusedText' | 'mediaKey' | 'checkAccess';
export const MEDIA_KEYS = ['playpause', 'next', 'previous', 'mute', 'volumeUp', 'volumeDown'] as const;
export type MediaKey = (typeof MEDIA_KEYS)[number];
/** Error message the helper uses when an action needs Accessibility permission. */
export const ACCESSIBILITY_MISSING = 'accessibility-missing';

export type HelperLogLevel = 'info' | 'warn' | 'error';
export type KeyModifiers = Readonly<{ ctrl: boolean; shift: boolean; alt: boolean; cmd: boolean }>;
export type HelperReady = Readonly<{ version: number; accessibility: boolean }>;
/** `t` is milliseconds since boot, taken in the helper when it saw the transition. */
export type HelperKeyEvent = Readonly<{ key: 'fn'; down: boolean; mods: KeyModifiers; t: number }>;
export type HelperLog = Readonly<{ level: HelperLogLevel; message: string }>;
export type HelperUnavailable = Readonly<{ reason: string; code?: string }>;
/** `restartInMs` is null when no automatic restart is scheduled. */
export type HelperExit = Readonly<{ code: number | null; signal: NodeJS.Signals | null; restartInMs: number | null }>;

/** Every line the helper can print, as a discriminated union on `type`. */
export type HelperMessage =
  | (Readonly<{ type: 'ready' }> & HelperReady)
  | (Readonly<{ type: 'key' }> & HelperKeyEvent)
  | (Readonly<{ type: 'log' }> & HelperLog)
  | Readonly<{ type: 'result'; id: string; ok: true; data: unknown }>
  | Readonly<{ type: 'error'; id?: string; message: string }>;

export type Pong = Readonly<{ pong: true }>;
export type FrontmostApp = Readonly<{ name: string; bundleId: string; pid: number }>;
export type FocusedText = Readonly<{ role: string; value: string; selectedText: string }>;
export type AccessStatus = Readonly<{ accessibility: boolean }>;

export type HelperEvents = {
  ready: [HelperReady];
  key: [HelperKeyEvent];
  log: [HelperLog];
  unavailable: [HelperUnavailable];
  exit: [HelperExit];
};

// ── Options ────────────────────────────────────────────────────────────────────────────────────

/** `{ info, warn, error }`, each `(message: string, meta?: unknown) => void`. */
export type HelperLogger = Readonly<Record<HelperLogLevel, (message: string, meta?: unknown) => void>>;

/** Restart delay starts at `initialMs`, doubles per crash up to `maxMs`, resets after `healthyResetMs` uptime. */
export type BackoffOptions = Readonly<{ initialMs: number; maxMs: number; healthyResetMs: number }>;

export type NativeHelperOptions = Readonly<{
  binaryPath: string;
  logger: HelperLogger;
  spawnImpl?: typeof spawn;
  backoff?: Partial<BackoffOptions>;
}>;

export const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
export const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 1000, maxMs: 30_000, healthyResetMs: 60_000 };

const MAX_LINE_CHARS = 1_000_000; // a helper that never prints a newline must not exhaust memory
const LOG_PREVIEW_CHARS = 200;
const TYPE_TEXT_CHUNK_UNITS = 20; // mirrors the helper's keystroke chunk size
const TYPE_TEXT_MS_PER_CHUNK = 15; // generous per-chunk budget (the helper sleeps ~4 ms per chunk)

// ── Parsing (pure) ─────────────────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const toLogLevel = (value: unknown): HelperLogLevel => (value === 'warn' || value === 'error' ? value : 'info');

function parseMods(value: unknown): KeyModifiers | null {
  if (!isRecord(value)) return null;
  const { ctrl, shift, alt, cmd } = value;
  return isBoolean(ctrl) && isBoolean(shift) && isBoolean(alt) && isBoolean(cmd) ? { ctrl, shift, alt, cmd } : null;
}

/** Parses one helper output line; returns null for anything that is not a valid protocol message. */
export function parseHelperMessage(line: string): HelperMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null; // not JSON: the caller logs the offending line
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'ready':
      return isNumber(value.version) && isBoolean(value.accessibility)
        ? { type: 'ready', version: value.version, accessibility: value.accessibility }
        : null;
    case 'key': {
      const mods = parseMods(value.mods);
      return value.key === 'fn' && isBoolean(value.down) && mods && isNumber(value.t)
        ? { type: 'key', key: 'fn', down: value.down, mods, t: value.t }
        : null;
    }
    case 'log':
      return isString(value.message) ? { type: 'log', level: toLogLevel(value.level), message: value.message } : null;
    case 'result':
      return isString(value.id) && value.ok === true ? { type: 'result', id: value.id, ok: true, data: value.data } : null;
    case 'error':
      if (!isString(value.message)) return null;
      return { type: 'error', message: value.message, ...(isString(value.id) ? { id: value.id } : {}) };
    default:
      return null;
  }
}

/** Splits a text stream into lines, carrying a partial line over to the next chunk. */
export function createLineSplitter(
  onLine: (line: string) => void,
  onOverflow: (droppedChars: number) => void,
  maxLineChars = MAX_LINE_CHARS,
): (chunk: string) => void {
  let carry = '';
  return (chunk) => {
    const parts = (carry + chunk).split('\n');
    const tail = parts.pop() ?? '';
    carry = tail.length > maxLineChars ? '' : tail;
    if (tail.length > maxLineChars) onOverflow(tail.length);
    parts.forEach((line) => onLine(line));
  };
}

const isPong = (value: unknown): value is Pong => isRecord(value) && value.pong === true;
const isFrontmostApp = (value: unknown): value is FrontmostApp =>
  isRecord(value) && isString(value.name) && isString(value.bundleId) && isNumber(value.pid);
const isFocusedText = (value: unknown): value is FocusedText =>
  isRecord(value) && isString(value.role) && isString(value.value) && isString(value.selectedText);
const isAccessStatus = (value: unknown): value is AccessStatus => isRecord(value) && isBoolean(value.accessibility);

const errorCode = (error: unknown): string | undefined => (isRecord(error) && isString(error.code) ? error.code : undefined);
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ── Client ─────────────────────────────────────────────────────────────────────────────────────

interface PendingRequest {
  readonly cmd: HelperCommand;
  readonly timer: NodeJS.Timeout;
  readonly resolve: (data: unknown) => void;
  readonly reject: (error: Error) => void;
}

export class NativeHelper extends EventEmitter<HelperEvents> {
  private readonly binaryPath: string;
  private readonly logger: HelperLogger;
  private readonly spawnImpl: typeof spawn;
  private readonly backoff: BackoffOptions;
  private readonly pending = new Map<string, PendingRequest>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private isStopped = true;
  private nextId = 0;
  private nextBackoffMs: number;
  private startedAt = 0;

  constructor(options: NativeHelperOptions) {
    super();
    this.binaryPath = options.binaryPath;
    this.logger = options.logger;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.nextBackoffMs = this.backoff.initialMs;
  }

  get isRunning(): boolean {
    return this.child !== null;
  }

  /** Spawns the helper (no-op if it is already running or a restart is scheduled). */
  start(): void {
    if (this.isStopped) this.nextBackoffMs = this.backoff.initialMs;
    this.isStopped = false;
    if (this.child || this.restartTimer) return;
    this.spawnChild();
  }

  /** Stops the helper for good: no restart, pending requests are rejected. */
  stop(): void {
    this.isStopped = true;
    clearTimeout(this.restartTimer ?? undefined);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    this.rejectAllPending('native helper stopped');
    if (!child) return;
    child.stdin.end(); // the helper exits cleanly on stdin EOF…
    child.kill(); // …and SIGTERM covers a helper stuck in a command
  }

  /** Sends one command and resolves with its `data` (unvalidated: prefer the typed methods below). */
  async request<T>(
    cmd: HelperCommand,
    args: Readonly<Record<string, unknown>> = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const child = this.child;
    if (!child || !child.stdin.writable) throw new Error(`native helper is not running (cannot send "${cmd}")`);
    this.nextId += 1;
    const id = String(this.nextId);
    // args are spread first so they can never override the protocol's own id/cmd fields.
    const line = `${JSON.stringify({ ...args, id, cmd })}\n`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => this.rejectPending(id, new Error(`native helper "${cmd}" (id ${id}) timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.pending.set(id, { cmd, timer, resolve: (data) => resolve(data as T), reject });
      child.stdin.write(line, (error) => {
        if (error) this.rejectPending(id, new Error(`could not send "${cmd}" to native helper: ${error.message}`));
      });
    });
  }

  ping(): Promise<Pong> {
    return this.requestChecked('ping', isPong);
  }

  frontmostApp(): Promise<FrontmostApp> {
    return this.requestChecked('frontmostApp', isFrontmostApp);
  }

  /** Optionally activates `bundleId` first, then posts ⌘V. */
  async paste(bundleId?: string): Promise<void> {
    await this.request('paste', bundleId ? { bundleId } : {});
  }

  /** Types text as unicode keystrokes (paste fallback); the timeout grows with the text length. */
  async typeText(text: string): Promise<void> {
    const chunks = Math.ceil(text.length / TYPE_TEXT_CHUNK_UNITS);
    await this.request('typeText', { text }, DEFAULT_REQUEST_TIMEOUT_MS + chunks * TYPE_TEXT_MS_PER_CHUNK);
  }

  focusedText(): Promise<FocusedText> {
    return this.requestChecked('focusedText', isFocusedText);
  }

  async mediaKey(key: MediaKey): Promise<void> {
    if (!MEDIA_KEYS.includes(key)) throw new Error(`unknown media key: ${String(key)}`);
    await this.request('mediaKey', { key });
  }

  checkAccess(): Promise<AccessStatus> {
    return this.requestChecked('checkAccess', isAccessStatus);
  }

  private async requestChecked<T>(cmd: HelperCommand, isValid: (value: unknown) => value is T): Promise<T> {
    const data = await this.request<unknown>(cmd);
    if (!isValid(data)) throw new Error(`native helper sent an unexpected payload for "${cmd}"`);
    return data;
  }

  private spawnChild(): void {
    this.restartTimer = null;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnImpl(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      this.markUnavailable(error);
      return;
    }
    this.child = child;
    this.startedAt = Date.now();
    const splitLines = createLineSplitter(
      (line) => this.handleLine(line),
      (dropped) => this.logger.warn('native helper line too long; dropped', { dropped }),
    );
    child.stdout.setEncoding('utf8'); // decodes multi-byte characters split across chunks
    child.stdout.on('data', (chunk: string) => splitLines(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.logger.warn('native helper stderr', chunk.trim()));
    child.stdin.on('error', (error) => this.logger.warn('native helper stdin error', error));
    child.on('error', (error) => this.onChildError(child, error));
    child.on('exit', (code, signal) => this.onChildExit(child, code, signal));
  }

  private onChildError(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (child.pid !== undefined) {
      this.logger.error('native helper process error', error);
      return;
    }
    // No pid: the spawn itself failed (ENOENT, EACCES…). Restarting would fail the same way.
    if (this.child === child) this.child = null;
    this.markUnavailable(error);
  }

  private onChildExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    if (child.pid === undefined) return; // spawn failure: already reported by onChildError
    const isCurrent = this.child === child;
    if (isCurrent) {
      this.child = null;
      this.rejectAllPending(`native helper exited (code ${code}, signal ${signal})`);
    }
    const restartInMs = isCurrent && !this.isStopped ? this.scheduleRestart() : null;
    const meta = { code, signal, restartInMs };
    this.logger[restartInMs === null ? 'info' : 'warn']('native helper exited', meta);
    this.safeEmit('exit', meta);
  }

  /** Schedules a respawn and returns its delay: 1 s, 2 s, 4 s… capped, reset after healthy uptime. */
  private scheduleRestart(): number {
    const uptimeMs = Date.now() - this.startedAt;
    const delayMs = uptimeMs >= this.backoff.healthyResetMs ? this.backoff.initialMs : this.nextBackoffMs;
    this.nextBackoffMs = Math.min(delayMs * 2, this.backoff.maxMs);
    this.restartTimer = setTimeout(() => this.spawnChild(), delayMs);
    return delayMs;
  }

  private markUnavailable(error: unknown): void {
    const reason = errorMessage(error);
    this.logger.error('native helper unavailable', { binaryPath: this.binaryPath, reason });
    this.rejectAllPending(`native helper unavailable: ${reason}`);
    this.safeEmit('unavailable', { reason, code: errorCode(error) });
  }

  private handleLine(rawLine: string): void {
    const line = rawLine.trim();
    if (line === '') return;
    const message = parseHelperMessage(line);
    if (!message) {
      this.logger.warn('ignoring unparseable native helper output', { line: line.slice(0, LOG_PREVIEW_CHARS) });
      return;
    }
    this.dispatch(message);
  }

  private dispatch(message: HelperMessage): void {
    switch (message.type) {
      case 'ready':
        this.logger.info('native helper ready', { version: message.version, accessibility: message.accessibility });
        this.safeEmit('ready', { version: message.version, accessibility: message.accessibility });
        return;
      case 'key':
        this.safeEmit('key', { key: message.key, down: message.down, mods: message.mods, t: message.t });
        return;
      case 'log':
        this.logger[message.level](`native helper: ${message.message}`);
        this.safeEmit('log', { level: message.level, message: message.message });
        return;
      case 'result':
        this.resolvePending(message.id, message.data);
        return;
      case 'error':
        if (message.id !== undefined && this.pending.has(message.id)) {
          this.rejectPending(message.id, new Error(message.message));
          return;
        }
        this.logger.warn('native helper reported an error', { id: message.id, message: message.message });
        return;
    }
  }

  private resolvePending(id: string, data: unknown): void {
    const request = this.takePending(id);
    if (request) request.resolve(data);
    else this.logger.warn('native helper replied to an unknown or expired request', { id });
  }

  private rejectPending(id: string, error: Error): void {
    this.takePending(id)?.reject(error);
  }

  private rejectAllPending(reason: string): void {
    [...this.pending.entries()].forEach(([id, { cmd }]) =>
      this.rejectPending(id, new Error(`${reason} while waiting for "${cmd}"`)),
    );
  }

  /** Removes a pending request (so it settles exactly once) and clears its timeout. */
  private takePending(id: string): PendingRequest | undefined {
    const request = this.pending.get(id);
    if (!request) return undefined;
    this.pending.delete(id);
    clearTimeout(request.timer);
    return request;
  }

  /** Emits without letting a throwing listener break stdout parsing or the restart logic. */
  private safeEmit<K extends keyof HelperEvents>(event: K, ...args: HelperEvents[K]): void {
    try {
      // Cast: TS cannot resolve EventEmitter's conditional Args<K> for a generic K.
      (this.emit as (name: K, ...rest: HelperEvents[K]) => boolean)(event, ...args);
    } catch (error) {
      this.logger.error(`native helper "${event}" listener threw`, error);
    }
  }
}
