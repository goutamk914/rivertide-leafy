import { describe, expect, it } from 'vitest';
import type { DictionaryEntry } from '../../../src/shared/types';
import { containsPhrase, isPlausible, parseLearnedTerms, worthLearning } from '../../../src/main/knowledge/dictionary-learn';
import { applyDictionary, buildMatcher, evictOverCap, rankTerms, sanitizeReplaces } from '../../../src/main/knowledge/dictionary-rules';
import { createFakeContext } from '../data/fake-context';

const entry = (overrides: Partial<DictionaryEntry>): DictionaryEntry => ({
  id: 'e1', term: 'Oxaliplatin', replaces: ['ox ally platin'], note: '', source: 'manual', uses: 0,
  createdAt: '2026-10-01T00:00:00.000Z', ...overrides,
});

describe('dictionary apply', () => {
  it('replaces mis-hearings case-insensitively at word boundaries, keeping punctuation', () => {
    // Arrange
    const matcher = buildMatcher([entry({}), entry({ id: 'e2', term: 'Dr. Okafor', replaces: ['doctor oak a four'] })]);

    // Act
    const { text, used } = applyDictionary('Ox Ally Platin, then "doctor oak a four." Not boxally platinum.', matcher);

    // Assert
    expect(text).toBe('Oxaliplatin, then "Dr. Okafor." Not boxally platinum.');
    expect(used.get('e1')).toBe(1);
    expect(used.get('e2')).toBe(1);
  });

  it('prefers the longest phrase and never re-replaces a replacement', () => {
    const matcher = buildMatcher([
      entry({ id: 'a', term: 'FOLFOX', replaces: ['fall fox'] }),
      entry({ id: 'b', term: 'FOLFOX regimen', replaces: ['fall fox regime'] }),
      entry({ id: 'c', term: 'fall fox', replaces: ['FOLFOX'] }),
    ]);
    expect(applyDictionary('the fall fox regime starts', matcher).text).toBe('the FOLFOX regimen starts');
  });

  it('matches across hyphens and extra spaces and keeps a sentence-initial capital', () => {
    const matcher = buildMatcher([entry({ term: 'metformin', replaces: ['met for min'] })]);
    expect(applyDictionary('Met-for  min twice a day', matcher).text).toBe('Metformin twice a day');
  });

  it('caps the matcher at the most-used phrases so the regex stays compilable', () => {
    const entries = [
      entry({ id: 'rare', term: 'Rare', replaces: ['rair'], uses: 0 }),
      entry({ id: 'common', term: 'Common', replaces: ['komon', 'comon'], uses: 9 }),
    ];
    const matcher = buildMatcher(entries, 2);
    expect([...matcher.lookup.keys()]).toEqual(['komon', 'comon']);
    expect(applyDictionary('rair komon', matcher).text).toBe('rair Common');
  });

  it('is a no-op with no entries or empty text', () => {
    expect(applyDictionary('hello', buildMatcher([])).text).toBe('hello');
    expect(applyDictionary('', buildMatcher([entry({})])).text).toBe('');
  });

  it('counts uses through the service and ranks terms by use', () => {
    // Arrange
    const { ctx } = createFakeContext();
    ctx.dictionary.upsert({ term: 'Oxaliplatin', replaces: ['ox ally platin'] });
    ctx.dictionary.upsert({ term: 'Neulasta', replaces: ['new last a'] });

    // Act
    const fixed = ctx.dictionary.apply('new last a shot and new last a again');

    // Assert
    expect(fixed).toBe('Neulasta shot and Neulasta again');
    expect(ctx.dictionary.terms(1)).toEqual(['Neulasta']);
    expect(ctx.dictionary.list().find((e) => e.term === 'Neulasta')?.uses).toBe(2);
  });
});

describe('dictionary rules', () => {
  it('sanitizes replacements: trims, dedupes, drops the term itself, caps at 20', () => {
    expect(sanitizeReplaces('Oxaliplatin', ['  ox  ally ', 'OX ALLY', 'oxaliplatin', '', 'x'])).toEqual(['ox ally', 'x']);
    expect(sanitizeReplaces('T', Array.from({ length: 30 }, (_, i) => `r${i}`))).toHaveLength(20);
  });

  it('ranks terms by uses then recency without duplicates', () => {
    const entries = [
      entry({ id: '1', term: 'A', uses: 1, createdAt: '2026-01-01' }),
      entry({ id: '2', term: 'B', uses: 5 }),
      entry({ id: '3', term: 'C', uses: 1, createdAt: '2026-05-01' }),
      entry({ id: '4', term: 'b', uses: 0 }),
    ];
    expect(rankTerms(entries, 10)).toEqual(['B', 'C', 'A']);
  });

  it('evicts the oldest learned entries first when over the cap', () => {
    const entries = [
      entry({ id: 'm-old', source: 'manual', createdAt: '2020-01-01' }),
      entry({ id: 'l-old', source: 'learned', createdAt: '2021-01-01' }),
      entry({ id: 'l-new', source: 'learned', createdAt: '2025-01-01' }),
      entry({ id: 'm-new', source: 'manual', createdAt: '2025-06-01' }),
    ];
    expect(evictOverCap(entries, 3).map((e) => e.id)).toEqual(['m-old', 'l-new', 'm-new']);
    expect(evictOverCap(entries, 1).map((e) => e.id)).toEqual(['m-new']);
  });
});

