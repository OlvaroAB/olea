/**
 * `buildIngestionArrivalWatch` tests (`ol-2zfj.38`) — see
 * `features/F3-learn-from-anything.md`'s "F3.1 / TRG-1 — vault-watch
 * enqueues an arriving KNOWN_FORMATS file" scenarios (private repo,
 * `olea-service`, cited by path per INV-3), which this file's `describe`/
 * `it` names are written to satisfy directly.
 *
 * Runs entirely against fakes — no `obsidian` import anywhere in this file,
 * matching `ingestion/wiring.spec.ts`'s own posture one file over.
 */
import type {
  EnqueueInput,
  EnqueueResult,
  JobRunner,
  ListOptions,
  PersistedQueue,
  QueueStore,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { DEFAULT_ENQUEUE_DEBOUNCE_POLICY, IngestionQueueEngine } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildIngestionArrivalWatch,
  createInMemoryLastChangedTracker,
} from '../../src/ingestion/arrival-watch.js';

/** In-memory `VaultSource` — same role `wiring.spec.ts`'s own `MemoryVaultSource` fills, extended with `write`/`watch` no-ops this file never exercises directly (the watch channel here is always the injected fake, never `vault.watch`). */
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

/** Records every `enqueue` call verbatim — the seam these tests assert against, since `buildIngestionArrivalWatch` needs nothing else from an enqueuer. */
class RecordingEnqueuer {
  readonly calls: EnqueueInput[] = [];

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    this.calls.push(input);
    return { status: 'queued' };
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

/** Mutable fake clock — shared by reference between the engine and the arrival watch in the debounce test below, so both read the same "now". */
class FakeClock {
  now_ = 0;
  now = (): number => this.now_;
}

const NEVER_RUNS: JobRunner = async () => {
  throw new Error('this test never ticks the engine — the runner should never be called');
};

const ALWAYS_SUCCEEDS: JobRunner = async () => ({ ok: true });

/**
 * `enqueueArrival` is fire-and-forget from the watch handler's own
 * perspective (`void enqueueArrival(...)`), and its own `await hashContent`
 * goes through Node's WebCrypto binding — a real async operation whose
 * settling can take more than one event-loop turn. Several macrotask
 * turns is what reliably drains it in a test, one plain `setTimeout(0)`
 * sometimes is not.
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A tiny, deterministic "watch" fake: `fire` synchronously invokes whatever handler `buildIngestionArrivalWatch` registered. */
function fakeWatchChannel(): {
  watch: (handler: (event: VaultEvent) => void) => Unsubscribe;
  fire: (event: VaultEvent) => void;
} {
  let handler: ((event: VaultEvent) => void) | null = null;
  return {
    watch: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    fire: (event) => {
      handler?.(event);
    },
  };
}

describe('buildIngestionArrivalWatch — which events enqueue', () => {
  it('enqueues a newly created KNOWN_FORMATS file, first sighting (lastChangedAt: null)', async () => {
    const vault = new MemoryVaultSource();
    const bytes = new Uint8Array([1, 2, 3]);
    vault.setBinary('Lectures/week2.pdf', bytes);
    const enqueuer = new RecordingEnqueuer();
    const channel = fakeWatchChannel();

    buildIngestionArrivalWatch({ vault, enqueuer, watch: channel.watch });
    channel.fire({ kind: 'create', path: 'Lectures/week2.pdf' });
    // enqueue is fire-and-forget from the watch handler's own perspective —
    // let the microtask queue drain.
    await flushAsync();

    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]).toMatchObject({
      label: 'Lectures/week2.pdf',
      payload: { kind: 'source', sourcePath: 'Lectures/week2.pdf', format: 'pdf' },
      lastChangedAt: null,
      sourceUnitId: 'Lectures/week2.pdf',
    });
    expect(typeof enqueuer.calls[0]?.contentHash).toBe('string');
    expect(enqueuer.calls[0]?.contentHash.length).toBeGreaterThan(0);
  });

