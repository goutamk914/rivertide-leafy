import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createSttService } from '../../../src/main/ai/stt';
import { isHallucination, parseTranscription, parseWhisperCliOutput, silentWav, wavDurationMs } from '../../../src/main/ai/stt/guard';
import { findWhisperCli, transcribeLocal, whisperArgs } from '../../../src/main/ai/stt/local';
import { buildTranscriptionForm, supportsVerboseJson, transcribeRemote, type RemoteSttConfig } from '../../../src/main/ai/stt/remote';
import type { ExecFn } from '../../../src/main/os/exec';
import { createFakeContext } from '../agent/fake-context';

const okExec = (stdout: string): ExecFn => vi.fn(async () => ({ ok: true, code: 0, stdout, stderr: '', timedOut: false, error: null }));

describe('hallucination guard', () => {
  it.each(['[BLANK_AUDIO]', 'Thanks for watching!', '...', ''])('always drops "%s"', (text) => {
    expect(isHallucination(text, 5000)).toBe(true);
  });

  it('drops short filler only when there was very little speech', () => {
    expect(isHallucination('Thank you.', 300)).toBe(true);
    expect(isHallucination('you', 200)).toBe(true);
    expect(isHallucination('Thank you.', 1500)).toBe(false);
    expect(isHallucination('Thank you.', null)).toBe(false);
  });

  it('keeps real speech', () => {
    expect(isHallucination('Please call the clinic tomorrow.', 100)).toBe(false);
  });
});

describe('parseTranscription', () => {
  it('drops segments that are probably not speech', () => {
    const raw = { text: 'ignored', segments: [{ text: ' Hello', no_speech_prob: 0.1 }, { text: ' Thanks for watching!', no_speech_prob: 0.9 }, { text: ' there.', no_speech_prob: 0.2 }] };
    expect(parseTranscription(raw, null)).toEqual({ text: 'Hello there.', noSpeech: false });
  });

  it('flags no speech when nothing usable remains', () => {
    expect(parseTranscription({ text: 'x', segments: [{ text: 'x', no_speech_prob: 0.95 }] }, null)).toEqual({ text: '', noSpeech: true });
    expect(parseTranscription({ text: ' [BLANK_AUDIO] ' }, null)).toEqual({ text: '', noSpeech: true });
  });

  it('rejects malformed responses', () => {
    expect(parseTranscription({ nope: true }, null)).toBeNull();
    expect(parseTranscription(undefined, null)).toBeNull();
  });

  it('cleans whisper.cpp output', () => {
    expect(parseWhisperCliOutput('\n Hello there.\n How are you?\n', null)).toEqual({ text: 'Hello there. How are you?', noSpeech: false });
  });

  it('reads WAV durations and builds silent test audio', () => {
    expect(wavDurationMs(silentWav(500))).toBe(500);
    expect(wavDurationMs(new Uint8Array(10))).toBeNull();
  });
});

