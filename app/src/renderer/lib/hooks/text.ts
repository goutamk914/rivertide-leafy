/** Small, pure text helpers for glanceable overlay copy (island, Leafy bubble, palette). */

const ELLIPSIS = '…';

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The start of `text`, cut on a word boundary when possible, with an ellipsis if shortened. */
export function headText(text: string, maxChars: number): string {
  const clean = collapseWhitespace(text);
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, Math.max(1, maxChars - 1));
  const space = cut.lastIndexOf(' ');
  const body = space > maxChars * 0.5 ? cut.slice(0, space) : cut;
  return `${body.replace(/[\s,.;:!?-]+$/, '')}${ELLIPSIS}`;
}

/** The end of `text` (what was said last), cut on a word boundary, with a leading ellipsis. */
export function tailText(text: string, maxChars: number): string {
  const clean = collapseWhitespace(text);
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(clean.length - Math.max(1, maxChars - 1));
  const space = cut.indexOf(' ');
  const body = space >= 0 && space < maxChars * 0.5 ? cut.slice(space + 1) : cut;
  return `${ELLIPSIS}${body}`;
}

/** The first `maxWords` words, with an ellipsis when there were more. */
export function firstWords(text: string, maxWords: number): string {
  const words = collapseWhitespace(text).split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}${ELLIPSIS}`;
}

/** Rough wrapped line count, honouring explicit newlines. Good enough to size a card. */
export function estimateLines(text: string, charsPerLine: number): number {
  const perLine = Math.max(1, Math.floor(charsPerLine));
  return text
    .split('\n')
    .map((line) => Math.max(1, Math.ceil(collapseWhitespace(line).length / perLine)))
    .reduce((total, n) => total + n, 0);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
