/**
 * `buildIngestionRunner` tests (C3, P3-T03a / DF-21a) — see
 * `features/C3-ingestion.md`'s "Plugin-side extraction runner wiring"
 * scenarios, which this file's `describe`/`it` names are written to
 * satisfy directly.
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`VaultSource`, `QueueStore`, `DeviceCapability` — all structural ports
 * `olea-core` defines) — no `obsidian` import anywhere in this file, and
 * none needed: `wiring.ts` itself never imports `obsidian` (see its module
 * doc), so this is a full, real exercise of the composition logic, not a
 * mock of it. What is NOT proven here, because it cannot be without a
 * running Obsidian host: that `main.ts` actually calls `buildIngestionRunner`
 * with a real `ObsidianSource`/`ObsidianQueueStore`/`obsidianDeviceCapability()`
 * and that a real `Vault` produces the same result — see this bead's report
 * for what stays unproven and the `@manual` scenario in
 * `features/C3-ingestion.md`.
 */
import type {
  ExtractedUnit,
  JobStatus,
  ListOptions,
  OutcomeProvenance,
  OutcomeSourceReference,
  PersistedJob,
  PersistedQueue,
  QueueStore,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { resolveConceptKey } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildFirstReadFolderViews,
  buildIngestionRunner,
  buildOutcomesExtractWiring,
  type FirstReadFolderCounts,
  firstReadFoldersJustFinished,
  runOutcomesExtract,
  runOutcomesExtractAndReconcile,
  summarizeFirstReadByFolder,
} from '../../src/ingestion/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

// ---- a tiny hand-built single-page PDF, same technique
// `packages/core/src/ingestion/extraction-runner.spec.ts` uses (see its own
// comment): enough to exercise the real pdf extractor's text layer, not a
// mock of it. Invented content only (INV-3).

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function buildOnePagePdf(pageText: string): Uint8Array {
  const raw = `BT /F1 12 Tf 20 150 Td (${escapePdfLiteral(pageText)}) Tj ET`;
  const streamText = new TextDecoder('latin1').decode(asciiBytes(raw));
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${streamText.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
  ];
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  return asciiBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

/** In-memory `VaultSource` — the plugin's own testable seam for anything that would otherwise need a real Obsidian `Vault` (same role `ObsidianSource` fills in production; see `vault/obsidian-source.ts`'s module doc for why that class itself has no test file). */
class MemoryVaultSource implements VaultSource {
  private readonly binary = new Map<string, Uint8Array>();

  setBinary(path: VaultPath, bytes: Uint8Array): void {
    this.binary.set(path, bytes);
  }

  async list(_options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return [...this.binary.keys()].sort();
  }

  async read(path: VaultPath): Promise<string> {
    throw new Error(`MemoryVaultSource.read: no text files in this fake (${path})`);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const found = this.binary.get(path);
    if (!found) throw new Error(`not found: ${path}`);
    return found;
  }

  async write(): Promise<void> {
    throw new Error('MemoryVaultSource.write: not needed by these tests');
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.binary.has(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

/** In-memory `QueueStore` — the same role `ObsidianQueueStore` fills over `data.json` in production. */
class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

const CAN_DRAIN = { canDrain: true };
const CANNOT_DRAIN = { canDrain: false };

describe('buildIngestionRunner — construction', () => {
  it('resolves an engine and a sink, with the deferred enqueuer already bound (enqueue works immediately)', async () => {
    const vault = new MemoryVaultSource();
    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
    });

    expect(engine).toBeDefined();
    expect(sink).toBeDefined();
    expect(sink.all()).toEqual([]);

    // The runner's `deferredEnqueuer` is bound before `buildIngestionRunner`
    // resolves — enqueueing a vision-page follow-on job (something only the
    // runner itself does, deep inside a drain) would throw
    // "called before bind()" if it weren't. Proven indirectly below by a
    // full drain succeeding; proven directly here by the engine itself
    // being usable immediately.
    const result = await engine.enqueue({
      contentHash: 'construction-check',
      label: 'construction check',
      payload: { kind: 'source', sourcePath: 'nope.pdf', format: 'pdf' },
    });
    expect(result).toEqual({ status: 'queued' });
  });
});

describe('buildIngestionRunner — a lecture enqueued drains and produces indexed units', () => {
  it('enqueuing a PDF source job and ticking the engine extracts it through to the sink', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary(
      'Lectures/GEOL204-week2.pdf',
      buildOnePagePdf('GEOL204 Week 2 — Stratigraphic succession'),
    );

    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
    });

    const enqueueResult = await engine.enqueue({
      contentHash: 'lecture-week2',
      label: 'GEOL204 Week 2',
      payload: { kind: 'source', sourcePath: 'Lectures/GEOL204-week2.pdf', format: 'pdf' },
    });
    expect(enqueueResult).toEqual({ status: 'queued' });
    expect(sink.all()).toEqual([]); // nothing drained yet — enqueue alone extracts nothing

    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'ran', contentHash: 'lecture-week2', outcome: 'done' });

    const units: readonly ExtractedUnit[] = sink.forSource('Lectures/GEOL204-week2.pdf');
    expect(units).toHaveLength(1);
    expect(units[0]?.text).toContain('Stratigraphic succession');
    expect(units[0]?.provenance.sourcePath).toBe('Lectures/GEOL204-week2.pdf');
    expect(units[0]?.provenance.location.page).toBe(1);
    expect(sink.all()).toEqual(units);

    // The job itself is now recorded done — draining again is a no-op, not
    // a re-extraction (D-002 idempotency), so the sink gains nothing more.
    const secondTick = await engine.tick();
    expect(secondTick).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(sink.forSource('Lectures/GEOL204-week2.pdf')).toHaveLength(1);
  });

  it('a device that cannot drain (mobile, D-002) enqueues but never extracts — the sink stays empty', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/deck.pdf', buildOnePagePdf('A lecture deck.'));

    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CANNOT_DRAIN,
    });

    await engine.enqueue({
      contentHash: 'mobile-lecture',
      label: 'A lecture deck',
      payload: { kind: 'source', sourcePath: 'Lectures/deck.pdf', format: 'pdf' },
    });

    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'blocked', reason: 'device-cannot-drain' });
    expect(sink.all()).toEqual([]);
  });
});

