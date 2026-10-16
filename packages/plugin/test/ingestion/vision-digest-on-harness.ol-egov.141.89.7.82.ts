/**
 * Shared harness for the `ol-egov.141.89.7.82` specs that run with the image-page revision digest
 * switched on (sheet v59, Accept): the ingestion composed through `buildIngestionRunner` exactly as
 * `main.ts` composes it, so the vision page runner is the one `buildVisionRunner` builds, with
 * whatever digest setting production ships. Composed alongside, as `main.ts` does:
 *  - the outcomes trigger with the durable page record (`grove/unit-manifest-store.ts`) as its
 *    `revisions` (main.ts `outcomes.revisions`), and that store as the vision runner's manifest sink;
 *  - `onUnitsLanded` handing a delivery that carries a digest to the citation-revision rewrite
 *    (main.ts `onUnitsLanded`), with the real suspend port; every delivery is kept, because it is
 *    also what main.ts hands the generation sweep.
 *
 * One fake Worker answers both tasks. A vision reading depends on the bytes the runner actually
 * read: the page renderer encodes the PDF bytes' digest into the image, and the reading is looked
 * up by it, so a reading begun before the file changed returns the older version's text. The
 * outcomes reply states every sentence of the passages it is sent. A vision call can be held open
 * (`holdNextVision`) so a reading of older bytes lands after a newer version has been read.
 *
 * Every string and byte is invented (INV-3).
 */
import {
  type EnqueueInput,
  type ExtractedUnit,
  hashContent,
  type IngestionQueueEngine,
  listOutcomeRecords,
  type OutcomeRecord,
  type PersistedQueue,
  type QueueStore,
  type VaultPath,
  type WorkerTaskRequest,
} from 'olea-core';
import { vi } from 'vitest';
import { unitManifestLogPath } from '../../../core/src/ingestion/unit-manifest/log.js';
import {
  parseUnitManifestLog,
  type UnitStateRecord,
} from '../../../core/src/ingestion/unit-manifest/records.js';
import {
  createVaultUnitManifestStore,
  type UnitManifestStore,
} from '../../src/grove/unit-manifest-store.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import {
  type CitationRevisionActions,
  CitationRevisionTrigger,
  SOURCE_REVISION_REASON,
} from '../../src/ingestion/materiality/citation-revision-wiring.js';
import { bytesToBase64 } from '../../src/ingestion/vision-page-runner.js';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import { createVaultSuspendPort, isoWithLocalOffset } from '../../src/review/ports.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';
import { type EventedTestVault, eventedTestVault } from '../grove/unit-manifest-test-vault.js';

export const COURSE = 'SYN101';
export const DOC = `01 Courses/${COURSE}/Synthetic handout.pdf` as VaultPath;
export const NOW = new Date('2026-10-06T10:00:00Z');
export const DEVICE = 'olea-devicea0001';
const DAY = isoWithLocalOffset(NOW).slice(0, 10);

