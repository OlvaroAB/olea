/**
 * The effort reading's own behaviour, on hand-built logs and composition records
 * (`ol-egov.141.89.11.18`; the standing-views spec, service repo, `vew.md` section 2.4). The
 * persona pairing (fires on `lopsided-effort`, quiet on its neutralised twin) lives in
 * `packages/workbench/test/trends-scenarios.spec.ts`.
 *
 * Every fixture here is built from sessions: each session sits on its own day (well past C5.5's
 * 45-minute gap), its reviews one minute apart, each review linked by `compositionId` to the
 * composition record that served it, unless a test says otherwise. Course and concept ids are
 * invented letters.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { RECEIVED_SECONDS_PER_ITEM_CAP } from '../session/cluster.js';
import {
  type CompositionRecord,
  parseCompositionRecord,
} from '../study-session/composition-record.js';
import {
  detectEffortImbalance,
  type EffortComposition,
  type EffortInput,
  MIN_GAP,
  MIN_TIMED_REVIEWS,
  SHORTFALL_RATIO_K,
} from './effort.js';
import type { ConceptCourses } from './types.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-01-05T09:00:00Z');

const CONCEPTS: readonly ConceptCourses[] = [
  { conceptId: 'a-1', courses: ['A'] },
  { conceptId: 'b-1', courses: ['B'] },
  { conceptId: 'c-1', courses: ['C'] },
  { conceptId: 'd-1', courses: ['D'] },
  { conceptId: 'e-1', courses: ['E'] },
  { conceptId: 'shared', courses: ['A', 'B'] },
];

const EVEN: Readonly<Record<string, number>> = { A: 0.3, B: 0.3 };

function review(
  conceptId: string,
  index: number,
  timestamp: string,
  durationMs: number | null,
  compositionId: string | null,
): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: `e${index}`,
    timestamp,
    instrumentId: `qa:${conceptId}:${index}`,
    instrumentType: 'qa',
    conceptIds: [conceptId],
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
    ...(compositionId === null ? {} : { compositionId }),
  };
}

interface SessionSpec {
  /** The record's one course. `null` builds a record naming no course. */
  readonly course: string | null;
  /** The concept every review in the session is on; defaults to the course's own. */
  readonly concept?: string;
  readonly reviews: number;
  /** Per-review durations, overriding one minute each from the start of the session. */
  readonly durations?: readonly (number | null)[];
  /** The frozen floor shares the session was composed under. */
  readonly floors?: Readonly<Record<string, number>>;
  /** `'none'`: the reviews carry no `compositionId` and no record is written. `'orphan'`: they carry one no record has. */
  readonly link?: 'record' | 'none' | 'orphan';
}

function allocation(floors: Readonly<Record<string, number>>): EffortComposition['planAllocation'] {
  return Object.entries(floors).map(([courseId, value]) => ({
    courseId,
    contributions: [{ name: 'floor', value }],
  }));
}

/** One session per spec, oldest first, one day apart. */
function world(specs: readonly SessionSpec[]): {
  entries: ReviewLogEntry[];
  compositions: EffortComposition[];
} {
  const entries: ReviewLogEntry[] = [];
  const compositions: EffortComposition[] = [];
  let index = 0;
  specs.forEach((spec, s) => {
    const compositionId = `composition-${s}`;
    const link = spec.link ?? 'record';
    if (link === 'record') {
      compositions.push({
        compositionId,
        course: spec.course,
        planAllocation: allocation(spec.floors ?? EVEN),
      });
    }
    const concept = spec.concept ?? `${(spec.course ?? 'a').toLowerCase()}-1`;
    for (let r = 0; r < spec.reviews; r += 1) {
      const at = new Date(START + s * DAY + r * MINUTE).toISOString();
      const given = spec.durations;
      const duration = given !== undefined && r < given.length ? (given[r] ?? null) : MINUTE;
      entries.push(review(concept, index, at, duration, link === 'none' ? null : compositionId));
      index += 1;
    }
  });
  return { entries, compositions };
}

function run(specs: readonly SessionSpec[], extra: Partial<EffortInput> = {}) {
  const { entries, compositions } = world(specs);
  return detectEffortImbalance({ entries, concepts: CONCEPTS, compositions, ...extra });
}

function course(result: ReturnType<typeof run>, id: string) {
  return result.measured?.courses.find((c) => c.course === id);
}

