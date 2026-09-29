// Scenarios: `features/F6-today.md`, "F6.9 — The data plumbing the reading is built on" —
// @auto:plugin/ingestion/processed-revisions/feed.spec. Every string here is invented (INV-3).
//
// `ol-egov.141.89.11.27`, `[D-426]`: what fills the processed-revision record. A note is recorded
// when it clears the free checks, whatever the judge says; an embedded source is recorded pending
// when its job is queued and read or unreadable when it settles; and nothing counts before the
// start's rebuild has run, so a vault that is opening (every existing file reported as created) is
// never read as a vault that just received everything.

import {
  hashContent,
  hashText,
  type JobEnqueuer,
  type PersistedJob,
  stableUnitId,
  type TickResult,
  type UnitManifest,
  type UnitReadingState,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProcessedRevisionFeed } from '../../../src/ingestion/processed-revisions/feed.js';
import {
  ObsidianProcessedRevisionStore,
  type PersistedProcessedRevisions,
  PROCESSED_REVISION_STORAGE_KEY,
} from '../../../src/ingestion/processed-revisions/store.js';
import { memoryVault } from '../../review/memory-vault.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

function clockOn(iso: string) {
  let current = new Date(`${iso}T12:00:00`);
  return {
    now: () => current,
    at: (day: string) => {
      current = new Date(`${day}T12:00:00`);
    },
  };
}

function manifestOf(
  sourcePath: VaultPath,
  revisionDigest: string,
  states: readonly UnitReadingState[],
): UnitManifest {
  return {
    sourcePath,
    revisionDigest,
    entries: states.map((readingState, index) => ({
      unitId: stableUnitId(sourcePath, index + 1),
      sourcePath,
      page: index + 1,
      readingState,
      conceptExtractionState: 'not-started',
    })),
  };
}

const READ: UnitReadingState = { kind: 'read', method: 'text-layer' };
const PENDING: UnitReadingState = { kind: 'pending', reason: 'queued' };
const BLANK: UnitReadingState = { kind: 'unreadable', reason: 'blank-page' };

const NOTE = '01 Courses/CRS-A/week 1.md';
const OTHER_NOTE = '01 Courses/CRS-A/week 2.md';
const DECK = '01 Courses/CRS-A/deck.pdf';
const SCAN = '01 Courses/CRS-B/scan.png';

/** A feed over the real store, with the source reading held in `manifests` and the vault in `files`. */
function harness(
  options: {
    readonly files?: Record<string, string>;
    readonly manifests?: Map<VaultPath, UnitManifest>;
    readonly today?: string;
    readonly vault?: VaultSource;
  } = {},
) {
  const host = new FakeDataHost();
  const clock = clockOn(options.today ?? '2026-08-01');
  const store = new ObsidianProcessedRevisionStore(host, clock.now);
  const manifests = options.manifests ?? new Map<VaultPath, UnitManifest>();
  const vault = options.vault ?? memoryVault(options.files ?? {});
  const feed = createProcessedRevisionFeed({
    store,
    vault,
    // The source reading's reader boundary: a path it cannot enumerate is left out of the answer.
    manifestsFor: async (paths) => {
      const answer = new Map<VaultPath, UnitManifest>();
      for (const path of paths) {
        const manifest = manifests.get(path);
        if (manifest !== undefined) answer.set(path, manifest);
      }
      return answer;
    },
  });
  const record = async (): Promise<PersistedProcessedRevisions> => store.load();
  return { host, clock, store, feed, manifests, record };
}

function job(contentHash: string, payload: unknown): PersistedJob {
  return {
    contentHash,
    label: 'label',
    payload,
    enqueuedAt: 0,
    status: 'done',
    attempts: 1,
  };
}

const ran = (contentHash: string, outcome: 'done' | 'deferred' | 'failed'): TickResult => ({
  kind: 'ran',
  contentHash,
  outcome,
});

