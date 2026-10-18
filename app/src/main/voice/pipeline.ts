/**
 * What happens after a capture: STT → dictionary → by mode
 *   dictate: polish (falls back to the raw words on any problem) → output
 *   ask:     answer (with the person's relevant facts) → output
 *   command: yes/no for a pending confirmation, else the agent
 * Outputs wait for earlier sessions (strict order). The user's words are never lost.
 */
import type { AgentActionSummary, FrontmostApp, HistoryStatus, Id, LeafyCue, VoiceError, VoiceMode, VoicePhase, VoiceSnapshot, VoiceSource } from '../../shared/types';
import type { AppContext, CapturePayload } from '../services';
import { isLlmError } from '../ai/llm/errors';
import { buildAnswerPrompt } from '../ai/prompts/answer';
import { humanDateTime } from '../ai/prompts/clock';
import { acceptPolished, buildPolishPrompt } from '../ai/prompts/polish';
import { buildSttPrompt } from '../ai/prompts/stt';
import { isHallucination } from '../ai/stt/guard';
import { isSttError } from '../ai/stt/errors';
import { osExtras } from '../os/extras';
import { cue, parseYesNo, voiceError } from './feedback';

const STT_TERMS = 60;
const POLISH_TERMS = 80;
const ANSWER_FACTS = 8;
const POLISH_BASE_TOKENS = 1500;
const POLISH_MAX_TOKENS = 16_000;
const ALSO_COPY_DELAY_MS = 650;

export interface CaptureSession {
  readonly sessionId: Id;
  readonly requestId: Id;
  readonly mode: VoiceMode;
  readonly source: VoiceSource;
  readonly locked: boolean;
  readonly startedAt: number;
  readonly target: Promise<FrontmostApp | null>;
  readonly controller: AbortController;
}

export interface PipelineHooks {
  phase(phase: VoicePhase, patch?: Partial<VoiceSnapshot>): void;
  leafy(value: LeafyCue): void;
  /** Resolves once earlier sessions have applied their output. */
  waitForTurn(): Promise<void>;
  /** The next agent run started with source "voice" belongs to this session. */
  expectRun(): void;
  /** A yes/no heard while a confirmation is pending: true when it answered one. */
  answerPending(approved: boolean): boolean;
  /** A new request while an action awaits approval declines that action (never leave it waiting). */
  declinePending(): void;
}

export interface PipelineResult {
  readonly status: HistoryStatus;
  readonly raw: string;
  readonly output: string;
  readonly pasted: boolean;
  readonly error: VoiceError | null;
  readonly sttMs: number | null;
  readonly llmMs: number | null;
  readonly sttProvider: string | null;
  readonly llmProvider: string | null;
  readonly actions: readonly AgentActionSummary[];
  readonly app: FrontmostApp | null;
  /** Text to read aloud (command replies). */
  readonly speak: string | null;
  /** A yes/no consumed by a pending confirmation: no history and no UI of its own. */
  readonly consumed: boolean;
  /** A short note for the island, e.g. that the text was copied instead of pasted. */
  readonly notice: string | null;
}

export const COPIED_NOTICE = 'Copied to the clipboard — paste it wherever you need it.';

export const BASE_RESULT: PipelineResult = {
  status: 'ok', raw: '', output: '', pasted: false, error: null, sttMs: null, llmMs: null,
  sttProvider: null, llmProvider: null, actions: [], app: null, speak: null, consumed: false, notice: null,
};
const BASE = BASE_RESULT;

type Transcribed = { readonly raw: string; readonly sttMs: number; readonly provider: string };

async function transcribe(ctx: AppContext, session: CaptureSession, payload: CapturePayload, hooks: PipelineHooks): Promise<Transcribed | PipelineResult> {
  if (!ctx.stt.isConfigured()) return { ...BASE, status: 'error', error: voiceError('stt-not-configured') };
  if (!payload.wav) return { ...BASE, status: 'error', error: voiceError('mic-unavailable', payload.error) };
  hooks.phase('transcribing');
  try {
    const prompt = buildSttPrompt(ctx.dictionary.terms(STT_TERMS));
    const result = await ctx.stt.transcribe(payload.wav, { prompt, signal: session.controller.signal });
    if (result.noSpeech || isHallucination(result.text, payload.stats.speechMs)) {
      return { ...BASE, status: 'empty', error: voiceError('no-speech'), sttMs: result.latencyMs, sttProvider: result.providerId };
    }
    return { raw: ctx.dictionary.apply(result.text.trim()), sttMs: result.latencyMs, provider: result.providerId };
  } catch (error) {
    if (session.controller.signal.aborted) return { ...BASE, status: 'cancelled', error: voiceError('cancelled') };
    return { ...BASE, status: 'error', error: voiceError('stt-failed', isSttError(error) ? error.message : undefined) };
  }
}

const isResult = (value: Transcribed | PipelineResult): value is PipelineResult => 'status' in value;

async function polish(ctx: AppContext, session: CaptureSession, raw: string): Promise<{ text: string; llmMs: number | null; provider: string | null }> {
  const settings = ctx.settings.get().voice;
  if (!settings.polish.enabled || !ctx.llm.isConfigured('polish')) return { text: raw, llmMs: null, provider: null };
  try {
    const appName = settings.useAppContext ? (await session.target)?.name ?? null : null;
    const prompt = buildPolishPrompt({ transcript: raw, options: settings.polish, terms: ctx.dictionary.terms(POLISH_TERMS), appName });
    const result = await ctx.llm.complete('polish', {
      system: prompt.system, messages: [{ role: 'user', content: prompt.user }],
      maxTokens: Math.min(POLISH_MAX_TOKENS, POLISH_BASE_TOKENS + Math.ceil(raw.length / 2)), signal: session.controller.signal,
    });
    const accepted = acceptPolished(raw, result.text);
    if (accepted === null) ctx.logger.child('voice').warn('polish output rejected; using the raw transcript', { chars: result.text.length });
    return { text: accepted ?? raw, llmMs: result.latencyMs, provider: result.providerId };
  } catch (error) {
    // Never lose the user's words: any polish failure pastes the raw transcript.
    ctx.logger.child('voice').warn('polish failed; using the raw transcript', { code: isLlmError(error) ? error.code : 'unknown' });
    return { text: raw, llmMs: null, provider: null };
  }
}