/** Four twelve-review sessions: two courses, n = 2, so the window is exactly these four. */
const BALANCED: readonly SessionSpec[] = [
  { course: 'A', reviews: 12 },
  { course: 'B', reviews: 12 },
  { course: 'A', reviews: 12 },
  { course: 'B', reviews: 12 },
];
const B_ONLY: readonly SessionSpec[] = [
  { course: 'B', reviews: 12 },
  { course: 'B', reviews: 12 },
  { course: 'B', reviews: 12 },
  { course: 'B', reviews: 12 },
];

describe('effort: received time is capped active time (C5.5, [D-091])', () => {
  it('caps each review at the declared per-item cap, read from its one declared home', () => {
    const hour = 60 * MINUTE;
    const result = run([
      { course: 'A', reviews: 12, durations: [hour] },
      { course: 'B', reviews: 12 },
      { course: 'A', reviews: 12 },
      { course: 'B', reviews: 12 },
    ]);
    const cap = RECEIVED_SECONDS_PER_ITEM_CAP * 1000;
    expect(course(result, 'A')?.timeMs).toBe(cap + 11 * MINUTE + 12 * MINUTE);
    expect(result.measured?.windowCompositions[0]).toEqual({
      compositionId: 'composition-0',
      course: 'A',
      receivedMs: cap + 11 * MINUTE,
    });
  });

  it('one very long session does not out-vote another course: raw time would fire, capped time does not', () => {
    const hour = 60 * MINUTE;
    const long = [hour, hour, hour];
    const specs: SessionSpec[] = [
      { course: 'A', reviews: 12, durations: long },
      { course: 'B', reviews: 12 },
      { course: 'A', reviews: 12, durations: long },
      { course: 'B', reviews: 12 },
    ];
    const result = run(specs);
    // Capped: A = 2 x (3 x 5 + 9) = 48 minutes, B = 24; B's share is a third, over half its 0.3.
    expect(course(result, 'A')?.timeMs).toBe(48 * MINUTE);
    expect(course(result, 'B')?.timeShare).toBeCloseTo(1 / 3, 12);
    expect(result.status).toBe('not-observed');
    // Raw: A = 378 minutes, B's share 24/402 would sit under half of 0.3 and fire.
    expect(24 / 402).toBeLessThan(SHORTFALL_RATIO_K * 0.3);
  });

  it('a null duration receives nothing and is not a timed review', () => {
    const result = run([
      { course: 'A', reviews: 13, durations: [null] },
      { course: 'B', reviews: 12 },
      { course: 'A', reviews: 12 },
      { course: 'B', reviews: 12 },
    ]);
    expect(result.measured?.timedReviewCount).toBe(48);
    expect(course(result, 'A')?.timeMs).toBe(24 * MINUTE);
  });
});

describe('effort: a review touching two courses counts once, to its session’s one course (F2.18)', () => {
  it('credits the record’s course only, and the window total holds the time once', () => {
    const result = run([
      { course: 'A', concept: 'shared', reviews: 12 },
      { course: 'A', concept: 'shared', reviews: 12 },
      { course: 'A', concept: 'shared', reviews: 12 },
      { course: 'A', concept: 'shared', reviews: 12 },
    ]);
    expect(course(result, 'A')?.timeMs).toBe(48 * MINUTE);
    expect(course(result, 'B')?.timeMs).toBe(0);
    expect(result.measured?.totalTimeMs).toBe(48 * MINUTE);
    // B's concepts were reviewed, but no session was composed for B: under half its set-aside.
    expect(result.status).toBe('observed');
    expect(result.measured?.widestGapCourse).toBe('B');
  });

  it('two concepts of one course in one review still count once', () => {
    const { entries, compositions } = world(BALANCED);
    const doubled = entries.map((entry) =>
      entry.kind === 'review' && entry.conceptIds[0] === 'a-1'
        ? { ...entry, conceptIds: ['a-1', 'shared'] }
        : entry,
    );
    const result = detectEffortImbalance({ entries: doubled, concepts: CONCEPTS, compositions });
    expect(course(result, 'A')?.timeMs).toBe(24 * MINUTE);
    expect(result.measured?.totalTimeMs).toBe(48 * MINUTE);
  });
});

