/**
 * F6.2's overview (`ol-lohq`). The two scenarios in `features/F6-today.md`'s
 * "F6.2 — Today mastery overview" block are asserted against
 * `mastery/sprig.spec.ts` at the distribution level; what is asserted here is
 * the half that block did not yet have a home for — the **grouping**, and the
 * shape's refusal to carry a blended number.
 */

import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { buildMasteryOverview } from './mastery-overview.js';

function review(conceptId: string, day: string, eventId: string): ReviewLogRecord {
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
  };
}

describe('buildMasteryOverview', () => {
  it('is a distribution per course, and carries no blended score anywhere', () => {
    const overview = buildMasteryOverview({
      entries: [review('a', '2026-08-01', 'e1')],
      concepts: [
        { conceptId: 'a', courses: ['BIOL204'] },
        { conceptId: 'b', courses: ['BIOL204'] },
        { conceptId: 'c', courses: ['STAT110'] },
      ],
    });

    expect(overview.courses.map((c) => c.course)).toEqual(['BIOL204', 'STAT110']);
    for (const course of overview.courses) {
      // The four named stages, all present, none of them collapsed. A row that
      // gained an `average`, a `percent` or a course-level `state` would be the
      // report-card shape `ol-lohq` rules out, so the field set is asserted
      // rather than described.
      expect(Object.keys(course).sort()).toEqual(['course', 'distribution']);
      expect(Object.keys(course.distribution.counts).sort()).toEqual([
        'sapling',
        'seed',
        'sprout',
        'tree',
      ]);
    }
  });

  it('a concept named in the set but absent from the log counts as seed, not omitted', () => {
    const overview = buildMasteryOverview({
      entries: [review('a', '2026-08-01', 'e1')],
      concepts: [
        { conceptId: 'a', courses: ['BIOL204'] },
        { conceptId: 'never-opened', courses: ['BIOL204'] },
      ],
    });

    const biol = overview.courses[0];
    expect(biol?.distribution.total).toBe(2);
    expect(biol?.distribution.counts.seed).toBe(1);
  });

  it('orders by her course code, never by how well a course is going', () => {
    // Principle 12: a list whose top row is chosen by weakness says something
    // about her every time she opens the sidebar. `zzz` has the most evidence
    // and still sorts last.
    const overview = buildMasteryOverview({
      entries: [
        review('z1', '2026-08-01', 'e1'),
        review('z1', '2026-08-04', 'e2'),
        review('z1', '2026-08-09', 'e3'),
      ],
      concepts: [
        { conceptId: 'z1', courses: ['ZZZ999'] },
        { conceptId: 'a1', courses: ['AAA111'] },
      ],
    });
    expect(overview.courses.map((c) => c.course)).toEqual(['AAA111', 'ZZZ999']);
  });

  it('counts a concept in two courses in both, so course totals need not sum to the concept count', () => {
    const overview = buildMasteryOverview({
      entries: [],
      concepts: [{ conceptId: 'shared', courses: ['BIOL204', 'STAT110'] }],
    });
    expect(overview.conceptCount).toBe(1);
    expect(overview.courses.map((c) => c.distribution.total)).toEqual([1, 1]);
  });

  it('counts a concept in no course rather than bucketing it into a course she does not have', () => {
    const overview = buildMasteryOverview({
      entries: [],
      concepts: [
        { conceptId: 'orphan', courses: [] },
        { conceptId: 'a', courses: ['BIOL204'] },
      ],
    });
    expect(overview.unassignedConceptCount).toBe(1);
    expect(overview.courses.map((c) => c.course)).toEqual(['BIOL204']);
  });

  it('de-duplicates a repeated concept and a repeated course', () => {
    const overview = buildMasteryOverview({
      entries: [],
      concepts: [
        { conceptId: 'a', courses: ['BIOL204', 'BIOL204'] },
        { conceptId: 'a', courses: ['BIOL204'] },
      ],
    });
    expect(overview.conceptCount).toBe(1);
    expect(overview.courses).toHaveLength(1);
    expect(overview.courses[0]?.distribution.total).toBe(1);
  });

  it('is pure: same input, same output, and the input is untouched', () => {
    const entries = [review('a', '2026-08-01', 'e1')];
    const concepts = [{ conceptId: 'a', courses: ['BIOL204'] }];
    const snapshot = JSON.stringify({ entries, concepts });
    const first = buildMasteryOverview({ entries, concepts });
    const second = buildMasteryOverview({ entries, concepts });
    expect(second).toEqual(first);
    expect(JSON.stringify({ entries, concepts })).toBe(snapshot);
  });
});
