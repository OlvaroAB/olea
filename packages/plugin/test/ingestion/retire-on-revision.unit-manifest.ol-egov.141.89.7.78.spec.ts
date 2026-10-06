/**
 * `[D-531]` composed end to end (`ol-egov.141.89.7.78`): the durable page record
 * (`../../src/grove/unit-manifest-store.ts`) handed to the outcomes trigger as its page record,
 * exactly as `main.ts` composes it once the one-object change this bead's report carries is applied
 * there (`outcomes.revisions`, beside `outcomes.scopeReading`). Nothing here imports `main.ts`; the
 * `revisions` object below is that change, line for line.
 *
 * Driven through `buildIngestionRunner` with real one-page PDFs, the real extractors and the real
 * content hash, so the page record lists each version from the file's own bytes and every delivery
 * carries the digest of the bytes it was read from. Written to olea-service `features/
 * F4-oracle.md`, F4.1, the two scenarios tagged with this file. Synthetic text only (INV-3).
 */
import {
  hashContent,
  listOutcomeRecords,
  type OutcomeRecord,
  type PersistedQueue,
  type QueueStore,
  type VaultPath,
  type VaultSource,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { unitManifestLogPath } from '../../../core/src/ingestion/unit-manifest/log.js';
import {
  parseUnitManifestLog,
  type UnitStateRecord,
} from '../../../core/src/ingestion/unit-manifest/records.js';
import { outcomeRevisionReadInFull } from '../../../core/src/outcome/retire-on-revision.js';
import {
  createVaultUnitManifestStore,
  type UnitManifestStore,
} from '../../src/grove/unit-manifest-store.js';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';
import { type EventedTestVault, eventedTestVault } from '../grove/unit-manifest-test-vault.js';

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function buildOnePagePdf(pageText: string): Uint8Array {
  const raw = `BT /F1 12 Tf 20 150 Td (${pageText}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
  ];
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  return asciiBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

class FakeDataHost {
  blob: unknown = {
    [WORKER_CONFIG_STORAGE_KEY]: {
      version: 1,
      baseUrl: 'https://worker.example',
      token: 't',
    } satisfies PersistedWorkerConfig,
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const NOW = new Date('2026-10-06T10:00:00Z');
const DAY = isoWithLocalOffset(NOW).slice(0, 10);
const DEVICE = 'olea-devicea0001';
const DOC = 'Objectives/Synthetic objectives.pdf' as VaultPath;
const SCAN = 'Objectives/Synthetic objectives scan.png' as VaultPath;
const ALPHA = 'Describe the synthetic alpha process in a closed system';
const BETA = 'Compare the two synthetic beta models of transport';
const V1 = buildOnePagePdf('Synthetic objectives version one');
const V2 = buildOnePagePdf('Synthetic objectives version two');
const V3 = buildOnePagePdf('Synthetic objectives version three');
const SCAN_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);

interface Harness {
  readonly vault: EventedTestVault;
  readonly store: UnitManifestStore;
  answer: readonly string[];
  /** Runs before the outcomes reply: a test uses it to replace the file during the call. */
  duringCall?: (() => void) | undefined;
  deliver(contentHash: string, sourcePath?: VaultPath): Promise<unknown>;
  tick(): Promise<unknown>;
}

async function composeAsMainTs(): Promise<Harness> {
  const vault = eventedTestVault({ [DOC]: V1, [SCAN]: SCAN_BYTES });
  // As `main.ts` builds it: one store per plugin instance, loaded before the queue drains.
  const unitManifests = createVaultUnitManifestStore({ vault, deviceId: DEVICE, now: () => NOW });
  await unitManifests.load();
  const state: Harness = {
    vault,
    store: unitManifests,
    answer: [],
    deliver: async () => undefined,
    tick: async () => undefined,
  };
  const transport = {
    send: async (request: WorkerTaskRequest) => {
      if (request.taskId === 'vision.extract.v2') {
        return {
          ok: true,
          stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'm-vision' },
          result: {
            outcome: 'complete',
            extractedText: state.answer.join('. '),
            figureDescription: null,
            coverage: null,
            unreadableReason: null,
          },
        };
      }
      state.duringCall?.();
      const chunks = (request.payload as { sourceChunks: string[] }).sourceChunks;
      return {
        ok: true,
        stamp: { promptVersion: '1.0.0', modelId: 'm-test' },
        result: {
          outcomes: state.answer.map((label) => ({ label, confidence: 0.9, anchorIndex: 1 })),
          paperStructure: { sections: [] },
          numbering: { chunks: chunks.map((c, i) => ({ sentIndex: i + 1, length: c.length })) },
        },
      };
    },
  };
  const dataHost = new FakeDataHost();
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new MemoryQueueStore(),
    capability: { canDrain: true },
    outcomes: {
      dataHost,
      createTransport: (_config: WorkerConfig) => transport,
      registeredDocumentFor: async (p: VaultPath) =>
        p === DOC || p === SCAN
          ? { documentKind: 'objectives' as const, courses: ['SYNTH101'] }
          : null,
      // The change this bead hands `main.ts` (`outcomes.revisions`), line for line.
      revisions: {
        currentRevision: (sourcePath) => unitManifests.outcomeRevisionPagesFor(sourcePath),
        markOutcomesExtracted: (sourcePath, revisionDigest, pages) =>
          unitManifests.recordOutcomeExtraction(sourcePath, revisionDigest, pages),
      },
    },
    // As `main.ts` composes the vision runner today: readings land in the page record.
    vision: {
      dataHost,
      createTransport: (_config: WorkerConfig) => transport,
      onManifestEntry: (entry) => unitManifests.recordReading(entry),
    },
  });
  state.deliver = async (contentHash: string, sourcePath: VaultPath = DOC) => {
    await engine.enqueue({
      contentHash,
      label: 'A registered document',
      payload: {
        kind: 'source',
        sourcePath,
        format: sourcePath === SCAN ? 'image' : 'pdf',
      },
    });
    return engine.tick();
  };
  state.tick = () => engine.tick();
  return state;
}

async function byLabel(vault: VaultSource): Promise<ReadonlyMap<string, OutcomeRecord>> {
  return new Map((await listOutcomeRecords(vault)).map(({ record }) => [record.label, record]));
}

function marks(vault: EventedTestVault): { digest: string; page: number }[] {
  const content = vault.contentOf(unitManifestLogPath(DAY, DEVICE)) ?? '';
  return parseUnitManifestLog(content)
    .records.filter(
      (record): record is UnitStateRecord =>
        record.kind === 'unit' && record.outcomeExtractionState === 'complete',
    )
    .map((record) => ({ digest: record.revisionDigest, page: record.page }));
}

describe('composed as main.ts composes it, retire on revision runs ([D-531])', () => {
  it("retires a revised document's stale outcomes once its version is read in full, and only then", async () => {
    const run = await composeAsMainTs();
    const d1 = await hashContent(V1);
    const d2 = await hashContent(V2);

    run.answer = [ALPHA, BETA];
    expect(await run.deliver('doc-v1')).toEqual({
      kind: 'ran',
      contentHash: 'doc-v1',
      outcome: 'done',
    });
    let records = await byLabel(run.vault);
    expect(records.get(ALPHA)?.statedInRevision).toBe(d1);
    expect(records.get(BETA)?.statedInRevision).toBe(d1);
    expect(marks(run.vault)).toEqual([{ digest: d1, page: 1 }]);

    // She replaces the file with a revision that no longer states beta; no vault event is needed.
    run.vault.put(DOC, V2);
    run.answer = [ALPHA];
    await run.deliver('doc-v2');
    records = await byLabel(run.vault);
    expect(records.size).toBe(2);
    expect(records.get(ALPHA)).toMatchObject({ status: 'active', statedInRevision: d2 });
    expect(records.get(BETA)).toMatchObject({ status: 'retired', statedInRevision: d1 });
    const current = await run.store.outcomeRevisionPagesFor(DOC);
    expect(current?.revisionDigest).toBe(d2);
    expect(current?.knownRevisions).toEqual([d1, d2].sort());
    expect(current === undefined ? false : outcomeRevisionReadInFull(current)).toBe(true);

    // A reread of the same revision that happens to state beta again retires and reinstates nothing.
    run.answer = [ALPHA, BETA];
    await run.deliver('doc-v2-again');
    records = await byLabel(run.vault);
    expect(records.get(BETA)).toMatchObject({ status: 'retired', statedInRevision: d1 });
    expect(records.get(ALPHA)).toMatchObject({ status: 'active', statedInRevision: d2 });

    // A late delivery: the file is replaced while the call for v2 is in flight. Nothing is written
    // for v2, and v3 is not marked by a delivery of other bytes.
    const marksBefore = marks(run.vault);
    run.duringCall = () => run.vault.put(DOC, V3);
    run.answer = [ALPHA, BETA, 'A wording no record matches'];
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await run.deliver('doc-v2-late');
    } finally {
      info.mockRestore();
    }
    run.duringCall = undefined;
    expect(marks(run.vault)).toEqual(marksBefore);
    expect((await byLabel(run.vault)).size).toBe(2);
  });

  it('a reload between versions keeps what the rule needs: the next revision still retires', async () => {
    const run = await composeAsMainTs();
    run.answer = [ALPHA, BETA];
    await run.deliver('doc-v1');
    // A fresh session reads the page record back from her vault.
    await run.store.load();
    run.vault.put(DOC, V2);
    run.answer = [ALPHA];
    await run.deliver('doc-v2');
    const records = await byLabel(run.vault);
    expect(records.get(BETA)?.status).toBe('retired');
    expect(records.get(ALPHA)?.status).toBe('active');
  });

  it('a document read from its image is not read in full while its image deliveries carry no digest', async () => {
    const run = await composeAsMainTs();
    run.answer = [ALPHA, BETA];
    // The source job finds no text layer and queues the image reading; the next tick reads it.
    await run.deliver('scan-v1', SCAN);
    expect(await run.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    await run.store.idle();
    const records = await byLabel(run.vault);
    expect(records.size).toBe(2);
    // Unplaced: minted with no stamp, so nothing can ever retire them on revision (safe, and stale).
    for (const record of records.values()) expect('statedInRevision' in record).toBe(false);
    expect(marks(run.vault)).toEqual([]);
    const pages = await run.store.outcomeRevisionPagesFor(SCAN);
    expect(
      pages?.history.map((state) => [state.page, state.reading, state.outcomesExtracted]),
    ).toEqual([[1, 'read', false]]);
    expect(pages === undefined ? true : outcomeRevisionReadInFull(pages)).toBe(false);
  });
});
