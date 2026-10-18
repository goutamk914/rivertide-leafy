import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { defaultDocumentsDeps } from '../../../src/main/knowledge/documents';
import {
  decodeText, extractFileText, htmlToText, ImportError, kindForExtension, MAX_FILE_BYTES, MAX_TEXT_CHARS, sanitizeName,
} from '../../../src/main/knowledge/importers';
import { createFakeContext, fakeDocumentsDeps, tempPath } from '../data/fake-context';

/** A minimal one-page PDF with real text, offsets computed so the xref table is valid. */
function makePdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('importers', () => {
  it('maps extensions to kinds and rejects unknown ones', () => {
    expect(kindForExtension('md')).toBe('markdown');
    expect(kindForExtension('doc')).toBe('docx');
    expect(kindForExtension('exe')).toBeNull();
  });

  it('strips html to readable text and decodes entities', () => {
    const html = '<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Visit&nbsp;notes</h1><p>BP 120/80 &amp; pulse 72</p><ul><li>Rest</li><li>Fluids &#8211; lots</li></ul><!-- hidden --></body></html>';
    expect(htmlToText(html)).toBe('Visit notes\n\nBP 120/80 & pulse 72\n\n• Rest\n\n• Fluids – lots');
  });

  it('strips malformed html in linear time and ignores unknown entities', () => {
    // Arrange
    const comparisons = 'x < y and '.repeat(40_000);
    const unclosed = '<!-- open '.repeat(30_000);

    // Act
    const started = performance.now();
    const fromComparisons = htmlToText(comparisons);
    htmlToText(unclosed);
    htmlToText('<li '.repeat(30_000));
    const elapsed = performance.now() - started;

    // Assert
    expect(elapsed).toBeLessThan(1500);
    expect(fromComparisons.startsWith('x < y and')).toBe(true);
    expect(htmlToText('<p>Kept</p><!-- never closed <p>hidden</p>')).toBe('Kept');
    expect(htmlToText('a &constructor; b &toString;')).toBe('a &constructor; b &toString;');
  });

  it('sanitizes names and decodes Latin-1 when UTF-8 fails', () => {
    expect(sanitizeName('../../etc/pass\u0000wd:  report?.txt')).toBe('..-..-etc-passwd- report-.txt');
    expect(sanitizeName('   ')).toBe('Untitled document');
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
    expect(decodeText(new TextEncoder().encode('\uFEFFhello'))).toContain('hello');
  });

  it('reads text files and normalises whitespace', async () => {
    const deps = { ...fakeDocumentsDeps(), readFile: vi.fn(async () => new TextEncoder().encode('Line one  \r\n\r\n\r\n\r\nLine\ttwo')) };
    await expect(extractFileText('/x/notes.txt', deps)).resolves.toEqual({ name: 'notes.txt', kind: 'text', text: 'Line one\n\nLine two' });
  });

  it('converts Word and RTF files with textutil via execFile and an argument array', async () => {
    // Arrange
    const deps = { ...fakeDocumentsDeps(), execFile: vi.fn(async () => ({ stdout: 'Converted words' })) };

    // Act
    const result = await extractFileText('/x/Letter.docx', deps);

    // Assert
    expect(result).toMatchObject({ kind: 'docx', text: 'Converted words' });
    expect(deps.execFile).toHaveBeenCalledWith('/usr/bin/textutil', ['-convert', 'txt', '-stdout', '/x/Letter.docx'], expect.objectContaining({ timeout: 30_000 }));
  });

  it('gives readable per-file errors', async () => {
    const base = fakeDocumentsDeps();
    const cases: [string, Parameters<typeof extractFileText>[1], RegExp][] = [
      ['/x/a.exe', base, /isn't supported/],
      ['/x/big.pdf', { ...base, stat: vi.fn(async () => ({ size: MAX_FILE_BYTES + 1, isFile: () => true })) }, /larger than 25 MB/],
      ['/x/gone.txt', { ...base, stat: vi.fn(async () => { throw new Error('ENOENT'); }) }, /couldn't find/],
      ['/x/dir.txt', { ...base, stat: vi.fn(async () => ({ size: 1, isFile: () => false })) }, /folder/],
      ['/x/a.rtf', { ...base, platform: 'linux' }, /only be read on a Mac/],
      ['/x/a.doc', { ...base, execFile: vi.fn(async () => { throw new Error('exit 1'); }) }, /damaged or password-protected/],
      ['/x/scan.pdf', { ...base, pdfToText: vi.fn(async () => '   ') }, /No readable text/],
      ['/x/bad.pdf', { ...base, pdfToText: vi.fn(async () => { throw new Error('Invalid PDF'); }) }, /couldn't read this PDF/],
      ['/x/huge.txt', { ...base, readFile: vi.fn(async () => new TextEncoder().encode('a'.repeat(MAX_TEXT_CHARS + 1))) }, /more text than/],
    ];
    for (const [path, deps, message] of cases) {
      const error = await extractFileText(path, deps).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ImportError);
      expect((error as Error).message).toMatch(message);
    }
  });

  it('extracts text from a real PDF with unpdf', async () => {
    const text = await defaultDocumentsDeps.pdfToText(makePdf('Hello Rivertide'));
    expect(text).toContain('Hello Rivertide');
  });
});

describe('documents service', () => {
  it('imports pasted text, stores it on disk, and deletes both metadata and file', () => {
    // Arrange
    const { ctx, documentsDir, of } = createFakeContext();

    // Act
    const meta = ctx.documents.importText('Care plan / week 1', 'Rest   after\r\ninfusions.');
    const stored = ctx.documents.get(meta.id);
    const file = join(documentsDir, `${meta.id}.txt`);
    const existedBefore = existsSync(file);
    const modeBefore = statSync(file).mode & 0o777;
    ctx.documents.delete(meta.id);

    // Assert
    expect(meta).toMatchObject({ name: 'Care plan - week 1', kind: 'text', chars: 'Rest after\ninfusions.'.length, sourcePath: null });
    expect(stored?.text).toBe('Rest after\ninfusions.');
    expect(existedBefore).toBe(true);
    expect(modeBefore).toBe(0o600);
    expect(existsSync(file)).toBe(false);
    expect(ctx.documents.list()).toEqual([]);
    expect(of('data:changed')).toEqual([{ domain: 'documents' }, { domain: 'documents' }]);
  });

  it('rejects empty pasted text', () => {
    const { ctx } = createFakeContext();
    expect(() => ctx.documents.importText('Empty', '   \n ')).toThrow(/no text/);
  });

  it('imports picked files, reporting failures per file as toasts', async () => {
    // Arrange
    const dir = tempPath('pick');
    mkdirSync(dir, { recursive: true });
    const good = join(dir, 'Summary.md');
    writeFileSync(good, '# Visit\n\nAll good.');
    const { ctx, of } = createFakeContext({
      documentsDeps: { ...defaultDocumentsDeps, pickFiles: vi.fn(async () => [good, join(dir, 'virus.exe')]) },
    });

    // Act
    const imported = await ctx.documents.pick();

    // Assert
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ name: 'Summary.md', kind: 'markdown', sourcePath: good });
    expect(ctx.documents.get(imported[0].id)?.text).toBe('# Visit\n\nAll good.');
    expect(of('toast')).toEqual([
      { kind: 'error', message: "virus.exe: This kind of file isn't supported. Try a PDF, Word, text or web page file." },
      { kind: 'success', message: 'Added 1 document.' },
    ]);
  });

  it('returns nothing when the picker is cancelled', async () => {
    const { ctx, of } = createFakeContext();
    await expect(ctx.documents.pick()).resolves.toEqual([]);
    expect(of('toast')).toEqual([]);
  });

  it('returns null and logs when the text file is missing on disk', () => {
    // Arrange
    const seed = { documents: { version: 1, documents: [{ id: 'abc123', name: 'Lost', kind: 'text', chars: 3, createdAt: '2026-01-01T00:00:00.000Z', sourcePath: null }] } };
    const { ctx, logger } = createFakeContext({ seed });

    // Act
    const loaded = ctx.documents.get('abc123');

    // Assert
    expect(loaded).toBeNull();
    expect(logger.calls.error.length).toBe(1);
    expect(ctx.documents.get('missing')).toBeNull();
  });

  it('drops stored documents whose ids are not file-name safe', () => {
    const seed = { documents: { version: 1, documents: [{ id: '../evil', name: 'Evil', kind: 'text', chars: 1, createdAt: '2026-01-01T00:00:00.000Z', sourcePath: null }] } };
    const { ctx } = createFakeContext({ seed });
    expect(ctx.documents.list()).toEqual([]);
  });
});
