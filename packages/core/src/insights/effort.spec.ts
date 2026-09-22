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
import {
  type CourseFloorShare,
  detectEffortImbalance,
  MIN_GAP,
  SHORTFALL_RATIO_K,
} from './effort.js';

const MINUTE = 60_000;

function review(
  conceptIds: readonly string[],
  index: number,
  durationMs: number | null,
  timestamp = '2026-09-01T18:00:00+00:00',
): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `e${index}`,
    timestamp,
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

/**
 * `ol-v7r5.63` (`[DOS-C4]`): the dossier review found the OLD absolute
 * `MIN_GAP` structurally unreachable at real floor magnitudes for four or
 * five running courses (`max(0.12, 1/(n+2))` gives `0.167`/`0.143`, both
 * below `MIN_GAP = 0.2`, and a course's own floor share is also the largest
 * gap it can ever post). These tests use the REAL floor formula's magnitudes
 * (not the old `0.3` fixture, which never occurs once four or more courses
 * are running) and the new shortfall-RATIO criterion
 * (`SHORTFALL_RATIO_K`) — see `findings/effort-gap-sweep.md` (`olea-service`)
 * for the sweep behind the `0.5` pin.
 */
describe('detectEffortImbalance — the shortfall-ratio fix (ol-v7r5.63 / [DOS-C4])', () => {
  it('n=4 real floor (0.167): a course with zero attention fires — structurally unreachable under the old absolute MIN_GAP', () => {
    const floors: readonly CourseFloorShare[] = [
      { course: 'A', floorShare: 1 / 6 },
      { course: 'B', floorShare: 1 / 6 },
      { course: 'C', floorShare: 1 / 6 },
      { course: 'D', floorShare: 1 / 6 },
    ];
    const concepts = [
      { conceptId: 'a-1', courses: ['A'] },
      { conceptId: 'b-1', courses: ['B'] },
      { conceptId: 'c-1', courses: ['C'] },
      { conceptId: 'd-1', courses: ['D'] },
    ];
    const result = detectEffortImbalance({
      // A gets nothing; B/C/D split 60 timed reviews evenly — well clear of
      // MIN_TIMED_REVIEWS. The maximum absolute gap A could ever post is its
      // own floor share, 0.167 — below the old MIN_GAP=0.2, so the OLD
      // criterion could never have fired here at any attention level.
      entries: [...minutes('b-1', 20, 0), ...minutes('c-1', 20, 100), ...minutes('d-1', 20, 200)],
      concepts,
      floorShares: floors,
    });
    expect(result.status).toBe('observed');
    expect(result.measured?.widestGapCourse).toBe('A');
    const a = result.measured?.courses.find((c) => c.course === 'A');
    expect(a?.timeShare).toBe(0);
    // The absolute gap (0.167) never reached the old MIN_GAP (0.2) — proof
    // this fixture is exactly the previously-unreachable case.
    expect(a?.gap).toBeLessThan(MIN_GAP);
  });

  it('n=5 real floor (0.143): a course with zero attention fires — structurally unreachable under the old absolute MIN_GAP', () => {
    const floorShare = 1 / 7;
    const floors: readonly CourseFloorShare[] = [
      { course: 'A', floorShare },
      { course: 'B', floorShare },
      { course: 'C', floorShare },
      { course: 'D', floorShare },
      { course: 'E', floorShare },
    ];
    const concepts = [
      { conceptId: 'a-1', courses: ['A'] },
      { conceptId: 'b-1', courses: ['B'] },
      { conceptId: 'c-1', courses: ['C'] },
      { conceptId: 'd-1', courses: ['D'] },
      { conceptId: 'e-1', courses: ['E'] },
    ];
    const result = detectEffortImbalance({
      entries: [
        ...minutes('b-1', 15, 0),
        ...minutes('c-1', 15, 100),
        ...minutes('d-1', 15, 200),
        ...minutes('e-1', 15, 300),
      ],
      concepts,
      floorShares: floors,
    });
    expect(result.status).toBe('observed');
    expect(result.measured?.widestGapCourse).toBe('A');
    const a = result.measured?.courses.find((c) => c.course === 'A');
    expect(a?.gap).toBeLessThan(MIN_GAP);
  });

  it('equal attention across four real-floor courses (n=4) is measured and not observed', () => {
    const floors: readonly CourseFloorShare[] = [
      { course: 'A', floorShare: 1 / 6 },
      { course: 'B', floorShare: 1 / 6 },
      { course: 'C', floorShare: 1 / 6 },
      { course: 'D', floorShare: 1 / 6 },
    ];
    const concepts = [
      { conceptId: 'a-1', courses: ['A'] },
      { conceptId: 'b-1', courses: ['B'] },
      { conceptId: 'c-1', courses: ['C'] },
      { conceptId: 'd-1', courses: ['D'] },
    ];
    const result = detectEffortImbalance({
      entries: [
        ...minutes('a-1', 15, 0),
        ...minutes('b-1', 15, 100),
        ...minutes('c-1', 15, 200),
        ...minutes('d-1', 15, 300),
      ],
      concepts,
      floorShares: floors,
    });
    expect(result.status).toBe('not-observed');
    expect(result.measured?.widestGapCourse).toBeNull();
  });

  it('a course under the ratio but still above MIN_GAP-scale attention does not fire once it clears SHORTFALL_RATIO_K', () => {
    // A receives 60% of its own floor share worth of attention — a real
    // shortfall, but not the "under half" the pin is set at.
    const floorShare = 1 / 6;
    const floors: readonly CourseFloorShare[] = [
      { course: 'A', floorShare },
      { course: 'B', floorShare: 1 - floorShare },
    ];
    const concepts = [
      { conceptId: 'a-1', courses: ['A'] },
      { conceptId: 'b-1', courses: ['B'] },
    ];
    // total = 100 units; A's share = 0.6 * floorShare * 100.
    const aMinutes = Math.round(0.6 * floorShare * 100);
    const result = detectEffortImbalance({
      entries: [...minutes('a-1', aMinutes, 0), ...minutes('b-1', 100 - aMinutes, 200)],
      concepts,
      floorShares: floors,
    });
    expect(result.status).toBe('not-observed');
    const a = result.measured?.courses.find((c) => c.course === 'A');
    expect(a !== undefined && a.timeShare / a.floorShare).toBeGreaterThanOrEqual(SHORTFALL_RATIO_K);
  });

  it('a changed policy mid-window: stale attention outside the D-092 sittings window does not save a course from firing', () => {
    // Two courses, n=2 → window width = 2 + WINDOW_SLACK_SESSIONS(2) = 4
    // sittings (`windowWidthSessions`). Two OLD sittings (well before the
    // window, separated from the rest by a multi-hour silence) give course A
    // substantial historical time; the four most RECENT sittings give A
    // nothing at all. Reading the whole history unwindowed would show A with
    // real, floor-clearing time overall — reading only the true D-092 window
    // (this bead's fix) shows A completely neglected right now.
    const floorShare = 0.25; // n=2 real floor: max(0.12, 1/(2+2)) = 0.25
    const floors: readonly CourseFloorShare[] = [
      { course: 'A', floorShare },
      { course: 'B', floorShare },
    ];
    const concepts = [
      { conceptId: 'a-1', courses: ['A'] },
      { conceptId: 'b-1', courses: ['B'] },
    ];

    const oldSittingA = (sittingIndex: number, baseHour: number) =>
      Array.from({ length: 45 }, (_, i) =>
        review(
          ['a-1'],
          sittingIndex * 100 + i,
          MINUTE,
          `2026-01-01T${String(baseHour).padStart(2, '0')}:${String(i).padStart(2, '0')}:00+00:00`,
        ),
      );
    const recentSittingB = (sittingIndex: number, dayOffset: number) =>
      Array.from({ length: 45 }, (_, i) =>
        review(
          ['b-1'],
          1000 + sittingIndex * 100 + i,
          MINUTE,
          `2026-02-0${dayOffset}T09:${String(i).padStart(2, '0')}:00+00:00`,
        ),
      );

    const entries: ReviewLogEntry[] = [
      // Two old sittings (>45 minutes apart from everything else), all A.
      ...oldSittingA(0, 0),
      ...oldSittingA(1, 3),
      // Four recent sittings (separate days, well over the 45-minute gap
      // apart), all B — this is the D-092 window.
      ...recentSittingB(0, 1),
      ...recentSittingB(1, 2),
      ...recentSittingB(2, 3),
      ...recentSittingB(3, 4),
    ];

    const result = detectEffortImbalance({ entries, concepts, floorShares: floors });
    expect(result.status).toBe('observed');
    expect(result.measured?.widestGapCourse).toBe('A');
    const a = result.measured?.courses.find((c) => c.course === 'A');
    // Windowed correctly, A's in-window time is zero — the old sittings
    // never entered the accounting.
    expect(a?.timeMs).toBe(0);
  });

  it('shared-course concepts are counted once per course under the windowed accounting too', () => {
    const floors: readonly CourseFloorShare[] = [
      { course: 'A', floorShare: 1 / 6 },
      { course: 'B', floorShare: 1 / 6 },
      { course: 'C', floorShare: 1 / 6 },
      { course: 'D', floorShare: 1 / 6 },
    ];
    const concepts = [
      { conceptId: 'shared', courses: ['A', 'B'] },
      { conceptId: 'c-1', courses: ['C'] },
      { conceptId: 'd-1', courses: ['D'] },
    ];
    const result = detectEffortImbalance({
      // One record, two concepts, both naming A and B: the record's minute
      // counts once for A and once for B, never twice for either.
      entries: [
        ...Array.from({ length: 20 }, (_, i) => review(['shared'], i, MINUTE)),
        ...minutes('c-1', 20, 100),
        ...minutes('d-1', 20, 200),
      ],
      concepts,
      floorShares: floors,
    });
    const a = result.measured?.courses.find((c) => c.course === 'A');
    const b = result.measured?.courses.find((c) => c.course === 'B');
    expect(a?.timeMs).toBe(20 * MINUTE);
    expect(b?.timeMs).toBe(20 * MINUTE);
  });
});