// F1.4/`[D-213]`, `ol-0r92.47` — the first-read readout's data half:
// per-folder honest counts, never merged into a vault-wide figure, and a
// concept landing that is never gated on its folder's counts settling.

/** A minimal `'source'`-kind job at a given status, for grouping tests only — never drained. */
function sourceJob(sourcePath: VaultPath, status: JobStatus): PersistedJob {
  return {
    contentHash: `hash:${sourcePath}:${status}`,
    label: sourcePath,
    payload: { kind: 'source', sourcePath, format: 'pdf' },
    enqueuedAt: 0,
    status,
    attempts: 0,
  };
}

describe('summarizeFirstReadByFolder', () => {
  it('gives each folder its own counts, never merged into one vault-wide figure', () => {
    const jobs: readonly PersistedJob[] = [
      sourceJob('COGS214/week1.pdf', 'done'),
      sourceJob('COGS214/week2.pdf', 'queued'),
      sourceJob('PSYC231/lecture1.pdf', 'failed'),
    ];

    const byFolder = summarizeFirstReadByFolder(jobs, ['COGS214', 'PSYC231']);

    expect(byFolder).toEqual([
      {
        folder: 'COGS214',
        counts: { queued: 1, 'in-flight': 0, done: 1, deferred: 0, failed: 0 },
      },
      {
        folder: 'PSYC231',
        counts: { queued: 0, 'in-flight': 0, done: 0, deferred: 0, failed: 1 },
      },
    ]);
  });

  it('five folders of very different sizes each keep their own line', () => {
    const folders = ['A', 'B', 'C', 'D', 'E'];
    const sizes = [1, 3, 0, 34, 12];
    const jobs: PersistedJob[] = [];
    folders.forEach((folder, i) => {
      const size = sizes[i] ?? 0;
      for (let n = 0; n < size; n++) jobs.push(sourceJob(`${folder}/doc${n}.pdf`, 'done'));
    });

    const byFolder = summarizeFirstReadByFolder(jobs, folders);

    expect(byFolder).toHaveLength(5);
    byFolder.forEach((entry, i) => {
      expect(entry.folder).toBe(folders[i]);
      expect(entry.counts.done).toBe(sizes[i]);
    });
  });

  it('nested sub-folders (F1.3: PSYCH326-style WEEK 2/WEEK 3 structure) still count toward the course folder', () => {
    const jobs: readonly PersistedJob[] = [sourceJob('PSYCH326/WEEK 2/slides.pdf', 'in-flight')];
    const byFolder = summarizeFirstReadByFolder(jobs, ['PSYCH326']);
    expect(byFolder[0]?.counts['in-flight']).toBe(1);
  });

  it('a job whose payload names no source (e.g. a future non-source job kind) matches no folder', () => {
    const jobs: readonly PersistedJob[] = [
      { ...sourceJob('COGS214/week1.pdf', 'done'), payload: { kind: 'instrument-revision' } },
    ];
    const byFolder = summarizeFirstReadByFolder(jobs, ['COGS214']);
    expect(byFolder[0]?.counts.done).toBe(0);
  });

  it('never returns anything but the five plain counts — no derived percentage field to draw a bar from', () => {
    const byFolder = summarizeFirstReadByFolder([sourceJob('COGS214/x.pdf', 'done')], ['COGS214']);
    expect(Object.keys(byFolder[0]?.counts ?? {}).sort()).toEqual(
      ['deferred', 'done', 'failed', 'in-flight', 'queued'].sort(),
    );
  });
});

