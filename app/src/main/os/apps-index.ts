/**
 * Installed-app discovery per platform:
 *  - macOS: .app bundles in the standard folders (+ one level of subfolders), names and bundle ids
 *    read from Info.plist with `plutil`.
 *  - Windows: Start Menu shortcuts (.lnk).
 *  - Linux: .desktop entries (Name=, NoDisplay=).
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';
import type { AppEntry } from '../services';
import type { ExecFn } from './exec';
import { indexApp, type IndexedApp } from './apps-match';

const PLIST_CONCURRENCY = 8;
const PLIST_TIMEOUT_MS = 2000;
const MAX_WINDOWS_DEPTH = 3;

export interface ScanDeps {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly exec: ExecFn;
  readonly listDir?: (dir: string) => Promise<readonly { name: string; isDirectory: boolean }[]>;
}

async function defaultListDir(dir: string) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() || entry.isSymbolicLink() }));
  } catch {
    return []; // missing folder (e.g. no ~/Applications) is normal
  }
}

export const macAppFolders = (home: string): string[] => [
  '/Applications', '/System/Applications', '/System/Applications/Utilities', join(home, 'Applications'),
];

/** Every .app bundle in the folders and one level of plain subfolders (e.g. /Applications/Utilities). */
export async function findMacBundles(home: string, listDir: NonNullable<ScanDeps['listDir']>): Promise<string[]> {
  const bundles = new Set<string>(['/System/Library/CoreServices/Finder.app']);
  for (const folder of macAppFolders(home)) {
    for (const entry of await listDir(folder)) {
      if (!entry.isDirectory) continue;
      const path = join(folder, entry.name);
      if (entry.name.endsWith('.app')) {
        bundles.add(path);
        continue;
      }
      if (entry.name.startsWith('.')) continue;
      (await listDir(path)).filter((child) => child.isDirectory && child.name.endsWith('.app')).forEach((child) => bundles.add(join(path, child.name)));
    }
  }
  return [...bundles];
}

const PlistSchema = z.object({
  CFBundleIdentifier: z.string().optional(),
  CFBundleDisplayName: z.string().optional(),
  CFBundleName: z.string().optional(),
}).passthrough();

async function readBundleInfo(exec: ExecFn, bundle: string): Promise<IndexedApp> {
  const folderName = basename(bundle, '.app');
  const plist = join(bundle, 'Contents', 'Info.plist');
  const json = await exec('plutil', ['-convert', 'json', '-o', '-', plist], { timeoutMs: PLIST_TIMEOUT_MS });
  let info = json.ok ? PlistSchema.safeParse(safeParse(json.stdout)).data : undefined;
  if (!info) {
    const id = await exec('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { timeoutMs: PLIST_TIMEOUT_MS });
    info = { CFBundleIdentifier: id.ok ? id.stdout.trim() : undefined };
  }
  const entry: AppEntry = { name: folderName, path: bundle, bundleId: info.CFBundleIdentifier?.trim() || null };
  return indexApp(entry, [info.CFBundleDisplayName ?? '', info.CFBundleName ?? '']);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // plists with date/data values cannot convert to JSON; caller falls back
  }
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function scanMac(deps: ScanDeps, listDir: NonNullable<ScanDeps['listDir']>): Promise<IndexedApp[]> {
  const bundles = await findMacBundles(deps.home, listDir);
  return mapLimited(bundles, PLIST_CONCURRENCY, (bundle) => readBundleInfo(deps.exec, bundle));
}

async function walkShortcuts(dir: string, depth: number, listDir: NonNullable<ScanDeps['listDir']>): Promise<string[]> {
  if (depth > MAX_WINDOWS_DEPTH) return [];
  const found: string[] = [];
  for (const entry of await listDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) found.push(...(await walkShortcuts(path, depth + 1, listDir)));
    else if (extname(entry.name).toLowerCase() === '.lnk' && !/uninstall/i.test(entry.name)) found.push(path);
  }
  return found;
}

async function scanWindows(deps: ScanDeps, listDir: NonNullable<ScanDeps['listDir']>): Promise<IndexedApp[]> {
  const roots = [
    deps.env.ProgramData ? join(deps.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null,
    deps.env.APPDATA ? join(deps.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null,
  ].filter((root): root is string => root !== null);
  const links = (await Promise.all(roots.map((root) => walkShortcuts(root, 0, listDir)))).flat();
  return links.map((path) => indexApp({ name: basename(path, '.lnk'), path, bundleId: null }));
}

/** Parses the [Desktop Entry] group of a .desktop file; null for hidden or non-app entries. */
export function parseDesktopEntry(text: string): { name: string; genericName: string | null } | null {
  const group = /\[Desktop Entry\]([\s\S]*?)(?:\n\[|$)/.exec(text)?.[1] ?? '';
  const value = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(group)?.[1]?.trim() ?? null;
  if (value('NoDisplay') === 'true' || value('Hidden') === 'true') return null;
  if ((value('Type') ?? 'Application') !== 'Application') return null;
  const name = value('Name');
  return name ? { name, genericName: value('GenericName') } : null;
}

async function scanLinux(deps: ScanDeps, listDir: NonNullable<ScanDeps['listDir']>): Promise<IndexedApp[]> {
  const roots = ['/usr/share/applications', join(deps.home, '.local', 'share', 'applications'), '/var/lib/flatpak/exports/share/applications'];
  const apps: IndexedApp[] = [];
  for (const root of roots) {
    for (const entry of await listDir(root)) {
      if (!entry.name.endsWith('.desktop')) continue;
      const path = join(root, entry.name);
      const parsed = parseDesktopEntry(await readFile(path, 'utf8').catch(() => ''));
      if (parsed) apps.push(indexApp({ name: parsed.name, path, bundleId: basename(entry.name, '.desktop') }, [parsed.genericName ?? '']));
    }
  }
  return apps;
}

/** Scans installed apps; never throws (an empty list just means nothing was found). */
export async function scanApps(deps: ScanDeps): Promise<IndexedApp[]> {
  const listDir = deps.listDir ?? defaultListDir;
  const scanned = deps.platform === 'darwin'
    ? await scanMac(deps, listDir)
    : deps.platform === 'win32' ? await scanWindows(deps, listDir) : await scanLinux(deps, listDir);
  const byPath = new Map(scanned.map((app) => [app.entry.path, app]));
  return [...byPath.values()].sort((a, b) => a.entry.name.localeCompare(b.entry.name));
}
