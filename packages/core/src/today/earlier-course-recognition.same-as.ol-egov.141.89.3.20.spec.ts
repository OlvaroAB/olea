/**
 * `ol-egov.141.89.3.20` (`[D-402]`): earlier-course recognition follows a CONFIRMED same-as link
 * and nothing weaker. Since `[D-402]`, one topic wording cited in two courses is two identities,
 * one per course, joined only by a link she confirms; a concept that genuinely recurs across
 * courses must be recognised again once she does, and never on a proposal alone.
 *
 * Fixture ids are opaque (INV-3): no real course code or concept name anywhere in this file.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptKeyCanonicalIndex } from '../concept/key-store.js';
import {
  SAME_AS_LINK_RECORD_SCHEMA_VERSION,
  type SameAsLinkRecord,
  type SameAsLinkStatus,
} from '../concept/same-as.js';
import type { ConceptCourses } from '../insights/types.js';
import { buildEarlierCourseRecognitions } from './earlier-course-recognition.js';

function review(
  conceptIds: readonly string[],
  day: string,
  eventId: string,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp: `${day}T20:00:00+00:00`,
    instrumentId: `qa:${conceptIds.join('+')}:1`,
    instrumentType: 'qa',
    conceptIds: [...conceptIds],
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

function link(keyA: string, keyB: string, status: SameAsLinkStatus): SameAsLinkRecord {
  return {
    keyA,
    keyB,
    status,
    reason: 'normalisation-collision',
    proposedAt: '2026-09-01T00:00:00.000Z',
    ...(status === 'confirmed' ? { confirmedAt: '2026-09-02T00:00:00.000Z' } : {}),
    ...(status === 'declined' ? { declinedAt: '2026-09-02T00:00:00.000Z' } : {}),
    ...(status === 'severed' ? { severedAt: '2026-09-03T00:00:00.000Z' } : {}),
    schemaVersion: SAME_AS_LINK_RECORD_SCHEMA_VERSION,
  };
}

// The `[D-402]` shape: one identity per course, the earlier course's carrying her history.
const EARLIER = 'k-a-earlier';
const LATER = 'k-b-later';
const concepts: readonly ConceptCourses[] = [
  { conceptId: EARLIER, courses: ['OLD1'] },
  { conceptId: LATER, courses: ['NEW1'] },
];
const entries = [review([EARLIER], '2026-01-10', 'e1'), review([EARLIER], '2026-02-10', 'e2')];

describe('earlier-course recognition across two course identities ([D-402])', () => {
  it('recognises nothing with no link at all: two identities are two concepts', () => {
    expect(buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts })).toEqual([]);
    expect(
      buildEarlierCourseRecognitions({ newCourse: 'NEW1', entries, concepts, sameAsLinks: [] }),
    ).toEqual([]);
  });

  it.each(['proposed', 'declined', 'severed'] as const)(
    'does nothing on a %s link: only her confirmation joins them',
    (status) => {
      const result = buildEarlierCourseRecognitions({
        newCourse: 'NEW1',
        entries,
        concepts,
        sameAsLinks: [link(EARLIER, LATER, status)],
      });
      expect(result).toEqual([]);
    },
  );

  it('recognises the recurring concept again once she confirms the link', () => {
    const result = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries,
      concepts,
      sameAsLinks: [link(EARLIER, LATER, 'confirmed')],
    });

    expect(result).toHaveLength(1);
    // The link's surviving key (its code-unit-first key), as every same-as reader names it.
    expect(result[0]?.conceptId).toBe(EARLIER);
    expect(result[0]?.newCourse).toBe('NEW1');
    expect(result[0]?.earlierCourses).toEqual(['OLD1']);
    expect(result[0]?.evidence).toEqual({
      reviewCount: 2,
      explainedBack: false,
      lastCorrectAt: '2026-02-10T20:00:00+00:00',
    });
    // Exactly what one shared id would read: the confirmed pair is one identity, nothing re-derived.
    const oneId = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries,
      concepts: [{ conceptId: EARLIER, courses: ['NEW1', 'OLD1'] }],
    });
    expect(result).toEqual(oneId);
  });

  it('reads evidence under both keys as one identity, counting an entry that names both once', () => {
    const both = [
      review([EARLIER], '2026-01-10', 'e1'),
      review([LATER], '2026-03-10', 'e2'),
      review([EARLIER, LATER], '2026-03-11', 'e3', { rating: 'again' }),
    ];

    const result = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries: both,
      concepts,
      sameAsLinks: [link(EARLIER, LATER, 'confirmed')],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.evidence.reviewCount).toBe(3);
    expect(result[0]?.evidence.lastCorrectAt).toBe('2026-03-10T20:00:00+00:00');
  });

  it('is symmetric: setting up the earlier course names the later one', () => {
    const result = buildEarlierCourseRecognitions({
      newCourse: 'OLD1',
      entries,
      concepts,
      sameAsLinks: [link(EARLIER, LATER, 'confirmed')],
    });
    expect(result.map((r) => [r.conceptId, r.earlierCourses])).toEqual([[EARLIER, ['NEW1']]]);
  });

  it('a confirmed link between two other identities changes nothing here', () => {
    const result = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries,
      concepts,
      sameAsLinks: [link('k-x', 'k-y', 'confirmed')],
    });
    expect(result).toEqual([]);
  });

  it('follows a link confirmed under a superseded duplicate key through the canonical-key index ([D-378])', () => {
    const SUPERSEDED = 'k-c-duplicate';
    const canonicalKeys: ConceptKeyCanonicalIndex = {
      canonicalOf: (key) => (key === SUPERSEDED ? LATER : key),
      superseded: new Map([[SUPERSEDED, LATER]]),
    };

    const result = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries,
      concepts,
      sameAsLinks: [link(EARLIER, SUPERSEDED, 'confirmed')],
      canonicalKeys,
    });

    expect(result.map((r) => [r.conceptId, r.earlierCourses])).toEqual([[EARLIER, ['OLD1']]]);
  });
});
