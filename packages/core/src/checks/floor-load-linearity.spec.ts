// Floor load's flatten-vs-linear health check (register row 3.7) —
// @auto:core/checks/floor-load-linearity.spec
//
// Two kinds of evidence, per this bead's acceptance criteria:
//  - RED: a fixture built to track LINEARLY (floor load's share of concept
//    count never falls) — checkFloorLoadLinearity must fail it.
//  - GREEN: the shipped 5/12/21-day ladder (RETRIEVAL_BASELINE_STAGE_LADDER_DAYS),
//    run through the same production classifyObligation this package's own
//    composeSessionRows calls, over successive compositions of a growing,
//    naturally-maturing concept set — checkFloorLoadLinearity must pass it.
import { describe, expect, it } from 'vitest';
import { type FloorLoadConcept, floorLoadOf } from '../session/floor-load.js';
import {
  type ObligationSignals,
  RETRIEVAL_BASELINE_STAGE_LADDER_DAYS,
} from '../study-session/compose.js';
import { type CalendarDay, shiftCalendarDay } from '../today/calendar-day.js';
import {
  checkFloorLoadLinearity,
  FLOOR_LOAD_FLATTENING_FLOOR,
  type FloorLoadSample,
} from './floor-load-linearity.js';

const ASOF: CalendarDay = '2026-06-01';

// ---------------------------------------------------------------------------
// GREEN fixture: a vault that grows one concept at a time (oldest at index 0,
// newest at index conceptCount - 1) where a concept's mastery stage tracks
// its age exactly the way the shipped product intends — a fixed-size window
// of recently-added material is still climbing sprout -> sapling, and
// everything older has matured onto tree's 21-day rung. This is the
// production ladder doing exactly its named job: as the vault grows, a
// SHRINKING share of it sits in the tight, frequent sprout/sapling window.
//
// `daysSinceLastRetrieval` is spread deterministically across each stage's
// own ladder rung (`i % (ladder + 1)`), so exactly one concept in every
// `ladder + 1` is due today — a steady-state population, not one rigged to
// pass. No RNG: the fixture is exactly reproducible.
// ---------------------------------------------------------------------------

/** Concepts newer than this (by age rank, 0 = newest) are still 'sprout'. */
const SPROUT_WINDOW = 12;
/** Concepts newer than this (by age rank) but past the sprout window are 'sapling'; everything older is 'tree'. */
const IMMATURE_WINDOW = 30;

function stageForAgeRank(ageRank: number): 'sprout' | 'sapling' | 'tree' {
  if (ageRank < SPROUT_WINDOW) return 'sprout';
  if (ageRank < IMMATURE_WINDOW) return 'sapling';
  return 'tree';
}

function maturingVaultConcepts(conceptCount: number): readonly FloorLoadConcept[] {
  const concepts: FloorLoadConcept[] = [];
  for (let i = 0; i < conceptCount; i += 1) {
    // i = 0 is the oldest concept in this composition; i = conceptCount - 1
    // is the newest. ageRank 0 = newest, growing as concepts get older.
    const ageRank = conceptCount - 1 - i;
    const stage = stageForAgeRank(ageRank);
    const ladder = RETRIEVAL_BASELINE_STAGE_LADDER_DAYS[stage];
    const daysSince = i % (ladder + 1);
    const signals: ObligationSignals = {
      masteryState: stage,
      lastRetrievalDay: shiftCalendarDay(ASOF, -daysSince),
      recallDueDay: null,
      arrivalDay: null,
      asOf: ASOF,
    };
    concepts.push({ conceptKey: `concept-${i}`, signals });
  }
  return concepts;
}

function greenSamples(): readonly FloorLoadSample[] {
  return [40, 80, 160, 320].map((conceptCount) => {
    const tally = floorLoadOf(maturingVaultConcepts(conceptCount));
    return { conceptCount: tally.conceptCount, floorLoad: tally.floorLoad };
  });
}

// ---------------------------------------------------------------------------
// RED fixture: the "frequency rule is not working" shape named verbatim by
// the register row this check implements — every concept baseline-due every
// single day, however large the concept set grows. This is what
// `study-session/compose.ts`'s own module doc says the design explicitly
// refuses ("baseline obligation is a SET, not a queue... nothing here
// accrues a debt of retrievals") — a fixture built to violate exactly that.
// ---------------------------------------------------------------------------

function alwaysOverdueConcepts(conceptCount: number): readonly FloorLoadConcept[] {
  const concepts: FloorLoadConcept[] = [];
  for (let i = 0; i < conceptCount; i += 1) {
    const signals: ObligationSignals = {
      masteryState: 'tree',
      // 30 days ago is well past tree's 21-day rung for every concept, at
      // every concept count — nothing here ever mints an 'elective' entry.
      lastRetrievalDay: shiftCalendarDay(ASOF, -30),
      recallDueDay: null,
      arrivalDay: null,
      asOf: ASOF,
    };
    concepts.push({ conceptKey: `concept-${i}`, signals });
  }
  return concepts;
}