describe('effort: a past window reads the frozen floor shares that composed it ([D-331])', () => {
  it('one plan version over the whole window: the set-aside is that plan’s floor share', () => {
    const result = run(BALANCED);
    expect(course(result, 'A')?.floorShare).toBeCloseTo(0.3, 12);
    expect(course(result, 'B')?.floorShare).toBeCloseTo(0.3, 12);
    expect(result.status).toBe('not-observed');
  });

  it('two plan versions: each session’s frozen share, weighted by its received time', () => {
    const v1 = { A: 0.2, B: 0.4 };
    const v2 = { A: 0.5, B: 0.1 };
    const result = run([
      { course: 'A', reviews: 20, floors: v1 },
      { course: 'B', reviews: 20, floors: v1 },
      { course: 'A', reviews: 10, floors: v2 },
      { course: 'B', reviews: 10, floors: v2 },
    ]);
    // A: (0.2 x 40 + 0.5 x 20) / 60 = 0.3; B: (0.4 x 40 + 0.1 x 20) / 60 = 0.3.
    expect(course(result, 'A')?.floorShare).toBeCloseTo(0.3, 12);
    expect(course(result, 'B')?.floorShare).toBeCloseTo(0.3, 12);
  });

  it('today’s plan is never read for a past session, whatever a caller still passes', () => {
    const v1 = { A: 0.3, B: 0.5 };
    const v2 = { A: 0.3, B: 0.2 };
    const specs: SessionSpec[] = [
      { course: 'A', reviews: 12, floors: v1 },
      { course: 'A', reviews: 12, floors: v1 },
      { course: 'A', reviews: 12, floors: v2 },
      { course: 'B', reviews: 12, floors: v2 },
    ];
    const without = run(specs);
    const withTodaysPlan = run(specs, {
      floorShares: [
        { course: 'A', floorShare: 0.2 },
        { course: 'B', floorShare: 0.6 },
      ],
    });
    expect(withTodaysPlan).toEqual(without);
    // B: share 0.25 against a set-aside of 0.35, not today's 0.6: not under half.
    expect(course(without, 'B')?.floorShare).toBeCloseTo(0.35, 12);
    expect(without.status).toBe('not-observed');
  });

  it('a record read back from the composition log is taken as it is', () => {
    const line = (id: string, courseId: string) => ({
      schemaVersion: 1,
      kind: 'compose',
      compositionId: id,
      sessionId: id,
      parentCompositionId: null,
      composedAt: '2026-01-05T08:59:00+00:00',
      asOf: '2026-01-05',
      reentry: false,
      focusPolicy: 'single',
      course: courseId,
      branch: 'deficit',
      groupingSignal: 'assessment-scope',
      steering: { courses: null, conceptIds: null },
      budgetMinutes: 20,
      planVersion: 'v1',
      policyVersions: {},
      planAllocation: [
        {
          courseId: 'A',
          share: 0.5,
          minBlockSeconds: 300,
          contributions: [{ name: 'floor', value: 0.3 }],
        },
        {
          courseId: 'B',
          share: 0.5,
          minBlockSeconds: 300,
          contributions: [{ name: 'floor', value: 0.3 }],
        },
      ],
      declaredConstants: {
        urgencyOverrideThreshold: 0.07,
        withinBlockProximityHalfLifeDays: 7,
        materialArrivalCohortHalfLifeDays: 7,
      },
      chosen: [],
      setAside: { courses: [], concepts: [], instruments: [] },
    });
    const { entries } = world(BALANCED);
    const records: CompositionRecord[] = BALANCED.map((spec, s) => {
      const parsed = parseCompositionRecord(line(`composition-${s}`, spec.course ?? 'A'));
      if (parsed === null) throw new Error('fixture record does not parse');
      return parsed;
    });
    const result = detectEffortImbalance({ entries, concepts: CONCEPTS, compositions: records });
    expect(result).toEqual(run(BALANCED));
  });
});

