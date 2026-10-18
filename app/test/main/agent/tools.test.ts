import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { availableTools, createAllTools, toToolSpecs } from '../../../src/main/agent/tools';
import { checkPath } from '../../../src/main/agent/tools/files';
import { titleFromBody } from '../../../src/main/agent/tools/memory';
import { createReminderTool, describeMinutes, describeWhen, listRemindersTool, setTimerTool } from '../../../src/main/agent/tools/reminders';
import { toProviderSchema } from '../../../src/main/agent/tools/schema';
import { getSystemStatusTool, mediaControlTool, setVolumeTool } from '../../../src/main/agent/tools/system';
import type { ToolContext } from '../../../src/main/agent/tools/types';
import { createWeatherTool, defaultUnits, describeWeatherCode } from '../../../src/main/agent/tools/weather';
import { mailtoUrl } from '../../../src/main/agent/tools/web';
import type { OsExtras } from '../../../src/main/os/extras';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings';
import { createFakeContext } from './fake-context';

const NOW = new Date(2026, 9, 15, 14, 3, 0);

function toolContext(os: Partial<OsExtras> | null = null): { context: ToolContext; fake: ReturnType<typeof createFakeContext> } {
  const fake = createFakeContext();
  return {
    fake,
    context: { app: fake.ctx, os: os as OsExtras | null, now: () => NOW, signal: new AbortController().signal, source: 'voice', remember: vi.fn() },
  };
}

describe('tool registry', () => {
  it('has the full tool set with unique names', () => {
    const names = createAllTools().map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['open_app', 'quit_app', 'get_weather', 'compose_email', 'run_shortcut', 'open_rivertide']));
    expect(names).toHaveLength(34);
  });

  it('hides network tools when they are turned off and tools the user blocked', () => {
    const settings = { ...DEFAULT_SETTINGS, agent: { allowNetworkTools: false, toolPolicy: { type_text: 'never' as const } } };
    const names = availableTools(createAllTools(), settings).map((tool) => tool.name);
    expect(names).not.toContain('get_weather');
    expect(names).not.toContain('type_text');
  });

  it('produces strict-compatible JSON schemas', () => {
    for (const spec of toToolSpecs(createAllTools())) {
      const text = JSON.stringify(spec.inputSchema);
      expect(spec.inputSchema.type).toBe('object');
      expect(spec.inputSchema.additionalProperties).toBe(false);
      expect(text).not.toMatch(/"(minimum|maximum|minLength|maxLength|\$schema|pattern)"/);
    }
  });
});

describe('toProviderSchema', () => {
  it('strips unsupported constraints and closes nested objects', () => {
    const schema = z.object({ name: z.string().min(1).max(5).describe('A name'), nested: z.object({ n: z.number().int().min(0) }).optional() });
    expect(toProviderSchema(schema)).toEqual({
      type: 'object',
      properties: { name: { type: 'string', description: 'A name' }, nested: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false } },
      required: ['name'],
      additionalProperties: false,
    });
  });
});

describe('file path checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'rivertide-tools-'));
  const outside = mkdtempSync(join(tmpdir(), 'rivertide-outside-'));
  writeFileSync(join(root, 'letter.pdf'), 'x');
  writeFileSync(join(root, 'evil.command'), 'x');
  writeFileSync(join(root, 'run-me'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(root, 'README'), 'plain', { mode: 0o644 });
  writeFileSync(join(outside, 'secret.txt'), 'x');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'innocent.pdf'));

  it('accepts an existing file inside the allowed roots (by its real path)', async () => {
    expect(await checkPath(join(root, 'letter.pdf'), { allowExecutables: false }, [root])).toEqual({ ok: true, path: realpathSync(join(root, 'letter.pdf')) });
  });

  it('follows symlinks and refuses targets outside the roots', async () => {
    expect(await checkPath(join(root, 'innocent.pdf'), { allowExecutables: false }, [root])).toMatchObject({ ok: false, message: expect.stringMatching(/home folder/) });
  });

  it('refuses extensionless executables but allows plain extensionless files', async () => {
    expect((await checkPath(join(root, 'run-me'), { allowExecutables: false }, [root])).ok).toBe(false);
    expect((await checkPath(join(root, 'README'), { allowExecutables: false }, [root])).ok).toBe(true);
  });

  it.each([
    ['relative paths', 'letter.pdf'],
    ['paths outside the roots', '/etc/hosts'],
    ['traversal', `${root}/../../etc/hosts`],
  ])('refuses %s', async (_label, path) => {
    expect((await checkPath(path, { allowExecutables: false }, [root])).ok).toBe(false);
  });

  it('refuses to open programs but allows revealing them', async () => {
    expect((await checkPath(join(root, 'evil.command'), { allowExecutables: false }, [root])).ok).toBe(false);
    expect((await checkPath(join(root, 'evil.command'), { allowExecutables: true }, [root])).ok).toBe(true);
  });

  it('reports missing files', async () => {
    expect(await checkPath(join(root, 'gone.pdf'), { allowExecutables: false }, [root])).toMatchObject({ ok: false, message: expect.stringMatching(/couldn’t find/) });
  });
});