describe('remote transcription', () => {
  const config: RemoteSttConfig = { providerId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk', model: 'whisper-large-v3-turbo', language: 'en' };

  it('sends the documented multipart fields', () => {
    const form = buildTranscriptionForm(config, silentWav(100), 'Leafy, Oxaliplatin.');
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('temperature')).toBe('0');
    expect(form.get('language')).toBe('en');
    expect(form.get('prompt')).toBe('Leafy, Oxaliplatin.');
    expect(form.get('response_format')).toBe('verbose_json');
    expect((form.get('file') as File).type).toBe('audio/wav');
  });

  it('omits language for auto and uses json where verbose_json is unsupported', () => {
    const form = buildTranscriptionForm({ ...config, providerId: 'openai', model: 'gpt-4o-mini-transcribe', language: 'auto' }, silentWav(100), undefined);
    expect(form.has('language')).toBe(false);
    expect(form.get('response_format')).toBe('json');
    expect(supportsVerboseJson('openai', 'whisper-1')).toBe(true);
  });

  it('posts to /audio/transcriptions and parses the result', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: ' Hi there. ', segments: [{ text: ' Hi there.', no_speech_prob: 0.01 }] })));
    const result = await transcribeRemote(config, silentWav(100), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gsk');
    expect(result).toEqual({ text: 'Hi there.', noSpeech: false });
  });

  it.each([[401, 'auth'], [429, 'rate-limit'], [503, 'server']])('maps HTTP %i to %s', async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response('', { status }));
    await expect(transcribeRemote(config, silentWav(100), { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ code });
  });

  it('reports a cancel as cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    await expect(transcribeRemote(config, silentWav(100), { fetchImpl: fetchImpl as unknown as typeof fetch, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('local whisper.cpp', () => {
  it('builds the documented arguments', () => {
    expect(whisperArgs({ model: '/m.bin', language: 'auto' }, '/tmp/a.wav')).toEqual(['-m', '/m.bin', '-f', '/tmp/a.wav', '-nt', '-np', '-l', 'auto']);
    expect(whisperArgs({ model: '/m.bin', language: 'en', prompt: 'Leafy.' }, '/x.wav')).toContain('--prompt');
  });

  it('runs the binary on a temp file and always deletes it', async () => {
    let wavPath = '';
    const exec: ExecFn = vi.fn(async (_file, args) => {
      wavPath = args[3];
      expect(existsSync(wavPath)).toBe(true);
      return { ok: true, code: 0, stdout: ' Hello from my computer.\n', stderr: '', timedOut: false, error: null };
    });
    const result = await transcribeLocal(exec, { binary: '/bin/whisper-cli', model: '/m.bin', language: 'en' }, silentWav(100));
    expect(result).toEqual({ text: 'Hello from my computer.', noSpeech: false });
    expect(existsSync(wavPath)).toBe(false);
  });

  it('maps a missing binary and timeouts', async () => {
    const missing: ExecFn = async () => ({ ok: false, code: null, stdout: '', stderr: '', timedOut: false, error: 'program not found' });
    const slow: ExecFn = async () => ({ ok: false, code: null, stdout: '', stderr: '', timedOut: true, error: 'timed out' });
    await expect(transcribeLocal(missing, { binary: 'x', model: 'm', language: 'en' }, silentWav(10))).rejects.toMatchObject({ code: 'local-missing' });
    await expect(transcribeLocal(slow, { binary: 'x', model: 'm', language: 'en' }, silentWav(10))).rejects.toMatchObject({ code: 'timeout' });
  });

  it('finds the configured binary first, then common install locations', () => {
    expect(findWhisperCli('/custom/whisper-cli', (path) => path === '/custom/whisper-cli')).toBe('/custom/whisper-cli');
    expect(findWhisperCli('', (path) => path === '/usr/local/bin/whisper-cli')).toBe('/usr/local/bin/whisper-cli');
    expect(findWhisperCli('', () => false)).toBeNull();
  });
});

describe('createSttService', () => {
  it('transcribes with the selected provider and clamps the prompt', async () => {
    const { ctx } = createFakeContext();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: 'Hello.' })));
    const stt = createSttService(ctx, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await stt.transcribe(silentWav(100), { prompt: 'x, '.repeat(1000) });
    expect(result).toMatchObject({ text: 'Hello.', providerId: 'groq', noSpeech: false });
    expect(String(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get('prompt')).length).toBeLessThanOrEqual(700);
  });

  it('is not configured without a key', async () => {
    const { ctx } = createFakeContext({ services: { secrets: { get: () => null } } });
    const stt = createSttService(ctx);
    expect(stt.isConfigured()).toBe(false);
    expect(await stt.test()).toEqual({ ok: false, latencyMs: null, message: 'Add a speech key in Settings → AI to start dictating.' });
  });

  it('tests the local provider without running a transcription', async () => {
    const { ctx } = createFakeContext({ settings: { stt: { providerId: 'local', model: 'local', localModelPath: '/models/base.bin' } } });
    const stt = createSttService(ctx, { exec: okExec(''), findBinary: () => '/opt/homebrew/bin/whisper-cli', fileExists: () => true });
    expect(stt.isConfigured()).toBe(true);
    expect((await stt.test('local')).ok).toBe(true);
  });

  it('runs a provider test with a silent clip', async () => {
    const { ctx } = createFakeContext();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: '' })));
    const result = await createSttService(ctx, { fetchImpl: fetchImpl as unknown as typeof fetch }).test('groq');
    expect(result.ok).toBe(true);
  });
});
