import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBus } from '../../../src/main/bus';
import { corruptFileName, createStoreRegistry } from '../../../src/main/store/json-store';
import type { Toast } from '../../../src/shared/types';
import { memoryLogger } from './fakes';

const Notes = z.object({ items: z.array(z.string()) });
type NotesFile = z.infer<typeof Notes>;
const DEFAULTS: NotesFile = { items: [] };
const FIXED_NOW = new Date('2026-10-15T14:03:00.000Z');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('json-store', () => {
  let dir: string;
  let toasts: Toast[];
  let logger: ReturnType<typeof memoryLogger>;

  const registry = (debounceMs = 20) => {
    const bus = createBus(() => undefined);
    bus.on('toast', (toast) => toasts.push(toast));
    return createStoreRegistry({ dir, logger, bus, debounceMs, now: () => FIXED_NOW });
  };
  const open = (reg = registry()) => reg.openStore<NotesFile>('notes', { defaults: DEFAULTS, validate: (raw) => Notes.parse(raw) });
  const file = (name = 'notes.json') => join(dir, name);
  const readFile = (name = 'notes.json') => JSON.parse(readFileSync(file(name), 'utf8')) as unknown;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rivertide-store-'));
    toasts = [];
    logger = memoryLogger();
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts from defaults without creating a file when nothing is saved yet', () => {
    // Arrange / Act
    const store = open();

    // Assert
    expect(store.read()).toEqual(DEFAULTS);
    expect(existsSync(file())).toBe(false);
  });

  it('writes after the debounce and keeps the file private (0600)', async () => {
    // Arrange
    const store = open();

    // Act
    store.write({ items: ['a'] });
    const existedImmediately = existsSync(file());
    await wait(80);

    // Assert
    expect(existedImmediately).toBe(false);
    expect(readFile()).toEqual({ items: ['a'] });
    expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it('coalesces rapid writes into the latest value', async () => {
    // Arrange
    const store = open();

    // Act
    store.write({ items: ['1'] });
    store.write({ items: ['1', '2'] });
    store.write({ items: ['1', '2', '3'] });
    await store.flush();

    // Assert
    expect(readFile()).toEqual({ items: ['1', '2', '3'] });
    expect(existsSync(file('notes.json.bak'))).toBe(false);
  });

  it('copies the previous good file to .bak before replacing it', async () => {
    // Arrange
    const store = open();
    store.write({ items: ['first'] });
    await store.flush();

    // Act
    store.write({ items: ['second'] });
    await store.flush();

    // Assert
    expect(readFile()).toEqual({ items: ['second'] });
    expect(readFile('notes.json.bak')).toEqual({ items: ['first'] });
  });

  it('update returns a new value without mutating the old one', async () => {
    // Arrange
    const store = open();
    const before = store.read();

    // Act
    const after = store.update((current) => ({ items: [...current.items, 'x'] }));
    await store.flush();

    // Assert
    expect(before).toEqual({ items: [] });
    expect(after).toEqual({ items: ['x'] });
    expect(store.read()).toBe(after);
    expect(readFile()).toEqual({ items: ['x'] });
  });

  it('loads a valid file from disk', () => {
    // Arrange
    writeFileSync(file(), JSON.stringify({ items: ['saved'] }));

    // Act
    const store = open();

    // Assert
    expect(store.read()).toEqual({ items: ['saved'] });
  });

  it('restores from .bak when the main file is corrupt and keeps the bad file aside', async () => {
    // Arrange
    writeFileSync(file(), '{ not json');
    writeFileSync(file('notes.json.bak'), JSON.stringify({ items: ['from-backup'] }));

    // Act
    const store = open();
    await store.flush();

    // Assert
    expect(store.read()).toEqual({ items: ['from-backup'] });
    expect(readFileSync(file(corruptFileName('notes', FIXED_NOW)), 'utf8')).toBe('{ not json');
    expect(readFile()).toEqual({ items: ['from-backup'] });
    expect(toasts).toEqual([expect.objectContaining({ kind: 'info' })]);
  });

  it('treats a file that fails validation as corrupt', () => {
    // Arrange
    writeFileSync(file(), JSON.stringify({ items: 'not-an-array' }));

    // Act
    const store = open();

    // Assert
    expect(store.read()).toEqual(DEFAULTS);
    expect(existsSync(file(corruptFileName('notes', FIXED_NOW)))).toBe(true);
  });

  it('never silently overwrites: with no usable backup the bad file is renamed, logged and the user is told', () => {
    // Arrange
    writeFileSync(file(), 'garbage');
    writeFileSync(file('notes.json.bak'), 'also garbage');

    // Act
    const store = open();

    // Assert
    expect(store.read()).toEqual(DEFAULTS);
    expect(existsSync(file())).toBe(false);
    expect(readFileSync(file(corruptFileName('notes', FIXED_NOW)), 'utf8')).toBe('garbage');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe('error');
    expect(toasts[0]?.message).toContain(corruptFileName('notes', FIXED_NOW));
    expect(logger.entries.some((e) => e.level === 'error')).toBe(true);
  });

  it('does not back up a file it could not read (the corrupt copy is not promoted to .bak)', async () => {
    // Arrange
    writeFileSync(file(), 'garbage');
    const store = open();

    // Act
    store.write({ items: ['fresh'] });
    await store.flush();

    // Assert
    expect(readFile()).toEqual({ items: ['fresh'] });
    expect(existsSync(file('notes.json.bak'))).toBe(false);
  });

  it('uses the backup when the main file is missing', () => {
    // Arrange
    writeFileSync(file('notes.json.bak'), JSON.stringify({ items: ['only-backup'] }));

    // Act
    const store = open();

    // Assert
    expect(store.read()).toEqual({ items: ['only-backup'] });
  });

  it('shares one instance per name and rejects unsafe names', () => {
    // Arrange
    const reg = registry();

    // Act
    const a = open(reg);
    const b = open(reg);

    // Assert
    expect(a).toBe(b);
    expect(() => reg.openStore('../escape', { defaults: {} })).toThrow(/Invalid store name/);
    expect(() => reg.openStore('a/b', { defaults: {} })).toThrow(/Invalid store name/);
  });

  it('flushAll writes every pending store', async () => {
    // Arrange
    const reg = registry(10_000);
    const notes = open(reg);
    const other = reg.openStore('other', { defaults: { n: 0 } });
    notes.write({ items: ['n'] });
    other.write({ n: 1 });

    // Act
    await reg.flushAll();

    // Assert
    expect(readFile()).toEqual({ items: ['n'] });
    expect(readFile('other.json')).toEqual({ n: 1 });
  });

  it('closeAll cancels pending writes and ignores later ones', async () => {
    // Arrange
    const reg = registry();
    const store = open(reg);
    store.write({ items: ['pending'] });

    // Act
    reg.closeAll();
    store.write({ items: ['after-close'] });
    await wait(60);
    await store.flush();

    // Assert
    expect(existsSync(file())).toBe(false);
  });

  it('keeps the latest value when a write lands while another is in flight', async () => {
    // Arrange
    const store = open();

    // Act
    store.write({ items: ['a'] });
    const first = store.flush();
    store.write({ items: ['a', 'b'] });
    await first;
    await store.flush();

    // Assert
    expect(readFile()).toEqual({ items: ['a', 'b'] });
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reports a failed save once, keeps the change, and succeeds on a later flush', async () => {
    // Arrange
    const store = open();
    chmodSync(dir, 0o500);

    // Act
    store.write({ items: ['x'] });
    const failed = await store.flush().then(() => false, () => true);
    chmodSync(dir, 0o700);
    await store.flush();

    // Assert
    expect(failed).toBe(true);
    expect(toasts.filter((t) => t.kind === 'error')).toHaveLength(1);
    expect(readFile()).toEqual({ items: ['x'] });
  });

  it('accepts unvalidated stores (validate is optional)', async () => {
    // Arrange
    writeFileSync(file('raw.json'), JSON.stringify({ any: 'thing' }));
    const reg = registry();

    // Act
    const store = reg.openStore<Record<string, string>>('raw', { defaults: {} });

    // Assert
    expect(store.read()).toEqual({ any: 'thing' });
  });

  it('builds corrupt file names that are safe on every filesystem', () => {
    expect(corruptFileName('history', FIXED_NOW)).toBe('history.corrupt-2026-10-15T14-03-00-000Z.json');
  });
});
