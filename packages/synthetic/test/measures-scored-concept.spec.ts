/**
 * The measures read a review record the way the product does (`ol-egov.141.89.9.76`,
 * `[D-419]`, `[D-423]`): a record is evidence for the one concept it scored — the first id of its
 * own list — and for no concept it merely names as context.
 *
 * These measures are what F6.5's insights are golden-tested against, and the product readers they
 * mirror (`olea-core`'s `insights/effort.ts`, `insights/spacing.ts`) count a review toward the
 * scored concept's courses only. If the measure kept counting every listed concept, a persona
 * assertion and the product reading of the same stream could disagree. The generator writes
 * one-id records today, so no persona's numbers move; the hand-built records below are the only
 * place a context concept appears.
 */
import type { ReviewLogEntry } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  CONCEPTS,
  COURSE_QUORBIN,
  COURSE_VANTREL,
  lapseRateByCourse,
  recurringFailureConceptIds,
  reviewCountByCourse,
  timeSpentMsByCourse,
} from '../src/index.js';

const VANTREL_CONCEPT = CONCEPTS.find((c) => c.courseId === COURSE_VANTREL)?.conceptId ?? '';
const QUORBIN_CONCEPT = CONCEPTS.find((c) => c.courseId === COURSE_QUORBIN)?.conceptId ?? '';

function review(
  eventId: string,
  conceptIds: readonly string[],
  overrides: { readonly rating?: 'again' | 'good'; readonly durationMs?: number } = {},
): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp: '2026-03-02T09:00:00+00:00',
    instrumentId: `inst-${eventId}`,
    instrumentType: 'qa',
    conceptIds: [...conceptIds],
    rating: overrides.rating ?? 'again',
    wasUnsure: false,
    durationMs: overrides.durationMs ?? 4000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

describe('measures credit a record to its scored concept only ([D-423])', () => {
  const twoTopics = [review('e1', [VANTREL_CONCEPT, QUORBIN_CONCEPT])];

  it('the fixture concepts sit in two different courses', () => {
    expect(VANTREL_CONCEPT).not.toBe('');
    expect(QUORBIN_CONCEPT).not.toBe('');
  });

  it('reviewCountByCourse counts the scored concept’s course, not the context concept’s', () => {
    const counts = reviewCountByCourse(twoTopics);
    expect(counts.get(COURSE_VANTREL)).toBe(1);
    expect(counts.has(COURSE_QUORBIN)).toBe(false);
  });

  it('timeSpentMsByCourse attributes the record’s time to the scored concept’s course only', () => {
    const totals = timeSpentMsByCourse(twoTopics);
    expect(totals.get(COURSE_VANTREL)).toBe(4000);
    expect(totals.has(COURSE_QUORBIN)).toBe(false);
  });

  it('lapseRateByCourse reads the record in the scored concept’s course only', () => {
    const rates = lapseRateByCourse(twoTopics);
    expect(rates.get(COURSE_VANTREL)).toEqual({ reviews: 1, again: 1, rate: 1 });
    expect(rates.has(COURSE_QUORBIN)).toBe(false);
  });

  it('recurringFailureConceptIds counts the scored concept, never a context concept', () => {
    const recurring = recurringFailureConceptIds([
      review('e1', [VANTREL_CONCEPT, QUORBIN_CONCEPT]),
      review('e2', [VANTREL_CONCEPT, QUORBIN_CONCEPT]),
    ]);
    expect(recurring.get(VANTREL_CONCEPT)).toBe(2);
    expect(recurring.has(QUORBIN_CONCEPT)).toBe(false);
  });

  it('a record written with the other concept first credits that one, whatever the note lists today', () => {
    const reordered = [review('e1', [QUORBIN_CONCEPT, VANTREL_CONCEPT])];
    expect(reviewCountByCourse(reordered).get(COURSE_QUORBIN)).toBe(1);
    expect(reviewCountByCourse(reordered).has(COURSE_VANTREL)).toBe(false);
  });
});
