/**
 * Paste-at-cursor with clipboard preservation.
 *
 * 1. Snapshot every clipboard format the platform offers (text, HTML, RTF, images…).
 * 2. Put our text on the clipboard and send ⌘V / Ctrl+V to the target app.
 * 3. ~400 ms later restore the snapshot — but only if the clipboard still holds our text.
 * On failure the text stays on the clipboard and we return false, so the user can paste by hand.
 */
import type { FrontmostApp } from '../../shared/types';
import type { Logger } from '../services';
import { runAppleScript, appleScriptString, type ExecFn } from './exec';

export const RESTORE_DELAY_MS = 400;
const SETTLE_MS = 40;
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,200}$/;
const ACTIVATE_SETTLE_MS = 120;

/**
 * PowerShell for typing `text` with SendKeys. The text is NEVER spliced into the script: it travels
 * as base64 (alphabet A–Z a–z 0–9 + / =, inert inside single quotes) and SendKeys' special
 * characters are escaped inside PowerShell after decoding.
 */
export function windowsTypeScript(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  return [
    `$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    "$t = [regex]::Replace($t, '[+^%~(){}\\[\\]]', '{$0}')",
    "$t = [regex]::Replace($t, '\\r?\\n', '{ENTER}')",
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.SendKeys]::SendWait($t)',
  ].join('; ');
}

/**
 * Async clipboard (Electron 44's W3C-style API), narrowed so tests can fake it. `snapshot()`
 * captures every format the platform offers (text, HTML, RTF, images…) as an opaque value.
 */
export interface ClipboardLike {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  snapshot(): Promise<ClipboardSnapshot>;
  restore(snapshot: ClipboardSnapshot): Promise<void>;
}

/** Opaque saved clipboard: one record of MIME type → payload per clipboard item. */
export type ClipboardSnapshot = readonly Readonly<Record<string, unknown>>[];

export interface HelperPaster {
  isReady(): boolean;
  paste(bundleId?: string): Promise<void>;
  typeText(text: string): Promise<void>;
}

export interface PasterDeps {
  readonly platform: NodeJS.Platform;
  readonly clipboard: ClipboardLike;
  readonly helper: HelperPaster | null;
  readonly exec: ExecFn;
  readonly logger: Logger;
  readonly wait?: (ms: number) => Promise<void>;
  readonly schedule?: (fn: () => void, ms: number) => void;
}

export interface Paster {
  paste(text: string, target: FrontmostApp | null): Promise<boolean>;
  typeText(text: string): Promise<boolean>;
  activate(target: FrontmostApp | null): Promise<boolean>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPaster(deps: PasterDeps): Paster {
  const log = deps.logger.child('paste');
  const wait = deps.wait ?? sleep;
  const schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms));

  async function sendPasteKeys(target: FrontmostApp | null): Promise<boolean> {
    if (deps.platform === 'darwin') return macPaste(target);
    if (deps.platform === 'win32') {
      const script = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')";
      return (await deps.exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 4000 })).ok;
    }
    if ((await deps.exec('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], { timeoutMs: 3000 })).ok) return true;
    return (await deps.exec('wtype', ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl'], { timeoutMs: 3000 })).ok;
  }

  async function macPaste(target: FrontmostApp | null): Promise<boolean> {
    const bundleId = target?.bundleId && BUNDLE_ID.test(target.bundleId) ? target.bundleId : undefined;
    if (deps.helper?.isReady()) {
      try {
        await deps.helper.paste(bundleId);
        return true;
      } catch (error) {
        log.warn('helper paste failed; trying AppleScript', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    const activate = bundleId ? `tell application id ${appleScriptString(bundleId)} to activate\ndelay 0.12\n` : '';
    const result = await runAppleScript(deps.exec, `${activate}tell application "System Events" to keystroke "v" using command down`, 4000);
    if (!result.ok) log.warn('AppleScript paste failed', { error: result.error, stderr: result.stderr.slice(0, 200) });
    return result.ok;
  }

  async function saveClipboard(): Promise<ClipboardSnapshot | null> {
    try {
      return await deps.clipboard.snapshot();
    } catch (error) {
      log.warn('could not save the clipboard; it will not be restored', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async function restoreIfUnchanged(text: string, snapshot: ClipboardSnapshot | null): Promise<void> {
    try {
      if (snapshot && (await deps.clipboard.readText()) === text) await deps.clipboard.restore(snapshot);
    } catch (error) {
      log.warn('could not restore the clipboard', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Pastes run one at a time; restores join the same queue so they never interleave with a paste. */
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };
  /** The user's clipboard from before a paste whose restore hasn't happened yet. */
  let pendingRestore: { readonly snapshot: ClipboardSnapshot | null; cancelled: boolean } | null = null;

  function armRestore(text: string, snapshot: ClipboardSnapshot | null): void {
    const entry = { snapshot, cancelled: false };
    pendingRestore = entry;
    schedule(() => {
      if (entry.cancelled) return;
      void enqueue(async () => {
        if (entry.cancelled) return;
        if (pendingRestore === entry) pendingRestore = null;
        await restoreIfUnchanged(text, snapshot);
      });
    }, RESTORE_DELAY_MS);
  }

  async function pasteNow(text: string, target: FrontmostApp | null): Promise<boolean> {
    if (!text) return false;
    // Back-to-back pastes: keep the user's ORIGINAL clipboard, not the previous paste's text.
    const earlier = pendingRestore;
    if (earlier) earlier.cancelled = true;
    pendingRestore = null;
    const snapshot = earlier ? earlier.snapshot : await saveClipboard();
    await deps.clipboard.writeText(text);
    await wait(SETTLE_MS);
    const pasted = await sendPasteKeys(target).catch((error: unknown) => {
      log.warn('paste keystroke failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    });
    if (!pasted) return false; // leave the text on the clipboard so the user can paste it
    armRestore(text, snapshot);
    return true;
  }

  const paste = (text: string, target: FrontmostApp | null): Promise<boolean> => enqueue(() => pasteNow(text, target));

  /** Brings the target app back to the front (macOS) before typing into it. */
  async function activate(target: FrontmostApp | null): Promise<boolean> {
    if (deps.platform !== 'darwin' || !target?.bundleId || !BUNDLE_ID.test(target.bundleId)) return false;
    const result = await runAppleScript(deps.exec, `tell application id ${appleScriptString(target.bundleId)} to activate`, 3000);
    if (result.ok) await wait(ACTIVATE_SETTLE_MS);
    return result.ok;
  }

  async function typeText(text: string): Promise<boolean> {
    if (!text) return false;
    try {
      if (deps.platform === 'darwin') {
        if (deps.helper?.isReady()) {
          await deps.helper.typeText(text);
          return true;
        }
        return (await runAppleScript(deps.exec, `tell application "System Events" to keystroke ${appleScriptString(text)}`, 15_000)).ok;
      }
      if (deps.platform === 'win32') {
        return (await deps.exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', windowsTypeScript(text)], { timeoutMs: 15_000 })).ok;
      }
      if ((await deps.exec('xdotool', ['type', '--delay', '4', '--', text], { timeoutMs: 15_000 })).ok) return true;
      return (await deps.exec('wtype', ['--', text], { timeoutMs: 15_000 })).ok;
    } catch (error) {
      log.warn('typing failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  return { paste, typeText, activate };
}
