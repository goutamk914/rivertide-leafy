/** File tools: search_files, open_file, reveal_file. Paths are resolved and checked before use. */
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { clip, defineTool, errorText, fail, ok, plural } from './types';

const DEFAULT_LIMIT = 8;
/** Opening these would run code or install software — use open_app for applications. */
const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.app', '.command', '.sh', '.bash', '.zsh', '.tool', '.scpt', '.scptd', '.applescript', '.terminal', '.workflow',
  '.action', '.pkg', '.mpkg', '.dmg', '.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.jar', '.desktop', '.run', '.appimage',
]);
const ALLOWED_ROOTS = (): readonly string[] => [homedir(), '/Volumes'];

export type PathCheck = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };

const EXECUTABLE_BITS = 0o111;
const insideAny = (path: string, roots: readonly string[]): boolean => roots.some((root) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
});

/**
 * Resolves a model-supplied path (following symlinks) and checks it is a real file inside the home
 * folder or on a connected drive. Programs — by extension, or extensionless files with the
 * executable bit — are refused unless `allowExecutables` (revealing in Finder is harmless).
 */
export async function checkPath(raw: string, options: { readonly allowExecutables: boolean }, roots: readonly string[] = ALLOWED_ROOTS()): Promise<PathCheck> {
  const expanded = raw.startsWith('~/') ? `${homedir()}${raw.slice(1)}` : raw;
  if (!isAbsolute(expanded)) return { ok: false, message: 'I need the full location of that file.' };
  let path: string;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    path = await realpath(resolve(expanded));
    info = await stat(path);
  } catch {
    return { ok: false, message: 'I couldn’t find that file. It may have been moved or deleted.' };
  }
  const realRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => root)));
  if (!insideAny(path, realRoots)) return { ok: false, message: 'I can only open files in your home folder or on a connected drive.' };
  const extension = extname(path).toLowerCase();
  const isProgram = BLOCKED_EXTENSIONS.has(extension) || (extension === '' && info.isFile() && (Number(info.mode) & EXECUTABLE_BITS) !== 0);
  if (!options.allowExecutables && isProgram) {
    return { ok: false, message: 'That’s a program or installer, so I won’t open it from here. I can show it in its folder instead.' };
  }
  return { ok: true, path };
}

const pathSchema = z.object({ path: z.string().trim().min(1).max(1000).describe('Full path of the file, from search_files results.') });

export const searchFilesTool = defineTool({
  name: 'search_files',
  description: 'Search the files on this computer by name and content (Spotlight on macOS). Returns up to `limit` matches with full paths; results are remembered so "open the second one" works.',
  risk: 'read',
  untrustedOutput: true,
  schema: z.object({
    query: z.string().trim().min(1).max(120).describe('Words from the file name or contents.'),
    limit: z.number().int().min(1).max(20).optional().describe('How many results (default 8).'),
  }),
  title: ({ query }) => `Search files for “${clip(query, 40)}”`,
  async run({ query, limit }, context) {
    try {
      const hits = await context.app.os.files.search(query, { limit: limit ?? DEFAULT_LIMIT });
      context.remember({ kind: 'files', items: hits });
      if (hits.length === 0) return ok(`I couldn’t find any files matching “${query}”.`, { results: [] });
      const results = hits.map((hit, index) => ({ n: index + 1, name: hit.name, path: hit.path, kind: hit.kind, modifiedAt: hit.modifiedAt }));
      return ok(`I found ${plural(hits.length, 'file')}. The best match is ${hits[0].name}.`, { results });
    } catch (error) {
      return fail(errorText(error, 'File search didn’t work just now.'));
    }
  },
});

export const openFileTool = defineTool({
  name: 'open_file',
  description: 'Open a document, photo or folder with its default app. Use a full path from search_files. Never for programs.',
  risk: 'act',
  schema: pathSchema,
  title: ({ path }) => `Open ${basename(path)}`,
  async run({ path }, context) {
    const checked = await checkPath(path, { allowExecutables: false });
    if (!checked.ok) return fail(checked.message);
    try {
      await context.app.os.files.open(checked.path);
      return ok(`Opened ${basename(checked.path)}.`);
    } catch (error) {
      return fail(errorText(error, `I couldn’t open ${basename(checked.path)}.`));
    }
  },
});

export const revealFileTool = defineTool({
  name: 'reveal_file',
  description: 'Show a file in its folder (Finder on macOS) without opening it.',
  risk: 'act',
  schema: pathSchema,
  title: ({ path }) => `Show ${basename(path)}`,
  async run({ path }, context) {
    const checked = await checkPath(path, { allowExecutables: true });
    if (!checked.ok) return fail(checked.message);
    context.app.os.files.reveal(checked.path);
    return ok(`Showing ${basename(checked.path)} in its folder.`);
  },
});
