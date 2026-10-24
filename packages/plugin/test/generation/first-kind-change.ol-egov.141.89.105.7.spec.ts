/**
 * Scenarios: features/F3-learn-from-anything.md, the `[D-550]` / `[D-551]` block —
 * @auto:plugin/generation/first-kind-change.ol-egov.141.89.105.7.spec
 *
 * `[D-551]`'s build constraint: when a course's nearest assessment passes and its first kind
 * changes, valid existing instruments and their evidence are kept. Course A is drafted as
 * question-and-answer cards while its written assessment is nearest (`[D-550]`); one card is
 * accepted and answered, one stays pending. After the written assessment passes, the producer asks
 * for multiple choice; material lands again. Nothing already drafted is asked again, rewritten or
 * re-scored: every file the vault held is byte for byte what it was (the draft index alone gains
 * the new concept's entry), and only the concept with no draft is drafted, as multiple choice.
 * Every fixture string is invented.
 */
import type { ConceptRecord, ExtractedUnit } from 'olea-core';
import {
  appendReviewLogRecord,
  calendarDayFromLocalDate,
  parseCards,
  readReviewLogHistory,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftCardsDeps, DraftCardsResult } from '../../src/generation/draft-cards.js';
import { deriveKindInputs } from '../../src/generation/kind-inputs.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';
import { currentInputNotes } from './input-notes-fixture.js';

const A = 'TESTA101';
const NOTE_ONE = `01 Courses/${A}/Week 1.md`;
const NOTE_TWO = `01 Courses/${A}/Week 2.md`;
const ASSESSMENTS = [
  {
    path: '02 Assignments/a-essay.md',
    course: A,
    type: 'Essay',
    weight: 20,
    weightRaw: '20',
    due: '2026-01-20',
    status: 'upcoming',
  },
  {
    path: '02 Assignments/a-exam.md',
    course: A,
    type: 'Exam',
    weight: 50,
    weightRaw: '50',
    due: '2026-03-01',
    status: 'upcoming',
  },
];

const concept = (name: string, sourcePath: string): ConceptRecord => ({
  key: `key-${name}`,
  name,
  tier: 2,
  courses: [A],
  sourcePaths: [sourcePath],
});

/** A note of hers landing: the authored-note shape (no embedding note), so drafts land beside it. */
const landed = (path: string): ExtractedUnit => ({
  text: 'unused',
  provenance: { sourcePath: path, location: { page: 1, charRange: { start: 0, end: 1 } } },
});

function cardResult(name: string): DraftCardsResult {
  return {
    status: 'drafted',
    request: {
      courseCode: A,
      conceptName: name,
      sourceChunks: ['chunk'],
      intendedDemand: 'recall-a-fact',
    },
    response: {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: '1.10.0', modelId: 'test-model' },
      result: {
        demandAcknowledgement: { intendedDemand: 'recall-a-fact' },
        cards: [
          {
            front: `What is ${name}?`,
            back: `${name} answer`,
            subject: name,
            declaredDemand: 'recall-a-fact',
          },
        ],
      },
    },
  };
}

function quizResult(name: string): DraftQuizCardsResult {
  return {
    status: 'drafted',
    request: { courseCode: A, conceptName: name, sourceChunks: ['chunk'] },
    response: {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
      result: {
        questions: [
          { stem: name, correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'x' },
        ],
      },
    },
  };
}

async function snapshot(vault: MemoryVaultSource): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of await vault.list()) out.set(path, (await vault.read(path)) as string);
  return out;
}

