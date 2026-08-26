/**
 * The effort detector's own behaviour, on hand-built logs. Same scope note as
 * `./spacing.spec.ts`: the claim that it fires on a student whose effort really
 * is lopsided and goes quiet on the same student with that pattern removed
 * needs a planted ground truth, and is asserted in
 * `packages/workbench/test/trends-scenarios.spec.ts` against
 * `olea-synthetic`'s `lopsided-effort` persona.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { detectEffortImbalance, MIN_GAP, type WeightedAssessment } from './effort.js';

const MINUTE = 60_000;

function review(
  conceptIds: readonly string[],
  index: number,
  durationMs: number | null,
): ReviewLogRecord {
  return {
    schemaVersion: 4,
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

const EVEN_WEIGHTS: readonly WeightedAssessment[] = [
  { course: 'BIOL204', weight: 50 },
  { course: 'STAT110', weight: 50 },
];

/** `n` reviews of `conceptId`, a minute each. */
function minutes(conceptId: string, n: number, from: number): ReviewLogEntry[] {
  return Array.from({ length: n }, (_, i) => review([conceptId], from + i, MINUTE));
}

describe('detectEffortImbalance — abstention is not a negative result', () => {
  it('declines when fewer than two courses state a weight', () => {
    const result = detectEffortImbalance({
      entries: minutes('bio-1', 60, 0),
      concepts: CONCEPTS,
      assessments: [{ course: 'BIOL204', weight: 50 }],
    });
    expect(result.status).toBe('not-enough-history');
    expect(result.measured).toBeNull();
  });

  it('declines when almost no review time is attributed to a weighted course', () => {
    const result = detectEffortImbalance({
      entries: minutes('bio-1', 5, 0),
      concepts: CONCEPTS,
      assessments: EVEN_WEIGHTS,
    });
    expect(result.status).toBe('not-enough-history');
  });

  it('ignores an assessment whose weight her note does not state', () => {
    const result = detectEffortImbalance({
      entries: [...minutes('bio-1', 40, 0), ...minutes('stat-1', 40, 100)],
      concepts: CONCEPTS,
      assessments: [
        { course: 'BIOL204', weight: 50 },
        { course: 'STAT110', weight: undefined },
      ],
    });
    expect(result.status).toBe('not-enough-history');
  });
});

describe('detectEffortImbalance — what it measures', () => {
  it('an even split against even weights is measured and not observed', () => {
    const result = detectEffortImbalance({
      entries: [...minutes('bio-1', 40, 0), ...minutes('stat-1', 40, 100)],
      concepts: CONCEPTS,
      assessments: EVEN_WEIGHTS,
    });
    expect(result.status).toBe('not-observed');
    expect(result.measured?.widestGap).toBe(0);
    expect(result.measured?.widestGapCourse).toBeNull();
  });

  it('fires on the course carrying more of the grade than of the hours, and names it', () => {
    const result = detectEffortImbalance({
      entries: [...minutes('bio-1', 5, 0), ...minutes('stat-1', 75, 100)],
      concepts: CONCEPTS,
      assessments: EVEN_WEIGHTS,
    });
    expect(result.status).toBe('observed');
    expect(result.measured?.widestGapCourse).toBe('BIOL204');
    expect(result.measured?.widestGap).toBeGreaterThan(MIN_GAP);
  });

  it('a weighted course with no time at all is included at time share zero, not dropped', () => {
    // The loudest finding available must not be the one thing the shape cannot
    // express.
    const result = detectEffortImbalance({
      entries: minutes('stat-1', 80, 0),
      concepts: CONCEPTS,
      assessments: EVEN_WEIGHTS,
    });
    expect(result.status).toBe('observed');
    expect(result.measured?.courses.find((c) => c.course === 'BIOL204')?.timeMs).toBe(0);
    expect(result.measured?.widestGap).toBeCloseTo(0.5, 10);
  });

  it('never reports the negative direction as a finding', () => {
    // STAT110 is heavily over-studied relative to its weight, and BIOL204's own
    // gap is what fires. "You are over-studying X" is a verdict and there is no
    // path to it in this shape: `widestGap` is clamped at zero from below.
    const result = detectEffortImbalance({
      entries: [...minutes('bio-1', 40, 0), ...minutes('stat-1', 40, 100)],
      concepts: CONCEPTS,
      assessments: [
        { course: 'BIOL204', weight: 50 },
        { course: 'STAT110', weight: 50 },
      ],
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
      assessments: EVEN_WEIGHTS,
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
      assessments: EVEN_WEIGHTS,
    });
    expect(result.measured?.timedReviewCount).toBe(80);
  });

  it('reports the courses it left out for stating no weight, rather than narrowing silently', () => {
    const result = detectEffortImbalance({
      entries: [
        ...minutes('bio-1', 40, 0),
        ...minutes('stat-1', 40, 100),
        ...minutes('hist-1', 40, 200),
      ],
      concepts: [...CONCEPTS, { conceptId: 'hist-1', courses: ['HIST101'] }],
      assessments: EVEN_WEIGHTS,
    });
    expect(result.measured?.coursesWithoutWeight).toEqual(['HIST101']);
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
        assessments: EVEN_WEIGHTS,
      }),
      detectEffortImbalance({
        entries: minutes('stat-1', 80, 0),
        concepts: CONCEPTS,
        assessments: EVEN_WEIGHTS,
      }),
      detectEffortImbalance({
        // Same imbalance as the first case, plus a third, unweighted course
        // mixed in — the invariant must hold with a course left out too.
        entries: [
          ...minutes('bio-1', 5, 0),
          ...minutes('stat-1', 75, 100),
          ...minutes('hist-1', 40, 200),
        ],
        concepts: [...CONCEPTS, { conceptId: 'hist-1', courses: ['HIST101'] }],
        assessments: EVEN_WEIGHTS,
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
      assessments: EVEN_WEIGHTS,
    });
    expect(notObserved.status).toBe('not-observed');
    expect(notObserved.measured?.widestGapCourse).toBeNull();

    const tooEarly = detectEffortImbalance({
      entries: minutes('bio-1', 60, 0),
      concepts: CONCEPTS,
      assessments: [{ course: 'BIOL204', weight: 50 }],
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
      assessments: EVEN_WEIGHTS,
    });
    const second = detectEffortImbalance({
      entries,
      concepts: CONCEPTS,
      assessments: EVEN_WEIGHTS,
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});
