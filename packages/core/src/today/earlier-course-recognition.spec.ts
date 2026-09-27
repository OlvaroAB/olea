/**
 * F8.7's derivation (`RECOG-1`, `[D-058]`, component register row 4.5).
 * Fixture ids are opaque (INV-3): no real course code or concept name
 * anywhere in this file.
 */
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptCourses } from '../insights/types.js';
import { attainmentArithmeticVersion } from '../mastery/attainment.js';
import {
  buildCourseCutoffRecord,
  type CourseCutoffRecord,
  parseCourseCutoffRecord,
  serializeCourseCutoffRecord,
} from './course-cutoff-record.js';
import {
  buildEarlierCourseRecognitions,
  recognitionArithmeticVersion,
} from './earlier-course-recognition.js';

function review(
  conceptId: string,
  day: string,
  eventId: string,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp: `${day}T20:00:00+00:00`,
    instrumentId: `qa:${conceptId}:1`,
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'good',
    wasUnsure: false,
    durationMs: 4_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

describe('buildEarlierCourseRecognitions', () => {
  it('recognises a concept shared between the new course and one already-set-up course', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];
    const entries = [review('c1', '2026-01-10', 'e1')];

    const result = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });

    expect(result).toHaveLength(1);
    expect(result[0]?.conceptId).toBe('c1');
    expect(result[0]?.earlierCourses).toEqual(['OLD1']);
    expect(result[0]?.evidence.reviewCount).toBe(1);
  });

  it('names every OTHER course sharing the concept, sorted, never narrowed to a single "the" earlier course', () => {
    const concepts: readonly ConceptCourses[] = [
      { conceptId: 'c1', courses: ['NEW1', 'OLD2', 'OLD1'] },
    ];
    const entries = [review('c1', '2026-01-10', 'e1')];

    const result = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });

    expect(result[0]?.earlierCourses).toEqual(['OLD1', 'OLD2']);
  });

  it('does not fire on a concept the new course alone holds', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1'] }];
    const entries = [review('c1', '2026-01-10', 'e1')];

    expect(buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts })).toEqual([]);
  });

  it('fires only on an identical concept id — two different ids sharing only wording never link', () => {
    // The practical ceiling (register row 4.5): no name/wording matching at
    // all. Two DIFFERENT concept ids, one per course, never produce a
    // recognition between them, however similar their evidence looks.
    const concepts: readonly ConceptCourses[] = [
      { conceptId: 'c-new', courses: ['NEW1'] },
      { conceptId: 'c-old', courses: ['OLD1'] },
    ];
    const entries = [review('c-new', '2026-01-10', 'e1'), review('c-old', '2025-01-10', 'e2')];

    expect(buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts })).toEqual([]);
  });

  it('does not fire on a concept shared across courses with no evidence at all', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];

    expect(buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries: [], concepts })).toEqual(
      [],
    );
  });

  it('an explain-back-only concept still counts as history, with reviewCount at zero', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];
    const entries = [review('c1', '2026-01-10', 'e1', { instrumentType: 'explain-back' })];

    const result = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });

    expect(result).toHaveLength(1);
    expect(result[0]?.evidence).toEqual({
      reviewCount: 0,
      explainedBack: true,
      lastCorrectAt: null,
    });
  });

  it('lastCorrectAt is the most recent SUCCESSFUL scored review, not merely the most recent one', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];
    const entries = [
      review('c1', '2026-01-05', 'e1', { rating: 'good' }),
      review('c1', '2026-01-10', 'e2', { rating: 'again' }), // most recent, but a lapse
    ];

    const result = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });

    expect(result[0]?.evidence.lastCorrectAt).toBe('2026-01-05T20:00:00+00:00');
  });

  it('reads the growth stage from the same rollup every other surface uses — nothing re-derived', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];
    const entries = [review('c1', '2026-01-10', 'e1', { rating: 'good' })];

    const result = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });

    // One scored success, one distinct day: below the spacing floor, so
    // `sprout` — the same state `computeConceptMastery` would report directly.
    expect(result[0]?.state).toBe('sprout');
  });

  it('vitality is null when the caller supplies none — an honest "not read", never a fabricated default', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];
    const entries = [review('c1', '2026-01-10', 'e1')];

    const result = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });

    expect(result[0]?.vitality).toBeNull();
  });

  it('is pure: same input, same output, and the input is untouched', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];
    const entries = [review('c1', '2026-01-10', 'e1')];
    const snapshot = JSON.stringify({ entries, concepts });

    const first = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });
    const second = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });

    expect(second).toEqual(first);
    expect(JSON.stringify({ entries, concepts })).toBe(snapshot);
  });

  it('orders results by concept id', () => {
    const concepts: readonly ConceptCourses[] = [
      { conceptId: 'z', courses: ['NEW1', 'OLD1'] },
      { conceptId: 'a', courses: ['NEW1', 'OLD1'] },
    ];
    const entries = [review('z', '2026-01-10', 'e1'), review('a', '2026-01-10', 'e2')];

    const result = buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts });

    expect(result.map((r) => r.conceptId)).toEqual(['a', 'z']);
  });

  it('`[D-281]` item 4 (ol-a07q, ol-egov.141.89.9.47): a `rejected` verdict against the qualifying instrument excludes its evidence from the stage shown here, the same as the other three mastery-fold readers', () => {
    const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];
    const heldReview = review('c1', '2026-08-30', 'e1');
    const qualifyingExplainBack: ReviewLogRecord = {
      schemaVersion: 6,
      kind: 'review',
      eventId: 'eb-1',
      timestamp: '2026-08-29T09:00:00+00:00',
      instrumentId: 'eb:c1:1',
      instrumentType: 'explain-back',
      conceptIds: ['c1'],
      rating: null,
      wasUnsure: false,
      durationMs: 4000,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['explain-back'],
        planVersion: null,
      },
      supportLevelShown: 'independent',
      explainBackGrade: {
        soloLevel: 'relational',
        correctness: 'correct',
        contentRef: 'content-ref-1',
        revisionOf: null,
        artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
      },
    };
    // A real refusal, not a mere suspend — the proven-invalid signal D-281
    // item 4 (and ol-v7r5.69's close reason) both require.
    const rejectedVerdict: ReviewLogEntry = {
      schemaVersion: 6,
      kind: 'verdict',
      eventId: 'verdict-1',
      timestamp: '2026-08-29T09:30:00+00:00',
      instrumentId: 'eb:c1:1',
      instrumentType: 'explain-back',
      conceptIds: ['c1'],
      verdict: 'rejected',
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
    } as ReviewLogEntry;

    const withoutRejection = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: [heldReview, qualifyingExplainBack],
      concepts,
    });
    const withRejection = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: [heldReview, qualifyingExplainBack, rejectedVerdict],
      concepts,
    });

    expect(withoutRejection[0]?.state).toBe('tree');
    // The exact regression this bead fixes: before the fix,
    // `buildEarlierCourseRecognitions` called `computeConceptMastery` with no
    // `invalidInstrumentIds` at all (unless a caller happened to derive and
    // pass one itself), so a rejected verdict never reached the fold and the
    // stage shown here stayed `tree`.
    expect(withRejection[0]?.state).not.toBe('tree');
  });
});

