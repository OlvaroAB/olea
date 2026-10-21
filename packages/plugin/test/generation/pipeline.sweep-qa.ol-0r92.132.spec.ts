/**
 * Sweep-drafted Q&A cards (`ol-0r92.132`, held Class C; `[D-439]` points 2-5).
 *
 * Pins: the sweep drafts through `cards.generate.v1` only where the format-routing's own answer
 * (`primaryKindFor`) is `'qa'` AND the composition supplied the card supplier; every other case is
 * the quiz path, request for request. No quota, no per-concept kind, no cloze generator. The card
 * lands as the same `DraftRecord` (provenance, citation, hash, demand, dedupe) and accepts through
 * the card materializer. Self-rated success is not asserted here: nothing about evidence folding
 * changes in this lane.
 */
import type { ConceptRecord, ExtractedUnit, PrimaryKindInput } from 'olea-core';
import { parseCards } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftCardsDeps, DraftCardsResult } from '../../src/generation/draft-cards.js';
import {
  demandRoutingCounterFor,
  draftDemandRefusalCounterFor,
  runGenerationSweep,
} from '../../src/generation/pipeline.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE = '01 Courses/COGS214/Week 2.md';
const NOTE_TEXT = '# Week 2\n\nher prose\n';

const concept = (name: string): ConceptRecord => ({
  key: `key-${name}`,
  name,
  tier: 2,
  courses: ['COGS214'],
  sourcePaths: [NOTE],
});

const unit: ExtractedUnit = {
  text: 'unused',
  provenance: {
    sourcePath: 'some-lecture.pdf',
    location: { page: 1, charRange: { start: 0, end: 1 } },
    embeddedIn: { notePath: NOTE, blockStart: 0, blockEnd: 10 },
  },
};

const QA: PrimaryKindInput = { formatMatch: 'qa', recordedPreference: [] };
const MCQ: PrimaryKindInput = { formatMatch: 'mcq', recordedPreference: [] };
const CLOZE: PrimaryKindInput = { formatMatch: 'cloze', recordedPreference: [] };
const NONE: PrimaryKindInput = { formatMatch: null, recordedPreference: [] };

const quizResult = (name: string): DraftQuizCardsResult => ({
  status: 'drafted',
  request: { courseCode: 'COGS214', conceptName: name, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: {
      questions: [{ stem: name, correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'x' }],
    },
  },
});

function cardResult(
  name: string,
  declared: readonly (string | undefined)[] = ['recall-a-fact'],
): DraftCardsResult {
  return {
    status: 'drafted',
    request: {
      courseCode: 'COGS214',
      conceptName: name,
      sourceChunks: ['chunk'],
      intendedDemand: 'recall-a-fact',
    },
    response: {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: '1.10.0', modelId: 'test-model' },
      result: {
        demandAcknowledgement: { intendedDemand: 'recall-a-fact' },
        cards: declared.map((word, index) => ({
          front: `What is ${name} ${index}?`,
          back: `${name} answer ${index}`,
          subject: name,
          ...(word === undefined ? {} : { declaredDemand: word }),
        })),
      },
    },
  };
}

function setup(options: {
  readonly kind?: PrimaryKindInput;
  readonly withCardDeps?: boolean;
  readonly cardOutcome?: (name: string) => DraftCardsResult;
}) {
  const vault = new MemoryVaultSource({ [NOTE]: NOTE_TEXT });
  const cache = createVaultDraftCacheStore(vault);
  const quizAsks: Record<string, unknown>[] = [];
  const cardAsks: Record<string, unknown>[] = [];
  const run = () =>
    runGenerationSweep([unit], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory')],
      draftForConcept: async (_d, request) => {
        quizAsks.push({ ...request });
        return quizResult(request.conceptName);
      },
      ...(options.kind === undefined
        ? {}
        : { kindInputsFor: () => options.kind as PrimaryKindInput }),
      ...(options.withCardDeps === false ? {} : { cardDraftDeps: {} as DraftCardsDeps }),
      draftCardForConcept: async (_d, request) => {
        cardAsks.push({ ...request });
        return (options.cardOutcome ?? cardResult)(request.conceptName);
      },
    });
  return { vault, cache, quizAsks, cardAsks, run };
}