describe('effort: comparison unavailable where no record covers the window', () => {
  it('no records at all: unavailable, never computed from anything else, and never not-observed', () => {
    const { entries } = world(BALANCED.map((spec) => ({ ...spec, link: 'none' as const })));
    const result = detectEffortImbalance({
      entries,
      concepts: CONCEPTS,
      floorShares: [
        { course: 'A', floorShare: 0.3 },
        { course: 'B', floorShare: 0.3 },
      ],
    });
    expect(result.status).toBe('comparison-unavailable');
    expect(result.measured).toBeNull();
  });

  it('one session in the window with no record: unavailable', () => {
    const result = run([
      { course: 'A', reviews: 12 },
      { course: 'B', reviews: 12, link: 'none' },
      { course: 'A', reviews: 12 },
      { course: 'B', reviews: 12 },
    ]);
    expect(result.status).toBe('comparison-unavailable');
    expect(result.measured).toBeNull();
  });

  it('a link no record answers, or one two records answer, is no record', () => {
    expect(
      run([
        { course: 'A', reviews: 12 },
        { course: 'B', reviews: 12, link: 'orphan' },
        { course: 'A', reviews: 12 },
        { course: 'B', reviews: 12 },
      ]).status,
    ).toBe('comparison-unavailable');

    const { entries, compositions } = world(BALANCED);
    const first = compositions[0];
    if (first === undefined) throw new Error('fixture');
    const duplicated = [...compositions, { ...first, course: 'B' }];
    expect(
      detectEffortImbalance({ entries, concepts: CONCEPTS, compositions: duplicated }).status,
    ).toBe('comparison-unavailable');
  });

  it('a record naming no one course, or composed with no plan’s floor shares, is unavailable', () => {
    expect(
      run([
        { course: 'A', reviews: 12 },
        { course: null, reviews: 12 },
        { course: 'A', reviews: 12 },
        { course: 'B', reviews: 12 },
      ]).status,
    ).toBe('comparison-unavailable');
    expect(
      run([
        { course: 'A', reviews: 12 },
        { course: 'B', reviews: 12, floors: {} },
        { course: 'A', reviews: 12 },
        { course: 'B', reviews: 12 },
      ]).status,
    ).toBe('comparison-unavailable');
  });

  it('unrecorded history before the window does not withhold a window that is recorded', () => {
    const result = run([
      { course: 'A', reviews: 12, link: 'none' },
      { course: 'A', reviews: 12, link: 'none' },
      ...BALANCED,
    ]);
    expect(result.status).toBe('not-observed');
    expect(result.measured?.windowCompositions.map((c) => c.compositionId)).toEqual([
      'composition-2',
      'composition-3',
      'composition-4',
      'composition-5',
    ]);
  });

  it('too little history at all reads not enough history, record or none', () => {
    const { entries } = world([
      { course: 'A', reviews: 10, link: 'none' },
      { course: 'B', reviews: 10, link: 'none' },
    ]);
    const result = detectEffortImbalance({ entries, concepts: CONCEPTS });
    expect(result.status).toBe('not-enough-history');
  });
});

describe('effort: the gates ([D-365] keeps both sample floors)', () => {
  it('declines when fewer than two courses carry a frozen floor share in the window', () => {
    const result = run(BALANCED.map((spec) => ({ ...spec, floors: { A: 0.3 } })));
    expect(result.status).toBe('not-enough-history');
    expect(result.measured).toBeNull();
  });

  it('the whole-log gate binds on its own, whatever the windowed floor', () => {
    const specs: SessionSpec[] = [
      { course: 'A', reviews: 10 },
      { course: 'B', reviews: 10 },
      { course: 'A', reviews: 10 },
      { course: 'B', reviews: 9 },
    ];
    const { entries, compositions } = world(specs);
    expect(entries.length).toBe(MIN_TIMED_REVIEWS - 1);
    const result = detectEffortImbalance(
      { entries, concepts: CONCEPTS, compositions },
      { minWindowedTimedReviews: 1 },
    );
    expect(result.status).toBe('not-enough-history');
    expect(result.reason).toContain('whole log');
  });

  it('the windowed gate reads only the window: much history, a thin window, declines', () => {
    const specs: SessionSpec[] = Array.from({ length: 25 }, () => ({ course: 'B', reviews: 2 }));
    const result = run(specs);
    expect(result.status).toBe('not-enough-history');
    const overridden = detectEffortImbalance(
      {
        entries: world(specs).entries,
        concepts: CONCEPTS,
        compositions: world(specs).compositions,
      },
      { minWindowedTimedReviews: 4 },
    );
    expect(overridden.status).toBe('observed');
    expect(overridden.measured?.timedReviewCount).toBe(50);
    expect(overridden.measured?.windowedWeightedReviewCount).toBe(8);
    expect(overridden.measured?.totalTimeMs).toBe(8 * MINUTE);
  });
});