const TEXT = 'Some invented lecture text about a concept.';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a note is recorded as processed when it clears the free checks, whatever the judge says', () => {
  it.each([
    ['a verdict that says the edit is material', { kind: 'verdict' }],
    ['a verdict that says the edit is not material', { kind: 'verdict' }],
    ['no judge to ask, an outage included', { kind: 'judge-unavailable' }],
    ['a judge call about to be made', { kind: 'call-judge' }],
  ] as const)('%s', async (_name, result) => {
    const { feed, clock, record } = harness();
    await feed.start();
    clock.at('2026-08-05');
    await feed.noteEvaluated(NOTE, TEXT, result);
    expect((await record()).revisions[NOTE]).toEqual({
      fingerprint: await hashText(TEXT),
      courses: ['CRS-A'],
      state: 'read',
      firstProcessedDay: '2026-08-05',
    });
  });

  it.each([
    'unchanged',
    'formatting-only',
    'debounced',
    'below-floor',
    'no-groundable-content',
    'stale-response-dropped',
  ] as const)('a %s result records nothing at all', async (kind) => {
    const { feed, record } = harness();
    await feed.start();
    await feed.noteEvaluated(NOTE, TEXT, { kind });
    expect((await record()).revisions).toEqual({});
  });

  it('a drained pending edit is a real verdict on a real version, so it records', async () => {
    const { feed, clock, record } = harness();
    await feed.start();
    clock.at('2026-08-07');
    await feed.noteProcessed(NOTE, TEXT);
    expect((await record()).revisions[NOTE]?.firstProcessedDay).toBe('2026-08-07');
  });

  it('the same version again keeps its first day; an edited version gets its own', async () => {
    const { feed, clock, record } = harness();
    await feed.start();
    clock.at('2026-08-05');
    await feed.noteEvaluated(NOTE, TEXT, { kind: 'judge-unavailable' });
    clock.at('2026-08-09');
    await feed.noteEvaluated(NOTE, TEXT, { kind: 'verdict' });
    expect((await record()).revisions[NOTE]?.firstProcessedDay).toBe('2026-08-05');
    await feed.noteEvaluated(NOTE, `${TEXT} And an edit.`, { kind: 'verdict' });
    expect((await record()).revisions[NOTE]).toMatchObject({
      fingerprint: await hashText(`${TEXT} And an edit.`),
      firstProcessedDay: '2026-08-09',
    });
  });

  it('course association follows F1.3: her own course list outranks the folder, and no course records nothing', async () => {
    const { feed, record } = harness();
    await feed.start();
    await feed.noteEvaluated(
      '05 Zettelkasten/idea.md',
      '---\ncourse:\n  - CRS-B\n  - CRS-A\n---\nBody text.',
      { kind: 'verdict' },
    );
    await feed.noteEvaluated('05 Zettelkasten/loose.md', 'No course at all.', {
      kind: 'verdict',
    });
    const { revisions } = await record();
    expect(revisions['05 Zettelkasten/idea.md']?.courses).toEqual(['CRS-A', 'CRS-B']);
    expect(revisions['05 Zettelkasten/loose.md']).toBeUndefined();
  });

  it('records nothing for an empty note, one of Olea’s own home notes, a hidden folder or a file that is not a note', async () => {
    const { feed, record } = harness();
    await feed.start();
    const passes = { kind: 'verdict' } as const;
    await feed.noteEvaluated('01 Courses/CRS-A/empty.md', '  \n', passes);
    await feed.noteEvaluated(
      '01 Courses/CRS-A/home.md',
      '---\nolea-home-note: true\n---\nOlea’s own note.',
      passes,
    );
    await feed.noteEvaluated('.olea/reviews/2026-09-01.md', TEXT, passes);
    await feed.noteEvaluated('.obsidian/plugins/notes.md', TEXT, passes);
    await feed.noteEvaluated(DECK, 'binary garbage read as text', passes);
    expect((await record()).revisions).toEqual({});
  });
});

