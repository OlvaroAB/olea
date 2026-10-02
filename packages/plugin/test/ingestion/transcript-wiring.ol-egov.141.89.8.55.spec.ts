// `ol-egov.141.89.8.55` (D-465, D-072): the production callers of the lecture-transcript reader, the
// `'transcript'` job kind and the attribution facts, each reached through its production entry point:
// the arrival watch, process-now, `buildIngestionRunner` (the runner chain and the first-read folder
// counts), the processed-revision feed, and the live classify hook. Every string is invented (INV-3).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assembleVoiceExemplars,
  type EnqueueInput,
  type EnqueueResult,
  type JobEnqueuer,
  type PersistedJob,
  type PersistedQueue,
  type QueueStore,
  type TickResult,
  type VaultEvent,
  type VaultPath,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { buildIngestionArrivalWatch } from '../../src/ingestion/arrival-watch.js';
import { createProcessNowAction } from '../../src/ingestion/process-now.js';
import { createProcessedRevisionFeed } from '../../src/ingestion/processed-revisions/feed.js';
import {
  ObsidianProcessedRevisionStore,
  type PersistedProcessedRevisions,
} from '../../src/ingestion/processed-revisions/store.js';
import { buildIngestionRunner, summarizeFirstReadByFolder } from '../../src/ingestion/wiring.js';
import { buildClassifyPassageHook } from '../../src/retrieval/classify-passage.js';
import { memoryVault } from '../review/memory-vault.js';

const PLAIN = '01 Courses/CRS-A/Lectures/week 1 transcript.txt';
const DECLARED = '01 Courses/CRS-A/Lectures/week 2 transcript.md';
const UNDECLARED = '01 Courses/CRS-A/Notes/week 2 notes.md';
const SUBTITLES = '01 Courses/CRS-A/Lectures/week 3.vtt';
const HIDDEN = '.olea/cache/readme.txt';

const SPOKEN = 'Today we cover the idea of a river delta and how sediment settles.\n\nNext, tides.';
const DECLARED_TEXT = `---\nrole: transcript\n---\n${SPOKEN}`;
const NOTE_TEXT = `---\ntitle: my notes\n---\nMy own summary of the week, in my words.`;

const FILES = {
  [PLAIN]: SPOKEN,
  [DECLARED]: DECLARED_TEXT,
  [UNDECLARED]: NOTE_TEXT,
  [SUBTITLES]: 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello',
  [HIDDEN]: 'not hers',
};

class RecordingEnqueuer implements JobEnqueuer {
  readonly calls: EnqueueInput[] = [];
  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    this.calls.push(input);
    return { status: 'queued' };
  }
}

