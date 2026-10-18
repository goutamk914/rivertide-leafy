/**
 * Chunking (≈700 chars, 100 overlap, split on paragraph → sentence → word boundaries) and
 * best-matching windows for snippets and chat context.
 */
import { stem } from './text';

export const CHUNK_SIZE = 700;
export const CHUNK_OVERLAP = 100;

const WORD_WITH_INDEX = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
const SENTENCE_END = /(?<=[.!?…])\s+/u;

interface Unit { readonly text: string; readonly newParagraph: boolean }

function splitLong(text: string, size: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const cut = rest.lastIndexOf(' ', size);
    const at = cut > size * 0.5 ? cut : size;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function toUnits(text: string, size: number): Unit[] {
  const units: Unit[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const clean = paragraph.replace(/[ \t]+/g, ' ').trim();
    if (!clean) continue;
    const sentences = clean.length <= size ? [clean] : clean.split(SENTENCE_END).flatMap((s) => splitLong(s, size));
    sentences.forEach((sentence, index) => units.push({ text: sentence, newParagraph: index === 0 }));
  }
  return units;
}

function overlapTail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return '';
  const slice = text.slice(-overlap);
  const sentenceStart = slice.search(/[.!?]\s+\S/);
  if (sentenceStart >= 0) return slice.slice(sentenceStart + 1).trim();
  const space = slice.indexOf(' ');
  return space >= 0 ? slice.slice(space + 1).trim() : '';
}

/** Splits text into overlapping chunks that respect paragraph and sentence boundaries. */
export function chunkText(text: string, size: number = CHUNK_SIZE, overlap: number = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const unit of toUnits(text, size)) {
    if (!current) {
      current = unit.text;
      continue;
    }
    const separator = unit.newParagraph ? '\n\n' : ' ';
    if (current.length + separator.length + unit.text.length <= size) {
      current = `${current}${separator}${unit.text}`;
      continue;
    }
    chunks.push(current);
    const tail = overlapTail(current, overlap);
    current = tail ? `${tail} ${unit.text}` : unit.text;
  }
  if (current) chunks.push(current);
  return chunks;
}

interface WordPos { readonly start: number; readonly end: number; readonly term: string }

function wordPositions(text: string): WordPos[] {
  const positions: WordPos[] = [];
  for (const match of text.matchAll(WORD_WITH_INDEX)) {
    const raw = match[0].toLowerCase().replace(/’/g, "'");
    const bare = raw.endsWith("'s") ? raw.slice(0, -2) : raw;
    positions.push({ start: match.index, end: match.index + match[0].length, term: stem(bare) });
  }
  return positions;
}

/** Finds the span of matched words covering the most distinct query terms within `maxChars`. */
function bestSpan(matches: readonly WordPos[], maxChars: number): { start: number; end: number } {
  let best = { start: matches[0].start, end: matches[0].end, distinct: 0, total: 0 };
  let right = 0;
  for (let left = 0; left < matches.length; left += 1) {
    right = Math.max(right, left);
    while (right + 1 < matches.length && matches[right + 1].end - matches[left].start <= maxChars) right += 1;
    const window = matches.slice(left, right + 1);
    const distinct = new Set(window.map((m) => m.term)).size;
    if (distinct > best.distinct || (distinct === best.distinct && window.length > best.total)) {
      best = { start: matches[left].start, end: matches[right].end, distinct, total: window.length };
    }
  }
  return best;
}

function expandToWords(text: string, start: number, end: number, maxChars: number): string {
  const slack = Math.max(0, maxChars - (end - start));
  let from = Math.max(0, start - Math.floor(slack / 2));
  let to = Math.min(text.length, from + Math.max(maxChars, end - start));
  from = Math.max(0, Math.min(from, to - maxChars));
  if (from > 0) {
    const space = text.indexOf(' ', from);
    from = space >= 0 && space < start ? space + 1 : from;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to);
    to = space > end ? space : to;
  }
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
}

/**
 * The `maxChars` window of `text` that contains the most distinct query terms.
 * Falls back to the beginning of the text when nothing matches.
 */
export function bestWindow(text: string, queryTerms: ReadonlySet<string>, maxChars: number): string {
  const matches = queryTerms.size === 0 ? [] : wordPositions(text).filter((pos) => queryTerms.has(pos.term));
  if (matches.length === 0) return expandToWords(text, 0, 0, maxChars).replace(/^…/, '');
  const span = bestSpan(matches, maxChars);
  return expandToWords(text, span.start, span.end, maxChars);
}