describe('an embedded source is pending when it is queued and read or unreadable when its job settles', () => {
  function enqueuerReturning(result: Awaited<ReturnType<JobEnqueuer['enqueue']>>): JobEnqueuer & {
    calls: number;
  } {
    const enqueuer = {
      calls: 0,
      async enqueue() {
        enqueuer.calls += 1;
        return result;
      },
    };
    return enqueuer;
  }

  const sourceInput = (path: VaultPath, contentHash: string) => ({
    contentHash,
    label: path,
    payload: { kind: 'source', sourcePath: path, format: 'pdf' },
  });

  it('a queued source is recorded pending, keyed by the hash the job is keyed by, and the result passes through untouched', async () => {
    const { feed, clock, record } = harness();
    await feed.start();
    clock.at('2026-08-05');
    const inner = enqueuerReturning({ status: 'queued' });
    const result = await feed.observeEnqueues(inner).enqueue(sourceInput(DECK, 'hash-deck'));
    expect(result).toEqual({ status: 'queued' });
    expect(inner.calls).toBe(1);
    await feed.idle();
    expect((await record()).revisions[DECK]).toEqual({
      fingerprint: 'hash-deck',
      courses: ['CRS-A'],
      state: 'pending',
      firstProcessedDay: '2026-08-05',
    });
  });

  it.each([
    ['a duplicate', { status: 'duplicate', existingStatus: 'done' }],
    ['a debounced attempt', { status: 'debounced', resumeNotBefore: 5 }],
  ] as const)('%s admits nothing, so records nothing', async (_name, result) => {
    const { feed, record } = harness();
    await feed.start();
    await feed.observeEnqueues(enqueuerReturning(result)).enqueue(sourceInput(DECK, 'hash-deck'));
    await feed.idle();
    expect((await record()).revisions).toEqual({});
  });

  it('a job that is not a source, and a source outside the courses folder or in a hidden folder, record nothing', async () => {
    const { feed, record } = harness();
    await feed.start();
    const observed = feed.observeEnqueues(enqueuerReturning({ status: 'queued' }));
    await observed.enqueue({
      contentHash: 'h1',
      label: 'x',
      payload: { kind: 'instrument-revision' },
    });
    await observed.enqueue(sourceInput('05 Zettelkasten/deck.pdf', 'h2'));
    await observed.enqueue(sourceInput('.olea/hidden/deck.pdf', 'h3'));
    await feed.idle();
    expect((await record()).revisions).toEqual({});
  });

  it('a settled read source becomes read, and its first day is the day it was queued', async () => {
    const { feed, clock, manifests, record } = harness();
    await feed.start();
    clock.at('2026-08-05');
    await feed
      .observeEnqueues(enqueuerReturning({ status: 'queued' }))
      .enqueue(sourceInput(DECK, 'hash-deck'));
    await feed.idle();
    clock.at('2026-08-08');
    manifests.set(DECK, manifestOf(DECK, 'hash-deck', [READ, READ]));
    await feed.jobRan(ran('hash-deck', 'done'), [
      job('hash-deck', { kind: 'source', sourcePath: DECK, format: 'pdf' }),
    ]);
    expect((await record()).revisions[DECK]).toMatchObject({
      fingerprint: 'hash-deck',
      state: 'read',
      firstProcessedDay: '2026-08-05',
    });
  });

  it('an empty or image-only source is counted unreadable when it settles, never read', async () => {
    const { feed, manifests, record } = harness();
    await feed.start();
    manifests.set(SCAN, manifestOf(SCAN, 'hash-scan', [BLANK, BLANK]));
    await feed.jobRan(ran('hash-scan', 'done'), [
      job('hash-scan', { kind: 'source', sourcePath: SCAN, format: 'image' }),
    ]);
    expect((await record()).revisions[SCAN]?.state).toBe('unreadable');
  });

  it('a source the reading cannot enumerate at all is unreadable by the hash the job is keyed by', async () => {
    const { feed, record } = harness();
    await feed.start();
    await feed.jobRan(ran('hash-deck', 'failed'), [
      job('hash-deck', { kind: 'source', sourcePath: DECK, format: 'pdf' }),
    ]);
    expect((await record()).revisions[DECK]).toMatchObject({
      fingerprint: 'hash-deck',
      state: 'unreadable',
    });
  });

  it('pages still waiting for vision leave the source pending; a finished state is never turned back into pending', async () => {
    const { feed, manifests, record } = harness();
    await feed.start();
    manifests.set(SCAN, manifestOf(SCAN, 'hash-scan', [PENDING]));
    await feed.jobRan(ran('hash-scan', 'done'), [
      job('hash-scan', { kind: 'source', sourcePath: SCAN, format: 'image' }),
    ]);
    expect((await record()).revisions[SCAN]?.state).toBe('pending');
    manifests.set(SCAN, manifestOf(SCAN, 'hash-scan', [READ]));
    await feed.jobRan(ran('hash-scan', 'done'), [
      job('hash-scan', { kind: 'source', sourcePath: SCAN, format: 'image' }),
    ]);
    expect((await record()).revisions[SCAN]?.state).toBe('read');
    manifests.set(SCAN, manifestOf(SCAN, 'hash-scan', [PENDING]));
    await feed.jobRan(ran('hash-scan', 'done'), [
      job('hash-scan', { kind: 'source', sourcePath: SCAN, format: 'image' }),
    ]);
    expect((await record()).revisions[SCAN]?.state).toBe('read');
  });

  it('a page reading settling advances the version the record holds, and never starts one', async () => {
    const { feed, manifests, record } = harness();
    await feed.start();
    const page = job('hash-page-1', { kind: 'vision-page', sourcePath: SCAN, page: 1 });
    manifests.set(SCAN, manifestOf(SCAN, 'hash-scan', [READ]));
    await feed.jobRan(ran('hash-page-1', 'done'), [page]);
    expect((await record()).revisions[SCAN]).toBeUndefined();

    await feed
      .observeEnqueues(enqueuerReturning({ status: 'queued' }))
      .enqueue(sourceInput(SCAN, 'hash-scan'));
    await feed.jobRan(ran('hash-page-1', 'done'), [page]);
    expect((await record()).revisions[SCAN]).toMatchObject({
      fingerprint: 'hash-scan',
      state: 'read',
    });
  });

  it('a deferred job, an idle tick, a non-source job and a file that changed since it was queued record nothing', async () => {
    const { feed, manifests, record } = harness();
    await feed.start();
    manifests.set(DECK, manifestOf(DECK, 'hash-newer', [READ]));
    const source = job('hash-deck', { kind: 'source', sourcePath: DECK, format: 'pdf' });
    await feed.jobRan(ran('hash-deck', 'deferred'), [source]);
    await feed.jobRan({ kind: 'idle', reason: 'nothing-eligible' }, [source]);
    await feed.jobRan({ kind: 'blocked', reason: 'paused' }, [source]);
    await feed.jobRan(ran('hash-x', 'done'), [job('hash-x', { kind: 'instrument-revision' })]);
    await feed.jobRan(ran('hash-deck', 'done'), [source]);
    expect((await record()).revisions).toEqual({});
  });

  it('a source nothing has read this session (the unknown reading) says nothing yet', async () => {
    const { feed, manifests, record } = harness();
    await feed.start();
    manifests.set(DECK, manifestOf(DECK, 'unverified', [PENDING]));
    await feed.jobRan(ran('hash-deck', 'done'), [
      job('hash-deck', { kind: 'source', sourcePath: DECK, format: 'pdf' }),
    ]);
    expect((await record()).revisions).toEqual({});
  });
});

