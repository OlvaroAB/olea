/**
 * `ol-egov.141.89.104.1` ([D-295]): earlier-course recognition reads a same-as CLASS, not a
 * pairwise redirect. A chain of two confirmed links reads as one identity whatever order the
 * links arrive in. Fixture ids are opaque (INV-3).
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { SAME_AS_LINK_RECORD_SCHEMA_VERSION, type SameAsLinkRecord } from '../concept/same-as.js';
import type { ConceptCourses } from '../insights/types.js';
import { buildEarlierCourseRecognitions } from './earlier-course-recognition.js';

function review(conceptId: string, day: string, eventId: string): ReviewLogRecord {
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
  };
}

function confirmed(keyA: string, keyB: string): SameAsLinkRecord {
  return {
    keyA,
    keyB,
    status: 'confirmed',
    reason: 'normalisation-collision',
    proposedAt: '2026-09-01T00:00:00.000Z',
    confirmedAt: '2026-09-02T00:00:00.000Z',
    schemaVersion: SAME_AS_LINK_RECORD_SCHEMA_VERSION,
  };
}

describe('earlier-course recognition across a three-identity same-as class', () => {
  // a is the earlier course's identity, b the middle course's, c the new course's.
  const concepts: readonly ConceptCourses[] = [
    { conceptId: 'k-a', courses: ['OLD1'] },
    { conceptId: 'k-b', courses: ['MID1'] },
    { conceptId: 'k-c', courses: ['NEW1'] },
  ];
  const entries = [review('k-a', '2026-01-10', 'e1'), review('k-b', '2026-02-10', 'e2')];

  it.each([
    ['chain', [confirmed('k-a', 'k-b'), confirmed('k-b', 'k-c')]],
    ['chain, reverse order', [confirmed('k-b', 'k-c'), confirmed('k-a', 'k-b')]],
    ['star', [confirmed('k-a', 'k-c'), confirmed('k-b', 'k-c')]],
  ] as const)('%s: one recognition under k-a, reading both earlier courses', (_label, links) => {
    const result = buildEarlierCourseRecognitions({
      newCourse: 'NEW1',
      entries,
      concepts,
      sameAsLinks: links,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.conceptId).toBe('k-a');
    expect(result[0]?.earlierCourses).toEqual(['MID1', 'OLD1']);
    expect(result[0]?.evidence.reviewCount).toBe(2);
  });
});
