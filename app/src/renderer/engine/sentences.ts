/**
 * Splits text for speechSynthesis: Chrome silently stops long utterances, so speak sentence by
 * sentence, and break very long sentences at commas, then at spaces.
 */
import { ENGINE } from './dsp/tuning';

const SENTENCE_END = /(?<=[.!?…。！？])["'”’)\]]*\s+/u;
const CLAUSE_BREAK = /(?<=[,;:—–])\s+/u;

function packWords(text: string, maxChars: number): string[] {
  return text.split(/\s+/).reduce<string[]>((chunks, word) => {
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= maxChars) return [...chunks.slice(0, -1), `${last} ${word}`];
    // A single word longer than the limit is hard-cut (URLs, codes).
    const pieces = word.match(new RegExp(`.{1,${maxChars}}`, 'gsu')) ?? [word];
    return [...chunks, ...pieces];
  }, []);
}

function splitLong(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  return sentence
    .split(CLAUSE_BREAK)
    .reduce<string[]>((chunks, clause) => {
      const last = chunks[chunks.length - 1];
      if (last !== undefined && last.length + 1 + clause.length <= maxChars) return [...chunks.slice(0, -1), `${last} ${clause}`];
      return [...chunks, ...(clause.length <= maxChars ? [clause] : packWords(clause, maxChars))];
    }, []);
}

export function splitForSpeech(text: string, maxChars: number = ENGINE.ttsMaxChunkChars): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return normalized
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .flatMap((s) => splitLong(s, maxChars));
}
