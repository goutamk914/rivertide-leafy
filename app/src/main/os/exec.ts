/**
 * The only way Rivertide runs other programs: `execFile` with an argument array, a timeout and a
 * bounded output buffer. Never a shell, never string commands. Results are typed, never thrown.
 */
import { execFile, type ChildProcess } from 'node:child_process';

export const DEFAULT_EXEC_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

export interface ExecOptions {
  readonly timeoutMs?: number;
  readonly maxBuffer?: number;
  /** Written to the child's stdin, which is then closed. */
  readonly input?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  /** Aborting kills the child (result `error: 'aborted'`). */
  readonly signal?: AbortSignal;
}

export interface ExecResult {
  readonly ok: boolean;
  /** Exit code; null when the process was killed or never started. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  /** Short reason when not ok (ENOENT, timeout, exit code …). */
  readonly error: string | null;
}

export type ExecFn = (file: string, args: readonly string[], options?: ExecOptions) => Promise<ExecResult>;

interface ExecFailure {
  readonly code?: number | string;
  readonly killed?: boolean;
  readonly signal?: string | null;
  readonly name?: string;
  readonly message?: string;
}

function describeFailure(failure: ExecFailure, timedOut: boolean): string {
  if (timedOut) return 'timed out';
  if (failure.name === 'AbortError') return 'aborted';
  if (failure.code === 'ENOENT') return 'program not found';
  if (failure.code === 'EACCES') return 'program not executable';
  if (typeof failure.code === 'number') return `exited with code ${failure.code}`;
  if (failure.signal) return `killed by ${failure.signal}`;
  return (failure.message ?? 'failed').slice(0, 200);
}

export const runFile: ExecFn = (file, args, options = {}) =>
  new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    let child: ChildProcess;
    try {
      child = execFile(
        file,
        [...args],
        {
          timeout: timeoutMs,
          maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
          killSignal: 'SIGKILL',
          windowsHide: true,
          encoding: 'utf8',
          env: options.env,
          cwd: options.cwd,
          signal: options.signal,
          shell: false,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ ok: true, code: 0, stdout, stderr, timedOut: false, error: null });
            return;
          }
          const failure = error as ExecFailure;
          const timedOut = failure.name !== 'AbortError' && failure.killed === true && failure.signal === 'SIGKILL';
          resolve({
            ok: false,
            code: typeof failure.code === 'number' ? failure.code : null,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            timedOut,
            error: describeFailure(failure, timedOut),
          });
        },
      );
    } catch (error) {
      resolve({ ok: false, code: null, stdout: '', stderr: '', timedOut: false, error: describeFailure(error as ExecFailure, false) });
      return;
    }
    if (options.input !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined); // child may exit before reading; the result reports it
      child.stdin.end(options.input);
    }
  });

/** AppleScript string literal: escapes backslashes and quotes (for values we must embed). */
export const appleScriptString = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Runs `osascript -e <script>` (macOS). The script is a single argv entry, never a shell string. */
export const runAppleScript = (exec: ExecFn, script: string, timeoutMs = DEFAULT_EXEC_TIMEOUT_MS): Promise<ExecResult> =>
  exec('osascript', ['-e', script], { timeoutMs });
