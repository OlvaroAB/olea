/**
 * `ol-egov.141.89.5.84` ([D-518]): the citation-revision trigger's catch-up extraction request.
 * `requestSourceCatchUpExtraction` enqueues a source job exactly as the arrival watch does, under a
 * session-unique workflow version so a `done` job for the same bytes cannot swallow it, and skips
 * when a queued or in-flight job already holds those bytes. Synthetic bytes only.
 */
import {
  type DeviceCapability,
  hashContent,
  IngestionQueueEngine,
  type JobRunner,
  type ListOptions,
  type PersistedQueue,
  type QueueStore,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildIngestionArrivalWatch,
  requestSourceCatchUpExtraction,
} from '../../src/ingestion/arrival-watch.js';
import { EXTRACTION_WORKFLOW_VERSION } from '../../src/ingestion/extraction-workflow-version.js';

const PDF = 'Synthetic/sample source.pdf';
const bytes = new TextEncoder().encode('synthetic pdf bytes, catch-up');

class MemoryVault implements VaultSource {
  async list(_o: ListOptions = {}): Promise<readonly VaultPath[]> {
    return [PDF];
  }
  async read(path: VaultPath): Promise<string> {
    throw new Error(`no text (${path})`);
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    if (path !== PDF) throw new Error('not found');
    return bytes;
  }
  async write(): Promise<void> {}
  async exists(): Promise<boolean> {
    return true;
  }
  watch(_h: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class MemoryStore implements QueueStore {
  state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
  }
}

const desktop: DeviceCapability = { canDrain: true };
const ok: JobRunner = async () => ({ ok: true });

async function settle(engine: { list(): readonly unknown[] }): Promise<void> {
  for (let i = 0; i < 100 && engine.list().length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function engineWithDoneJob() {
  const engine = await IngestionQueueEngine.create({
    store: new MemoryStore(),
    capability: desktop,
    runner: ok,
    clock: { now: () => 1000 },
    random: { next: () => 0.5 },
  });
  const hold = buildIngestionArrivalWatch({
    vault: new MemoryVault(),
    enqueuer: engine,
    watch: (handler) => {
      handler({ kind: 'create', path: PDF });
      return () => {};
    },
  });
  hold();
  await settle(engine);
  await engine.tick();
  return engine;
}

describe('requestSourceCatchUpExtraction', () => {
  it('is not swallowed by a done job for the same bytes', async () => {
    const engine = await engineWithDoneJob();
    expect(engine.list().map((j) => j.status)).toEqual(['done']);
    await requestSourceCatchUpExtraction({
      vault: new MemoryVault(),
      engine,
      sourcePath: PDF,
      sessionStamp: 5000,
    });
    const jobs = engine.list();
    expect(jobs.map((j) => j.status)).toEqual(['done', 'queued']);
    expect(jobs[1]?.contentHash).toBe(await hashContent(bytes));
    expect(jobs[1]?.label).toBe(PDF);
    expect(jobs[1]?.payload).toMatchObject({ kind: 'source', sourcePath: PDF, format: 'pdf' });
    const version = (jobs[1] as { workflowVersion?: string }).workflowVersion;
    expect(version?.startsWith(EXTRACTION_WORKFLOW_VERSION)).toBe(true);
    expect(version).not.toBe(EXTRACTION_WORKFLOW_VERSION);
  });

  it('skips while a queued job for the same bytes exists, under any version', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: ok,
      clock: { now: () => 1000 },
      random: { next: () => 0.5 },
    });
    await engine.enqueue({
      contentHash: await hashContent(bytes),
      label: PDF,
      payload: { kind: 'source', sourcePath: PDF, format: 'pdf' },
      workflowVersion: 'some-older-version',
    });
    await requestSourceCatchUpExtraction({
      vault: new MemoryVault(),
      engine,
      sourcePath: PDF,
      sessionStamp: 5000,
    });
    expect(engine.list()).toHaveLength(1);
  });

  it('skips while an in-flight job for the same bytes exists', async () => {
    const hash = await hashContent(bytes);
    const enqueued: unknown[] = [];
    const engine = {
      list: () => [{ contentHash: hash, status: 'in-flight' }] as never,
      enqueue: async (input: unknown) => {
        enqueued.push(input);
        return { status: 'queued' as const };
      },
    };
    await requestSourceCatchUpExtraction({
      vault: new MemoryVault(),
      engine,
      sourcePath: PDF,
      sessionStamp: 5000,
    });
    expect(enqueued).toEqual([]);
  });

  it('the default arrival enqueue still dedups on a done job', async () => {
    const engine = await engineWithDoneJob();
    const unsubscribe = buildIngestionArrivalWatch({
      vault: new MemoryVault(),
      enqueuer: engine,
      watch: (handler) => {
        handler({ kind: 'modify', path: PDF });
        return () => {};
      },
    });
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.list().map((j) => j.status)).toEqual(['done']);
  });
});
