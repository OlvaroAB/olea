// Scenario: features/F1-sources.md, "a transcript job survives the persisted queue, and an older
// client does not mangle it" (ol-egov.141.89.5.44; D-465; PERSISTENCE.md 2.7 and 2.9, section 3
// cases A1, A2, A4, B1 to B4 and the queue half of B6). Test id:
// @auto:core/ingestion/queue-transcript-format.ol-egov.141.89.5.44.spec
//
// A restart is a new engine over the queue exactly as it was saved, as JSON text (the way
// data.json holds it): nothing in memory survives it. The newer build is the runner composition
// with the transcript kind (`createTranscriptAwareJobRunner` outermost, over the extraction runner,
// as the plugin's `buildIngestionRunner` composes it). The older build is the extraction runner
// alone: the composition from before the change, which has no transcript kind. Every text is
// invented ("course A").

import { describe, expect, it } from 'vitest';
import {
  DECLARED_MARKDOWN,
  LONG_PLAIN,
  MemoryVault,
  UNDECLARED_MARKDOWN,
} from '../extract/transcript.fixtures.js';
import type { ExtractedUnit } from '../extract/types.js';
import type { VaultSource } from '../vault/types.js';
import { IngestionQueueEngine } from './engine.js';
import { createExtractionJobRunner, type ExtractedUnitSink } from './extraction-runner.js';
import { hashText } from './hash.js';
import {
  buildTranscriptEnqueueInput,
  createTranscriptAwareJobRunner,
  TRANSCRIPT_WORKFLOW_VERSION,
} from './transcript-job.js';
import type { JobRunner, PersistedJob, PersistedQueue, QueueStore } from './types.js';

const PLAIN = 'Course A/Lecture 3/transcript.txt';
const DECLARED = 'Course A/Lecture 4/transcript.md';
const COPY = 'Course A/Lecture 3 copy/transcript.txt';

/** The queue as data.json holds it: saved as text, loaded as a fresh parse. */
class TextQueueStore implements QueueStore {
  text: string | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.text === null ? null : (JSON.parse(this.text) as PersistedQueue);
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.text = JSON.stringify(queue);
  }
  jobs(): readonly Record<string, unknown>[] {
    return this.text === null ? [] : (JSON.parse(this.text) as { jobs: [] }).jobs;
  }
}

function collectingSink(): { sink: ExtractedUnitSink; received: ExtractedUnit[][] } {
  const received: ExtractedUnit[][] = [];
  return {
    received,
    sink: {
      async receive(units) {
        received.push([...units]);
      },
    },
  };
}

const noFollowOn = { enqueue: async () => ({ status: 'queued' as const }) };

/** The newer build: the transcript kind outermost, everything else to the extraction runner. */
function newerRunner(vault: VaultSource, sink: ExtractedUnitSink): JobRunner {
  return createTranscriptAwareJobRunner({
    vault,
    sink,
    fallback: createExtractionJobRunner({ vault, enqueuer: noFollowOn, sink }),
  });
}

/** The older build: the extraction runner alone, which knows no transcript kind. */
function olderRunner(vault: VaultSource, sink: ExtractedUnitSink): JobRunner {
  return createExtractionJobRunner({ vault, enqueuer: noFollowOn, sink });
}

function start(store: QueueStore, runner: JobRunner): Promise<IngestionQueueEngine> {
  return IngestionQueueEngine.create({
    store,
    capability: { canDrain: true },
    runner,
    clock: { now: () => 1_000_000 },
    random: { next: () => 0 },
  });
}

/** The fields an older build must never rewrite: payload, hash, version, path and label. */
function identity(job: Record<string, unknown>): string {
  return JSON.stringify([
    job.contentHash,
    job.label,
    job.payload,
    job.sourceUnitId,
    job.workflowVersion,
  ]);
}