/**
 * `[D-387]` / `[D-411]` (`ol-v7r5.66`): the dated line at a preserved cutoff,
 * kept apart from the current reading. The cutoff record is the only source of
 * the day and the rules; nothing here reads a calendar.
 */
describe('[D-387] the dated line at a preserved cutoff, apart from the current reading', () => {
  const concepts: readonly ConceptCourses[] = [{ conceptId: 'c1', courses: ['NEW1', 'OLD1'] }];
  const beforeCutoff = [
    review('c1', '2026-05-01', 'e1'),
    review('c1', '2026-05-04', 'e2'),
    review('c1', '2026-05-08', 'e3'),
  ];

  function cutoff(overrides: Partial<CourseCutoffRecord> = {}): CourseCutoffRecord {
    return {
      ...buildCourseCutoffRecord({
        courseId: 'OLD1',
        cutoff: { cutoffDay: '2026-06-12', source: 'provisional-last-passed-assessment' },
        arithmeticVersion: recognitionArithmeticVersion(),
        conceptIds: ['c1'],
      }),
      ...overrides,
    };
  }

  it('returns the stage at the cutoff as its own line beside the current stage, never merged', () => {
    const [rec] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: beforeCutoff,
      concepts,
      cutoffRecords: [cutoff()],
    });
    expect(rec?.state).toBe('sapling');
    expect(rec?.historical).toEqual([
      {
        course: 'OLD1',
        cutoffDay: '2026-06-12',
        source: 'provisional-last-passed-assessment',
        provisional: true,
        state: 'sapling',
        arithmeticVersion: recognitionArithmeticVersion(),
        historicalAwardRuleVersion: cutoff().historicalAwardRuleVersion,
      },
    ]);
  });

  it('later learning moves the current line only', () => {
    const early = [review('c1', '2026-05-01', 'e1')];
    const later = [
      review('c1', '2026-07-01', 'e4'),
      review('c1', '2026-07-05', 'e5'),
      review('c1', '2026-07-09', 'e6'),
    ];
    const at = (entries: readonly ReviewLogEntry[]) =>
      buildEarlierCourseRecognitions({
        newCourse: 'NEW1',
        entries,
        concepts,
        cutoffRecords: [cutoff()],
      })[0];

    const before = at(early);
    const after = at([...early, ...later]);
    expect(before?.state).toBe('sprout');
    expect(after?.state).toBe('sapling');
    expect(before?.historical[0]?.state).toBe('sprout');
    expect(after?.historical).toEqual(before?.historical);
  });

  it('an entry on the cutoff day itself counts; the day after does not (local day of the timestamp)', () => {
    const entries = [
      review('c1', '2026-06-01', 'e1'),
      review('c1', '2026-06-06', 'e2'),
      { ...review('c1', '2026-06-12', 'e3'), timestamp: '2026-06-12T23:30:00-04:00' },
      { ...review('c1', '2026-06-13', 'e4'), timestamp: '2026-06-13T00:30:00+10:00' },
    ];
    const [rec] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries,
      concepts,
      cutoffRecords: [cutoff()],
    });
    expect(rec?.historical[0]?.state).toBe('sapling');
  });

  it('a later arithmetic or rule version change does not move the dated line', () => {
    // Recorded under the default sapling rule, where quiz answers on three
    // days reach sapling; the current reading now runs under unaided recall,
    // where they count toward sprout only.
    const [rec] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: beforeCutoff,
      concepts,
      options: { saplingRule: 'unaided-recall' },
      cutoffRecords: [cutoff()],
    });
    expect(rec?.state).toBe('sprout');
    expect(rec?.historical[0]?.state).toBe('sapling');
    expect(rec?.historical[0]?.arithmeticVersion).toBe(
      attainmentArithmeticVersion({ saplingRule: 'any-scored-success', withheldEvidence: 'count' }),
    );
  });

  it('reads validity as known by the cutoff: a rejection logged afterwards lowers the current line only', () => {
    // The top stage is the one instrument validity moves (`[D-281]` item 4).
    const qualifyingExplainBack: ReviewLogRecord = {
      ...review('c1', '2026-05-10', 'eb-1'),
      instrumentId: 'eb:c1:1',
      instrumentType: 'explain-back',
      rating: null,
      supportLevelShown: 'independent',
      explainBackGrade: {
        soloLevel: 'relational',
        correctness: 'correct',
        contentRef: 'content-ref-1',
        revisionOf: null,
        artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
      },
    };
    const rejectedLater = {
      schemaVersion: 6,
      kind: 'verdict',
      eventId: 'verdict-1',
      timestamp: '2026-08-01T09:30:00+00:00',
      instrumentId: 'eb:c1:1',
      instrumentType: 'explain-back',
      conceptIds: ['c1'],
      verdict: 'rejected',
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
    } as ReviewLogEntry;
    const entries = [...beforeCutoff, qualifyingExplainBack];
    const [held] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries,
      concepts,
      cutoffRecords: [cutoff()],
    });
    expect(held?.state).toBe('tree');
    expect(held?.historical[0]?.state).toBe('tree');

    const [rec] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: [...entries, rejectedLater],
      concepts,
      cutoffRecords: [cutoff()],
    });
    expect(rec?.state).not.toBe('tree');
    expect(rec?.historical[0]?.state).toBe('tree');
  });

  it('a leaving-gesture cutoff is not provisional', () => {
    const [rec] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: beforeCutoff,
      concepts,
      cutoffRecords: [cutoff({ source: 'leaving-gesture' })],
    });
    expect(rec?.historical[0]?.provisional).toBe(false);
  });

  it('with no cutoff record, no dated line: the current reading stands alone', () => {
    const [rec] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: beforeCutoff,
      concepts,
    });
    expect(rec?.state).toBe('sapling');
    expect(rec?.historical).toEqual([]);
  });

  it('a record that does not cover the concept, or is for another course, draws no dated line', () => {
    const [uncovered] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: beforeCutoff,
      concepts,
      cutoffRecords: [cutoff({ conceptIds: ['c9'] })],
    });
    expect(uncovered?.historical).toEqual([]);
    const [elsewhere] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: beforeCutoff,
      concepts,
      cutoffRecords: [cutoff({ courseId: 'OLD9' })],
    });
    expect(elsewhere?.historical).toEqual([]);
  });

  it("a record naming a rule this build does not implement draws no dated line, never one refolded under today's rule", () => {
    for (const record of [
      cutoff({ historicalAwardRuleVersion: 'cutoff-asof-99' }),
      cutoff({ arithmeticVersion: 'att-fold-99;sapling=any-scored-success;withheld=count' }),
      cutoff({ arithmeticVersion: 'att-fold-1;sapling=a-rule-not-yet-built' }),
    ]) {
      const [rec] = buildEarlierCourseRecognitions({
        newCourse: 'NEW1',
        entries: beforeCutoff,
        concepts,
        cutoffRecords: [record],
      });
      expect(rec?.state).toBe('sapling');
      expect(rec?.historical).toEqual([]);
    }
  });

  it('the first record per course is read, whatever a later one says', () => {
    const later = parseCourseCutoffRecord(
      JSON.parse(serializeCourseCutoffRecord(cutoff({ cutoffDay: '2026-05-02' }))),
    ) as CourseCutoffRecord;
    const [rec] = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: beforeCutoff,
      concepts,
      cutoffRecords: [cutoff(), later],
    });
    expect(rec?.historical).toHaveLength(1);
    expect(rec?.historical[0]?.cutoffDay).toBe('2026-06-12');
  });
});
