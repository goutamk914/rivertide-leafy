/**
 * Installed apps: cached index, fuzzy find/search, icons (data URLs, cached), open and quit.
 */
import { basename } from 'node:path';
import type { AppEntry, Logger, OsServices } from '../services';
import { appleScriptString, runAppleScript, type ExecFn } from './exec';
import { findApp, searchApps, type IndexedApp } from './apps-match';
import { scanApps } from './apps-index';
import { notAvailable, OsActionError } from './errors';

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,200}$/;

export interface AppsDeps {
  readonly platform: NodeJS.Platform;
  readonly exec: ExecFn;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly logger: Logger;
  readonly defaultBrowser: () => string | null;
  readonly getFileIcon: (path: string) => Promise<string | null>;
  /** Electron `shell.openPath`: resolves to '' on success or an error message. */
  readonly openPath: (path: string) => Promise<string>;
  readonly scan?: () => Promise<IndexedApp[]>;
}

export type AppsService = OsServices['apps'] & { quit(entry: AppEntry): Promise<void> };

export function createAppsService(deps: AppsDeps): AppsService {
  const log = deps.logger.child('apps');
  const scan = deps.scan ?? (() => scanApps({ platform: deps.platform, home: deps.home, env: deps.env, exec: deps.exec }));
  const icons = new Map<string, string | null>();
  let indexed: readonly IndexedApp[] = [];
  let refreshing: Promise<void> | null = null;

  function refresh(): Promise<void> {
    refreshing ??= scan()
      .then((apps) => {
        indexed = apps;
        log.info('app index ready', { count: apps.length });
      })
      .catch((error: unknown) => log.error('app scan failed', { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  const context = () => ({ apps: indexed, defaultBrowser: deps.defaultBrowser() });

  async function iconDataUrl(path: string): Promise<string | null> {
    if (icons.has(path)) return icons.get(path) ?? null;
    const icon = await deps.getFileIcon(path).catch(() => null);
    icons.set(path, icon);
    return icon;
  }

  async function open(entry: AppEntry): Promise<void> {
    if (deps.platform === 'darwin') {
      const result = await deps.exec('open', ['-a', entry.path]);
      if (!result.ok) throw new OsActionError(`I couldn’t open ${entry.name}.`, { cause: new Error(result.error ?? 'failed') });
      return;
    }
    if (deps.platform === 'linux') {
      const result = await deps.exec('gtk-launch', [entry.bundleId ?? basename(entry.path, '.desktop')]);
      if (!result.ok) throw new OsActionError(`I couldn’t open ${entry.name}.`);
      return;
    }
    const error = await deps.openPath(entry.path);
    if (error) throw new OsActionError(`I couldn’t open ${entry.name}.`, { cause: new Error(error) });
  }

  async function quit(entry: AppEntry): Promise<void> {
    if (deps.platform !== 'darwin') throw notAvailable('Quitting apps');
    const target = entry.bundleId && BUNDLE_ID.test(entry.bundleId)
      ? `application id ${appleScriptString(entry.bundleId)}`
      : `application ${appleScriptString(entry.name)}`;
    const result = await runAppleScript(deps.exec, `tell ${target} to quit`, 8000);
    if (!result.ok) throw new OsActionError(`I couldn’t quit ${entry.name}. It may be asking you to save something.`);
  }

  return {
    list() {
      if (indexed.length === 0) void refresh();
      return indexed.map((app) => app.entry);
    },
    find: (query) => findApp(query, context()),
    search: (query, limit) => searchApps(query, indexed, limit),
    iconDataUrl,
    open,
    quit,
    refresh,
  };
}
