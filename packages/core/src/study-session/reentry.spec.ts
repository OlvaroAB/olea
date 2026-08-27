/**
 * Scenarios: `features/F6-insights.md` (olea-service), F6.6 re-entry
 * composition — @auto:core/study-session/reentry.spec
 *
 * Component register 3.8's own health check, generalised into a reusable
 * verdict by `../checks/reentry-equality.js`; this file proves the
 * production seam (`composeReentrySession`) actually produces the equality
 * that check asserts, and exercises the two constants this module owns.
 */
import { describe, expect, it } from 'vitest';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { ReplayResult } from '../session/replay.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';
import {
  clampReentryBudgetMinutes,
  composeReentrySession,
  isReentryDue,
  REENTRY_ABSENCE_THRESHOLD_DAYS,
  REENTRY_SIZE_FLOOR_MINUTES,
} from './reentry.js';

const AS_OF = '2026-09-14';

// ---------------------------------------------------------------------------
// Fixtures — same shape as ./compose.spec.ts's own, kept local rather than
// shared: reentry.ts is this lane's file, compose.spec.ts is not.
// ---------------------------------------------------------------------------

interface RowSpec {
  readonly conceptName: string;
  readonly gapScore?: number;
  readonly masteryState?: OracleMasteryState;
}

function row(spec: RowSpec, rank: number): GapRow {
  return {
    conceptName: spec.conceptName,
    conceptKey: spec.conceptName,
    course: 'CRS101',
    gapClass: 'mastery-gap' as GapClass,
    rank,
    oracleRank: rank,
    priorityScore: spec.gapScore ?? 5,
    gapScore: spec.gapScore ?? 5,
    readiness: {
      assessmentFormat: 'unknown' as AssessmentFormat,
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: spec.masteryState ?? 'seed',
    targetAssessmentPath: null,
    assessmentFormat: 'unknown' as AssessmentFormat,
    citations: [],
    distinctSourceCount: 1,
    reasoning: 'Because the evidence says so.',
    notePaths: [],
    instrumentCount: 1,
    affordances: ['open-concept', 'build-session'],
  };
}

function rows(specs: readonly RowSpec[]): readonly GapRow[] {
  return specs.map((spec, index) => row(spec, index + 1));
}

function qa(instrumentId: string, conceptIds: readonly string[]): QaInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    courses: ['CRS101'],
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    card: {
      type: 'qa',
      style: 'single-line',
      front: 'Front?',
      back: 'Back.',
      reversed: false,
      raw: 'Front?::Back.',
      span: { start: 0, end: 13 },
      blockId: null,
      foreignScheduling: null,
    },
  };
}

function flatDurations(seconds: number): DurationModel {
  const estimates = (['qa', 'cloze', 'mcq'] as const).map((instrumentType) => ({
    instrumentType,
    seconds,
    source: 'assumed' as const,
    sampleCount: 0,
  }));
  return {
    estimates,
    basis: 'assumed',
    totalSampleCount: 0,
    secondsFor: () => seconds,
    sourceFor: () => 'assumed',
  };
}

function emptyReplay(): ReplayResult {
  return { states: new Map(), replayedCount: 0, skippedCount: 0 };
}

// ---------------------------------------------------------------------------
// isReentryDue — the absence threshold
// ---------------------------------------------------------------------------

describe('isReentryDue', () => {
  it('is false just under the threshold', () => {
    expect(isReentryDue(REENTRY_ABSENCE_THRESHOLD_DAYS - 1)).toBe(false);
  });

  it('is true at and beyond the threshold', () => {
    expect(isReentryDue(REENTRY_ABSENCE_THRESHOLD_DAYS)).toBe(true);
    expect(isReentryDue(REENTRY_ABSENCE_THRESHOLD_DAYS + 100)).toBe(true);
  });

  it('is false for an ordinary same-day-or-next-day gap', () => {
    expect(isReentryDue(0)).toBe(false);
    expect(isReentryDue(1)).toBe(false);
  });

  it('throws on a negative or non-finite day count — there is no such thing as a negative absence', () => {
    expect(() => isReentryDue(-1)).toThrow(/daysSinceLastReview/);
    expect(() => isReentryDue(Number.NaN)).toThrow(/daysSinceLastReview/);
  });
});

// ---------------------------------------------------------------------------
// clampReentryBudgetMinutes — the size floor
// ---------------------------------------------------------------------------

describe('clampReentryBudgetMinutes', () => {
  it('leaves a candidate at or above the floor untouched — it is a floor, never a target', () => {
    expect(clampReentryBudgetMinutes(REENTRY_SIZE_FLOOR_MINUTES)).toBe(REENTRY_SIZE_FLOOR_MINUTES);
    expect(clampReentryBudgetMinutes(REENTRY_SIZE_FLOOR_MINUTES + 15)).toBe(
      REENTRY_SIZE_FLOOR_MINUTES + 15,
    );
  });

  it('raises a candidate below the floor up to it, never lower', () => {
    expect(clampReentryBudgetMinutes(1)).toBe(REENTRY_SIZE_FLOOR_MINUTES);
  });

  it('throws on a non-positive or non-finite candidate', () => {
    expect(() => clampReentryBudgetMinutes(0)).toThrow(/candidateBudgetMinutes/);
    expect(() => clampReentryBudgetMinutes(-5)).toThrow(/candidateBudgetMinutes/);
  });
});

