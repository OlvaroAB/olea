/**
 * `createExtractionJobRunner` — the DF-21 seam tests. Each `it` below is one
 * of the cases the bead names explicitly: a source with no supported embeds,
 * an unresolved/ambiguous embed, a mixed text-layer/vision document (the
 * centrepiece — see the "not dropped" describe block), and a runner failure
 * path. `burst-simulation.spec.ts` alongside this file covers the queue
 * mechanics (retries, budget, restarts) against this same runner; this file
 * is about the runner's own composition of `../extract/`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { UnresolvedEmbed } from '../extract/embeds.js';
import type { ExtractedUnit } from '../extract/types.js';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { IngestionQueueEngine } from './engine.js';
import {
  createExtractionJobRunner,
  deferredEnqueuer,
  type EmptyExtractionReport,
  type ExtractedUnitSink,
  isExtractionJobPayload,
} from './extraction-runner.js';
import { hashText } from './hash.js';
import type {
  EnqueueInput,
  JobRunner,
  JobRunnerView,
  PersistedQueue,
  QueueStore,
} from './types.js';

// ---- a tiny hand-built-PDF constructor, the same shape pdf.spec.ts uses
// (fixtures/vault/README's "hand-built objects/xref" style) so these tests
// exercise the real parser, not a mock of it. Kept local and uncompressed —
// this file only needs per-page character yield, not FlateDecode coverage,
// which pdf.spec.ts already owns.

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Builds a minimal, valid, multi-page PDF with one `Tj` text-show operator per non-empty page. An empty string page has no `Tj` at all — the true image-only/scanned-page shape (cost model §5.1), so its char yield is genuinely zero. */
function buildPdfBytes(pageTexts: readonly string[]): Uint8Array {
  const pageCount = pageTexts.length;
  const fontNum = 3;
  const firstPageNum = 4;
  const firstContentNum = firstPageNum + pageCount;

  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageNum + i} 0 R`).join(' ');
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);
  objects.push(
    `${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  );

  for (let i = 0; i < pageCount; i++) {
    const pageNum = firstPageNum + i;
    const contentNum = firstContentNum + i;
    objects.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>\nendobj\n`,
    );
  }

  for (let i = 0; i < pageCount; i++) {
    const contentNum = firstContentNum + i;
    const text = pageTexts[i] ?? '';
    const raw =
      text.length > 0
        ? `BT /F1 12 Tf 20 150 Td (${escapePdfLiteral(text)}) Tj ET`
        : 'BT /F1 12 Tf ET';
    const streamText = new TextDecoder('latin1').decode(asciiBytes(raw));
    objects.push(
      `${contentNum} 0 obj\n<< /Length ${streamText.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
    );
  }

  const size = firstContentNum + pageCount;
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  return asciiBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

class MemoryVaultSource implements VaultSource {
  readonly readBinaryCalls: VaultPath[] = [];
  private readonly binary = new Map<string, Uint8Array>();
  private readonly text = new Map<string, string>();

  setBinary(path: VaultPath, bytes: Uint8Array): void {
    this.binary.set(path, bytes);
  }

  setText(path: VaultPath, content: string): void {
    this.text.set(path, content);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const paths = [...this.binary.keys(), ...this.text.keys()];
    const unique = [...new Set(paths)].sort();
    if (options.under === undefined) return unique;
    const under = options.under;
    return unique.filter((p) => p === under || p.startsWith(`${under}/`));
  }

  async read(path: VaultPath): Promise<string> {
    const found = this.text.get(path);
    if (found === undefined) throw new Error(`not found: ${path}`);
    return found;
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    this.readBinaryCalls.push(path);
    const found = this.binary.get(path);
    if (!found) throw new Error(`not found: ${path}`);
    return found;
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.text.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.binary.has(path) || this.text.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

class CollectingSink implements ExtractedUnitSink {
  readonly batches: (readonly ExtractedUnit[])[] = [];
  async receive(units: readonly ExtractedUnit[]): Promise<void> {
    this.batches.push(units);
  }
  get all(): readonly ExtractedUnit[] {
    return this.batches.flat();
  }
}

class MemoryStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
  }
}

const ABOVE_THRESHOLD = 'A page of genuinely substantial slide text, well above the yield floor.';

