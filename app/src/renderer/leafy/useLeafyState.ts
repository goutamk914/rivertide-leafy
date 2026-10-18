import { useCallback, useEffect, useRef, useState } from 'react';
import { ANIMATIONS, type LeafyMood } from '@rivertide/leafy/moods';
import type { Settings } from '@shared/settings';
import type { VoiceSnapshot } from '@shared/types';
import type { Platform } from '../lib/hooks/accelerator';
import { activeStep, type AgentRunState } from '../lib/hooks/agentRun';
import { toolActivity } from '../lib/hooks/iconNames';
import { useClock } from '../lib/hooks/useClock';
import type { ReceivedCue } from '../lib/hooks/useLeafyCue';
import { BUBBLE_LINGER_MS, GREETING_MS, isResultPhase, selectBubble, type BubbleContent, type EndedSession } from './bubble';
import { chooseMood, rememberSettled, SLEEP_AFTER_MS, YAWN_AFTER_MS, YAWN_EVERY_MS } from './mood';

/** A one-shot cue mood may play this long even when its bubble hold is shorter. */
const CUE_MOOD_WINDOW_MS = 15_000;
const HOUR_MS = 3_600_000;

export interface Greeting {
  readonly title: string;
  readonly status: string | null;
  readonly shownAt: number;
}

export interface LeafyStateInput {
  readonly snapshot: VoiceSnapshot;
  readonly run: AgentRunState | null;
  readonly cue: ReceivedCue | null;
  readonly greeting: Greeting | null;
  readonly settings: Settings | null;
  readonly drag: 'dragging' | 'dropped' | null;
  readonly dropSeq: number;
  /** Last pointer interaction (hover, click, drag), `Date.now()`. */
  readonly interactionAt: number;
  readonly platform: Platform;
}

/**
 * A React key for the sprite that changes only when the same one-shot mood must play again
 * (two notify cues in a row). Other mood changes keep the canvas, so Leafy never blinks out.
 */
function useReplayKey(mood: LeafyMood, key: string): number {
  const [state, setState] = useState({ mood, key, replay: 0 });
  if (state.mood === mood && state.key === key) return state.replay;
  const replays = state.mood === mood && !ANIMATIONS[mood].loop;
  const next = { mood, key, replay: replays ? state.replay + 1 : state.replay };
  setState(next);
  return next.replay;
}

/** Remembers when the phase last changed and the session that just finished. */
function useSessionTimeline(snapshot: VoiceSnapshot) {
  const lastLive = useRef<VoiceSnapshot | null>(null);
  const [phaseAt, setPhaseAt] = useState(() => Date.now());
  const [ended, setEnded] = useState<EndedSession | null>(null);

  useEffect(() => {
    setPhaseAt(Date.now());
    if (snapshot.phase !== 'idle') return;
    const last = lastLive.current;
    lastLive.current = null;
    if (last) setEnded({ snapshot: last, endedAt: Date.now() });
  }, [snapshot.phase]);

  useEffect(() => {
    if (snapshot.phase !== 'idle') lastLive.current = snapshot;
  }, [snapshot]);

  return { phaseAt, ended };
}

function cueMoodActive(cue: ReceivedCue | null, now: number): boolean {
  if (!cue) return false;
  const loops = ANIMATIONS[cue.cue.mood].loop;
  if (loops) return cue.cue.holdMs === null || now < cue.receivedAt + cue.cue.holdMs;
  return now < cue.receivedAt + Math.max(cue.cue.holdMs ?? 0, CUE_MOOD_WINDOW_MS);
}

function nextYawnAt(activityAt: number, now: number): number {
  const first = activityAt + YAWN_AFTER_MS;
  if (now < first) return first;
  return first + (Math.floor((now - first) / YAWN_EVERY_MS) + 1) * YAWN_EVERY_MS;
}

/**
 * Wires the pure mood and bubble selectors to time: idle clocks, expiring bubbles, settled
 * one-shot animations. Re-renders only when something can actually change.
 */
export function useLeafyState(input: LeafyStateInput) {
  const { snapshot, run, cue, greeting, settings, drag, dropSeq, interactionAt, platform } = input;
  const { phaseAt, ended } = useSessionTimeline(snapshot);
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());

  const activityAt = Math.max(phaseAt, cue?.receivedAt ?? 0, interactionAt);
  const cueHoldEnd = cue && cue.cue.holdMs !== null ? cue.receivedAt + cue.cue.holdMs : null;
  const wakeProbe = Date.now();
  const now = useClock([
    nextYawnAt(activityAt, wakeProbe),
    activityAt + SLEEP_AFTER_MS,
    wakeProbe - activityAt >= SLEEP_AFTER_MS ? Math.ceil(wakeProbe / HOUR_MS) * HOUR_MS : null,
    ended ? ended.endedAt + BUBBLE_LINGER_MS : null,
    cueHoldEnd,
    cue ? cue.receivedAt + CUE_MOOD_WINDOW_MS : null,
    greeting ? greeting.shownAt + GREETING_MS : null,
  ]);

  const recentEnd = ended && isResultPhase(ended.snapshot.phase) && now < ended.endedAt + BUBBLE_LINGER_MS;
  const moodSource = snapshot.phase === 'idle' && recentEnd && ended ? ended.snapshot : snapshot;
  const tool = activeStep(run)?.tool ?? null;
  const choice = chooseMood(
    {
      phase: moodSource.phase,
      mode: moodSource.mode,
      sessionId: moodSource.sessionId,
      pasted: moodSource.pasted,
      errorCode: moodSource.error?.code ?? null,
      toolActivity: tool ? toolActivity(tool) : null,
      drag,
      dropSeq,
      cue: cue && cueMoodActive(cue, now) ? { mood: cue.cue.mood, seq: cue.seq } : null,
      greeting: greeting !== null && now < greeting.shownAt + GREETING_MS,
      idleMs: snapshot.phase === 'idle' ? Math.max(0, now - activityAt) : 0,
      hour: new Date(now).getHours(),
      sleepAtNight: settings?.leafy.sleepAtNight ?? true,
    },
    settled,
  );

  const choiceKey = choice.key;
  const onSettle = useCallback(() => setSettled((prev) => rememberSettled(prev, choiceKey)), [choiceKey]);
  const moodKey = useReplayKey(choice.mood, choiceKey);

  const bubble: BubbleContent | null = selectBubble({ snapshot, ended, cue, greeting, now, platform }).content;
  const mood: LeafyMood = choice.mood;
  return { mood, moodKey, onSettle, bubble };
}