async function plainInput() {
  return buildTranscriptEnqueueInput({
    sourcePath: PLAIN,
    transcriptFormat: 'plain-text',
    contentHash: await hashText(LONG_PLAIN),
  });
}

/** A transcript job queued by the newer build, then the same saved queue drained by the older one. */
async function failedByOlderBuild(): Promise<{
  store: TextQueueStore;
  vault: MemoryVault;
  queuedText: string;
}> {
  const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN });
  const store = new TextQueueStore();
  const newer = await start(store, newerRunner(vault, collectingSink().sink));
  await newer.enqueue(await plainInput());
  const queuedText = store.text as string;
  const older = await start(store, olderRunner(vault, collectingSink().sink));
  await older.tick();
  return { store, vault, queuedText };
}

describe('A1: each transcript job records its exact format and is read by that format’s reader, across a restart', () => {
  it('a plain-text and a declared Markdown job are persisted with their format, reloaded, and each read by its reader', async () => {
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN, [DECLARED]: DECLARED_MARKDOWN });
    const store = new TextQueueStore();
    const first = await start(store, newerRunner(vault, collectingSink().sink));
    await first.enqueue(await plainInput());
    await first.enqueue(
      buildTranscriptEnqueueInput({
        sourcePath: DECLARED,
        transcriptFormat: 'markdown',
        contentHash: await hashText(DECLARED_MARKDOWN),
      }),
    );
    expect(store.jobs().map((job) => job.payload)).toEqual([
      { kind: 'transcript', sourcePath: PLAIN, transcriptFormat: 'plain-text' },
      { kind: 'transcript', sourcePath: DECLARED, transcriptFormat: 'markdown' },
    ]);
    expect(store.jobs().map((job) => job.workflowVersion)).toEqual([
      TRANSCRIPT_WORKFLOW_VERSION,
      TRANSCRIPT_WORKFLOW_VERSION,
    ]);

    // Restart: a new engine over the saved text.
    const { sink, received } = collectingSink();
    const second = await start(store, newerRunner(vault, sink));
    expect(await second.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(await second.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(received.map((units) => units[0]?.provenance.sourcePath)).toEqual([PLAIN, DECLARED]);
    // The plain-text reader reads the whole file; the Markdown reader starts after the frontmatter.
    expect(received[0]?.map((unit) => unit.provenance.location.page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(received[1]?.map((unit) => unit.text).join('\n')).not.toContain('role:');
    expect(received[1]?.[0]?.text).toContain('Welcome to the lecture.');
  });
});

describe('A2: a declaration removed after the job is queued', () => {
  it('fails at drain after a restart, not to be retried, with a reason saying so, and no parts are written', async () => {
    const vault = new MemoryVault({ [DECLARED]: DECLARED_MARKDOWN });
    const store = new TextQueueStore();
    const first = await start(store, newerRunner(vault, collectingSink().sink));
    await first.enqueue(
      buildTranscriptEnqueueInput({
        sourcePath: DECLARED,
        transcriptFormat: 'markdown',
        contentHash: await hashText(DECLARED_MARKDOWN),
      }),
    );
    await vault.write(DECLARED, UNDECLARED_MARKDOWN);

    const { sink, received } = collectingSink();
    const second = await start(store, newerRunner(vault, sink));
    expect(await second.tick()).toMatchObject({ kind: 'ran', outcome: 'failed' });
    expect(await second.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    const [job] = second.list();
    expect(job?.status).toBe('failed');
    expect(job?.attempts).toBe(1);
    expect(job?.failedReason).toContain('no longer reads as a markdown transcript');
    expect(received).toEqual([]);
  });
});

describe('A4: a persisted job with an unknown transcriptFormat', () => {
  it('fails after a restart, not to be retried, with a reason naming the value; its payload is untouched', async () => {
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN });
    const payload = { kind: 'transcript', sourcePath: PLAIN, transcriptFormat: 'wav' };
    const store = new TextQueueStore();
    store.text = JSON.stringify({
      version: 1,
      headroom: null,
      jobs: [
        {
          contentHash: 'hash-unknown-format',
          label: PLAIN,
          payload,
          enqueuedAt: 5,
          status: 'queued',
          attempts: 0,
          sourceUnitId: PLAIN,
          workflowVersion: TRANSCRIPT_WORKFLOW_VERSION,
        },
      ],
    });
    const before = identity(store.jobs()[0] as Record<string, unknown>);

    const { sink, received } = collectingSink();
    const engine = await start(store, newerRunner(vault, sink));
    expect(await engine.tick()).toMatchObject({ kind: 'ran', outcome: 'failed' });
    expect(await engine.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    const saved = store.jobs()[0] as Record<string, unknown>;
    expect(saved.status).toBe('failed');
    expect(saved.attempts).toBe(1);
    expect(saved.failedReason).toContain('"wav"');
    expect(identity(saved)).toBe(before);
    expect(received).toEqual([]);
  });
});

describe('B1: a transcript job persisted in each status, then a restart', () => {
  const transcriptJob = (status: PersistedJob['status'], extra: Record<string, unknown>) => ({
    contentHash: `hash-${status}-${String(extra.deferReason ?? '')}`,
    label: PLAIN,
    payload: { kind: 'transcript', sourcePath: PLAIN, transcriptFormat: 'plain-text' },
    enqueuedAt: 10,
    status,
    attempts: status === 'queued' ? 0 : 1,
    ...extra,
    sourceUnitId: PLAIN,
    workflowVersion: TRANSCRIPT_WORKFLOW_VERSION,
  });
  const persisted = {
    version: 1,
    headroom: null,
    jobs: [
      transcriptJob('queued', {}),
      transcriptJob('in-flight', {}),
      transcriptJob('done', { doneAt: 20 }),
      transcriptJob('deferred', { deferReason: 'transient-error', resumeNotBefore: 2_000_000 }),
      transcriptJob('deferred', { deferReason: 'budget-exhausted', resumeNotBefore: 3_000_000 }),
      transcriptJob('failed', { failedReason: 'no reader for this format (webvtt)' }),
    ],
  };

  it('each reloads deep-equal, except that in-flight becomes queued; a second restart changes nothing', async () => {
    const store = new TextQueueStore();
    store.text = JSON.stringify(persisted);
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN });
    const engine = await start(store, newerRunner(vault, collectingSink().sink));
    const expected = persisted.jobs.map((job) =>
      job.status === 'in-flight' ? { ...job, status: 'queued' } : job,
    );
    expect(engine.list()).toEqual(expected);
    expect(store.jobs()).toEqual(expected);
    const afterFirst = store.text;

    const again = await start(store, newerRunner(vault, collectingSink().sink));
    expect(again.list()).toEqual(expected);
    expect(store.text).toBe(afterFirst);
  });

  it('a job in flight when the process stopped is queued again after the restart and read once', async () => {
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN });
    const store = new TextQueueStore();
    // The first session dies while the transcript is being read: the runner never settles.
    const stalled = await start(store, () => new Promise(() => undefined));
    await stalled.enqueue(await plainInput());
    void stalled.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.jobs()[0]?.status).toBe('in-flight');

    const { sink, received } = collectingSink();
    const engine = await start(store, newerRunner(vault, sink));
    expect(engine.list()[0]?.status).toBe('queued');
    expect(await engine.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(await engine.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(received).toHaveLength(1);
    expect(store.jobs()[0]).toMatchObject({ status: 'done', attempts: 2 });
  });
});

