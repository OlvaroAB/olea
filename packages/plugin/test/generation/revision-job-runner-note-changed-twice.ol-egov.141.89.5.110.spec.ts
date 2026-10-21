// `ol-egov.141.89.5.110` ([D-508], [D-446], [D-543]): a question citing an ordinary Markdown note
// is rewritten after a change to its cited passage, and the note changes again before the
// successor is drafted. The successor must be drafted from the note as it stands then (the passage
// as it reads now, or the whole note when that passage cannot be named), so what it was drafted
// from is what the citation pass later checks it against. Through the production pieces: the
// citation pass queues the rewrite, the revision job runner drafts it (with what the pass knows,
// `citedSourceNowFrom`), the session presents the draft, accept writes it, and the next pass seeds
// it. Every note, course and sentence is invented ("course A"); nothing comes from a real vault.
// No Worker is called: drafting is injected and goes through the runner's own transport only to
// show what it sent.
import {
  citationStorePath,
  digestPassage,
  type EnqueueInput,
  enumerateVaultInstruments,
  type InstrumentRevisionJobPayload,
  readReviewLogHistory,
  suspendedInstrumentIds,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import { runInstrumentRevisionJob } from '../../src/generation/revision-job-runner.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { citedSourceNowFrom } from '../../src/ingestion/materiality/citation-revision-wiring.js';
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
  COURSE,
  type Harness,
  harness,
  homeNote,
  MemoryVault,
  sidecar,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const SOURCE = 'Course A/Week 2/Invented reading.md';
const HOME = 'Course A/Week 2/Invented reading (Olea).md';

const OPENING =
  'Grains of an imaginary mineral drift slowly along a winding channel during the dry season.';
const CITED =
  'The made-up layer grows thinner toward the edge of the imaginary basin, says the invented survey.';
const CITED_ONCE =
  'The made-up layer grows thicker toward the edge of the imaginary basin, says the invented survey.';
const CITED_TWICE =
  'The made-up layer grows thicker toward the centre of the imaginary basin, says the invented survey.';
const REPLACED = 'Tides on a fictional moon rise twice daily under a pale violet sky.';
const CLOSING = 'Fictional weather over invented hills brings fog every morning in spring.';
const CLOSING_EDITED = 'Fictional weather over invented hills brings rain every morning in spring.';

const OTHER = 'Course A/Week 2/Another invented reading.md';

/** The invented note: a heading and its paragraphs. Its material is the whole text (no question blocks). */
function note(paragraphs: readonly string[]): string {
  return `# Invented reading\n\n${paragraphs.join('\n\n')}\n`;
}

/** A question block of her own inside the note, which its material leaves out. */
const OWN_BLOCK = [
  '```olea-mcq',
  'id: q-own',
  'stem: Which invented statement about the reading holds (q-own)?',
  'answer: Alpha',
  'distractor: Beta',
  'distractor: Gamma',
  'distractor: Delta',
  'distractor: Epsilon',
  '```',
].join('\n');

/**
 * The invented note with her own question block after its paragraphs, bound to a course by its
 * frontmatter so the citation pass and the presentation check both leave the block out.
 */
function noteWithBlock(paragraphs: readonly string[]): string {
  return `---\ntopic: [Invented reading topic]\ncourse: ${COURSE}\n---\n\n${note([...paragraphs, OWN_BLOCK])}`;
}

const goodResponse = {
  ok: true,
  stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
  result: {
    questions: [
      {
        stem: 'Which invented statement holds after the edit?',
        correctAnswer: 'Alpha',
        distractors: ['Beta', 'Gamma', 'Delta'],
        feedback: 'Invented feedback.',
      },
    ],
  },
};

/** Drafting injected as the production function shapes it; records every request it sent. */
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

/**
 * A question citing the invented note (at passage grain on `CITED`, or the whole note), its first
 * pass seeded, then rewritten after `CITED` became `CITED_ONCE`. Returns the job the pass queued.
 */
async function rewritten(grain: 'passage' | 'whole-note', render = note) {
  const vault = new MemoryVault();
  vault.files.set(SOURCE, render([OPENING, CITED, CLOSING]));
  vault.files.set(HOME, homeNote('Invented reading topic', ['q-note']));
  vault.files.set(
    citationStorePath('q-note'),
    sidecar({
      instrumentId: 'q-note',
      sourcePath: SOURCE,
      page: 1,
      ...(grain === 'passage' ? { passageDigest: await digestPassage(CITED) } : {}),
    }),
  );
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  expect(await h.withheld(['q-note'])).toEqual(new Set());

  vault.files.set(SOURCE, render([OPENING, CITED_ONCE, CLOSING]));
  await h.pass(vault);
  expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-note']);
  expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
  const [[input]] = h.actions.enqueue.mock.calls as [[EnqueueInput]];
  const payload = input.payload as InstrumentRevisionJobPayload;
  if (grain === 'passage') expect(payload.newPassageText).toBe(CITED_ONCE);
  else expect(payload.newPassageText).toContain(CITED_ONCE);
  return { vault, h, payload };
}

/** Runs the job with the production runner; returns the successor it cached and what it was drafted from. */
async function runJob(vault: MemoryVault, h: Harness, payload: InstrumentRevisionJobPayload) {
  const drafter = recordingDrafter();
  const cache = createVaultDraftCacheStore(vault);
  const outcome = await runInstrumentRevisionJob(
    {
      vault,
      cache,
      draftDeps: () => drafter.draftDeps,
      draftForConcept: drafter.draftForConcept,
      citedSourceNow: citedSourceNowFrom(() => h.trigger),
    },
    payload,
  );
  expect(outcome).toEqual({ ok: true });
  expect(drafter.draftForConcept).toHaveBeenCalledTimes(1);
  const [record] = await cache.listPending();
  if (record === undefined) throw new Error('no successor');
  return { record, draftedFrom: drafter.draftedFrom() };
}

/** The session's presentation-time check for a written instrument, as `open-session.ts` builds it. */
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
 * She sees it: presented, accepted, seeded by the next pass with no hold, and presented again;
 * the old question stays withheld. Returns the text the pass baselined the successor at.
 */
async function seededAt(vault: MemoryVault, h: Harness, record: DraftRecord): Promise<string> {
  expect(await draftSourceCheckAtPresentation(vault, [record])(record.draftId)).toBe('clear');
  if (record.question === undefined) throw new Error('not a question draft');
  const { instrumentId } = await materializeAcceptedDraft(vault, {
    sourcePath: HOME,
    question: record.question,
    draftId: record.draftId,
    ...(record.sourceCitation === undefined ? {} : { sourceCitation: record.sourceCitation }),
  });
  await h.pass(vault);
  const anchor = (await h.store.loadAll()).get(instrumentId);
  expect(anchor?.pendingRevalidation).toBeUndefined();
  expect(await h.withheld([instrumentId])).toEqual(new Set());
  expect(await presented(vault, h, instrumentId)).toBe('clear');
  expect(await h.withheld(['q-note'])).toEqual(new Set(['q-note']));
  if (anchor === undefined) throw new Error('not seeded');
  return anchor.text;
}

describe('a note changed again before its successor was drafted (ol-egov.141.89.5.110)', () => {
  it('the cited passage changed again: drafted from the passage as it reads now, cited and checked at that passage', async () => {
    const { vault, h, payload } = await rewritten('passage');
    vault.files.set(SOURCE, note([OPENING, CITED_TWICE, CLOSING]));

    const { record, draftedFrom } = await runJob(vault, h, payload);
    expect(draftedFrom).toBe(CITED_TWICE);
    expect(record.sourceCitation).toEqual({
      sourcePath: SOURCE,
      page: 1,
      passageDigest: await digestPassage(CITED_TWICE),
    });
    expect(await seededAt(vault, h, record)).toBe(CITED_TWICE);
  });

  it('the cited passage cannot be named any more: drafted from the whole note as it stands, protected whole', async () => {
    const { vault, h, payload } = await rewritten('passage');
    const now = note([OPENING, REPLACED, CLOSING]);
    vault.files.set(SOURCE, now);

    const { record, draftedFrom } = await runJob(vault, h, payload);
    expect(draftedFrom).toBe(now);
    expect(record.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
    expect(await seededAt(vault, h, record)).toBe(now);
  });

  it('a question protected at whole-note grain: drafted from the whole note as it stands now, her own question blocks left out', async () => {
    const { vault, h, payload } = await rewritten('whole-note', noteWithBlock);
    vault.files.set(SOURCE, noteWithBlock([OPENING, CITED_TWICE, CLOSING]));

    const { record, draftedFrom } = await runJob(vault, h, payload);
    expect(draftedFrom).toContain(CITED_TWICE);
    expect(draftedFrom).not.toContain(CITED_ONCE);
    expect(draftedFrom).not.toContain('q-own');
    expect(record.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
    // What it was drafted from is exactly what the citation pass baselines it at.
    expect(await seededAt(vault, h, record)).toBe(draftedFrom);
  });

  it('the passage the rewrite read now stands twice: drafted from it as before, naming no passage', async () => {
    const { vault, h, payload } = await rewritten('passage');
    const now = note([OPENING, CITED_ONCE, CLOSING, CITED_ONCE]);
    vault.files.set(SOURCE, now);

    const { record, draftedFrom } = await runJob(vault, h, payload);
    expect(draftedFrom).toBe(CITED_ONCE);
    expect(record.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
    expect(await seededAt(vault, h, record)).toBe(now);
  });

  it('the passage moved to another note: drafted from the cited note as it stands, never the other note', async () => {
    const { vault, h, payload } = await rewritten('passage');
    const now = note([OPENING, CLOSING]);
    vault.files.set(SOURCE, now);
    vault.files.set(OTHER, note([CITED_ONCE]));

    const { record, draftedFrom } = await runJob(vault, h, payload);
    expect(draftedFrom).toBe(now);
    expect(record.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
    expect(await seededAt(vault, h, record)).toBe(now);
  });

  it('the note changed again elsewhere: drafted from the passage the rewrite read, cited at it, as before', async () => {
    const { vault, h, payload } = await rewritten('passage');
    vault.files.set(SOURCE, note([OPENING, CITED_ONCE, CLOSING_EDITED]));

    const { record, draftedFrom } = await runJob(vault, h, payload);
    expect(draftedFrom).toBe(CITED_ONCE);
    expect(record.sourceCitation).toEqual({
      sourcePath: SOURCE,
      page: 1,
      passageDigest: await digestPassage(CITED_ONCE),
    });
    expect(await seededAt(vault, h, record)).toBe(CITED_ONCE);
  });
});