describe('buildFirstReadFolderViews', () => {
  it('a concept appears before its folder finishes — landed concepts are never gated on counts settling', () => {
    const jobs: readonly PersistedJob[] = [
      sourceJob('COGS214/week1.pdf', 'done'),
      sourceJob('COGS214/week2.pdf', 'queued'),
      sourceJob('COGS214/week3.pdf', 'queued'),
    ];
    const landed = new Map<VaultPath, readonly string[]>([
      ['COGS214', ['Stratigraphic succession']],
    ]);

    const views = buildFirstReadFolderViews(jobs, ['COGS214'], landed);

    expect(views).toHaveLength(1);
    const cogs = views.at(0);
    expect(cogs).toBeDefined();
    if (cogs === undefined) return;
    expect(cogs.counts.done).toBe(1);
    expect(cogs.counts.queued).toBe(2); // this folder has not finished
    expect(cogs.landedConcepts).toEqual(['Stratigraphic succession']); // yet the concept already shows
  });

  it('a folder with nothing landed yet gets an empty list, never a fabricated placeholder', () => {
    const views = buildFirstReadFolderViews(
      [sourceJob('PSYC231/lecture1.pdf', 'queued')],
      ['PSYC231'],
      new Map(),
    );
    expect(views[0]?.landedConcepts).toEqual([]);
  });
});

// `[D-219]` (`ol-9c0k`): which folders just finished extracting, so
// `main.ts` knows when to fire its one-D-068-reader-call-per-folder — the
// per-folder analogue of `concept/corpusRelationTrigger.ts`'s
// `ingestionSessionJustClosed`.

const IDLE: FirstReadFolderCounts = { queued: 0, 'in-flight': 0, done: 3, deferred: 0, failed: 0 };
const ACTIVE: FirstReadFolderCounts = {
  queued: 2,
  'in-flight': 1,
  done: 1,
  deferred: 0,
  failed: 0,
};

