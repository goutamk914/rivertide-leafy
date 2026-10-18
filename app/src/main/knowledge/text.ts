/**
 * Text normalisation for search and matching: unicode-aware word split, lowercase, stopwords,
 * light stemming (plural / -ing / -ed), numbers kept. Shared by BM25, fact dedupe and the graph.
 * Stopword-only input yields no tokens — the old app matched everything on "a" or "i".
 */

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
const NUMERIC = /^\p{N}+$/u;
const MIN_TOKEN_LENGTH = 2;

export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as',
  'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'even', 'few', 'for', 'from', 'further', 'get',
  'got', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'let', 'like', 'me', 'more', 'most',
  'much', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'oh', 'ok', 'okay', 'on', 'once', 'only',
  'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'really', 'same', 'she', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'us', 'very', 'was', 'we', 'well',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'yeah',
  'yes', 'you', 'your', 'yours', 'yourself', 'yourselves', 'um', 'uh', 'er', 'ah', 'hmm', 'mm',
  "i'm", "i've", "i'd", "i'll", "it's", "don't", "doesn't", "didn't", "can't", "won't", "isn't", "aren't",
  "wasn't", "weren't", "you're", "you've", "we're", "they're", "that's", "there's", "what's", "let's",
]);

/** Light suffix stripping. Deterministic and applied identically to documents and queries. */
export function stem(word: string): string {
  if (NUMERIC.test(word) || word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ing') && word.length > 5) return undouble(word.slice(0, -3));
  if (word.endsWith('ed') && word.length > 4 && !word.endsWith('eed')) return undouble(word.slice(0, -2));
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

function undouble(base: string): string {
  const last = base[base.length - 1];
  const doubled = base.length > 3 && last === base[base.length - 2] && !/[lsz]/.test(last);
  return doubled ? base.slice(0, -1) : base;
}

/** Lowercased word list with apostrophes normalised, stopwords kept. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).map((word) => word.replace(/’/g, "'"));
}

/** Search tokens: words minus stopwords and 1-letter noise, possessives dropped, stemmed. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of words(text)) {
    if (STOPWORDS.has(word)) continue;
    const bare = word.endsWith("'s") ? word.slice(0, -2) : word;
    if (bare.length < MIN_TOKEN_LENGTH && !NUMERIC.test(bare)) continue;
    tokens.push(stem(bare));
  }
  return tokens;
}

/** Tokens that carry meaning on their own (graph links, fact dedupe): ≥ 4 chars or numbers. */
export function significantTerms(text: string): ReadonlySet<string> {
  return new Set(tokenize(text).filter((token) => token.length >= 4 || NUMERIC.test(token)));
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Label similarity for fact dedupe: token Jaccard over normalised labels. */
export function labelSimilarity(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) {
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  }
  return jaccard(left, right);
}