  it('enqueues a modified pptx/docx/image file the same way as a created pdf', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/deck.pptx', new Uint8Array([9]));
    const enqueuer = new RecordingEnqueuer();
    const channel = fakeWatchChannel();

    buildIngestionArrivalWatch({ vault, enqueuer, watch: channel.watch });
    channel.fire({ kind: 'modify', path: 'Slides/deck.pptx' });
    await flushAsync();

    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]?.payload).toEqual({
      kind: 'source',
      sourcePath: 'Slides/deck.pptx',
      format: 'pptx',
    });
  });

  it('never enqueues a markdown note, an unsupported extension, or a delete/rename event', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Notes/zettel.md', new Uint8Array([1]));
    vault.setBinary('Audio/lecture.mp3', new Uint8Array([1]));
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1]));
    const enqueuer = new RecordingEnqueuer();
    const channel = fakeWatchChannel();

    buildIngestionArrivalWatch({ vault, enqueuer, watch: channel.watch });
    channel.fire({ kind: 'create', path: 'Notes/zettel.md' });
    channel.fire({ kind: 'modify', path: 'Notes/zettel.md' });
    channel.fire({ kind: 'create', path: 'Audio/lecture.mp3' });
    channel.fire({ kind: 'delete', path: 'Lectures/week2.pdf' });
    channel.fire({
      kind: 'rename',
      path: 'Lectures/week2-renamed.pdf',
      oldPath: 'Lectures/week2.pdf',
    });
    await flushAsync();

    expect(enqueuer.calls).toHaveLength(0);
  });

  it('returns a working unsubscribe handle', () => {
    const vault = new MemoryVaultSource();
    const enqueuer = new RecordingEnqueuer();
    const channel = fakeWatchChannel();

    const unsubscribe = buildIngestionArrivalWatch({ vault, enqueuer, watch: channel.watch });
    unsubscribe();
    channel.fire({ kind: 'create', path: 'Lectures/week2.pdf' });

    expect(enqueuer.calls).toHaveLength(0);
  });

  it('never throws into the caller when the vault read fails (a race between the event and the file landing)', async () => {
    const vault = new MemoryVaultSource(); // never seeded — readBinary always throws
    const enqueuer = new RecordingEnqueuer();
    const channel = fakeWatchChannel();

    buildIngestionArrivalWatch({ vault, enqueuer, watch: channel.watch });
    expect(() => channel.fire({ kind: 'create', path: 'Lectures/ghost.pdf' })).not.toThrow();
    await flushAsync();

    expect(enqueuer.calls).toHaveLength(0);
  });
});

describe('createInMemoryLastChangedTracker', () => {
  it('is null for a path never recorded, and returns the last-recorded instant otherwise', () => {
    const tracker = createInMemoryLastChangedTracker();
    expect(tracker.get('a.pdf')).toBeNull();
    tracker.record('a.pdf', 1000);
    expect(tracker.get('a.pdf')).toBe(1000);
    tracker.record('a.pdf', 2000);
    expect(tracker.get('a.pdf')).toBe(2000);
    expect(tracker.get('b.pdf')).toBeNull();
  });
});

