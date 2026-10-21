// `ol-egov.141.89.5.104` ([D-567], [D-508]): a question rewritten after a change inside its cited
// lecture-transcript passage gets a successor that cites the transcript's new version, and the
// part its passage names in that version, so the successor reaches her rather than being withheld
// at first sighting. Through the production pieces: the citation pass with part grain on enqueues
// the successor job, the revision job runner drafts it, accept materialises it, and the next pass
// seeds it. Every transcript, course and sentence is invented ("course A"); nothing comes from a
// real vault. No Worker is called: drafting is injected.
import {
  digestPassage,
  type EnqueueInput,
  type InstrumentRevisionJobPayload,
  readInstrumentCitation,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  materializeAcceptedDraft,
  StaleSourceRevisionError,
} from '../../src/generation/materialize-mcq.js';
import { runInstrumentRevisionJob } from '../../src/generation/revision-job-runner.js';
import type { DraftRecord } from '../../src/generation/types.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import {
  bytesHashOf,
  citeTranscriptPart,
  cue,
  harness,
  homeNote,
  inventedWord,
  LECTURE,
  MemoryVault,
  partCues,
  spoken,
  transcriptOf,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const TRANSCRIPT = 'Course A/Lecture 3/transcript.txt';
const HOME = 'Course A/Lecture 3/transcript (Olea).md';

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

/** Retrieval supplied several chunks; the rewrite's own passage decides the part, as for a note. */
const drafted = (): DraftQuizCardsResult => ({
  status: 'drafted',
  request: {
    courseCode: 'COURSEA',
    conceptName: 'Invented lecture topic',
    sourceChunks: ['retrieved one', 'retrieved two'],
  },
  response: goodResponse,
});

/** A term corrected inside part 4 (cue 10): the changed region stays inside that part. */
function corrected(): string[] {
  const cues = [...LECTURE];
  cues[10] = (cues[10] as string).replace(inventedWord(10 * 40 + 3 + 17), inventedWord(4010));
  return cues;
}

async function seededLecture() {
  const vault = new MemoryVault();
  vault.files.set(TRANSCRIPT, transcriptOf(LECTURE));
  vault.files.set(HOME, homeNote('Invented lecture topic', ['q-four']));
  await citeTranscriptPart(vault, 'q-four', TRANSCRIPT, 4);
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  expect(await h.withheld(['q-four'])).toEqual(new Set());
  return { vault, h };
}

/** The job the pass enqueued for `q-four`'s rewrite. */
function enqueuedJob(h: ReturnType<typeof harness>): InstrumentRevisionJobPayload {
  const input = h.actions.enqueue.mock.calls[0]?.[0] as EnqueueInput | undefined;
  if (input === undefined) throw new Error('no successor was enqueued');
  return input.payload as InstrumentRevisionJobPayload;
}

/** Drafts the successor from `payload` with the production runner and returns its cached draft. */
async function draftSuccessor(vault: MemoryVault, payload: InstrumentRevisionJobPayload) {
  const cache = createVaultDraftCacheStore(vault);
  const outcome = await runInstrumentRevisionJob(
    {
      vault,
      cache,
      draftDeps: () =>
        ({ transport: { send: async () => goodResponse } }) as unknown as DraftQuizCardsDeps,
      draftForConcept: async () => drafted(),
    },
    payload,
  );
  expect(outcome).toEqual({ ok: true });
  const [record] = await cache.listPending();
  if (record === undefined || record.question === undefined) throw new Error('no successor draft');
  return record;
}

/** Accepts a drafted successor into the home note, as `accept.ts` does, and returns its instrument id. */
async function accept(vault: MemoryVault, record: DraftRecord): Promise<string> {
  if (record.question === undefined) throw new Error('not a question draft');
  const { instrumentId } = await materializeAcceptedDraft(vault, {
    sourcePath: HOME,
    question: record.question,
    draftId: record.draftId,
    ...(record.sourceCitation === undefined ? {} : { sourceCitation: record.sourceCitation }),
  });
  return instrumentId;
}

describe('a rewritten transcript question reaches her (ol-egov.141.89.5.104)', () => {
  it('the successor cites the new version and the part its passage names; the next pass seeds it and nothing withholds it', async () => {
    const { vault, h } = await seededLecture();
    const cues = corrected();
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    const newVersion = await bytesHashOf(transcriptOf(cues));
    await h.pass(vault);

    // The pass: one judged change, the old question suspended and its successor queued with the
    // version the changed passage was read from.
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
    const payload = enqueuedJob(h);
    expect(payload.newPassageText).toBe(spoken(cues.slice(9, 12)));
    expect(payload.sourceRevision).toBe(newVersion);

    const record = await draftSuccessor(vault, payload);
    expect(record.sourceCitation).toEqual({
      sourcePath: TRANSCRIPT,
      page: 4,
      passageDigest: await digestPassage(spoken(cues.slice(9, 12))),
      sourceRevision: newVersion,
    });
    // Accept keeps it as drafted: a plain-text transcript is not a note the seal segments.
    const instrumentId = await accept(vault, record);
    expect(await readInstrumentCitation(vault, instrumentId)).toEqual(record.sourceCitation);

    await h.pass(vault);
    const anchors = await h.store.loadAll();
    expect(anchors.get(instrumentId)?.text).toBe(spoken(cues.slice(9, 12)));
    expect(anchors.get(instrumentId)?.pendingRevalidation).toBeUndefined();
    expect(await h.withheld([instrumentId])).toEqual(new Set());
    // The old question stays withheld; it is never shown beside its successor.
    expect(await h.withheld(['q-four'])).toEqual(new Set(['q-four']));
  });

  it('a changed passage that now runs across two parts names no part: the successor protects the whole transcript', async () => {
    const { vault, h } = await seededLecture();
    const [first, second, third] = partCues(4) as [string, string, string];
    const cues = [...LECTURE.slice(0, 9), first, cue(92), second, third, ...LECTURE.slice(12)];
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    await h.pass(vault);
    const payload = enqueuedJob(h);
    expect(payload.newPassageText).toBe(spoken([first, cue(92), second, third]));

    const record = await draftSuccessor(vault, payload);
    expect(record.sourceCitation?.sourceRevision).toBe(await bytesHashOf(transcriptOf(cues)));
    expect(record.sourceCitation?.passageDigest).toBeUndefined();
  });

  it('a transcript changed again before drafting: the successor records the version its passage was read from, never the newer one', async () => {
    const { vault, h } = await seededLecture();
    const cues = corrected();
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    await h.pass(vault);
    const payload = enqueuedJob(h);
    vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(93)]));

    const record = await draftSuccessor(vault, payload);
    expect(record.sourceCitation?.sourceRevision).toBe(payload.sourceRevision);
    expect(record.sourceCitation?.passageDigest).toBeUndefined();
    // Accepting it is refused, as for any plain-text source whose bytes moved on ([D-515]).
    await expect(accept(vault, record)).rejects.toThrow(StaleSourceRevisionError);
  });
});
