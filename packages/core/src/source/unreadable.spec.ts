import { describe, expect, it } from 'vitest';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { findUnreadableFiles, reasonForExtractionOutcome } from './unreadable.js';

/**
 * A minimal in-memory `VaultSource`, matching the pattern
 * `../extract/embeds.spec.ts` and `../extract/registry.spec.ts` already use
 * for cases that don't need real files on disk. Every fixture here is
 * coined for this test (INV-3) — no real vault content, no real course
 * names.
 */
class MemoryVaultSource implements VaultSource {
  private readonly files = new Map<string, Uint8Array>();

  constructor(entries: Record<string, Uint8Array>) {
    for (const [path, bytes] of Object.entries(entries)) this.files.set(path, bytes);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    let paths = [...this.files.keys()];
    if (options.under !== undefined) {
      const under = options.under;
      paths = paths.filter((p) => p === under || p.startsWith(`${under}/`));
    }
    return paths.sort();
  }

  async read(path: VaultPath): Promise<string> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`not found: ${path}`);
    return new TextDecoder().decode(bytes);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`not found: ${path}`);
    return bytes;
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, new TextEncoder().encode(content));
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  async delete(): Promise<void> {
    throw new Error('not implemented');
  }

  watch(): Unsubscribe {
    return () => undefined;
  }
}

// ---- a tiny hand-built PDF constructor, the same shape `../extract/pdf.spec.ts`
// uses, kept minimal here since this module only cares about the outcome
// discriminant, never the extracted text itself.

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A minimal, valid, single-page PDF with one `Tj` text-show operator — a genuinely readable source. */
function buildReadablePdfBytes(text: string): Uint8Array {
  const body = `BT /F1 12 Tf 20 150 Td (${escapePdfLiteral(text)}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`,
  ];
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  return asciiBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

describe('reasonForExtractionOutcome — the pure fold ([D-196])', () => {
  it('excludes empty-document: nothing is wrong, there was nothing there', () => {
    expect(reasonForExtractionOutcome('empty-document', 0)).toBeNull();
  });

  it('excludes furniture-only: read genuinely succeeded, nothing but running-head noise', () => {
    expect(reasonForExtractionOutcome('furniture-only', 0)).toBeNull();
  });

  it('excludes extracted with real units: the ordinary readable case', () => {
    expect(reasonForExtractionOutcome('extracted', 3)).toBeNull();
  });

  it('folds extracted-with-zero-units into image-only-no-text: every page routed to vision', () => {
    expect(reasonForExtractionOutcome('extracted', 0)).toBe('image-only-no-text');
  });

  it('folds no-pages-found into image-only-no-text', () => {
    expect(reasonForExtractionOutcome('no-pages-found', 0)).toBe('image-only-no-text');
  });

  it('folds unreadable (structural parse failure) into image-only-no-text', () => {
    expect(reasonForExtractionOutcome('unreadable', 0)).toBe('image-only-no-text');
  });

  it('folds reached-but-unreadable into image-only-no-text', () => {
    expect(reasonForExtractionOutcome('reached-but-unreadable', 0)).toBe('image-only-no-text');
  });
});

describe('findUnreadableFiles — the census ([D-196], F1.5(b), F8.1)', () => {
  it('reports no-reader-for-format for an extension no Extractor claims, regardless of linkage', async () => {
    const vault = new MemoryVaultSource({
      '03 Research/grading-weights.xlsx': asciiBytes('not a real spreadsheet, never read'),
    });
    const files = await findUnreadableFiles(vault, {
      files: ['03 Research/grading-weights.xlsx'],
      linkedPaths: new Set(['03 Research/grading-weights.xlsx']), // even linked, the format still has no reader
    });
    expect(files).toEqual([
      { path: '03 Research/grading-weights.xlsx', reason: 'no-reader-for-format' },
    ]);
  });

  it('reports not-linked for a supported format nothing embeds or registers, and never reads its bytes', async () => {
    const vault = new MemoryVaultSource({}); // the file is not even present — proves extraction is never attempted
    const files = await findUnreadableFiles(vault, {
      files: ['03 Research/GEOL204 Field Trip Slides.pptx'],
      linkedPaths: new Set(),
    });
    expect(files).toEqual([
      { path: '03 Research/GEOL204 Field Trip Slides.pptx', reason: 'not-linked' },
    ]);
  });

  it('reports image-only-no-text for a linked image (no text layer by construction)', async () => {
    const vault = new MemoryVaultSource({
      '03 Research/GEOL204 Scanned Handout.png': asciiBytes(
        'irrelevant, imageExtractor never reads content',
      ),
    });
    const files = await findUnreadableFiles(vault, {
      files: ['03 Research/GEOL204 Scanned Handout.png'],
      linkedPaths: new Set(['03 Research/GEOL204 Scanned Handout.png']),
    });
    expect(files).toEqual([
      { path: '03 Research/GEOL204 Scanned Handout.png', reason: 'image-only-no-text' },
    ]);
  });

  it('reports image-only-no-text for a linked PDF that fails structural parsing (unreadable)', async () => {
    const vault = new MemoryVaultSource({
      '03 Research/GEOL204 Corrupt Past Paper.pdf': asciiBytes('this is not a PDF at all'),
    });
    const files = await findUnreadableFiles(vault, {
      files: ['03 Research/GEOL204 Corrupt Past Paper.pdf'],
      linkedPaths: new Set(['03 Research/GEOL204 Corrupt Past Paper.pdf']),
    });
    expect(files).toEqual([
      { path: '03 Research/GEOL204 Corrupt Past Paper.pdf', reason: 'image-only-no-text' },
    ]);
  });

  it('excludes a linked, readable PDF entirely — the ordinary case is not part of the census', async () => {
    const vault = new MemoryVaultSource({
      '03 Research/GEOL204 Past Paper 2024.pdf': buildReadablePdfBytes(
        'Coined fixture text, never real vault content.',
      ),
    });
    const files = await findUnreadableFiles(vault, {
      files: ['03 Research/GEOL204 Past Paper 2024.pdf'],
      linkedPaths: new Set(['03 Research/GEOL204 Past Paper 2024.pdf']),
    });
    expect(files).toEqual([]);
  });

  it('never classifies a markdown path: it is read by the block parser, not an Extractor', async () => {
    const vault = new MemoryVaultSource({
      '03 Research/GEOL204 Course Objectives.md': asciiBytes('---\nrole: objectives\n---\n'),
    });
    const files = await findUnreadableFiles(vault, {
      files: ['03 Research/GEOL204 Course Objectives.md'],
      linkedPaths: new Set(),
    });
    expect(files).toEqual([]);
  });

  it('sorts the result by path and reports each file exactly once', async () => {
    const vault = new MemoryVaultSource({
      '03 Research/b-scan.png': asciiBytes('x'),
      '03 Research/a-scan.png': asciiBytes('x'),
    });
    const files = await findUnreadableFiles(vault, {
      files: ['03 Research/b-scan.png', '03 Research/a-scan.png'],
      linkedPaths: new Set(['03 Research/b-scan.png', '03 Research/a-scan.png']),
    });
    expect(files.map((f) => f.path)).toEqual(['03 Research/a-scan.png', '03 Research/b-scan.png']);
  });
});
