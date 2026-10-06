/**
 * `ol-egov.141.89.1.95`, as ruled by David on 2026-10-06 (option a), through the plugin's own
 * composer and store: every PDF in her vault, registered or not, reaches the keyword index in the
 * background after a first run and on the first load after this change, survives a restart
 * through `ObsidianKeywordIndexStore` with nothing extracted again, stays current from the watch
 * (a rename included), takes its course from a registration, and is retrievable at query time.
 * Also the measurement the bead asks for: whether what the ingestion drain embeds for that PDF
 * joins its index chunks, so the semantic leg can surface it.
 *
 * `FolderSource` over a temporary folder stands in for the vault; every string is invented
 * (INV-3); no `obsidian` import.
 */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  JobEnqueuer,
  ListOptions,
  PersistedEmbeddingCache,
  RegisteredFileSpec,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  chunksFromIndex,
  createExtractionJobRunner,
  EmbeddingCacheEngine,
  FolderSource,
  hybridRetrieve,
  retrieve,
  searchKeywordIndex,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PendingIndexingSink } from '../../src/ingestion/pending-indexing-sink.js';
import { ObsidianKeywordIndexStore } from '../../src/keyword-index/store.js';
import { buildKeywordIndexWiring } from '../../src/keyword-index/wiring.js';
import { chunksFromExtractedUnits } from '../../src/retrieval/units-to-chunks.js';
import { drainIntoEmbeddingCache } from '../../src/retrieval/wiring.js';

/** Obsidian's `data.json`, kept as JSON text, so a reload sees only what survives `saveData`. */
class JsonDataHost {
  json: string | null = null;
  async loadData(): Promise<unknown> {
    return this.json === null ? null : JSON.parse(this.json);
  }
  async saveData(data: unknown): Promise<void> {
    this.json = JSON.stringify(data);
  }
}

/** Delegates to a `FolderSource`; counts binary reads and can refuse them. */
class CountingVault implements VaultSource {
  binaryReads = 0;
  refuseBinaryReads = false;
  constructor(private readonly inner: FolderSource) {}
  list(options?: ListOptions): Promise<readonly VaultPath[]> {
    return this.inner.list(options);
  }
  read(path: VaultPath): Promise<string> {
    return this.inner.read(path);
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    if (this.refuseBinaryReads) throw new Error('a reload must not read a binary');
    this.binaryReads += 1;
    return this.inner.readBinary(path);
  }
  write(): Promise<void> {
    throw new Error('the index never writes to the vault');
  }
  exists(path: VaultPath): Promise<boolean> {
    return this.inner.exists(path);
  }
  watch(): Unsubscribe {
    return () => {};
  }
}

