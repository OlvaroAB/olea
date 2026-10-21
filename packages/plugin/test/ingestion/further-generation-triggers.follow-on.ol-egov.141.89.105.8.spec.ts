/**
 * `[D-549]` (`ol-egov.141.89.105.8`): the further-call triggers order a concept's next kinds by its
 * kind of knowledge (its routed mix's group deficits, against its materialised instruments and its
 * pending drafts), never removing a kind, and count a cached draft of any status as a built kind
 * (`docs/dev/intelligence-build/instrument-primary-call-owner.md` section 6 item d, in the service
 * repo). Scenarios: `features/F3-learn-from-anything.md`, "A concept's next kinds follow its kind of
 * knowledge, and a cached draft is a built kind". Courses are lettered; every fixture is invented.
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import { GOVERNING_FRESH_FOR_SECONDS, GOVERNING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import type {
  ConceptRecord,
  EnqueueInput,
  EnqueueResult,
  KnowledgeKind,
  StudyPlanStore,
} from 'olea-core';
import { provisionalConceptKey, routeKnowledgeKind } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { knowledgeKindLabelsFor } from '../../src/generation/routing.js';
import type { DraftRecord, DraftStatus } from '../../src/generation/types.js';
import { enqueueFurtherGenerationCallsForCourse } from '../../src/ingestion/further-generation-triggers.js';
import { MemoryVaultSource } from '../generation/fakes.js';

const NOW = new Date('2026-09-26T09:00:00.000Z');
const COURSE_A = 'COURSE-A';
const COURSE_C = 'COURSE-C';

class RecordingEnqueuer {
  readonly calls: EnqueueInput[] = [];
  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    this.calls.push(input);
    return { status: 'queued' };
  }
}

/** A concept with no bound note: its key is the provisional one the vault's instrument walk files it under. */
function concept(name: string, course: string): ConceptRecord {
  return {
    name,
    key: provisionalConceptKey({ name, boundNotePath: null }),
    tier: 2,
    courses: [course],
    sourcePaths: [`01 Courses/${course}/notes.md`],
  };
}

const store = (plan: StudyPlanEnvelope | null): StudyPlanStore => ({
  async load() {
    return plan;
  },
  async save() {
    /* unused */
  },
});

/**
 * `keys` at ranks 1..n with fillers after them, enough that every named key sits in the top band
 * (`isRankInTopBand`: the first `ceil(total / 3)` ranks).
 */
function topBandPlan(course: string, keys: readonly string[]): StudyPlanEnvelope {
  const total = keys.length * 3;
  const ranked = Array.from({ length: total }, (_, index) => ({
    conceptId: keys[index] ?? `filler-${index}`,
    rank: index + 1,
    weight: 1 / (index + 1),
    examProximityDays: null,
    reasoning: 'r',
    citations: [{ basis: 'past-paper' as const, sourcePath: 'papers/p1.md', questionLabel: '1' }],
  }));
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: 2,
    policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
    computedAt: '2026-09-26T08:00:00.000Z',
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
    body: { asOf: '2026-09-26', courses: [{ course, status: 'ranked', concepts: ranked }] },
  };
}

let draftSequence = 0;
/** A cached draft as the sweep writes it: a card for `'qa'`, a multiple-choice question otherwise. */
function draft(
  course: string,
  of: ConceptRecord,
  kind: 'qa' | 'mcq',
  status: DraftStatus = 'pending',
): DraftRecord {
  draftSequence += 1;
  return {
    draftId: `draft-${draftSequence}`,
    status,
    courseCode: course,
    conceptName: of.name,
    conceptIds: [of.key],
    sourcePath: `01 Courses/${course}/notes.md`,
    createdAt: '2026-09-25T09:00:00.000Z',
    ...(kind === 'qa'
      ? { instrumentType: 'qa' as const, card: { front: 'A front', back: 'A back' } }
      : {
          question: {
            stem: 'A stem',
            correctAnswer: 'A',
            distractors: ['B', 'C', 'D'],
            feedback: 'because',
          },
        }),
    provenance: { taskId: 'cards.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
  };
}

async function withDrafts(vault: MemoryVaultSource, drafts: readonly DraftRecord[]): Promise<void> {
  const cache = createVaultDraftCacheStore(vault);
  for (const record of drafts) await cache.put(record);
}

/** Three reviews of a cloze item elsewhere in the vault: her observed order puts cloze first (D7.1). */
function clozeFirstHistory(): string {
  return ['e1', 'e2', 'e3']
    .map((eventId) =>
      JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId,
        timestamp: '2026-09-20T09:00:00+00:00',
        instrumentId: 'other-inst-1',
        instrumentType: 'cloze',
        conceptIds: ['some-other-concept'],
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['cloze'],
          planVersion: null,
        },
      }),
    )
    .join('\n');
}