describe('the arrival watch routes transcripts to the transcript job kind', () => {
  async function arrive(paths: readonly string[]) {
    const enqueuer = new RecordingEnqueuer();
    let fire: (event: VaultEvent) => void = () => undefined;
    buildIngestionArrivalWatch({
      vault: memoryVault(FILES),
      enqueuer,
      watch: (handler) => {
        fire = handler;
        return () => undefined;
      },
    });
    for (const path of paths) fire({ kind: 'create', path } as VaultEvent);
    // Each arrival is fire-and-forget; let the reads and hashes settle.
    await vi.waitFor(() => expect(enqueuer.calls.length).toBeGreaterThanOrEqual(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return enqueuer.calls;
  }

  it('a plain-text transcript is enqueued as a transcript job with the plain-text format', async () => {
    const calls = await arrive([PLAIN]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({
      kind: 'transcript',
      sourcePath: PLAIN,
      transcriptFormat: 'plain-text',
    });
    expect(calls[0]?.sourceUnitId).toBe(PLAIN);
  });

  it('a Markdown file declaring role transcript is enqueued as a transcript job, not left to the note path', async () => {
    const calls = await arrive([DECLARED]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({
      kind: 'transcript',
      sourcePath: DECLARED,
      transcriptFormat: 'markdown',
    });
  });

  it('an undeclared Markdown note, a format with no reader and a hidden-folder file enqueue nothing', async () => {
    const calls = await arrive([UNDECLARED, SUBTITLES, HIDDEN]);
    expect(calls).toEqual([]);
  });
});

describe('process-now routes transcripts to the transcript job kind', () => {
  function action(files: Record<string, string> = FILES) {
    const enqueuer = new RecordingEnqueuer();
    const authored: unknown[] = [];
    const processNow = createProcessNowAction({
      vault: memoryVault(files),
      enqueuer,
      tick: async (): Promise<TickResult> => ({ kind: 'idle', reason: 'nothing-eligible' }),
      onAuthoredNoteUnits: (units) => {
        authored.push(...units);
      },
    });
    return { enqueuer, authored, processNow };
  }

  it('a plain-text transcript is enqueued as a transcript job, with no debounce time', async () => {
    const { enqueuer, processNow } = action();
    const outcome = await processNow.processNow(PLAIN);
    expect(outcome).toEqual({ kind: 'queued', offline: false });
    expect(enqueuer.calls[0]?.payload).toEqual({
      kind: 'transcript',
      sourcePath: PLAIN,
      transcriptFormat: 'plain-text',
    });
    expect(enqueuer.calls[0]?.lastChangedAt).toBeUndefined();
  });

  it('a declared Markdown transcript goes to the transcript kind and never to the authored-note path', async () => {
    const { enqueuer, authored, processNow } = action();
    await processNow.processNow(DECLARED);
    expect(enqueuer.calls[0]?.payload).toEqual({
      kind: 'transcript',
      sourcePath: DECLARED,
      transcriptFormat: 'markdown',
    });
    expect(authored).toEqual([]);
  });

  it('an undeclared Markdown note still takes the authored-note path', async () => {
    const { enqueuer, authored, processNow } = action();
    expect(await processNow.processNow(UNDECLARED)).toEqual({ kind: 'ran' });
    expect(enqueuer.calls).toEqual([]);
    expect(authored).toHaveLength(1);
  });
});

class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

describe('the runner chain drains a transcript job into the sink, and the first-read counts include it', () => {
  it('a queued plain-text transcript job is read into parts that land in the sink; the PDF kind is unaffected', async () => {
    const landed: string[] = [];
    const { engine, sink } = await buildIngestionRunner({
      vault: memoryVault(FILES),
      queueStore: new MemoryQueueStore(),
      capability: { canDrain: true },
      onUnitsLanded: (units) => {
        for (const unit of units) landed.push(unit.provenance.sourcePath);
      },
    });
    await engine.enqueue({
      contentHash: 'hash-plain',
      label: PLAIN,
      payload: { kind: 'transcript', sourcePath: PLAIN, transcriptFormat: 'plain-text' },
      sourceUnitId: PLAIN,
    });
    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'ran', contentHash: 'hash-plain', outcome: 'done' });
    const units = sink.forSource(PLAIN);
    expect(units.length).toBeGreaterThan(0);
    expect(units.map((u) => u.text).join('')).toContain('river delta');
    expect(landed).toContain(PLAIN);
  });

  it('a transcript job whose format has no reader fails visibly and is not retried', async () => {
    const { engine } = await buildIngestionRunner({
      vault: memoryVault(FILES),
      queueStore: new MemoryQueueStore(),
      capability: { canDrain: true },
    });
    await engine.enqueue({
      contentHash: 'hash-vtt',
      label: SUBTITLES,
      payload: { kind: 'transcript', sourcePath: SUBTITLES, transcriptFormat: 'webvtt' },
    });
    expect(await engine.tick()).toEqual({
      kind: 'ran',
      contentHash: 'hash-vtt',
      outcome: 'failed',
    });
  });

  it('the first-read folder counts include a transcript job in its course folder, and still exclude other kinds', () => {
    const job = (contentHash: string, payload: unknown, status: PersistedJob['status']) =>
      ({
        contentHash,
        label: contentHash,
        payload,
        enqueuedAt: 0,
        status,
        attempts: 0,
      }) as PersistedJob;
    const folder = '01 Courses/CRS-A' as VaultPath;
    const [view] = summarizeFirstReadByFolder(
      [
        job('a', { kind: 'transcript', sourcePath: PLAIN, transcriptFormat: 'plain-text' }, 'done'),
        job(
          'b',
          { kind: 'transcript', sourcePath: DECLARED, transcriptFormat: 'markdown' },
          'queued',
        ),
        job('c', { kind: 'instrument-revision', sourcePath: PLAIN }, 'queued'),
      ],
      [folder],
    );
    expect(view?.counts.done).toBe(1);
    expect(view?.counts.queued).toBe(1);
  });
});

describe('the processed-revision feed handles the transcript kind explicitly', () => {
  class FakeDataHost {
    blob: Record<string, unknown> = {};
    async loadData(): Promise<unknown> {
      return this.blob;
    }
    async saveData(data: unknown): Promise<void> {
      this.blob = data as Record<string, unknown>;
    }
  }
  const payload = { kind: 'transcript', sourcePath: PLAIN, transcriptFormat: 'plain-text' };
  const queuedJob = (): PersistedJob =>
    ({
      contentHash: 'h-t',
      label: PLAIN,
      payload,
      enqueuedAt: 0,
      status: 'done',
      attempts: 1,
    }) as PersistedJob;

  async function build() {
    const store = new ObsidianProcessedRevisionStore(
      new FakeDataHost(),
      () => new Date('2026-08-01T12:00:00'),
    );
    const feed = createProcessedRevisionFeed({
      store,
      vault: memoryVault(FILES),
      manifestsFor: async () => new Map(),
    });
    await feed.start();
    const inner: JobEnqueuer = { enqueue: async () => ({ status: 'queued' }) };
    await feed.observeEnqueues(inner).enqueue({ contentHash: 'h-t', label: PLAIN, payload });
    await feed.idle();
    const record = (): Promise<PersistedProcessedRevisions> => store.load();
    return { feed, record };
  }

  it('a queued transcript is recorded pending, and read once its job is done', async () => {
    const { feed, record } = await build();
    expect((await record()).revisions[PLAIN]).toMatchObject({
      fingerprint: 'h-t',
      state: 'pending',
    });
    await feed.jobRan({ kind: 'ran', contentHash: 'h-t', outcome: 'done' }, [queuedJob()]);
    await feed.idle();
    expect((await record()).revisions[PLAIN]).toMatchObject({ fingerprint: 'h-t', state: 'read' });
  });

  it('a failed transcript job is recorded unreadable, never read', async () => {
    const { feed, record } = await build();
    await feed.jobRan({ kind: 'ran', contentHash: 'h-t', outcome: 'failed' }, [queuedJob()]);
    await feed.idle();
    expect((await record()).revisions[PLAIN]).toMatchObject({ state: 'unreadable' });
  });

  it('a deferred tick records nothing more', async () => {
    const { feed, record } = await build();
    await feed.jobRan({ kind: 'ran', contentHash: 'h-t', outcome: 'deferred' }, [queuedJob()]);
    await feed.idle();
    expect((await record()).revisions[PLAIN]).toMatchObject({ state: 'pending' });
  });
});

describe('the live classify hook treats a transcript passage as not hers, and never a voice exemplar', () => {
  const frontmatter: Record<string, Record<string, unknown>> = {
    [DECLARED]: { role: 'Transcript' },
    '05 Zettelkasten/looks-like-hers.md': { role: 'lecture_transcript' },
  };
  const hook = buildClassifyPassageHook({
    frontmatterHost: { frontmatterFor: (p) => frontmatter[p] },
  });

  it('a plain-text transcript chunk is not-hers and instructor-curated', () => {
    expect(hook({ path: PLAIN, text: SPOKEN })).toEqual({
      authorship: 'not-hers',
      curationAuthority: 'instructor',
    });
  });

  it('a declared Markdown transcript chunk is not-hers, even in her Zettelkasten folder with two wikilinks', () => {
    expect(hook({ path: DECLARED, text: SPOKEN })).toEqual({
      authorship: 'not-hers',
      curationAuthority: 'instructor',
    });
    expect(
      hook({
        path: '05 Zettelkasten/looks-like-hers.md',
        text: 'See [[delta]] and [[tides]] too.',
      }),
    ).toEqual({ authorship: 'not-hers', curationAuthority: 'instructor' });
  });

  it('assembling voice exemplars from transcript chunks yields no phrasing exemplar', () => {
    const passages = [PLAIN, DECLARED].map((path) => {
      const fact = hook({ path, text: SPOKEN });
      return {
        text: SPOKEN,
        authorship: fact?.authorship ?? 'unknown',
        curationAuthority: fact?.curationAuthority ?? 'unknown',
      };
    });
    expect(assembleVoiceExemplars(passages as never).phrasing).toEqual([]);
  });

  it('an undeclared Markdown note is unaffected by the transcript cue', () => {
    expect(hook({ path: UNDECLARED, text: NOTE_TEXT })).toEqual({
      authorship: 'unknown',
      curationAuthority: 'unknown',
    });
  });
});

// `main.ts` cannot be imported under Vitest (`main-wiring.spec.ts`'s module doc says why), so its
// own site is checked the way that suite checks `main.ts`: the source with prose removed.
describe('main.ts keeps a declared transcript off the note path (the one site main.ts owns)', () => {
  const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const body = main.slice(main.indexOf('private async evaluateMaterialityChange'));

  it('evaluateMaterialityChange returns for a declared transcript before the materiality gate runs', () => {
    const guard = body.indexOf('if (declaresTranscript(currentText)) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('this.materiality.evaluate('));
  });
});