/** A minimal PDF, one page per entry; an empty entry is a page with no text layer, routed to vision. */
export function pdfBytes(pages: readonly string[]): Uint8Array {
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

/** The sentences of a passage: what the fake outcomes reply states for it. */
function sentencesOf(text: string): string[] {
  return text
    .split(/[.\n]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
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
  constructor(public blob: unknown = {}) {}
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function workerHost(): FakeDataHost {
  return new FakeDataHost({
    [WORKER_CONFIG_STORAGE_KEY]: {
      version: 1,
      baseUrl: 'https://worker.example',
      token: 't',
    } satisfies PersistedWorkerConfig,
  });
}

/** One delivery handed to `onUnitsLanded`. */
export interface Landing {
  readonly units: readonly ExtractedUnit[];
  readonly revisions?: ReadonlyMap<string, string>;
}

export interface Hold {
  /** Resolves once the held vision call has been made: the runner has read and rendered its bytes. */
  readonly entered: Promise<void>;
  release(): void;
}

export interface Composition {
  readonly vault: EventedTestVault;
  readonly manifests: UnitManifestStore;
  readonly engine: IngestionQueueEngine;
  readonly trigger: CitationRevisionTrigger;
  readonly citationStore: ObsidianCitationHashStore;
  readonly actions: CitationRevisionActions;
  /** Every delivery `onUnitsLanded` was handed, in order. */
  readonly landings: Landing[];
  /** Every successor the rewrite enqueued, in order. */
  readonly enqueued: EnqueueInput[];
  /** How many outcomes calls the Worker answered. */
  outcomesCalls: number;
  /** The image page's reading, by the digest of the PDF bytes it is read from. */
  readonly readings: Map<string, string>;
  /** Holds the next vision call open until released. */
  holdNextVision(): Hold;
  /** Enqueues a source job for the file as it is now. */
  enqueueSource(contentHash: string): Promise<void>;
  /** Runs eligible jobs until none is left (a held job stays in flight). */
  drain(): Promise<void>;
  /** Enqueues a source job and drains it, its image pages included. */
  deliver(contentHash: string): Promise<void>;
  /** One citation-revision pass, as main.ts runs it on its interval. */
  pass(): Promise<void>;
}

export interface ComposeOptions {
  /** Whether the file is registered as an objectives document (the outcomes trigger's eligibility). */
  readonly registered: boolean;
}

export async function compose(initial: Uint8Array, options: ComposeOptions): Promise<Composition> {
  const vault = eventedTestVault({ [DOC]: initial });
  // As main.ts builds it: one store per plugin instance, loaded before the queue drains.
  const manifests = createVaultUnitManifestStore({ vault, deviceId: DEVICE, now: () => NOW });
  await manifests.load();

  const citationStore = new ObsidianCitationHashStore(new FakeDataHost({}));
  const trigger = new CitationRevisionTrigger({
    store: citationStore,
    judge: { judge: vi.fn(async () => ({ material: true, reason: 'synthetic' })) },
    clock: { now: () => NOW.getTime() },
    requestSourceReextraction: vi.fn(async () => undefined),
  });
  const enqueued: EnqueueInput[] = [];
  const suspendPort = createVaultSuspendPort(vault, DEVICE, () => NOW);
  // As main.ts citationRevisionActions; main.ts admits the successor into the same ingestion
  // engine (its budget gate included). It is recorded here and drafted by the spec.
  const actions: CitationRevisionActions = {
    enqueue: async (input) => {
      enqueued.push(input);
      return undefined;
    },
    suspend: (instrumentId, conceptIds) => suspendPort.suspend(instrumentId, conceptIds),
  };

  const landings: Landing[] = [];
  const readings = new Map<string, string>();
  let held: { enter: () => void; released: Promise<void> } | undefined;

  const state = {
    outcomesCalls: 0,
  };
  const transport = {
    send: async (request: WorkerTaskRequest) => {
      if (request.taskId === 'vision.extract.v2') {
        const gate = held;
        held = undefined;
        if (gate !== undefined) {
          gate.enter();
          await gate.released;
        }
        // A rendered PDF page is sent as one image, not as a list.
        const payload = request.payload as {
          pageImageBase64?: string;
          images?: { pageImageBase64: string }[];
        };
        const digest = atob(payload.pageImageBase64 ?? payload.images?.[0]?.pageImageBase64 ?? '');
        return {
          ok: true,
          stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'm-vision' },
          result: {
            outcome: 'complete',
            extractedText: readings.get(digest) ?? '',
            figureDescription: null,
            coverage: null,
            unreadableReason: null,
          },
        };
      }
      state.outcomesCalls += 1;
      const chunks = (request.payload as { sourceChunks: string[] }).sourceChunks;
      return {
        ok: true,
        stamp: { promptVersion: '1.0.0', modelId: 'm-test' },
        result: {
          outcomes: chunks.flatMap((chunk, i) =>
            sentencesOf(chunk).map((label) => ({ label, confidence: 0.9, anchorIndex: i + 1 })),
          ),
          paperStructure: { sections: [] },
          numbering: { chunks: chunks.map((c, i) => ({ sentIndex: i + 1, length: c.length })) },
        },
      };
    },
  };

  const outcomesHost = workerHost();
  const visionHost = workerHost();
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new MemoryQueueStore(),
    capability: { canDrain: true },
    // As main.ts onUnitsLanded: the rewrite sees a delivery only when it carries a digest.
    onUnitsLanded: async (units, revisions) => {
      landings.push({ units, ...(revisions !== undefined ? { revisions } : {}) });
      if (revisions !== undefined && revisions.size > 0) {
        await trigger.onSourceUnitsLanded(vault, actions, units, revisions);
      }
    },
    outcomes: {
      dataHost: outcomesHost,
      createTransport: (_config: WorkerConfig) => transport,
      registeredDocumentFor: async (path: VaultPath) =>
        options.registered && path === DOC
          ? { documentKind: 'objectives' as const, courses: [COURSE] }
          : null,
      // main.ts `outcomes.revisions`, line for line.
      revisions: {
        currentRevision: (sourcePath) => manifests.outcomeRevisionPagesFor(sourcePath),
        markOutcomesExtracted: (sourcePath, revisionDigest, pages) =>
          manifests.recordOutcomeExtraction(sourcePath, revisionDigest, pages),
      },
    },
    // main.ts `vision`: readings land in the page record. Nothing here sets the digest switch.
    vision: {
      dataHost: visionHost,
      createTransport: (_config: WorkerConfig) => transport,
      onManifestEntry: (entry) => manifests.recordReading(entry),
    },
    pageRenderer: {
      renderPage: async (request) => ({
        dataUrl: `data:image/png;base64,${bytesToBase64(
          new TextEncoder().encode(await hashContent(request.pdfBytes)),
        )}`,
        mimeType: 'image/png',
        width: 300,
        height: 200,
      }),
    },
  });

  let sourceJobs = 0;
  const composition: Composition = {
    vault,
    manifests,
    engine,
    trigger,
    citationStore,
    actions,
    landings,
    enqueued,
    get outcomesCalls() {
      return state.outcomesCalls;
    },
    set outcomesCalls(value: number) {
      state.outcomesCalls = value;
    },
    readings,
    holdNextVision() {
      let enter: () => void = () => {};
      let release: () => void = () => {};
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      held = { enter, released };
      return { entered, release };
    },
    async enqueueSource(contentHash) {
      sourceJobs += 1;
      await engine.enqueue({
        contentHash,
        label: `A synthetic handout, read ${sourceJobs}`,
        payload: { kind: 'source', sourcePath: DOC, format: 'pdf' },
      });
    },
    async drain() {
      for (let i = 0; i < 20; i++) {
        const result = await engine.tick();
        if (result.kind !== 'ran') break;
      }
      await manifests.idle();
    },
    async deliver(contentHash) {
      await composition.enqueueSource(contentHash);
      await composition.drain();
    },
    async pass() {
      await trigger.tick(vault, actions);
    },
  };
  return composition;
}