describe('effort: what it measures', () => {
  it('fires on the course under half its set-aside, and names it', () => {
    const result = run(B_ONLY);
    expect(result.status).toBe('observed');
    expect(result.measured?.widestGapCourse).toBe('A');
  });

  it('a course with a frozen floor share and no time is included at zero, never dropped', () => {
    const result = run(B_ONLY);
    expect(course(result, 'A')?.timeMs).toBe(0);
    expect(course(result, 'A')?.timeShare).toBe(0);
    expect(result.measured?.widestGap).toBeCloseTo(0.3, 12);
  });

  it('a course at or above its set-aside while another dominates produces nothing', () => {
    const result = run([
      { course: 'A', reviews: 12, floors: { A: 0.2, B: 0.2 } },
      { course: 'A', reviews: 12, floors: { A: 0.2, B: 0.2 } },
      { course: 'A', reviews: 16, floors: { A: 0.2, B: 0.2 } },
      { course: 'B', reviews: 10, floors: { A: 0.2, B: 0.2 } },
    ]);
    expect(course(result, 'B')?.timeShare).toBeCloseTo(0.2, 12);
    expect(result.status).toBe('not-observed');
    expect(result.measured?.widestGap).toBeGreaterThanOrEqual(0);
  });

  it('time on a course with no frozen floor share is left out of both totals and named', () => {
    const result = run([
      { course: 'A', reviews: 14 },
      { course: 'B', reviews: 14 },
      { course: 'C', reviews: 14 },
      { course: 'A', reviews: 14 },
      { course: 'B', reviews: 14 },
    ]);
    expect(result.measured?.coursesWithoutFloorShare).toEqual(['C']);
    expect(result.measured?.totalTimeMs).toBe(42 * MINUTE);
  });

  it('stale time outside the window does not save a course from firing', () => {
    const result = run([{ course: 'A', reviews: 45 }, { course: 'A', reviews: 45 }, ...B_ONLY]);
    expect(result.status).toBe('observed');
    expect(result.measured?.widestGapCourse).toBe('A');
    expect(course(result, 'A')?.timeMs).toBe(0);
  });

  it('observed always names a measured course; the other states carry no course claim (ol-7j54)', () => {
    const observed = run(B_ONLY);
    expect(observed.measured?.courses.map((c) => c.course)).toContain(
      observed.measured?.widestGapCourse,
    );
    expect(run(BALANCED).measured?.widestGapCourse).toBeNull();
  });

  it('is pure, and reads the same from a shuffled log and shuffled records', () => {
    const { entries, compositions } = world(B_ONLY);
    const snapshot = JSON.stringify(entries);
    const first = detectEffortImbalance({ entries, concepts: CONCEPTS, compositions });
    const second = detectEffortImbalance({
      entries: [...entries].reverse(),
      concepts: CONCEPTS,
      compositions: [...compositions].reverse(),
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});

describe('effort: the shortfall ratio is reachable at every course count ([DOS-C4])', () => {
  for (const n of [4, 5]) {
    it(`n=${n} at the real floor formula: zero attention to one course fires, below the old MIN_GAP`, () => {
      const ids = ['A', 'B', 'C', 'D', 'E'].slice(0, n);
      const floors = Object.fromEntries(ids.map((id) => [id, 1 / (n + 2)]));
      // n + 2 sessions, none composed for A.
      const specs: SessionSpec[] = Array.from({ length: n + 2 }, (_, s) => ({
        course: ids[1 + (s % (n - 1))] ?? 'B',
        reviews: 12,
        floors,
      }));
      const result = run(specs);
      expect(result.status).toBe('observed');
      expect(result.measured?.widestGapCourse).toBe('A');
      expect(course(result, 'A')?.gap).toBeLessThan(MIN_GAP);
    });
  }

  it('a course at 0.6 of its set-aside does not fire', () => {
    const floors = { A: 0.25, B: 0.25 };
    // A: 6 of 40 minutes = 0.15 = 0.6 x 0.25.
    const result = run([
      { course: 'A', reviews: 6, floors },
      { course: 'B', reviews: 12, floors },
      { course: 'B', reviews: 11, floors },
      { course: 'B', reviews: 11, floors },
    ]);
    expect(course(result, 'A')?.timeShare).toBeCloseTo(0.15, 12);
    expect(result.status).toBe('not-observed');
  });
});
