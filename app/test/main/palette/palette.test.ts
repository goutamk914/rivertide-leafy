import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION_CACHE_SIZE, mergeCandidates } from '../../../src/main/palette';
import { askAndWebCandidates, formatDue, shortHash, type Candidate } from '../../../src/main/palette/providers';
import { fuzzyQuality, looksLikeRequest, matchQuality, usageBoost } from '../../../src/main/palette/scoring';
import { createFakeContext } from '../data/fake-context';

const APPS = [
  { name: 'Calendar', path: '/System/Applications/Calendar.app', bundleId: 'com.apple.iCal' },
  { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app', bundleId: 'com.microsoft.VSCode' },
];

afterEach(() => {
  vi.useRealTimers();
});

describe('palette scoring', () => {
  it('orders match quality: exact > prefix > word-start > initials > substring > fuzzy', () => {
    const exact = matchQuality('calendar', 'Calendar');
    const prefix = matchQuality('cal', 'Calendar');
    const wordStart = matchQuality('studio', 'Visual Studio Code');
    const initials = matchQuality('vsc', 'Visual Studio Code');
    const substring = matchQuality('lend', 'Calendar');
    const fuzzy = matchQuality('cldr', 'Calendar');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(initials);
    expect(initials).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
    expect(matchQuality('zzz', 'Calendar')).toBe(0);
    expect(matchQuality('', 'Calendar')).toBe(0);
    expect(matchQuality('vis cod', 'Visual Studio Code')).toBe(0.7);
    expect(fuzzyQuality('c', 'calendar')).toBe(0);
  });

  it('detects questions and commands', () => {
    expect(looksLikeRequest('what time is my scan')).toBe(true);
    expect(looksLikeRequest('open spotify')).toBe(true);
    expect(looksLikeRequest('pharmacy hours?')).toBe(true);
    expect(looksLikeRequest('open')).toBe(false);
    expect(looksLikeRequest('calendar')).toBe(false);
  });

  it('boosts frequently and recently picked results', () => {
    const now = Date.parse('2026-10-15T12:00:00.000Z');
    const recent = usageBoost({ count: 3, lastAt: new Date(now).toISOString() }, now);
    const old = usageBoost({ count: 3, lastAt: new Date(now - 30 * 86_400_000).toISOString() }, now);
    expect(recent).toBeGreaterThan(old);
    expect(usageBoost({ count: 100, lastAt: '2000-01-01T00:00:00.000Z' }, now)).toBeCloseTo(0.3);
    expect(usageBoost(undefined, now)).toBe(0);
  });

  it('dedupes candidates by id, keeping the best score', () => {
    const make = (id: string, score: number): Candidate => ({ result: { id, kind: 'note', title: id, subtitle: null, icon: null }, action: { type: 'route', route: '/notes' }, score });
    const merged = mergeCandidates([[make('a', 0.2), make('b', 0.5)], [make('a', 0.9)]], {}, Date.now(), 10);
    expect(merged.map((c) => [c.result.id, c.score])).toEqual([['a', 0.9], ['b', 0.5]]);
  });

  it('ranks Ask Leafy first only for requests and always offers a web search', () => {
    const [ask, web] = askAndWebCandidates('what is neutropenia?');
    expect(ask.score).toBeGreaterThan(5);
    expect(web.result.title).toBe('Search the web for “what is neutropenia?”');
    expect(askAndWebCandidates('calendar')[0].score).toBeLessThan(1);
    expect(askAndWebCandidates('   ')).toEqual([]);
  });

  it('formats due times in plain words', () => {
    const now = new Date(2026, 9, 15, 9, 0).getTime();
    expect(formatDue(new Date(2026, 9, 15, 15, 0).toISOString(), now)).toMatch(/^Today at /);
    expect(formatDue(new Date(2026, 9, 16, 9, 0).toISOString(), now)).toMatch(/^Tomorrow at /);
    expect(formatDue(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toMatch(/ at /);
  });
});

describe('palette search', () => {
  it('merges apps, commands, memory, files, ask and web, best first', async () => {
    // Arrange
    const { ctx, os } = createFakeContext();
    os.apps.search.mockReturnValue(APPS.slice(0, 1));
    os.files.search.mockResolvedValue([
      { path: '/Users/me/Documents/Calendar notes.txt', name: 'Calendar notes.txt', kind: 'file', modifiedAt: null },
      { path: '/System/Applications/Calendar.app', name: 'Calendar.app', kind: 'app', modifiedAt: null },
    ]);
    ctx.notes.upsert({ title: 'Calendar of infusions', body: 'Every other Monday' });

    // Act
    const results = await ctx.palette.search('calendar', 10);

    // Assert
    expect(results[0]).toMatchObject({ kind: 'app', title: 'Calendar', icon: 'data:image/png;base64,AAAA' });
    const kinds = results.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['app', 'file', 'note', 'ask', 'web']));
    expect(results.filter((r) => r.kind === 'file')).toHaveLength(1);
    expect(results[results.length - 1].kind).toBe('web');
    expect(results.every((r) => r.id.length <= 64)).toBe(true);
  });

  it('puts Ask Leafy first for questions and skips files for one-letter queries', async () => {
    const { ctx, os } = createFakeContext();
    const question = await ctx.palette.search('when is my next scan?', 5);
    await ctx.palette.search('c', 5);
    expect(question[0]).toMatchObject({ kind: 'ask', title: 'Ask Leafy: when is my next scan?' });
    expect(os.files.search).toHaveBeenCalledTimes(1);
  });

  it('runs the exact built-in command instead of asking Leafy for "open settings"', async () => {
    const { ctx } = createFakeContext();
    const results = await ctx.palette.search('open settings', 5);
    const spotify = await ctx.palette.search('open spotify', 5);
    expect(results[0]).toMatchObject({ id: 'cmd:open-settings' });
    expect(results.some((r) => r.kind === 'ask')).toBe(true);
    expect(spotify[0].kind).toBe('ask');
  });

  it('shows commands and upcoming reminders for an empty query', async () => {
    const { ctx } = createFakeContext();
    ctx.reminders.create({ kind: 'reminder', text: 'Take temperature', inMinutes: 30 });
    const results = await ctx.palette.search('', 30);
    expect(results.some((r) => r.id === 'cmd:dictate')).toBe(true);
    expect(results.some((r) => r.kind === 'reminder' && r.title === 'Take temperature')).toBe(true);
    expect(results.some((r) => r.kind === 'ask')).toBe(false);
  });

  it('only offers the applicable Leafy and clap toggles', async () => {
    const { ctx } = createFakeContext({ settings: { leafy: { visible: false }, clap: { enabled: true } } });
    const ids = (await ctx.palette.search('', 30)).map((r) => r.id);
    expect(ids).toContain('cmd:leafy-show');
    expect(ids).not.toContain('cmd:leafy-hide');
    expect(ids).toContain('cmd:clap-off');
    expect(ids).not.toContain('cmd:clap-on');
  });

  it('keeps answering when a provider fails or is too slow', async () => {
    // Arrange
    vi.useFakeTimers();
    const { ctx, os, logger } = createFakeContext();
    os.apps.search.mockImplementation(() => { throw new Error('index broken'); });
    os.files.search.mockImplementation(() => new Promise(() => undefined));

    // Act
    const pending = ctx.palette.search('settings', 10);
    await vi.advanceTimersByTimeAsync(800);
    const results = await pending;

    // Assert
    expect(results[0]).toMatchObject({ id: 'cmd:open-settings' });
    expect(logger.calls.warn.some((call) => String(call[0]).includes('provider failed'))).toBe(true);
    expect(logger.calls.debug.some((call) => String(call[0]).includes('ran out of time'))).toBe(true);
  });
});

describe('palette execute', () => {
  it('rejects ids it did not hand out', async () => {
    const { ctx, windows } = createFakeContext();
    const result = await ctx.palette.execute('app:../../evil', false);
    expect(result).toEqual({ ok: false, message: 'That result is no longer available. Please search again.' });
    expect(windows.palette.hide).not.toHaveBeenCalled();
  });

  it('opens apps, opens or reveals files, and hides the palette', async () => {
    // Arrange
    const { ctx, os, windows } = createFakeContext();
    os.apps.search.mockReturnValue(APPS);
    os.files.search.mockResolvedValue([{ path: '/Users/me/scan.pdf', name: 'scan.pdf', kind: 'file', modifiedAt: null }]);
    const results = await ctx.palette.search('scan', 20);
    const appId = `app:${shortHash(APPS[0].path)}`;
    await ctx.palette.search('calendar', 20);
    const file = results.find((r) => r.kind === 'file');

    // Act
    await ctx.palette.execute(appId, false);
    await ctx.palette.execute(file?.id ?? '', false);
    await ctx.palette.execute(file?.id ?? '', true);

    // Assert
    expect(os.apps.open).toHaveBeenCalledWith(APPS[0]);
    expect(os.files.open).toHaveBeenCalledWith('/Users/me/scan.pdf');
    expect(os.files.reveal).toHaveBeenCalledWith('/Users/me/scan.pdf');
    expect(windows.palette.hide).toHaveBeenCalledTimes(3);
  });

  it('asks Leafy without hiding, searches the web, and opens memory items in the dashboard', async () => {
    // Arrange
    const { ctx, agent, os, windows } = createFakeContext();
    const note = ctx.notes.upsert({ title: 'Insurance claim', body: 'Policy 123' });
    const results = await ctx.palette.search('insurance claim', 20);
    const id = (kind: string) => results.find((r) => r.kind === kind)?.id ?? '';

    // Act
    await ctx.palette.execute(id('ask'), false);
    const hidesAfterAsk = windows.palette.hide.mock.calls.length;
    await ctx.palette.execute(id('web'), false);
    await ctx.palette.execute(id('note'), false);

    // Assert
    expect(agent.ask).toHaveBeenCalledWith('insurance claim', 'palette');
    expect(hidesAfterAsk).toBe(0);
    expect(os.webSearch).toHaveBeenCalledWith('insurance claim');
    expect(windows.dashboard.show).toHaveBeenCalledWith(`/notes/${note.id}`);
  });

  it('runs commands: voice hands off after hiding, timers confirm through Leafy', async () => {
    // Arrange
    const { ctx, voice, windows, of } = createFakeContext();
    await ctx.palette.search('', 30);

    // Act
    const dictate = await ctx.palette.execute('cmd:dictate', false);
    const timer = await ctx.palette.execute('cmd:timer-5', false);
    const route = await ctx.palette.execute('cmd:open-insights', false);

    // Assert
    expect(dictate.ok).toBe(true);
    expect(voice.start).toHaveBeenCalledWith('dictate', 'palette');
    expect(windows.palette.hide.mock.invocationCallOrder[0]).toBeLessThan(voice.start.mock.invocationCallOrder[0]);
    expect(timer).toEqual({ ok: true, message: 'Timer set for 5 minutes.' });
    expect(ctx.reminders.list()[0]).toMatchObject({ kind: 'timer', text: '5-minute timer' });
    expect(of('leafy:cue')).toContainEqual(expect.objectContaining({ say: 'Timer set for 5 minutes.' }));
    expect(route.ok).toBe(true);
    expect(windows.dashboard.show).toHaveBeenCalledWith('/insights');
  });

  it('toggles Leafy and clap detection through settings', async () => {
    const { ctx, settingsService, windows } = createFakeContext();
    await ctx.palette.search('', 30);
    await ctx.palette.execute('cmd:leafy-hide', false);
    await ctx.palette.execute('cmd:clap-on', false);
    expect(settingsService.update).toHaveBeenCalledWith({ leafy: { visible: false } });
    expect(settingsService.update).toHaveBeenCalledWith({ clap: { enabled: true } });
    expect(windows.leafy.hide).toHaveBeenCalled();
  });

  it('reports a friendly failure when the action throws', async () => {
    const { ctx, os, logger } = createFakeContext();
    os.apps.search.mockReturnValue(APPS.slice(0, 1));
    os.apps.open.mockRejectedValueOnce(new Error('LSOpen failed'));
    const [app] = await ctx.palette.search('calendar', 1);
    await expect(ctx.palette.execute(app.id, false)).resolves.toEqual({ ok: false, message: "Leafy couldn't do that just now. Please try again." });
    expect(logger.calls.error.length).toBe(1);
  });

  it('remembers picks so they rank higher next time, and caches at most 200 actions', async () => {
    // Arrange
    const { ctx, os } = createFakeContext();
    os.apps.search.mockReturnValue(APPS);
    const before = await ctx.palette.search('code', 10);
    const vscode = before.find((r) => r.title === 'Visual Studio Code');

    // Act
    await ctx.palette.execute(vscode?.id ?? '', false);
    const after = await ctx.palette.search('code', 10);
    for (let i = 0; i < 30; i += 1) {
      os.apps.search.mockReturnValue(Array.from({ length: 6 }, (_, j) => ({ name: `App ${i}-${j}`, path: `/A/${i}-${j}.app`, bundleId: null })));
      await ctx.palette.search(`app ${i}`, 12);
    }
    const stale = await ctx.palette.execute(vscode?.id ?? '', false);

    // Assert
    expect(after.find((r) => r.id === vscode?.id)?.score).toBeGreaterThan(vscode?.score ?? 0);
    expect(ACTION_CACHE_SIZE).toBe(200);
    expect(stale.ok).toBe(false);
  });
});
