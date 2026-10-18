/**
 * `createSttService(ctx)` — speech-to-text over the provider chosen in Settings → AI:
 * Groq / OpenAI / custom (OpenAI-compatible) or local whisper.cpp.
 */
import type { AppContext, SttService, TranscriptionResult } from '../../services';
import type { ProviderTestResult } from '../../../shared/ipc';
import { PROVIDERS, STT_PROVIDER_IDS, type SttProviderId } from '../../../shared/settings';
import { runFile, type ExecFn } from '../../os/exec';
import { clampSttPrompt } from '../prompts/stt';
import { isSttError, SttError } from './errors';
import { silentWav, type ParsedTranscription } from './guard';
import { findWhisperCli, isReadable, transcribeLocal } from './local';
import { transcribeRemote, type RemoteSttConfig, type RemoteSttProviderId } from './remote';

const DEFAULT_STT_MODEL: Readonly<Record<SttProviderId, string>> = {
  groq: 'whisper-large-v3-turbo', openai: 'gpt-4o-mini-transcribe', custom: 'whisper-1', local: 'local',
};
const SECRET_FOR: Readonly<Record<RemoteSttProviderId, 'groq' | 'openai' | 'stt-custom'>> = {
  groq: 'groq', openai: 'openai', custom: 'stt-custom',
};
const TEST_AUDIO_MS = 500;

export interface SttOverrides {
  readonly fetchImpl?: typeof fetch;
  readonly exec?: ExecFn;
  readonly findBinary?: (configured: string) => string | null;
  readonly fileExists?: (path: string) => boolean;
}

const isSttProviderId = (value: string): value is SttProviderId => (STT_PROVIDER_IDS as readonly string[]).includes(value);

export function createSttService(ctx: AppContext, overrides: SttOverrides = {}): SttService {
  const log = ctx.logger.child('stt');
  const exec = overrides.exec ?? runFile;
  const findBinary = overrides.findBinary ?? ((configured: string) => findWhisperCli(configured));
  const fileExists = overrides.fileExists ?? isReadable;

  const settings = () => ctx.settings.get().stt;
  const modelFor = (providerId: SttProviderId): string =>
    providerId === settings().providerId ? settings().model : DEFAULT_STT_MODEL[providerId];

  function remoteConfig(providerId: RemoteSttProviderId): RemoteSttConfig | null {
    const apiKey = ctx.secrets.get(SECRET_FOR[providerId])?.trim() || null;
    const baseUrl = providerId === 'custom'
      ? settings().customBaseUrl.trim() || null
      : PROVIDERS.find((info) => info.id === providerId)?.defaultBaseUrl ?? null;
    if (!baseUrl || (providerId !== 'custom' && !apiKey)) return null;
    return { providerId, baseUrl, apiKey, model: modelFor(providerId), language: settings().language };
  }

  function localConfig(): { binary: string; model: string } | null {
    const binary = findBinary(settings().localBinaryPath);
    const model = settings().localModelPath.trim();
    return binary && model && fileExists(model) ? { binary, model } : null;
  }

  const isProviderConfigured = (providerId: SttProviderId): boolean =>
    providerId === 'local' ? localConfig() !== null : remoteConfig(providerId) !== null;

  async function transcribeWith(providerId: SttProviderId, wav: Uint8Array, prompt: string | undefined, signal?: AbortSignal): Promise<ParsedTranscription> {
    if (providerId === 'local') {
      const local = localConfig();
      if (!local) throw new SttError('local-missing', 'local');
      return transcribeLocal(exec, { ...local, language: settings().language, prompt, signal }, wav);
    }
    const config = remoteConfig(providerId);
    if (!config) throw new SttError('not-configured', providerId);
    return transcribeRemote(config, wav, { prompt, signal, fetchImpl: overrides.fetchImpl, onWarn: (message, meta) => log.warn(message, meta) });
  }

  async function transcribe(wav: Uint8Array, options: { readonly prompt?: string; readonly signal?: AbortSignal }): Promise<TranscriptionResult> {
    const providerId = settings().providerId;
    const startedAt = Date.now();
    try {
      const result = await transcribeWith(providerId, wav, clampSttPrompt(options.prompt), options.signal);
      const latencyMs = Date.now() - startedAt;
      log.info('transcribed', { providerId, latencyMs, chars: result.text.length, noSpeech: result.noSpeech });
      return { text: result.text, providerId, latencyMs, noSpeech: result.noSpeech };
    } catch (error) {
      if (!isSttError(error) || error.code !== 'cancelled') log.warn('transcription failed', { providerId, code: isSttError(error) ? error.code : 'unknown' });
      throw error;
    }
  }

  async function test(providerId?: string): Promise<ProviderTestResult> {
    const id = providerId && isSttProviderId(providerId) ? providerId : settings().providerId;
    if (providerId && !isSttProviderId(providerId)) return { ok: false, latencyMs: null, message: 'That speech service isn’t one Rivertide knows.' };
    if (id === 'local') {
      return localConfig()
        ? { ok: true, latencyMs: null, message: 'Found whisper-cli and the model file. Dictation will stay on this computer.' }
        : { ok: false, latencyMs: null, message: new SttError('local-missing', 'local').message };
    }
    if (!isProviderConfigured(id)) return { ok: false, latencyMs: null, message: new SttError('not-configured', id).message };
    const startedAt = Date.now();
    try {
      await transcribeWith(id, silentWav(TEST_AUDIO_MS), undefined);
      const latencyMs = Date.now() - startedAt;
      return { ok: true, latencyMs, message: `Speech-to-text is working (${latencyMs} ms).` };
    } catch (error) {
      return { ok: false, latencyMs: null, message: isSttError(error) ? error.message : 'The test failed. Try again in a moment.' };
    }
  }

  return {
    isConfigured: () => isProviderConfigured(settings().providerId),
    transcribe,
    test,
  };
}
