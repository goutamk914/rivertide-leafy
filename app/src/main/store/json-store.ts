/**
 * Atomic, debounced JSON persistence behind `ctx.openStore(name, { defaults, validate })`.
 *
 *  - File: `<dir>/<name>.json`, owner-only (0600).
 *  - Writes are debounced (250 ms) and atomic: tmp file in the same folder → fsync → rename.
 *    The previous known-good file is copied to `<name>.json.bak` first.
 *  - Reads validate. A bad file falls back to `.bak`; if that fails too, the bad file is renamed to
 *    `<name>.corrupt-<timestamp>.json` (never silently overwritten), the user is told, and the store
 *    starts from defaults.
 *  - `flushAll()` writes everything pending (used on quit); `closeAll()` stops all writes (data wipe).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { chmod, copyFile, open, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { EventBus, JsonStore, Logger } from '../services';

export const DEFAULT_DEBOUNCE_MS = 250;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const JSON_INDENT = 2;
const STORE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface StoreOptions<T> {
  readonly defaults: T;
  readonly validate?: (raw: unknown) => T;
}

export interface StoreRegistryOptions {
  readonly dir: string;
  readonly logger: Logger;
  readonly bus?: EventBus;
  readonly debounceMs?: number;
  readonly now?: () => Date;
}

export interface StoreRegistry {
  openStore<T>(name: string, options: StoreOptions<T>): JsonStore<T>;
  /** Writes every pending change now; resolves when all stores are on disk (failures are logged). */
  flushAll(): Promise<void>;
  /** Cancels pending writes and ignores future ones (used right before wiping data). */
  closeAll(): void;
}

interface ManagedStore<T> extends JsonStore<T> {
  close(): void;
}

type ReadAttempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly missing: boolean; readonly reason: string };

function readJson<T>(file: string, validate: (raw: unknown) => T): ReadAttempt<T> {
  if (!existsSync(file)) return { ok: false, missing: true, reason: 'missing' };
  try {
    return { ok: true, value: validate(JSON.parse(readFileSync(file, 'utf8'))) };
  } catch (error) {
    return { ok: false, missing: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function corruptFileName(name: string, at: Date): string {
  return `${name}.corrupt-${at.toISOString().replace(/[:.]/g, '-')}.json`;
}

async function writeAtomically(file: string, contents: string, backupPrevious: boolean): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(tmp, 'w', FILE_MODE);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (backupPrevious && existsSync(file)) {
      await copyFile(file, `${file}.bak`);
      await chmod(`${file}.bak`, FILE_MODE);
    }
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

interface LoadResult<T> {
  readonly value: T;
  /** True when the primary file on disk is a good copy (safe to back up before replacing). */
  readonly primaryGood: boolean;
  /** True when the primary file should be rewritten from memory (restored from backup). */
  readonly needsWrite: boolean;
}

export function createStoreRegistry(options: StoreRegistryOptions): StoreRegistry {
  const { dir, logger, bus } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = options.now ?? (() => new Date());
  const stores = new Map<string, ManagedStore<unknown>>();
  let ensuredDir = false;

  const ensureDir = (): void => {
    if (ensuredDir) return;
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    ensuredDir = true;
  };

  const toast = (kind: 'info' | 'error', message: string): void => {
    bus?.emit('toast', { kind, message });
  };

  const setAsideCorrupt = (name: string, file: string): string | null => {
    const target = join(dir, corruptFileName(name, now()));
    try {
      renameSync(file, target);
      return target;
    } catch (error) {
      logger.error('could not set aside an unreadable file', { store: name, error });
      return null;
    }
  };

  function load<T>(name: string, file: string, defaults: T, validate: (raw: unknown) => T): LoadResult<T> {
    const primary = readJson(file, validate);
    if (primary.ok) return { value: primary.value, primaryGood: true, needsWrite: false };
    const backup = readJson(`${file}.bak`, validate);
    if (primary.missing) {
      if (backup.ok) logger.warn('primary file missing; restored from backup', { store: name });
      return backup.ok ? { value: backup.value, primaryGood: false, needsWrite: true } : { value: defaults, primaryGood: false, needsWrite: false };
    }
    const keptAs = setAsideCorrupt(name, file);
    if (backup.ok) {
      logger.warn('unreadable file restored from backup', { store: name, reason: primary.reason, keptAs });
      toast('info', `Rivertide restored your ${name} from a backup copy because the saved file couldn't be read.`);
      return { value: backup.value, primaryGood: false, needsWrite: true };
    }
    logger.error('unreadable file and no usable backup; starting fresh', { store: name, reason: primary.reason, keptAs });
    const kept = keptAs ? ` The old file was kept as ${basename(keptAs)} in Rivertide's data folder.` : '';
    toast('error', `Rivertide couldn't read your saved ${name}, so that part started fresh.${kept}`);
    return { value: defaults, primaryGood: false, needsWrite: false };
  }

  function createStore<T>(name: string, storeOptions: StoreOptions<T>): ManagedStore<T> {
    ensureDir();
    const file = join(dir, `${name}.json`);
    const validate = storeOptions.validate ?? ((raw: unknown) => raw as T);
    const initial = load(name, file, storeOptions.defaults, validate);
    let value = initial.value;
    let primaryGood = initial.primaryGood;
    let dirty = false;
    let closed = false;
    let timer: NodeJS.Timeout | null = null;
    let chain: Promise<void> = Promise.resolve();
    let reportedFailure = false;

    const persist = (): Promise<void> => {
      if (!dirty || closed) return chain;
      dirty = false;
      const contents = `${JSON.stringify(value, null, JSON_INDENT)}\n`;
      const run = chain.then(() => writeAtomically(file, contents, primaryGood)).then(
        () => {
          primaryGood = true;
          reportedFailure = false;
        },
        (error: unknown) => {
          dirty = true;
          logger.error('could not save file', { store: name, error });
          if (!reportedFailure) toast('error', `Rivertide couldn't save your ${name}. It will try again on the next change.`);
          reportedFailure = true;
          throw error;
        },
      );
      chain = run.catch(() => undefined);
      return run;
    };

    const schedule = (): void => {
      if (closed) {
        logger.debug('write ignored after close', { store: name });
        return;
      }
      dirty = true;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        persist().catch(() => undefined); // already logged and reported
      }, debounceMs);
      timer.unref?.();
    };

    if (initial.needsWrite) schedule();

    return {
      read: () => value,
      write(next) {
        value = next;
        schedule();
      },
      update(fn) {
        const next = fn(value);
        value = next;
        schedule();
        return next;
      },
      flush() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        return persist();
      },
      close() {
        closed = true;
        if (timer) clearTimeout(timer);
        timer = null;
      },
    };
  }

  return {
    openStore<T>(name: string, storeOptions: StoreOptions<T>): JsonStore<T> {
      if (!STORE_NAME.test(name)) throw new Error(`Invalid store name "${name}"`);
      const existing = stores.get(name);
      if (existing) {
        logger.debug('store opened again; sharing the existing instance', { store: name });
        return existing as JsonStore<T>;
      }
      const store = createStore(name, storeOptions);
      stores.set(name, store as ManagedStore<unknown>);
      return store;
    },
    async flushAll() {
      const results = await Promise.allSettled([...stores.values()].map((store) => store.flush()));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) logger.error('some stores could not be saved', { failed });
    },
    closeAll() {
      for (const store of stores.values()) store.close();
    },
  };
}
