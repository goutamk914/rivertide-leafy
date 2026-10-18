/**
 * Speech-to-text prompt (pure): personal dictionary terms biased into Whisper-style models.
 * Whisper reads at most 224 prompt tokens; we stay well under with a character budget.
 */

/** ~224 tokens at a conservative ~3.2 characters per token. */
export const STT_PROMPT_MAX_CHARS = 700;
const ALWAYS_INCLUDED = ['Leafy', 'Rivertide'] as const;

export function buildSttPrompt(terms: readonly string[]): string {
  const seen = new Set<string>();
  const unique = [...ALWAYS_INCLUDED, ...terms]
    .map((term) => term.replace(/\s+/g, ' ').trim())
    .filter((term) => term.length > 0 && !seen.has(term.toLowerCase()) && seen.add(term.toLowerCase()));
  const kept: string[] = [];
  let length = 0;
  for (const term of unique) {
    const added = (kept.length > 0 ? 2 : 0) + term.length;
    if (length + added > STT_PROMPT_MAX_CHARS) break;
    kept.push(term);
    length += added;
  }
  return `${kept.join(', ')}.`;
}

/** Clamps any caller-provided prompt to the budget, cutting at a comma or space. */
export function clampSttPrompt(prompt: string | undefined): string | undefined {
  const text = prompt?.trim();
  if (!text) return undefined;
  if (text.length <= STT_PROMPT_MAX_CHARS) return text;
  const cut = text.slice(0, STT_PROMPT_MAX_CHARS);
  const boundary = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(' '));
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
}