describe('dictionary service upsert', () => {
  it('merges replacements into an existing term and edits by id', () => {
    // Arrange
    const { ctx, of } = createFakeContext();
    const created = ctx.dictionary.upsert({ term: 'Neulasta', replaces: ['new last a'] }, 'learned');

    // Act
    const merged = ctx.dictionary.upsert({ term: 'neulasta', replaces: ['new lasta'] }, 'learned');
    const edited = ctx.dictionary.upsert({ id: created.id, term: 'Neulasta', replaces: ['knew last a'], note: 'Shot after chemo' });

    // Assert
    expect(merged.replaces).toEqual(['new last a', 'new lasta']);
    expect(edited).toMatchObject({ id: created.id, replaces: ['knew last a'], note: 'Shot after chemo', source: 'manual' });
    ctx.dictionary.delete(created.id);
    expect(ctx.dictionary.list()).toEqual([]);
    expect(of('data:changed').every((change) => change.domain === 'dictionary')).toBe(true);
  });
});

describe('dictionary learning', () => {
  const RAW = 'my doctor said the ox ally platin dose is lower';
  const POLISHED = 'My doctor said the Oxaliplatin dose is lower.';

  it('accepts only plausible proposals present in both texts', () => {
    expect(isPlausible({ term: 'Oxaliplatin', heard: 'ox ally platin' }, RAW, POLISHED)).toBe(true);
    expect(isPlausible({ term: 'Carboplatin', heard: 'ox ally platin' }, RAW, POLISHED)).toBe(false);
    expect(isPlausible({ term: 'Oxaliplatin', heard: 'carbo' }, RAW, POLISHED)).toBe(false);
    expect(isPlausible({ term: 'Doctor', heard: 'doctor' }, RAW, POLISHED)).toBe(false);
    expect(isPlausible({ term: 'Oxaliplatin', heard: 'the' }, RAW, POLISHED)).toBe(false);
    expect(isPlausible({ term: '123', heard: 'one two three' }, 'one two three', '123')).toBe(false);
    expect(containsPhrase('Ox-ally platin', 'ox ally platin')).toBe(true);
    expect(worthLearning('Hello, world', 'hello world')).toBe(false);
  });

  it('parses at most two proposals and rejects malformed replies', () => {
    const reply = JSON.stringify({ terms: [{ term: 'Oxaliplatin', heard: 'ox ally platin' }, { term: 'Lower', heard: 'lower' }] });
    expect(parseLearnedTerms(reply, RAW, POLISHED)).toEqual([{ term: 'Oxaliplatin', heard: 'ox ally platin' }]);
    expect(parseLearnedTerms('garbage', RAW, POLISHED)).toBeNull();
  });

  it('learns a term through the LLM and stores it as learned', async () => {
    // Arrange
    const { ctx, llm } = createFakeContext();
    llm.complete.mockResolvedValueOnce(llm.reply(JSON.stringify({ terms: [{ term: 'Oxaliplatin', heard: 'ox ally platin' }] })));

    // Act
    await ctx.dictionary.learnFrom(RAW, POLISHED);

    // Assert
    expect(llm.complete.mock.calls[0][0]).toBe('extract');
    expect(ctx.dictionary.list()).toMatchObject([{ term: 'Oxaliplatin', replaces: ['ox ally platin'], source: 'learned' }]);
    expect(ctx.dictionary.apply('the ox ally platin')).toBe('the Oxaliplatin');
  });

  it('skips when the LLM is not configured, the setting is off, texts match, or the pair was seen', async () => {
    // Arrange
    const { ctx, llm } = createFakeContext();
    const off = createFakeContext({ settings: { knowledge: { learnDictionary: false } } });

    // Act
    llm.isConfigured.mockReturnValueOnce(false);
    await ctx.dictionary.learnFrom(RAW, POLISHED);
    await ctx.dictionary.learnFrom('same text', 'Same text.');
    await off.ctx.dictionary.learnFrom(RAW, POLISHED);
    await ctx.dictionary.learnFrom(RAW, POLISHED);
    await ctx.dictionary.learnFrom(RAW, POLISHED);

    // Assert
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(off.llm.complete).not.toHaveBeenCalled();
  });

  it('never throws when the LLM fails or replies with junk', async () => {
    const { ctx, llm, logger } = createFakeContext();
    llm.complete.mockRejectedValueOnce(new Error('timeout'));
    await expect(ctx.dictionary.learnFrom(RAW, POLISHED)).resolves.toBeUndefined();
    llm.complete.mockResolvedValueOnce(llm.reply('nope'));
    await expect(ctx.dictionary.learnFrom(`${RAW} again`, `${POLISHED} Again.`)).resolves.toBeUndefined();
    expect(logger.calls.warn.length).toBe(2);
    expect(ctx.dictionary.list()).toEqual([]);
  });
});
