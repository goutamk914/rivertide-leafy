/**
 * OS capabilities beyond the frozen `OsServices` contract (system controls, media keys, Shortcuts,
 * notifications, clipboard reads, quitting apps). `createOsServices` returns them under `extras`;
 * consumers reach them through `osExtras(ctx.os)`, which returns null for plain/fake OsServices.
 * Contract change requested: fold these into `OsServices`.
 */
import type { AppEntry, OsServices } from '../services';
import type { FrontmostApp } from '../../shared/types';
import type { MediaControls } from './media';
import type { ShortcutsControls } from './shortcuts';
import type { SystemControls } from './system';

export interface FocusedTextInfo {
  readonly role: string;
  readonly value: string;
  readonly selectedText: string;
}

export interface OsExtras {
  readonly system: SystemControls;
  readonly media: MediaControls;
  readonly shortcuts: ShortcutsControls;
  notify(title: string, body: string): void;
  readClipboard(): Promise<string>;
  quitApp(entry: AppEntry): Promise<void>;
  focusedText(): Promise<FocusedTextInfo | null>;
  /** Opens `x-apple.systempreferences:` / `ms-settings:` style URLs that openUrl refuses. */
  openSettingsUrl(url: string): Promise<void>;
  /** Brings an app back to the front (macOS); false where unsupported. */
  activateApp(target: FrontmostApp | null): Promise<boolean>;
}

export interface RivertideOs extends OsServices {
  readonly extras: OsExtras;
}

export function osExtras(os: OsServices): OsExtras | null {
  const candidate = (os as Partial<RivertideOs>).extras;
  return candidate && typeof candidate === 'object' ? candidate : null;
}
