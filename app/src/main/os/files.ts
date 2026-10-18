/**
 * File search. macOS: Spotlight (`mdfind`) by name and by content, killed after 1.5 s, merged
 * with name matches first. Elsewhere: a bounded breadth-first walk of Desktop/Documents/Downloads.
 */
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join, sep } from 'node:path';
import type { FileHit } from '../services';
import type { ExecFn } from './exec';

export const SEARCH_BUDGET_MS = 1500;
const MAX_QUERY_CHARS = 120;
const MAX_WALK_DEPTH = 4;
const MAX_WALK_ENTRIES = 20_000;
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', 'Library', '.Trash', '__pycache__', '.cache']);

export interface FileSearchDeps {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly exec: ExecFn;
  readonly now?: () => number;
}

/** Hidden files, app internals and system folders are never useful voice results. */
export function isUsefulPath(path: string, home: string): boolean {
  const relative = path.startsWith(home) ? path.slice(home.length) : path;
  const parts = relative.split(sep).filter(Boolean);
  if (parts.some((part) => part.startsWith('.') || SKIP_DIRS.has(part))) return false;
  return !parts.some((part) => /\.(app|photoslibrary|musiclibrary|bundle|framework)$/i.test(part) && part !== parts.at(-1));
}

export function sanitizeQuery(query: string): string {
  return query.replace(/["'`*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
}

export const kindOf = (name: string, isDirectory: boolean): string => {
  if (isDirectory) return 'folder';
  const extension = extname(name).slice(1).toLowerCase();
  return extension || 'file';
};

async function toHit(path: string): Promise<FileHit | null> {
  try {
    const info = await stat(path);
    return { path, name: basename(path), kind: kindOf(path, info.isDirectory()), modifiedAt: info.mtime.toISOString() };
  } catch {
    return null; // vanished between search and stat
  }
}

export function mergeResults(byName: readonly string[], byContent: readonly string[], home: string, limit: number): string[] {
  const seen = new Set<string>();
  return [...byName, ...byContent]
    .map((line) => line.trim())
    .filter((path) => path.length > 0 && isUsefulPath(path, home) && !seen.has(path) && Boolean(seen.add(path)))
    .slice(0, limit);
}

async function spotlight(deps: FileSearchDeps, query: string, limit: number): Promise<string[]> {
  const options = { timeoutMs: SEARCH_BUDGET_MS, maxBuffer: 2 * 1024 * 1024 };
  const [byName, byContent] = await Promise.all([
    deps.exec('mdfind', ['-onlyin', deps.home, '-name', query], options),
    deps.exec('mdfind', ['-onlyin', deps.home, query], options),
  ]);
  // A timed-out search still returns what it found so far.
  return mergeResults(byName.stdout.split('\n'), byContent.stdout.split('\n'), deps.home, limit);
}

/** Breadth-first walk with depth, entry and time budgets; every query word must be in the name. */
export async function walkSearch(roots: readonly string[], query: string, limit: number, now: () => number = Date.now): Promise<string[]> {
  const words = query.toLowerCase().split(' ').filter(Boolean);
  const deadline = now() + SEARCH_BUDGET_MS;
  const found: string[] = [];
  let queue = roots.map((root) => ({ dir: root, depth: 0 }));
  let visited = 0;
  while (queue.length > 0 && found.length < limit && now() < deadline && visited < MAX_WALK_ENTRIES) {
    const next: { dir: string; depth: number }[] = [];
    for (const { dir, depth } of queue) {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        visited += 1;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const path = join(dir, entry.name);
        const name = entry.name.toLowerCase();
        if (words.every((word) => name.includes(word))) found.push(path);
        if (entry.isDirectory() && depth + 1 <= MAX_WALK_DEPTH) next.push({ dir: path, depth: depth + 1 });
      }
      if (found.length >= limit || now() >= deadline) break;
    }
    queue = next;
  }
  return found.slice(0, limit);
}

export async function searchFiles(deps: FileSearchDeps, rawQuery: string, limit: number): Promise<FileHit[]> {
  const query = sanitizeQuery(rawQuery);
  if (!query) return [];
  const paths = deps.platform === 'darwin'
    ? await spotlight(deps, query, limit)
    : await walkSearch(['Desktop', 'Documents', 'Downloads'].map((folder) => join(deps.home, folder)), query, limit, deps.now);
  const hits = await Promise.all(paths.map(toHit));
  return hits.filter((hit): hit is FileHit => hit !== null);
}
