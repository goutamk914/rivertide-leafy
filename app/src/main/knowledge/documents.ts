/**
 * Documents: metadata in the `documents` store, extracted text in `<paths.documents>/<id>.txt`.
 * Imports from a native file picker (multi-select) or pasted text. Per-file import failures are
 * reported to the user as toasts with a readable reason; the rest of the batch still imports.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { dialog } from 'electron';
import type { DocumentKind, DocumentMeta, Id } from '../../shared/types';
import type { AppContext, DocumentsService } from '../services';
import { isSafeId, newId, nowIso } from '../data/ids';
import { DocumentMetaSchema } from '../data/schemas';
import { announceChange, errorMessage, lazyLogger, lazyStore, parseItems } from '../data/store';
import { DOCUMENT_EXTENSIONS, extractFileText, ImportError, MAX_TEXT_CHARS, normalizeText, sanitizeName, type ImporterDeps } from './importers';

interface DocumentsFile { readonly version: 1; readonly documents: readonly DocumentMeta[] }

export interface DocumentsDeps extends ImporterDeps {
  readonly pickFiles: () => Promise<readonly string[]>;
}

const execFileAsync = promisify(execFile);
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

async function pdfToText(data: Uint8Array): Promise<string> {
  const { extractText } = await import('unpdf');
  const { text } = await extractText(data, { mergePages: true });
  return text;
}

async function pickWithDialog(): Promise<readonly string[]> {
  const result = await dialog.showOpenDialog({
    title: 'Add documents',
    buttonLabel: 'Add',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents', extensions: [...DOCUMENT_EXTENSIONS] }],
  });
  return result.canceled ? [] : result.filePaths;
}

export const defaultDocumentsDeps: DocumentsDeps = {
  platform: process.platform,
  stat: (path) => stat(path),
  readFile: (path) => readFile(path),
  execFile: async (file, args, options) => {
    const { stdout } = await execFileAsync(file, [...args], { ...options, encoding: 'utf8' });
    return { stdout };
  },
  pdfToText,
  pickFiles: pickWithDialog,
};

const byNewest = (a: DocumentMeta, b: DocumentMeta): number => b.createdAt.localeCompare(a.createdAt);

export function createDocumentsService(ctx: AppContext, deps: DocumentsDeps = defaultDocumentsDeps): DocumentsService {
  const log = lazyLogger(ctx, 'documents');
  const store = lazyStore<DocumentsFile>(ctx, 'documents', { version: 1, documents: [] }, (raw) => ({
    version: 1,
    documents: parseItems(raw, 'documents', DocumentMetaSchema, log).filter((meta) => isSafeId(meta.id)),
  }));

  const metas = (): readonly DocumentMeta[] => store().read().documents;
  const textPath = (id: Id): string => join(ctx.paths.documents, `${id}.txt`);
  const write = (next: readonly DocumentMeta[]): void => {
    store().write({ version: 1, documents: next });
    announceChange(ctx, 'documents');
  };

  /** Private like the JSON stores: owner-only folder and files. */
  const saveText = (id: Id, text: string): void => {
    mkdirSync(ctx.paths.documents, { recursive: true, mode: DIR_MODE });
    const tmp = `${textPath(id)}.tmp`;
    writeFileSync(tmp, text, { encoding: 'utf8', mode: FILE_MODE });
    renameSync(tmp, textPath(id));
  };

  const add = (name: string, kind: DocumentKind, text: string, sourcePath: string | null): DocumentMeta => {
    const meta: DocumentMeta = { id: newId(), name: sanitizeName(name), kind, chars: text.length, createdAt: nowIso(), sourcePath };
    saveText(meta.id, text);
    write([meta, ...metas()]);
    log().info('Imported a document', { id: meta.id, kind, chars: meta.chars });
    return meta;
  };

  const importFile = async (path: string): Promise<DocumentMeta> => {
    const { name, kind, text } = await extractFileText(path, deps);
    return add(name, kind, text, path);
  };

  const reportFailure = (path: string, error: unknown): void => {
    const message = error instanceof ImportError ? error.message : 'A file could not be added. Please try again.';
    log().warn('Document import failed', { file: basename(path), error: errorMessage(error), cause: error instanceof Error ? errorMessage(error.cause) : null });
    ctx.bus.emit('toast', { kind: 'error', message });
  };

  return {
    list: () => [...metas()].sort(byNewest),

    async pick() {
      const paths = await deps.pickFiles();
      const imported: DocumentMeta[] = [];
      for (const path of paths) {
        try {
          imported.push(await importFile(path));
        } catch (error) {
          reportFailure(path, error);
        }
      }
      if (imported.length > 0) {
        const noun = imported.length === 1 ? 'document' : 'documents';
        ctx.bus.emit('toast', { kind: 'success', message: `Added ${imported.length} ${noun}.` });
      }
      return imported;
    },

    importText(name, text) {
      const clean = normalizeText(text);
      if (!clean) throw new ImportError('There is no text to save. Paste some text and try again.');
      if (clean.length > MAX_TEXT_CHARS) throw new ImportError('This text is longer than Rivertide can keep (about 2 MB). Try splitting it up.');
      return add(name, 'text', clean, null);
    },

    importFile,

    get(id) {
      const meta = metas().find((entry) => entry.id === id);
      if (!meta) return null;
      try {
        return { meta, text: readFileSync(textPath(meta.id), 'utf8') };
      } catch (error) {
        log().error('Document text is missing on disk', { id, error: errorMessage(error) });
        return null;
      }
    },

    delete(id) {
      const current = metas();
      const kept = current.filter((entry) => entry.id !== id);
      if (kept.length === current.length) return;
      write(kept);
      if (!isSafeId(id)) return;
      try {
        rmSync(textPath(id), { force: true });
      } catch (error) {
        log().warn('Could not remove document text file', { id, error: errorMessage(error) });
      }
    },
  };
}
