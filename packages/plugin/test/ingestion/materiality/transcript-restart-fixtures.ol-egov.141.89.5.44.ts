/**
 * Fixtures for `ol-egov.141.89.5.44`'s restart tests (PERSISTENCE.md section 3). A RESTART is a new
 * session over the same saved state: data.json is carried over as JSON text, so nothing held in
 * memory survives it; the vault's files stay where they are; and every store, trigger, engine, feed
 * and watch is built again. Builds on `ol-egov.141.89.5.43`'s shared fixtures, which it imports and
 * never changes. Every transcript, course, lecture and sentence here is INVENTED ("course A"); nothing
 * comes from a real vault. Not a spec file.
 */
import {
  appendSuspendRecord,
  type EnqueueInput,
  type EnqueueResult,
  type JobEnqueuer,
  type RevisionJudgePort,
  type RevisionJudgeVerdict,
  type VaultEvent,
  type VaultPath,
} from 'olea-core';
import { expect, vi } from 'vitest';
import { createVaultUnitManifestStore } from '../../../src/grove/unit-manifest-store.js';
import { buildIngestionArrivalWatch } from '../../../src/ingestion/arrival-watch.js';
import {
  type CitationAnchorRecord,
  ObsidianCitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import { createProcessedRevisionFeed } from '../../../src/ingestion/processed-revisions/feed.js';
import {
  ObsidianProcessedRevisionStore,
  type PersistedProcessedRevisions,
} from '../../../src/ingestion/processed-revisions/store.js';
import { ObsidianQueueStore } from '../../../src/ingestion/queue-store.js';
import { buildIngestionRunner } from '../../../src/ingestion/wiring.js';
import { resolveCitationPendingRevalidation } from '../../../src/session-builder/provider.js';
import { FakeDataHost, type MemoryVault } from './transcript-fixtures.ol-egov.141.89.5.43.js';

/** data.json as the next session finds it: what was written, read back from JSON, nothing else. */
export function restartedHost(host: FakeDataHost): FakeDataHost {
  const next = new FakeDataHost();
  next.blob = JSON.parse(JSON.stringify(host.blob)) as Record<string, unknown>;
  return next;
}

/** One data.json key as JSON text, for a byte-level before and after. */
export function keyText(host: FakeDataHost, key: string): string {
  return JSON.stringify(host.blob[key] ?? null);
}

/** Every file under `.olea/unit-manifests/`, for "the reading record writes nothing". */
export function manifestLogText(vault: MemoryVault): string {
  return JSON.stringify(
    [...vault.files].filter(([path]) => path.startsWith('.olea/unit-manifests/')).sort(),
  );
}

/** Every citation sidecar, for "sidecars are unchanged". */
export function sidecarText(vault: MemoryVault): string {
  return JSON.stringify(
    [...vault.files].filter(([path]) => path.startsWith('.olea/citations/')).sort(),
  );
}

/** A citation store whose writes stop after `writes` of them: the plugin stopping part-way. */
export class StoppingCitationStore extends ObsidianCitationHashStore {
  private writesLeft: number;
  constructor(host: FakeDataHost, writes: number) {
    super(host);
    this.writesLeft = writes;
  }
  override async save(instrumentId: string, record: CitationAnchorRecord): Promise<void> {
    if (this.writesLeft <= 0) throw new Error('the plugin stopped');
    this.writesLeft -= 1;
    await super.save(instrumentId, record);
  }
}

export interface CitationSession {
  readonly host: FakeDataHost;
  readonly store: ObsidianCitationHashStore;
  readonly trigger: CitationRevisionTrigger;
  readonly judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> };
  readonly actions: {
    enqueue: ReturnType<typeof vi.fn>;
    suspend: ReturnType<typeof vi.fn>;
    onRelocationProposed: ReturnType<typeof vi.fn>;
  };
  /** The instruments composition withholds now (the production resolver over this store). */
  withheld(ids: readonly string[]): Promise<ReadonlySet<string>>;
  anchors(): Promise<ReadonlyMap<string, CitationAnchorRecord>>;
  pass(vault: MemoryVault): ReturnType<CitationRevisionTrigger['tick']>;
}

/**
 * The citation pass of one session, with transcript part grain on, over `host`'s data.json. The
 * same composition as `ol-egov.141.89.5.43`'s harness, but over a host the caller keeps, so the
 * next session can be started over what this one saved.
 */
