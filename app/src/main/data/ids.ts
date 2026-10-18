/**
 * Id generation for memory-owned records: `<base36 time><4 random chars>` (ARCHITECTURE §3.10).
 * Ids only ever contain [0-9a-z], so they are safe to use as file names (documents/<id>.txt).
 */
import { randomBytes } from 'node:crypto';

const RANDOM_CHARS = 4;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SAFE_ID = /^[0-9a-z]{4,40}$/;

export function newId(now: number = Date.now()): string {
  const bytes = randomBytes(RANDOM_CHARS);
  const suffix = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${now.toString(36)}${suffix}`;
}

/** True for ids we generated (or that look exactly like them) — guards file-system use. */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

export function nowIso(now: number = Date.now()): string {
  return new Date(now).toISOString();
}