describe('B2: the same queue drained by the older build', () => {
  it('the job is failed with the unrecognised-payload reason; payload, hash, version and path are byte-equal; the count is unchanged', async () => {
    const { store, queuedText } = await failedByOlderBuild();
    const queued = (JSON.parse(queuedText) as { jobs: Record<string, unknown>[] }).jobs;
    const after = store.jobs();
    expect(after).toHaveLength(queued.length);
    const job = after[0] as Record<string, unknown>;
    expect(job.status).toBe('failed');
    expect(job.failedReason).toBe(`unrecognised ingestion job payload for ${job.contentHash}`);
    expect(identity(job)).toBe(identity(queued[0] as Record<string, unknown>));
    expect(JSON.stringify(job.payload)).toBe(JSON.stringify(queued[0]?.payload));
  });

  it('the older build never drops it and never runs it as something else: a restart on the older build keeps it, and its snapshot counts it failed', async () => {
    const { store, vault } = await failedByOlderBuild();
    const before = store.text;
    const { sink, received } = collectingSink();
    const older = await start(store, olderRunner(vault, sink));
    expect(await older.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(older.snapshot()).toMatchObject({ failed: 1, queued: 0, done: 0 });
    expect(store.text).toBe(before);
    expect(received).toEqual([]);
  });

  it('the older build saving its own work leaves the transcript job’s bytes as they were', async () => {
    const { store, vault } = await failedByOlderBuild();
    const transcriptBytes = JSON.stringify(store.jobs()[0]);
    const older = await start(store, olderRunner(vault, collectingSink().sink));
    await older.enqueue({
      contentHash: 'hash-deck',
      label: 'Course A/Lecture 3/slides.pdf',
      payload: { kind: 'source', sourcePath: 'Course A/Lecture 3/slides.pdf', format: 'pdf' },
      sourceUnitId: 'Course A/Lecture 3/slides.pdf',
    });
    expect(store.jobs()).toHaveLength(2);
    expect(JSON.stringify(store.jobs()[0])).toBe(transcriptBytes);
  });
});

describe('B3: back on the newer build', () => {
  it('the half that holds today: the job the older build failed is loaded intact, never dropped', async () => {
    const { store, vault } = await failedByOlderBuild();
    const before = store.jobs();
    const newer = await start(store, newerRunner(vault, collectingSink().sink));
    expect(newer.list()).toEqual(before);
  });

  // PERSISTENCE.md 2.7: "on every load, the newer build puts back to `queued` any job that is
  // `failed` with the unrecognised-payload reason and whose payload it now recognises". Not built:
  // `IngestionQueueEngine.create` (engine.ts, `create`, lines 328-344) corrects only `in-flight`
  // jobs, and the plugin's `buildIngestionRunner` (wiring.ts, the `IngestionQueueEngine.create`
  // call) passes no recogniser. So the job stays `failed`, and because the engine's dedup treats any
  // recorded status as settled for that content and version, the transcript is never read on this
  // device until its bytes or the reader version change. A code defect: the fix uses an existing
  // status and an existing field, no persisted change. Pinned as an expected failure so that the fix
  // turns this red and it is flipped to a plain `it`.
  it.fails('B3 [defect: no load-time re-arm, engine.ts:328-344] the job is re-armed and runs once', async () => {
    const { store, vault } = await failedByOlderBuild();
    const { sink, received } = collectingSink();
    const newer = await start(store, newerRunner(vault, sink));
    expect(newer.list()[0]?.status).toBe('queued');
    expect(await newer.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(await newer.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(received).toHaveLength(1);
  });

  it('a transcript job failed for another reason is not re-armed, and the same input stays a duplicate', async () => {
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN });
    const store = new TextQueueStore();
    const input = await plainInput();
    store.text = JSON.stringify({
      version: 1,
      headroom: null,
      jobs: [
        {
          contentHash: input.contentHash,
          label: PLAIN,
          payload: input.payload,
          enqueuedAt: 5,
          status: 'failed',
          attempts: 1,
          failedReason: 'transcript has no readable text (empty-document)',
          sourceUnitId: PLAIN,
          workflowVersion: TRANSCRIPT_WORKFLOW_VERSION,
        },
      ],
    });
    const before = store.text;
    const newer = await start(store, newerRunner(vault, collectingSink().sink));
    expect(newer.list()[0]?.status).toBe('failed');
    expect(await newer.enqueue(input)).toEqual({ status: 'duplicate', existingStatus: 'failed' });
    expect(store.text).toBe(before);
  });
});

describe('B4: a queue of the four existing kinds', () => {
  it('round-trips through the newer build byte-identically, beside a transcript job it adds', async () => {
    const existing = [
      {
        contentHash: 'h-source',
        label: 'Course A/slides.pdf',
        payload: { kind: 'source', sourcePath: 'Course A/slides.pdf', format: 'pdf' },
        enqueuedAt: 1,
        status: 'done',
        attempts: 1,
        doneAt: 2,
        sourceUnitId: 'Course A/slides.pdf',
        workflowVersion: 'extract:7',
      },
      {
        contentHash: 'h-note',
        label: 'Course A/notes.md',
        payload: { kind: 'note', notePath: 'Course A/notes.md' },
        enqueuedAt: 3,
        status: 'failed',
        attempts: 1,
        failedReason: 'an invented reason',
      },
      {
        contentHash: 'h-vision',
        label: 'Course A/slides.pdf p.4',
        payload: { kind: 'vision-page', sourcePath: 'Course A/slides.pdf', format: 'pdf', page: 4 },
        enqueuedAt: 4,
        status: 'deferred',
        attempts: 2,
        deferReason: 'transient-error',
        resumeNotBefore: 9_000_000,
      },
      {
        contentHash: 'h-revision',
        label: 'q-invented',
        payload: { kind: 'instrument-revision', predecessorInstrumentId: 'q-invented' },
        enqueuedAt: 5,
        status: 'deferred',
        attempts: 0,
        deferReason: 'budget-exhausted',
        resumeNotBefore: 8_000_000,
      },
    ];
    const store = new TextQueueStore();
    store.text = JSON.stringify({ version: 1, jobs: existing, headroom: 0.5 });
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN });
    const newer = await start(store, newerRunner(vault, collectingSink().sink));
    await newer.enqueue(await plainInput());
    const saved = JSON.parse(store.text) as { version: number; jobs: unknown[]; headroom: unknown };
    expect(saved.version).toBe(1);
    expect(saved.headroom).toBe(0.5);
    expect(JSON.stringify(saved.jobs.slice(0, existing.length))).toBe(JSON.stringify(existing));
    expect(saved.jobs[existing.length]).toMatchObject({
      payload: { kind: 'transcript', sourcePath: PLAIN, transcriptFormat: 'plain-text' },
    });
  });
});

