/** Friendly, typed speech-to-text errors. */
import type { SttProviderId } from '../../../shared/settings';

export type SttErrorCode =
  | 'not-configured'
  | 'auth'
  | 'rate-limit'
  | 'connection'
  | 'timeout'
  | 'cancelled'
  | 'bad-request'
  | 'server'
  | 'invalid-output'
  | 'local-missing'
  | 'local-failed';

const NAMES: Readonly<Record<SttProviderId, string>> = {
  groq: 'Groq', openai: 'OpenAI', custom: 'your speech server', local: 'whisper.cpp',
};

const MESSAGES: Readonly<Record<SttErrorCode, (name: string) => string>> = {
  'not-configured': () => 'Add a speech key in Settings → AI to start dictating.',
  auth: (name) => `Your ${name} speech key was rejected — check it in Settings → AI.`,
  'rate-limit': (name) => `${name} is busy right now. Wait a moment and try again.`,
  connection: (name) => `Couldn’t reach ${name} to transcribe. Check your internet connection and try again.`,
  timeout: () => 'Transcribing took too long. Try again in a moment.',
  cancelled: () => 'Stopped.',
  'bad-request': (name) => `${name} couldn’t transcribe that recording. Check the speech model in Settings → AI.`,
  server: (name) => `${name} had a problem on its side. Try again in a moment.`,
  'invalid-output': (name) => `${name} sent back something Rivertide couldn’t read. Try again.`,
  'local-missing': () => 'Rivertide couldn’t find whisper-cli or its model file. Check Settings → AI.',
  'local-failed': () => 'The on-device transcriber stopped unexpectedly. Try again.',
};

export class SttError extends Error {
  readonly code: SttErrorCode;
  readonly providerId: SttProviderId;

  constructor(code: SttErrorCode, providerId: SttProviderId, options?: { readonly cause?: unknown }) {
    super(MESSAGES[code](NAMES[providerId]), { cause: options?.cause });
    this.name = 'SttError';
    this.code = code;
    this.providerId = providerId;
  }
}

export const isSttError = (error: unknown): error is SttError => error instanceof SttError;

export function sttCodeForStatus(status: number): SttErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'bad-request';
}