describe('firstReadFoldersJustFinished', () => {
  it('reports a folder that had work last tick and has none now', () => {
    const previous = new Map<VaultPath, FirstReadFolderCounts>([['COGS214', ACTIVE]]);
    const current = [{ folder: 'COGS214' as VaultPath, counts: IDLE }];

    expect(firstReadFoldersJustFinished(previous, current)).toEqual(['COGS214']);
  });

  it('never reports a folder still doing work', () => {
    const previous = new Map<VaultPath, FirstReadFolderCounts>([['COGS214', ACTIVE]]);
    const current = [{ folder: 'COGS214' as VaultPath, counts: ACTIVE }];

    expect(firstReadFoldersJustFinished(previous, current)).toEqual([]);
  });

  it('never reports a folder this map has not observed before — nothing recorded to have finished', () => {
    const current = [{ folder: 'COGS214' as VaultPath, counts: IDLE }];

    expect(firstReadFoldersJustFinished(new Map(), current)).toEqual([]);
  });

  it('never reports a folder idle on both the previous and the current tick — idle-to-idle is not a finish', () => {
    const previous = new Map<VaultPath, FirstReadFolderCounts>([['COGS214', IDLE]]);
    const current = [{ folder: 'COGS214' as VaultPath, counts: IDLE }];

    expect(firstReadFoldersJustFinished(previous, current)).toEqual([]);
  });

  it('fires again the next time the same folder drains, after gaining new files mid-term (F1.4)', () => {
    const previous = new Map<VaultPath, FirstReadFolderCounts>([['COGS214', ACTIVE]]);
    const current = [{ folder: 'COGS214' as VaultPath, counts: IDLE }];
    const firstFinish = firstReadFoldersJustFinished(previous, current);
    expect(firstFinish).toEqual(['COGS214']);

    // A new file arrives, this folder goes active again, then drains a second time.
    const secondPrevious = new Map<VaultPath, FirstReadFolderCounts>([['COGS214', ACTIVE]]);
    const secondCurrent = [{ folder: 'COGS214' as VaultPath, counts: IDLE }];
    expect(firstReadFoldersJustFinished(secondPrevious, secondCurrent)).toEqual(['COGS214']);
  });

  it('five folders of different sizes: only the ones that transitioned to idle are reported, each independently', () => {
    const previous = new Map<VaultPath, FirstReadFolderCounts>([
      ['A', ACTIVE],
      ['B', IDLE],
      ['C', ACTIVE],
      ['D', ACTIVE],
      ['E', ACTIVE],
    ]);
    const current = [
      { folder: 'A' as VaultPath, counts: IDLE }, // just finished
      { folder: 'B' as VaultPath, counts: IDLE }, // was already idle — not a finish
      { folder: 'C' as VaultPath, counts: ACTIVE }, // still going
      { folder: 'D' as VaultPath, counts: IDLE }, // just finished
      { folder: 'E' as VaultPath, counts: ACTIVE }, // still going
    ];

    expect(firstReadFoldersJustFinished(previous, current)).toEqual(['A', 'D']);
  });
});

// `ol-15f8`: `deps.vision`'s composition — the same F7.8 grey-out shape
// `concept/wiring.ts`'s `buildConceptWiring` tests already use (see
// `test/concept/wiring.spec.ts`'s `FakeDataHost`/`configuredHost`).

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function configuredHost(config: PersistedWorkerConfig): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = { [WORKER_CONFIG_STORAGE_KEY]: config };
  return host;
}

function fakeTransport(reply: (request: WorkerTaskRequest) => unknown) {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      return reply(request);
    },
  };
}

const FAKE_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function visionOkResponse(result: unknown) {
  return { ok: true, stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'm' }, result };
}

/** The queue's own persisted `failedReason` for one job — `TickResult` itself carries no reason field, only `QueueStore`'s persisted record does. */
async function failedReasonFor(
  queueStore: QueueStore,
  contentHash: string,
): Promise<string | undefined> {
  const queue = await queueStore.load();
  return queue?.jobs.find((job) => job.contentHash === contentHash)?.failedReason;
}

