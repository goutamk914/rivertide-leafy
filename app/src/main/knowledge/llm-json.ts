/**
 * Extracts the first JSON object from an LLM reply (tolerates code fences and stray prose).
 * Returns null instead of throwing; callers validate the shape with zod.
 */
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/** Wraps untrusted text for a prompt so it cannot close or forge our tags. */
export function fenceUntrusted(tag: string, text: string): string {
  const safe = text.replace(new RegExp(`<\\s*\\/?\\s*${tag}`, 'gi'), (match) => match.replace('<', '‹'));
  return `<${tag}>\n${safe}\n</${tag}>`;
}