describe('sweep Q&A cards: only where the format-routing chooses Q&A (ol-0r92.132)', () => {
  it('a Q&A course drafts through the card generator, never the quiz one, and caches a qa DraftRecord', async () => {
    const { cache, quizAsks, cardAsks, run } = setup({ kind: QA });
    const report = await run();

    expect(report).toMatchObject({ attempted: 1, drafted: 1, refused: 0 });
    expect(quizAsks).toEqual([]);
    expect(cardAsks).toHaveLength(1);
    // The same recall intent the quiz sweep sends, and no heading (the sweep's ask has no source).
    expect(cardAsks[0]).toMatchObject({ courseCode: 'COGS214', intendedDemand: 'recall-a-fact' });
    expect('requestedAsk' in (cardAsks[0] ?? {})).toBe(false);

    const [record] = await cache.listPending();
    expect(record).toMatchObject({
      status: 'pending',
      instrumentType: 'qa',
      conceptIds: ['key-Working memory'],
      sourcePath: NOTE,
      provenance: { taskId: 'cards.generate.v1', promptVersion: '1.10.0', modelId: 'test-model' },
      demand: { origin: 'sweep', intendedDemand: 'recall-a-fact' },
    });
    expect(record?.card).toEqual({
      front: 'What is Working memory 0?',
      back: 'Working memory answer 0',
    });
    expect(record?.question).toBeUndefined();
    expect(record?.sourceContentHash).toBeDefined();
    // Counted against the card generator's routing, once.
    expect(demandRoutingCounterFor(cache).counts()).toHaveLength(1);
  });

  it.each([
    ['mcq', MCQ],
    ['cloze (no generator exists; the quiz path is unchanged)', CLOZE],
    ['no known format and no preference (the mcq floor)', NONE],
  ])('%s keeps the quiz path and never calls the card generator', async (_label, kind) => {
    const { cache, quizAsks, cardAsks, run } = setup({ kind });
    await run();
    expect(cardAsks).toEqual([]);
    expect(quizAsks).toHaveLength(1);
    const [record] = await cache.listPending();
    expect(record?.card).toBeUndefined();
    expect(record?.instrumentType).toBeUndefined();
    expect(record?.question).toBeDefined();
  });

  it('a Q&A course with no card supplier, or no kind inputs, is the quiz path exactly', async () => {
    for (const options of [{ kind: QA, withCardDeps: false }, { withCardDeps: true }] as const) {
      const { quizAsks, cardAsks, run } = setup(options);
      await run();
      expect(cardAsks).toEqual([]);
      expect(quizAsks).toHaveLength(1);
    }
  });

  it('a card draft is deduped like a quiz draft: a second sweep asks nothing', async () => {
    const { cardAsks, run } = setup({ kind: QA });
    await run();
    const second = await run();
    expect(second).toMatchObject({ attempted: 0, skippedDuplicate: 1 });
    expect(cardAsks).toHaveLength(1);
  });

  it('a refused grounding caches nothing and is reported like a quiz refusal', async () => {
    const { cache, run } = setup({
      kind: QA,
      cardOutcome: () => ({ status: 'refused', reason: 'no-hits' }),
    });
    const report = await run();
    expect(report).toMatchObject({ attempted: 1, drafted: 0, refused: 1 });
    expect(report.refusals).toHaveLength(1);
    expect(await cache.listPending()).toEqual([]);
  });

  it('a card declaring a different demand than the one asked is an invalid draft: counted, not cached', async () => {
    const { cache, run } = setup({
      kind: QA,
      cardOutcome: (name) => cardResult(name, ['calculate']),
    });
    const report = await run();
    expect(await cache.listPending()).toEqual([]);
    expect(report.drafted).toBe(0);
    expect(draftDemandRefusalCounterFor(cache).total()).toBe(1);
  });

  it('an unparseable card reply caches nothing and the concept is revisited next sweep', async () => {
    const { cache, run } = setup({
      kind: QA,
      cardOutcome: (name) => ({
        ...cardResult(name),
        response: { ok: true, stamp: { promptVersion: '1.10.0', modelId: 'm' }, result: {} },
      }),
    });
    await run();
    expect(await cache.listPending()).toEqual([]);
    expect((await run()).attempted).toBe(1);
  });

  it('accepting the cached card writes one Q&A block into her note through the card materializer', async () => {
    const { vault, cache, run } = setup({ kind: QA });
    await run();
    const [record] = await cache.listPending();
    if (record === undefined) throw new Error('the sweep cached nothing');
    await createDraftAcceptPort({ vault, cache, deviceId: 'device-a' }).accept(
      record.draftId,
      'accepted',
    );
    const cards = parseCards(vault.raw(NOTE) ?? '');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ front: 'What is Working memory 0?' });
  });
});

describe('the sweep records the kind each course was drafted as, and why (ol-egov.141.89.105.9)', () => {
  const PREF: PrimaryKindInput = { formatMatch: null, recordedPreference: ['qa', 'mcq'] };
  const course = (kind: 'mcq' | 'qa', asked: string | null, reason: string) => [
    { courseCode: 'COGS214', kind, asked, reason },
  ];

  it.each([
    ['a known format', QA, course('qa', 'qa', 'format-class')],
    ['a known multiple-choice format', MCQ, course('mcq', 'mcq', 'format-class')],
    ['no format and no preference (the floor)', NONE, course('mcq', 'mcq', 'floor')],
    ['a recorded preference', PREF, course('qa', 'qa', 'recorded-preference')],
    [
      'cloze asked, multiple choice drafted',
      CLOZE,
      course('mcq', 'cloze', 'cloze-asked-multiple-choice-drafted'),
    ],
  ])('%s', async (_label, kind, expected) => {
    const { run } = setup({ kind });
    expect((await run()).courseKinds).toEqual(expected);
  });

  it('a Q&A course with no card supplier is drafted as multiple choice, and says the supplier is absent', async () => {
    const { run } = setup({ kind: QA, withCardDeps: false });
    expect((await run()).courseKinds).toEqual(course('mcq', 'qa', 'card-supplier-absent'));
  });

  it('with no kind inputs and no card supplier (every composition today) nothing was asked, and the reason is the absent supplier', async () => {
    const { run } = setup({ withCardDeps: false });
    expect((await run()).courseKinds).toEqual(course('mcq', null, 'card-supplier-absent'));
  });

  it('with a card supplier but no kind inputs nothing was asked, and multiple choice is the floor', async () => {
    const { run } = setup({});
    expect((await run()).courseKinds).toEqual(course('mcq', null, 'floor'));
  });
});