describe('createExtractionJobRunner — a source with no supported embeds', () => {
  it('a note referencing only unsupported/non-embed targets produces no units and enqueues nothing', async () => {
    const vault = new MemoryVaultSource();
    vault.setText('note.md', 'See ![[Some Other Note]] and ![[recording.mp3]] for context.');
    const sink = new CollectingSink();
    const enqueue = vi.fn(async () => ({ status: 'queued' as const }));
    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue },
      sink,
    });

    const outcome = await runner({
      contentHash: 'h-note-empty',
      label: 'Empty note',
      payload: { kind: 'note', notePath: 'note.md' },
      attempts: 0,
    });

    expect(outcome).toEqual({ ok: true });
    expect(sink.batches).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('createExtractionJobRunner — an unresolved/ambiguous embed', () => {
  it('reports an ambiguous embed via onUnresolvedEmbed but still succeeds the job (best-effort over the rest of the note)', async () => {
    const vault = new MemoryVaultSource();
    vault.setText('Notes/note.md', '![[scan.png]]');
    vault.setBinary('A/scan.png', new Uint8Array([1]));
    vault.setBinary('B/scan.png', new Uint8Array([1]));
    const sink = new CollectingSink();
    const seen: UnresolvedEmbed[] = [];

    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue: vi.fn(async () => ({ status: 'queued' as const })) },
      sink,
      onUnresolvedEmbed: (embed) => seen.push(embed),
    });

    const outcome = await runner({
      contentHash: 'h-note-ambiguous',
      label: 'Ambiguous note',
      payload: { kind: 'note', notePath: 'Notes/note.md' },
      attempts: 0,
    });

    expect(outcome).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toBe('ambiguous');
    expect(seen[0]?.rawTarget).toBe('scan.png');
    expect(sink.batches).toEqual([]); // nothing resolved, so nothing to extract
  });

  it('reports a not-found embed the same honest way, distinct from ambiguous', async () => {
    const vault = new MemoryVaultSource();
    vault.setText('note.md', '![[missing.pdf]]');
    const seen: UnresolvedEmbed[] = [];
    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue: vi.fn(async () => ({ status: 'queued' as const })) },
      sink: new CollectingSink(),
      onUnresolvedEmbed: (embed) => seen.push(embed),
    });

    const outcome = await runner({
      contentHash: 'h-note-missing',
      label: 'Missing embed note',
      payload: { kind: 'note', notePath: 'note.md' },
      attempts: 0,
    });

    expect(outcome).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toBe('not-found');
  });
});

