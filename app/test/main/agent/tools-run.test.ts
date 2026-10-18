import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAppTool, quitAppTool } from '../../../src/main/agent/tools/apps';
import { copyToClipboardTool, readClipboardTool, TYPE_TEXT_MAX_CHARS, typeTextTool } from '../../../src/main/agent/tools/clipboard';
import { openFileTool, revealFileTool, searchFilesTool } from '../../../src/main/agent/tools/files';
import {
  createNoteTool, recallFactsTool, rememberFactTool, searchDocumentsTool, searchHistoryTool, searchNotesTool,
} from '../../../src/main/agent/tools/memory';
import { cancelReminderTool, listRemindersTool } from '../../../src/main/agent/tools/reminders';
import { DICTATION_START_DELAY_MS, openRivertideTool, startDictationTool } from '../../../src/main/agent/tools/rivertide';
import { listShortcutsTool, runShortcutTool } from '../../../src/main/agent/tools/shortcuts';
import {
  lockScreenTool, openSystemSettingsTool, setDarkModeTool, sleepDisplayTool, takeScreenshotTool,
} from '../../../src/main/agent/tools/system';
import type { ToolContext } from '../../../src/main/agent/tools/types';
import { composeEmailTool, openUrlTool, webSearchTool } from '../../../src/main/agent/tools/web';
import { OsActionError } from '../../../src/main/os/errors';
import type { OsExtras } from '../../../src/main/os/extras';
import type { Fact } from '../../../src/shared/types';
import { createFakeContext, type FakeContextOptions } from './fake-context';

const NOW = new Date(2026, 9, 15, 14, 3, 0);

function contextFor(extras: Partial<OsExtras> | null = {}, options: FakeContextOptions = {}) {
  const fake = createFakeContext(options);
  const remember = vi.fn();
  const context: ToolContext = { app: fake.ctx, os: extras as OsExtras | null, now: () => NOW, signal: new AbortController().signal, source: 'voice', remember };
  return { fake, context, remember };
}

afterEach(() => vi.useRealTimers());

describe('app tools', () => {
  it('opens a known app and suggests close matches for unknown ones', async () => {
    const { context, fake, remember } = contextFor();
    expect(await openAppTool.run({ name: 'Calendar' }, context)).toMatchObject({ ok: true, summary: 'Opened Calendar.' });
    expect(fake.os.opened).toEqual(['Calendar']);
    expect(await openAppTool.run({ name: 'Note' }, context)).toMatchObject({ ok: false, summary: 'I couldn’t find an app called Note. Did you mean Notes?' });
    expect(remember).toHaveBeenCalledWith({ kind: 'apps', items: [{ name: 'Notes', path: '/System/Applications/Notes.app' }] });
    expect((await openAppTool.run({ name: 'Zzz' }, context)).summary).toBe('I couldn’t find an app called Zzz on this computer.');
  });

  it('reports open failures with the OS message', async () => {
    const { context } = contextFor({}, { os: { apps: { ...createFakeContext().os.apps, open: async () => { throw new OsActionError('I couldn’t open Calendar.'); } } } });
    expect(await openAppTool.run({ name: 'Calendar' }, context)).toEqual({ ok: false, summary: 'I couldn’t open Calendar.' });
  });

  it('quits through the OS extras', async () => {
    const quitApp = vi.fn(async () => undefined);
    const { context } = contextFor({ quitApp });
    expect(await quitAppTool.run({ name: 'Spotify' }, context)).toMatchObject({ ok: true, summary: 'Quit Spotify.' });
    expect(quitAppTool.confirmText?.({ name: 'Spotify' })).toMatch(/^Quit Spotify\?/);
    expect((await quitAppTool.run({ name: 'Spotify' }, contextFor(null).context)).ok).toBe(false);
  });
});

describe('clipboard and typing tools', () => {
  it('copies, reads and types', async () => {
    const { context, fake } = contextFor({ readClipboard: async () => '  hello  ' });
    expect((await copyToClipboardTool.run({ text: 'x' }, context)).summary).toBe('Copied to the clipboard.');
    expect(fake.os.copied).toEqual(['x']);
    expect(await readClipboardTool.run({}, context)).toEqual({ ok: true, summary: 'Here’s what’s on the clipboard.', data: { text: 'hello' } });
    expect((await typeTextTool.run({ text: 'hi' }, context)).summary).toBe('Typed it.');
    expect(typeTextTool.confirmText?.({ text: 'hi' })).toBe('Type this where your cursor is? “hi”');
  });

  it('previews everything type_text will type', () => {
    const long = 'x'.repeat(TYPE_TEXT_MAX_CHARS);
    expect(typeTextTool.confirmText?.({ text: long })).toContain(long);
    expect(typeTextTool.schema.safeParse({ text: `${long}y` }).success).toBe(false);
  });

  it('handles an empty clipboard and a failed typing attempt', async () => {
    expect((await readClipboardTool.run({}, contextFor({ readClipboard: async () => '' }).context)).summary).toBe('The clipboard is empty.');
    const { context } = contextFor({}, { os: { typeText: async () => false } });
    expect((await typeTextTool.run({ text: 'hi' }, context)).ok).toBe(false);
  });
});