describe('buildIngestionRunner — deps.vision (ol-15f8)', () => {
  it('omitted (the default, and today\'s real main.ts call): a drained vision-page job keeps DF-21\'s honest "no visionRunner wired yet" failure', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const queueStore = new MemoryQueueStore();
    const { engine } = await buildIngestionRunner({
      vault,
      queueStore,
      capability: CAN_DRAIN,
    });

    await engine.enqueue({
      contentHash: 'vision-no-deps',
      label: 'a standalone image',
      payload: { kind: 'vision-page', sourcePath: 'Slides/diagram.png', format: 'image', page: 1 },
    });
    const tick = await engine.tick();

    expect(tick).toEqual({ kind: 'ran', contentHash: 'vision-no-deps', outcome: 'failed' });
    expect(await failedReasonFor(queueStore, 'vision-no-deps')).toContain(
      'no visionRunner wired yet',
    );
  });

  it('supplied but the Worker is not configured yet (F7.8): visionRunner stays unset, same DF-21 failure', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const transport = fakeTransport(() => visionOkResponse({ readable: true, extractedText: 'x' }));
    const queueStore = new MemoryQueueStore();
    const { engine } = await buildIngestionRunner({
      vault,
      queueStore,
      capability: CAN_DRAIN,
      vision: {
        dataHost: new FakeDataHost(), // never configured — loadData() resolves to null
        createTransport: (_config: WorkerConfig) => transport,
      },
    });

    await engine.enqueue({
      contentHash: 'vision-unconfigured',
      label: 'a standalone image',
      payload: { kind: 'vision-page', sourcePath: 'Slides/diagram.png', format: 'image', page: 1 },
    });
    const tick = await engine.tick();

    expect(tick).toEqual({ kind: 'ran', contentHash: 'vision-unconfigured', outcome: 'failed' });
    expect(await failedReasonFor(queueStore, 'vision-unconfigured')).toContain(
      'no visionRunner wired yet',
    );
    expect(transport.calls).toHaveLength(0);
  });

  it('supplied and configured: a drained vision-page job for a standalone image reaches the real transport and lands a unit in the sink', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const transport = fakeTransport(() =>
      visionOkResponse({
        outcome: 'complete',
        extractedText: 'Figure 3: the rock cycle',
        figureDescription: null,
        coverage: null,
        unreadableReason: null,
      }),
    );
    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      vision: {
        dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
        createTransport: (_config: WorkerConfig) => transport,
      },
    });

    await engine.enqueue({
      contentHash: 'vision-configured',
      label: 'a standalone image',
      payload: { kind: 'vision-page', sourcePath: 'Slides/diagram.png', format: 'image', page: 1 },
    });
    const tick = await engine.tick();

    expect(tick).toEqual({ kind: 'ran', contentHash: 'vision-configured', outcome: 'done' });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('vision.extract.v2');

    const units = sink.forSource('Slides/diagram.png');
    expect(units).toHaveLength(1);
    expect(units[0]?.text).toBe('Figure 3: the rock cycle');
    expect(units[0]?.provenance.location.page).toBe(1);
  });
});

// `deps.generation` (`ol-2zfj.63` [GEN-3.1], `[D-238]`) — the client
// ingestion-queue generation policy. Same F7.8-shaped opt-in composition as
// `deps.vision` above: absent leaves this function untouched (proven by
// every OTHER describe block in this file, which never supplies it), and
// present wires both halves `generation-queue.ts` builds — see that module's
// own doc and `wiring.ts`'s module doc's own `deps.generation` section.

