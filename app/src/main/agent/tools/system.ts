/**
 * System tools: get_system_status, set_volume, set_dark_mode, media_control, lock_screen,
 * sleep_display, take_screenshot, open_system_settings.
 */
import { basename } from 'node:path';
import { z } from 'zod';
import { humanDate, humanTime } from '../../ai/prompts/clock';
import { SETTINGS_PANES } from '../../os/system';
import type { OsExtras } from '../../os/extras';
import { defineTool, errorText, fail, ok, type ToolContext, type ToolOutcome } from './types';

const STATUS_FIELDS = ['time', 'date', 'battery', 'volume', 'appearance'] as const;
type StatusField = (typeof STATUS_FIELDS)[number];
const VOLUME_STEP = 10;
const UNAVAILABLE = 'That isn’t available on this computer yet.';

/** Runs an action that needs the OS extras, mapping failures to friendly outcomes. */
async function withExtras(context: ToolContext, fallback: string, action: (os: OsExtras) => Promise<ToolOutcome>): Promise<ToolOutcome> {
  if (!context.os) return fail(UNAVAILABLE);
  try {
    return await action(context.os);
  } catch (error) {
    return fail(errorText(error, fallback));
  }
}

async function statusPart(field: StatusField, os: OsExtras | null, now: Date): Promise<[string, unknown] | null> {
  switch (field) {
    case 'time':
      return [`It’s ${humanTime(now)}.`, humanTime(now)];
    case 'date':
      return [`Today is ${humanDate(now)}.`, humanDate(now)];
    case 'battery': {
      const battery = await os?.system.battery().catch(() => null);
      if (!battery) return ['I can’t see a battery on this computer.', null];
      return [`Battery is at ${battery.percent}%${battery.charging ? ' and charging' : ''}.`, battery];
    }
    case 'volume': {
      const volume = await os?.system.getVolume().catch(() => null);
      if (!volume) return null;
      return [volume.muted ? 'The sound is muted.' : `Volume is at ${volume.level}%.`, volume];
    }
    case 'appearance': {
      const dark = await os?.system.getDarkMode().catch(() => null);
      if (dark === null || dark === undefined) return null;
      return [dark ? 'Dark mode is on.' : 'Light mode is on.', dark ? 'dark' : 'light'];
    }
  }
}

export const getSystemStatusTool = defineTool({
  name: 'get_system_status',
  description: 'Current time, date, battery level, volume and light/dark appearance. Ask only for the fields you need.',
  risk: 'read',
  schema: z.object({ fields: z.array(z.enum(STATUS_FIELDS)).max(5).optional().describe('Which details; all when omitted.') }),
  title: () => 'Check the computer',
  async run({ fields }, context) {
    const wanted = fields && fields.length > 0 ? [...new Set(fields)] : [...STATUS_FIELDS];
    const parts = await Promise.all(wanted.map((field) => statusPart(field, context.os, context.now())));
    const found = parts.filter((part): part is [string, unknown] => part !== null);
    if (found.length === 0) return fail('I couldn’t read that from this computer.');
    return ok(found.map(([sentence]) => sentence).join(' '), Object.fromEntries(wanted.map((field, i) => [field, parts[i]?.[1] ?? null])));
  },
});

export const setVolumeTool = defineTool({
  name: 'set_volume',
  description: 'Change the output volume: an exact level (0–100), up/down a step, or mute/unmute.',
  risk: 'act',
  schema: z.object({
    level: z.number().int().min(0).max(100).optional().describe('Exact volume percent.'),
    change: z.enum(['up', 'down']).optional().describe('Step the volume up or down.'),
    mute: z.boolean().optional().describe('true to mute, false to unmute.'),
  }).refine((input) => input.level !== undefined || input.change !== undefined || input.mute !== undefined, 'Say a level, up/down, or mute.'),
  title: (input) => (input.mute === true ? 'Mute' : input.mute === false ? 'Unmute' : input.level !== undefined ? `Set volume to ${input.level}%` : `Volume ${input.change}`),
  run: (input, context) => withExtras(context, 'I couldn’t change the volume.', async (os) => {
    if (input.mute !== undefined && input.level === undefined && input.change === undefined) {
      await os.system.setMuted(input.mute);
      return ok(input.mute ? 'Muted.' : 'Unmuted.');
    }
    const state = input.level !== undefined
      ? await os.system.setVolume(input.level)
      : await os.system.changeVolume(input.change === 'down' ? -VOLUME_STEP : VOLUME_STEP);
    return ok(`Volume is at ${state.level}%.`, state);
  }),
});

