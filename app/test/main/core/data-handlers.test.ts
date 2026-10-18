import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, session: {}, shell: {} }));

import { exportData, exportFolderName, shouldExport, uniquePath, wipeData } from '../../../src/main/ipc/handlers/data';
import type { Paths } from '../../../src/main/services';
import { fakeContext } from './fakes';

const NOW = new Date(2026, 9, 15, 14, 3);

describe('data export and wipe', () => {
  let root: string;
  let paths: Paths;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rivertide-data-'));
    paths = {
      userData: join(root, 'user'),
      data: join(root, 'user', 'data'),
      documents: join(root, 'user', 'documents'),
      media: join(root, 'user', 'media'),
      logs: join(root, 'logs'),
      exports: join(root, 'Documents'),
      resources: root,
    };
    mkdirSync(paths.data, { recursive: true });
    mkdirSync(paths.documents, { recursive: true });
    mkdirSync(paths.media, { recursive: true });
    mkdirSync(paths.exports, { recursive: true });
    writeFileSync(join(paths.data, 'history.json'), '{"items":[]}');
    writeFileSync(join(paths.data, 'secrets.json'), '{"anthropic":"ENCRYPTED"}');
    writeFileSync(join(paths.data, 'secrets.json.bak'), '{"anthropic":"OLD"}');
    writeFileSync(join(paths.data, 'notes.json.123.tmp'), 'partial');
    writeFileSync(join(paths.documents, 'doc1.txt'), 'hello');
    writeFileSync(join(paths.media, 'rec.wav'), 'RIFF');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('names exports by local date and time without colons', () => {
    expect(exportFolderName(NOW)).toBe('Rivertide Export 2026-10-15 14.03');
  });

  it('exports data and documents but never secrets or temp files', async () => {
    // Arrange
    const flushAll = vi.fn(async () => undefined);
    const ctx = fakeContext({ paths });

    // Act
    const destination = await exportData(ctx, { flushAll, closeStores: vi.fn() }, NOW);

    // Assert
    expect(flushAll).toHaveBeenCalledOnce();
    expect(destination).toBe(join(paths.exports, 'Rivertide Export 2026-10-15 14.03'));
    expect(readdirSync(join(destination, 'data'))).toEqual(['history.json']);
    expect(readFileSync(join(destination, 'documents', 'doc1.txt'), 'utf8')).toBe('hello');
    expect(readFileSync(join(destination, 'README.txt'), 'utf8')).toContain('API keys are not included');
    expect(existsSync(join(destination, 'media'))).toBe(false);
  });

  it('never overwrites an earlier export from the same minute', async () => {
    // Arrange
    const ctx = fakeContext({ paths });
    const deps = { flushAll: vi.fn(async () => undefined), closeStores: vi.fn() };

    // Act
    const first = await exportData(ctx, deps, NOW);
    const second = await exportData(ctx, deps, NOW);

    // Assert
    expect(second).toBe(`${first} (2)`);
  });

  it('wipe stops store writes, then deletes data, documents and media only', async () => {
    // Arrange
    const ctx = fakeContext({ paths });
    const closeStores = vi.fn();
    mkdirSync(paths.logs, { recursive: true });

    // Act
    await wipeData(ctx, { flushAll: vi.fn(), closeStores });

    // Assert
    expect(closeStores).toHaveBeenCalledOnce();
    expect(existsSync(paths.data)).toBe(false);
    expect(existsSync(paths.documents)).toBe(false);
    expect(existsSync(paths.media)).toBe(false);
    expect(existsSync(paths.logs)).toBe(true);
  });

  it('filters and unique names behave', () => {
    expect(shouldExport('/x/secrets.json')).toBe(false);
    expect(shouldExport('/x/secrets.corrupt-1.json')).toBe(false);
    expect(shouldExport('/x/history.json.bak')).toBe(true);
    expect(uniquePath('/a', (p) => p === '/a' || p === '/a (2)')).toBe('/a (3)');
    expect(() => uniquePath('/a', () => true)).toThrow(/too many exports/);
  });
});
