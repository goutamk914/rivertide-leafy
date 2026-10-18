import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPaths, ensureDirectories, normalizePlatform, type PathSource } from '../../../src/main/paths';

const source = (isPackaged: boolean): PathSource => ({
  getPath: (name) => ({ userData: '/Users/me/Library/Application Support/Rivertide', logs: '/Users/me/Library/Logs/Rivertide', documents: '/Users/me/Documents' })[name],
  getAppPath: () => '/repo/app',
  isPackaged,
});

describe('paths', () => {
  it('keeps personal data in subfolders of userData and exports in Documents', () => {
    // Act
    const paths = createPaths(source(true), '/Applications/Rivertide.app/Contents/Resources');

    // Assert
    expect(paths).toEqual({
      userData: '/Users/me/Library/Application Support/Rivertide',
      data: '/Users/me/Library/Application Support/Rivertide/data',
      documents: '/Users/me/Library/Application Support/Rivertide/documents',
      media: '/Users/me/Library/Application Support/Rivertide/media',
      logs: '/Users/me/Library/Logs/Rivertide',
      exports: '/Users/me/Documents',
      resources: '/Applications/Rivertide.app/Contents/Resources',
    });
    expect(Object.isFrozen(paths)).toBe(true);
  });

  it('uses the app folder for resources in development', () => {
    expect(createPaths(source(false), '/electron/resources').resources).toBe('/repo/app');
  });

  it('creates owner-only folders', async () => {
    // Arrange
    const root = mkdtempSync(join(tmpdir(), 'rivertide-paths-'));
    const paths = createPaths({ getPath: (name) => join(root, name), getAppPath: () => root, isPackaged: false }, root);

    // Act
    await ensureDirectories(paths);

    // Assert
    expect(statSync(paths.data).mode & 0o777).toBe(0o700);
    expect(statSync(paths.media).isDirectory()).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('normalises platforms', () => {
    expect(normalizePlatform('darwin')).toBe('darwin');
    expect(normalizePlatform('win32')).toBe('win32');
    expect(normalizePlatform('freebsd')).toBe('linux');
  });
});