function fakeWatch() {
  let handler: ((event: VaultEvent) => void) | null = null;
  return {
    watch: (h: (event: VaultEvent) => void) => {
      handler = h;
      return () => {};
    },
    fire: (event: VaultEvent) => handler?.(event),
  };
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function pdfBytes(pages: readonly string[]): Uint8Array {
  const escapePdf = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  pages.forEach((text, i) => {
    const raw = `BT /F1 12 Tf 20 150 Td (${escapePdf(text)}) Tj ET`;
    objects.push(
      `${4 + i * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
      `${5 + i * 2} 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
    );
  });
  const text = `%PDF-1.4\n${objects.join('')}trailer\n<< /Size ${4 + pages.length * 2} /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

const PDF = '01 Courses/SYN201/Slides/week-1.pdf' as VaultPath;
const LOOSE = '01 Courses/SYN201/Slides/week-2.pdf' as VaultPath;
const NOTE = '01 Courses/SYN201/notes.md' as VaultPath;
const PAGES = [
  'Ashwillow bark cracks in long vertical seams.',
  'Cindergrass returns first after a heath fire.',
];
const REGISTERED: readonly RegisteredFileSpec[] = [
  { path: PDF, role: 'objectives', course: 'SYN201' },
];
const CAN_DRAIN = { canDrain: true };
const NOTHING_DONE = { indexed: 0, textless: 0, removed: 0, regrouped: 0, failed: 0 };
/** Binaries on, her registrations read from `read`. */
const binaries = (read: () => Promise<readonly RegisteredFileSpec[]>) => ({
  binarySources: { registeredFiles: read },
});

let root: string;

function writeFile(path: string, content: string | Uint8Array): void {
  const full = join(root, ...path.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'olea-registered-binaries-'));
  writeFile(NOTE, '---\ncourse: SYN201\n---\n\n# Notes\n\nMy own notes on heathland.\n');
  writeFile(PDF, pdfBytes(PAGES));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function pdfDoc(
  wiring: {
    engine: {
      toPersisted(): { documents: readonly { path: string; courses: readonly string[] }[] };
    };
  },
  path: VaultPath = PDF,
) {
  return wiring.engine.toPersisted().documents.find((d) => d.path === path);
}

describe('first run and first load after this change (ol-egov.141.89.1.95)', () => {
  it('a fresh install indexes her notes in its first rebuild and every PDF, registered or not, in the background sync', async () => {
    writeFile(LOOSE, pdfBytes(['Peatmoss holds many times its weight in water.']));
    const vault = new CountingVault(new FolderSource(root));
    const wiring = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(new JsonDataHost()),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
      ...binaries(async () => REGISTERED),
    });
    // Both PDFs are extracted by the sync, so the awaited first rebuild extracted neither.
    await expect(wiring.binarySourcesSynced).resolves.toEqual({ ...NOTHING_DONE, indexed: 2 });
    expect(vault.binaryReads).toBe(2);
    expect(wiring.engine.toPersisted().documents.map((d) => d.path)).toEqual([PDF, LOOSE, NOTE]);
    expect(pdfDoc(wiring)?.courses).toEqual(['SYN201']);
    expect(pdfDoc(wiring, LOOSE)?.courses).toEqual([]);
    const doc = wiring.engine.toPersisted().documents.find((d) => d.path === PDF);
    expect(doc?.blocks.map((b) => b.location?.page)).toEqual([1, 2]);
    expect(wiring.engine.search('peatmoss').map((h) => h.path)).toEqual([LOOSE]);
  });

  it('a populated index from before this change gains every PDF that was never extracted, on the first load', async () => {
    const host = new JsonDataHost();
    const vault = new CountingVault(new FolderSource(root));
    // Before: the wiring as it was, with no binaries.
    const before = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
    });
    expect(before.engine.toPersisted().documents.map((d) => d.path)).toEqual([NOTE]);
    expect(vault.binaryReads).toBe(0);

    // After: the same persisted index is trusted (no rebuild), and the load's sync extracts the
    // PDF, with nothing registered at all.
    const after = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
      ...binaries(async () => []),
    });
    await expect(after.binarySourcesSynced).resolves.toEqual({ ...NOTHING_DONE, indexed: 1 });
    expect(after.engine.toPersisted().documents.map((d) => d.path)).toEqual([PDF, NOTE]);
    expect(vault.binaryReads).toBe(1);
  });

  it('a device that cannot drain (mobile, D-002) never extracts a PDF', async () => {
    const vault = new CountingVault(new FolderSource(root));
    const wiring = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(new JsonDataHost()),
      capability: { canDrain: false },
      watch: fakeWatch().watch,
      ...binaries(async () => REGISTERED),
    });
    await expect(wiring.binarySourcesSynced).resolves.toBeNull();
    await expect(wiring.syncBinarySources()).resolves.toBeNull();
    expect(wiring.engine.toPersisted().documents).toEqual([]);
    expect(vault.binaryReads).toBe(0);
  });
});

describe('acceptance through the plugin store: retrieved as a source chunk after a restart', () => {
  it('reloads from data.json without reading the PDF and retrieves its page with the anchor', async () => {
    const host = new JsonDataHost();
    const vault = new CountingVault(new FolderSource(root));
    const first = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
      ...binaries(async () => REGISTERED),
    });
    await first.binarySourcesSynced;
    const persisted = first.engine.toPersisted();

    vault.refuseBinaryReads = true;
    const second = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
      ...binaries(async () => REGISTERED),
    });
    await expect(second.binarySourcesSynced).resolves.toEqual(NOTHING_DONE);
    expect(second.engine.toPersisted()).toEqual(persisted);

    const index = second.engine.toPersisted();
    const provider = new MarkerProvider('cindergrass');
    const embeddingCache = await EmbeddingCacheEngine.create({
      store: new MemoryEmbeddingStore(),
      provider,
      model: 'fake-model-v1',
    });
    const result = await retrieve(
      { keywordIndex: index, embeddingCache, embeddingProvider: provider },
      'cindergrass',
    );
    expect(result.status).toBe('grounded');
    if (result.status !== 'grounded') return;
    const hit = result.chunks.find((c) => c.path === PDF);
    expect(hit?.text.toLowerCase()).toContain('cindergrass');
    const chunk = (await chunksFromIndex(index)).find(
      (c) => c.path === hit?.path && c.blockIndex === hit?.blockIndex,
    );
    expect(chunk?.location?.page).toBe(2);
  });
});

describe('kept current from the watch and from registration', () => {
  async function live(registered: { current: readonly RegisteredFileSpec[] }) {
    const fake = fakeWatch();
    const wiring = await buildKeywordIndexWiring({
      vault: new FolderSource(root),
      store: new ObsidianKeywordIndexStore(new JsonDataHost()),
      capability: CAN_DRAIN,
      watch: fake.watch,
      ...binaries(async () => registered.current),
    });
    await wiring.binarySourcesSynced;
    return { wiring, fire: fake.fire };
  }

  it('a modified PDF has its old chunks replaced; a deleted one leaves', async () => {
    const { wiring, fire } = await live({ current: REGISTERED });
    writeFile(PDF, pdfBytes(['Moorbell flowers close before rain.']));
    fire({ kind: 'modify', path: PDF });
    await waitFor(() => wiring.engine.search('moorbell').length === 1);
    expect(wiring.engine.search('ashwillow')).toEqual([]);

    unlinkSync(join(root, ...PDF.split('/')));
    fire({ kind: 'delete', path: PDF });
    await waitFor(() => pdfDoc(wiring) === undefined);
    expect(wiring.engine.search('moorbell')).toEqual([]);
  });

  it('a renamed PDF leaves its old path and is indexed at its new one', async () => {
    const { wiring, fire } = await live({ current: REGISTERED });
    const moved = '01 Courses/SYN201/Slides/old/week-1.pdf' as VaultPath;
    writeFile(moved, pdfBytes(PAGES));
    unlinkSync(join(root, ...PDF.split('/')));
    fire({ kind: 'rename', path: moved, oldPath: PDF });
    await waitFor(() => pdfDoc(wiring, moved) !== undefined);
    expect(wiring.engine.toPersisted().documents.map((d) => d.path)).toEqual([moved, NOTE]);
    expect(wiring.engine.search('cindergrass').map((h) => h.path)).toEqual([moved]);
  });

  it('a registration regroups the PDF at the sync it triggers; an unregistration ungroups it, and it stays', async () => {
    const registered = { current: [] as readonly RegisteredFileSpec[] };
    const { wiring } = await live(registered);
    expect(pdfDoc(wiring)?.courses).toEqual([]);

    registered.current = REGISTERED;
    await expect(wiring.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, regrouped: 1 });
    expect(pdfDoc(wiring)?.courses).toEqual(['SYN201']);

    registered.current = [];
    await expect(wiring.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, regrouped: 1 });
    expect(pdfDoc(wiring)?.courses).toEqual([]);
  });

  it('a failure reading her log leaves her PDF indexed and ungrouped, and never rejects', async () => {
    const wiring = await buildKeywordIndexWiring({
      vault: new FolderSource(root),
      store: new ObsidianKeywordIndexStore(new JsonDataHost()),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
      ...binaries(async () => {
        throw new Error('log unreadable');
      }),
    });
    await expect(wiring.binarySourcesSynced).resolves.toEqual({ ...NOTHING_DONE, indexed: 1 });
    expect(wiring.engine.toPersisted().documents.map((d) => d.path)).toEqual([PDF, NOTE]);
    expect(pdfDoc(wiring)?.courses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Measurement: does the drain's embedding join the new binary chunks?
// ---------------------------------------------------------------------------------------------

class MemoryEmbeddingStore implements EmbeddingCacheStore {
  saved: PersistedEmbeddingCache | null = null;
  async load() {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache) {
    this.saved = cache;
  }
}

/** Texts containing `marker`, and the query `probe`, share one direction; everything else another. */
class MarkerProvider implements EmbeddingProvider {
  constructor(
    private readonly marker: string,
    private readonly probe = 'semantic probe',
  ) {}
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((t) =>
        t === this.probe || t.toLowerCase().includes(this.marker) ? [1, 0] : [0, 1],
      ),
    };
  }
}

describe('measurement: the semantic leg can surface a binary chunk', () => {
  it('the drained sink units hash to the index chunks, and a query with no shared word retrieves the PDF semantically', async () => {
    const vault = new FolderSource(root);
    const wiring = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(new JsonDataHost()),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
      ...binaries(async () => REGISTERED),
    });
    await wiring.binarySourcesSynced;
    const index = wiring.engine.toPersisted();
    const indexChunks = (await chunksFromIndex(index)).filter((c) => c.path === PDF);

    // What the ingestion path lands for the same file: a `'source'` job through the real runner.
    const sink = new PendingIndexingSink();
    const enqueuer: JobEnqueuer = { enqueue: async () => ({ status: 'queued' }) };
    const run = createExtractionJobRunner({ vault, enqueuer, sink });
    await expect(
      run({
        contentHash: 'job-1',
        label: 'job-1',
        payload: { kind: 'source', sourcePath: PDF, format: 'pdf' },
        attempts: 0,
      }),
    ).resolves.toEqual({ ok: true });
    const sinkChunks = await chunksFromExtractedUnits(sink.all());
    expect(sinkChunks.map((c) => c.contentHash).sort()).toEqual(
      indexChunks.map((c) => c.contentHash).sort(),
    );

    // The drain embeds the index's chunks for the PDF (its sink units are left out as already
    // indexed), so every PDF chunk hash is in the cache the semantic leg ranks.
    const provider = new MarkerProvider('ashwillow');
    const embeddingCache = await EmbeddingCacheEngine.create({
      store: new MemoryEmbeddingStore(),
      provider,
      model: 'fake-model-v1',
    });
    await drainIntoEmbeddingCache({ embeddingCache, sink, keywordIndex: wiring.engine });
    const cached = embeddingCache.snapshot();
    for (const chunk of indexChunks) expect(cached.has(chunk.contentHash)).toBe(true);

    const query = 'semantic probe';
    expect(searchKeywordIndex(index, query)).toEqual([]);
    const queryVector = (await provider.embed({ model: 'fake-model-v1', texts: [query] }))
      .vectors[0];
    const hits = await hybridRetrieve({
      query,
      chunks: await chunksFromIndex(index),
      keywordHits: [],
      queryVector: queryVector ?? null,
      embeddings: cached,
    });
    const pdfHit = hits.find((h) => h.path === PDF);
    expect(pdfHit?.matchedBy).toEqual(['semantic']);
    expect(pdfHit?.text.toLowerCase()).toContain('ashwillow');
  });
});