describe('createExtractionJobRunner — mixed document: some pages text-layer, some vision (the not-dropped centrepiece)', () => {
  it('extracts the text-layer page normally and enqueues a distinct, durable job for the vision-routed page', async () => {
    const vault = new MemoryVaultSource();
    // Page 1 clears the threshold; page 2 has no Tj operator at all — the
    // true image-only/scanned-page shape — so it genuinely routes to vision.
    vault.setBinary('Lectures/deck.pdf', buildPdfBytes([ABOVE_THRESHOLD, '']));
    const sink = new CollectingSink();
    const enqueue = vi.fn(async (_input: EnqueueInput) => ({ status: 'queued' as const }));

    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue },
      sink,
    });

    const parentHash = 'h-mixed-deck';
    const outcome = await runner({
      contentHash: parentHash,
      label: 'Mixed deck',
      payload: { kind: 'source', sourcePath: 'Lectures/deck.pdf', format: 'pdf' },
      attempts: 0,
    });

    // The job as a whole succeeds — page 1's real extraction is not held
    // hostage by page 2 needing a different pipeline.
    expect(outcome).toEqual({ ok: true });

    // Page 1's text-layer unit reached the sink with full provenance.
    expect(sink.all).toHaveLength(1);
    expect(sink.all[0]?.text).toBe(ABOVE_THRESHOLD);
    expect(sink.all[0]?.provenance.sourcePath).toBe('Lectures/deck.pdf');
    expect(sink.all[0]?.provenance.location.page).toBe(1);

    // Page 2 did NOT vanish: exactly one follow-on job was enqueued for it,
    // carrying everything a later Slot V submission needs.
    expect(enqueue).toHaveBeenCalledTimes(1);
    const enqueued = enqueue.mock.calls[0]?.[0];
    expect(enqueued?.payload).toMatchObject({
      kind: 'vision-page',
      sourcePath: 'Lectures/deck.pdf',
      format: 'pdf',
      page: 2,
    });
    // Deterministic and content-derived — a second discovery of the exact
    // same deck (a synced duplicate) reproduces the identical hash rather
    // than minting a new job for work already queued.
    expect(enqueued?.contentHash).toBe(
      await hashText(`vision-page:${parentHash}:Lectures/deck.pdf:2`),
    );
  });

  it('is proven servable, not just enqueued: a real engine drains the follow-on vision-page job through an injected visionRunner ("the Worker path")', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/deck.pdf', buildPdfBytes([ABOVE_THRESHOLD, '']));
    const sink = new CollectingSink();
    const store = new MemoryStore();
    const enqueuer = deferredEnqueuer();

    const servedVisionJobs: JobRunnerView[] = [];
    const visionRunner: JobRunner = async (job) => {
      servedVisionJobs.push(job);
      return { ok: true };
    };

    const runner = createExtractionJobRunner({ vault, enqueuer, sink, visionRunner });
    const engine = await IngestionQueueEngine.create({
      store,
      capability: { canDrain: true },
      runner,
    });
    enqueuer.bind(engine);

    await engine.enqueue({
      contentHash: 'h-mixed-deck-2',
      label: 'Mixed deck',
      payload: { kind: 'source', sourcePath: 'Lectures/deck.pdf', format: 'pdf' },
    });

    // Tick 1: extracts the deck, completes the source job, and — inside
    // that same tick — enqueues the vision-page follow-on.
    const first = await engine.tick();
    expect(first).toMatchObject({ kind: 'ran', outcome: 'done' });

    const visionJob = engine
      .list()
      .find((j) => (j.payload as { kind?: string }).kind === 'vision-page');
    expect(visionJob).toBeDefined();
    expect(visionJob?.status).toBe('queued'); // present, real, waiting — not dropped

    // Tick 2: the engine drains the vision-page job itself, through the
    // exact same JobRunner — and it is `visionRunner`, "the Worker path",
    // that actually serves it.
    const second = await engine.tick();
    expect(second).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(servedVisionJobs).toHaveLength(1);
    expect(servedVisionJobs[0]?.payload).toMatchObject({
      kind: 'vision-page',
      sourcePath: 'Lectures/deck.pdf',
      page: 2,
    });

    expect(engine.snapshot()).toMatchObject({ done: 2, queued: 0, failed: 0 });
  });

  it('without a visionRunner wired, a drained vision-page job fails loudly and non-retryably — never silently "succeeds" doing nothing', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/deck.pdf', buildPdfBytes([ABOVE_THRESHOLD, '']));
    const sink = new CollectingSink();
    const store = new MemoryStore();
    const enqueuer = deferredEnqueuer();

    const runner = createExtractionJobRunner({ vault, enqueuer, sink }); // no visionRunner
    const engine = await IngestionQueueEngine.create({
      store,
      capability: { canDrain: true },
      runner,
    });
    enqueuer.bind(engine);

    await engine.enqueue({
      contentHash: 'h-mixed-deck-3',
      label: 'Mixed deck',
      payload: { kind: 'source', sourcePath: 'Lectures/deck.pdf', format: 'pdf' },
    });
    await engine.tick(); // completes the source job, enqueues the vision-page job
    const second = await engine.tick(); // drains the vision-page job
    expect(second).toMatchObject({ kind: 'ran', outcome: 'failed' });

    const visionJob = engine
      .list()
      .find((j) => (j.payload as { kind?: string }).kind === 'vision-page');
    expect(visionJob?.status).toBe('failed');
    expect(visionJob?.failedReason).toContain('visionRunner');
  });
});

describe('createExtractionJobRunner — runner failure path', () => {
  it('a vault read failure between discovery and drain is reported retryable, not thrown', async () => {
    const vault = new MemoryVaultSource();
    // Nothing registered at this path — readBinary will throw "not found".
    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue: vi.fn(async () => ({ status: 'queued' as const })) },
      sink: new CollectingSink(),
    });

    const outcome = await runner({
      contentHash: 'h-vanished',
      label: 'Deleted before drain',
      payload: { kind: 'source', sourcePath: 'gone.pdf', format: 'pdf' },
      attempts: 0,
    });

    expect(outcome).toEqual({ ok: false, retryable: true });
  });

  it('an unrecognised payload is a non-retryable, honest failure rather than a thrown exception', async () => {
    const runner = createExtractionJobRunner({
      vault: new MemoryVaultSource(),
      enqueuer: { enqueue: vi.fn(async () => ({ status: 'queued' as const })) },
      sink: new CollectingSink(),
    });

    const outcome = await runner({
      contentHash: 'h-garbage',
      label: 'Garbage payload',
      payload: { totally: 'unexpected' },
      attempts: 0,
    });

    expect(outcome).toMatchObject({ ok: false, retryable: false });
  });
});

