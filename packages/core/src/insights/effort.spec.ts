/**
 * The effort detector's own behaviour, on hand-built logs. Same scope note as
 * `./spacing.spec.ts`: the claim that it fires on a student whose effort really
 * is lopsided and goes quiet on the same student with that pattern removed
 * needs a planted ground truth, and is asserted in
 * `packages/workbench/test/trends-scenarios.spec.ts` against
 * `olea-synthetic`'s `lopsided-effort` persona.
 *
 * **Fixtures re-specified against window accounting (`ol-v7r5.33`).** The
 * comparison target used to be a raw assessment-weight share (`weight: 50`,
 * normalised to `weightShare`); it is now the plan's own windowed floor share
 * (`floorShare`, `[D-081]`/`[D-092]`), taken as given and never renormalised —
 * see `effort.ts`'s module doc. `EVEN_FLOORS` below uses `0.3` per course
 * rather than the old `50`, a magnitude in the range a real two-course window
 * floor plausibly takes (`windowWidthSittings`'s own declared constants,
 * `olea-service`'s `src/plan/allocation.ts`), not a re-derivation of them.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { type CourseFloorShare, detectEffortImbalance, MIN_GAP } from './effort.js';

const MINUTE = 60_000;

function review(
  conceptIds: readonly string[],
  index: number,
  durationMs: number | null,
): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `e${index}`,
    timestamp: '2026-09-01T18:00:00+00:00',
    instrumentId: `qa:${conceptIds[0] ?? 'x'}:${index}`,
    instrumentType: 'qa',
    conceptIds: [...conceptIds],
    rating: 'good',
    wasUnsure: false,
    durationMs,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

const CONCEPTS = [
  { conceptId: 'bio-1', courses: ['BIOL204'] },
  { conceptId: 'stat-1', courses: ['STAT110'] },
];

const EVEN_FLOORS: readonly CourseFloorShare[] = [
  { course: 'BIOL204', floorShare: 0.3 },
  { course: 'STAT110', floorShare: 0.3 },
];

/** `n` reviews of `conceptId`, a minute each. */
function minutes(conceptId: string, n: number, from: number): ReviewLogEntry[] {
  return Array.from({ length: n }, (_, i) => review([conceptId], from + i, MINUTE));
}