describe('file tools', () => {
  it('remembers search results for follow-ups', async () => {
    const hits = [{ path: '/Users/me/a.pdf', name: 'a.pdf', kind: 'pdf', modifiedAt: null }];
    const { context, remember } = contextFor({}, { os: { files: { search: async () => hits, open: vi.fn(), reveal: vi.fn() } } });
    const outcome = await searchFilesTool.run({ query: 'a' }, context);
    expect(outcome.summary).toBe('I found 1 file. The best match is a.pdf.');
    expect(remember).toHaveBeenCalledWith({ kind: 'files', items: hits });
    expect((await searchFilesTool.run({ query: 'zzz' }, contextFor().context)).summary).toBe('I couldn’t find any files matching “zzz”.');
  });

  it('opens and reveals checked paths only', async () => {
    const { context } = contextFor();
    expect((await openFileTool.run({ path: 'relative.pdf' }, context)).ok).toBe(false);
    expect((await revealFileTool.run({ path: '/etc/hosts' }, context)).ok).toBe(false);
    expect(openFileTool.title({ path: '/a/b/c.pdf' })).toBe('Open c.pdf');
  });
});

describe('memory tools', () => {
  const fact: Fact = { id: 'f', category: 'care-team', label: 'Oncologist', value: 'Dr. Okafor', source: 'manual', sourceRef: null, pinned: false, createdAt: '', updatedAt: '' };

  it('creates notes and remembers facts', async () => {
    const { context, fake } = contextFor();
    expect((await createNoteTool.run({ body: 'Buy ginger tea for the nausea' }, context)).summary).toBe('Saved a note: Buy ginger tea for the nausea.');
    expect(fake.notes[0].title).toBe('Buy ginger tea for the nausea');
    expect((await rememberFactTool.run({ category: 'care-team', label: 'Oncologist', value: 'Dr. Okafor' }, context)).summary).toBe('Got it — I’ll remember that.');
  });

  it('searches notes, facts, documents and history', async () => {
    const { context, fake } = contextFor({}, {
      services: {
        knowledge: { relevant: () => [fact] },
        search: { search: () => [{ kind: 'document', id: 'd', title: 'Care plan', snippet: 'Cycle 3 starts…', score: 1 }] },
      },
    });
    fake.notes.push({ id: 'n', title: 'Port flush', body: 'Ask about it', pinned: false, source: 'manual', createdAt: '', updatedAt: '' });
    fake.history.push({ id: 'h', createdAt: '', mode: 'dictate', source: 'fn', status: 'ok', raw: 'chemo on friday', output: 'Chemo on Friday.', words: 3, durationMs: 1, app: null, pasted: true, error: null, timings: { sttMs: 1, llmMs: 1, totalMs: 1 }, providers: { stt: null, llm: null }, actions: [], audioPath: null });

    expect((await searchNotesTool.run({ query: 'port' }, context)).summary).toBe('I found 1 note. The first is “Port flush”.');
    expect((await recallFactsTool.run({ query: 'doctor' }, context)).data).toEqual({ facts: [{ category: 'care-team', label: 'Oncologist', value: 'Dr. Okafor' }] });
    expect((await searchDocumentsTool.run({ query: 'cycle' }, context)).summary).toBe('I found 1 match in your documents. The best is in “Care plan”.');
    expect((await searchHistoryTool.run({ query: 'chemo' }, context)).summary).toBe('I found 1 match in your history.');
  });

  it('says plainly when nothing is found', async () => {
    const { context } = contextFor();
    expect((await searchNotesTool.run({ query: 'x' }, context)).summary).toBe('I didn’t find any notes about “x”.');
    expect((await recallFactsTool.run({ query: 'x' }, context)).summary).toBe('I don’t have anything saved about that yet.');
    expect((await searchDocumentsTool.run({ query: 'x' }, context)).summary).toBe('I didn’t find anything about “x” in your documents.');
    expect((await searchHistoryTool.run({ query: 'x' }, context)).summary).toBe('I didn’t find “x” in your history.');
  });
});