describe('reminder tools', () => {
  it.each([[0.5, '30 seconds'], [1, '1 minute'], [10, '10 minutes'], [60, '1 hour'], [90, '1 hour and 30 minutes']])('describeMinutes(%d)', (minutes, text) => {
    expect(describeMinutes(minutes)).toBe(text);
  });

  it('describes when relative to today', () => {
    expect(describeWhen(new Date(2026, 9, 16, 9, 0), NOW)).toMatch(/^tomorrow at /);
    expect(describeWhen(new Date(2026, 9, 15, 20, 0), NOW)).toMatch(/^at /);
  });

  it('creates a timer', async () => {
    const { context, fake } = toolContext();
    const outcome = await setTimerTool.run({ minutes: 10, label: 'pasta' }, context);
    expect(outcome).toMatchObject({ ok: true, summary: 'Timer set for pasta: 10 minutes.' });
    expect(fake.reminders[0]).toMatchObject({ kind: 'timer', text: 'pasta' });
  });

  it('rejects reminders in the past or with bad times', async () => {
    const { context } = toolContext();
    expect((await createReminderTool.run({ text: 'x', dueAt: '2020-01-01T00:00:00Z' }, context)).ok).toBe(false);
    expect((await createReminderTool.run({ text: 'x', dueAt: 'tomorrow-ish' }, context)).ok).toBe(false);
  });

  it('creates a reminder with a spoken confirmation', async () => {
    const { context } = toolContext();
    const outcome = await createReminderTool.run({ text: 'take my pills', dueAt: new Date(2026, 9, 15, 20, 0).toISOString() }, context);
    expect(outcome.summary).toMatch(/^I’ll remind you to take my pills at /);
  });

  it('lists upcoming reminders', async () => {
    const { context } = toolContext();
    expect((await listRemindersTool.run({}, context)).summary).toBe('You don’t have any reminders or timers coming up.');
  });
});

describe('system tools', () => {
  const system = {
    battery: async () => ({ percent: 82, charging: true, onBattery: false }),
    getVolume: async () => ({ level: 40, muted: false }),
    getDarkMode: async () => true,
    setVolume: vi.fn(async (level: number) => ({ level, muted: false })),
    changeVolume: vi.fn(async (delta: number) => ({ level: 40 + delta, muted: false })),
    setMuted: vi.fn(async () => undefined),
  };
  const media = { press: vi.fn(async () => undefined) };

  it('reports the requested status in plain sentences', async () => {
    const { context } = toolContext({ system: system as unknown as OsExtras['system'] });
    const outcome = await getSystemStatusTool.run({ fields: ['battery', 'volume', 'appearance'] }, context);
    expect(outcome.summary).toBe('Battery is at 82% and charging. Volume is at 40%. Dark mode is on.');
  });

  it('sets, steps and mutes the volume', async () => {
    const { context } = toolContext({ system: system as unknown as OsExtras['system'] });
    expect((await setVolumeTool.run({ level: 30 }, context)).summary).toBe('Volume is at 30%.');
    expect((await setVolumeTool.run({ change: 'down' }, context)).summary).toBe('Volume is at 30%.');
    expect((await setVolumeTool.run({ mute: true }, context)).summary).toBe('Muted.');
  });

  it('presses media keys', async () => {
    const { context } = toolContext({ media: media as unknown as OsExtras['media'] });
    expect((await mediaControlTool.run({ action: 'next' }, context)).summary).toBe('Skipped to the next track.');
    expect(media.press).toHaveBeenCalledWith('next');
  });

  it('fails gently when the platform extras are missing', async () => {
    const { context } = toolContext(null);
    expect(await setVolumeTool.run({ level: 30 }, context)).toEqual({ ok: false, summary: 'That isn’t available on this computer yet.' });
  });
});

describe('weather tool', () => {
  const geocode = { results: [{ name: 'Seattle', latitude: 47.6, longitude: -122.3, country: 'United States', admin1: 'Washington' }] };
  const forecast = {
    current: { temperature_2m: 54.4, weather_code: 61, wind_speed_10m: 5 },
    daily: { time: ['2026-10-15'], weather_code: [61], temperature_2m_max: [58.2], temperature_2m_min: [47.1], precipitation_probability_max: [80] },
  };

  it('geocodes, fetches the forecast and summarises it', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes('geocoding') ? geocode : forecast)));
    const { context } = toolContext();
    const outcome = await createWeatherTool(fetchImpl as unknown as typeof fetch).run({ location: 'Seattle', units: 'fahrenheit' }, context);
    expect(outcome.summary).toBe('In Seattle it’s 54°F and rainy. Today’s high is 58°, low 47°, with a 80% chance of rain.');
    expect(String(fetchImpl.mock.calls[1][0])).toContain('temperature_unit=fahrenheit');
  });

  it('rejects malformed responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [{ name: 1 }] })));
    const { context } = toolContext();
    expect((await createWeatherTool(fetchImpl as unknown as typeof fetch).run({ location: 'X' }, context)).ok).toBe(false);
  });

  it('describes codes and picks local units', () => {
    expect(describeWeatherCode(0)).toBe('clear');
    expect(describeWeatherCode(95)).toBe('stormy');
    expect(defaultUnits('en-US')).toBe('fahrenheit');
    expect(defaultUnits('en-GB')).toBe('celsius');
  });
});

describe('small helpers', () => {
  it('builds mailto links that never send', () => {
    expect(mailtoUrl({ to: 'dr.lee@clinic.org', subject: 'Next visit', body: 'Hi & thanks' })).toBe('mailto:dr.lee@clinic.org?subject=Next%20visit&body=Hi%20%26%20thanks');
    expect(mailtoUrl({})).toBe('mailto:');
  });

  it('titles notes from their first words', () => {
    expect(titleFromBody('Ask the nurse about the port flush schedule next week.')).toBe('Ask the nurse about the port');
  });
});
