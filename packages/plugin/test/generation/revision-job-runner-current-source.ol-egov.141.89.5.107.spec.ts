// `ol-egov.141.89.5.107` ([D-508], [D-567]): a rewritten question's successor is drafted against its
// cited source as it stands when the job runs, at the path a rename Olea saw moved it to and the
// version it holds then, so a second change or a rename between the rewrite and the drafting no
// longer leaves the old question suspended with nothing replacing it. Through the production
// pieces: the citation pass enqueues the successor job, the revision job runner drafts it (with
// what the pass knows, `citedSourceNowFrom`), the session presents the draft, accept writes it,
// and the next pass seeds it. A plain-text transcript, a declared-Markdown transcript and a
// binary source are each covered, and the loop bound is shown. Every transcript, file, course and
// sentence is invented ("course A"); nothing comes from a real vault. No Worker is called:
// drafting is injected and goes through the runner's own transport only to show what it sent.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  citationStorePath,
  type EnqueueInput,
  type ExtractedUnit,
  enumerateVaultInstruments,
  type InstrumentRevisionJobPayload,
  MAX_ATTEMPTS,
  readReviewLogHistory,
  suspendedInstrumentIds,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import {
  type CitedSourceNow,
  REVISION_SOURCE_TEXT_MAX_ATTEMPTS,
  runInstrumentRevisionJob,
} from '../../src/generation/revision-job-runner.js';
import type { DraftRecord } from '../../src/generation/types.js';
import {
  type CitationRevisionActions,
  citedSourceNowFrom,
} from '../../src/ingestion/materiality/citation-revision-wiring.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import {
  draftSourceCheckAtPresentation,
  sourceCheckAtPresentation,
} from '../../src/review/open-session.js';
import {
  bytesHashOf,
  citeTranscriptPart,
  cue,
  type Harness,
  harness,
  homeNote,
  inventedWord,
  LECTURE,
  MemoryVault,
  sidecar,
  spoken,
  transcriptOf,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const TRANSCRIPT = 'Course A/Lecture 3/transcript.txt';
const MOVED = 'Course A/Lecture 3/renamed transcript.txt';
const MARKDOWN = 'Course A/Lecture 3/transcript.md';
const MARKDOWN_MOVED = 'Course A/Lecture 3/renamed transcript.md';
const HOME = 'Course A/Lecture 3/transcript (Olea).md';
const PDF = 'Course A/Lecture 3/slides.pdf';
const PDF_HOME = 'Course A/Lecture 3/slides (Olea).md';

const goodResponse = {
  ok: true,
  stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
  result: {
    questions: [
      {
        stem: 'Which invented statement holds after the correction?',
        correctAnswer: 'Alpha',
        distractors: ['Beta', 'Gamma', 'Delta'],
        feedback: 'Invented feedback.',
      },
    ],
  },
};

/** A Markdown file that declares itself a lecture transcript. */
function declared(cues: readonly string[]): string {
  return `---\nrole: lecture transcript\n---\n\n${transcriptOf(cues)}`;
}

/** `cues` with one invented word of cue `k` replaced, so the change stays inside that cue's part. */
function correctedAt(cues: readonly string[], k: number, word: number, replacement: number) {
  const next = [...cues];
  next[k] = (next[k] as string).replace(
    inventedWord(k * 40 + word + 17),
    inventedWord(replacement),
  );
  return next;
}

/** A question drafted from part 4 of a transcript at `path`, its first pass seeded and shown. */
async function seeded(path: string, render: (cues: readonly string[]) => string) {
  const vault = new MemoryVault();
  vault.files.set(path, render(LECTURE));
  vault.files.set(HOME, homeNote('Invented lecture topic', ['q-four']));
  await citeTranscriptPart(vault, 'q-four', path, 4);
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  expect(await h.withheld(['q-four'])).toEqual(new Set());
  return { vault, h };
}

/** Rewrites `q-four` after a correction inside part 4 and returns the job the pass queued. */
async function rewritten(vault: MemoryVault, h: Harness, path: string, render: typeof declared) {
  const cues = correctedAt(LECTURE, 10, 3, 4010);
  vault.files.set(path, render(cues));
  await h.pass(vault);
  expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
  expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
  const input = h.actions.enqueue.mock.calls[0]?.[0] as EnqueueInput;
  const payload = input.payload as InstrumentRevisionJobPayload;
  expect(payload.newPassageText).toBe(spoken(cues.slice(9, 12)));
  expect(payload.sourceRevision).toBe(await bytesHashOf(render(cues)));
  return { cues, payload };
}

/**
 * Drafting injected as the production function shapes it: one generation request through the
 * runner's transport (where the runner puts its passage first) with two retrieved chunks. Records
 * every request the transport carried.
 */
function recordingDrafter() {
  const sent: WorkerTaskRequest[] = [];
  const draftDeps = {
    transport: {
      send: async (request: WorkerTaskRequest) => {
        sent.push(request);
        return goodResponse;
      },
    },
  } as unknown as DraftQuizCardsDeps;
  const draftForConcept = vi.fn(
    async (
      deps: DraftQuizCardsDeps,
      request: DraftQuizCardsRequest,
    ): Promise<DraftQuizCardsResult> => {
      const sourceChunks = ['retrieved one', 'retrieved two'];
      const response = await deps.transport.send({
        taskId: 'quiz.generate.v1',
        payload: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
      } as unknown as WorkerTaskRequest);
      return {
        status: 'drafted',
        // `ol-egov.141.89.2.39` ([D-628]): the retrieved chunks here are fabricated text from no note.
        inputNotes: [],
        request: { courseCode: request.courseCode, conceptName: request.conceptName, sourceChunks },
        response,
      };
    },
  );
  /** The first chunk of the one generation request: the passage the successor was drafted from. */
  const draftedFrom = (): string => {
    const generation = sent.filter((request) => request.taskId === 'quiz.generate.v1');
    expect(generation).toHaveLength(1);
    const [request] = generation;
    if (request === undefined) throw new Error('no generation request');
    return (request.payload as { sourceChunks: string[] }).sourceChunks[0] as string;
  };
  return { draftDeps, draftForConcept, draftedFrom };
}

/** Runs the job with the production runner; returns its outcome and the successor it cached, if any. */
async function runJob(
  vault: MemoryVault,
  payload: InstrumentRevisionJobPayload,
  options: {
    readonly citedSourceNow?: CitedSourceNow;
    readonly attempts?: number;
    readonly drafter?: ReturnType<typeof recordingDrafter>;
  } = {},
) {
  const drafter = options.drafter ?? recordingDrafter();
  const cache = createVaultDraftCacheStore(vault);
  const outcome = await runInstrumentRevisionJob(
    {
      vault,
      cache,
      draftDeps: () => drafter.draftDeps,
      draftForConcept: drafter.draftForConcept,
      ...(options.citedSourceNow === undefined ? {} : { citedSourceNow: options.citedSourceNow }),
    },
    payload,
    options.attempts ?? 1,
  );
  const [record] = await cache.listPending();
  return { outcome, record, drafter };
}

/** Accepts a drafted successor into `home`, as `accept.ts` does, and returns its instrument id. */
async function accept(vault: MemoryVault, record: DraftRecord, home = HOME): Promise<string> {
  if (record.question === undefined) throw new Error('not a question draft');
  const { instrumentId } = await materializeAcceptedDraft(vault, {
    sourcePath: home,
    question: record.question,
    draftId: record.draftId,
    ...(record.sourceCitation === undefined ? {} : { sourceCitation: record.sourceCitation }),
  });
  return instrumentId;
}

/** The session's presentation-time check over the harness's store, as `open-session.ts` builds it. */
async function presented(vault: MemoryVault, h: Harness, instrumentId: string) {
  const { records } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  return sourceCheckAtPresentation(
    h.store,
    async () => suspendedInstrumentIds((await readReviewLogHistory(vault)).entries),
    { vault, recordOf: (id) => records.find((record) => record.instrumentId === id) },
  )(instrumentId);
}

/**
 * She sees it: the pending draft is presented (not set aside), accepting it writes it, the next
 * pass seeds it with no hold, the session presents it, and the old question stays withheld.
 */
async function reachesHer(vault: MemoryVault, h: Harness, record: DraftRecord, home = HOME) {
  expect(await draftSourceCheckAtPresentation(vault, [record])(record.draftId)).toBe('clear');
  const instrumentId = await accept(vault, record, home);
  await h.pass(vault);
  expect((await h.store.loadAll()).get(instrumentId)?.pendingRevalidation).toBeUndefined();
  expect(await h.withheld([instrumentId])).toEqual(new Set());
  expect(await presented(vault, h, instrumentId)).toBe('clear');
  return instrumentId;
}

describe('a plain-text transcript changed again before the successor was drafted (ol-egov.141.89.5.107)', () => {
  it('changed elsewhere: drafted from its passage, citing the version that stands now (no part named since [D-626]); it reaches her', async () => {
    const { vault, h } = await seeded(TRANSCRIPT, transcriptOf);
    const { cues, payload } = await rewritten(vault, h, TRANSCRIPT, transcriptOf);
    const now = [...cues, cue(93)];
    vault.files.set(TRANSCRIPT, transcriptOf(now));

    const { outcome, record, drafter } = await runJob(vault, payload);
    expect(outcome).toEqual({ ok: true });
    expect(drafter.draftedFrom()).toBe(spoken(cues.slice(9, 12)));
    // `ol-egov.141.89.2.39` ([D-626]): its request carries retrieved chunks besides the passage, so the
    // successor keeps no passage digest and every input note protects it at whole grain.
    expect(record?.sourceCitation).toEqual({
      sourcePath: TRANSCRIPT,
      page: 4,
      sourceRevision: await bytesHashOf(transcriptOf(now)),
    });
    if (record === undefined) throw new Error('no successor');
    await reachesHer(vault, h, record);
    expect(await h.withheld(['q-four'])).toEqual(new Set(['q-four']));
  });

  it('changed again inside the same passage: drafted from the passage as it reads now', async () => {
    const { vault, h } = await seeded(TRANSCRIPT, transcriptOf);
    const { cues, payload } = await rewritten(vault, h, TRANSCRIPT, transcriptOf);
    const now = correctedAt(cues, 10, 5, 4011);
    vault.files.set(TRANSCRIPT, transcriptOf(now));

    const { record, drafter } = await runJob(vault, payload);
    expect(drafter.draftedFrom()).toBe(spoken(now.slice(9, 12)));
    // `ol-egov.141.89.2.39` ([D-626]): its request carries retrieved chunks besides the passage, so the
    // successor keeps no passage digest and every input note protects it at whole grain.
    expect(record?.sourceCitation).toEqual({
      sourcePath: TRANSCRIPT,
      page: 4,
      sourceRevision: await bytesHashOf(transcriptOf(now)),
    });
    if (record === undefined) throw new Error('no successor');
    await reachesHer(vault, h, record);
  });

  it('its passage no longer found: drafted from the whole transcript as it stands, which it then protects whole', async () => {
    const { vault, h } = await seeded(TRANSCRIPT, transcriptOf);
    const { cues, payload } = await rewritten(vault, h, TRANSCRIPT, transcriptOf);
    const now = [...cues.slice(0, 9), cue(94), cue(95), cue(96), ...cues.slice(12)];
    vault.files.set(TRANSCRIPT, transcriptOf(now));

    const { record, drafter } = await runJob(vault, payload);
    expect(drafter.draftedFrom()).toBe(spoken(now));
    expect(record?.sourceCitation?.sourcePath).toBe(TRANSCRIPT);
    expect(record?.sourceCitation?.passageDigest).toBeUndefined();
    expect(record?.sourceCitation?.sourceRevision).toBe(await bytesHashOf(transcriptOf(now)));
    if (record === undefined) throw new Error('no successor');
    const successor = await reachesHer(vault, h, record);
    // Whole grain: the anchor holds the whole transcript, so any later change is checked.
    expect((await h.store.loadAll()).get(successor)?.text).toBe(spoken(now));
  });
});

describe('a rename Olea saw before the successor was drafted (ol-egov.141.89.5.107)', () => {
  it('a plain-text transcript: the successor cites the path it was renamed to, and reaches her', async () => {
    const { vault, h } = await seeded(TRANSCRIPT, transcriptOf);
    const { cues, payload } = await rewritten(vault, h, TRANSCRIPT, transcriptOf);
    vault.move(TRANSCRIPT, MOVED);
    expect(await h.trigger.onSourceRenamed(vault, TRANSCRIPT, MOVED)).toBeGreaterThan(0);

    const { record, drafter } = await runJob(vault, payload, {
      citedSourceNow: citedSourceNowFrom(() => h.trigger),
    });
    expect(drafter.draftedFrom()).toBe(spoken(cues.slice(9, 12)));
    // `ol-egov.141.89.2.39` ([D-626]): its request carries retrieved chunks besides the passage, so the
    // successor keeps no passage digest and every input note protects it at whole grain.
    expect(record?.sourceCitation).toEqual({
      sourcePath: MOVED,
      page: 4,
      sourceRevision: payload.sourceRevision,
    });
    if (record === undefined) throw new Error('no successor');
    const successor = await reachesHer(vault, h, record);
    expect((await h.store.loadAll()).get(successor)?.sourcePath).toBe(MOVED);
  });

  it('renamed and changed again: the new path and the version it holds now', async () => {
    const { vault, h } = await seeded(TRANSCRIPT, transcriptOf);
    const { cues, payload } = await rewritten(vault, h, TRANSCRIPT, transcriptOf);
    vault.move(TRANSCRIPT, MOVED);
    await h.trigger.onSourceRenamed(vault, TRANSCRIPT, MOVED);
    const now = correctedAt(cues, 1, 2, 4012);
    vault.files.set(MOVED, transcriptOf(now));

    const { record } = await runJob(vault, payload, {
      citedSourceNow: citedSourceNowFrom(() => h.trigger),
    });
    expect(record?.sourceCitation?.sourcePath).toBe(MOVED);
    expect(record?.sourceCitation?.sourceRevision).toBe(await bytesHashOf(transcriptOf(now)));
    // `ol-egov.141.89.2.39` ([D-626]): several chunks supplied, so no passage digest.
    expect(record?.sourceCitation?.passageDigest).toBeUndefined();
    if (record === undefined) throw new Error('no successor');
    await reachesHer(vault, h, record);
  });
});

describe('a declared-Markdown transcript (ol-egov.141.89.5.107)', () => {
  it('changed again before drafting: cites the version that stands now, and reaches her', async () => {
    const { vault, h } = await seeded(MARKDOWN, declared);
    const { cues, payload } = await rewritten(vault, h, MARKDOWN, declared);
    const now = [...cues, cue(93)];
    vault.files.set(MARKDOWN, declared(now));

    const { record, drafter } = await runJob(vault, payload);
    expect(drafter.draftedFrom()).toBe(spoken(cues.slice(9, 12)));
    // `ol-egov.141.89.2.39` ([D-626]): its request carries retrieved chunks besides the passage, so the
    // successor keeps no passage digest and every input note protects it at whole grain.
    expect(record?.sourceCitation).toEqual({
      sourcePath: MARKDOWN,
      page: 4,
      sourceRevision: await bytesHashOf(declared(now)),
    });
    if (record === undefined) throw new Error('no successor');
    await reachesHer(vault, h, record);
  });

  it('renamed before drafting: cites the path it was renamed to, and reaches her', async () => {
    const { vault, h } = await seeded(MARKDOWN, declared);
    const { payload } = await rewritten(vault, h, MARKDOWN, declared);
    vault.move(MARKDOWN, MARKDOWN_MOVED);
    expect(await h.trigger.onSourceRenamed(vault, MARKDOWN, MARKDOWN_MOVED)).toBeGreaterThan(0);

    const { record } = await runJob(vault, payload, {
      citedSourceNow: citedSourceNowFrom(() => h.trigger),
    });
    expect(record?.sourceCitation?.sourcePath).toBe(MARKDOWN_MOVED);
    expect(record?.sourceCitation?.sourceRevision).toBe(payload.sourceRevision);
    if (record === undefined) throw new Error('no successor');
    await reachesHer(vault, h, record);
  });
});

const bytes = (version: string): Uint8Array =>
  new TextEncoder().encode(`invented slide bytes, ${version}`);

function slideUnit(page: number, text: string): ExtractedUnit {
  return { text, provenance: { sourcePath: PDF, location: { page } } };
}

/** The page text of the bytes `version` lands, as the changed file's extraction delivers it. */
async function landSlide(vault: MemoryVault, h: Harness, version: string): Promise<void> {
  await h.trigger.onSourceUnitsLanded(
    vault,
    h.actions as unknown as CitationRevisionActions,
    [slideUnit(2, `Invented page two text, ${version}.`)],
    new Map([[PDF, await bytesHashOf(`invented slide bytes, ${version}`)]]),
  );
}

/**
 * A question on page 2 of an invented PDF, held when the file changed to `v1` and rewritten when
 * that version's text landed: the old question suspended and one successor job queued with the
 * page's text and the bytes it was read from.
 */
async function rewrittenSlide() {
  const vault = new MemoryVault();
  vault.files.set(PDF_HOME, homeNote('Invented slide topic', ['q-slide']));
  vault.binaries.set(PDF, bytes('v0'));
  vault.files.set(
    citationStorePath('q-slide'),
    sidecar({
      instrumentId: 'q-slide',
      sourcePath: PDF,
      page: 2,
      sourceRevision: await bytesHashOf('invented slide bytes, v0'),
    }),
  );
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  vault.binaries.set(PDF, bytes('v1'));
  await h.pass(vault);
  expect(await h.withheld(['q-slide'])).toEqual(new Set(['q-slide']));
  const v1 = await bytesHashOf('invented slide bytes, v1');
  await landSlide(vault, h, 'v1');
  expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-slide']);
  expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
  const [call] = h.actions.enqueue.mock.calls;
  const payload = (call?.[0] as EnqueueInput | undefined)?.payload as InstrumentRevisionJobPayload;
  expect(payload.sourceRevision).toBe(v1);
  return { vault, h, payload };
}

/** The file changes to `version`, and (unless `land` is false) that version's page text lands. */
async function changeSlide(vault: MemoryVault, h: Harness, version: string, land = true) {
  vault.binaries.set(PDF, bytes(version));
  if (land) await landSlide(vault, h, version);
  return bytesHashOf(`invented slide bytes, ${version}`);
}

describe('a binary source changed again before the successor was drafted (ol-egov.141.89.5.107)', () => {
  it('its new text has landed: drafted from the page as it reads now, citing those bytes; it reaches her', async () => {
    const { vault, h, payload } = await rewrittenSlide();
    const v2 = await changeSlide(vault, h, 'v2');
    // The landing does not rewrite the suspended question a second time.
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);

    const { outcome, record, drafter } = await runJob(vault, payload, {
      citedSourceNow: citedSourceNowFrom(() => h.trigger),
    });
    expect(outcome).toEqual({ ok: true });
    expect(drafter.draftedFrom()).toBe('Invented page two text, v2.');
    expect(record?.sourceCitation).toEqual({ sourcePath: PDF, page: 2, sourceRevision: v2 });
    if (record === undefined) throw new Error('no successor');
    await reachesHer(vault, h, record, PDF_HOME);
    expect(await h.withheld(['q-slide'])).toEqual(new Set(['q-slide']));
  });

  it('its new text has not landed yet: the job waits, drafting nothing, and drafts from it once it lands', async () => {
    const { vault, h, payload } = await rewrittenSlide();
    const v2 = await changeSlide(vault, h, 'v2', false);
    const port = citedSourceNowFrom(() => h.trigger);

    const waiting = await runJob(vault, payload, { citedSourceNow: port });
    expect(waiting.outcome).toEqual({ ok: false, retryable: true });
    expect(waiting.drafter.draftForConcept).not.toHaveBeenCalled();
    expect(waiting.record).toBeUndefined();

    await changeSlide(vault, h, 'v2');
    const { outcome, record } = await runJob(vault, payload, { citedSourceNow: port, attempts: 2 });
    expect(outcome).toEqual({ ok: true });
    expect(record?.sourceCitation).toEqual({ sourcePath: PDF, page: 2, sourceRevision: v2 });
  });
});

