import type { Ok } from '../../shared/ipc';

/** The shared `{ ok: true }` result for channels that only acknowledge. */
export const OK: Ok = Object.freeze({ ok: true });
