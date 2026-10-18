import { describe, expect, it, vi } from 'vitest';
import { corpusStats, rank, scoreDoc, toBm25Doc } from '../../../src/main/knowledge/bm25';
import { bestWindow, chunkText } from '../../../src/main/knowledge/passages';
import { jaccard, labelSimilarity, significantTerms, stem, tokenize } from '../../../src/main/knowledge/text';
import { createFakeContext, makeHistoryItem } from '../data/fake-context';

describe('tokenizer', () => {
  it('lowercases, drops stopwords and 1-letter noise, keeps numbers', () => {
    expect(tokenize('I have a 5 mg dose of Ondansetron, and I am OK')).toEqual(['5', 'mg', 'dose', 'ondansetron']);
  });

  it('returns no tokens for a stopword-only query (the old app matched everything on "a")', () => {
    expect(tokenize('a')).toEqual([]);
    expect(tokenize('I')).toEqual([]);
    expect(tokenize('what is it that you')).toEqual([]);
  });

  it('applies light stemming consistently', () => {
    expect(stem('appointments')).toBe('appointment');
    expect(stem('therapies')).toBe('therapy');
    expect(stem('running')).toBe('run');
    expect(stem('stopped')).toBe('stop');
    expect(stem('diagnosis')).toBe('diagnosis');
    expect(stem('bleed')).toBe('bleed');
    expect(stem('classes')).toBe('class');
    expect(stem('2024')).toBe('2024');
  });

  it('handles unicode words and possessives', () => {
    expect(tokenize("Dr. Müller's café")).toEqual(['dr', 'müller', 'café']);
  });

  it('finds significant terms (≥ 4 chars or numbers) and label similarity', () => {
    expect([...significantTerms('Cycle 3 of FOLFOX infusion')]).toEqual(['cycle', '3', 'folfox', 'infusion']);
    expect(labelSimilarity('Oxaliplatin dose', 'oxaliplatin doses')).toBe(1);
    expect(labelSimilarity('Dr. Patel', 'Nurse Kim')).toBe(0);
    expect(labelSimilarity('the', 'THE')).toBe(1);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe('BM25', () => {
  const docs = [
    toBm25Doc('exact', tokenize('Oxaliplatin infusion every two weeks at the cancer center')),
    toBm25Doc('unrelated', tokenize('Buy milk, bread and eggs from the grocery store on Sunday')),
    toBm25Doc('long', tokenize(`${'filler words about gardening and weather '.repeat(20)} oxaliplatin`)),
  ];
  const stats = corpusStats([docs]);

  it('ranks the document with the exact term above unrelated ones', () => {
    // Act
    const ranked = rank(docs, tokenize('oxaliplatin infusion'), stats);

    // Assert
    expect(ranked[0].doc.meta).toBe('exact');
    expect(ranked.map((entry) => entry.doc.meta)).not.toContain('unrelated');
  });

  it('prefers a short focused document over a long one with the same term', () => {
    const ranked = rank(docs, tokenize('oxaliplatin'), stats);
    expect(ranked.map((entry) => entry.doc.meta)).toEqual(['exact', 'long']);
  });

  it('returns nothing for empty queries and scores empty docs as zero', () => {
    expect(rank(docs, [], stats)).toEqual([]);
    expect(scoreDoc(toBm25Doc('empty', []), ['milk'], stats)).toBe(0);
    expect(corpusStats([]).avgLength).toBe(0);
  });
});

describe('passages', () => {
  const paragraph = (n: number): string => Array.from({ length: 12 }, (_, i) => `Sentence ${n}.${i} talks about item ${n}.`).join(' ');

  it('splits long text into overlapping chunks of about 700 characters', () => {
    // Arrange
    const text = [paragraph(1), paragraph(2), paragraph(3), paragraph(4)].join('\n\n');

    // Act
    const chunks = chunkText(text);

    // Assert
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(800);
    const tailOfFirst = chunks[0].slice(-40);
    expect(chunks[1].includes(tailOfFirst.slice(-20))).toBe(true);
  });

  it('keeps short paragraphs together and hard-splits giant words', () => {
    expect(chunkText('One.\n\nTwo.')).toEqual(['One.\n\nTwo.']);
    const giant = 'x'.repeat(2000);
    expect(chunkText(giant).every((chunk) => chunk.length <= 800)).toBe(true);
  });

  it('builds a snippet around the matched terms with ellipses', () => {
    // Arrange
    const text = `${'Lorem ipsum dolor sit amet. '.repeat(20)}My oncologist Dr. Patel changed the oxaliplatin dose. ${'More words here. '.repeat(20)}`;

    // Act
    const snippet = bestWindow(text, new Set(tokenize('oxaliplatin Patel')), 120);

    // Assert
    expect(snippet).toContain('oxaliplatin');
    expect(snippet).toContain('Patel');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(124);
  });

  it('falls back to the start of the text when nothing matches', () => {
    expect(bestWindow('Short note about lunch.', new Set(['zebra']), 100)).toBe('Short note about lunch.');
  });
});

describe('search index', () => {
  it('searches across notes, facts, documents and history and returns one hit per item', () => {
    // Arrange
    const { ctx } = createFakeContext();
    ctx.notes.upsert({ title: 'Chemo questions', body: 'Ask whether neuropathy from oxaliplatin is permanent.' });
    ctx.knowledge.upsert({ category: 'medication', label: 'Oxaliplatin', value: 'Every two weeks, cycle 3 of 12.' });
    ctx.history.add(makeHistoryItem({ raw: 'remind me to buy groceries', output: 'Remind me to buy groceries.' }));
    const doc = ctx.documents.importText('Visit summary', `${'General info. '.repeat(80)}\n\nOxaliplatin dose reduced to 75%.\n\n${'Other notes. '.repeat(80)}`);

    // Act
    const hits = ctx.search.search('oxaliplatin');

    // Assert
    expect(hits.map((hit) => hit.kind).sort()).toEqual(['document', 'fact', 'note']);
    expect(hits.filter((hit) => hit.id === doc.id)).toHaveLength(1);
    expect(hits.find((hit) => hit.kind === 'document')?.snippet).toContain('Oxaliplatin dose reduced');
  });

  it('returns nothing for stopword-only queries', () => {
    const { ctx } = createFakeContext();
    ctx.notes.upsert({ title: 'A note', body: 'I am a person and I like things' });
    expect(ctx.search.search('a')).toEqual([]);
    expect(ctx.search.search('i')).toEqual([]);
  });

  it('respects kinds and limit', () => {
    // Arrange
    const { ctx } = createFakeContext();
    for (let i = 0; i < 5; i += 1) ctx.notes.upsert({ title: `Scan ${i}`, body: 'MRI scan results' });
    ctx.knowledge.upsert({ category: 'appointment', label: 'MRI scan', value: 'Next Friday' });

    // Act
    const facts = ctx.search.search('scan', { kinds: ['fact'] });
    const limited = ctx.search.search('scan', { limit: 2 });

    // Assert
    expect(facts.map((hit) => hit.kind)).toEqual(['fact']);
    expect(limited).toHaveLength(2);
  });

  it('rebuilds lazily only after its domain is invalidated', () => {
    // Arrange
    const { ctx } = createFakeContext();
    ctx.notes.upsert({ title: 'Pharmacy', body: 'pick up prescription' });
    const listSpy = vi.spyOn(ctx.notes, 'list');
    ctx.search.search('prescription', { kinds: ['note'] });
    const builds = listSpy.mock.calls.length;

    // Act
    ctx.search.search('pharmacy', { kinds: ['note'] });
    const afterCachedSearch = listSpy.mock.calls.length;
    ctx.search.invalidate('notes');
    ctx.search.search('pharmacy', { kinds: ['note'] });
    ctx.search.invalidate('chats');
    ctx.search.invalidate();

    // Assert
    expect(builds).toBe(1);
    expect(afterCachedSearch).toBe(1);
    expect(listSpy.mock.calls.length).toBe(2);
  });

  it('logs and keeps serving when a source fails to build', () => {
    // Arrange
    const { ctx, logger } = createFakeContext();
    vi.spyOn(ctx.notes, 'list').mockImplementation(() => {
      throw new Error('disk on fire');
    });

    // Act
    const hits = ctx.search.search('anything', { kinds: ['note'] });

    // Assert
    expect(hits).toEqual([]);
    expect(logger.calls.error.length).toBe(1);
  });
});