describe('B6, the queue half: a byte-identical copy at a second path', () => {
  it('is a duplicate job and does not run; the one job reads the first path only', async () => {
    const vault = new MemoryVault({ [PLAIN]: LONG_PLAIN, [COPY]: LONG_PLAIN });
    const store = new TextQueueStore();
    const first = await start(store, newerRunner(vault, collectingSink().sink));
    const hash = await hashText(LONG_PLAIN);
    expect(
      await first.enqueue(
        buildTranscriptEnqueueInput({
          sourcePath: PLAIN,
          transcriptFormat: 'plain-text',
          contentHash: hash,
        }),
      ),
    ).toEqual({ status: 'queued' });
    const { sink, received } = collectingSink();
    const second = await start(store, newerRunner(vault, sink));
    expect(
      await second.enqueue(
        buildTranscriptEnqueueInput({
          sourcePath: COPY,
          transcriptFormat: 'plain-text',
          contentHash: hash,
        }),
      ),
    ).toEqual({ status: 'duplicate', existingStatus: 'queued' });
    await second.tick();
    expect(await second.tick()).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(second.list()).toHaveLength(1);
    expect(new Set(received.flat().map((unit) => unit.provenance.sourcePath))).toEqual(
      new Set([PLAIN]),
    );
  });
});
