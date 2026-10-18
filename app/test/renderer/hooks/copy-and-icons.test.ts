import { describe, expect, it } from 'vitest';
import type { VoiceSnapshot } from '@shared/types';
import { isIconName, kindIconName, normalizeIconName, toolActivity, toolIconName } from '../../../src/renderer/lib/hooks/iconNames';
import { IDLE_SNAPSHOT } from '../../../src/renderer/lib/hooks/useVoiceSnapshot';
import { isBusyPhase, phaseStatus, workingLabel } from '../../../src/renderer/lib/hooks/voiceCopy';

const snap = (patch: Partial<VoiceSnapshot>): VoiceSnapshot => ({ ...IDLE_SNAPSHOT, sessionId: 's1', ...patch });

describe('phaseStatus', () => {
  it.each([
    [snap({ phase: 'idle' }), null],
    [snap({ phase: 'listening' }), 'Listening'],
    [snap({ phase: 'listening', locked: true }), 'Listening · locked on'],
    [snap({ phase: 'transcribing' }), 'Writing it down'],
    [snap({ phase: 'thinking', mode: 'dictate' }), 'Tidying up'],
    [snap({ phase: 'thinking', mode: 'ask' }), 'Thinking'],
    [snap({ phase: 'acting', detail: 'Opening Calendar' }), 'Opening Calendar'],
    [snap({ phase: 'acting' }), 'Working on it'],
    [snap({ phase: 'confirming' }), 'Waiting for your yes'],
    [snap({ phase: 'speaking' }), 'Speaking'],
    [snap({ phase: 'done', mode: 'command' }), 'Done'],
    [snap({ phase: 'done', mode: 'dictate', pasted: true }), 'Pasted'],
    [snap({ phase: 'done', mode: 'ask', pasted: false }), 'Copied — press ⌘V to paste'],
    [snap({ phase: 'error', error: { code: 'cancelled', message: 'x' } }), 'Stopped'],
    [snap({ phase: 'error', error: { code: 'stt-failed', message: 'x' } }), 'That didn’t work'],
  ])('describes %#', (snapshot, expected) => {
    expect(phaseStatus(snapshot)).toBe(expected);
  });

  it('uses the platform paste shortcut', () => {
    expect(phaseStatus(snap({ phase: 'done', mode: 'dictate', pasted: false }), 'win32')).toBe('Copied — press Ctrl+V to paste');
  });
});

describe('workingLabel and isBusyPhase', () => {
  it('labels transcription and thinking calmly', () => {
    expect(workingLabel(snap({ phase: 'transcribing', mode: 'command' }))).toBe('Writing…');
    expect(workingLabel(snap({ phase: 'thinking', mode: 'dictate' }))).toBe('Tidying up…');
    expect(workingLabel(snap({ phase: 'thinking', mode: 'command' }))).toBe('Thinking…');
  });

  it('treats in-flight phases as busy, but not listening, idle or results', () => {
    expect(['transcribing', 'thinking', 'acting', 'confirming', 'speaking'].every((p) => isBusyPhase(p as VoiceSnapshot['phase']))).toBe(true);
    expect(['idle', 'listening', 'done', 'error'].some((p) => isBusyPhase(p as VoiceSnapshot['phase']))).toBe(false);
  });
});

describe('icon names', () => {
  it('normalises lucide names from several spellings', () => {
    expect(normalizeIconName('icon:file-text')).toBe('file-text');
    expect(normalizeIconName('icon:FileText')).toBe('file-text');
    expect(normalizeIconName('Volume2')).toBe('volume-2');
    expect(normalizeIconName('clipboard_copy')).toBe('clipboard-copy');
    expect(normalizeIconName('icon:not-a-real-icon')).toBeNull();
    expect(isIconName('leaf')).toBe(true);
  });

  it('maps known tools to icons and guesses from the status line otherwise', () => {
    expect(toolIconName('set_timer')).toBe('timer');
    expect(toolIconName('open_app', 'Opening Calendar')).toBe('app-window');
    expect(toolIconName(null, 'Setting a timer')).toBe('timer');
    expect(toolIconName('mystery_tool', 'Searching your files')).toBe('search');
    expect(toolIconName(null, null)).toBe('sparkles');
  });

  it('says whether a tool reads or acts', () => {
    expect(toolActivity('search_files')).toBe('searching');
    expect(toolActivity('get_weather')).toBe('searching');
    expect(toolActivity('open_app')).toBe('working');
    expect(toolActivity(null)).toBe('working');
  });

  it('has an icon for every search kind', () => {
    expect(kindIconName('app')).toBe('app-window');
    expect(kindIconName('ask')).toBe('leaf');
    expect(kindIconName('setting')).toBe('settings');
  });
});