describe('buildIngestionRunner — deps.generation (ol-2zfj.63 [GEN-3.1], [D-238])', () => {
  it('omitted (the default): a drained generation-kind job gets the extraction runner\'s own "not an extraction job" failure, never a crash', async () => {
    const vault = new MemoryVaultSource();
    const queueStore = new MemoryQueueStore();
    const { engine } = await buildIngestionRunner({ vault, queueStore, capability: CAN_DRAIN });

    await engine.enqueue({
      contentHash: 'generation-no-deps',
      label: 'a generation job with no runner composed for it',
      payload: {
        kind: 'generation',
        courseCode: 'A',
        conceptKey: 'ck-1',
        conceptName: 'Osmosis',
        instrumentKind: 'mcq',
        trigger: 'arrival',
      },
    });
    const tick = await engine.tick();

    expect(tick).toEqual({ kind: 'ran', contentHash: 'generation-no-deps', outcome: 'failed' });
    expect(await failedReasonFor(queueStore, 'generation-no-deps')).toBeDefined();
  });

  it('a landed unit (a drained source job) enqueues a primary-kind generation call, which itself drains through deps.generation.draft', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary(
      '01 Courses/A/lecture.pdf',
      buildOnePagePdf('Osmosis moves water across a semi-permeable membrane.'),
    );
    const queueStore = new MemoryQueueStore();
    const draftCalls: unknown[] = [];

    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore,
      capability: CAN_DRAIN,
      generation: {
        draft: async (job) => {
          draftCalls.push(job.payload);
          return { ok: true };
        },
        hasAnyBuiltKind: async () => false,
        listConceptsForCourse: async (courseCode) => [
          { name: 'Osmosis', key: 'ck-osmosis', courses: [courseCode] } as never,
        ],
      },
    });

    // Drain 1: the source (extraction) job — lands a unit, which the
    // generation-enqueue hook turns into one primary-kind job on the SAME
    // engine, entirely within this one `receive()` call, before `tick()`
    // below ever returns.
    await engine.enqueue({
      contentHash: 'lecture-arrival',
      label: 'a lecture PDF',
      payload: { kind: 'source', sourcePath: '01 Courses/A/lecture.pdf', format: 'pdf' },
    });
    const firstTick = await engine.tick();
    expect(firstTick).toEqual({ kind: 'ran', contentHash: 'lecture-arrival', outcome: 'done' });
    expect(sink.forSource('01 Courses/A/lecture.pdf')).toHaveLength(1);
    expect(draftCalls).toHaveLength(0); // enqueued, not yet drained

    // Drain 2: the generation job the hook just enqueued — never at session
    // time, never outside this engine's own tick loop.
    const secondTick = await engine.tick();
    expect(secondTick).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(draftCalls).toHaveLength(1);
    expect(draftCalls[0]).toMatchObject({
      kind: 'generation',
      courseCode: 'A',
      conceptKey: 'ck-osmosis',
      conceptName: 'Osmosis',
      trigger: 'arrival',
    });

    // Nothing left to drain — the primary call fired exactly once.
    const thirdTick = await engine.tick();
    expect(thirdTick).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
  });

  it('a concept hasAnyBuiltKind already reports built is never re-enqueued on a later arrival', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary(
      '01 Courses/A/lecture.pdf',
      buildOnePagePdf('Diffusion equalises concentration.'),
    );
    const draftCalls: unknown[] = [];

    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      generation: {
        draft: async (job) => {
          draftCalls.push(job.payload);
          return { ok: true };
        },
        hasAnyBuiltKind: async () => true, // already has an instrument — D-238's "one call," not one per sweep
        listConceptsForCourse: async (courseCode) => [
          { name: 'Diffusion', key: 'ck-diffusion', courses: [courseCode] } as never,
        ],
      },
    });

    await engine.enqueue({
      contentHash: 'lecture-already-built',
      label: 'a lecture PDF',
      payload: { kind: 'source', sourcePath: '01 Courses/A/lecture.pdf', format: 'pdf' },
    });
    await engine.tick(); // drains extraction, runs the (no-op) generation-enqueue hook
    const secondTick = await engine.tick();
    expect(secondTick).toEqual({ kind: 'idle', reason: 'nothing-eligible' }); // nothing was enqueued
    expect(draftCalls).toHaveLength(0);
  });
});

// `buildOutcomesExtractWiring` / `runOutcomesExtract` (`ol-4s30` [EXT-13]) —
// the adapter-plus-store composition landed by the orchestrator once
// `packages/core/src/outcome/` and the client adapter both existed. Same
// F7.8 grey-out shape as `deps.vision` above; see `wiring.ts`'s own module
// doc on this composition for the reachability note (no production caller
// yet — the task id is not in the frozen catalogue) and the known
// `confidence`-field gap this section deliberately surfaces rather than
// papering over.

/** A small writable, text-capable `VaultSource` fake — `MemoryVaultSource` above is binary-only ("no text files in this fake"), and `resolveOutcome` needs real `list`/`read`/`write` over `.olea/outcomes/`. */
class WritableTextVault implements VaultSource {
  private readonly files = new Map<string, string>();

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    let paths = [...this.files.keys()];
    if (options.under !== undefined) {
      const prefix = `${options.under}/`;
      paths = paths.filter((path) => path.startsWith(prefix));
    }
    if (options.extensions !== undefined) {
      const exts = options.extensions;
      paths = paths.filter((path) => exts.some((ext) => path.toLowerCase().endsWith(`.${ext}`)));
    }
    return paths.sort();
  }

  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(path));
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

function outcomesExtractResponse(result: unknown) {
  return { ok: true, result };
}

const TEST_PROVENANCE: OutcomeProvenance = { promptVersion: 'v-test', modelVersion: 'm-test' };

