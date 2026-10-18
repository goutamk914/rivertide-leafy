import { describe, expect, it } from 'vitest';
import type { VoiceSnapshot } from '@shared/types';
import { DEV_SCENES, DEV_SNAPSHOTS, parseDevScene, syntheticLevel } from '../../../src/renderer/island/devScenes';
import { buildIslandSpec, errorActions, ISLAND_SIZES, pillWidthFor } from '../../../src/renderer/island/sceneSpec';
import { IDLE_SNAPSHOT } from '../../../src/renderer/lib/hooks/useVoiceSnapshot';

const snap = (patch: Partial<VoiceSnapshot>): VoiceSnapshot => ({ ...IDLE_SNAPSHOT, sessionId: 's1', ...patch });
const build = (patch: Partial<VoiceSnapshot>, extra: { tool?: string | null; hovered?: boolean } = {}) =>
  buildIslandSpec({ snapshot: snap(patch), tool: extra.tool ?? null, hovered: extra.hovered ?? false });

describe('buildIslandSpec', () => {
  it('rests (null) when idle or after a quiet cancel', () => {
    expect(build({ phase: 'idle' })).toBeNull();
    expect(build({ phase: 'error', error: { code: 'cancelled', message: 'Stopped.' } })).toBeNull();
  });

  it('stretches while listening and widens for the cancel button on hover', () => {
    const resting = build({ phase: 'listening', mode: 'ask', locked: true });
    const hovered = build({ phase: 'listening', mode: 'ask' }, { hovered: true });

    expect(resting).toMatchObject({ id: 's1:listening', mode: 'stretched', view: { kind: 'listening', mode: 'ask', locked: true } });
    expect(resting?.label).toContain('locked on');
    expect(hovered!.size.width).toBeGreaterThan(resting!.size.width);
    expect(hovered!.id).toBe(resting!.id);
  });

  it('shows calm working text with the tail of the transcript', () => {
    const spec = build({ phase: 'transcribing', mode: 'dictate', transcript: 'please remind me to call the pharmacy about my refill tomorrow' });

    expect(spec?.mode).toBe('stretched');
    expect(spec?.view).toMatchObject({ kind: 'working', label: 'Writing…' });
    expect(spec?.view.kind === 'working' && spec.view.preview.startsWith('…')).toBe(true);
  });

  it('splits while acting, with the tool icon in the bubble and a pill sized to the text', () => {
    const spec = build({ phase: 'acting', detail: 'Opening Calendar' }, { tool: 'open_app' });

    expect(spec).toMatchObject({ mode: 'split', view: { kind: 'acting', detail: 'Opening Calendar', icon: 'app-window' } });
    expect(spec!.size.width).toBeGreaterThanOrEqual(180);
    expect(spec!.size.width).toBeLessThanOrEqual(320);
  });

  it('opens a large confirmation card keyed by the call', () => {
    const pending = { runId: 'r', callId: 'c9', tool: 'quit_app', title: 'Quit Spotify', summary: 'Spotify will close.' };

    const spec = build({ phase: 'confirming', pending });

    expect(spec).toMatchObject({ id: 's1:confirm:c9', mode: 'large', view: { kind: 'confirming' } });
    expect(spec!.size.height).toBeLessThanOrEqual(ISLAND_SIZES.large.height);
  });

  it('falls back to working text when confirming without a pending action', () => {
    expect(build({ phase: 'confirming' })?.view.kind).toBe('working');
  });

  it('shows short dictation as a pill and longer results as a card', () => {
    const short = build({ phase: 'done', mode: 'dictate', output: 'See you soon.', pasted: true });
    const long = build({ phase: 'done', mode: 'dictate', output: 'A much longer paragraph that will not fit in the pill at all.', pasted: true });

    expect(short).toMatchObject({ mode: 'stretched', view: { kind: 'result', heading: 'Pasted', layout: 'pill' } });
    expect(long).toMatchObject({ mode: 'large', view: { kind: 'result', layout: 'card' } });
  });

  it('says how to paste when automatic paste failed', () => {
    const spec = build({ phase: 'done', mode: 'ask', output: 'Ten.', pasted: false });

    expect(spec).toMatchObject({ mode: 'large', view: { kind: 'result', ok: false, heading: 'Copied — press ⌘V to paste' } });
  });

  it('labels a pasted answer', () => {
    expect(build({ phase: 'done', mode: 'ask', output: 'Ten.', pasted: true })?.view).toMatchObject({ heading: 'Answer pasted' });
  });

  it('shows command replies, capped at four lines', () => {
    const spec = build({ phase: 'done', mode: 'command', output: 'word '.repeat(200) });

    expect(spec).toMatchObject({ mode: 'large', view: { kind: 'reply', lines: 4, speaking: false } });
    expect(spec!.size.height).toBeLessThanOrEqual(ISLAND_SIZES.large.height);
    expect(build({ phase: 'speaking', mode: 'command', output: '' })?.view).toMatchObject({ text: 'Done.', speaking: true });
  });

  it('shows short errors in the pill and settings errors as a card with a way to fix', () => {
    const pill = build({ phase: 'error', mode: 'command', error: { code: 'no-speech', message: 'I didn’t catch that.' } });
    const card = build({ phase: 'error', mode: 'dictate', error: { code: 'mic-denied', message: 'Rivertide can’t use the microphone.' } });

    expect(pill).toMatchObject({ mode: 'stretched', view: { kind: 'error', retry: true, layout: 'pill' } });
    expect(card).toMatchObject({ mode: 'large', view: { kind: 'error', settings: true, retry: false, layout: 'card' } });
  });

  it('uses a generic error sentence when main sent none', () => {
    expect(build({ phase: 'error' })?.view).toMatchObject({ kind: 'error', message: 'Something went wrong. Try again.' });
  });
});

describe('errorActions and pillWidthFor', () => {
  it('only retries hands-free commands and never retries a failed paste', () => {
    expect(errorActions('stt-failed', 'command')).toEqual({ retry: true, settings: false });
    expect(errorActions('stt-failed', 'dictate')).toEqual({ retry: false, settings: false });
    expect(errorActions('paste-failed', 'command')).toEqual({ retry: false, settings: false });
    expect(errorActions('llm-not-configured', 'command')).toEqual({ retry: false, settings: true });
  });

  it('sizes a pill to its text within bounds', () => {
    expect(pillWidthFor('', 64, 180, 320)).toBe(180);
    expect(pillWidthFor('x'.repeat(200), 64, 180, 320)).toBe(320);
    expect(pillWidthFor('Opening Calendar', 64, 180, 320)).toBe(Math.round(64 + 16 * 7.4));
  });
});

describe('dev scenes', () => {
  it('parses known scene names only', () => {
    expect(parseDevScene('?scene=acting')).toBe('acting');
    expect(parseDevScene('?scene=nope')).toBeNull();
    expect(parseDevScene('')).toBeNull();
  });

  it('gives every fixture except idle a scene', () => {
    for (const name of DEV_SCENES) {
      const spec = buildIslandSpec({ snapshot: DEV_SNAPSHOTS[name], tool: null, hovered: false });
      expect(spec === null).toBe(name === 'idle');
    }
  });

  it('keeps the synthetic level within 0..1', () => {
    for (let ms = 0; ms < 20_000; ms += 37) {
      const level = syntheticLevel(ms);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});
