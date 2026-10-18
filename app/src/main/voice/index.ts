/**
 * `createVoiceService(ctx)` — the voice orchestrator (ARCHITECTURE §3.5). The pure machine decides
 * the listening lifecycle; this file performs its effects (engine, island, Leafy, sounds), runs the
 * pipeline for each capture in strict session order, saves history and drives the snapshot.
 */
import type { Id, LeafyCue, VoiceMode, VoicePhase, VoiceSnapshot, VoiceSource } from '../../shared/types';
import type { AppContext, CapturePayload, FnKeyEvent, VoiceService } from '../services';
import type { EngineCommand } from '../../shared/ipc';
import { newId } from '../agent/ids';
import { createAgentBridge } from './agent-bridge';
import { cue, ERROR_MESSAGES, estimateSpeechMs, IDLE_SNAPSHOT, isPermissionError, speakable, voiceError } from './feedback';
import { buildHistoryItem } from './history';
import { INITIAL_STATE, reduce, type ListeningSession, type MachineEffect, type MachineEvent, type MachineState } from './machine';
import { BASE_RESULT, runPipeline, type CaptureSession, type PipelineResult } from './pipeline';

export const HIDE_AFTER_DONE_MS = 1600;
export const HIDE_AFTER_ERROR_MS = 4000;
export const NO_SPEECH_TIMEOUT_MS = 8000;
const CONFIRM_LISTEN_DELAY_MS = 300;
const BUSY_PHASES: ReadonlySet<VoicePhase> = new Set(['listening', 'transcribing', 'thinking', 'acting', 'confirming', 'speaking']);

