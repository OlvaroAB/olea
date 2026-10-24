/**
 * `[D-549]` (`ol-egov.141.89.105.8`; David, 2026-10-20, option (a)): the assessment format chooses a
 * concept's first instrument and the knowledge classification guides what follows. In the sweep:
 * routing never passes a concept over (an unclassified concept, or one whose quiz share reads
 * covered, still gets its first call, or a refusal with its stated reason), the label never changes
 * the course's first kind, and the label is kept in process for the further-call triggers.
 * Scenarios: `features/F3-learn-from-anything.md`, "The format chooses the first kind; the kind of
 * knowledge orders what follows". Courses are lettered; every fixture is invented.
 */
import { GOVERNING_FRESH_FOR_SECONDS, GOVERNING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import type {
  ConceptRecord,
  ExtractedUnit,
  KnowledgeKind,
  KnowledgeKindClassifierPort,
  PrimaryKindInput,
} from 'olea-core';
import { extractConcepts, KnowledgeKindClassifierUnavailableError } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftCardsDeps, DraftCardsResult } from '../../src/generation/draft-cards.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import { KnowledgeKindLabels, knowledgeKindLabelsFor } from '../../src/generation/routing.js';
import { enqueueFurtherGenerationCallsForCourse } from '../../src/ingestion/further-generation-triggers.js';
import { describeRefusal } from '../../src/retrieval/draft-cards-copy.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';
import { SYNTHETIC_INPUT_FILES, SYNTHETIC_INPUT_NOTES } from './input-notes-fixture.js';

const COURSE = 'COURSE-A';
const LECTURE = `01 Courses/${COURSE}/Lecture 1.md`;
const CONCEPT_NOTE = `01 Courses/${COURSE}/Concepts.md`;
const PDF = `01 Courses/${COURSE}/paper.pdf`;

const unit: ExtractedUnit = {
  text: 'unused by the sweep',
  provenance: {
    sourcePath: 'some-lecture.pdf',
    location: { page: 1, charRange: { start: 0, end: 1 } },
    embeddedIn: { notePath: LECTURE, blockStart: 0, blockEnd: 10 },
  },
};

function concept(name: string, sourcePaths: readonly string[] = [CONCEPT_NOTE]): ConceptRecord {
  return { key: `key-${name}`, name, tier: 2, courses: [COURSE], sourcePaths };
}

const quizResult = (name: string): DraftQuizCardsResult => ({
  status: 'drafted',
  inputNotes: SYNTHETIC_INPUT_NOTES,
  request: { courseCode: COURSE, conceptName: name, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: {
      questions: [{ stem: name, correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'x' }],
    },
  },
});

const cardResult = (name: string): DraftCardsResult => ({
  status: 'drafted',
  inputNotes: SYNTHETIC_INPUT_NOTES,
  request: { courseCode: COURSE, conceptName: name, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.10.0', modelId: 'test-model' },
    result: { cards: [{ front: `What is ${name}?`, back: `${name} answer`, subject: name }] },
  },
});

/** A classifier answering per concept name; a name it does not know is declined. */
function classifierBy(
  labels: Readonly<Record<string, KnowledgeKind | 'unclassified' | 'unavailable'>>,
): KnowledgeKindClassifierPort & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async classify(request) {
      calls.push(request.conceptName);
      const label = labels[request.conceptName] ?? 'unclassified';
      if (label === 'unavailable') throw new KnowledgeKindClassifierUnavailableError('offline');
      return { kind: label, confidence: 0.9 };
    },
  };
}

const QA: PrimaryKindInput = { formatMatch: 'qa', recordedPreference: [] };
const MCQ: PrimaryKindInput = { formatMatch: 'mcq', recordedPreference: [] };

