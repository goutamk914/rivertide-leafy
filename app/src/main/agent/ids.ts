/**
 * Ids for runs, sessions and tool calls: `<base36 time><4 random chars>` (ARCHITECTURE §3.10).
 * Contract change requested: a shared `src/shared/ids.ts` so every area uses one generator.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const RANDOM_CHARS = 4;

export function newId(now: number = Date.now()): string {
  const suffix = Array.from(randomBytes(RANDOM_CHARS), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${now.toString(36)}${suffix}`;
}
