/**
 * Where Rivertide keeps things on disk. Everything personal lives under `userData`
 * (macOS: ~/Library/Application Support/Rivertide); logs use the OS log folder.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Paths } from './services';

/** The subset of Electron's `app` this module needs (injectable for tests). */
export interface PathSource {
  getPath(name: 'userData' | 'logs' | 'documents'): string;
  getAppPath(): string;
  readonly isPackaged: boolean;
}

const PRIVATE_DIR_MODE = 0o700;

/**
 * `resourcesPath` is `process.resourcesPath` (packaged builds put `native/` there via
 * electron-builder `extraResources`); in development the app folder holds `native/` instead.
 */
export function createPaths(source: PathSource, resourcesPath: string): Paths {
  const userData = source.getPath('userData');
  return Object.freeze({
    userData,
    data: join(userData, 'data'),
    documents: join(userData, 'documents'),
    media: join(userData, 'media'),
    logs: source.getPath('logs'),
    exports: source.getPath('documents'),
    resources: source.isPackaged ? resourcesPath : source.getAppPath(),
  });
}

/** Creates the private folders (owner-only) Rivertide writes to. */
export async function ensureDirectories(paths: Paths): Promise<void> {
  const dirs = [paths.data, paths.documents, paths.media, paths.logs];
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE })));
}

/** Electron reports 'darwin' | 'win32' | 'linux' | others; Rivertide treats unknown Unixes as Linux. */
export function normalizePlatform(platform: string): 'darwin' | 'win32' | 'linux' {
  if (platform === 'darwin' || platform === 'win32') return platform;
  return 'linux';
}
