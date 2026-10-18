/**
 * Settings → Privacy: export a copy of everything (never the API keys) and wipe everything.
 */
import { app, BrowserWindow, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AppContext } from '../../services';
import { OK } from '../ok';
import type { Handle } from '../types';

export interface DataHandlerDeps {
  /** Writes pending store changes so the export is complete. */
  readonly flushAll: () => Promise<void>;
  /** Stops all store writes so nothing is recreated after a wipe. */
  readonly closeStores: () => void;
}

const RELAUNCH_DELAY_MS = 150;
const MAX_NAME_ATTEMPTS = 100;

const EXPORT_README = [
  'Rivertide export',
  '',
  'This folder is a copy of what Rivertide keeps on your computer:',
  '  data/       settings, history, notes, reminders, knowledge, dictionary, chats (JSON files)',
  '  documents/  the text of documents you imported',
  '',
  'Your API keys are not included. Nothing here was sent anywhere.',
  '',
].join('\n');

const pad = (value: number): string => String(value).padStart(2, '0');

/** "Rivertide Export 2026-10-15 14.03" in local time (dots: colons aren't allowed in Finder names). */
export function exportFolderName(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `Rivertide Export ${day} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

/** Secrets (and their backups) and half-written temp files are never exported. */
export function shouldExport(source: string): boolean {
  const name = basename(source);
  return !name.startsWith('secrets.') && !name.endsWith('.tmp');
}

export function uniquePath(base: string, exists: (path: string) => boolean): string {
  if (!exists(base)) return base;
  for (let attempt = 2; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = `${base} (${attempt})`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error('There are too many exports with the same name. Move some old exports and try again.');
}

async function copyIfExists(source: string, destination: string): Promise<void> {
  if (!existsSync(source)) return;
  await cp(source, destination, { recursive: true, filter: (path) => shouldExport(path) });
}

export async function exportData(ctx: AppContext, deps: DataHandlerDeps, now: Date = new Date()): Promise<string> {
  await deps.flushAll();
  const destination = uniquePath(join(ctx.paths.exports, exportFolderName(now)), existsSync);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await copyIfExists(ctx.paths.data, join(destination, 'data'));
  await copyIfExists(ctx.paths.documents, join(destination, 'documents'));
  await writeFile(join(destination, 'README.txt'), EXPORT_README, { mode: 0o600 });
  ctx.logger.child('data').info('data exported', { destination });
  return destination;
}

export async function wipeData(ctx: AppContext, deps: DataHandlerDeps): Promise<void> {
  deps.closeStores();
  const dirs = [ctx.paths.data, ctx.paths.documents, ctx.paths.media];
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  ctx.logger.child('data').warn('all Rivertide data was deleted at the user\'s request');
}

export function registerDataHandlers(ctx: AppContext, handle: Handle, deps: DataHandlerDeps): void {
  const log = ctx.logger.child('data');
  handle('data:export', async () => {
    const path = await exportData(ctx, deps);
    shell.showItemInFolder(path);
    return { path };
  });
  handle('data:wipe', async () => {
    await wipeData(ctx, deps);
    await session.defaultSession.clearStorageData().catch((error: unknown) => log.error('could not clear browser storage', { error }));
    // Reply first, then start over with empty data. app.exit() skips will-quit, so destroy the
    // windows here (overlay panels left alive during exit can crash Electron on macOS).
    setTimeout(() => {
      BrowserWindow.getAllWindows().forEach((win) => win.destroy());
      app.relaunch();
      app.exit(0);
    }, RELAUNCH_DELAY_MS);
    return OK;
  });
}
