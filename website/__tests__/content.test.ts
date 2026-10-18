import { describe, expect, it } from 'vitest';
import { MESSY_CLEAN, MESSY_WORDS } from '@/content/demo';
import { PACE_DAYS, USUAL_RANGE, describeDay } from '@/content/pace';
import { DATA_FLOWS } from '@/content/privacy';
import { FAQS } from '@/content/faq';
import { SHORTCUTS } from '@/content/shortcuts';
import { WAYS } from '@/content/ways';
import { NAV_LINKS, withBase } from '@/lib/site';

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

describe('messy transcript', () => {
  it('cleans to exactly the words that are kept', () => {
    const kept = MESSY_WORDS.filter((word) => !word.drop).map((word) => word.text).join(' ');
    expect(normalize(kept)).toBe(normalize(MESSY_CLEAN));
  });
});

describe('pace example', () => {
  it('derives the usual range from the data (middle half of the fortnight)', () => {
    expect(PACE_DAYS).toHaveLength(14);
    expect(USUAL_RANGE).toEqual({ low: 125, high: 136 });
  });

  it('describes days against the usual range in plain words', () => {
    expect(describeDay(114)).toBe('11 below your usual');
    expect(describeDay(130)).toBe('within your usual');
    expect(describeDay(139)).toBe('3 above your usual');
  });
});

describe('copy rules', () => {
  const strings = [
    ...DATA_FLOWS.flatMap((flow) => [flow.what, flow.where, flow.note]),
    ...FAQS.flatMap((faq) => [faq.question, faq.answer]),
    ...SHORTCUTS.flatMap((shortcut) => [shortcut.action, shortcut.detail]),
    ...WAYS.flatMap((way) => [way.title, way.body, way.said, way.result]),
    MESSY_CLEAN,
  ];

  it('uses no em or en dashes', () => {
    expect(strings.filter((text) => /[–—]/.test(text))).toEqual([]);
  });

  it('avoids the words docs/DESIGN.md bans', () => {
    const banned = /\b(elevate|seamless|unleash|empower|supercharge|next-gen|revolutionize|oops)\b/i;
    expect(strings.filter((text) => banned.test(text))).toEqual([]);
  });

  it('never claims HIPAA or invented usage numbers', () => {
    expect(strings.filter((text) => /hipaa|\d+\s*\+?\s*(patients|users|hours)/i.test(text))).toEqual([]);
  });
});

describe('links', () => {
  it('uses trailing slashes for every internal page link, as the static export does', () => {
    expect(NAV_LINKS.every((link) => link.href.startsWith('/') && (link.href.endsWith('/') || link.href.includes('#')))).toBe(true);
  });

  it('leaves absolute URLs alone when adding the base path', () => {
    expect(withBase('https://codethecure.org')).toBe('https://codethecure.org');
  });
});