describe('[D-549]: routing never passes a concept over in the sweep (ol-egov.141.89.105.8)', () => {
  it('three concepts that route unclassified are all asked within the cap: one drafted, two refused with their stated reasons, and the refusal memory holds or re-asks each by its kind', async () => {
    const vault = new MemoryVaultSource({
      ...SYNTHETIC_INPUT_FILES,
      [LECTURE]: '# Lecture 1\n',
      [CONCEPT_NOTE]: '---\ncourse: COURSE-A\n---\n\nSome prose of hers.\n',
      [PDF]: '%PDF-1.7',
    });
    const cache = createVaultDraftCacheStore(vault);
    const classifier = classifierBy({ Alpha: 'unclassified', Beta: 'unavailable' });
    const concepts = [concept('Alpha'), concept('Beta'), concept('Gamma', [PDF])];
    const asks: string[] = [];
    const sweep = () =>
      runGenerationSweep([unit], {
        vault,
        cache,
        draftDeps: {} as never,
        listConceptsForCourse: async () => concepts,
        draftForConcept: async (_deps, request) => {
          asks.push(request.conceptName);
          if (request.conceptName === 'Beta')
            return { status: 'refused', reason: 'judge-rejected' };
          if (request.conceptName === 'Gamma') return { status: 'refused', reason: 'no-hits' };
          return quizResult(request.conceptName);
        },
        routing: { classifier },
      });

    const first = await sweep();
    expect(asks).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(first).toMatchObject({
      attempted: 3,
      drafted: 1,
      refused: 2,
      skippedRouting: 0,
      skippedRefused: 0,
    });
    expect(first.refusals).toEqual([
      {
        courseCode: COURSE,
        conceptName: 'Beta',
        reason: 'judge-rejected',
        copy: describeRefusal('judge-rejected'),
      },
      {
        courseCode: COURSE,
        conceptName: 'Gamma',
        reason: 'no-hits',
        copy: describeRefusal('no-hits'),
      },
    ]);
    // Every one routed unclassified: the classifier declined Alpha, could not be reached for Beta,
    // and was never called for Gamma, whose only source is a PDF with nothing to read.
    expect(classifier.calls).toEqual(['Alpha', 'Beta']);
    expect(first.routingObservations).toEqual([
      { consulted: true, kind: null, deficit: 0, generated: true },
      { consulted: true, kind: null, deficit: 0, generated: true },
      { consulted: true, kind: null, deficit: 0, generated: true },
    ]);

    // Unchanged evidence: the checked refusal is held and still stated; the retryable one is asked again.
    asks.length = 0;
    const second = await sweep();
    expect(asks).toEqual(['Gamma']);
    expect(second).toMatchObject({
      attempted: 1,
      refused: 1,
      skippedDuplicate: 1,
      skippedRefused: 1,
      skippedRouting: 0,
    });
    expect(second.refusals.map((r) => [r.conceptName, r.reason])).toEqual([
      ['Beta', 'judge-rejected'],
      ['Gamma', 'no-hits'],
    ]);
  });

  it("a fact whose quiz share is already covered by an item of her own still gets its first call, through the course's first kind", async () => {
    const vault = new MemoryVaultSource({
      [LECTURE]: '# Lecture 1\n',
      [CONCEPT_NOTE]: [
        '---',
        'topic: [Working memory]',
        `course: ${COURSE}`,
        '---',
        '',
        'A short-term store.',
        '',
        '```olea-mcq',
        'stem: Which structure is it?',
        'answer: The right one',
        'distractor: d1',
        'distractor: d2',
        'distractor: d3',
        'distractor: d4',
        'feedback: Because of the thing.',
        '```',
        '',
      ].join('\n'),
    });
    const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
      (c) => c.name === 'Working memory',
    )?.key;
    if (key === undefined) throw new Error('fixture concept not found');
    const cache = createVaultDraftCacheStore(vault);
    const quizAsks: string[] = [];
    const cardAsks: string[] = [];

    const report = await runGenerationSweep([unit], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [
        { key, name: 'Working memory', tier: 2, courses: [COURSE], sourcePaths: [CONCEPT_NOTE] },
      ],
      draftForConcept: async (_deps, request) => {
        quizAsks.push(request.conceptName);
        return quizResult(request.conceptName);
      },
      // Standing in for course C, whose nearest assessment is recall-style: multiple choice first.
      kindInputsFor: () => MCQ,
      cardDraftDeps: {} as DraftCardsDeps,
      draftCardForConcept: async (_deps, request) => {
        cardAsks.push(request.conceptName);
        return cardResult(request.conceptName);
      },
      routing: { classifier: classifierBy({ 'Working memory': 'fact' }) },
    });

    expect(quizAsks).toEqual(['Working memory']);
    expect(cardAsks).toEqual([]);
    expect(report).toMatchObject({ attempted: 1, drafted: 1, skippedRouting: 0 });
    // A fact's quiz floor is one item, and her own item meets it: a zero deficit, and the call made.
    expect(report.routingObservations).toEqual([
      { consulted: true, kind: 'fact', deficit: 0, generated: true },
    ]);
    expect(report.courseKinds).toEqual([
      { courseCode: COURSE, kind: 'mcq', asked: 'mcq', reason: 'format-class' },
    ]);
  });

  it('the label never changes the first kind: a written course drafts a fact and a category as cards alike', async () => {
    const vault = new MemoryVaultSource({
      [LECTURE]: '# Lecture 1\n',
      [CONCEPT_NOTE]: '---\ncourse: COURSE-A\n---\n\nSome prose of hers.\n',
    });
    const cache = createVaultDraftCacheStore(vault);
    const quizAsks: string[] = [];
    const cardAsks: string[] = [];

    const report = await runGenerationSweep([unit], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Alpha'), concept('Beta')],
      draftForConcept: async (_deps, request) => {
        quizAsks.push(request.conceptName);
        return quizResult(request.conceptName);
      },
      // Course A's nearest assessment is written: its first kind is a question-and-answer card.
      kindInputsFor: () => QA,
      cardDraftDeps: {} as DraftCardsDeps,
      draftCardForConcept: async (_deps, request) => {
        cardAsks.push(request.conceptName);
        return cardResult(request.conceptName);
      },
      routing: { classifier: classifierBy({ Alpha: 'fact', Beta: 'category' }) },
    });

    expect(cardAsks).toEqual(['Alpha', 'Beta']);
    expect(quizAsks).toEqual([]);
    expect((await cache.listPending()).map((d) => d.instrumentType)).toEqual(['qa', 'qa']);
    expect(report.courseKinds).toEqual([
      { courseCode: COURSE, kind: 'qa', asked: 'qa', reason: 'format-class' },
    ]);
    // The recall group the cards spend on: dominant (3) for a fact, the floor (1) for a category.
    expect(report.routingObservations).toEqual([
      { consulted: true, kind: 'fact', deficit: 3, generated: true },
      { consulted: true, kind: 'category', deficit: 1, generated: true },
    ]);
  });
});