describe('createExtractionJobRunner — a source that produces nothing is reported, not swallowed (ol-voen)', () => {
  /** Structurally a PDF (objects parse) whose Catalog points at a `/Pages` object that is not in the file and which has no `/Type /Page` objects to fall back to — `'no-pages-found'`, the state nine real lecture decks were in. */
  function buildNoPagesPdfBytes(): Uint8Array {
    const objects = '1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\n';
    return asciiBytes(
      `%PDF-1.4\n${objects}trailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
    );
  }

  it('reports no-pages-found for a source with an unreachable page tree, and still succeeds the job', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/unreachable.pdf', buildNoPagesPdfBytes());
    const empties: EmptyExtractionReport[] = [];

    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue: vi.fn(async () => ({ status: 'queued' as const })) },
      sink: new CollectingSink(),
      onEmptyExtraction: (report) => empties.push(report),
    });

    const outcome = await runner({
      contentHash: 'h-unreachable',
      label: 'Unreachable deck',
      payload: { kind: 'source', sourcePath: 'Lectures/unreachable.pdf', format: 'pdf' },
      attempts: 0,
    });

    // Still `ok`: this is a property of the document, not a transient
    // environment failure, so there is nothing for the retry machinery to do.
    // What changes is that it is no longer *silent*.
    expect(outcome).toEqual({ ok: true });
    expect(empties).toEqual([
      {
        sourcePath: 'Lectures/unreachable.pdf',
        format: 'pdf',
        outcome: 'no-pages-found',
      },
    ]);
  });

  it('does not report a source that produced pages, however low their yield', async () => {
    const vault = new MemoryVaultSource();
    // Every page routes to vision at zero characters — a real result, not an
    // empty one, and the hook must not cry wolf about it.
    vault.setBinary('Lectures/scanned.pdf', buildPdfBytes(['', '']));
    const empties: EmptyExtractionReport[] = [];

    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue: vi.fn(async () => ({ status: 'queued' as const })) },
      sink: new CollectingSink(),
      onEmptyExtraction: (report) => empties.push(report),
    });

    await runner({
      contentHash: 'h-scanned',
      label: 'Scanned deck',
      payload: { kind: 'source', sourcePath: 'Lectures/scanned.pdf', format: 'pdf' },
      attempts: 0,
    });

    expect(empties).toEqual([]);
  });

  it('names the note an unreachable embed was linked from', async () => {
    const vault = new MemoryVaultSource();
    vault.setText('Lectures/Week 1.md', 'Slides here: ![[unreachable.pdf]]\n');
    vault.setBinary('Lectures/unreachable.pdf', buildNoPagesPdfBytes());
    const empties: EmptyExtractionReport[] = [];

    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue: vi.fn(async () => ({ status: 'queued' as const })) },
      sink: new CollectingSink(),
      onEmptyExtraction: (report) => empties.push(report),
    });

    const outcome = await runner({
      contentHash: 'h-note',
      label: 'Week 1',
      payload: { kind: 'note', notePath: 'Lectures/Week 1.md' },
      attempts: 0,
    });

    expect(outcome).toEqual({ ok: true });
    expect(empties).toHaveLength(1);
    expect(empties[0]?.outcome).toBe('no-pages-found');
    expect(empties[0]?.embeddedIn?.notePath).toBe('Lectures/Week 1.md');
  });

  it('is optional: a host that supplies no hook still runs an empty source without throwing', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/unreachable.pdf', buildNoPagesPdfBytes());

    const runner = createExtractionJobRunner({
      vault,
      enqueuer: { enqueue: vi.fn(async () => ({ status: 'queued' as const })) },
      sink: new CollectingSink(),
    });

    await expect(
      runner({
        contentHash: 'h-nohook',
        label: 'Unreachable deck',
        payload: { kind: 'source', sourcePath: 'Lectures/unreachable.pdf', format: 'pdf' },
        attempts: 0,
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe('isExtractionJobPayload', () => {
  it.each([
    [{ kind: 'note', notePath: 'a.md' }, true],
    [{ kind: 'source', sourcePath: 'a.pdf', format: 'pdf' }, true],
    [{ kind: 'source', sourcePath: 'a.pdf', format: 'not-a-format' }, false],
    [{ kind: 'vision-page', sourcePath: 'a.pdf', format: 'pdf', page: 2 }, true],
    [{ kind: 'vision-page', sourcePath: 'a.pdf', format: 'pdf' }, false], // missing page
    [{ kind: 'unknown' }, false],
    [null, false],
    [42, false],
  ] as const)('%j -> %s', (value, expected) => {
    expect(isExtractionJobPayload(value)).toBe(expected);
  });
});