describe('buildOutcomesExtractWiring — F7.8 grey-out', () => {
  it('the Worker is not configured yet: reader stays null, and the transport is never touched', async () => {
    const transport = fakeTransport(() =>
      outcomesExtractResponse({ outcomes: [], paperStructure: { sections: [] } }),
    );
    const wiring = await buildOutcomesExtractWiring({
      dataHost: new FakeDataHost(), // never configured — loadData() resolves to null
      createTransport: (_config: WorkerConfig) => transport,
    });

    expect(wiring.reader).toBeNull();
    expect(transport.calls).toHaveLength(0);
  });

  it('the Worker is configured: builds a real, usable reader', async () => {
    const transport = fakeTransport(() =>
      outcomesExtractResponse({ outcomes: [], paperStructure: { sections: [] } }),
    );
    const wiring = await buildOutcomesExtractWiring({
      dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
      createTransport: (_config: WorkerConfig) => transport,
    });

    expect(wiring.reader).not.toBeNull();
  });
});

describe('runOutcomesExtract — adapter plus outcome-store composition', () => {
  it('resolves every outcome candidate into a persisted OutcomeRecord, courses and provenance threaded through from the caller', async () => {
    const transport = fakeTransport(() =>
      outcomesExtractResponse({
        outcomes: [
          { label: 'Explain diffusion across a membrane', confidence: 0.9, anchorIndex: 1 },
        ],
        paperStructure: { sections: [] },
      }),
    );
    const { reader } = await buildOutcomesExtractWiring({
      dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
      createTransport: (_config: WorkerConfig) => transport,
    });
    if (reader === null) throw new Error('expected a configured reader');

    const vault = new WritableTextVault();
    const anchor: OutcomeSourceReference = { path: 'Objectives/week1.md', blockIndex: 0 };
    const passages = [{ text: 'Explain diffusion across a membrane, with examples.', anchor }];

    const result = await runOutcomesExtract(vault, reader, passages, {
      documentKind: 'objectives',
      courses: ['TESTC101'],
      provenance: TEST_PROVENANCE,
    });

    expect(result.outcomes).toHaveLength(1);
    const [record] = result.outcomes;
    expect(record).toMatchObject({
      courses: ['TESTC101'],
      source: anchor,
      label: 'Explain diffusion across a membrane',
      conceptKeys: [],
      status: 'active',
      provenance: TEST_PROVENANCE,
      // `[D-253]`'s ratifying amendment: the candidate's own `confidence` lands verbatim as
      // `extractorSelfRating` — never rounded, clamped or interpreted by this composition.
      extractorSelfRating: 0.9,
    });
    // Persisted, not just returned — the whole point of composing the store.
    expect(await vault.list({ under: '.olea/outcomes', extensions: ['json'] })).toHaveLength(1);
  });

  it('resolving the SAME source twice returns the SAME record rather than minting a duplicate ([D-088]-shaped conservation)', async () => {
    const transport = fakeTransport(() =>
      outcomesExtractResponse({
        outcomes: [
          { label: 'Explain diffusion across a membrane', confidence: 0.9, anchorIndex: 1 },
        ],
        paperStructure: { sections: [] },
      }),
    );
    const { reader } = await buildOutcomesExtractWiring({
      dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
      createTransport: (_config: WorkerConfig) => transport,
    });
    if (reader === null) throw new Error('expected a configured reader');

    const vault = new WritableTextVault();
    const anchor: OutcomeSourceReference = { path: 'Objectives/week1.md', blockIndex: 0 };
    const passages = [{ text: 'Explain diffusion across a membrane, with examples.', anchor }];
    const options = {
      documentKind: 'objectives' as const,
      courses: ['TESTC101'],
      provenance: TEST_PROVENANCE,
    };

    const first = await runOutcomesExtract(vault, reader, passages, options);
    const second = await runOutcomesExtract(vault, reader, passages, options);

    expect(second.outcomes[0]?.id).toBe(first.outcomes[0]?.id);
    expect(await vault.list({ under: '.olea/outcomes', extensions: ['json'] })).toHaveLength(1);
  });

  it('carries paper-structure sections through verbatim, resolved to the same OutcomeSourceReference anchor, without persisting them', async () => {
    const transport = fakeTransport(() =>
      outcomesExtractResponse({
        outcomes: [],
        paperStructure: {
          sections: [
            {
              label: 'Section A',
              questionForm: 'short-answer',
              itemCount: 5,
              marks: 10,
              anchorIndex: 1,
            },
          ],
        },
      }),
    );
    const { reader } = await buildOutcomesExtractWiring({
      dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
      createTransport: (_config: WorkerConfig) => transport,
    });
    if (reader === null) throw new Error('expected a configured reader');

    const vault = new WritableTextVault();
    const anchor: OutcomeSourceReference = { path: 'Papers/2024-past-paper.md', blockIndex: 2 };
    const passages = [{ text: 'Section A: answer all questions.', anchor }];

    const result = await runOutcomesExtract(vault, reader, passages, {
      documentKind: 'past-paper',
      courses: ['TESTC101'],
      provenance: TEST_PROVENANCE,
    });

    expect(result.outcomes).toHaveLength(0);
    expect(result.paperStructure.sections).toEqual([
      { label: 'Section A', questionForm: 'short-answer', itemCount: 5, marks: 10, anchor },
    ]);
    expect(await vault.list({ under: '.olea/outcomes', extensions: ['json'] })).toHaveLength(0);
  });
});