describe('reminder tools', () => {
  it('lists upcoming reminders and cancels by id', async () => {
    const { context, fake } = contextFor();
    fake.reminders.push({ id: 'r1', kind: 'reminder', text: 'take pills', dueAt: new Date(2026, 9, 15, 20, 0).toISOString(), repeat: 'none', status: 'scheduled', createdAt: '', firedAt: null });
    expect((await listRemindersTool.run({}, context)).summary).toMatch(/^You have 1 reminder: take pills at /);
    expect(await cancelReminderTool.run({ id: 'r1' }, context)).toEqual({ ok: true, summary: 'Cancelled the reminder to take pills.' });
    expect((await cancelReminderTool.run({ id: 'nope' }, context)).ok).toBe(false);
  });
});

describe('system tools', () => {
  const system = {
    lockScreen: vi.fn(async () => undefined), sleepDisplay: vi.fn(async () => undefined), setDarkMode: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => '/Users/me/Desktop/shot.png'), openSettings: vi.fn(async () => undefined),
  };

  it('locks, sleeps, switches appearance, screenshots and opens settings', async () => {
    const { context, remember } = contextFor({ system: system as unknown as OsExtras['system'] });
    expect((await lockScreenTool.run({}, context)).summary).toBe('Locked.');
    expect((await sleepDisplayTool.run({}, context)).summary).toBe('Turning the display off.');
    expect((await setDarkModeTool.run({ on: false }, context)).summary).toBe('Light mode is on.');
    expect((await takeScreenshotTool.run({}, context)).summary).toBe('Saved a screenshot to your Desktop.');
    expect(remember).toHaveBeenCalledWith({ kind: 'files', items: [expect.objectContaining({ name: 'shot.png' })] });
    expect((await openSystemSettingsTool.run({ pane: 'sound' }, context)).summary).toBe('Opened sound settings.');
    expect(system.openSettings).toHaveBeenCalledWith('sound');
  });

  it('turns OS errors into their friendly messages', async () => {
    const { context } = contextFor({ system: { lockScreen: async () => { throw new OsActionError('Rivertide needs permission.'); } } as unknown as OsExtras['system'] });
    expect(await lockScreenTool.run({}, context)).toEqual({ ok: false, summary: 'Rivertide needs permission.' });
  });
});

describe('shortcut, Rivertide and web tools', () => {
  it('lists and runs Shortcuts', async () => {
    const shortcuts = { list: async () => ['Morning Meds'], run: async () => ({ name: 'Morning Meds', output: 'ok' }) };
    const { context } = contextFor({ shortcuts });
    expect((await listShortcutsTool.run({}, context)).summary).toBe('You have 1 shortcut.');
    expect(await runShortcutTool.run({ name: 'morning meds' }, context)).toEqual({ ok: true, summary: 'Ran “Morning Meds”.', data: { output: 'ok' } });
    expect((await runShortcutTool.run({ name: 'x' }, contextFor(null).context)).ok).toBe(false);
  });

  it('opens dashboard pages and starts dictation after a short pause', async () => {
    vi.useFakeTimers();
    const { context, fake } = contextFor();
    expect((await openRivertideTool.run({ page: 'history' }, context)).summary).toBe('Opened your history.');
    expect(fake.ctx.windows.dashboard.show).toHaveBeenCalledWith('/history');
    await startDictationTool.run({}, context);
    expect(fake.ctx.voice.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DICTATION_START_DELAY_MS);
    expect(fake.ctx.voice.start).toHaveBeenCalledWith('dictate', 'leafy');
  });

  it('opens links, searches and drafts emails', async () => {
    const { context, fake } = contextFor();
    expect((await openUrlTool.run({ url: 'https://www.codethecure.org/about' }, context)).summary).toBe('Opened codethecure.org.');
    expect((await webSearchTool.run({ query: 'ginger tea' }, context)).summary).toBe('Here are web results for ginger tea.');
    expect((await composeEmailTool.run({ to: 'a@b.org', subject: 'Hi' }, context)).summary).toBe('I opened a new email. It won’t send until you press Send.');
    expect(fake.os.opened).toEqual(['https://www.codethecure.org/about', 'search:ginger tea', 'mailto:a@b.org?subject=Hi']);
    expect(openUrlTool.schema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(openUrlTool.schema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
  });
});