/** The pages one delivery covered, in order. */
export function pagesOf(landing: Landing | undefined): number[] {
  return [...new Set((landing?.units ?? []).map((unit) => unit.provenance.location.page))].sort(
    (a, b) => a - b,
  );
}

/** The outcome records on the vault, by label. */
export async function outcomesByLabel(
  run: Composition,
): Promise<ReadonlyMap<string, OutcomeRecord>> {
  return new Map((await listOutcomeRecords(run.vault)).map(({ record }) => [record.label, record]));
}

/** Every "outcomes extracted" mark the page record holds, in write order. */
export function marks(run: Composition): { digest: string; page: number }[] {
  const content = run.vault.contentOf(unitManifestLogPath(DAY, DEVICE)) ?? '';
  return parseUnitManifestLog(content)
    .records.filter(
      (record): record is UnitStateRecord =>
        record.kind === 'unit' && record.outcomeExtractionState === 'complete',
    )
    .map((record) => ({ digest: record.revisionDigest, page: record.page }));
}

/** The ids the rewrite holds for a changed file. */
export async function heldIds(run: Composition): Promise<string[]> {
  const held: string[] = [];
  for (const [id, anchor] of await run.citationStore.loadAll()) {
    if (anchor.pendingRevalidation?.reason === SOURCE_REVISION_REASON) held.push(id);
  }
  return held.sort();
}

/** What each rewrite enqueued, by the question it replaces. */
export function rewrites(run: Composition): Map<string, { text: string; revision?: string }> {
  const out = new Map<string, { text: string; revision?: string }>();
  for (const input of run.enqueued) {
    const payload = (
      input as {
        payload: {
          predecessorInstrumentId: string;
          newPassageText: string;
          sourceRevision?: string;
        };
      }
    ).payload;
    out.set(payload.predecessorInstrumentId, {
      text: payload.newPassageText,
      ...(payload.sourceRevision !== undefined ? { revision: payload.sourceRevision } : {}),
    });
  }
  return out;
}
