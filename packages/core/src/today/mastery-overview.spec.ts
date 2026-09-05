/**
 * F6.2's overview (`ol-lohq`). The two scenarios in `features/F6-today.md`'s
 * "F6.2 — Today mastery overview" block are asserted against
 * `mastery/sprig.spec.ts` at the distribution level; what is asserted here is
 * the half that block did not yet have a home for — the **grouping**, and the
 * shape's refusal to carry a blended number.
 */

import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { Scheduler } from '../scheduler/types.js';
import { buildMasteryOverview } from './mastery-overview.js';

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

const NOW = new Date('2026-09-02T09:00:00.000Z');

/**
 * A `Scheduler` whose recall probability is looked up per instrument id — the
 * same stub technique `mastery/rollup.spec.ts` uses, so a test can say "this
 * instrument is faded" without reverse-engineering an FSRS stability that
 * produces it. `schedule` still returns a real-shaped `SchedulerState`,
 * because the vitality fold replays scheduler states internally
 * (`../session/replay.ts`) before it ever asks for retrievability.
 */
function stubScheduler(byInstrument: Readonly<Record<string, number>>): Scheduler {
  return {
    schedule({ instrumentId, now }) {
      return {
        instrumentId,
        state: {
          schemaVersion: 1,
          due: now.toISOString(),
          stability: 1,
          difficulty: 5,
          scheduledDays: 1,
          learningStepIndex: 0,
          reps: 1,
          lapses: 0,
          learningState: 'review',
          lastReview: now.toISOString(),
        },
        intervalDays: 1,
      };
    },
    retrievability({ instrumentId }) {
      const recallProbability = byInstrument[instrumentId];
      if (recallProbability === undefined) {
        throw new Error(`stubScheduler: no probability configured for ${instrumentId}`);
      }
      return { instrumentId, recallProbability };
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
      expect(Object.keys(course).sort()).toEqual(['course', 'distribution', 'vitality']);
      expect(Object.keys(course.distribution.counts).sort()).toEqual([
        'sapling',
        'seed',
        'sprout',
        'tree',
      ]);
      // `vitality` is omitted from this input, so it is `null` — D-116's own
      // fallback: never a distribution shown as if it also carried vitality
      // when nothing supplied one. See the "vitality axis" block below for
      // the populated shape.
      expect(course.vitality).toBeNull();
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

  // ---------------------------------------------------------------------
  // F6.2 / R3 / `[D-087]` — features/F6-today.md, "F6.2 — What the overview
  // may show for vitality". `[VIT-2]` (`ol-a3hv`) threads the vitality axis
  // into this course-level aggregate for the first time; both scenarios are
  // pre-written and were pending until this bead.
  // ---------------------------------------------------------------------
  describe('the vitality axis (`[VIT-2]`, `ol-a3hv`)', () => {
    it('a concept carrying only MCQs reads too early to say, never holding', () => {
      // Three MCQ successes, spaced across three distinct days: recognition-tier
      // evidence, so it never enters the vitality fold at all (R3's filter) —
      // whatever the scheduler would say about its retrievability.
      const entries = [
        review('a', '2026-08-01', 'e1', { instrumentType: 'mcq' }),
        review('a', '2026-08-04', 'e2', { instrumentType: 'mcq' }),
        review('a', '2026-08-09', 'e3', { instrumentType: 'mcq' }),
      ];
      // A scheduler that would say "fresh" if it were ever asked — proving
      // the `early` reading comes from the sufficiency floor, not from a
      // scheduler this concept's MCQ instrument was never allowed to reach.
      const scheduler = stubScheduler({ 'qa:a:1': 0.99 });

      const overview = buildMasteryOverview({
        entries,
        concepts: [{ conceptId: 'a', courses: ['BIOL204'] }],
        vitality: { scheduler, now: NOW, holdingCut: 0.9 },
      });

      const biol = overview.courses[0];
      expect(biol?.vitality).not.toBeNull();
      // Recognition-only evidence caps growth stage at `sapling` (R7) — this
      // scenario's own point is the vitality reading, not which stage that
      // lands at, so the state is read back rather than assumed.
      const state = biol?.distribution.counts.sapling === 1 ? 'sapling' : 'sprout';
      expect(biol?.vitality?.byStage[state]).toEqual({ holding: 0, tending: 0, early: 1 });
      expect(biol?.vitality?.tending).toEqual([]);
    });

    it('a tree that needs tending is drawn as a tree', () => {
      // Three spaced recall (qa) successes reach `sapling`; the graded
      // explain-back clears the depth gate into `tree` (R7, MAT-6). The
      // scheduler then reports the qa instrument's retrievability below the
      // holding cut — explain-back is explanation-tier and never enters the
      // vitality fold at all (`[D-087]`).
      const entries = [
        review('a', '2026-08-01', 'e1'),
        review('a', '2026-08-04', 'e2'),
        review('a', '2026-08-09', 'e3'),
        review('a', '2026-08-10', 'e4', {
          instrumentId: 'explain-back:a',
          instrumentType: 'explain-back',
          rating: null,
          explainBackGrade: {
            soloLevel: 'relational',
            contentRef: 'content-ref-placeholder',
            revisionOf: null,
            artifactProvenance: {
              taskId: 'explain-back-grade',
              promptVersion: 'v0',
              modelId: 'model-placeholder',
            },
          },
        }),
      ];
      const scheduler = stubScheduler({ 'qa:a:1': 0.5 });

      const overview = buildMasteryOverview({
        entries,
        concepts: [{ conceptId: 'a', courses: ['BIOL204'] }],
        vitality: { scheduler, now: NOW, holdingCut: 0.9 },
      });

      const biol = overview.courses[0];
      // Vitality is an overlay and never a demotion (F2.11): the concept
      // stays counted under `tree`, and it is `tree` that reads `tending` —
      // never a lower stage absorbing the faded reading instead.
      expect(biol?.distribution.counts.tree).toBe(1);
      expect(biol?.vitality?.byStage.tree).toEqual({ holding: 0, tending: 1, early: 0 });
      expect(biol?.vitality?.tending).toEqual([
        { conceptId: 'a', state: 'tree', weakestInstrumentId: 'qa:a:1' },
      ]);
    });
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