export function createVoiceService(ctx: AppContext): VoiceService {
  let machine: MachineState = INITIAL_STATE;
  let snapshot: VoiceSnapshot = IDLE_SNAPSHOT;
  let outputChain: Promise<void> = Promise.resolve();
  let hideTimer: NodeJS.Timeout | null = null;
  let subscribed = false;
  const captures = new Map<Id, CaptureSession>(); // by requestId, awaiting the engine's capture
  const active = new Map<Id, CaptureSession>(); // by sessionId, until the pipeline finishes
  const log = () => ctx.logger.child('voice');
  const settings = () => ctx.settings.get();
  const engine = (command: EngineCommand) => ctx.windows.engine.send(command);
  const sound = (name: Extract<EngineCommand, { type: 'cue' }>['name']) => { if (settings().voice.sounds) engine({ type: 'cue', name }); };

  // ── Snapshot & feedback ────────────────────────────────────────────────────
  function publish(next: VoiceSnapshot): void {
    snapshot = next;
    ctx.bus.emit('voice:snapshot', next);
  }
  function update(sessionId: Id, phase: VoicePhase | null, patch: Partial<VoiceSnapshot> = {}): void {
    if (snapshot.sessionId !== sessionId) return; // a newer session owns the island
    publish({ ...snapshot, ...patch, ...(phase ? { phase } : {}) });
  }
  function leafy(sessionId: Id | null, value: LeafyCue): void {
    if (sessionId === null || snapshot.sessionId === sessionId) ctx.bus.emit('leafy:cue', value);
  }
  function clearHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
  }
  /**
   * Hides the island after a session finishes — only if that session still owns it (a newer session
   * schedules its own hide, and must not lose it to an older one finishing late).
   */
  function scheduleHide(sessionId: Id, ms: number): void {
    if (snapshot.sessionId !== sessionId) return;
    clearHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (snapshot.sessionId !== sessionId || BUSY_PHASES.has(snapshot.phase)) return;
      if (bridge.pending()) {
        scheduleHide(sessionId, ms); // never hide while an action waits for approval; check again later
        return;
      }
      ctx.windows.island.hide();
      publish(IDLE_SNAPSHOT);
      ctx.bus.emit('leafy:cue', cue('idle'));
    }, ms);
  }
  function resetNow(): void {
    clearHide();
    ctx.windows.island.hide();
    publish(IDLE_SNAPSHOT);
    ctx.bus.emit('leafy:cue', cue('idle'));
  }

  const bridge = createAgentBridge({
    update, current: () => snapshot, restore: publish, leafy,
    confirm: (runId, callId, approved) => ctx.agent.confirm(runId, callId, approved),
    onConfirm: (sessionId, confirmation) => {
      clearHide();
      sound('confirm');
      const session = active.get(sessionId);
      const voice = settings().voice;
      const handsFree = session !== undefined && session.source !== 'fn';
      const question = handsFree ? `${confirmation.summary} Say yes or no.` : confirmation.summary;
      if (voice.speakResponses) engine({ type: 'speak', text: question, voiceName: voice.voiceName, rate: voice.speechRate });
      // Hands-free sessions listen for the answer once the question has been read out.
      if (session && handsFree) {
        const delay = (voice.speakResponses ? estimateSpeechMs(confirmation.summary, voice.speechRate) : 0) + CONFIRM_LISTEN_DELAY_MS;
        setTimeout(() => { if (bridge.pending()?.callId === confirmation.callId) startSession('command', session.source); }, delay);
      }
    },
  });

  function ensureSubscribed(): void {
    if (subscribed) return;
    subscribed = true;
    ctx.bus.on('agent:event', (event) => bridge.handle(event));
  }

  // ── Machine effects ────────────────────────────────────────────────────────
  function engineStart(session: ListeningSession): void {
    const voice = settings().voice;
    engine({
      type: 'start', requestId: session.requestId, deviceId: voice.microphoneId,
      endpointing: { enabled: session.endpointing, endSilenceMs: voice.endSilenceMs, noSpeechTimeoutMs: NO_SPEECH_TIMEOUT_MS },
      maxDurationMs: voice.maxDurationSec * 1000,
    });
  }

  function begin(session: ListeningSession): void {
    // Capture the target app FIRST, before anything of ours could take focus.
    const target = ctx.os.frontmostApp().catch(() => null);
    const capture: CaptureSession = { ...session, target, controller: new AbortController() };
    captures.set(session.requestId, capture);
    active.set(session.sessionId, capture);
    if (snapshot.phase === 'speaking') engine({ type: 'stop-speaking' });
    engineStart(session);
    sound('start');
    clearHide();
    ctx.windows.island.show();
    publish({
      ...IDLE_SNAPSHOT, sessionId: session.sessionId, phase: 'listening', mode: session.mode, source: session.source,
      locked: session.locked, startedAt: new Date(session.startedAt).toISOString(), pending: bridge.pending(),
    });
    const summoned = session.source === 'clap' || session.source === 'wake';
    leafy(session.sessionId, cue('listening', summoned && !bridge.pending() ? 'Yes?' : null));
  }

  function restart(session: ListeningSession, previousRequestId: Id): void {
    const previous = captures.get(previousRequestId);
    captures.delete(previousRequestId);
    engine({ type: 'cancel', requestId: previousRequestId });
    if (previous) captures.set(session.requestId, { ...previous, requestId: session.requestId, locked: true });
    engineStart(session);
    update(session.sessionId, 'listening', { locked: true, detail: 'Hands-free — press fn again when you’re done.' });
  }

  function abort(session: ListeningSession, silent: boolean): void {
    engine({ type: 'cancel', requestId: session.requestId });
    captures.delete(session.requestId);
    active.delete(session.sessionId);
    if (snapshot.sessionId !== session.sessionId) return;
    if (!silent) sound('stop');
    resetNow();
  }

  function apply(effect: MachineEffect): void {
    switch (effect.type) {
      case 'begin': return begin(effect.session);
      case 'restart': return restart(effect.session, effect.previousRequestId);
      case 'abort': return abort(effect.session, effect.silent);
      case 'end':
        engine({ type: 'stop', requestId: effect.session.requestId });
        sound('stop');
        update(effect.session.sessionId, 'transcribing');
        leafy(effect.session.sessionId, cue('thinking'));
        return;
      case 'schedule-tap-timeout':
        setTimeout(() => dispatch({ type: 'tap-timeout', sessionId: effect.sessionId }), effect.ms);
        return;
    }
  }

  function dispatch(event: MachineEvent): void {
    const transition = reduce(machine, event);
    machine = transition.state;
    transition.effects.forEach(apply);
  }

  const ids = () => ({ sessionId: newId(), requestId: newId() });

  function startSession(mode: VoiceMode, source: VoiceSource): VoiceSnapshot {
    ensureSubscribed();
    dispatch({ type: 'start', mode, source, ids: ids(), now: Date.now() });
    return snapshot;
  }

  // ── Finishing a session ────────────────────────────────────────────────────
  function record(session: CaptureSession, payload: CapturePayload, result: PipelineResult): void {
    if (result.status === 'cancelled' || result.consumed) return;
    const item = buildHistoryItem(newId(), session, payload, result, Date.now());
    if (settings().privacy.historyEnabled) {
      try {
        ctx.history.add(item);
      } catch (error) {
        log().error('could not save history', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    ctx.bus.emit('voice:completed', { item, stats: payload.stats });
  }

  function showDone(session: CaptureSession, result: PipelineResult): void {
    const pasteHint = result.error?.code === 'paste-failed' && ctx.platform !== 'darwin' ? result.error.message.replace('⌘V', 'Ctrl+V') : result.error?.message;
    update(session.sessionId, 'done', { output: result.output, pasted: result.pasted, error: result.error, detail: pasteHint ?? result.notice });
    sound(result.error ? 'error' : 'success');
    if (!result.pasted) leafy(session.sessionId, cue(result.error ? 'caring' : 'success', result.error ? pasteHint ?? null : result.notice));
    scheduleHide(session.sessionId, result.error ? HIDE_AFTER_ERROR_MS : HIDE_AFTER_DONE_MS);
  }

  function show(session: CaptureSession, result: PipelineResult): void {
    if (result.consumed) return;
    if (result.status === 'cancelled') {
      if (snapshot.sessionId === session.sessionId) resetNow();
      return;
    }
    const failed = result.status === 'error' || result.status === 'empty';
    // An answer to a pending confirmation that came back empty or broken: show the question again.
    if (failed && bridge.pendingSession() !== null && bridge.pendingSession() !== session.sessionId && snapshot.sessionId === session.sessionId) {
      bridge.showPending();
      leafy(bridge.pendingSession(), cue('confirm', result.error?.message ?? null));
      return;
    }
    if (failed && result.error) {
      update(session.sessionId, 'error', { transcript: result.raw, output: result.output, error: result.error, detail: result.error.message });
      if (result.status === 'error') sound('error');
      leafy(session.sessionId, cue(result.status === 'empty' ? 'caring' : 'error', result.error.message));
      scheduleHide(session.sessionId, HIDE_AFTER_ERROR_MS);
      return;
    }
    const voice = settings().voice;
    const spoken = result.speak ? speakable(result.speak) : '';
    if (spoken && voice.speakResponses && snapshot.sessionId === session.sessionId) {
      engine({ type: 'speak', text: spoken, voiceName: voice.voiceName, rate: voice.speechRate });
      update(session.sessionId, 'speaking', { output: result.output, detail: null });
      leafy(session.sessionId, cue('speaking', spoken, null));
      setTimeout(() => { if (snapshot.sessionId === session.sessionId && snapshot.phase === 'speaking') showDone(session, result); }, estimateSpeechMs(spoken, voice.speechRate));
      return;
    }
    showDone(session, result);
  }

  async function process(session: CaptureSession, payload: CapturePayload, previous: Promise<void>): Promise<void> {
    const result = await runPipeline(ctx, session, payload, {
      phase: (phase, patch) => update(session.sessionId, phase, patch),
      leafy: (value) => leafy(session.sessionId, value),
      waitForTurn: () => previous,
      expectRun: () => bridge.expectRun(session.sessionId),
      answerPending: (approved) => bridge.answer(approved, true),
      declinePending: () => { bridge.answer(false, false); },
    }).catch((error: unknown): PipelineResult => {
      log().error('voice pipeline failed', { error: error instanceof Error ? error.message : String(error) });
      return { ...BASE_RESULT, status: 'error', error: voiceError('unknown') };
    });
    record(session, payload, result);
    show(session, result);
  }

  // ── Service API ────────────────────────────────────────────────────────────
  return {
    snapshot: () => snapshot,
    start: startSession,
    stop() {
      dispatch({ type: 'stop' });
      return snapshot;
    },
    cancel() {
      if (machine.listening) {
        dispatch({ type: 'cancel' });
        return snapshot;
      }
      const session = snapshot.sessionId ? active.get(snapshot.sessionId) : undefined;
      if (session) {
        session.controller.abort();
        const runId = bridge.runFor(session.sessionId);
        if (bridge.pendingSession() === session.sessionId) bridge.answer(false, false);
        if (runId) ctx.agent.cancel(runId);
      }
      if (snapshot.phase === 'speaking') engine({ type: 'stop-speaking' });
      if (snapshot.phase !== 'idle') resetNow();
      return snapshot;
    },
    handleFnKey(event: FnKeyEvent) {
      if (!settings().hotkeys.useFn) return;
      ensureSubscribed();
      dispatch({ type: 'fn', key: event, ids: ids(), now: Date.now() });
    },
    async onCapture(payload) {
      const session = captures.get(payload.requestId);
      if (!session) {
        log().debug('capture for an unknown or cancelled request', { requestId: payload.requestId, reason: payload.reason });
        return;
      }
      captures.delete(payload.requestId);
      dispatch({ type: 'capture-ended', requestId: payload.requestId });
      if (payload.reason === 'cancelled') {
        active.delete(session.sessionId);
        if (snapshot.sessionId === session.sessionId) resetNow();
        return;
      }
      // Reserve this session's place in the output order now (capture order = session order).
      const previous = outputChain;
      let release: () => void = () => undefined;
      const mine = new Promise<void>((resolve) => { release = resolve; }); // executor runs now, so release is set
      outputChain = previous.then(() => mine);
      try {
        if (payload.reason === 'no-speech' || (payload.reason === 'error' && !payload.wav)) {
          const code = payload.reason === 'no-speech' ? 'no-speech' : 'mic-unavailable';
          const result: PipelineResult = { ...BASE_RESULT, status: code === 'no-speech' ? 'empty' : 'error', error: voiceError(code), app: await session.target };
          record(session, payload, result);
          show(session, result);
          return;
        }
        await process(session, payload, previous);
      } finally {
        active.delete(session.sessionId);
        bridge.forget(session.sessionId);
        release();
      }
    },
    onClap() {
      if (machine.listening || BUSY_PHASES.has(snapshot.phase)) return;
      if (settings().clap.action === 'palette') {
        ctx.windows.palette.show('voice');
        return;
      }
      startSession('command', 'clap');
    },
    onWake() {
      // Like a clap: only summons Leafy and listens for a command; ignored while anything is in flight.
      if (machine.listening || BUSY_PHASES.has(snapshot.phase)) return;
      startSession('command', 'wake');
    },
    onEngineError(scope, message) {
      if (scope !== 'mic' && scope !== 'capture') {
        log().warn('engine error', { scope, message });
        return;
      }
      const code = isPermissionError(message) ? 'mic-denied' : 'mic-unavailable';
      const listening = machine.listening;
      if (listening) {
        captures.delete(listening.requestId);
        active.delete(listening.sessionId);
        dispatch({ type: 'capture-ended', requestId: listening.requestId });
      }
      const sessionId = listening?.sessionId ?? snapshot.sessionId ?? newId();
      publish({ ...snapshot, sessionId, phase: 'error', error: voiceError(code), detail: ERROR_MESSAGES[code] });
      ctx.bus.emit('toast', { kind: 'error', message: ERROR_MESSAGES[code] });
      ctx.bus.emit('leafy:cue', cue('error', ERROR_MESSAGES[code]));
      scheduleHide(sessionId, HIDE_AFTER_ERROR_MS);
    },
  };
}
