/**
 * Turns a user-picked file into plain text.
 *  - txt, md, csv, json: read directly (UTF-8, Latin-1 fallback)
 *  - html: tags stripped, entities decoded
 *  - rtf, doc, docx: macOS `textutil -convert txt -stdout <file>` (execFile, timeout)
 *  - pdf: unpdf (serverless pdf.js build — no worker, no canvas, zero dependencies)
 * Failures throw `ImportError` with a plain-language message for the user.
 */
import { basename, extname } from 'node:path';
import type { DocumentKind } from '../../shared/types';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_CHARS = 2 * 1024 * 1024;
export const TEXTUTIL_TIMEOUT_MS = 30_000;
export const PDF_TIMEOUT_MS = 60_000;
const TEXTUTIL = '/usr/bin/textutil';
const LATIN1_FALLBACK_RATIO = 0.01;

export const DOCUMENT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'rtf', 'doc', 'docx', 'pdf'] as const;

const KIND_BY_EXTENSION: Readonly<Record<string, DocumentKind>> = {
  txt: 'text', md: 'markdown', markdown: 'markdown', csv: 'csv', json: 'other',
  html: 'html', htm: 'html', rtf: 'rtf', doc: 'docx', docx: 'docx', pdf: 'pdf',
};

export class ImportError extends Error {
  override readonly name = 'ImportError';
}

export interface ImporterDeps {
  readonly platform: NodeJS.Platform;
  readonly stat: (path: string) => Promise<{ readonly size: number; isFile(): boolean }>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly execFile: (file: string, args: readonly string[], options: { readonly timeout: number; readonly maxBuffer: number }) => Promise<{ readonly stdout: string }>;
  readonly pdfToText: (data: Uint8Array) => Promise<string>;
}

export function extensionOf(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

export function kindForExtension(extension: string): DocumentKind | null {
  return KIND_BY_EXTENSION[extension] ?? null;
}

export function sanitizeName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return clean || 'Untitled document';
}

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '], ['#39', "'"],
]);
/** Longest tag we try to strip; bounding it keeps stripping linear on malformed input. */
const MAX_TAG_CHARS = 2000;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) return safeCodePoint(Number.parseInt(lower.slice(2), 16), match);
    if (lower.startsWith('#') && lower !== '#39') return safeCodePoint(Number.parseInt(lower.slice(1), 10), match);
    return ENTITIES.get(lower) ?? match;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HIDDEN_BLOCK = /<(script|style|noscript|template|svg)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const BLOCK_END = /<\/(p|div|li|h[1-6]|tr|blockquote|section|article|header|footer|pre|table|ul|ol)\s*>/gi;
const LIST_ITEM = new RegExp(`<li\\b[^<>]{0,${MAX_TAG_CHARS}}>`, 'gi');
const ANY_TAG = new RegExp(`<[^<>]{1,${MAX_TAG_CHARS}}>`, 'g');

/** Unclosed comments and blocks run to the end of input instead of re-scanning (linear time). */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(COMMENT, ' ')
    .replace(HIDDEN_BLOCK, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_END, '\n\n')
    .replace(LIST_ITEM, '\n• ')
    .replace(ANY_TAG, ' ');
  return normalizeText(decodeEntities(stripped));
}

export function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const replacements = (utf8.match(/\uFFFD/g) ?? []).length;
  if (utf8.length > 0 && replacements / utf8.length > LATIN1_FALLBACK_RATIO) return new TextDecoder('latin1').decode(bytes);
  return utf8;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImportError(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function convertWithTextutil(path: string, name: string, deps: ImporterDeps): Promise<string> {
  if (deps.platform !== 'darwin') {
    throw new ImportError(`${name}: Word and RTF files can only be read on a Mac. Save it as a PDF or plain text and try again.`);
  }
  try {
    const { stdout } = await deps.execFile(TEXTUTIL, ['-convert', 'txt', '-stdout', path], {
      timeout: TEXTUTIL_TIMEOUT_MS,
      maxBuffer: MAX_TEXT_CHARS * 4,
    });
    return stdout;
  } catch (error) {
    throw new ImportError(`${name}: Rivertide couldn't read this file. It may be damaged or password-protected. Try saving it again as a PDF.`, { cause: error });
  }
}

async function readPdf(bytes: Uint8Array, name: string, deps: ImporterDeps): Promise<string> {
  try {
    return await withTimeout(deps.pdfToText(bytes), PDF_TIMEOUT_MS, `${name}: This PDF took too long to read.`);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(`${name}: Rivertide couldn't read this PDF. It may be damaged, password-protected or only contain scanned images.`, { cause: error });
  }
}

async function rawText(path: string, kind: DocumentKind, name: string, deps: ImporterDeps): Promise<string> {
  if (kind === 'rtf' || kind === 'docx') return convertWithTextutil(path, name, deps);
  const bytes = await deps.readFile(path);
  if (kind === 'pdf') return readPdf(bytes, name, deps);
  return decodeText(bytes);
}

export async function extractFileText(path: string, deps: ImporterDeps): Promise<{ readonly name: string; readonly kind: DocumentKind; readonly text: string }> {
  const name = sanitizeName(basename(path));
  const kind = kindForExtension(extensionOf(path));
  if (!kind) throw new ImportError(`${name}: This kind of file isn't supported. Try a PDF, Word, text or web page file.`);
  const info = await deps.stat(path).catch((error: unknown) => {
    throw new ImportError(`${name}: Rivertide couldn't find this file. It may have been moved.`, { cause: error });
  });
  if (!info.isFile()) throw new ImportError(`${name}: This is a folder, not a file. Pick the files inside it instead.`);
  if (info.size > MAX_FILE_BYTES) throw new ImportError(`${name}: This file is larger than 25 MB. Try splitting it into smaller files.`);
  const raw = await rawText(path, kind, name, deps);
  const text = kind === 'html' ? htmlToText(raw) : normalizeText(raw);
  if (!text) throw new ImportError(`${name}: No readable text was found. If it's a scanned document, it may only contain pictures of text.`);
  if (text.length > MAX_TEXT_CHARS) throw new ImportError(`${name}: This file has more text than Rivertide can keep (about 2 MB). Try splitting it into smaller files.`);
  return { name, kind, text };
}
