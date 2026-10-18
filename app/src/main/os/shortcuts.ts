/**
 * Apple Shortcuts via the `shortcuts` CLI (macOS only). A shortcut runs only if it exists in the
 * user's own list (names are matched case-insensitively), with a 30 s timeout.
 */
import type { ExecFn } from './exec';
import { notAvailable, OsActionError } from './errors';

export const SHORTCUT_RUN_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 10_000;

export interface ShortcutsControls {
  list(): Promise<readonly string[]>;
  /** Runs the shortcut and returns its text output (may be empty). */
  run(name: string): Promise<{ readonly name: string; readonly output: string }>;
}

export function createShortcutsControls(deps: { readonly platform: NodeJS.Platform; readonly exec: ExecFn }): ShortcutsControls {
  async function list(): Promise<readonly string[]> {
    if (deps.platform !== 'darwin') throw notAvailable('Shortcuts');
    const result = await deps.exec('shortcuts', ['list'], { timeoutMs: LIST_TIMEOUT_MS });
    if (!result.ok) throw new OsActionError('I couldn’t read your Shortcuts list.', { cause: new Error(result.error ?? 'failed') });
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async function run(name: string): Promise<{ name: string; output: string }> {
    const wanted = name.trim().toLowerCase();
    const match = (await list()).find((shortcut) => shortcut.toLowerCase() === wanted);
    if (!match) throw new OsActionError(`I couldn’t find a shortcut called “${name.trim()}”.`);
    const result = await deps.exec('shortcuts', ['run', match], { timeoutMs: SHORTCUT_RUN_TIMEOUT_MS });
    if (result.timedOut) throw new OsActionError(`The “${match}” shortcut took too long, so I stopped it.`);
    if (!result.ok) throw new OsActionError(`The “${match}” shortcut didn’t finish.`, { cause: new Error(result.stderr.slice(0, 200)) });
    return { name: match, output: result.stdout.trim().slice(0, 2000) };
  }

  return { list, run };
}