function asked(enqueuer: RecordingEnqueuer): readonly Record<string, unknown>[] {
  return enqueuer.calls.map((call) => call.payload as Record<string, unknown>);
}

describe('[D-549]: the kind of knowledge orders a concept’s next kinds (ol-egov.141.89.105.8)', () => {
  it('a category and a principle ask for multiple choice next; a fact and an unlabelled concept ask for the recall kind still unbuilt', async () => {
    const fact = concept('Fact one', COURSE_A);
    const category = concept('Category one', COURSE_A);
    const principle = concept('Principle one', COURSE_A);
    const unlabelled = concept('Unlabelled one', COURSE_A);
    const vault = new MemoryVaultSource();
    await withDrafts(
      vault,
      [fact, category, principle, unlabelled].map((c) => draft(COURSE_A, c, 'qa')),
    );
    const labels = knowledgeKindLabelsFor(vault);
    const label = (of: ConceptRecord, kind: KnowledgeKind) =>
      labels.record(COURSE_A, of.key, {
        status: 'classified',
        kind,
        confidence: 0.9,
        method: 'model',
      });
    label(fact, 'fact');
    label(category, 'category');
    label(principle, 'principle');

    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE_A, {
      vault,
      studyPlanStore: store(
        topBandPlan(COURSE_A, [fact.key, category.key, principle.key, unlabelled.key]),
      ),
      enqueuer,
      listConceptsForCourse: async () => [fact, category, principle, unlabelled],
      // Course A's written assessment names question-and-answer, already drafted for each.
      formatMatchFor: () => 'qa',
      now: () => NOW,
    });

    expect(asked(enqueuer)).toEqual([
      expect.objectContaining({
        conceptKey: fact.key,
        instrumentKind: 'cloze',
        trigger: 'top-band',
      }),
      expect.objectContaining({
        conceptKey: category.key,
        instrumentKind: 'mcq',
        trigger: 'top-band',
      }),
      expect.objectContaining({
        conceptKey: principle.key,
        instrumentKind: 'mcq',
        trigger: 'top-band',
      }),
      expect.objectContaining({
        conceptKey: unlabelled.key,
        instrumentKind: 'cloze',
        trigger: 'top-band',
      }),
    ]);
    // The pending card counts as built: question-and-answer is asked for no concept.
    expect(asked(enqueuer).some((payload) => payload.instrumentKind === 'qa')).toBe(false);
    // The principle's weighted group, explain-back, is never written ahead (F2.14).
    expect(asked(enqueuer).some((payload) => payload.instrumentKind === 'explain-back')).toBe(
      false,
    );
  });

  it('a fact whose recall share is met by its pending cards asks for multiple choice: the deficits order, not the label alone', async () => {
    const fact = concept('Fact one', COURSE_A);
    const vault = new MemoryVaultSource();
    // `fact` is recall-dominant (three steps): three pending cards meet it, one did not above.
    await withDrafts(
      vault,
      [1, 2, 3].map(() => draft(COURSE_A, fact, 'qa')),
    );
    knowledgeKindLabelsFor(vault).record(COURSE_A, fact.key, {
      status: 'classified',
      kind: 'fact',
      confidence: 0.9,
      method: 'model',
    });

    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE_A, {
      vault,
      studyPlanStore: store(topBandPlan(COURSE_A, [fact.key])),
      enqueuer,
      listConceptsForCourse: async () => [fact],
      formatMatchFor: () => 'qa',
      now: () => NOW,
    });

    expect(asked(enqueuer)).toEqual([
      expect.objectContaining({ conceptKey: fact.key, instrumentKind: 'mcq', trigger: 'top-band' }),
    ]);
  });

  it('a category gets more quizzes even where her rating history would put cloze first; with no label her history keeps the order', async () => {
    const run = async (kind: KnowledgeKind | null) => {
      const category = concept('Category one', COURSE_A);
      const vault = new MemoryVaultSource({
        '.olea/reviews/2026-09-20-device-1.jsonl': clozeFirstHistory(),
      });
      await withDrafts(vault, [draft(COURSE_A, category, 'qa')]);
      const enqueuer = new RecordingEnqueuer();
      await enqueueFurtherGenerationCallsForCourse(COURSE_A, {
        vault,
        studyPlanStore: store(topBandPlan(COURSE_A, [category.key])),
        enqueuer,
        listConceptsForCourse: async () => [category],
        formatMatchFor: () => 'qa',
        // The composition's own label source, supplied explicitly here.
        knowledgeKindFor: async () => kind,
        now: () => NOW,
      });
      return asked(enqueuer).map((payload) => [payload.trigger, payload.instrumentKind]);
    };

    expect(await run('category')).toEqual([['top-band', 'mcq']]);
    expect(await run(null)).toEqual([['top-band', 'cloze']]);
  });

  it('an unknown classification never blocks a further call: with both recall kinds built, multiple choice is asked although the unclassified mix gives it no share', async () => {
    const name = 'Unlabelled one';
    const unlabelled = concept(name, COURSE_A);
    const vault = new MemoryVaultSource({
      [`01 Courses/${COURSE_A}/notes.md`]: [
        '---',
        `topic: ${name}`,
        `course: ${COURSE_A}`,
        '---',
        '',
        'A front of hers::A back of hers',
        '',
        'Grains are ==sorted== by flow.',
        '',
      ].join('\n'),
    });
    expect(routeKnowledgeKind(null).quiz).toBe('none');

    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE_A, {
      vault,
      studyPlanStore: store(topBandPlan(COURSE_A, [unlabelled.key])),
      enqueuer,
      listConceptsForCourse: async () => [unlabelled],
      now: () => NOW,
    });

    expect(asked(enqueuer)).toEqual([
      expect.objectContaining({
        conceptKey: unlabelled.key,
        instrumentKind: 'mcq',
        trigger: 'top-band',
      }),
    ]);
  });
});

