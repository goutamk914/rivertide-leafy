/**
 * OpenAI-compatible transcription: multipart `POST {base}/audio/transcriptions` (Groq, OpenAI,
 * custom). Uses Node's built-in FormData/Blob; 30 s timeout via AbortSignal.
 */
import { describeCause } from '../llm/errors';
import { safeJson } from '../llm/sse';
import { SttError, sttCodeForStatus } from './errors';
import { parseTranscription, type ParsedTranscription } from './guard';

export const STT_TIMEOUT_MS = 30_000;

export type RemoteSttProviderId = 'groq' | 'openai' | 'custom';

export interface RemoteSttConfig {
  readonly providerId: RemoteSttProviderId;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly model: string;
  /** 'auto' or an ISO-639-1 code. */
  readonly language: string;
}

export interface RemoteSttOptions {
  readonly prompt?: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly onWarn?: (message: string, meta: Record<string, unknown>) => void;
}

/** `verbose_json` (with per-segment no_speech_prob) only where the model supports it. */
export function supportsVerboseJson(providerId: RemoteSttProviderId, model: string): boolean {
  return providerId === 'groq' || /whisper/i.test(model);
}

export function buildTranscriptionForm(config: RemoteSttConfig, wav: Uint8Array, prompt: string | undefined): FormData {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', config.model);
  form.append('temperature', '0');
  if (config.language && config.language !== 'auto') form.append('language', config.language);
  if (prompt) form.append('prompt', prompt);
  form.append('response_format', supportsVerboseJson(config.providerId, config.model) ? 'verbose_json' : 'json');
  return form;
}

export async function transcribeRemote(config: RemoteSttConfig, wav: Uint8Array, options: RemoteSttOptions = {}): Promise<ParsedTranscription> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(STT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const headers: Record<string, string> = config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
  const url = `${config.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'POST', headers, body: buildTranscriptionForm(config, wav, options.prompt), signal });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const aborted = name === 'AbortError' || name === 'TimeoutError';
    const code = aborted ? (options.signal?.aborted ? 'cancelled' : 'timeout') : 'connection';
    options.onWarn?.('transcription request failed', { providerId: config.providerId, code, cause: describeCause(error) });
    throw new SttError(code, config.providerId, { cause: error });
  }
  if (!response.ok) {
    options.onWarn?.('transcription rejected', { providerId: config.providerId, status: response.status });
    throw new SttError(sttCodeForStatus(response.status), config.providerId, { cause: new Error(`HTTP ${response.status}`) });
  }
  const body = await response.text().catch(() => '');
  const parsed = parseTranscription(safeJson(body), null);
  if (!parsed) throw new SttError('invalid-output', config.providerId);
  return parsed;
}
