/**
 * F8.7's derivation (`RECOG-1`, `[D-058]`, component register row 4.5).
 * Fixture ids are opaque (INV-3): no real course code or concept name
 * anywhere in this file.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptCourses } from '../insights/types.js';
import { buildEarlierCourseRecognitions } from './earlier-course-recognition.js';

function review(
  conceptId: string,
  day: string,
  eventId: string,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return {
    schemaVersion: 5,
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
});