export function citationSession(
  host: FakeDataHost,
  options: {
    readonly verdict?: RevisionJudgeVerdict;
    readonly now?: number;
    readonly store?: ObsidianCitationHashStore;
  } = {},
): CitationSession {
  const store = options.store ?? new ObsidianCitationHashStore(host);
  const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
    judge: vi.fn(async () => options.verdict ?? { material: true, reason: 'scripted' }),
  };
  const now = options.now ?? 1_000;
  const trigger = new CitationRevisionTrigger({
    store,
    judge,
    clock: { now: () => now },
    transcriptPartGrain: true,
  });
  let passVault: MemoryVault | undefined;
  const actions = {
    enqueue: vi.fn(async (_input: EnqueueInput) => undefined),
    suspend: vi.fn(async (instrumentId: string, conceptIds: readonly string[]) => {
      if (passVault === undefined) return;
      await appendSuspendRecord(
        passVault,
        {
          kind: 'suspend',
          timestamp: '2026-10-01T09:00:00Z',
          instrumentId,
          conceptIds: conceptIds.length > 0 ? [...conceptIds] : ['invented-concept'],
        },
        { deviceId: 'device-synthetic' },
      );
    }),
    onRelocationProposed: vi.fn(),
  };
  return {
    host,
    store,
    trigger,
    judge,
    actions,
    withheld: (ids) => resolveCitationPendingRevalidation(store, ids),
    anchors: () => store.loadAll(),
    pass: (vault) => {
      passVault = vault;
      return trigger.tick(vault, actions);
    },
  };
}

export const DEVICE = 'olea-devicea0001';

/**
 * The ingestion side of one session, as `main.ts` composes it: the production runner chain over
 * the persisted queue, the processed-revision feed observing its enqueues and ticks (started, so
 * its rebuild has run), the durable unit manifest (loaded), and the arrival watch. `arrive` fires
 * the vault events a session sees (Obsidian reports every existing file as `create` while the vault
 * loads) and waits for the watch's enqueues to settle.
 */
export async function ingestionSession(
  host: FakeDataHost,
  vault: MemoryVault,
  now: Date,
): Promise<{
  readonly manifests: ReturnType<typeof createVaultUnitManifestStore>;
  readonly revisions: ObsidianProcessedRevisionStore;
  readonly engine: Awaited<ReturnType<typeof buildIngestionRunner>>['engine'];
  readonly enqueues: EnqueueResult[];
  arrive(paths: readonly VaultPath[], expectedEnqueues: number): Promise<void>;
  drain(): Promise<void>;
  revisionsNow(): Promise<PersistedProcessedRevisions>;
}> {
  const manifests = createVaultUnitManifestStore({ vault, deviceId: DEVICE, now: () => now });
  await manifests.load();
  const revisions = new ObsidianProcessedRevisionStore(host, () => now);
  const feed = createProcessedRevisionFeed({
    store: revisions,
    vault,
    manifestsFor: (paths) => manifests.manifestsFor(paths),
  });
  await feed.start();
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new ObsidianQueueStore(host),
    capability: { canDrain: true },
  });
  const observed = feed.observeEnqueues(engine);
  const enqueues: EnqueueResult[] = [];
  const settling: Promise<EnqueueResult>[] = [];
  const enqueuer: JobEnqueuer = {
    enqueue(input) {
      const result = observed.enqueue(input);
      settling.push(result);
      return result;
    },
  };
  let fire: (event: VaultEvent) => void = () => undefined;
  buildIngestionArrivalWatch({
    vault,
    enqueuer,
    watch: (handler) => {
      fire = handler;
      return () => undefined;
    },
  });
  return {
    manifests,
    revisions,
    engine,
    enqueues,
    async arrive(paths, expectedEnqueues) {
      const before = settling.length;
      for (const path of paths) fire({ kind: 'create', path } as VaultEvent);
      await vi.waitFor(() =>
        expect(settling.length - before).toBeGreaterThanOrEqual(expectedEnqueues),
      );
      // Let any further reads and hashes of the watch settle, then every enqueue it made.
      await new Promise((resolve) => setTimeout(resolve, 20));
      enqueues.push(...(await Promise.all(settling.slice(before))));
      await feed.idle();
    },
    async drain() {
      for (;;) {
        const tick = await engine.tick();
        if (tick.kind !== 'ran') break;
        await feed.jobRan(tick, engine.list());
      }
      await feed.idle();
    },
    revisionsNow: () => revisions.load(),
  };
}
