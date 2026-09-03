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
  PersistedJob,
  PersistedQueue,
  QueueStore,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildFirstReadFolderViews,
  buildIngestionRunner,
  type FirstReadFolderCounts,
  firstReadFoldersJustFinished,
  summarizeFirstReadByFolder,
} from '../../src/ingestion/wiring.js';

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