function redLinearSamples(): readonly FloorLoadSample[] {
  return [40, 80, 160, 320].map((conceptCount) => {
    const tally = floorLoadOf(alwaysOverdueConcepts(conceptCount));
    return { conceptCount: tally.conceptCount, floorLoad: tally.floorLoad };
  });
}

describe('checkFloorLoadLinearity', () => {
  it('SEEN RED: fails a fixture built to track linearly with concept count', () => {
    const samples = redLinearSamples();
    // Every concept is baseline-due at every sampled concept count — the
    // share is exactly 1 throughout, the sharpest possible "linear" shape.
    expect(samples.every((s) => s.floorLoad === s.conceptCount)).toBe(true);

    const verdict = checkFloorLoadLinearity(samples);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.shareDropFraction).toBe(0);
    expect(verdict.measured.monotonicNonIncreasing).toBe(true);
    expect(verdict.detail).toContain('tracks close to linearly');
  });

  it('SEEN GREEN: passes the shipped 5/12/21-day ladder over a naturally maturing, growing concept set', () => {
    const samples = greenSamples();

    const verdict = checkFloorLoadLinearity(samples);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.monotonicNonIncreasing).toBe(true);
    expect(verdict.measured.shareDropFraction).not.toBeNull();
    expect(verdict.measured.shareDropFraction as number).toBeGreaterThanOrEqual(
      FLOOR_LOAD_FLATTENING_FLOOR,
    );
    // The share falls across the first three doublings (a fixed-size
    // sprout/sapling window against a tree bucket that keeps absorbing
    // material) and only ties at the last step, once the tree bucket
    // dominates enough that doubling N doubles floor load almost exactly —
    // the ladder's own asymptote, not a bug in the fixture.
    const shares = verdict.measured.shares;
    for (let i = 1; i < shares.length; i += 1) {
      expect(shares[i]).toBeLessThanOrEqual(shares[i - 1] as number);
    }
    expect(shares[0]).toBeGreaterThan(shares[shares.length - 1] as number);
    expect(verdict.detail).toContain('flattening, not linear tracking');
  });

  it('declines a series with fewer than two samples — a check that ran nothing cannot report a pass', () => {
    expect(checkFloorLoadLinearity([]).ok).toBe(false);
    expect(checkFloorLoadLinearity([{ conceptCount: 40, floorLoad: 5 }]).ok).toBe(false);
  });

  it('declines a series with a tie in concept count, even with three points', () => {
    const tie = checkFloorLoadLinearity([
      { conceptCount: 40, floorLoad: 5 },
      { conceptCount: 40, floorLoad: 6 },
    ]);
    expect(tie.ok).toBe(false);
    expect(tie.detail).toContain('strictly increasing');

    const tieAmongThree = checkFloorLoadLinearity([
      { conceptCount: 40, floorLoad: 5 },
      { conceptCount: 80, floorLoad: 6 },
      { conceptCount: 80, floorLoad: 7 },
    ]);
    expect(tieAmongThree.ok).toBe(false);
    expect(tieAmongThree.detail).toContain('strictly increasing');
  });

  it('sorts an out-of-order-but-otherwise-valid series before testing it, rather than rejecting it', () => {
    const inOrder = checkFloorLoadLinearity([
      { conceptCount: 40, floorLoad: 20 }, // share 0.5
      { conceptCount: 80, floorLoad: 16 }, // share 0.2
    ]);
    const reversed = checkFloorLoadLinearity([
      { conceptCount: 80, floorLoad: 16 },
      { conceptCount: 40, floorLoad: 20 },
    ]);
    expect(reversed).toEqual(inOrder);
  });

  it('fails when the share rises at any step, even if the endpoints would otherwise pass', () => {
    const verdict = checkFloorLoadLinearity([
      { conceptCount: 100, floorLoad: 50 }, // share 0.50
      { conceptCount: 200, floorLoad: 60 }, // share 0.30 (down)
      { conceptCount: 300, floorLoad: 105 }, // share 0.35 (UP)
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.monotonicNonIncreasing).toBe(false);
    expect(verdict.detail).toContain('not monotonically flattening');
  });

  it("the flattening floor's own boundary: exactly the declared fraction passes, a hair under it fails", () => {
    const atFloor = checkFloorLoadLinearity([
      { conceptCount: 100, floorLoad: 50 }, // share 0.50
      { conceptCount: 200, floorLoad: 80 }, // share 0.40 — a 20.0% drop, exactly FLOOR_LOAD_FLATTENING_FLOOR
    ]);
    expect(atFloor.measured.shareDropFraction).toBeCloseTo(FLOOR_LOAD_FLATTENING_FLOOR, 10);
    expect(atFloor.ok).toBe(true);

    const underFloor = checkFloorLoadLinearity([
      { conceptCount: 100, floorLoad: 50 }, // share 0.50
      { conceptCount: 200, floorLoad: 81 }, // share 0.405 — a 19% drop, just short
    ]);
    expect(underFloor.ok).toBe(false);
  });
});
