/**
 * On-device transcription with whisper.cpp's `whisper-cli`. The binary and model must already be
 * on disk (never downloaded automatically). The WAV goes to a private temp file that is always
 * deleted afterwards.
 */
import { accessSync, constants as fsConstants } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ExecFn } from '../../os/exec';
import { SttError } from './errors';
import { parseWhisperCliOutput, type ParsedTranscription } from './guard';

export const LOCAL_STT_TIMEOUT_MS = 120_000;
export const WHISPER_CLI_CANDIDATES: readonly string[] = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'];

export function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false; // missing or not executable: the caller tries the next candidate
  }
}

export function isReadable(path: string): boolean {
  try {
    accessSync(path, fsConstants.R_OK);
    return true;
  } catch {
    return false; // missing model file: reported as not configured
  }
}

/** The configured binary if it is executable, else the first common install location that is. */
export function findWhisperCli(configured: string, check: (path: string) => boolean = isExecutable): string | null {
  const candidates = configured.trim() ? [configured.trim(), ...WHISPER_CLI_CANDIDATES] : WHISPER_CLI_CANDIDATES;
  return candidates.find((candidate) => check(candidate)) ?? null;
}

export interface LocalSttInput {
  readonly binary: string;
  readonly model: string;
  readonly language: string;
  readonly prompt?: string;
  readonly signal?: AbortSignal;
}

export function whisperArgs(input: Omit<LocalSttInput, 'binary' | 'signal'>, wavPath: string): string[] {
  const args = ['-m', input.model, '-f', wavPath, '-nt', '-np', '-l', input.language || 'auto'];
  return input.prompt ? [...args, '--prompt', input.prompt] : args;
}

export async function transcribeLocal(exec: ExecFn, input: LocalSttInput, wav: Uint8Array): Promise<ParsedTranscription> {
  const wavPath = join(tmpdir(), `rivertide-${randomBytes(6).toString('hex')}.wav`);
  try {
    await writeFile(wavPath, wav, { mode: 0o600 });
    const result = await exec(input.binary, whisperArgs(input, wavPath), { timeoutMs: LOCAL_STT_TIMEOUT_MS, signal: input.signal });
    if (result.error === 'aborted') throw new SttError('cancelled', 'local');
    if (result.timedOut) throw new SttError('timeout', 'local');
    if (result.error === 'program not found' || result.error === 'program not executable') throw new SttError('local-missing', 'local');
    if (!result.ok) throw new SttError('local-failed', 'local', { cause: new Error(`${result.error}: ${result.stderr.slice(0, 300)}`) });
    return parseWhisperCliOutput(result.stdout, null);
  } finally {
    await rm(wavPath, { force: true });
  }
}