async function answer(ctx: AppContext, session: CaptureSession, question: string): Promise<{ text: string; llmMs: number; provider: string } | VoiceError> {
  if (!ctx.llm.isConfigured('answer')) return voiceError('llm-not-configured');
  try {
    const appName = ctx.settings.get().voice.useAppContext ? (await session.target)?.name ?? null : null;
    const prompt = buildAnswerPrompt({ question, facts: ctx.knowledge.relevant(question, ANSWER_FACTS), appName, now: humanDateTime(new Date()) });
    const result = await ctx.llm.complete('answer', { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], signal: session.controller.signal });
    return { text: result.text.trim(), llmMs: result.latencyMs, provider: result.providerId };
  } catch (error) {
    return voiceError(session.controller.signal.aborted ? 'cancelled' : 'llm-failed', isLlmError(error) ? error.message : undefined);
  }
}

type Delivery = 'pasted' | 'copied' | 'failed';

/** True when the "target" is Rivertide itself (e.g. dictating from the dashboard). */
export const isSelf = (target: FrontmostApp | null): boolean =>
  target !== null && (target.pid === process.pid || /^rivertide$/i.test(target.name.trim()));

/** Applies text per `settings.voice.output`. Anything not pasted is left on the clipboard. */
async function deliver(ctx: AppContext, session: CaptureSession, text: string): Promise<Delivery> {
  const settings = ctx.settings.get().voice;
  const target = await session.target;
  // Pasting into our own window would type into Rivertide: copy instead and say so.
  if (settings.output === 'clipboard' || session.source === 'dashboard' || isSelf(target)) {
    ctx.os.copy(text);
    return 'copied';
  }
  let pasted = false;
  if (settings.output === 'paste') pasted = await ctx.os.paste(text, target);
  else {
    await osExtras(ctx.os)?.activateApp(target).catch(() => false); // typing goes to the app the user was in
    pasted = (await ctx.os.typeText(text)) || (await ctx.os.paste(text, target));
  }
  if (!pasted) {
    ctx.os.copy(text);
    return 'failed';
  }
  if (settings.alsoCopy) setTimeout(() => ctx.os.copy(text), ALSO_COPY_DELAY_MS);
  return 'pasted';
}

async function output(ctx: AppContext, session: CaptureSession, hooks: PipelineHooks, text: string): Promise<Pick<PipelineResult, 'pasted' | 'error' | 'notice'>> {
  await hooks.waitForTurn();
  if (session.controller.signal.aborted) return { pasted: false, error: voiceError('cancelled'), notice: null };
  const delivery = await deliver(ctx, session, text);
  if (delivery === 'pasted') hooks.leafy(cue('writing', null, 1200));
  return {
    pasted: delivery === 'pasted',
    error: delivery === 'failed' ? voiceError('paste-failed') : null,
    notice: delivery === 'copied' ? COPIED_NOTICE : null,
  };
}

async function command(ctx: AppContext, session: CaptureSession, hooks: PipelineHooks, text: string): Promise<Partial<PipelineResult>> {
  const yesNo = parseYesNo(text);
  if (yesNo !== null && hooks.answerPending(yesNo)) return { consumed: true, output: yesNo ? 'Okay.' : 'Cancelled.' };
  hooks.declinePending();
  hooks.phase('thinking');
  hooks.leafy(cue('thinking'));
  hooks.expectRun();
  const result = await ctx.agent.run(text, 'voice');
  return {
    output: result.reply, actions: result.actions, speak: result.reply,
    status: session.controller.signal.aborted ? 'cancelled' : 'ok',
    error: result.ok || result.actions.some((action) => action.ok) ? null : voiceError('agent-failed', result.reply),
  };
}

export async function runPipeline(ctx: AppContext, session: CaptureSession, payload: CapturePayload, hooks: PipelineHooks): Promise<PipelineResult> {
  const heard = await transcribe(ctx, session, payload, hooks);
  const app = await session.target;
  if (isResult(heard)) return { ...heard, app };
  const base = { ...BASE, raw: heard.raw, sttMs: heard.sttMs, sttProvider: heard.provider, app };
  hooks.phase('thinking', { transcript: heard.raw });

  if (session.mode === 'command') {
    const result = await command(ctx, session, hooks, heard.raw);
    // An agent "failure" still has a reply worth speaking; it is recorded as ok with its actions.
    return { ...base, ...result, error: result.consumed ? null : result.error ?? null };
  }
  if (session.mode === 'ask') {
    const answered = await answer(ctx, session, heard.raw);
    if ('code' in answered) return { ...base, status: answered.code === 'cancelled' ? 'cancelled' : 'error', error: answered };
    const delivered = await output(ctx, session, hooks, answered.text);
    return { ...base, output: answered.text, llmMs: answered.llmMs, llmProvider: answered.provider, ...delivered };
  }
  const polished = await polish(ctx, session, heard.raw);
  const delivered = await output(ctx, session, hooks, polished.text);
  return { ...base, output: polished.text, llmMs: polished.llmMs, llmProvider: polished.provider, ...delivered };
}
