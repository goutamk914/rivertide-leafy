/**
 * Structured logging: JSON lines to `<logs>/rivertide.log` (rotated at 5 MB, one old file kept as
 * rivertide.1.log), plus readable lines on stderr in development. Values under keys that look like
 * credentials are redacted, and API-key-shaped strings are masked everywhere, so a stray
 * `logger.info('x', { apiKey })` can never leak a secret into a file.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from './services';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };
export const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 6;
const MAX_STRING = 4000;
const REDACTED = '[redacted]';
const SENSITIVE_KEY = /key|token|secret|password|authorization/i;
/** Common API key shapes (Anthropic, OpenAI, Groq, OpenRouter, bearer headers). */
const SECRET_VALUE = /\b(?:sk-ant-[\w-]{8,}|sk-or-[\w-]{8,}|sk-[\w-]{16,}|gsk_[\w]{16,}|Bearer\s+[\w.-]{12,})/g;

export interface LoggerOptions {
  /** Absolute path of the log file, or null for stderr only. */
  readonly file: string | null;
  readonly isDev: boolean;
  readonly maxBytes?: number;
  /** Minimum level written to the file (default: debug in dev, info otherwise). */
  readonly level?: LogLevel;
  readonly stderr?: (line: string) => void;
  readonly now?: () => Date;
}

export function maskSecrets(text: string): string {
  return text.replace(SECRET_VALUE, REDACTED);
}

/** Deep copy of `value` with sensitive keys redacted, errors flattened and cycles cut. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return maskSecrets(value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: maskSecrets(value.message), stack: value.stack ? maskSecrets(value.stack) : undefined };
  }
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner, depth + 1, seen);
  }
  return out;
}

interface LogSink {
  write(level: LogLevel, scope: string, message: string, meta: Record<string, unknown> | undefined): void;
}

function createFileWriter(file: string, maxBytes: number, onError: (error: unknown) => void) {
  let size = 0;
  let failed = false;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    size = statSync(file).size;
  } catch {
    size = 0; // A missing file simply starts at zero bytes.
  }
  return (line: string): void => {
    if (failed) return;
    try {
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) {
        renameSync(file, file.replace(/\.log$/, '') + '.1.log');
        size = 0;
      }
      appendFileSync(file, line, { mode: 0o600 });
      size += bytes;
    } catch (error) {
      failed = true; // Never let logging crash the app; report once on stderr.
      onError(error);
    }
  };
}

function prettyLine(time: Date, level: LogLevel, scope: string, message: string, meta: unknown): string {
  const stamp = time.toISOString().slice(11, 23);
  const tag = level.toUpperCase().padEnd(5);
  const extra = meta && Object.keys(meta as object).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${stamp} ${tag} [${scope || 'app'}] ${maskSecrets(message)}${extra}\n`;
}

function createSink(options: LoggerOptions): LogSink {
  const now = options.now ?? (() => new Date());
  const stderr = options.stderr ?? ((line: string) => process.stderr.write(line));
  const minFileRank = LEVEL_RANK[options.level ?? (options.isDev ? 'debug' : 'info')];
  const writeFile = options.file
    ? createFileWriter(options.file, options.maxBytes ?? DEFAULT_MAX_LOG_BYTES, (error) =>
        stderr(`logger: cannot write ${options.file}: ${String(error)}\n`))
    : null;
  return {
    write(level, scope, message, meta) {
      const time = now();
      const safeMeta = meta ? (redact(meta) as Record<string, unknown>) : undefined;
      if (writeFile && LEVEL_RANK[level] >= minFileRank) {
        const record = { ...safeMeta, t: time.toISOString(), level, scope, msg: maskSecrets(message) };
        writeFile(`${JSON.stringify(record)}\n`);
      }
      if (options.isDev || !writeFile || LEVEL_RANK[level] >= LEVEL_RANK.error) {
        stderr(prettyLine(time, level, scope, message, safeMeta));
      }
    },
  };
}

function scopedLogger(sink: LogSink, scope: string): Logger {
  return {
    debug: (message, meta) => sink.write('debug', scope, message, meta),
    info: (message, meta) => sink.write('info', scope, message, meta),
    warn: (message, meta) => sink.write('warn', scope, message, meta),
    error: (message, meta) => sink.write('error', scope, message, meta),
    child: (child) => scopedLogger(sink, scope ? `${scope}:${child}` : child),
  };
}

export function createLogger(options: LoggerOptions): Logger {
  return scopedLogger(createSink(options), '');
}