describe('detectEffortImbalance — abstention is not a negative result', () => {
  it('declines when fewer than two courses have a known floor share', () => {
    const result = detectEffortImbalance({
      entries: minutes('bio-1', 60, 0),
      concepts: CONCEPTS,
      floorShares: [{ course: 'BIOL204', floorShare: 0.3 }],
    });
    expect(result.status).toBe('not-enough-history');
    expect(result.measured).toBeNull();
  });

  it('declines when almost no review time is attributed to a floor-share course', () => {
    const result = detectEffortImbalance({
      entries: minutes('bio-1', 5, 0),
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    expect(result.status).toBe('not-enough-history');
  });

  it('ignores a course whose floor share the plan does not state', () => {
    const result = detectEffortImbalance({
      entries: [...minutes('bio-1', 40, 0), ...minutes('stat-1', 40, 100)],
      concepts: CONCEPTS,
      floorShares: [
        { course: 'BIOL204', floorShare: 0.3 },
        { course: 'STAT110', floorShare: undefined },
      ],
    });
    expect(result.status).toBe('not-enough-history');
  });
});

describe('detectEffortImbalance — what it measures', () => {
  it('an even split against even floor shares is measured and not observed', () => {
    const result = detectEffortImbalance({
      entries: [...minutes('bio-1', 40, 0), ...minutes('stat-1', 40, 100)],
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    expect(result.status).toBe('not-observed');
    expect(result.measured?.widestGap).toBe(0);
    expect(result.measured?.widestGapCourse).toBeNull();
  });

  it('fires on the course logging less time than its own floor share, and names it', () => {
    const result = detectEffortImbalance({
      entries: [...minutes('bio-1', 5, 0), ...minutes('stat-1', 75, 100)],
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    expect(result.status).toBe('observed');
    expect(result.measured?.widestGapCourse).toBe('BIOL204');
    expect(result.measured?.widestGap).toBeGreaterThan(MIN_GAP);
  });

  it('a floor-share course with no time at all is included at time share zero, not dropped', () => {
    // The loudest finding available must not be the one thing the shape cannot
    // express.
    const result = detectEffortImbalance({
      entries: minutes('stat-1', 80, 0),
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    expect(result.status).toBe('observed');
    expect(result.measured?.courses.find((c) => c.course === 'BIOL204')?.timeMs).toBe(0);
    // gap = floorShare (0.3) - timeShare (0) — never renormalised, unlike the
    // old weight share.
    expect(result.measured?.widestGap).toBeCloseTo(0.3, 10);
  });

  it('never reports the negative direction as a finding', () => {
    // STAT110 logs far more time than its floor share, and BIOL204's own gap
    // is what fires. "You are over-studying X" is a verdict and there is no
    // path to it in this shape: `widestGap` is clamped at zero from below.
    const result = detectEffortImbalance({
      entries: [...minutes('bio-1', 40, 0), ...minutes('stat-1', 40, 100)],
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    expect(result.measured?.widestGap).toBeGreaterThanOrEqual(0);
  });

  it('attributes a record naming two courses to both in full, and never twice to one', () => {
    const concepts = [
      { conceptId: 'shared', courses: ['BIOL204', 'STAT110'] },
      { conceptId: 'also-bio', courses: ['BIOL204'] },
      { conceptId: 'bio-1', courses: ['BIOL204'] },
      { conceptId: 'stat-1', courses: ['STAT110'] },
    ];
    const result = detectEffortImbalance({
      // One record, two concepts, both in BIOL204: the record's minute counts
      // once for BIOL204, not twice.
      entries: [
        ...Array.from({ length: 60 }, (_, i) => review(['bio-1', 'also-bio'], i, MINUTE)),
        ...minutes('stat-1', 60, 1000),
      ],
      concepts,
      floorShares: EVEN_FLOORS,
    });
    const biol = result.measured?.courses.find((c) => c.course === 'BIOL204');
    expect(biol?.timeMs).toBe(60 * MINUTE);
    expect(result.status).toBe('not-observed');
  });

  it('a null duration contributes no time and is not counted as a timed review', () => {
    const result = detectEffortImbalance({
      entries: [
        ...minutes('bio-1', 40, 0),
        ...minutes('stat-1', 40, 100),
        review(['bio-1'], 999, null),
      ],
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    expect(result.measured?.timedReviewCount).toBe(80);
  });

  it('reports the courses it left out for having no known floor share, rather than narrowing silently', () => {
    const result = detectEffortImbalance({
      entries: [
        ...minutes('bio-1', 40, 0),
        ...minutes('stat-1', 40, 100),
        ...minutes('hist-1', 40, 200),
      ],
      concepts: [...CONCEPTS, { conceptId: 'hist-1', courses: ['HIST101'] }],
      floorShares: EVEN_FLOORS,
    });
    expect(result.measured?.coursesWithoutFloorShare).toEqual(['HIST101']);
  });

  it('never reports "observed" without naming the course (ol-7j54 / ARC-1)', () => {
    // The copy rule this bead enforces only works if the detector never lets
    // an observed gap go unnamed — a caller has nothing to attach the
    // sentence to otherwise. Checked across every fixture above that reaches
    // "observed", not just one example.
    const observedCases = [
      detectEffortImbalance({
        entries: [...minutes('bio-1', 5, 0), ...minutes('stat-1', 75, 100)],
        concepts: CONCEPTS,
        floorShares: EVEN_FLOORS,
      }),
      detectEffortImbalance({
        entries: minutes('stat-1', 80, 0),
        concepts: CONCEPTS,
        floorShares: EVEN_FLOORS,
      }),
      detectEffortImbalance({
        // Same imbalance as the first case, plus a third, floor-share-less
        // course mixed in — the invariant must hold with a course left out too.
        entries: [
          ...minutes('bio-1', 5, 0),
          ...minutes('stat-1', 75, 100),
          ...minutes('hist-1', 40, 200),
        ],
        concepts: [...CONCEPTS, { conceptId: 'hist-1', courses: ['HIST101'] }],
        floorShares: EVEN_FLOORS,
      }),
    ];
    for (const result of observedCases) {
      expect(result.status).toBe('observed');
      expect(result.measured?.widestGapCourse).toEqual(expect.any(String));
      expect(result.measured?.widestGapCourse).not.toBe('');
      // The named course is one of the ones actually measured, never an
      // aggregate label invented on the side.
      expect(result.measured?.courses.map((c) => c.course)).toContain(
        result.measured?.widestGapCourse,
      );
    }
  });

  it('"not-observed" and "not-enough-history" carry no course claim to misattribute', () => {
    const notObserved = detectEffortImbalance({
      entries: [...minutes('bio-1', 40, 0), ...minutes('stat-1', 40, 100)],
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    expect(notObserved.status).toBe('not-observed');
    expect(notObserved.measured?.widestGapCourse).toBeNull();

    const tooEarly = detectEffortImbalance({
      entries: minutes('bio-1', 60, 0),
      concepts: CONCEPTS,
      floorShares: [{ course: 'BIOL204', floorShare: 0.3 }],
    });
    expect(tooEarly.status).toBe('not-enough-history');
    expect(tooEarly.measured).toBeNull();
  });

  it('is pure and leaves the log untouched', () => {
    const entries = [...minutes('bio-1', 40, 0), ...minutes('stat-1', 40, 100)];
    const snapshot = JSON.stringify(entries);
    const first = detectEffortImbalance({
      entries,
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    const second = detectEffortImbalance({
      entries,
      concepts: CONCEPTS,
      floorShares: EVEN_FLOORS,
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});
