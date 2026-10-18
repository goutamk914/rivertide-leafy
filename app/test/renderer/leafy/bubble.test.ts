import { describe, expect, it } from 'vitest';
import type { VoiceSnapshot } from '@shared/types';
import { BUBBLE_LINGER_MS, GREETING_MS, greetingFor, selectBubble, sessionBubble, type BubbleInput } from '../../../src/renderer/leafy/bubble';
import { IDLE_SNAPSHOT } from '../../../src/renderer/lib/hooks/useVoiceSnapshot';

const snap = (patch: Partial<VoiceSnapshot>): VoiceSnapshot => ({ ...IDLE_SNAPSHOT, sessionId: 's1', ...patch });
const input = (patch: Partial<BubbleInput>): BubbleInput => ({ snapshot: IDLE_SNAPSHOT, ended: null, cue: null, greeting: null, now: 10_000, ...patch });

describe('sessionBubble', () => {
  it('says nothing when idle or after a quiet cancel', () => {
    expect(sessionBubble(IDLE_SNAPSHOT)).toBeNull();
    expect(sessionBubble(snap({ phase: 'error', error: { code: 'cancelled', message: 'Stopped' } }))).toBeNull();
  });

  it('invites speech while listening and then shows the latest words', () => {
    expect(sessionBubble(snap({ phase: 'listening' }))).toMatchObject({ title: 'I’m listening', status: 'Listening', tone: 'live' });
    const long = 'so what I would really like is for you to open the calendar for next week please';
    expect(sessionBubble(snap({ phase: 'listening', transcript: long }))?.title.startsWith('…')).toBe(true);
  });

  it('shows the transcript with the working detail while acting', () => {
    const bubble = sessionBubble(snap({ phase: 'acting', transcript: 'open calendar', detail: 'Opening Calendar' }));

    expect(bubble).toMatchObject({ title: 'open calendar', status: 'Opening Calendar', tone: 'busy' });
  });

  it('asks for a yes with the confirmation title', () => {
    const pending = { runId: 'r', callId: 'c', tool: 'quit_app', title: 'Quit Spotify', summary: 'Spotify will close.' };

    expect(sessionBubble(snap({ phase: 'confirming', pending }))).toMatchObject({ title: 'Quit Spotify', status: 'Waiting for your yes' });
  });

  it('shows the result with pasted or copied status', () => {
    expect(sessionBubble(snap({ phase: 'done', mode: 'dictate', output: 'Hello there.', pasted: true }))).toMatchObject({
      title: 'Hello there.',
      status: 'Pasted',
      tone: 'done',
    });
    expect(sessionBubble(snap({ phase: 'done', mode: 'dictate', output: 'Hi', pasted: false }))?.status).toBe('Copied — press ⌘V to paste');
  });

  it('puts the error sentence in the title', () => {
    const bubble = sessionBubble(snap({ phase: 'error', error: { code: 'no-speech', message: 'I didn’t catch that.' } }));

    expect(bubble).toMatchObject({ title: 'I didn’t catch that.', tone: 'error' });
  });
});

describe('selectBubble', () => {
  it('lets a live session win and never expire', () => {
    const selection = selectBubble(input({ snapshot: snap({ phase: 'thinking' }), greeting: { title: 'Hi', status: null, shownAt: 9_999 } }));

    expect(selection.content?.status).toBe('Thinking');
    expect(selection.expiresAt).toBeNull();
  });

  it('lingers a finished result for a few seconds after main goes idle', () => {
    const ended = { snapshot: snap({ phase: 'done', mode: 'command', output: 'Timer set.' }), endedAt: 9_000 };

    const during = selectBubble(input({ ended, now: 9_000 + BUBBLE_LINGER_MS - 1 }));
    const after = selectBubble(input({ ended, now: 9_000 + BUBBLE_LINGER_MS }));

    expect(during.content?.title).toBe('Timer set.');
    expect(during.expiresAt).toBe(9_000 + BUBBLE_LINGER_MS);
    expect(after.content).toBeNull();
  });

  it('does not linger a session that ended without a result', () => {
    const ended = { snapshot: snap({ phase: 'listening' }), endedAt: 9_900 };

    expect(selectBubble(input({ ended })).content).toBeNull();
  });

  it('shows a cue for its hold time, and until replaced when hold is null', () => {
    const cue = { cue: { mood: 'notify' as const, say: 'Time to drink water', holdMs: 3000 }, receivedAt: 9_000, seq: 2 };

    expect(selectBubble(input({ cue })).content).toMatchObject({ key: 'cue:2', title: 'Time to drink water', tone: 'quiet' });
    expect(selectBubble(input({ cue, now: 12_000 })).content).toBeNull();
    expect(selectBubble(input({ cue: { ...cue, cue: { ...cue.cue, holdMs: null } }, now: 1e9 })).expiresAt).toBeNull();
  });

  it('ignores cues with nothing to say', () => {
    const cue = { cue: { mood: 'clap' as const, say: null, holdMs: 3000 }, receivedAt: 9_000, seq: 1 };

    expect(selectBubble(input({ cue })).content).toBeNull();
  });

  it('prefers the most recent of greeting, cue and ended session', () => {
    const greeting = { title: 'Hi Sam', status: null, shownAt: 9_500 };
    const cue = { cue: { mood: 'caring' as const, say: 'Take a breath', holdMs: 10_000 }, receivedAt: 9_000, seq: 1 };

    expect(selectBubble(input({ greeting, cue })).content?.title).toBe('Hi Sam');
    expect(selectBubble(input({ greeting, cue, now: 9_500 + GREETING_MS })).content?.title).toBe('Take a breath');
  });
});

describe('greetingFor', () => {
  it('uses the first name and the shortcut tip', () => {
    expect(greetingFor('Sam Rivera', '⇧⌘L')).toEqual({ title: 'Hi Sam', status: 'Press ⇧⌘L and tell me what you need' });
  });

  it('falls back politely without a name or tips', () => {
    expect(greetingFor('  ', null)).toEqual({ title: 'Hi there', status: 'Here when you need me' });
  });
});