describe('[D-549]: the sweep keeps each label for the further calls, in process only (ol-egov.141.89.105.8)', () => {
  it('the further-call triggers read the labels the session’s sweep kept, and order each concept’s next kind by them', async () => {
    const lecture = '# Lecture 1\n';
    const note = '---\ncourse: COURSE-A\n---\n\nSome prose of hers.\n';
    const vault = new MemoryVaultSource({ [LECTURE]: lecture, [CONCEPT_NOTE]: note });
    const cache = createVaultDraftCacheStore(vault);
    const alpha = concept('Alpha');
    const beta = concept('Beta');

    await runGenerationSweep([unit], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [alpha, beta],
      kindInputsFor: () => QA,
      cardDraftDeps: {} as DraftCardsDeps,
      draftCardForConcept: async (_deps, request) => cardResult(request.conceptName),
      routing: { classifier: classifierBy({ Alpha: 'category' }) },
    });

    const labels = knowledgeKindLabelsFor(vault);
    expect(labels.kindFor(COURSE, alpha.key)).toBe('category');
    expect(labels.kindFor(COURSE, beta.key)).toBeNull();
    expect(labels.has(COURSE, beta.key)).toBe(true);
    // Nothing beyond the drafts was written: her notes are byte-identical, and every new path is Olea's.
    expect(await vault.read(LECTURE)).toBe(lecture);
    expect(await vault.read(CONCEPT_NOTE)).toBe(note);
    expect(
      (await vault.list())
        .filter((path) => path !== LECTURE && path !== CONCEPT_NOTE)
        .every((path) => path.startsWith('.olea/drafts/')),
    ).toBe(true);

    // Later in the session, both concepts enter the top band.
    const enqueued: Record<string, unknown>[] = [];
    await enqueueFurtherGenerationCallsForCourse(COURSE, {
      vault,
      studyPlanStore: {
        async load() {
          return {
            envelopeVersion: 1,
            kind: 'study-plan',
            bodyVersion: 2,
            policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
            computedAt: '2026-09-26T08:00:00.000Z',
            freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
            governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
            body: {
              asOf: '2026-09-26',
              courses: [
                {
                  course: COURSE,
                  status: 'ranked',
                  concepts: [alpha.key, beta.key, 'f3', 'f4', 'f5', 'f6'].map((id, index) => ({
                    conceptId: id,
                    rank: index + 1,
                    weight: 1 / (index + 1),
                    examProximityDays: null,
                    reasoning: 'r',
                    citations: [
                      { basis: 'past-paper' as const, sourcePath: 'p.md', questionLabel: '1' },
                    ],
                  })),
                },
              ],
            },
          };
        },
        async save() {},
      },
      enqueuer: {
        async enqueue(input) {
          enqueued.push(input.payload as Record<string, unknown>);
          return { status: 'queued' };
        },
      },
      listConceptsForCourse: async () => [alpha, beta],
      formatMatchFor: () => 'qa',
      now: () => new Date('2026-09-26T09:00:00.000Z'),
    });

    // Each pending card is a built kind; the category asks for multiple choice, the unlabelled
    // concept for the recall kind still unbuilt.
    expect(enqueued.map((p) => [p.conceptKey, p.instrumentKind])).toEqual([
      [alpha.key, 'mcq'],
      [beta.key, 'cloze'],
    ]);
  });

  it('a later unclassified reading of a labelled concept keeps the label it had', async () => {
    const vault = new MemoryVaultSource({
      [LECTURE]: '# Lecture 1\n',
      [CONCEPT_NOTE]: '---\ncourse: COURSE-A\n---\n\nSome prose of hers.\n',
    });
    const cache = createVaultDraftCacheStore(vault);
    const labels = new KnowledgeKindLabels();
    const sweep = (classifier: KnowledgeKindClassifierPort | null) =>
      runGenerationSweep([unit], {
        vault,
        cache,
        draftDeps: {} as never,
        listConceptsForCourse: async () => [concept('Alpha')],
        // A retryable refusal: the concept is asked again on the next sweep.
        draftForConcept: async () => ({ status: 'refused', reason: 'no-hits' }),
        routing: { classifier },
        knowledgeKindLabels: labels,
      });

    await sweep(classifierBy({ Alpha: 'principle' }));
    expect(labels.kindFor(COURSE, 'key-Alpha')).toBe('principle');
    // The next sweep finds the classifier offline: unclassified for routing, the label kept.
    const report = await sweep(classifierBy({ Alpha: 'unavailable' }));
    expect(report.routingObservations[0]?.kind).toBeNull();
    expect(labels.kindFor(COURSE, 'key-Alpha')).toBe('principle');
    // An explicit labels instance is used instead of the vault's default one.
    expect(knowledgeKindLabelsFor(vault).has(COURSE, 'key-Alpha')).toBe(false);
  });

  it('without routing nothing is classified or kept, and every candidate is still asked', async () => {
    const vault = new MemoryVaultSource({ [LECTURE]: '# Lecture 1\n' });
    const cache = createVaultDraftCacheStore(vault);
    const report = await runGenerationSweep([unit], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Alpha'), concept('Beta')],
      draftForConcept: async (_deps, request) => quizResult(request.conceptName),
    });
    expect(report).toMatchObject({ attempted: 2, drafted: 2, skippedRouting: 0 });
    expect(knowledgeKindLabelsFor(vault).has(COURSE, 'key-Alpha')).toBe(false);
  });
});