// `runOutcomesExtractAndReconcile` (`[OUT-3]`) — `runOutcomesExtract` above, plus the outcome→
// concept containment reconciliation (`olea-core`'s `outcome/reconcile.ts`) against whatever
// concept key records already exist in the vault, scoped to the run's own courses. See
// `wiring.ts`'s own module doc on this composition for the reachability note (same `[EXT-14]`
// gate `runOutcomesExtract` carries, no `main.ts` caller yet).
describe('runOutcomesExtractAndReconcile — outcome extraction plus concept containment ([OUT-3])', () => {
  it('attaches an exact-matching concept and leaves an unmatched outcome unattached', async () => {
    const transport = fakeTransport(() =>
      outcomesExtractResponse({
        outcomes: [
          { label: 'Cell biology', confidence: 0.9, anchorIndex: 1 },
          { label: 'Unrelated topic', confidence: 0.8, anchorIndex: 1 },
        ],
        paperStructure: { sections: [] },
      }),
    );
    const { reader } = await buildOutcomesExtractWiring({
      dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
      createTransport: (_config: WorkerConfig) => transport,
    });
    if (reader === null) throw new Error('expected a configured reader');

    const vault = new WritableTextVault();
    await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'TESTC101',
      name: 'Cell biology',
      aliases: [],
    });

    const anchor: OutcomeSourceReference = { path: 'Objectives/week1.md', blockIndex: 0 };
    const passages = [{ text: 'Cell biology and an unrelated topic, with examples.', anchor }];

    const result = await runOutcomesExtractAndReconcile(vault, reader, passages, {
      documentKind: 'objectives',
      courses: ['TESTC101'],
      provenance: TEST_PROVENANCE,
    });

    expect(result.outcomes).toHaveLength(2);
    const matched = result.outcomes.find((outcome) => outcome.label === 'Cell biology');
    const unmatched = result.outcomes.find((outcome) => outcome.label === 'Unrelated topic');
    expect(matched?.conceptKeys).toHaveLength(1);
    expect(unmatched?.conceptKeys).toEqual([]);

    expect(result.reconciliation.attached).toHaveLength(1);
    expect(result.reconciliation.attached[0]?.outcomeId).toBe(matched?.id);
    expect(result.reconciliation.unattachedOutcomeIds).toEqual([unmatched?.id]);
  });

  it('scopes a topic-anchored concept to its own course — a same-named concept in a different course never attaches', async () => {
    const transport = fakeTransport(() =>
      outcomesExtractResponse({
        outcomes: [{ label: 'Cell biology', confidence: 0.9, anchorIndex: 1 }],
        paperStructure: { sections: [] },
      }),
    );
    const { reader } = await buildOutcomesExtractWiring({
      dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
      createTransport: (_config: WorkerConfig) => transport,
    });
    if (reader === null) throw new Error('expected a configured reader');

    const vault = new WritableTextVault();
    await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'OTHERCOURSE',
      name: 'Cell biology',
      aliases: [],
    });

    const anchor: OutcomeSourceReference = { path: 'Objectives/week1.md', blockIndex: 0 };
    const passages = [{ text: 'Cell biology, with examples.', anchor }];

    const result = await runOutcomesExtractAndReconcile(vault, reader, passages, {
      documentKind: 'objectives',
      courses: ['TESTC101'],
      provenance: TEST_PROVENANCE,
    });

    expect(result.reconciliation.attached).toEqual([]);
    expect(result.reconciliation.unattachedOutcomeIds).toEqual([result.outcomes[0]?.id]);
  });
});
