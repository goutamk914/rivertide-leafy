/** Pure helpers for documents dropped onto the page (read in the renderer, imported as text). */
import type { DocumentKind } from '@shared/types';

/** Matches the `documents:importText` limit in the IPC contract. */
export const MAX_IMPORT_CHARS = 2_000_000;
/** Bytes are a cheap pre-check before reading; UTF-8 text is at most ~4 bytes per character. */
export const MAX_IMPORT_BYTES = MAX_IMPORT_CHARS * 4;
const MAX_NAME = 160;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'log', 'text']);
const PICKER_EXTENSIONS = new Set(['pdf', 'docx', 'rtf', 'doc', 'pages']);

export type DropVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Decides whether a dropped file can be read here, with a sentence that says what to do otherwise. */
export function checkDroppedFile(name: string, sizeBytes: number, mimeType = ''): DropVerdict {
  const ext = extension(name);
  if (PICKER_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `${name} needs the Import button, which can read ${ext.toUpperCase()} files.` };
  }
  if (!TEXT_EXTENSIONS.has(ext) && !mimeType.startsWith('text/')) {
    return { ok: false, reason: `${name} isn’t a text file. Use Import to add PDFs, Word or text files.` };
  }
  if (sizeBytes > MAX_IMPORT_BYTES) {
    return { ok: false, reason: `${name} is too large to add. Split it into smaller files and try again.` };
  }
  return { ok: true };
}

/** Keeps names within the contract limit while preserving the extension. */
export function safeDocumentName(name: string): string {
  const trimmed = name.trim() || 'Untitled.txt';
  if (trimmed.length <= MAX_NAME) return trimmed;
  const ext = extension(trimmed);
  const keep = MAX_NAME - (ext ? ext.length + 2 : 1);
  return `${trimmed.slice(0, keep)}…${ext ? `.${ext}` : ''}`;
}

const KIND_LABELS: Readonly<Record<DocumentKind, string>> = {
  text: 'Text',
  markdown: 'Markdown',
  pdf: 'PDF',
  html: 'Web page',
  rtf: 'Rich text',
  docx: 'Word',
  csv: 'Spreadsheet (CSV)',
  other: 'Document',
};

export function kindLabel(kind: DocumentKind): string {
  return KIND_LABELS[kind];
}
