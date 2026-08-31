import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunksFromIndex } from '../retrieval/chunks.js';
import { FolderSource } from '../vault/folder-source.js';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { buildFullIndex } from './build.js';
import type { YieldScheduler } from './scheduling.js';
import { createCancellationController } from './scheduling.js';

/**
 * In-memory `VaultSource` that records every `read()` call, in order. This
 * is the instrument the cancellation test uses to prove real work stopped:
 * counting reads is a direct measure of documents actually indexed, not a
 * flag `buildFullIndex` could set without doing (or skipping) the work it
 * describes.
 */
class RecordingVaultSource implements VaultSource {
  readonly reads: VaultPath[] = [];
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
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
    this.reads.push(path);
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }

  async readBinary(): Promise<Uint8Array> {
    throw new Error('not used');
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

/**
 * A fully test-controlled `YieldScheduler` — no real timer anywhere. Resolves
 * `yield()` on the microtask queue only, and calls `onYield` synchronously
 * first so a test can react (e.g. cancel) exactly on a chosen chunk boundary.
 */
class RecordingScheduler implements YieldScheduler {
  yieldCount = 0;
  constructor(private readonly onYield?: (count: number) => void) {}

  async yield(): Promise<void> {
    this.yieldCount += 1;
    this.onYield?.(this.yieldCount);
  }
}

function vaultWithDocs(count: number): RecordingVaultSource {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    // Zero-padded so `list()`'s sorted order matches numeric order.
    files[`doc-${String(i).padStart(2, '0')}.md`] = `# Doc ${i}\nbody ${i}\n`;
  }
  return new RecordingVaultSource(files);
}

describe('buildFullIndex — chunking (C2.6, Q6.2)', () => {
  it('processes documents in bounded chunks and reports progress with a running count after each', async () => {
    const vault = vaultWithDocs(7);
    const progress: Array<{ documentsProcessed: number; documentsTotal: number }> = [];
    const scheduler = new RecordingScheduler();

    const result = await buildFullIndex({
      vault,
      scheduler,
      chunkSize: 3,
      onProgress: (p) => progress.push(p),
    });

    expect(result.status).toBe('complete');
    expect(progress).toEqual([
      { documentsProcessed: 3, documentsTotal: 7 },
      { documentsProcessed: 6, documentsTotal: 7 },
      { documentsProcessed: 7, documentsTotal: 7 },
    ]);
  });

  it('yields between chunks but not after the final one', async () => {
    const vault = vaultWithDocs(7);
    const scheduler = new RecordingScheduler();

    await buildFullIndex({ vault, scheduler, chunkSize: 3 });

    // 3 chunks (3, 3, 1) -> 2 gaps between them, never a trailing yield.
    expect(scheduler.yieldCount).toBe(2);
  });

  it('a single chunk covering the whole vault never yields at all', async () => {
    const vault = vaultWithDocs(5);
    const scheduler = new RecordingScheduler();

    await buildFullIndex({ vault, scheduler, chunkSize: 10 });

    expect(scheduler.yieldCount).toBe(0);
  });

  it('an empty vault completes with an empty index and never yields', async () => {
    const vault = vaultWithDocs(0);
    const scheduler = new RecordingScheduler();

    const result = await buildFullIndex({ vault, scheduler, chunkSize: 3 });

    expect(result).toEqual({ status: 'complete', index: { version: 1, documents: [] } });
    expect(scheduler.yieldCount).toBe(0);
  });
});