export const setDarkModeTool = defineTool({
  name: 'set_dark_mode',
  description: 'Turn dark mode on (on: true) or switch to light mode (on: false).',
  risk: 'act',
  schema: z.object({ on: z.boolean() }),
  title: ({ on }) => (on ? 'Turn on dark mode' : 'Turn on light mode'),
  run: ({ on }, context) => withExtras(context, 'I couldn’t change the appearance.', async (os) => {
    await os.system.setDarkMode(on);
    return ok(on ? 'Dark mode is on.' : 'Light mode is on.');
  }),
});

const MEDIA_REPLIES = { play: 'Playing.', pause: 'Paused.', playpause: 'Done.', next: 'Skipped to the next track.', previous: 'Went back a track.' } as const;

export const mediaControlTool = defineTool({
  name: 'media_control',
  description: 'Control whatever is playing (music, podcasts, videos): play, pause, next or previous track.',
  risk: 'act',
  schema: z.object({ action: z.enum(['play', 'pause', 'playpause', 'next', 'previous']) }),
  title: ({ action }) => ({ play: 'Play', pause: 'Pause', playpause: 'Play/pause', next: 'Next track', previous: 'Previous track' })[action],
  run: ({ action }, context) => withExtras(context, 'I couldn’t control the music.', async (os) => {
    await os.media.press(action === 'next' || action === 'previous' ? action : 'playpause');
    return ok(MEDIA_REPLIES[action]);
  }),
});

export const lockScreenTool = defineTool({
  name: 'lock_screen',
  description: 'Lock the computer screen. The person is asked to confirm first.',
  risk: 'confirm',
  schema: z.object({}),
  title: () => 'Lock the screen',
  confirmText: () => 'Lock the screen now? You’ll need your password to get back in.',
  run: (_input, context) => withExtras(context, 'I couldn’t lock the screen.', async (os) => {
    await os.system.lockScreen();
    return ok('Locked.');
  }),
});

export const sleepDisplayTool = defineTool({
  name: 'sleep_display',
  description: 'Turn the display off (sleep). The person is asked to confirm first.',
  risk: 'confirm',
  schema: z.object({}),
  title: () => 'Turn off the display',
  confirmText: () => 'Turn the display off now? Move the mouse or press a key to wake it.',
  run: (_input, context) => withExtras(context, 'I couldn’t turn off the display.', async (os) => {
    await os.system.sleepDisplay();
    return ok('Turning the display off.');
  }),
});

export const takeScreenshotTool = defineTool({
  name: 'take_screenshot',
  description: 'Take a screenshot of the whole screen and save it to the Desktop.',
  risk: 'act',
  schema: z.object({}),
  title: () => 'Take a screenshot',
  run: (_input, context) => withExtras(context, 'I couldn’t take a screenshot.', async (os) => {
    const path = await os.system.screenshot(context.now());
    context.remember({ kind: 'files', items: [{ path, name: basename(path), kind: 'png', modifiedAt: context.now().toISOString() }] });
    return ok('Saved a screenshot to your Desktop.', { path });
  }),
});

export const openSystemSettingsTool = defineTool({
  name: 'open_system_settings',
  description: 'Open the computer’s Settings app, optionally at a section (sound, display, wifi, bluetooth, notifications, privacy, accessibility, keyboard, battery, appearance).',
  risk: 'act',
  schema: z.object({ pane: z.enum(SETTINGS_PANES).optional() }),
  title: ({ pane }) => (pane ? `Open ${pane} settings` : 'Open Settings'),
  run: ({ pane }, context) => withExtras(context, 'I couldn’t open Settings.', async (os) => {
    await os.system.openSettings(pane ?? 'general');
    return ok(pane ? `Opened ${pane} settings.` : 'Opened Settings.');
  }),
});
