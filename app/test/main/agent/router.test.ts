import { describe, expect, it } from 'vitest';
import { normalizeUtterance, parseIntent, type Intent, type RouterContext } from '../../../src/main/agent/router';

// Thursday 15 October 2026, 2:03 PM local time.
const NOW = new Date(2026, 9, 15, 14, 3, 0);
const APPS = ['Calendar', 'Spotify', 'Safari', 'Notes', 'Mail', 'Music', 'Zoom', 'Google Chrome', 'Finder', 'System Settings', 'Visual Studio Code', 'Slack', 'Messages'];
const context: RouterContext = { now: NOW, resolveApp: (name) => APPS.find((app) => app.toLowerCase() === name.toLowerCase().trim()) ?? null };

const parse = (text: string): Intent | null => parseIntent(text, context);
const toolOf = (text: string) => {
  const intent = parse(text);
  return intent?.kind === 'tool' ? { tool: intent.tool, input: intent.input } : intent;
};
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute, 0).toISOString();

describe('normalizeUtterance', () => {
  it('strips wake words, politeness and end punctuation', () => {
    expect(normalizeUtterance('Hey Leafy, could you please open Spotify for me?')).toBe('open spotify');
  });

  it('joins spoken domain names', () => {
    expect(normalizeUtterance('go to youtube dot com')).toBe('go to youtube.com');
  });
});

describe('parseIntent — apps', () => {
  it.each([
    ['open Spotify', 'Spotify'],
    ['Launch the Calendar app', 'Calendar'],
    ['start zoom', 'Zoom'],
    ['switch to Slack', 'Slack'],
    ['can you open up google chrome', 'Google Chrome'],
    ['open my notes app', 'Notes'],
  ])('"%s" opens %s', (text, name) => {
    expect(toolOf(text)).toEqual({ tool: 'open_app', input: { name } });
  });

  it.each([
    ['quit Spotify', 'Spotify'],
    ['close the Zoom app', 'Zoom'],
    ['force quit messages', 'Messages'],
  ])('"%s" quits %s', (text, name) => {
    expect(toolOf(text)).toEqual({ tool: 'quit_app', input: { name } });
  });

  it('opens a website by domain', () => {
    expect(toolOf('open youtube dot com')).toEqual({ tool: 'open_url', input: { url: 'https://youtube.com' } });
    expect(toolOf('go to https://codethecure.org/about')).toEqual({ tool: 'open_url', input: { url: 'https://codethecure.org/about' } });
  });
});

describe('parseIntent — volume and media', () => {
  it.each([
    ['turn the volume up', { change: 'up' }],
    ['turn it down a bit', { change: 'down' }],
    ['volume down', { change: 'down' }],
    ['make it louder', { change: 'up' }],
    ['lower the volume', { change: 'down' }],
    ['set the volume to 30%', { level: 30 }],
    ['set volume to fifty percent', { level: 50 }],
    ['volume 80', { level: 80 }],
    ['set the volume to max', { level: 100 }],
    ['mute', { mute: true }],
    ['mute the sound', { mute: true }],
    ['unmute', { mute: false }],
    ['turn the sound back on', { mute: false }],
  ])('"%s" → set_volume %o', (text, input) => {
    expect(toolOf(text)).toEqual({ tool: 'set_volume', input });
  });

  it.each([
    ['play', 'play'], ['play the music', 'play'], ['resume', 'play'], ['pause', 'pause'], ['pause the music', 'pause'],
    ['stop the music', 'pause'], ['next song', 'next'], ['skip this track', 'next'], ['skip', 'next'],
    ['previous track', 'previous'], ['play the last song', 'previous'], ['go back a track', 'previous'],
  ])('"%s" → media %s', (text, action) => {
    expect(toolOf(text)).toEqual({ tool: 'media_control', input: { action } });
  });
});

describe('parseIntent — time, battery, system', () => {
  it.each(['what time is it', "What's the time?", 'tell me what time it is', 'time'])('"%s" asks for the time', (text) => {
    expect(toolOf(text)).toEqual({ tool: 'get_system_status', input: { fields: ['time'] } });
  });

  it.each(['what day is it', "what's the date today", 'what day of the week is it', "today's date"])('"%s" asks for the date', (text) => {
    expect(toolOf(text)).toEqual({ tool: 'get_system_status', input: { fields: ['date'] } });
  });

  it.each(['battery level', "what's my battery at", 'how much battery do I have left', "how's the battery"])('"%s" asks for the battery', (text) => {
    expect(toolOf(text)).toEqual({ tool: 'get_system_status', input: { fields: ['battery'] } });
  });

  it.each([
    ['turn on dark mode', true], ['dark mode off', false], ['switch to light mode', false], ['turn dark mode on', true],
    ['enable dark mode', true], ['disable dark mode', false], ['turn on light mode', false], ['dark mode', true],
  ])('"%s" → dark mode %s', (text, on) => {
    expect(toolOf(text)).toEqual({ tool: 'set_dark_mode', input: { on } });
  });

  it.each([
    ['lock the screen', 'lock_screen'], ['lock my computer', 'lock_screen'], ['take a screenshot', 'take_screenshot'],
    ['grab a screen shot of my screen', 'take_screenshot'], ['turn off the display', 'sleep_display'], ['start dictation', 'start_dictation'],
    ['I want to dictate', 'start_dictation'],
  ])('"%s" → %s', (text, name) => {
    expect(toolOf(text)).toEqual({ tool: name, input: {} });
  });
});