describe('buildIngestionArrivalWatch — end to end with the real IngestionQueueEngine, ENQUEUE debounce threaded through (ol-84my)', () => {
  it('a burst of changing saves on one path settles into a single eventual enqueue, never one per event', async () => {
    const vault = new MemoryVaultSource();
    const path = 'Lectures/big-deck.pptx';
    const clock = new FakeClock();
    const engine = await IngestionQueueEngine.create({
      store: new MemoryQueueStore(),
      capability: { canDrain: true },
      runner: NEVER_RUNS,
      clock,
      enqueueDebounce: DEFAULT_ENQUEUE_DEBOUNCE_POLICY,
    });
    const channel = fakeWatchChannel();

    buildIngestionArrivalWatch({ vault, enqueuer: engine, clock, watch: channel.watch });

    // t=0: the file first appears — a first sighting always settles.
    vault.setBinary(path, new Uint8Array([1]));
    channel.fire({ kind: 'create', path });
    await flushAsync();
    expect(engine.snapshot().queued).toBe(1);

    // t=60s: still mid-copy — different bytes, well inside the 3-minute
    // debounce window since the path was last observed. Debounced: no
    // second job appears.
    clock.now_ = 60_000;
    vault.setBinary(path, new Uint8Array([1, 2]));
    channel.fire({ kind: 'modify', path });
    await flushAsync();
    expect(engine.snapshot().queued).toBe(1);

    // t=60s + 190s = 250s: the same (now-finished) content is observed
    // again, 190s after the path last changed — clear of the 180s window.
    // This settles and enqueues the finished version as its own job.
    //
    // Since ol-egov.141.89.10.49, `sourceUnitId: path` is threaded through
    // every enqueue (`enqueueArrival`) — so this second, genuinely-different
    // job for the SAME path now retires the first one (still `queued`,
    // never having been ticked) as a stale, superseded revision, rather
    // than leaving both queued side by side for a job runner to eventually
    // waste a paid call on the half-copied bytes.
    clock.now_ = 250_000;
    channel.fire({ kind: 'modify', path });
    await flushAsync();
    expect(engine.snapshot()).toMatchObject({ queued: 1, failed: 1 });
    const jobs = engine.list();
    expect(jobs.find((j) => j.status === 'failed')?.failedReason).toContain('superseded');
    expect(jobs.find((j) => j.status === 'queued')?.label).toBe(path);
  });
});

describe('buildIngestionArrivalWatch — supersede on a newer revision, through a real IngestionQueueEngine (ol-egov.141.89.10.49)', () => {
  it('retires a still-queued job for the same path once a newer revision of it arrives', async () => {
    const vault = new MemoryVaultSource();
    const path = 'Lectures/week2.pdf';
    const engine = await IngestionQueueEngine.create({
      store: new MemoryQueueStore(),
      capability: { canDrain: true },
      runner: NEVER_RUNS,
    });
    const channel = fakeWatchChannel();
    buildIngestionArrivalWatch({ vault, enqueuer: engine, watch: channel.watch });

    // Revision 1 arrives and sits queued (nothing ticks this engine).
    vault.setBinary(path, new Uint8Array([1]));
    channel.fire({ kind: 'create', path });
    await flushAsync();
    expect(engine.snapshot().queued).toBe(1);
    const firstHash = engine.list()[0]?.contentHash;

    // She edits the file — revision 2, different bytes, same path.
    vault.setBinary(path, new Uint8Array([1, 2, 3]));
    channel.fire({ kind: 'modify', path });
    await flushAsync();

    const jobs = engine.list();
    const stale = jobs.find((j) => j.contentHash === firstHash);
    const fresh = jobs.find((j) => j.contentHash !== firstHash);
    // Never a silent drop — the record survives, honestly labelled.
    expect(stale?.status).toBe('failed');
    expect(stale?.failedReason).toContain('superseded');
    expect(fresh?.status).toBe('queued');
    expect(engine.snapshot().queued).toBe(1);
  });

  it('leaves a done job for the same path alone when a further revision arrives', async () => {
    const vault = new MemoryVaultSource();
    const path = 'Lectures/week2.pdf';
    const engine = await IngestionQueueEngine.create({
      store: new MemoryQueueStore(),
      capability: { canDrain: true },
      runner: ALWAYS_SUCCEEDS,
    });
    const channel = fakeWatchChannel();
    buildIngestionArrivalWatch({ vault, enqueuer: engine, watch: channel.watch });

    vault.setBinary(path, new Uint8Array([1]));
    channel.fire({ kind: 'create', path });
    await flushAsync();
    const firstHash = engine.list()[0]?.contentHash;
    expect(await engine.tick()).toEqual({ kind: 'ran', contentHash: firstHash, outcome: 'done' });
    expect(engine.list().find((j) => j.contentHash === firstHash)?.status).toBe('done');

    vault.setBinary(path, new Uint8Array([1, 2, 3]));
    channel.fire({ kind: 'modify', path });
    await flushAsync();

    expect(engine.list().find((j) => j.contentHash === firstHash)?.status).toBe('done');
    expect(engine.snapshot().done).toBe(1);
    expect(engine.snapshot().queued).toBe(1);
  });
});