// ---------------------------------------------------------------------------
// composeReentrySession — component register 3.8's whole seam
// ---------------------------------------------------------------------------

describe('composeReentrySession', () => {
  it("F6.6's equality-of-rule property: composing as a re-entry produces the SAME model as composing ordinarily at that same (clamped) budget — no second selection mechanism", () => {
    const theRows = rows([
      { conceptName: 'A', gapScore: 9, masteryState: 'sprout' },
      { conceptName: 'B', gapScore: 8, masteryState: 'sapling' },
      { conceptName: 'C', gapScore: 7 },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['A']),
      qa('b1', ['B']),
      qa('c1', ['C']),
    ]);

    const reentry = composeReentrySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      durations: flatDurations(60),
      asOf: AS_OF,
      daysSinceLastReview: 21,
      candidateBudgetMinutes: REENTRY_SIZE_FLOOR_MINUTES,
      ordinaryBudgetMinutes: 20,
    });

    // The literal comparator: the same underlying call, made directly, at
    // the SAME budget the re-entry path above resolved to. If this module
    // ever grew a second selection mechanism, this equality is exactly what
    // would break.
    const ordinaryAtSameBudget = composeReentrySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      durations: flatDurations(60),
      asOf: AS_OF,
      daysSinceLastReview: 0, // not a re-entry
      candidateBudgetMinutes: REENTRY_SIZE_FLOOR_MINUTES,
      ordinaryBudgetMinutes: REENTRY_SIZE_FLOOR_MINUTES, // same number, ordinary path
    });

    expect(reentry.isReentry).toBe(true);
    expect(ordinaryAtSameBudget.isReentry).toBe(false);
    expect(reentry.full.model).toEqual(ordinaryAtSameBudget.full.model);
  });

  it('takes the ordinary budget, unmodified, when the absence does not clear the threshold', () => {
    const theRows = rows([{ conceptName: 'A', gapScore: 9 }]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A'])]);

    const result = composeReentrySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      durations: flatDurations(60),
      asOf: AS_OF,
      daysSinceLastReview: 2,
      candidateBudgetMinutes: 1, // would be floored if this were a re-entry — it is not
      ordinaryBudgetMinutes: 20,
    });

    expect(result.isReentry).toBe(false);
    expect(result.full.model.budgetMinutes).toBe(20);
  });

  it('clamps a too-small candidate to the size floor when it IS a re-entry', () => {
    const theRows = rows([{ conceptName: 'A', gapScore: 9 }]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A'])]);

    const result = composeReentrySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      durations: flatDurations(60),
      asOf: AS_OF,
      daysSinceLastReview: REENTRY_ABSENCE_THRESHOLD_DAYS,
      candidateBudgetMinutes: 1,
      ordinaryBudgetMinutes: 20,
    });

    expect(result.isReentry).toBe(true);
    expect(result.full.model.budgetMinutes).toBe(REENTRY_SIZE_FLOOR_MINUTES);
  });

  it("F6.6: the re-entry VIEW carries no count of what accumulated — 'leftOutInstrumentCount' and 'consideredRowCount' are structurally absent", () => {
    const theRows = rows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 1 },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]);

    const result = composeReentrySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      durations: flatDurations(60),
      asOf: AS_OF,
      daysSinceLastReview: 30,
      candidateBudgetMinutes: REENTRY_SIZE_FLOOR_MINUTES,
      ordinaryBudgetMinutes: 20,
    });

    // The banned counts are still on `full` (composeSessionRows/
    // buildComposedStudySession's own honest output) — only `view`, the
    // rendering-facing shape, must never carry them.
    expect('leftOutInstrumentCount' in result.view).toBe(false);
    expect('consideredRowCount' in result.view).toBe(false);
    expect(typeof result.full.model.leftOutInstrumentCount).toBe('number');
    expect(typeof result.full.model.consideredRowCount).toBe('number');
  });

  it('a genuine second selection mechanism WOULD fail the equality this test relies on — proof the check can fail', () => {
    // Adversarial construction: two calls that are NOT the same rule at the
    // same budget (different budgets), standing in for what a real second
    // selection mechanism would produce — a session that differs for a
    // reason other than the budget number. This is the negative case
    // `../checks/reentry-equality.spec.ts` exercises properly; asserted
    // here too so this file's own equality assertion above is not
    // vacuously true (e.g. of two empty sessions).
    const theRows = rows([
      { conceptName: 'A', gapScore: 9 },
      { conceptName: 'B', gapScore: 8 },
      { conceptName: 'C', gapScore: 7 },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['A']),
      qa('b1', ['B']),
      qa('c1', ['C']),
    ]);

    const small = composeReentrySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      durations: flatDurations(60),
      asOf: AS_OF,
      daysSinceLastReview: 21,
      candidateBudgetMinutes: REENTRY_SIZE_FLOOR_MINUTES,
      ordinaryBudgetMinutes: 20,
    });
    const large = composeReentrySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      durations: flatDurations(60),
      asOf: AS_OF,
      daysSinceLastReview: 0,
      candidateBudgetMinutes: REENTRY_SIZE_FLOOR_MINUTES,
      ordinaryBudgetMinutes: 20,
    });

    expect(small.full.model).not.toEqual(large.full.model);
  });
});