describe('[D-549]: a cached draft of any status is a built kind (ol-egov.141.89.105.8, item d)', () => {
  it('a pending multiple-choice draft is not asked for again, its top-band call names the next kind, and a rejected card draft is never asked for again', async () => {
    const pending = concept('Pending one', COURSE_C);
    const rejected = concept('Rejected one', COURSE_C);
    const vault = new MemoryVaultSource();
    await withDrafts(vault, [
      draft(COURSE_C, pending, 'mcq', 'pending'),
      draft(COURSE_C, rejected, 'qa', 'rejected'),
    ]);

    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE_C, {
      vault,
      studyPlanStore: store(topBandPlan(COURSE_C, [pending.key, rejected.key])),
      enqueuer,
      listConceptsForCourse: async () => [pending, rejected],
      // Course C's recall-style assessment names multiple choice.
      formatMatchFor: () => 'mcq',
      now: () => NOW,
    });

    const forPending = asked(enqueuer).filter((payload) => payload.conceptKey === pending.key);
    const forRejected = asked(enqueuer).filter((payload) => payload.conceptKey === rejected.key);
    // No second route to a first call: format-ask does not ask for the drafted kind.
    expect(forPending).toEqual([
      expect.objectContaining({ instrumentKind: 'qa', trigger: 'top-band' }),
    ]);
    expect(forRejected.some((payload) => payload.instrumentKind === 'qa')).toBe(false);
    expect(forRejected.map((payload) => [payload.trigger, payload.instrumentKind])).toEqual([
      ['top-band', 'cloze'],
      ['format-ask', 'mcq'],
    ]);
  });

  it('only this course’s drafts count, and a draft cache that cannot be read counts none without throwing', async () => {
    const shared = concept('Shared one', COURSE_C);
    const vault = new MemoryVaultSource();
    // Another course's draft of the same concept is not this course's call.
    await withDrafts(vault, [draft(COURSE_A, shared, 'mcq')]);
    const enqueuer = new RecordingEnqueuer();
    await enqueueFurtherGenerationCallsForCourse(COURSE_C, {
      vault,
      studyPlanStore: store(null),
      enqueuer,
      listConceptsForCourse: async () => [shared],
      formatMatchFor: () => 'mcq',
      now: () => NOW,
    });
    expect(asked(enqueuer)).toEqual([
      expect.objectContaining({
        conceptKey: shared.key,
        instrumentKind: 'mcq',
        trigger: 'format-ask',
      }),
    ]);

    const failing = new RecordingEnqueuer();
    await expect(
      enqueueFurtherGenerationCallsForCourse(COURSE_C, {
        vault,
        studyPlanStore: store(null),
        enqueuer: failing,
        listConceptsForCourse: async () => [shared],
        formatMatchFor: () => 'mcq',
        draftCache: {
          async list() {
            throw new Error('unreadable');
          },
        },
        now: () => NOW,
      }),
    ).resolves.toBeUndefined();
    expect(asked(failing)).toEqual([
      expect.objectContaining({
        conceptKey: shared.key,
        instrumentKind: 'mcq',
        trigger: 'format-ask',
      }),
    ]);
  });
});