describe('start rebuilds the record first, and nothing counts before it', () => {
  /** A vault whose listing waits until released: the window in which Obsidian reports every file as created. */
  function slowVault(files: Record<string, string>) {
    const inner = memoryVault(files);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listings = 0;
    const vault: VaultSource = {
      ...inner,
      list: async (options) => {
        listings += 1;
        await held;
        return inner.list(options);
      },
      read: (path) => inner.read(path),
      readBinary: (path) => inner.readBinary(path),
    };
    return { vault, release, listings: () => listings };
  }

  it('files already there that the vault reports as created are unknown-day, never the day of the start', async () => {
    const { vault, release } = slowVault({ [NOTE]: TEXT, [OTHER_NOTE]: 'Another invented note.' });
    const { feed, clock, record } = harness({ vault, today: '2026-09-20' });
    const started = feed.start();
    // The vault is loading: each existing file is reported as created and reaches the trigger as a
    // first sighting. These land before the rebuild has finished reading the vault.
    const flood = [
      feed.noteEvaluated(NOTE, TEXT, { kind: 'judge-unavailable' }),
      feed.noteEvaluated(OTHER_NOTE, 'Another invented note.', { kind: 'judge-unavailable' }),
    ];
    expect((await record()).revisions).toEqual({});
    release();
    await started;
    await Promise.all(flood);
    const { revisions, rebuiltOn } = await record();
    expect(rebuiltOn).toBe('2026-09-20');
    expect(revisions[NOTE]?.firstProcessedDay).toBeNull();
    expect(revisions[OTHER_NOTE]?.firstProcessedDay).toBeNull();
    for (const row of Object.values(revisions)) {
      expect(row.firstProcessedDay).not.toBe('2026-09-20');
    }

    // A real edit is a new version and has a day of its own; a file added later does too.
    clock.at('2026-09-25');
    await feed.noteEvaluated(NOTE, `${TEXT} Edited.`, { kind: 'verdict' });
    await feed.noteEvaluated('01 Courses/CRS-A/week 3.md', 'A brand new note.', {
      kind: 'judge-unavailable',
    });
    const after = (await record()).revisions;
    expect(after[NOTE]?.firstProcessedDay).toBe('2026-09-25');
    expect(after['01 Courses/CRS-A/week 3.md']?.firstProcessedDay).toBe('2026-09-25');
    expect(after[OTHER_NOTE]?.firstProcessedDay).toBeNull();
  });

  it('a source queued while the rebuild is still reading stays unknown-day, like the notes the rebuild finds', async () => {
    const manifests = new Map<VaultPath, UnitManifest>([
      [DECK, manifestOf(DECK, 'hash-deck', [READ])],
    ]);
    const { vault, release } = slowVault({ [NOTE]: TEXT, [DECK]: 'invented deck bytes' });
    const { feed, record } = harness({ vault, manifests, today: '2026-09-20' });
    const started = feed.start();
    // The vault reports the deck as created, and the arrival watch queues it.
    await feed.observeEnqueues({ enqueue: async () => ({ status: 'queued' as const }) }).enqueue({
      contentHash: 'hash-deck',
      label: DECK,
      payload: { kind: 'source', sourcePath: DECK, format: 'pdf' },
    });
    release();
    await started;
    await feed.idle();
    const { revisions } = await record();
    expect(revisions[DECK]).toMatchObject({ fingerprint: 'hash-deck', firstProcessedDay: null });
    expect(revisions[NOTE]?.firstProcessedDay).toBeNull();
  });

  it('start is idempotent: one listing however often it is called', async () => {
    const { vault, release, listings } = slowVault({ [NOTE]: TEXT });
    const { feed } = harness({ vault });
    const first = feed.start();
    const second = feed.start();
    release();
    await Promise.all([first, second]);
    expect(listings()).toBe(1);
  });

  it('a moment that arrives before start is called waits, and records once the rebuild has run', async () => {
    const { feed, clock, record } = harness({ files: {} });
    const waiting = feed.noteEvaluated(NOTE, TEXT, { kind: 'verdict' });
    clock.at('2026-08-03');
    expect((await record()).revisions).toEqual({});
    await feed.start();
    await waiting;
    expect((await record()).revisions[NOTE]?.firstProcessedDay).toBe('2026-08-03');
  });

  it('two events for one path record in the order they arrived', async () => {
    const { feed, record } = harness();
    await feed.start();
    const first = feed.noteEvaluated(
      NOTE,
      'An earlier, much longer version of the note. '.repeat(400),
      {
        kind: 'verdict',
      },
    );
    const second = feed.noteEvaluated(NOTE, 'The later short version.', { kind: 'verdict' });
    await Promise.all([first, second]);
    expect((await record()).revisions[NOTE]?.fingerprint).toBe(
      await hashText('The later short version.'),
    );
  });

  it('a rebuild that could not read the vault leaves the record as it was, and nothing more is recorded that session', async () => {
    const files = { [NOTE]: TEXT };
    const inner = memoryVault(files);
    const vault: VaultSource = {
      ...inner,
      list: (options) => inner.list(options),
      read: async () => {
        throw new Error('a course file could not be read');
      },
      readBinary: (path) => inner.readBinary(path),
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { feed, host, record } = harness({ vault, today: '2026-09-20' });
    await feed.start();
    await feed.noteEvaluated(NOTE, TEXT, { kind: 'judge-unavailable' });
    await feed.observeEnqueues({ enqueue: async () => ({ status: 'queued' as const }) }).enqueue({
      contentHash: 'hash-deck',
      label: DECK,
      payload: { kind: 'source', sourcePath: DECK, format: 'pdf' },
    });
    await feed.noteProcessed(NOTE, TEXT);
    expect(host.blob[PROCESSED_REVISION_STORAGE_KEY]).toBeUndefined();
    const persisted = await record();
    expect(persisted.rebuiltOn).toBeNull();
    expect(persisted.revisions).toEqual({});
    // The failure is said once, in fixed words: no path, course or text.
    const said = errors.mock.calls.flat().join(' ');
    expect(said).not.toContain(NOTE);
    expect(said).not.toContain('CRS-A');
    expect(said).not.toContain(TEXT);
  });
});

describe('the feed never throws and never says what it holds', () => {
  it('a store that cannot write is logged as a fixed sentence, and the feed still resolves', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const feed = createProcessedRevisionFeed({
      store: {
        async load() {
          throw new Error(`cannot read ${NOTE}`);
        },
        async recordProcessed() {
          throw new Error(`cannot write ${NOTE}`);
        },
        async rebuild() {},
      },
      vault: memoryVault(),
      manifestsFor: async () => new Map(),
    });
    await feed.start();
    await expect(feed.noteEvaluated(NOTE, TEXT, { kind: 'verdict' })).resolves.toBeUndefined();
    await expect(feed.noteProcessed(NOTE, TEXT)).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    const said = errors.mock.calls.flat().join(' ');
    expect(said).not.toContain(NOTE);
  });

  it('a source queued, settled and then found by a later rebuild is one fingerprint: the job hash is the manifest digest', async () => {
    const bytes = new TextEncoder().encode('invented deck bytes');
    const digest = await hashContent(bytes);
    const { feed, manifests, store, record } = harness({ files: {} });
    await feed.start();
    manifests.set(DECK, manifestOf(DECK, digest, [READ]));
    await feed.observeEnqueues({ enqueue: async () => ({ status: 'queued' as const }) }).enqueue({
      contentHash: digest,
      label: DECK,
      payload: { kind: 'source', sourcePath: DECK, format: 'pdf' },
    });
    await feed.jobRan(ran(digest, 'done'), [
      job(digest, { kind: 'source', sourcePath: DECK, format: 'pdf' }),
    ]);
    expect((await record()).revisions[DECK]?.fingerprint).toBe(digest);
    // The rebuild's own listing of the same source: the same version, so the row is kept as it is.
    const later = memoryVault({ [DECK]: 'invented deck bytes' });
    const rebuilt = createProcessedRevisionFeed({
      store,
      vault: later,
      manifestsFor: async () => new Map([[DECK, manifests.get(DECK) as UnitManifest]]),
    });
    await rebuilt.start();
    const held = (await record()).revisions[DECK];
    expect(held?.fingerprint).toBe(digest);
    expect(held?.firstProcessedDay).not.toBeNull();
  });
});