describe('buildFullIndex — cancellation actually stops work (C2.6, Q6.2)', () => {
  it('cancelling during a between-chunk yield stops indexing before the next chunk reads anything', async () => {
    const vault = vaultWithDocs(10);
    const controller = createCancellationController();
    // Cancel exactly when the 2nd yield fires — i.e. after chunks 1 and 2
    // (6 documents) have been indexed, before chunk 3 starts.
    const scheduler = new RecordingScheduler((count) => {
      if (count === 2) controller.cancel();
    });

    const result = await buildFullIndex({
      vault,
      scheduler,
      signal: controller.signal,
      chunkSize: 3,
    });

    expect(result).toEqual({ status: 'cancelled' });
    // The real proof: only the documents from the two completed chunks were
    // ever read. If cancellation were a flag checked only after finishing
    // the loop (or not checked at all), this would be 10, not 6.
    expect(vault.reads).toEqual([
      'doc-00.md',
      'doc-01.md',
      'doc-02.md',
      'doc-03.md',
      'doc-04.md',
      'doc-05.md',
    ]);
    expect(vault.reads.length).toBeLessThan(10);
  });

  it('a signal already cancelled before the build starts reads nothing at all', async () => {
    const vault = vaultWithDocs(5);
    const controller = createCancellationController();
    controller.cancel();
    const scheduler = new RecordingScheduler();

    const result = await buildFullIndex({
      vault,
      scheduler,
      signal: controller.signal,
      chunkSize: 2,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(vault.reads).toEqual([]);
  });

  it('a build with no signal at all cannot be cancelled and always completes', async () => {
    const vault = vaultWithDocs(4);
    const scheduler = new RecordingScheduler();

    const result = await buildFullIndex({ vault, scheduler, chunkSize: 1 });

    expect(result.status).toBe('complete');
    expect(vault.reads.length).toBe(4);
  });
});

/**
 * A minimal, valid, single-page PDF with one `Tj` — the same hand-built style
 * `fixtures/vault/README.md` describes, `../extract/pdf.spec.ts` uses, and
 * `../tier3-evidence/build.spec.ts` duplicates for the identical reason: it
 * exercises the real parser rather than a mock of it.
 */
function buildPdfBytes(pageText: string): Uint8Array {
  const escapeLiteral = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const raw = `BT /F1 12 Tf 20 150 Td (${escapeLiteral(pageText)}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
  ];
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  const text = `%PDF-1.4\n${objects.join('')}${trailer}`;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

describe('buildFullIndex — registeredFiles (ol-n06g: registered material is citable but was not embeddable)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-build-registered-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeText(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async function writePdf(relPath: string, pageText: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buildPdfBytes(pageText));
  }

  it('without registeredFiles, a binary source is invisible to the index (the gap ol-n06g reports)', async () => {
    await writeText('note.md', '---\n---\n\n# A note\n');
    await writePdf('Lectures/deck.pdf', 'Some lecture content about basalt weathering.');
    const vault = new FolderSource(root);

    const result = await buildFullIndex({ vault, scheduler: { yield: async () => {} } });

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('unreachable');
    expect(result.index.documents.map((d) => d.path)).toEqual(['note.md']);
  });

  it('a registered PDF is chunked and embeddable — the fix (registeredFiles threaded to extractFromVault, mirroring the concept/citation pipeline)', async () => {
    await writeText('note.md', '---\n---\n\n# A note\n');
    await writePdf('Lectures/deck.pdf', 'Some lecture content about basalt weathering.');
    const vault = new FolderSource(root);

    const result = await buildFullIndex({
      vault,
      scheduler: { yield: async () => {} },
      registeredFiles: [{ path: 'Lectures/deck.pdf', role: 'course-material', course: 'GEOL204' }],
    });

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('unreachable');

    // Documents stay in ascending-path order even though the registered
    // document was appended after the markdown scan (types.ts's invariant).
    expect(result.index.documents.map((d) => d.path)).toEqual(['Lectures/deck.pdf', 'note.md']);
    const pdfDoc = result.index.documents.find((d) => d.path === 'Lectures/deck.pdf');
    expect(pdfDoc?.courses).toEqual(['GEOL204']);
    expect(pdfDoc?.blocks.length).toBeGreaterThan(0);
    expect(pdfDoc?.blocks[0]?.text).toContain('basalt weathering');

    // The actual gap this bead closes: chunksFromIndex (what embed-corpus.mjs
    // sends to the embedding provider) now carries the registered material.
    const chunks = await chunksFromIndex(result.index);
    const pdfChunks = chunks.filter((c) => c.path === 'Lectures/deck.pdf');
    expect(pdfChunks.length).toBeGreaterThan(0);
    expect(pdfChunks[0]?.text).toContain('basalt weathering');
  });

  it('a registered file that does not exist is skipped honestly, never thrown', async () => {
    await writeText('note.md', '---\n---\n\n# A note\n');
    const vault = new FolderSource(root);

    const result = await buildFullIndex({
      vault,
      scheduler: { yield: async () => {} },
      registeredFiles: [{ path: 'Lectures/missing.pdf' }],
    });

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('unreachable');
    expect(result.index.documents.map((d) => d.path)).toEqual(['note.md']);
  });

  it('a registered markdown file needs no special handling — already covered by the ordinary scan, not duplicated', async () => {
    await writeText('03 Research/paper.md', '---\nrole: past-paper\n---\n\nQuestion 1.\n');
    const vault = new FolderSource(root);

    const result = await buildFullIndex({
      vault,
      scheduler: { yield: async () => {} },
      registeredFiles: [{ path: '03 Research/paper.md', role: 'past-paper' }],
    });

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('unreachable');
    expect(result.index.documents.map((d) => d.path)).toEqual(['03 Research/paper.md']);
  });

  it('omitting registeredFiles entirely reproduces exactly the pre-existing behaviour (backward compatible)', async () => {
    const vault = vaultWithDocs(3);
    const withOption = await buildFullIndex({
      vault,
      scheduler: { yield: async () => {} },
      registeredFiles: [],
    });
    const withoutOption = await buildFullIndex({ vault, scheduler: { yield: async () => {} } });

    expect(withOption).toEqual(withoutOption);
  });
});
