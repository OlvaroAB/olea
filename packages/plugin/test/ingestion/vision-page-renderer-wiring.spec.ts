/**
 * `buildIngestionRunner`'s `deps.pageRenderer` threading (`[D-324]`,
 * resolving `ol-9cle`, this bead `ol-egov.141.89.8.4`) — a dedicated,
 * wiring-level spec, kept apart from `wiring.spec.ts` (owned by a different
 * live lane this round) rather than added to it.
 *
 * `ol-9cle` built `createObsidianPageRenderer`/`PdfJsPageRenderer`
 * (`../../src/ingestion/page-renderer.ts`, `./page-render/pdf-page-renderer.ts`)
 * and `vision-page-runner.spec.ts` already proves `createWorkerVisionPageRunner`
 * itself renders a `'pdf'` page correctly once handed a `pageRenderer`. The
 * gap this file closes is one level up: before this bead's fix,
 * `buildIngestionRunner` (`../../src/ingestion/wiring.ts`) had no
 * `pageRenderer` field on `IngestionWiringDeps` at all, and `buildVisionRunner`
 * never forwarded one to `createWorkerVisionPageRunner` — so a `'pdf'`
 * `'vision-page'` job reached the honest "no page renderer wired" gap
 * regardless of what a caller supplied. This file proves the THREADING, not
 * the render logic itself: a fake `PageRenderPort` handed to
 * `buildIngestionRunner` is the one `createWorkerVisionPageRunner` actually
 * calls when a `'pdf'` job drains.
 *
 * No `obsidian` import here, matching `wiring.ts`'s own module doc and
 * `wiring.spec.ts`'s comment: `PageRenderPort` is a plain structural
 * interface, and the real `createObsidianPageRenderer` adapter is composed
 * at the true production root (`main.ts`), not exercised by this file — see
 * this bead's report for that remaining one line, outside this bead's
 * `owns` this round.
 */
import type {
  ListOptions,
  PersistedQueue,
  QueueStore,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { PdfPageRenderRequest, RenderedPage } from '../../src/ingestion/page-render/types.js';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

/** Same in-memory `VaultSource` shape `wiring.spec.ts` uses — a fresh, minimal copy so this file needs nothing from that one. */
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

function visionOkResponse(result: unknown) {
  return { ok: true, stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'm' }, result };
}

/** A trivial, structurally-valid (if not byte-real) PDF — this file never reads it as a real document; the fake `PageRenderPort` below never parses it either. */
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);

async function failedReasonFor(
  queueStore: QueueStore,
  contentHash: string,
): Promise<string | undefined> {
  const queue = await queueStore.load();
  return queue?.jobs.find((job) => job.contentHash === contentHash)?.failedReason;
}

/** Records every `renderPage` call it receives, and answers with a fixed, fake rendered page — proof enough that this is the renderer `createWorkerVisionPageRunner` actually reached, without needing a real pdf.js/canvas. */
class RecordingPageRenderer {
  readonly calls: PdfPageRenderRequest[] = [];

  async renderPage(request: PdfPageRenderRequest): Promise<RenderedPage> {
    this.calls.push(request);
    return {
      dataUrl: 'data:image/png;base64,ZmFrZS1yZW5kZXJlZC1wYWdl',
      mimeType: 'image/png',
      width: 100,
      height: 100,
    };
  }
}

describe("buildIngestionRunner — deps.pageRenderer ([D-324], ol-9cle, this bead's wiring fix)", () => {
  it('omitted (the pre-fix default): a drained pdf vision-page job never reaches a renderer, and keeps the honest "no page renderer wired" gap', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/deck.pdf', FAKE_PDF_BYTES);
    const transport = fakeTransport(() =>
      visionOkResponse({
        outcome: 'complete',
        extractedText: 'should never be reached without a renderer',
        figureDescription: null,
        coverage: null,
        unreadableReason: null,
      }),
    );
    const queueStore = new MemoryQueueStore();
    const { engine } = await buildIngestionRunner({
      vault,
      queueStore,
      capability: CAN_DRAIN,
      vision: {
        dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
        createTransport: (_config: WorkerConfig) => transport,
      },
      // pageRenderer deliberately omitted — today's real main.ts call, and every
      // caller before this bead's fix.
    });

    await engine.enqueue({
      contentHash: 'pdf-no-renderer',
      label: 'a pdf lecture, no renderer wired',
      payload: { kind: 'vision-page', sourcePath: 'Lectures/deck.pdf', format: 'pdf', page: 1 },
    });
    const tick = await engine.tick();

    expect(tick).toEqual({ kind: 'ran', contentHash: 'pdf-no-renderer', outcome: 'failed' });
    expect(await failedReasonFor(queueStore, 'pdf-no-renderer')).toContain(
      'needs a rendered page image',
    );
    expect(transport.calls).toHaveLength(0);
  });

  it('supplied: a drained pdf vision-page job reaches the renderer, then the transport, and lands a unit — this is the threading this bead fixed', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/deck.pdf', FAKE_PDF_BYTES);
    const transport = fakeTransport(() =>
      visionOkResponse({
        outcome: 'complete',
        extractedText: 'Rendered page text',
        figureDescription: null,
        coverage: null,
        unreadableReason: null,
      }),
    );
    const pageRenderer = new RecordingPageRenderer();
    const queueStore = new MemoryQueueStore();
    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore,
      capability: CAN_DRAIN,
      vision: {
        dataHost: configuredHost({ version: 1, baseUrl: 'https://worker.example', token: 't' }),
        createTransport: (_config: WorkerConfig) => transport,
      },
      pageRenderer,
    });

    await engine.enqueue({
      contentHash: 'pdf-with-renderer',
      label: 'a pdf lecture, renderer wired',
      payload: { kind: 'vision-page', sourcePath: 'Lectures/deck.pdf', format: 'pdf', page: 3 },
    });
    const tick = await engine.tick();

    expect(tick).toEqual({ kind: 'ran', contentHash: 'pdf-with-renderer', outcome: 'done' });

    // The PDF branch actually received this renderer — the thing this
    // bead's fix threads through `IngestionWiringDeps.pageRenderer` ->
    // `buildVisionRunner` -> `createWorkerVisionPageRunner`.
    expect(pageRenderer.calls).toHaveLength(1);
    expect(pageRenderer.calls[0]).toMatchObject({ pageNumber: 3 });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('vision.extract.v2');

    const units = sink.forSource('Lectures/deck.pdf');
    expect(units).toHaveLength(1);
    expect(units[0]?.text).toBe('Rendered page text');
    expect(units[0]?.provenance.location.page).toBe(3);
  });
});
