/**
 * Electron 44 clipboard adapter (async, W3C-style `read()`/`write()` with ClipboardItem).
 * Saves every MIME type the platform exposes so a paste can put the user's clipboard back exactly.
 */
import { clipboard, ClipboardItem } from 'electron';
import type { ClipboardLike, ClipboardSnapshot } from './paste';

const BOOKMARK_TYPE = 'electron application/bookmark';

async function snapshot(): Promise<ClipboardSnapshot> {
  const items = await clipboard.read();
  return Promise.all(
    items.map(async (item) => {
      const types = item.types.filter((type) => type !== BOOKMARK_TYPE);
      const entries = await Promise.all(types.map(async (type) => [type, await item.getType(type)] as const));
      return Object.fromEntries(entries);
    }),
  );
}

async function restore(saved: ClipboardSnapshot): Promise<void> {
  const items = saved.filter((record) => Object.keys(record).length > 0);
  if (items.length === 0) {
    clipboard.clear();
    return;
  }
  // Payloads are the Blobs/strings read back from clipboard.read(), so they round-trip as-is.
  await clipboard.write(items.map((record) => new ClipboardItem(record as Record<string, string | Blob>)));
}

export const electronClipboard: ClipboardLike = {
  readText: () => clipboard.readText(),
  writeText: (text) => clipboard.writeText(text),
  snapshot,
  restore,
};
