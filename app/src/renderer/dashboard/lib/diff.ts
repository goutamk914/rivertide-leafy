/**
 * Word-level diff between what the user said (raw transcript) and what Rivertide wrote (output).
 * Words are compared case- and punctuation-insensitively, so "um," vs "Um" counts as the same word
 * while the original text is preserved for display.
 */

export type DiffKind = 'same' | 'removed' | 'added';

export interface DiffPart {
  readonly kind: DiffKind;
  /**
   * Text including trailing whitespace: the output's spelling for 'same' and 'added' parts,
   * the transcript's own words for 'removed' parts.
   */
  readonly text: string;
  /** For 'same' parts only: how the raw transcript spelled the matching words. */
  readonly rawText?: string;
}

/** Above this many words per side, the diff falls back to "everything changed" to stay fast. */
export const MAX_DIFF_WORDS = 1500;

interface Token {
  readonly text: string;
  readonly key: string;
}

function tokenize(input: string): Token[] {
  const matches = input.match(/\S+\s*/g) ?? [];
  return matches.map((text) => ({ text, key: text.trim().toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') }));
}

function lcsTable(a: readonly Token[], b: readonly Token[]): Uint16Array[] {
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = rows[i] as Uint16Array;
    const below = rows[i + 1] as Uint16Array;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i]?.key === b[j]?.key ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return rows;
}

/** Merges neighbouring parts of the same kind so the UI renders fewer spans. */
function merge(parts: readonly DiffPart[]): DiffPart[] {
  return parts.reduce<DiffPart[]>((out, part) => {
    const last = out[out.length - 1];
    if (!last || last.kind !== part.kind) return [...out, part];
    const joined: DiffPart = part.kind === 'same'
      ? { kind: 'same', text: last.text + part.text, rawText: (last.rawText ?? last.text) + (part.rawText ?? part.text) }
      : { kind: part.kind, text: last.text + part.text };
    return [...out.slice(0, -1), joined];
  }, []);
}

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_DIFF_WORDS || b.length > MAX_DIFF_WORDS) {
    return merge([
      ...(before ? [{ kind: 'removed' as const, text: before }] : []),
      ...(after ? [{ kind: 'added' as const, text: after }] : []),
    ]);
  }
  const table = lcsTable(a, b);
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ta = a[i] as Token;
    const tb = b[j] as Token;
    if (ta.key === tb.key) {
      parts.push({ kind: 'same', text: tb.text, rawText: ta.text });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      parts.push({ kind: 'removed', text: ta.text });
      i += 1;
    } else {
      parts.push({ kind: 'added', text: tb.text });
      j += 1;
    }
  }
  a.slice(i).forEach((t) => parts.push({ kind: 'removed', text: t.text }));
  b.slice(j).forEach((t) => parts.push({ kind: 'added', text: t.text }));
  return merge(parts);
}

/**
 * The parts to show for one side. "before" is the raw transcript exactly as heard (unchanged words in
 * the transcript's own spelling, plus removed words); "after" is the output (unchanged + added words).
 */
export function sideOf(parts: readonly DiffPart[], side: 'before' | 'after'): DiffPart[] {
  if (side === 'after') return merge(parts.filter((p) => p.kind !== 'removed'));
  return merge(
    parts
      .filter((p) => p.kind !== 'added')
      .map((p): DiffPart => (p.kind === 'same' ? { kind: 'same', text: p.rawText ?? p.text } : p)),
  );
}

export interface DiffStats {
  readonly removed: number;
  readonly added: number;
  readonly kept: number;
}

export function diffStats(parts: readonly DiffPart[]): DiffStats {
  const count = (kind: DiffKind) => parts.filter((p) => p.kind === kind).reduce((n, p) => n + (p.text.match(/\S+/g)?.length ?? 0), 0);
  return { removed: count('removed'), added: count('added'), kept: count('same') };
}