describe('parseIntent — timers and reminders', () => {
  it.each([
    ['set a timer for 10 minutes', { minutes: 10 }],
    ['set a timer for 1 hour and 30 minutes', { minutes: 90 }],
    ['start a 5 minute timer', { minutes: 5 }],
    ['set a ten-minute timer called pasta', { minutes: 10, label: 'pasta' }],
    ['set a timer for 20 minutes for the laundry', { minutes: 20, label: 'the laundry' }],
    ['timer for 90 seconds', { minutes: 1.5 }],
    ['set a timer for half an hour', { minutes: 30 }],
  ])('"%s" → set_timer %o', (text, input) => {
    expect(toolOf(text)).toEqual({ tool: 'set_timer', input });
  });

  it.each([
    ['remind me to take my pills at 8', 'take my pills', local(15, 20)],
    ['remind me to call Dr. Lee tomorrow at 9', 'call dr. lee', local(16, 9)],
    ['remind me to stretch in 20 minutes', 'stretch', new Date(NOW.getTime() + 20 * 60_000).toISOString()],
    ['remind me in 10 minutes to check the oven', 'check the oven', new Date(NOW.getTime() + 10 * 60_000).toISOString()],
    ['remind me at 8:30 pm to text Sam', 'text sam', local(15, 20, 30)],
    ['set a reminder to drink water at 3 pm tomorrow', 'drink water', local(16, 15)],
    ['remind me about the appointment on friday at 3', 'the appointment', local(16, 15)],
    ['remind me to rest tonight', 'rest', local(15, 20)],
  ])('"%s" → reminder "%s"', (text, subject, dueAt) => {
    expect(toolOf(text)).toEqual({ tool: 'create_reminder', input: { text: subject, dueAt } });
  });
});

describe('parseIntent — search, notes, pages', () => {
  it.each([
    ['search the web for chemo brain tips', 'web_search', { query: 'chemo brain tips' }],
    ['google side effects of oxaliplatin', 'web_search', { query: 'side effects of oxaliplatin' }],
    ['look up lymphedema exercises online', 'web_search', { query: 'lymphedema exercises' }],
    ['find my files about taxes', 'search_files', { query: 'taxes' }],
    ['search my computer for insurance letter', 'search_files', { query: 'insurance letter' }],
    ['find my tax return pdf', 'search_files', { query: 'tax return' }],
    ['new note buy ginger tea', 'create_note', { body: 'buy ginger tea' }],
    ['note to self: ask about the port flush', 'create_note', { body: 'ask about the port flush' }],
    ['open my history', 'open_rivertide', { page: 'history' }],
    ['show me the insights page', 'open_rivertide', { page: 'insights' }],
    ['open rivertide settings', 'open_rivertide', { page: 'settings' }],
    ['open your settings', 'open_rivertide', { page: 'settings' }],
    ['open the notes page', 'open_rivertide', { page: 'notes' }],
  ])('"%s" → %s', (text, name, input) => {
    expect(toolOf(text)).toEqual({ tool: name, input });
  });

  it('opens the Notes app (not the Rivertide page) for a bare "open notes"', () => {
    expect(toolOf('open notes')).toEqual({ tool: 'open_app', input: { name: 'Notes' } });
  });

  it.each([
    ['open the second one', 'open', 1], ['open the first result', 'open', 0], ['open the last one', 'open', -1],
    ['open number 3', 'open', 2], ['show the second one in finder', 'reveal', 1],
  ])('"%s" is a follow-up (%s #%i)', (text, action, index) => {
    expect(parse(text)).toEqual({ kind: 'follow-up', action, index });
  });
});

describe('parseIntent — near misses go to the LLM', () => {
  it.each([
    "I'm going to open up about my feelings",
    'open up about my feelings',
    'can you tell me why the sky is blue',
    'what time does the pharmacy close',
    "what's the time zone in Tokyo",
    'remind me what my oncologist said',
    'play a game with me',
    'I want to close the deal',
    'close the window',
    'the volume of a sphere',
    'how do I take a screenshot on windows',
    'next week I have chemo',
    'turn up the heat',
    'lock in',
    'start over',
    'open it',
    'set the table',
    'remind me to call mom',
    'set a timer',
    'take a note',
    'stop',
    'pause for a second what was I saying',
    'my battery died yesterday and I missed the call',
    'what should I eat for dinner',
    'search my notes for ginger',
    'open documents',
    'run a bath',
  ])('"%s" → null', (text) => {
    expect(parse(text)).toBeNull();
  });

  it('parses quickly (< 5 ms per utterance)', () => {
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) parse('remind me to call Dr. Lee tomorrow at 9');
    expect((performance.now() - started) / 200).toBeLessThan(5);
  });
});
