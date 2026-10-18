/**
 * `createOsServices(ctx)` — everything Rivertide does to the computer: paste, apps, files, URLs,
 * plus `extras` (system controls, media keys, Shortcuts, notifications). Electron is only touched
 * here; the modules it wires are Electron-free and unit-tested.
 */
import { app, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import type { AppContext, FileHit } from '../services';
import type { FrontmostApp } from '../../shared/types';
import { createAppsService, type AppsService } from './apps';
import { OsActionError } from './errors';
import { runAppleScript, runFile } from './exec';
import type { OsExtras, RivertideOs } from './extras';
import { searchFiles } from './files';
import { createMediaControls, type MediaKey } from './media';
import { createHelperHost, helperBinaryPath, type HelperHost } from './native';
import { createNotifier } from './notify';
import { electronClipboard } from './clipboard';
import { createPaster, type Paster } from './paste';
import { createShortcutsControls } from './shortcuts';
import { createSystemControls } from './system';

const WEB_URL = /^https?:\/\/[^\s]+$/i;
const MAILTO_URL = /^mailto:[^\s]*$/i;
const SETTINGS_URL = /^(x-apple\.systempreferences:|ms-settings:)[A-Za-z0-9._:/-]*$/;
const FRONTMOST_TIMEOUT_MS = 1500;
const WEB_SEARCH_URL = 'https://www.google.com/search?q=';

interface Parts {
  readonly helper: HelperHost;
  readonly paster: Paster;
  readonly apps: AppsService;
  readonly extras: OsExtras;
}

export function createOsServices(ctx: AppContext): RivertideOs {
  let built: Parts | null = null;
  // Built on first use: factories may only store ctx while the context is being assembled.
  const parts = (): Parts => (built ??= buildParts(ctx));

  async function frontmostApp(): Promise<FrontmostApp | null> {
    const { helper } = parts();
    if (helper.isReady() && helper.helper) {
      try {
        return await helper.helper.frontmostApp();
      } catch (error) {
        ctx.logger.child('os').debug('helper frontmostApp failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return ctx.platform === 'darwin' ? frontmostViaAppleScript() : null;
  }

  async function frontmostViaAppleScript(): Promise<FrontmostApp | null> {
    const script = 'tell application "System Events" to get {name, bundle identifier, unix id} of first application process whose frontmost is true';
    const result = await runAppleScript(runFile, script, FRONTMOST_TIMEOUT_MS);
    const [name, bundleId, pid] = result.stdout.trim().split(/,\s*/);
    return result.ok && name ? { name, bundleId: bundleId ?? '', pid: Number(pid) || 0 } : null;
  }

  async function openUrl(url: string): Promise<void> {
    if (!WEB_URL.test(url) && !MAILTO_URL.test(url)) throw new OsActionError('I can only open web links and email links.');
    await shell.openExternal(url);
  }

  return {
    async start() {
      parts().helper.start();
      void parts().apps.refresh();
    },
    stop: () => built?.helper.stop(),
    frontmostApp,
    paste: (text, target) => parts().paster.paste(text, target),
    typeText: (text) => parts().paster.typeText(text),
    copy: (text) => {
      electronClipboard.writeText(text).catch((error: unknown) =>
        ctx.logger.child('os').warn('copy failed', { error: error instanceof Error ? error.message : String(error) }));
    },
    get apps() {
      return parts().apps;
    },
    files: {
      search: (query, options): Promise<readonly FileHit[]> =>
        searchFiles({ platform: ctx.platform, home: homedir(), exec: runFile }, query, options.limit),
      async open(path) {
        if (!isAbsolute(path)) throw new OsActionError('I need the full location of that file to open it.');
        const error = await shell.openPath(path);
        if (error) throw new OsActionError('I couldn’t open that file. It may have been moved or deleted.', { cause: new Error(error) });
      },
      reveal: (path) => shell.showItemInFolder(path),
    },
    openUrl,
    webSearch: (query) => openUrl(`${WEB_SEARCH_URL}${encodeURIComponent(query.trim())}`),
    helperStatus: () => parts().helper.status(),
    onFnKey: (listener) => parts().helper.onFnKey(listener),
    get extras() {
      return parts().extras;
    },
  };
}

function buildParts(ctx: AppContext): Parts {
  const logger = ctx.logger.child('os');
  const helper = createHelperHost({
    platform: ctx.platform,
    binaryPath: helperBinaryPath({ isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath ?? ctx.paths.resources }),
    logger,
  });
  const native = helper.helper;
  const readyHelper = native
    ? {
      isReady: () => helper.isReady(),
      paste: (bundleId?: string) => native.paste(bundleId),
      typeText: (text: string) => native.typeText(text),
      mediaKey: (key: MediaKey) => native.mediaKey(key),
    }
    : null;
  const paster = createPaster({ platform: ctx.platform, clipboard: electronClipboard, helper: readyHelper, exec: runFile, logger });
  const apps = createAppsService({
    platform: ctx.platform, exec: runFile, home: homedir(), env: process.env, logger,
    defaultBrowser: () => app.getApplicationNameForProtocol('https://') || null,
    getFileIcon: async (path) => (await app.getFileIcon(path, { size: 'normal' })).toDataURL(),
    openPath: (path) => shell.openPath(path),
  });
  const system = createSystemControls({
    platform: ctx.platform, exec: runFile, desktopDir: app.getPath('desktop'),
    openExternal: (url) => shell.openExternal(url),
    readTextFile: (path) => readFile(path, 'utf8').catch(() => null),
  });
  const extras: OsExtras = {
    system,
    media: createMediaControls({ platform: ctx.platform, exec: runFile, helper: readyHelper }),
    shortcuts: createShortcutsControls({ platform: ctx.platform, exec: runFile }),
    notify: createNotifier(logger),
    readClipboard: () => electronClipboard.readText(),
    quitApp: (entry) => apps.quit(entry),
    focusedText: async () => (native && helper.isReady() ? native.focusedText().catch(() => null) : null),
    activateApp: (target) => paster.activate(target),
    async openSettingsUrl(url) {
      if (!SETTINGS_URL.test(url)) throw new OsActionError('That isn’t a settings link.');
      await shell.openExternal(url);
    },
  };
  return { helper, paster, apps, extras };
}