describe('no loop (ol-egov.141.89.5.107)', () => {
  it('a binary source that keeps changing ahead of its text: the job waits a bounded number of attempts, below the queue cap, then ends with a reason and never drafts', async () => {
    const { vault, h, payload } = await rewrittenSlide();
    const port = citedSourceNowFrom(() => h.trigger);
    const drafter = recordingDrafter();
    const outcomes = [];
    for (let attempt = 1; attempt <= REVISION_SOURCE_TEXT_MAX_ATTEMPTS; attempt += 1) {
      // The text of the previous version lands just as the file changes again.
      await changeSlide(vault, h, `v${attempt + 1}`, false);
      await landSlide(vault, h, `v${attempt}`);
      outcomes.push(
        (await runJob(vault, payload, { citedSourceNow: port, attempts: attempt, drafter }))
          .outcome,
      );
    }
    expect(REVISION_SOURCE_TEXT_MAX_ATTEMPTS).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(outcomes.slice(0, -1)).toEqual(
      Array.from({ length: REVISION_SOURCE_TEXT_MAX_ATTEMPTS - 1 }, () => ({
        ok: false,
        retryable: true,
      })),
    );
    expect(outcomes.at(-1)).toMatchObject({ ok: false, retryable: false });
    expect((outcomes.at(-1) as { reason: string }).reason).toContain('q-slide');
    expect(drafter.draftForConcept).not.toHaveBeenCalled();
  });

  it('a transcript changed while its successor is being drafted: one drafting call, and the citation records the version the passage was read from', async () => {
    const { vault, h } = await seeded(TRANSCRIPT, transcriptOf);
    const { cues, payload } = await rewritten(vault, h, TRANSCRIPT, transcriptOf);
    const drafter = recordingDrafter();
    const draft = drafter.draftForConcept.getMockImplementation();
    drafter.draftForConcept.mockImplementation(async (deps, request) => {
      vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(98)]));
      return (draft as NonNullable<typeof draft>)(deps, request);
    });
    const { outcome, record } = await runJob(vault, payload, { drafter });
    expect(outcome).toEqual({ ok: true });
    expect(drafter.draftForConcept).toHaveBeenCalledTimes(1);
    expect(record?.sourceCitation?.sourceRevision).toBe(payload.sourceRevision);
  });
});

// `main.ts` cannot be imported under Vitest (see `transcript-wiring.ol-egov.141.89.8.55.spec.ts`), so
// its wiring is read from its source with prose removed, as `ol-egov.141.89.5.97`'s spec does.
describe('production composition (ol-egov.141.89.5.107)', () => {
  const source = (path: string): string =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it("main.ts hands the revision runner what the citation pass knows, from the plugin's one trigger", () => {
    const main = source('../../src/main.ts');
    const start = main.indexOf('revision: {');
    expect(start).toBeGreaterThan(-1);
    const block = main.slice(start, main.indexOf('},', start));
    expect(block).toContain('citedSourceNow: citedSourceNowFrom(() => this.citationRevision)');
  });

  it('ingestion/wiring.ts forwards it to createRevisionAwareJobRunner', () => {
    const wiring = source('../../src/ingestion/wiring.ts');
    const start = wiring.indexOf('createRevisionAwareJobRunner({');
    expect(start).toBeGreaterThan(-1);
    const call = wiring.slice(start, wiring.indexOf(': runner;', start));
    expect(call).toContain('citedSourceNow: deps.revision.citedSourceNow');
  });
});