describe('[D-551] a change of first kind keeps every existing instrument and its evidence', () => {
  it('the accepted card, its block, her answer and the pending card are untouched; only the new concept drafts, as multiple choice', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_ONE]: '# Week 1\n\nher prose\n',
      [NOTE_TWO]: '# Week 2\n\nmore of her prose\n',
    });
    const cache = createVaultDraftCacheStore(vault);
    const notesFor = (name: string) =>
      currentInputNotes(vault, name === 'Beta' ? NOTE_TWO : NOTE_ONE);
    let candidates = [concept('Alpha', NOTE_ONE), concept('Gamma', NOTE_ONE)];
    const cardAsks: string[] = [];
    const quizAsks: string[] = [];
    let today = new Date('2026-01-10T09:00:00');
    const sweep = (units: readonly ExtractedUnit[]) =>
      runGenerationSweep(units, {
        vault,
        cache,
        draftDeps: {} as never,
        listConceptsForCourse: async () => candidates,
        now: () => today,
        // The real producer, fresh per sweep, as a composition builds it.
        kindInputsFor: deriveKindInputs({
          assessments: ASSESSMENTS,
          reviewLog: [],
          today: calendarDayFromLocalDate(today),
        }).kindInputsFor,
        cardDraftDeps: {} as DraftCardsDeps,
        draftCardForConcept: async (_d, request) => {
          cardAsks.push(request.conceptName);
          // `ol-egov.141.89.2.39` ([D-628]): the notes the call drew from, as a production call reports.
          return {
            ...cardResult(request.conceptName),
            inputNotes: await notesFor(request.conceptName),
          };
        },
        draftForConcept: async (_d, request) => {
          quizAsks.push(request.conceptName);
          // `ol-egov.141.89.2.39` ([D-628]): the notes the call drew from, as a production call reports.
          return {
            ...quizResult(request.conceptName),
            inputNotes: await notesFor(request.conceptName),
          };
        },
      });

    // Day one: the written assessment is nearest, so course A asks for cards.
    const first = await sweep([landed(NOTE_ONE)]);
    expect(first.courseKinds).toEqual([
      { courseCode: A, kind: 'qa', asked: 'qa', reason: 'format-class' },
    ]);
    expect(cardAsks.sort()).toEqual(['Alpha', 'Gamma']);
    expect(quizAsks).toEqual([]);

    // She accepts Alpha's card and answers it; Gamma's stays pending.
    const alpha = (await cache.listPending()).find((r) => r.conceptName === 'Alpha');
    if (alpha === undefined) throw new Error('no card drafted for Alpha');
    await createDraftAcceptPort({ vault, cache, deviceId: 'device-a' }).accept(
      alpha.draftId,
      'accepted',
    );
    const accepted = await cache.get(alpha.draftId);
    expect(accepted?.status).toBe('accepted');
    const instrumentId = accepted?.instrumentId;
    if (instrumentId === undefined) throw new Error('the accept stamped no instrument id');
    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-01-10T10:00:00+00:00',
        instrumentId,
        instrumentType: 'qa',
        conceptIds: ['key-Alpha'],
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      },
      { deviceId: 'device-a', generateEventId: () => 'event-alpha' },
    );
    const homeNote = accepted?.sourcePath ?? '';
    const cardBlocks = parseCards((await vault.read(homeNote)) as string);
    expect(cardBlocks).toHaveLength(1);

    // The written assessment passes: the exam is nearest, so the course now asks for multiple choice.
    today = new Date('2026-01-21T09:00:00');
    candidates = [...candidates, concept('Beta', NOTE_TWO)];
    const records = await cache.list();
    const before = await snapshot(vault);
    const logBefore = (await readReviewLogHistory(vault)).entries;

    const second = await sweep([landed(NOTE_TWO)]);

    expect(second.courseKinds).toEqual([
      { courseCode: A, kind: 'mcq', asked: 'mcq', reason: 'format-class' },
    ]);
    expect(second).toMatchObject({ attempted: 1, drafted: 1, skippedDuplicate: 2 });
    // Neither drafted concept is asked again, under either kind.
    expect(cardAsks.sort()).toEqual(['Alpha', 'Gamma']);
    expect(quizAsks).toEqual(['Beta']);

    // Every file the vault held is byte for byte what it was, the draft index alone excepted.
    const after = await snapshot(vault);
    for (const [path, text] of before) {
      if (path === '.olea/drafts/index.json') continue;
      expect(after.get(path), path).toBe(text);
    }
    // The accepted card and its block, and the pending card, are the same records.
    for (const record of records) expect(await cache.get(record.draftId)).toEqual(record);
    expect(parseCards((await vault.read(homeNote)) as string)).toEqual(cardBlocks);
    // Her answer is the same evidence, on the same instrument id: nothing to re-score.
    expect((await readReviewLogHistory(vault)).entries).toEqual(logBefore);
    // (her accept verdict and her review, both on the card she kept)
    const loggedIds = logBefore.map((e) => ('instrumentId' in e ? e.instrumentId : undefined));
    expect(new Set(loggedIds)).toEqual(new Set([instrumentId]));
    expect(logBefore.filter((e) => e.kind === 'review')).toHaveLength(1);

    // The new concept is drafted as multiple choice, beside the note that landed.
    const beta = (await cache.listPending()).find((r) => r.conceptName === 'Beta');
    expect(beta?.instrumentType).toBeUndefined();
    expect(beta?.question).toBeDefined();
    expect(beta?.sourcePath).not.toBe(homeNote);
    expect((await cache.listPending()).map((r) => r.conceptName).sort()).toEqual(['Beta', 'Gamma']);
  });

  it('back the other way: multiple choice drafted under a recall-style nearest stays when a written one comes next', async () => {
    const vault = new MemoryVaultSource({ [NOTE_ONE]: '# Week 1\n\nher prose\n' });
    const cache = createVaultDraftCacheStore(vault);
    const notesFor = (_name: string) => currentInputNotes(vault, NOTE_ONE);
    const assessments = [
      { ...ASSESSMENTS[1], due: '2026-01-15' },
      { ...ASSESSMENTS[0], due: '2026-02-15' },
    ] as typeof ASSESSMENTS;
    let today = '2026-01-10';
    const asks: string[] = [];
    const sweep = () =>
      runGenerationSweep([landed(NOTE_ONE)], {
        vault,
        cache,
        draftDeps: {} as never,
        listConceptsForCourse: async () => [concept('Alpha', NOTE_ONE)],
        kindInputsFor: deriveKindInputs({ assessments, reviewLog: [], today: today as never })
          .kindInputsFor,
        cardDraftDeps: {} as DraftCardsDeps,
        draftCardForConcept: async (_d, request) => {
          asks.push(`qa:${request.conceptName}`);
          // `ol-egov.141.89.2.39` ([D-628]): the notes the call drew from, as a production call reports.
          return {
            ...cardResult(request.conceptName),
            inputNotes: await notesFor(request.conceptName),
          };
        },
        draftForConcept: async (_d, request) => {
          asks.push(`mcq:${request.conceptName}`);
          // `ol-egov.141.89.2.39` ([D-628]): the notes the call drew from, as a production call reports.
          return {
            ...quizResult(request.conceptName),
            inputNotes: await notesFor(request.conceptName),
          };
        },
      });

    expect((await sweep()).courseKinds[0]).toMatchObject({ kind: 'mcq', reason: 'format-class' });
    const drafted = await cache.list();
    const before = await snapshot(vault);
    today = '2026-01-16';
    const second = await sweep();
    expect(second.courseKinds[0]).toMatchObject({ kind: 'qa', reason: 'format-class' });
    expect(second).toMatchObject({ attempted: 0, skippedDuplicate: 1 });
    expect(asks).toEqual(['mcq:Alpha']);
    expect(await snapshot(vault)).toEqual(before);
    expect(await cache.list()).toEqual(drafted);
  });
});
