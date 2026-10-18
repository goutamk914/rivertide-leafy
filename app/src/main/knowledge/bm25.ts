/**
 * Okapi BM25 (k1 = 1.2, b = 0.75) over pre-tokenised documents. Pure functions; callers keep
 * the documents and recompute stats when their corpus changes.
 */

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export interface Bm25Doc<M> {
  readonly meta: M;
  readonly length: number;
  readonly tf: ReadonlyMap<string, number>;
}

export interface CorpusStats {
  readonly n: number;
  readonly avgLength: number;
  readonly df: ReadonlyMap<string, number>;
}

export interface Ranked<M> {
  readonly doc: Bm25Doc<M>;
  readonly score: number;
}

export function toBm25Doc<M>(meta: M, tokens: readonly string[]): Bm25Doc<M> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return { meta, length: tokens.length, tf };
}

/** Document frequency and average length over one or more document lists. */
export function corpusStats(lists: readonly (readonly Bm25Doc<unknown>[])[]): CorpusStats {
  const df = new Map<string, number>();
  let n = 0;
  let totalLength = 0;
  for (const docs of lists) {
    for (const doc of docs) {
      n += 1;
      totalLength += doc.length;
      for (const term of doc.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return { n, avgLength: n === 0 ? 0 : totalLength / n, df };
}

export function idf(stats: CorpusStats, term: string): number {
  const df = stats.df.get(term) ?? 0;
  return Math.log(1 + (stats.n - df + 0.5) / (df + 0.5));
}

export function scoreDoc(doc: Bm25Doc<unknown>, queryTerms: readonly string[], stats: CorpusStats): number {
  if (doc.length === 0 || stats.avgLength === 0) return 0;
  const norm = BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / stats.avgLength);
  let score = 0;
  for (const term of new Set(queryTerms)) {
    const tf = doc.tf.get(term) ?? 0;
    if (tf === 0) continue;
    score += idf(stats, term) * ((tf * (BM25_K1 + 1)) / (tf + norm));
  }
  return score;
}

/** Documents with a positive score, best first. */
export function rank<M>(docs: readonly Bm25Doc<M>[], queryTerms: readonly string[], stats: CorpusStats): Ranked<M>[] {
  if (queryTerms.length === 0) return [];
  const ranked: Ranked<M>[] = [];
  for (const doc of docs) {
    const score = scoreDoc(doc, queryTerms, stats);
    if (score > 0) ranked.push({ doc, score });
  }
  return ranked.sort((a, b) => b.score - a.score);
}
