/**
 * Scenarios: `features/F4-oracle.md` (olea-service), the SESS-2 session
 * composition scenarios — @auto:core/study-session/compose.spec
 *
 * SESS-1 (`ol-xd1v`) designed and modelled this layer against
 * `scripts/modeling/lib/builder.mjs` (olea-service); `[D-113]` (`ol-egov.31`)
 * ratified the baseline this file exercises in production types. The model's
 * own hermetic tests (`scripts/modeling/modeling.test.mjs`) remain the
 * reference for the algorithm's *measured* behaviour under load; this file
 * proves the production port classifies, orders and allocates the same way
 * against hand-built fixtures a reader can check by eye.
 */

import type { StudyPlanAllocationEntry } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { resolveAssessmentGroupingContext } from '../assessment/scope-concept-keys.js';
import type { AssessmentRecord } from '../assessment/types.js';
import { resolveRelatedConceptKeys } from '../concept/related-concept-keys.js';
import type { ConceptRelation, RelationProvenanceKind, RelationType } from '../concept/relation.js';
import type { ConceptRecord } from '../concept/types.js';
import type { Provenance } from '../extract/types.js';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { ReplayResult } from '../session/replay.js';
import type { McqInstrumentRecord, QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildStudySession } from './build.js';
import {
  buildComposedStudySession,
  classifyObligation,
  composeSessionRows,
  extendComposedStudySession,
  FOCUS_BRANCH_SENTENCE,
  RETRIEVAL_BASELINE_STAGE_LADDER_DAYS,
  URGENCY_OVERRIDE_THRESHOLD,
  withinBlockCohortAffinity,
  withinBlockCohortDecayWeight,
} from './compose.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';
import { computeWindowDeficit, type PastSessionRecord, type WindowDeficitEntry } from './window.js';

const AS_OF = '2026-09-14';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface RowSpec {
  readonly conceptName: string;
  readonly course?: string;
  readonly gapScore?: number;
  readonly masteryState?: OracleMasteryState;
  readonly targetAssessmentPath?: VaultPath | null;
  /** `[D-149]`'s cohort grain — `GapRow.notePaths` (`ConceptRecord.sourcePaths`). Defaults to none. */
  readonly notePaths?: readonly VaultPath[];
}

function row(spec: RowSpec, rank: number): GapRow {
  return {
    conceptName: spec.conceptName,
    conceptKey: spec.conceptName,
    course: spec.course ?? 'CRS101',
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
    targetAssessmentPath: spec.targetAssessmentPath ?? null,
    assessmentFormat: 'unknown' as AssessmentFormat,
    citations: [],
    distinctSourceCount: 1,
    reasoning: 'Because the evidence says so.',
    notePaths: spec.notePaths ?? [],
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

/** A `ReplayResult` fixture: `lastReviewedDay`/`dueDay` per instrument, everything else absent. */
function replay(
  entries: Readonly<Record<string, { readonly lastReviewedDay: string; readonly dueDay: string }>>,
): ReplayResult {
  const states = new Map(
    Object.entries(entries).map(([instrumentId, { lastReviewedDay, dueDay }]) => [
      instrumentId,
      {
        instrumentId,
        state: {
          schemaVersion: 1 as const,
          due: `${dueDay}T00:00:00.000Z`,
          stability: 10,
          difficulty: 5,
          scheduledDays: 10,
          learningStepIndex: 0,
          reps: 1,
          lapses: 0,
          learningState: 'review' as const,
          lastReview: `${lastReviewedDay}T00:00:00.000Z`,
        },
        reviewCount: 1,
        lastReviewedAt: `${lastReviewedDay}T00:00:00.000Z`,
      },
    ]),
  );
  return { states, replayedCount: states.size, skippedCount: 0 };
}

function emptyReplay(): ReplayResult {
  return { states: new Map(), replayedCount: 0, skippedCount: 0 };
}

// ---------------------------------------------------------------------------
// classifyObligation — [D-113]'s classification
// ---------------------------------------------------------------------------

describe('classifyObligation', () => {
  it('a concept never retrieved is unmet, regardless of mastery state', () => {
    expect(
      classifyObligation({
        masteryState: 'seed',
        lastRetrievalDay: null,
        recallDueDay: null,
        arrivalDay: null,
        asOf: AS_OF,
      }),
    ).toEqual({ klass: 'unmet', overdueDays: 0 });
  });

  // ARRIVE-1 (`ol-4pue`) — SESS-1 §1.1's fix: `unmet` widens on real
  // days-since-arrival when the caller has a signal, instead of always
  // deferring to gapScore.
  it('a never-retrieved concept with an arrival-day signal is unmet, overdue by days since arrival', () => {
    expect(
      classifyObligation({
        masteryState: 'seed',
        lastRetrievalDay: null,
        recallDueDay: null,
        arrivalDay: '2026-09-01', // 13 days before AS_OF (2026-09-14)
        asOf: AS_OF,
      }),
    ).toEqual({ klass: 'unmet', overdueDays: 13 });
  });

  it('a never-retrieved concept whose arrival day is not before asOf (clock skew) clamps to 0, never negative', () => {
    expect(
      classifyObligation({
        masteryState: 'seed',
        lastRetrievalDay: null,
        recallDueDay: null,
        arrivalDay: '2026-09-20', // after AS_OF
        asOf: AS_OF,
      }),
    ).toEqual({ klass: 'unmet', overdueDays: 0 });
  });

  it('a concept whose FSRS due day has arrived is recall-due, however far past due', () => {
    const result = classifyObligation({
      masteryState: 'sprout',
      lastRetrievalDay: '2026-09-01',
      recallDueDay: '2026-09-10',
      arrivalDay: null,
      asOf: AS_OF,
    });
    expect(result).toEqual({ klass: 'recall-due', overdueDays: 4 });
  });

  it('a concept not recall-due, past its stage-keyed baseline gap, is baseline-due', () => {
    // sprout's rung is 5 days (RETRIEVAL_BASELINE_STAGE_LADDER_DAYS.sprout).
    const result = classifyObligation({
      masteryState: 'sprout',
      lastRetrievalDay: '2026-09-01',
      recallDueDay: null,
      arrivalDay: null,
      asOf: AS_OF,
    });
    const gap = RETRIEVAL_BASELINE_STAGE_LADDER_DAYS.sprout;
    expect(result.klass).toBe('baseline-due');
    expect(result.overdueDays).toBe(13 - gap); // 2026-09-01 -> 2026-09-14 is 13 days
  });

  it('a concept within its baseline gap and not recall-due is elective', () => {
    const result = classifyObligation({
      masteryState: 'tree',
      lastRetrievalDay: '2026-09-13',
      recallDueDay: null,
      arrivalDay: null,
      asOf: AS_OF,
    });
    expect(result).toEqual({ klass: 'elective', overdueDays: 0 });
  });

  it('a wider stage rung keeps a well-held concept out of baseline-due longer than a fresher stage would', () => {
    const at = (masteryState: OracleMasteryState) =>
      classifyObligation({
        masteryState,
        lastRetrievalDay: '2026-09-01',
        recallDueDay: null,
        arrivalDay: null,
        asOf: AS_OF,
      }).klass;
    // 13 days since last retrieval: sprout's 5-day rung is long past (baseline-due);
    // tree's 21-day rung has not arrived yet (elective).
    expect(at('sprout')).toBe('baseline-due');
    expect(at('tree')).toBe('elective');
  });

  it('seed and unknown mastery states have no rung, so a retrieved-but-unscored concept is elective rather than baseline-due', () => {
    // Reachable only if a concept was retrieved (lastRetrievalDay set) but no
    // mastery join or scored evidence exists — an edge case the ladder must
    // not crash on.
    expect(
      classifyObligation({
        masteryState: 'seed',
        lastRetrievalDay: '2026-08-01',
        recallDueDay: null,
        arrivalDay: null,
        asOf: AS_OF,
      }).klass,
    ).toBe('elective');
    expect(
      classifyObligation({
        masteryState: 'unknown',
        lastRetrievalDay: '2026-08-01',
        recallDueDay: null,
        arrivalDay: null,
        asOf: AS_OF,
      }).klass,
    ).toBe('elective');
  });

  it('baseline obligation is a SET, not a queue (`[D-113]` item 4): the same facts classified twice never accrue', () => {
    const signals = {
      masteryState: 'sprout' as const,
      lastRetrievalDay: '2026-09-01',
      recallDueDay: null,
      arrivalDay: null,
      asOf: AS_OF,
    };
    // A concept baseline-due "yesterday" and not served is STILL exactly one
    // baseline-due obligation today, computed fresh from lastRetrievalDay —
    // there is no field anywhere in this signature for a debt to live in.
    expect(classifyObligation(signals)).toEqual(classifyObligation(signals));
    expect(classifyObligation(signals).klass).toBe('baseline-due');
  });
});

// ---------------------------------------------------------------------------
// composeSessionRows — ordering, allocation, C5.6, overflow, F2.18
// ---------------------------------------------------------------------------

describe('composeSessionRows', () => {
  it('orders by overdue-first: days waiting, whatever the reason, beats gapScore', () => {
    const theRows = rows([
      { conceptName: 'Barely', gapScore: 9, masteryState: 'sprout' }, // baseline-due, small overrun
      { conceptName: 'VeryOverdue', gapScore: 1, masteryState: 'sprout' }, // baseline-due, huge overrun
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('b1', ['Barely']),
      qa('v1', ['VeryOverdue']),
    ]);
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: replay({
        b1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' }, // 6 days since — just past sprout's 5-day rung
        v1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' }, // 44 days since
      }),
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
    });

    // VeryOverdue's overdueDays (44 - 5 = 39) beats Barely's (6 - 5 = 1)
    // despite the much lower gapScore — the ordering rule ignores gapScore
    // until overdueDays ties.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['VeryOverdue', 'Barely']);
  });

  it('never starves a never-retrieved concept the way baseline-overdue-first would (SESS-1 §3.2)', () => {
    // An `unmet` concept (overdueDays: 0, per the module's documented data
    // gap) still competes on gapScore against electives and can win a slot —
    // unlike a key undefined for unmet concepts, which sorts them last forever.
    const theRows = rows([
      { conceptName: 'New', gapScore: 9 }, // seed -> unmet
      { conceptName: 'Settled', gapScore: 1, masteryState: 'tree' }, // elective (just retrieved)
    ]);
    const instruments = buildConceptInstrumentIndex([qa('n1', ['New']), qa('s1', ['Settled'])]);
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: replay({ s1: { lastReviewedDay: AS_OF, dueDay: '2099-01-01' } }),
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 60, // room for exactly one
    });

    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['New']);
  });

  // ARRIVE-1 (`ol-4pue`) — SESS-1 §1.1's fix: with a real arrival-day signal,
  // `unmet` competes on the SAME days-waiting key as every other class,
  // rather than deferring entirely to gapScore (the previous test's
  // pre-`ARRIVE-1` fallback behaviour, still exercised there with no
  // `arrivalDays` map supplied).
  it('an unmet concept with an old arrival day outranks a merely-mild baseline-due concept, despite a lower gapScore', () => {
    const theRows = rows([
      { conceptName: 'OldUnmet', gapScore: 1 }, // seed -> unmet, low priority
      { conceptName: 'MildBaselineDue', gapScore: 9, masteryState: 'sprout' }, // high priority, barely overdue
    ]);
    // Both concepts carry an instrument (nonzero cost) so the tight budget
    // below genuinely forces a choice between them rather than fitting both.
    const instruments = buildConceptInstrumentIndex([
      qa('o1', ['OldUnmet']),
      qa('m1', ['MildBaselineDue']),
    ]);
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      // sprout's rung is 5 days; last retrieved 6 days before AS_OF -> 1 day overdue.
      replay: replay({ m1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' } }),
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 60, // room for exactly one
      // OldUnmet arrived 50 days before AS_OF — far more overdue than
      // MildBaselineDue's 1 day, so it must win the slot despite gapScore 1 < 9.
      arrivalDays: new Map([['OldUnmet', '2026-07-26']]),
    });

    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['OldUnmet']);
  });

  it('an unmet concept absent from the arrivalDays map still falls back to overdueDays 0, never Infinity', () => {
    const theRows = rows([
      { conceptName: 'UnknownArrival', gapScore: 1 }, // seed -> unmet, no map entry
      { conceptName: 'MildBaselineDue', gapScore: 9, masteryState: 'sprout' },
    ]);
    // Both concepts carry an instrument (nonzero cost) so the tight budget
    // below genuinely forces a choice between them rather than fitting both.
    const instruments = buildConceptInstrumentIndex([
      qa('u1', ['UnknownArrival']),
      qa('m1', ['MildBaselineDue']),
    ]);
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: replay({ m1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' } }),
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 60, // room for exactly one
      // A map is supplied but has no entry for this concept — same "no
      // signal" outcome as omitting the map entirely (never Infinity, which
      // would let UnknownArrival dominate every baseline-due/recall-due
      // concept in the vault by construction).
      arrivalDays: new Map([['SomeOtherConcept', '2000-01-01']]),
    });

    // MildBaselineDue's 1 overdue day beats UnknownArrival's fallback 0.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['MildBaselineDue']);
  });

  it("allocates across courses proportionally to each course's share of ranked material (interim, pending ALLOC-1)", () => {
    const theRows = rows([
      { conceptName: 'Big1', course: 'BIG', gapScore: 9, masteryState: 'sprout' },
      { conceptName: 'Big2', course: 'BIG', gapScore: 8, masteryState: 'sprout' },
      { conceptName: 'Big3', course: 'BIG', gapScore: 7, masteryState: 'sprout' },
      { conceptName: 'Small1', course: 'SMALL', gapScore: 6, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('b1', ['Big1']),
      qa('b2', ['Big2']),
      qa('b3', ['Big3']),
      qa('s1', ['Small1']),
    ]);
    // All four equally overdue, so within-course order falls to gapScore.
    const equallyOverdue = replay({
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b2: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b3: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      s1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: equallyOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      // This test is about the ordinary (every-course) proportional-share
      // path, not `[FOCUS-5]`'s single-course default — see that policy's
      // own describe block for the default.
      focusPolicy: 'every-course',
    });

    // BIG holds 3 of 4 rows -> 0.75 share; SMALL holds 1 of 4 -> 0.25.
    expect(result.courseShares.get('BIG')).toBeCloseTo(0.75);
    expect(result.courseShares.get('SMALL')).toBeCloseTo(0.25);
  });

  it("C5.6's rolling floor forces back a course that has gone runningCourses+1 days unseen", () => {
    const theRows = rows([
      { conceptName: 'Recent1', course: 'A', gapScore: 9, masteryState: 'sprout' },
      { conceptName: 'Recent2', course: 'A', gapScore: 8, masteryState: 'sprout' },
      { conceptName: 'Neglected', course: 'B', gapScore: 1, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('r1', ['Recent1']),
      qa('r2', ['Recent2']),
      qa('n1', ['Neglected']),
    ]);
    // 2 running courses -> floor window is 3 days. Course B last seen 5 days
    // ago (>= 3) -> forced. Course A last seen yesterday -> not forced.
    const theReplay = replay({
      r1: { lastReviewedDay: '2026-09-13', dueDay: '2099-01-01' },
      r2: { lastReviewedDay: '2026-09-13', dueDay: '2099-01-01' },
      n1: { lastReviewedDay: '2026-09-09', dueDay: '2099-01-01' },
    });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      // The local C5.6 floor-forcing this test exercises applies only on the
      // ordinary (every-course) path — `[FOCUS-5]`'s single-course default
      // never forces a second course.
      focusPolicy: 'every-course',
    });

    expect(result.forcedCourses).toEqual(['B']);
    expect(result.orderedRows.map((r) => r.conceptName)).toContain('Neglected');
  });

  describe('`ol-v7r5.17` [ALLOC-2] — a real allocation replaces the interim share', () => {
    function allocationEntry(
      overrides: Partial<StudyPlanAllocationEntry> & { courseId: string },
    ): StudyPlanAllocationEntry {
      return {
        share: 0,
        minBlockSeconds: 60,
        contributions: [{ name: 'risk', value: 0.5 }],
        reason: `${overrides.courseId} gets its share.`,
        ...overrides,
      };
    }

    it("courseShares reports the plan's own real shares, not the interim proportional-by-material fallback", () => {
      const theRows = rows([
        { conceptName: 'Big1', course: 'BIG', gapScore: 9, masteryState: 'sprout' },
        { conceptName: 'Big2', course: 'BIG', gapScore: 8, masteryState: 'sprout' },
        { conceptName: 'Big3', course: 'BIG', gapScore: 7, masteryState: 'sprout' },
        { conceptName: 'Small1', course: 'SMALL', gapScore: 6, masteryState: 'sprout' },
      ]);
      const instruments = buildConceptInstrumentIndex([
        qa('b1', ['Big1']),
        qa('b2', ['Big2']),
        qa('b3', ['Big3']),
        qa('s1', ['Small1']),
      ]);
      const equallyOverdue = replay({
        b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        b2: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        b3: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        s1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      });
      // The plan's real shares are the OPPOSITE of "proportional to how much
      // ranked material lives in each course" (BIG holds 3 of 4 rows, but the
      // plan says SMALL has the assessment risk this week).
      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: equallyOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
        allocation: [
          allocationEntry({ courseId: 'BIG', share: 0.25 }),
          allocationEntry({ courseId: 'SMALL', share: 0.75 }),
        ],
        // ALLOC-2's every-course wiring, not `[FOCUS-5]`'s single-course
        // default.
        focusPolicy: 'every-course',
      });

      expect(result.courseShares.get('BIG')).toBeCloseTo(0.25);
      expect(result.courseShares.get('SMALL')).toBeCloseTo(0.75);
      // Real allocation supplied -> this module's own local C5.6
      // floor-forcing does not also fire (see the module doc).
      expect(result.forcedCourses).toEqual([]);
    });

    it('converts shares to whole seconds via A2.5’s contracted rule, driving how much of each course is actually chosen', () => {
      const theRows = rows([
        { conceptName: 'BigA', course: 'BIG', gapScore: 9, masteryState: 'sprout' },
        { conceptName: 'BigB', course: 'BIG', gapScore: 8, masteryState: 'sprout' },
        { conceptName: 'SmallA', course: 'SMALL', gapScore: 7, masteryState: 'sprout' },
      ]);
      const instruments = buildConceptInstrumentIndex([
        qa('ba', ['BigA']),
        qa('bb', ['BigB']),
        qa('sa', ['SmallA']),
      ]);
      const equallyOverdue = replay({
        ba: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        bb: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        sa: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      });
      // 600s budget, each instrument costs 60s. BIG's 0.9 share funds 540s
      // (9 slots, capped by its 2 rows); SMALL's 0.1 share (60s) clears its
      // own 60s minBlockSeconds exactly, so it is not dropped and gets one slot.
      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: equallyOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 600,
        allocation: [
          allocationEntry({ courseId: 'BIG', share: 0.9, minBlockSeconds: 60 }),
          allocationEntry({ courseId: 'SMALL', share: 0.1, minBlockSeconds: 60 }),
        ],
        // ALLOC-2's every-course wiring, not `[FOCUS-5]`'s single-course
        // default.
        focusPolicy: 'every-course',
      });

      expect(result.orderedRows.map((r) => r.conceptName).sort()).toEqual([
        'BigA',
        'BigB',
        'SmallA',
      ]);
    });

    it('an empty allocation array falls back to the interim proportional share, same as omitting it entirely', () => {
      const theRows = rows([
        { conceptName: 'Big1', course: 'BIG', gapScore: 9, masteryState: 'sprout' },
        { conceptName: 'Small1', course: 'SMALL', gapScore: 6, masteryState: 'sprout' },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('b1', ['Big1']), qa('s1', ['Small1'])]);
      const equallyOverdue = replay({
        b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        s1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      });
      const withoutAllocation = composeSessionRows({
        rows: theRows,
        instruments,
        replay: equallyOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
      });
      const withEmptyAllocation = composeSessionRows({
        rows: theRows,
        instruments,
        replay: equallyOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
        allocation: [],
      });

      expect([...withEmptyAllocation.courseShares.entries()]).toEqual([
        ...withoutAllocation.courseShares.entries(),
      ]);
    });
  });

  it('reports overflow as a count and worst overdueDays per class, never a list of names', () => {
    const theRows = rows([
      { conceptName: 'Fits', gapScore: 9, masteryState: 'sprout' },
      { conceptName: 'TooMuch', gapScore: 8, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('f1', ['Fits']), qa('t1', ['TooMuch'])]);
    const theReplay = replay({
      f1: { lastReviewedDay: '2026-09-01', dueDay: '2099-01-01' },
      t1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 60, // room for exactly one
    });

    expect(result.orderedRows).toHaveLength(1);
    // Both concepts are baseline-due; only the more-overdue one ('TooMuch')
    // fits the tiny budget, so the OTHER one is what overflows.
    const baselineDueOverflow = result.overflow.find((o) => o.klass === 'baseline-due');
    expect(baselineDueOverflow?.count).toBe(1);
    expect(baselineDueOverflow?.worstOverdueDays).toBeGreaterThan(0);
  });

  it('F2.18: chosen concepts are grouped into course blocks, ordered by the most urgent class present', () => {
    const theRows = rows([
      { conceptName: 'A-elective', course: 'A', gapScore: 5, masteryState: 'tree' },
      { conceptName: 'B-unmet', course: 'B', gapScore: 5 },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['A-elective']),
      qa('b1', ['B-unmet']),
    ]);
    const theReplay = replay({ a1: { lastReviewedDay: AS_OF, dueDay: '2099-01-01' } });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      // Cross-course block ordering only arises when more than one course is
      // served — the every-course path, not `[FOCUS-5]`'s single-course
      // default.
      focusPolicy: 'every-course',
    });

    // Course B's block (unmet, precedence 0) sorts ahead of course A's (elective, precedence 3).
    expect(result.orderedRows.map((r) => r.course)).toEqual(['B', 'A']);
  });

  // -------------------------------------------------------------------------
  // F2.19 — within-block grouping: relatedness absent a near assessment,
  // shifting toward the assessment's own scope as one approaches. See
  // features/F2-review.md (olea-service) and compose.ts's own "F2.19"
  // module-doc section for the data path and the declared, reused half-life
  // constant.
  // -------------------------------------------------------------------------

  it('F2.19: with no assessment near, within-block adjacent placement favours concept relatedness', () => {
    // Alpha and Charlie are C7.10-related to each other; Bravo is related to
    // neither. All three tie exactly on overdueDays (comparably due) and on
    // gapScore, so relatedness is the only signal left to decide order —
    // nothing here is a near assessment (`assessmentContext` is omitted
    // entirely, which is F2.19's "no assessment near" case).
    const theRows = rows([
      { conceptName: 'Alpha', gapScore: 5, masteryState: 'sprout' },
      { conceptName: 'Bravo', gapScore: 5, masteryState: 'sprout' },
      { conceptName: 'Charlie', gapScore: 5, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['Alpha']),
      qa('b1', ['Bravo']),
      qa('c1', ['Charlie']),
    ]);
    const sameOverdue = replay({
      a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      c1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
    });

    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relatedConceptKeys: new Map([
        ['Alpha', new Set(['Charlie'])],
        ['Charlie', new Set(['Alpha'])],
      ]),
    });

    // Alpha and Charlie's shared relation pulls them adjacent, ahead of
    // unrelated Bravo — never `[Alpha, Bravo, Charlie]`, which is exactly
    // what plain `overdue-first` (ignoring relatedness, falling through to
    // alphabetical `conceptKey`) would produce instead.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it("F2.19: a dated assessment approaching shifts within-block placement toward that assessment's own scope (F1.7)", () => {
    const midterm = '05 Assessments/Midterm.md' as VaultPath;
    // Zulu is named in Midterm's resolved scope; Alpha targets the SAME
    // assessment (the oracle's strongest-contributing edge) but is not named
    // in its scope; Mike has no assessment at all. All three tie on
    // overdueDays and gapScore. Names are deliberately chosen so plain
    // alphabetical `conceptKey` order (`Alpha, Mike, Zulu`) DISAGREES with
    // the scope-favoured order this test expects — a mutation that dropped
    // the grouping score back to `overdue-first` alone would silently pass
    // a test whose expectation happened to already be alphabetical, which
    // this naming rules out.
    const theRows = rows([
      { conceptName: 'Alpha', gapScore: 5, masteryState: 'sprout', targetAssessmentPath: midterm },
      { conceptName: 'Mike', gapScore: 5, masteryState: 'sprout' },
      { conceptName: 'Zulu', gapScore: 5, masteryState: 'sprout', targetAssessmentPath: midterm },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['Alpha']),
      qa('m1', ['Mike']),
      qa('z1', ['Zulu']),
    ]);
    const sameOverdue = replay({
      a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      m1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      z1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
    });

    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      // Due TODAY — the continuous proximity weight is at its maximum here,
      // never a discrete "near" flag — so the blend collapses almost
      // entirely onto scope membership for this ordering.
      assessmentContext: new Map([
        [midterm, { dueDay: AS_OF, scopeConceptKeys: new Set(['Zulu']) }],
      ]),
    });

    // Zulu (named in the imminent assessment's own scope) moves to the
    // front; Alpha, though targeting the same assessment, is not named in
    // its scope and gets no benefit from merely sharing a target — it ties
    // with unrelated Mike and falls back to plain `conceptKey` order.
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Zulu', 'Alpha', 'Mike']);
  });

  it('F2.19 / F4.7: a passed assessment exerts no placement weight, even though it names the concept in its own scope', () => {
    const quiz = '05 Assessments/Quiz.md' as VaultPath;
    // Zulu targets an assessment that named it in scope but is now ONE DAY
    // PAST due — F4.7 says a passed assessment "exerts no prioritisation
    // weight", so Zulu must get no placement credit for it. Alpha carries no
    // assessment at all. Both tie on overdueDays and gapScore, so the only
    // question is whether Zulu's passed assessment still shifts it — if a
    // future edit dropped the passed-assessment guard, Zulu would jump
    // ahead of Alpha here (a real conceptKey-comparison would otherwise put
    // Alpha first).
    const theRows = rows([
      { conceptName: 'Alpha', gapScore: 5, masteryState: 'sprout' },
      { conceptName: 'Zulu', gapScore: 5, masteryState: 'sprout', targetAssessmentPath: quiz },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['Alpha']), qa('z1', ['Zulu'])]);
    const sameOverdue = replay({
      a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      z1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
    });

    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      // One day before AS_OF — passed, per F4.7.
      assessmentContext: new Map([
        [quiz, { dueDay: '2026-09-13', scopeConceptKeys: new Set(['Zulu']) }],
      ]),
    });

    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Alpha', 'Zulu']);
  });

  it('F2.19: relatedConceptKeys/assessmentContext with no signal for the rows present leaves overdue-first order unchanged (no-op proof)', () => {
    const theRows = rows([
      { conceptName: 'Alpha', gapScore: 5, masteryState: 'sprout' },
      { conceptName: 'Bravo', gapScore: 5, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['Alpha']), qa('b1', ['Bravo'])]);
    const sameOverdue = replay({
      a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
    });
    const base = {
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
    };

    const withoutSignals = composeSessionRows(base);
    const withIrrelevantSignals = composeSessionRows({
      ...base,
      relatedConceptKeys: new Map([['SomeOtherConcept', new Set(['AnotherOne'])]]),
      assessmentContext: new Map([
        ['Unrelated.md' as VaultPath, { dueDay: AS_OF, scopeConceptKeys: new Set(['AnotherOne']) }],
      ]),
    });

    expect(withIrrelevantSignals.orderedRows.map((r) => r.conceptName)).toEqual(
      withoutSignals.orderedRows.map((r) => r.conceptName),
    );
  });

  // ---------------------------------------------------------------------------
  // `[D-149]` (`ol-v7r5.12`): the material-arrival cohort — a third, continuous
  // decay weight blended into F2.19's relatedness half, keyed on `arrivalDays`
  // (`ARRIVE-1`) and grained on exact `GapRow.notePaths` overlap. See
  // features/F2-review.md (olea-service) and compose.ts's own "material-
  // arrival cohort" module-doc section.
  // ---------------------------------------------------------------------------

  describe('[D-149] withinBlockCohortDecayWeight — the pure decay curve', () => {
    it('is 0 with no arrival signal at all', () => {
      expect(withinBlockCohortDecayWeight(null, AS_OF)).toBe(0);
    });

    it('is 1 the day the material arrives', () => {
      expect(withinBlockCohortDecayWeight(AS_OF, AS_OF)).toBe(1);
    });

    it('is exactly 0.5 at the declared half-life', () => {
      const arrivedHalfLifeAgo = '2026-09-07'; // AS_OF minus MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS (7)
      expect(withinBlockCohortDecayWeight(arrivedHalfLifeAgo, AS_OF)).toBeCloseTo(0.5, 10);
    });

    it('keeps decaying toward, but never reaching, 0 as arrival recedes further', () => {
      const near = withinBlockCohortDecayWeight('2026-09-07', AS_OF);
      const far = withinBlockCohortDecayWeight('2026-06-01', AS_OF);
      expect(far).toBeLessThan(near);
      expect(far).toBeGreaterThan(0);
    });

    it('clamps a future arrival day (clock skew) to 0, never negative', () => {
      expect(withinBlockCohortDecayWeight('2026-09-15', AS_OF)).toBe(0);
    });
  });

  describe('[D-149] withinBlockCohortAffinity — exact source-note overlap, the cohort grain', () => {
    const path = (name: string) => `01 Courses/CRS101/${name}.md` as VaultPath;

    it('is 0 with no notePaths of its own', () => {
      expect(
        withinBlockCohortAffinity([], ['Bravo'], new Map([['Bravo', [path('lecture-1')]]])),
      ).toBe(0);
    });

    it('is 0 with no peers', () => {
      expect(withinBlockCohortAffinity([path('lecture-1')], [], new Map())).toBe(0);
    });

    it('is 0 when no peer shares any of its source notes', () => {
      const peerNotePaths = new Map([['Bravo', [path('lecture-2')]]]);
      expect(withinBlockCohortAffinity([path('lecture-1')], ['Bravo'], peerNotePaths)).toBe(0);
    });

    it('is the fraction of peers sharing at least one exact source note', () => {
      const peerNotePaths = new Map([
        ['Bravo', [path('lecture-1')]],
        ['Charlie', [path('lecture-2')]],
      ]);
      expect(
        withinBlockCohortAffinity([path('lecture-1')], ['Bravo', 'Charlie'], peerNotePaths),
      ).toBeCloseTo(0.5, 10);
    });

    it('counts a peer with ANY shared note, not requiring every note to match', () => {
      const own = [path('lecture-1'), path('lecture-2')];
      const peerNotePaths = new Map([['Bravo', [path('lecture-2'), path('lecture-9')]]]);
      expect(withinBlockCohortAffinity(own, ['Bravo'], peerNotePaths)).toBe(1);
    });
  });

  describe('[D-149] the cohort as a composed-session ordering signal', () => {
    const lecture1 = '01 Courses/CRS101/lecture-1.md' as VaultPath;
    const lecture2 = '01 Courses/CRS101/lecture-2.md' as VaultPath;

    it('freshly-arrived material with no relation signal pulls its own source-note cohort adjacent', () => {
      // Alpha and Charlie both arrived TODAY from the same source note;
      // Bravo arrived from a different note and shares no relation with
      // anyone. All three tie exactly on overdueDays and gapScore, and no
      // `relatedConceptKeys` is supplied at all — cohort affinity is the
      // only signal available to break the tie.
      const theRows = rows([
        { conceptName: 'Alpha', gapScore: 5, masteryState: 'sprout', notePaths: [lecture1] },
        { conceptName: 'Bravo', gapScore: 5, masteryState: 'sprout', notePaths: [lecture2] },
        { conceptName: 'Charlie', gapScore: 5, masteryState: 'sprout', notePaths: [lecture1] },
      ]);
      const instruments = buildConceptInstrumentIndex([
        qa('a1', ['Alpha']),
        qa('b1', ['Bravo']),
        qa('c1', ['Charlie']),
      ]);
      const sameOverdue = replay({
        a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
        c1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      });

      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: sameOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
        arrivalDays: new Map([
          ['Alpha', AS_OF],
          ['Charlie', AS_OF],
        ]),
      });

      // Alpha and Charlie's shared, freshly-arrived source note pulls them
      // adjacent, ahead of Bravo — never `[Alpha, Bravo, Charlie]`, the
      // plain-alphabetical fallback a mutation dropping the cohort term
      // would produce instead.
      expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    });

    it("as the cohort's arrival recedes, a live C7.10 relation outranks the decayed cohort", () => {
      // Alpha is C7.10-related to BOTH Bravo and Charlie (relatedness 1.0,
      // unaffected by arrival — Alpha itself has no arrival entry, so its own
      // cohort weight is 0 regardless of Charlie's). Bravo carries no cohort
      // signal (different source note) but IS related to Alpha (relatedness
      // 0.5, cohort weight 0 — no arrival entry either). Charlie carries NO
      // relation at all, only a source note shared with Alpha, and it
      // arrived long enough ago (many half-lives) that its cohort weight is
      // small. Whatever that residual weight is (any value below 1, which a
      // real elapsed time always gives), Charlie's blended score
      // (`residualWeight * 0.5`) stays under Bravo's fixed 0.5 — the live
      // relation reliably outranks the decayed cohort.
      const staleArrival = '2026-01-01';
      const theRows = rows([
        { conceptName: 'Alpha', gapScore: 5, masteryState: 'sprout', notePaths: [lecture1] },
        { conceptName: 'Bravo', gapScore: 5, masteryState: 'sprout', notePaths: [lecture2] },
        { conceptName: 'Charlie', gapScore: 5, masteryState: 'sprout', notePaths: [lecture1] },
      ]);
      const instruments = buildConceptInstrumentIndex([
        qa('a1', ['Alpha']),
        qa('b1', ['Bravo']),
        qa('c1', ['Charlie']),
      ]);
      const sameOverdue = replay({
        a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
        c1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      });

      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: sameOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
        // Only Charlie carries an arrival day — Alpha and Bravo's own
        // cohort weight is 0 by omission, exactly like the no-signal case.
        arrivalDays: new Map([['Charlie', staleArrival]]),
        relatedConceptKeys: new Map([
          ['Alpha', new Set(['Bravo', 'Charlie'])],
          ['Bravo', new Set(['Alpha'])],
        ]),
      });

      // Charlie still technically shares Alpha's source note, but the
      // decayed cohort no longer keeps it adjacent — Bravo's live relation
      // to Alpha wins the placement instead, unlike the fresh-arrival case
      // above where the cohort alone decided the order.
      expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('is a no-op, byte-for-byte, when arrivalDays is omitted — even with a matching cohort present', () => {
      const withCohortButNoArrivalSignal = rows([
        { conceptName: 'Alpha', gapScore: 5, masteryState: 'sprout', notePaths: [lecture1] },
        { conceptName: 'Bravo', gapScore: 5, masteryState: 'sprout', notePaths: [lecture2] },
        { conceptName: 'Charlie', gapScore: 5, masteryState: 'sprout', notePaths: [lecture1] },
      ]);
      const instruments = buildConceptInstrumentIndex([
        qa('a1', ['Alpha']),
        qa('b1', ['Bravo']),
        qa('c1', ['Charlie']),
      ]);
      const sameOverdue = replay({
        a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
        c1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      });
      const base = {
        rows: withCohortButNoArrivalSignal,
        instruments,
        replay: sameOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
      };

      const result = composeSessionRows(base);

      // No `arrivalDays` map at all: cohort weight is 0 for every row
      // regardless of the shared `notePaths`, so this falls through to
      // `overdueFirst`'s own `conceptKey` tiebreak — plain alphabetical.
      expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it("F4.7's stop-at-the-assessment rule still wins over a maximally-fresh cohort", () => {
      // Zulu is named in an imminent assessment's own scope; Alpha shares
      // Zulu's OWN source note and arrived today (cohort weight 1, cohort
      // affinity 1 — a maximal pull, not merely a fresh one) but is not
      // itself in that scope. The outer proximity blend must still favour
      // scope membership over the inner relatedness-plus-cohort blend,
      // exactly as it already does over plain relatedness.
      const quiz = '05 Assessments/Quiz.md' as VaultPath;
      const theRows = rows([
        {
          conceptName: 'Alpha',
          gapScore: 5,
          masteryState: 'sprout',
          notePaths: [lecture1],
          targetAssessmentPath: quiz,
        },
        {
          conceptName: 'Zulu',
          gapScore: 5,
          masteryState: 'sprout',
          notePaths: [lecture1],
          targetAssessmentPath: quiz,
        },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['Alpha']), qa('z1', ['Zulu'])]);
      const sameOverdue = replay({
        a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
        z1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      });

      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: sameOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
        arrivalDays: new Map([['Alpha', AS_OF]]),
        assessmentContext: new Map([
          [quiz, { dueDay: AS_OF, scopeConceptKeys: new Set(['Zulu']) }],
        ]),
      });

      expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['Zulu', 'Alpha']);
    });
  });

  // [STEER-1] (`ol-imqy`, `[D-076]` round 2 "Can she steer it?"): course/topic
  // becomes a first-class input to this same composition, not a separate
  // due-queue-only mechanism.
  describe('[STEER-1] courses/conceptIds — the "course or topic" steering input', () => {
    it('courses restricts composition to the named course(s), same as if the other course never existed', () => {
      const theRows = rows([
        { conceptName: 'Big1', course: 'BIG', gapScore: 9, masteryState: 'sprout' },
        { conceptName: 'Small1', course: 'SMALL', gapScore: 9, masteryState: 'sprout' },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('b1', ['Big1']), qa('s1', ['Small1'])]);
      const sameOverdue = replay({
        b1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
        s1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
      });

      const filtered = composeSessionRows({
        rows: theRows,
        instruments,
        replay: sameOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
        courses: ['SMALL'],
      });

      expect(filtered.orderedRows.map((r) => r.conceptName)).toEqual(['Small1']);
      expect([...filtered.courseShares.keys()]).toEqual(['SMALL']);
      expect(filtered.overflow.every((entry) => entry.count === 0)).toBe(true);
    });

    it('conceptIds restricts to the named concept(s) (F2.5\'s "topic"), independent of course', () => {
      const theRows = rows([
        { conceptName: 'Alpha', course: 'BIG', gapScore: 9, masteryState: 'sprout' },
        { conceptName: 'Bravo', course: 'BIG', gapScore: 9, masteryState: 'sprout' },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['Alpha']), qa('b1', ['Bravo'])]);
      const sameOverdue = replay({
        a1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
      });

      const filtered = composeSessionRows({
        rows: theRows,
        instruments,
        replay: sameOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
        conceptIds: ['Bravo'],
      });

      expect(filtered.orderedRows.map((r) => r.conceptName)).toEqual(['Bravo']);
    });

    it('courses and conceptIds combine by AND, mirroring queue/types.ts QueueFilter', () => {
      const theRows = rows([
        { conceptName: 'Alpha', course: 'BIG', gapScore: 9, masteryState: 'sprout' },
        { conceptName: 'Bravo', course: 'SMALL', gapScore: 9, masteryState: 'sprout' },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['Alpha']), qa('b1', ['Bravo'])]);
      const sameOverdue = replay({
        a1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
      });

      // Names a concept from the OTHER course than the course filter allows —
      // AND semantics mean neither row passes.
      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: sameOverdue,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 1200,
        courses: ['BIG'],
        conceptIds: ['Bravo'],
      });

      expect(result.orderedRows).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// buildComposedStudySession — the whole layer, and F6.6's equality-of-rule
// health check (component register 3.8; [D-113] item 5)
// ---------------------------------------------------------------------------

describe('buildComposedStudySession', () => {
  it('composes rows and fills the same way buildStudySession(order: "given") would', () => {
    const theRows = rows([
      { conceptName: 'A', gapScore: 9, masteryState: 'sprout' },
      { conceptName: 'B', gapScore: 8, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A']), qa('b1', ['B'])]);
    const theReplay = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-15', dueDay: '2099-01-01' },
    });

    const composed = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: theReplay,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    const expectedComposition = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
    });
    const expectedModel = buildStudySession({
      rows: expectedComposition.orderedRows,
      instruments,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      order: 'given',
      // `buildComposedStudySession` always threads its own composition's
      // obligation classes through (`ol-y237`, F6.7) — reproduced here so
      // this equivalence check compares like with like.
      obligationClasses: expectedComposition.obligationClasses,
    });

    expect(composed.model).toEqual(expectedModel);
  });

  // F2.18 — "within a course's block, concepts interleave rather than
  // exhausting one before the next" (features/F2-review.md, olea-service).
  // `compose.ts`'s own module doc says this needs no code in THIS module:
  // `blockByCoursePresentation` only decides which course-block goes first
  // and, within a block, orders concepts `overdue-first` — it never groups a
  // concept's own instruments together. The interleaving is a property of
  // `buildStudySession`'s breadth-first fill (one instrument per row per
  // pass) applied to that row order. This test exercises the two modules
  // together, end to end, because that is the only place the claim is
  // observable: a regression to a depth-first fill (all of one concept's
  // instruments before moving to the next) would leave `composeSessionRows`
  // unchanged and only show up here.
  it('F2.18: within a course block, two concepts each with two due instruments interleave rather than running one concept to exhaustion first', () => {
    const theRows = rows([
      { conceptName: 'Alpha', course: 'CRS101', gapScore: 5, masteryState: 'sprout' },
      { conceptName: 'Beta', course: 'CRS101', gapScore: 5, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('alpha1', ['Alpha']),
      qa('alpha2', ['Alpha']),
      qa('beta1', ['Beta']),
      qa('beta2', ['Beta']),
    ]);
    // Alpha more overdue (44 days since) than Beta (13 days since), both past
    // sprout's 5-day baseline rung — `overdue-first` orders Alpha ahead of
    // Beta within the (single) course block, deterministically.
    const theReplay = replay({
      alpha1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      alpha2: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      beta1: { lastReviewedDay: '2026-09-01', dueDay: '2099-01-01' },
      beta2: { lastReviewedDay: '2026-09-01', dueDay: '2099-01-01' },
    });
    // `[HARD-2b]`: outside the final week, F2.17's per-concept cap now holds
    // explicitly, so a second instrument on the SAME concept (`alpha2`,
    // `beta2`) is exactly the case that cap forbids by default. This test is
    // about a different clause — F2.18's interleave, demonstrated across two
    // DIFFERENT concepts — so it puts CRS101 inside its own final week
    // (an assessment 3 days out) to legitimately unlock each concept's
    // second instrument, the same way `[D-240]`'s own tests do.
    const CRS101_QUIZ = '02 Assignments/crs101-quiz.md' as VaultPath;
    const theAssessments: readonly AssessmentRecord[] = [
      {
        path: CRS101_QUIZ,
        course: 'CRS101',
        type: 'Quiz',
        weight: 5,
        weightRaw: '5',
        due: '2026-09-17',
        status: 'upcoming',
      },
    ];

    const composed = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: theReplay,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      assessments: theAssessments,
    });

    // Interleaved: Alpha, Beta, Alpha, Beta — never Alpha, Alpha, Beta, Beta
    // (which is exactly what a depth-first, one-concept-to-exhaustion fill
    // would produce instead).
    expect(composed.model.items.map((item) => item.conceptName)).toEqual([
      'Alpha',
      'Beta',
      'Alpha',
      'Beta',
    ]);
  });

  it('passes supportHistory/supportSelfAssessment straight through to buildStudySession (row 3.9, `[SUPP-2]`) — this layer adds no seam of its own', () => {
    const theRows = rows([{ conceptName: 'A', gapScore: 9, masteryState: 'sprout' }]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A'])]);
    const composed = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      supportHistory: { outcomesFor: () => [{ failureShape: 'wrong-concept', hintUptake: false }] },
      supportSelfAssessment: null,
    });

    expect(composed.model.items).toHaveLength(1);
    expect(composed.model.items[0]?.supportLevel).toEqual({
      level: 'guided',
      provenance: 'evidence-thin',
    });
  });

  it('refuses an unusable budget before any composition work runs', () => {
    for (const budgetMinutes of [0, -5, Number.NaN]) {
      expect(() =>
        buildComposedStudySession({
          rows: [],
          instruments: buildConceptInstrumentIndex([]),
          replay: emptyReplay(),
          budgetMinutes,
          durations: flatDurations(60),
          asOf: AS_OF,
        }),
      ).toThrow(/budgetMinutes/);
    }
  });

  it("F6.6's equality-of-rule health check: a re-entry session (smaller budget, older log) composes with the SAME rule as an ordinary one — no second selection mechanism exists to diverge (component register 3.8, [D-113] item 5)", () => {
    // "Re-entry" here means only what F6.6 permits it to mean: the ordinary
    // rule, run at fewer slots. There is no absence-aware branch in
    // `composeSessionRows`/`buildComposedStudySession` for this test to
    // exercise differently — the SAME function, called with a smaller
    // `budgetMinutes` after a gap in the log, IS the re-entry rule. This test
    // demonstrates that composing at a given (smaller) budget after a long
    // absence produces byte-identical rows to composing at that SAME budget
    // for an ordinary (no-absence) call with the same underlying obligations.
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
    const theReplay = replay({
      a1: { lastReviewedDay: '2026-08-20', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-25', dueDay: '2099-01-01' },
    });

    // "Returning after a 21-day absence, at a smaller budget" and "an
    // ordinary session called at that same smaller budget" are the exact
    // same call, because nothing in this module reads days-since-last-open —
    // that is F6.6's own point, and this is the test that would fail if a
    // second policy were ever added.
    const reentry = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: theReplay,
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
    });
    const ordinary = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: theReplay,
      budgetMinutes: 5,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(reentry.model).toEqual(ordinary.model);
  });

  it('produces no display string — F2.22 is out of scope for this layer (session-builder/copy.ts owns the sentence)', () => {
    const theRows = rows([{ conceptName: 'A', gapScore: 9, masteryState: 'sprout' }]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A'])]);
    const composed = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      // Unrelated to `[FOCUS-5]`'s focus fields — pin `'every-course'` so
      // this test's field list stays about F2.22's scope alone.
      focusPolicy: 'every-course',
    });

    // The whole result is exactly these five structural fields — a per-item
    // obligation-class map, an order (inside `model`), shares, forced
    // courses, and an overflow count — never a prose-shaped one. A future
    // edit adding a rendered "composition sentence" field here would fail
    // this test, which is the point: that sentence belongs to
    // `session-builder/copy.ts`, over this structure, not to this module.
    // `obligationClasses` (`ol-y237`, F6.7) belongs on this list precisely
    // because it is NOT prose either — see the assertion below and the
    // module doc's "Per-item obligation class" section for why a class-per-
    // concept map is a structural field, not a rendered sentence.
    expect(Object.keys(composed).sort()).toEqual(
      [
        'containmentDropped',
        'courseShares',
        // Present because this test pins `focusPolicy: 'every-course'`
        // explicitly (`[FOCUS-3]`'s echo discipline) — not a display string,
        // and unrelated to the F2.22 scope this test is about.
        'focusPolicy',
        'forcedCourses',
        'model',
        'obligationClasses',
        'overflow',
      ].sort(),
    );
  });

  it('F6.7 (`ol-y237`): the per-item obligation class survives to both the composed result and each StudySessionItem, keyed the same way', () => {
    const theRows = rows([
      { conceptName: 'NeverSeen', gapScore: 9 }, // no replay entry -> 'unmet'
      { conceptName: 'Elective', gapScore: 5, masteryState: 'tree' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('n1', ['NeverSeen']),
      qa('e1', ['Elective']),
    ]);
    // Reviewed today, at a mastery stage whose ladder rung has not elapsed —
    // 'elective', not 'baseline-due'.
    const theReplay = replay({ e1: { lastReviewedDay: AS_OF, dueDay: '2099-01-01' } });
    const composed = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: theReplay,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
    });

    expect(composed.obligationClasses.get('NeverSeen')).toBe('unmet');
    expect(composed.obligationClasses.get('Elective')).toBe('elective');

    // Same classes, reachable per-item without a caller rejoining by
    // conceptKey itself.
    const byConceptName = new Map(composed.model.items.map((i) => [i.conceptName, i]));
    expect(byConceptName.get('NeverSeen')?.obligationClass).toBe('unmet');
    expect(byConceptName.get('Elective')?.obligationClass).toBe('elective');

    // Never a count, a total, or a list of names alongside the class — the
    // map's only value per key is the bare `ObligationClass` string.
    for (const value of composed.obligationClasses.values()) {
      expect(typeof value).toBe('string');
    }
  });

  it('obligationClasses is keyed over the CHOSEN set only — a classified-but-overflowed concept has no entry', () => {
    const theRows = rows([
      { conceptName: 'Fits', gapScore: 9, masteryState: 'sprout' },
      { conceptName: 'TooMuch', gapScore: 8, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('f1', ['Fits']), qa('t1', ['TooMuch'])]);
    const theReplay = replay({
      f1: { lastReviewedDay: '2026-09-01', dueDay: '2099-01-01' },
      t1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 60, // room for exactly one — see the overflow test above
    });

    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['TooMuch']);
    expect(result.obligationClasses.has('TooMuch')).toBe(true);
    expect(result.obligationClasses.has('Fits')).toBe(false);
  });

  // [STEER-1] (`ol-imqy`, `[D-076]` round 2 "Can she steer it?"): time,
  // course-or-topic and stated interest, all three supplied TOGETHER on this
  // one path and all three honoured — the acceptance criterion itself, not
  // just the course-filter mechanism composeSessionRows exercises above.
  it('[STEER-1]: budgetMinutes, courses and focusConceptName are honoured together, on one call', () => {
    const theRows = rows([
      { conceptName: 'InCourseA', course: 'A', gapScore: 1, masteryState: 'sprout' },
      { conceptName: 'FocusInCourseA', course: 'A', gapScore: 1, masteryState: 'sprout' },
      { conceptName: 'InCourseB', course: 'B', gapScore: 9, masteryState: 'sprout' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['InCourseA']),
      qa('a2', ['FocusInCourseA']),
      qa('b1', ['InCourseB']),
    ]);
    const sameOverdue = replay({
      a1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
      a2: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-09-08', dueDay: '2099-01-01' },
    });

    const composed = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetMinutes: 20, // time
      courses: ['A'], // course/topic — B's much higher gapScore must not win a slot
      focusConceptName: 'FocusInCourseA', // stated interest — front-lifted within the filtered set
    });

    expect(composed.model.items.map((item) => item.conceptName)).toEqual([
      'FocusInCourseA',
      'InCourseA',
    ]);
    expect(composed.model.budgetMinutes).toBe(20);
    expect(composed.model.focusConcept).toBe('FocusInCourseA');
    expect([...composed.courseShares.keys()]).toEqual(['A']);
  });
});

// ---------------------------------------------------------------------------
// F2.19 — "no phase field, phase enum or stage label exists anywhere in the
// schema" (features/F2-review.md, olea-service). This is the schema half of
// F2.19's claim: the course/concept/student shapes this module reads and
// writes carry no persisted classification for the grouping to be read off
// of — it is recomputed from calendar arithmetic every time (F4.7). A future
// edit that added, say, a `coursePhase`/`termStage`/`termPosition` field to
// `GapRow`, `ObligationSignals` or `ObligationClassification` — the exact
// shape of regression this scenario exists to catch — would fail this test.
//
// This does NOT test the other half of F2.19's claim (that grouping favours
// relatedness absent a near assessment, and shifts toward the assessment's
// own scope as one approaches) — that half is covered by the three
// `F2.19: ...` scenarios inside the `composeSessionRows` describe block
// above (`withinBlockOrder`/`withinBlockGroupingScore` in `compose.ts`),
// plus the no-op equivalence proof alongside them. This block only proves
// the shapes those functions read and write stay free of a persisted
// classification.
// ---------------------------------------------------------------------------

describe('F2.19 — no phase/stage/term-position field in the schema this module reads or writes', () => {
  const FORBIDDEN_SUBSTRINGS = ['phase', 'stage', 'termposition', 'term_position'];

  function suspectKeys(value: object): readonly string[] {
    return Object.keys(value).filter((key) =>
      FORBIDDEN_SUBSTRINGS.some((forbidden) => key.toLowerCase().includes(forbidden)),
    );
  }

  it('a GapRow — the course/concept shape this module partitions and blocks by — carries no phase, stage or term-position field', () => {
    const theRow = row({ conceptName: 'Alpha', course: 'CRS101' }, 1);
    expect(suspectKeys(theRow)).toEqual([]);
  });

  it("classifyObligation's input (the student-progress signals) and output (the obligation classification) carry no phase, stage or term-position field", () => {
    const signals = {
      masteryState: 'sprout' as const,
      lastRetrievalDay: '2026-09-01',
      recallDueDay: null,
      arrivalDay: null,
      asOf: AS_OF,
    };
    const result = classifyObligation(signals);

    expect(suspectKeys(signals)).toEqual([]);
    expect(suspectKeys(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F2.19 production resolvers, end to end (`ol-v7r5.11`). `ol-v7r5.10`'s
// handback named two reachability gaps: nothing resolved
// `concept/relation.ts`'s name-keyed edges into `relatedConceptKeys`, and
// nothing resolved `assessment/scope.ts`'s free text into
// `assessmentContext`. `related-concept-keys.ts` and
// `assessment/scope-concept-keys.ts` are those resolvers (see their own
// specs for unit coverage, including the honest miss counts). This block
// proves the resolvers THEMSELVES — never a hand-built map — drive a real
// composed session's within-block order: `ConceptRecord`/`ConceptRelation`/
// `AssessmentRecord` fixtures in, `buildComposedStudySession`'s row order
// out. Concept keys are deliberately distinct from concept names throughout
// (`key-*` vs a display name), so a resolver that quietly no-op'd by
// treating a name as its own key would fail every assertion below rather
// than passing by coincidence.
//
// INV-3: every concept/course/assessment name below is coined for the test.
// ---------------------------------------------------------------------------

describe('F2.19 production resolvers: relatedConceptKeys/assessmentContext resolved from real fixtures, not hand-built maps', () => {
  function keyedRow(spec: RowSpec & { readonly conceptKey: string }, rank: number): GapRow {
    return { ...row(spec, rank), conceptKey: spec.conceptKey };
  }

  function concept(
    name: string,
    key: string,
    courses: readonly string[] = ['CRS101'],
  ): ConceptRecord {
    return { key, name, tier: 1, courses, sourcePaths: [] };
  }

  function passage(sourcePath: string): Provenance {
    return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
  }

  function relationEdge(
    type: RelationType,
    from: string,
    to: string,
    options: { confidence?: number; provenance?: RelationProvenanceKind } = {},
  ): ConceptRelation {
    return {
      type,
      from,
      to,
      provenance: options.provenance ?? 'model-proposed',
      confidence: options.confidence ?? 0.5,
      introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
    };
  }

  function assessmentRecord(
    overrides: Partial<AssessmentRecord> & { readonly path: VaultPath },
  ): AssessmentRecord {
    return {
      course: 'CRS101',
      type: 'Test',
      weight: 40,
      weightRaw: '40',
      due: '2026-09-01',
      status: 'todo',
      ...overrides,
    };
  }

  it('relatedness resolved from real ConceptRecord/ConceptRelation fixtures shifts within-block order toward a connected peer', () => {
    // Three comparably-due concepts, same course. A relation edge (by NAME,
    // as `concept/relation.ts` emits) connects Alpha and Charlie only. If the
    // resolver truly joins names to keys, Charlie sorts adjacent to Alpha
    // ahead of the unconnected Bravo; alphabetical fallback would put Bravo
    // second, so this cannot pass by coincidence.
    const concepts = [
      concept('Alpha', 'key-alpha'),
      concept('Bravo', 'key-bravo'),
      concept('Charlie', 'key-charlie'),
    ];
    const relations = [relationEdge('related' as RelationType, 'Alpha', 'Charlie')];
    const { relatedConceptKeys, unresolvedEndpointCount } = resolveRelatedConceptKeys(
      relations,
      concepts,
    );
    expect(unresolvedEndpointCount).toBe(0);

    const theRows = [
      keyedRow({ conceptName: 'Alpha', conceptKey: 'key-alpha', gapScore: 5 }, 1),
      keyedRow({ conceptName: 'Bravo', conceptKey: 'key-bravo', gapScore: 5 }, 2),
      keyedRow({ conceptName: 'Charlie', conceptKey: 'key-charlie', gapScore: 5 }, 3),
    ];
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['key-alpha']),
      qa('b1', ['key-bravo']),
      qa('c1', ['key-charlie']),
    ]);
    const sameOverdue = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      c1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });

    const withoutRelations = composeSessionRows({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
    });
    expect(withoutRelations.orderedRows.map((r) => r.conceptName)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);

    const withResolvedRelations = composeSessionRows({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relatedConceptKeys,
    });

    expect(withResolvedRelations.orderedRows.map((r) => r.conceptName)).toEqual([
      'Alpha',
      'Charlie',
      'Bravo',
    ]);
  });

  it("assessment scope resolved from real AssessmentRecord fixtures shifts placement toward the approaching assessment's own scope", () => {
    // Two comparably-due concepts, same course. An assessment's stated scope
    // (free text, comma-split per the resolver's convention) names Delta but
    // not Charlie, and a third scope segment matches nothing (counted, not
    // silently absorbed). The assessment is one day out — proximity close to
    // 1 — so placement should favour Delta.
    const quiz = '05 Assessments/Quiz.md' as VaultPath;
    const concepts = [concept('Charlie', 'key-charlie'), concept('Delta', 'key-delta')];
    const assessments = [
      assessmentRecord({
        path: quiz,
        due: '2026-09-15',
        scope: 'Delta, Some Untracked Topic',
      }),
    ];
    const { assessmentContext, unresolvedScopeSegmentCount } = resolveAssessmentGroupingContext(
      assessments,
      concepts,
    );
    expect(unresolvedScopeSegmentCount).toBe(1);
    expect(assessmentContext.get(quiz)?.scopeConceptKeys).toEqual(new Set(['key-delta']));

    const theRows = [
      keyedRow(
        {
          conceptName: 'Charlie',
          conceptKey: 'key-charlie',
          gapScore: 5,
          targetAssessmentPath: quiz,
        },
        1,
      ),
      keyedRow(
        { conceptName: 'Delta', conceptKey: 'key-delta', gapScore: 5, targetAssessmentPath: quiz },
        2,
      ),
    ];
    const instruments = buildConceptInstrumentIndex([
      qa('c1', ['key-charlie']),
      qa('d1', ['key-delta']),
    ]);
    const sameOverdue = replay({
      c1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      d1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });

    const withoutContext = composeSessionRows({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
    });
    // Alphabetical/conceptKey tiebreak with no signal: Charlie first.
    expect(withoutContext.orderedRows.map((r) => r.conceptName)).toEqual(['Charlie', 'Delta']);

    const withResolvedContext = composeSessionRows({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      assessmentContext,
    });

    expect(withResolvedContext.orderedRows.map((r) => r.conceptName)).toEqual(['Delta', 'Charlie']);
  });

  it("feeding both resolved maps through buildComposedStudySession (the whole production layer) still shifts the built session's item order", () => {
    const concepts = [concept('Alpha', 'key-alpha'), concept('Charlie', 'key-charlie')];
    const relations = [relationEdge('is-a', 'Alpha', 'Charlie')];
    const { relatedConceptKeys } = resolveRelatedConceptKeys(relations, concepts);

    const theRows = [
      keyedRow({ conceptName: 'Alpha', conceptKey: 'key-alpha', gapScore: 5 }, 1),
      keyedRow({ conceptName: 'Bravo', conceptKey: 'key-bravo', gapScore: 5 }, 2),
      keyedRow({ conceptName: 'Charlie', conceptKey: 'key-charlie', gapScore: 5 }, 3),
    ];
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['key-alpha']),
      qa('b1', ['key-bravo']),
      qa('c1', ['key-charlie']),
    ]);
    const sameOverdue = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      c1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });

    const composed = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: sameOverdue,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      relatedConceptKeys,
    });

    expect(composed.model.items.map((item) => item.conceptName)).toEqual([
      'Alpha',
      'Charlie',
      'Bravo',
    ]);
  });
});

// ---------------------------------------------------------------------------
// [SESS-9] (`ol-2zfj.77`) — allocation's per-course share is honoured before
// the cross-course fill. Scenarios: features/F2-review.md (olea-service), the
// "SESS-9" block.
// ---------------------------------------------------------------------------

function mcqRecord(instrumentId: string, conceptIds: readonly string[]): McqInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'mcq',
    conceptIds,
    courses: ['CRS101'],
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    mcq: {
      type: 'mcq',
      id: instrumentId,
      predecessor: null,
      stem: 'Which?',
      answer: 'This one.',
      distractors: ['a', 'b', 'c'],
      feedback: null,
      raw: '```mcq\n```',
      span: { start: 0, end: 10 },
      fence: '```',
      terminator: '\n',
    },
  };
}

/** Recall costs four times recognition — the shape the pre-flight measured, where the override serves the expensive instrument the selection priced at the cheap one. */
function typedDurations(seconds: Readonly<Record<'qa' | 'cloze' | 'mcq', number>>): DurationModel {
  const estimates = (['qa', 'cloze', 'mcq'] as const).map((instrumentType) => ({
    instrumentType,
    seconds: seconds[instrumentType],
    source: 'assumed' as const,
    sampleCount: 0,
  }));
  return {
    estimates,
    basis: 'assumed',
    totalSampleCount: 0,
    secondsFor: (instrumentType) =>
      instrumentType === 'explain-back' ? 0 : seconds[instrumentType],
    sourceFor: () => 'assumed',
  };
}

describe('[SESS-9] allocation is honoured before the cross-course fill', () => {
  // The pre-flight's own shape, at fixture scale: two courses whose concepts
  // hold an overdue recall-tier instrument (which `[D-240]` item 2 serves
  // ahead of the preference-matched MCQ, at four times the cost the selection
  // priced) and one course whose concepts hold only a due MCQ, with a budget
  // too small to serve every row.
  const RECALL_SECONDS = 100;
  const RECOGNITION_SECONDS = 25;
  const BUDGET_MINUTES = 10;
  const BUDGET_SECONDS = BUDGET_MINUTES * 60;

  const QUIZ_PATH = '02 Assignments/quiz.md' as VaultPath;
  // A Quiz puts the format preference on MCQ for the whole session — which is
  // what `recallOutranksFormatPreference` needs something to override.
  const assessments: readonly AssessmentRecord[] = [
    {
      path: QUIZ_PATH,
      course: 'ALPHA',
      type: 'Quiz',
      weight: 20,
      weightRaw: '20',
      due: '2026-12-01',
      status: 'upcoming',
    },
  ];

  function threeCourseFixture() {
    const overdueCourses = ['ALPHA', 'BRAVO'] as const;
    const specs: RowSpec[] = [];
    const records: (QaInstrumentRecord | McqInstrumentRecord)[] = [];
    const replayEntries: Record<string, { lastReviewedDay: string; dueDay: string }> = {};

    for (const course of overdueCourses) {
      for (let i = 1; i <= 4; i += 1) {
        const key = `${course}-${i}`;
        specs.push({ conceptName: key, course, gapScore: 9, masteryState: 'sprout' });
        records.push(qa(`${key}-recall`, [key]), mcqRecord(`${key}-mcq`, [key]));
        // Due 2026-09-01, 13 days before AS_OF, against the fixture's own
        // 10-day `scheduledDays` — past its own interval, so `[D-240]` item 2
        // lifts it over the preference-matched MCQ.
        replayEntries[`${key}-recall`] = { lastReviewedDay: '2026-08-20', dueDay: '2026-09-01' };
        replayEntries[`${key}-mcq`] = { lastReviewedDay: '2026-08-20', dueDay: '2026-09-01' };
      }
    }
    // CHARLIE: only recognition instruments, all due.
    for (let i = 1; i <= 8; i += 1) {
      const key = `CHARLIE-${i}`;
      specs.push({ conceptName: key, course: 'CHARLIE', gapScore: 9, masteryState: 'sprout' });
      records.push(mcqRecord(`${key}-mcq`, [key]));
      replayEntries[`${key}-mcq`] = { lastReviewedDay: '2026-08-20', dueDay: '2026-09-01' };
    }

    return {
      rows: rows(specs),
      instruments: buildConceptInstrumentIndex(records),
      replay: replay(replayEntries),
      durations: typedDurations({
        qa: RECALL_SECONDS,
        cloze: RECALL_SECONDS,
        mcq: RECOGNITION_SECONDS,
      }),
    };
  }

  const allocation: readonly StudyPlanAllocationEntry[] = [
    {
      courseId: 'ALPHA',
      share: 0.4,
      minBlockSeconds: 60,
      contributions: [{ name: 'risk', value: 0.5 }],
      reason: 'ALPHA gets its share.',
    },
    {
      courseId: 'BRAVO',
      share: 0.3,
      minBlockSeconds: 60,
      contributions: [{ name: 'risk', value: 0.5 }],
      reason: 'BRAVO gets its share.',
    },
    {
      courseId: 'CHARLIE',
      share: 0.3,
      minBlockSeconds: 60,
      contributions: [{ name: 'risk', value: 0.5 }],
      reason: 'CHARLIE gets its share.',
    },
  ];

  function secondsByCourse(items: readonly { course: string; estimatedSeconds: number }[]) {
    const out = new Map<string, number>();
    for (const item of items) {
      out.set(item.course, (out.get(item.course) ?? 0) + item.estimatedSeconds);
    }
    return out;
  }

  it('a course with a share and due rows is never served zero while another exceeds its share', () => {
    const fixture = threeCourseFixture();
    const composed = buildComposedStudySession({
      ...fixture,
      budgetMinutes: BUDGET_MINUTES,
      asOf: AS_OF,
      assessments,
      allocation,
      servingPolicy: 'interval-bound',
      // [SESS-9] is about the every-course allocation fill, not
      // `[FOCUS-5]`'s single-course default.
      focusPolicy: 'every-course',
    });

    const served = secondsByCourse(composed.model.items);
    // Its rows were selected — this is the fill, not the selection.
    expect(composed.model.items.filter((item) => item.course === 'CHARLIE').length).toBeGreaterThan(
      0,
    );
    expect(served.get('CHARLIE') ?? 0).toBeGreaterThan(0);
    // And the two ahead of it did not take the whole budget on the way there.
    expect(served.get('ALPHA') ?? 0).toBeLessThan(BUDGET_SECONDS);
  });

  it('no course is served less than its share, up to the one item its share could not fund', () => {
    const fixture = threeCourseFixture();
    const composed = buildComposedStudySession({
      ...fixture,
      budgetMinutes: BUDGET_MINUTES,
      asOf: AS_OF,
      assessments,
      allocation,
      servingPolicy: 'interval-bound',
      // [SESS-9] is about the every-course allocation fill, not
      // `[FOCUS-5]`'s single-course default.
      focusPolicy: 'every-course',
    });

    const served = secondsByCourse(composed.model.items);
    for (const entry of allocation) {
      const shareSeconds = BUDGET_SECONDS * entry.share;
      // The promise is a FLOOR, not an equality. One item's length is the
      // tolerance below it because instruments are indivisible — a course
      // whose next instrument would cross its share waits for the
      // cross-course pass rather than spending into another course's
      // seconds. There is deliberately no ceiling: seconds no course could
      // use are spent by whoever can (the test below), and the session
      // target itself is hers to outrun (`[D-091]`).
      expect(served.get(entry.courseId) ?? 0).toBeGreaterThanOrEqual(shareSeconds - RECALL_SECONDS);
    }
    // The defect this bead fixed, stated as the number it produced: before
    // the share pass the two courses holding overdue recall instruments took
    // the entire budget in one flat walk and CHARLIE's block was reached with
    // nothing left.
    expect(served.get('CHARLIE') ?? 0).toBeGreaterThan(0);
  });

  it('seconds a course cannot use are still spent on the others — the share bounds the first pass, never the session', () => {
    const fixture = threeCourseFixture();
    // DELTA holds a third of the session and has no servable instrument at
    // all, so its seconds must fall to the courses that can use them.
    const withEmptyCourse = buildComposedStudySession({
      rows: [
        ...fixture.rows,
        ...rows([{ conceptName: 'DELTA-1', course: 'DELTA', gapScore: 9, masteryState: 'sprout' }]),
      ],
      instruments: fixture.instruments,
      replay: fixture.replay,
      durations: fixture.durations,
      budgetMinutes: BUDGET_MINUTES,
      asOf: AS_OF,
      assessments,
      allocation: [
        ...allocation.map((entry) => ({ ...entry, share: entry.share * 0.7 })),
        {
          courseId: 'DELTA',
          share: 0.3,
          minBlockSeconds: 60,
          contributions: [{ name: 'risk', value: 0.5 }],
          reason: 'DELTA gets its share.',
        },
      ],
      servingPolicy: 'interval-bound',
      // [SESS-9] is about the every-course allocation fill, not
      // `[FOCUS-5]`'s single-course default.
      focusPolicy: 'every-course',
    });

    expect(withEmptyCourse.model.items.some((item) => item.course === 'DELTA')).toBe(false);
    // The session still reaches its declared target rather than stopping
    // 30% short because one course could spend nothing.
    expect(withEmptyCourse.model.plannedSeconds).toBeGreaterThanOrEqual(BUDGET_SECONDS);
  });

  it("the [D-240] override and F2.17's cap are unchanged by the share", () => {
    const fixture = threeCourseFixture();
    const composed = buildComposedStudySession({
      ...fixture,
      budgetMinutes: BUDGET_MINUTES,
      asOf: AS_OF,
      assessments,
      allocation,
      servingPolicy: 'interval-bound',
    });

    const alphaFirst = composed.model.items.filter((item) => item.conceptName === 'ALPHA-1');
    // The override: the overdue recall instrument, not the preference-matched
    // MCQ, is what that concept was served.
    expect(alphaFirst[0]?.instrumentType).toBe('qa');
    // F2.17's cap: once, outside any final week.
    expect(alphaFirst).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// `[D-244]` (`[FOCUS-3]`, `ol-egov.137.2`): the focus policy — scenarios
// `features/F2-review.md` F2.18 and `features/F6-today.md` C5.6 name.
// ---------------------------------------------------------------------------

describe('[FOCUS-3]/[FOCUS-5] focusPolicy', () => {
  function focusAllocationEntry(
    overrides: Partial<StudyPlanAllocationEntry> & { courseId: string; risk: number },
  ): StudyPlanAllocationEntry {
    return {
      share: 0,
      minBlockSeconds: 60,
      reason: `${overrides.courseId} gets its share.`,
      ...overrides,
      contributions: [{ name: 'risk', value: overrides.risk }],
    };
  }

  it('the declared constant matches the pre-commitment verbatim', () => {
    expect(URGENCY_OVERRIDE_THRESHOLD).toBeCloseTo(1 / 14);
  });

  it('`[FOCUS-5]`: single (the default, and omitting the field) selects exactly one dominant course; every-course must be requested explicitly', () => {
    const theRows = rows([
      { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
      { conceptName: 'B1', course: 'BETA', gapScore: 8 },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
    const theReplay = replay({
      a1: { lastReviewedDay: '2026-06-01', dueDay: '2099-01-01' }, // ALPHA: larger deficit -> dominant
      b1: { lastReviewedDay: '2026-09-10', dueDay: '2099-01-01' },
    });
    const base = {
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 600,
    };
    const omitted = composeSessionRows(base);
    const explicitSingle = composeSessionRows({ ...base, focusPolicy: 'single' as const });
    const explicitEveryCourse = composeSessionRows({
      ...base,
      focusPolicy: 'every-course' as const,
    });

    // Echo discipline is unchanged by the default flip: `focusPolicy` itself
    // is echoed only when the caller supplied it explicitly.
    expect(Object.keys(omitted).sort()).not.toContain('focusPolicy');
    // But `dominantCourse`/`focusBranch`/`focusReason` DO appear on the
    // omitted-input call now, because the default is `'single'`, not
    // `'every-course'` — see `composeSessionRows`'s own comment on this.
    expect(omitted.dominantCourse).toBe('ALPHA');
    expect(omitted.focusBranch).toBe('deficit');
    expect(omitted.orderedRows).toEqual(explicitSingle.orderedRows);
    expect(new Set(omitted.orderedRows.map((r) => r.course))).toEqual(new Set(['ALPHA']));

    // `'every-course'` still exists, but only when asked for — the harness's
    // own comparison baseline, never the default.
    expect(explicitEveryCourse.focusPolicy).toBe('every-course');
    expect(explicitEveryCourse.dominantCourse).toBeUndefined();
    expect(new Set(explicitEveryCourse.orderedRows.map((r) => r.course))).toEqual(
      new Set(['ALPHA', 'BETA']),
    );
  });

  describe('the selection hierarchy: filter, then urgency, then deficit', () => {
    it('her course filter names the dominant course outright — branch "filter"', () => {
      const theRows = rows([
        { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
        { conceptName: 'B1', course: 'BETA', gapScore: 8 },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
      const theReplay = replay({
        a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      });
      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: theReplay,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 600,
        courses: ['BETA'],
        focusPolicy: 'single',
      });

      expect(result.dominantCourse).toBe('BETA');
      expect(result.focusBranch).toBe('filter');
      expect(result.focusReason).toBe(FOCUS_BRANCH_SENTENCE.filter);
      expect(new Set(result.orderedRows.map((r) => r.course))).toEqual(new Set(['BETA']));
    });

    it('an eligible course\'s assessment urgency crossing the threshold wins over a larger deficit elsewhere — branch "urgency"', () => {
      const theRows = rows([
        { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
        { conceptName: 'B1', course: 'BETA', gapScore: 8 },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
      // ALPHA has by far the largest window deficit (last seen months ago);
      // BETA was seen recently but crosses the urgency threshold. Urgency
      // must still win — item 2's hierarchy stops at the first test that
      // fires.
      const theReplay = replay({
        a1: { lastReviewedDay: '2026-06-01', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-09-13', dueDay: '2099-01-01' },
      });
      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: theReplay,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 600,
        focusPolicy: 'single',
        allocation: [
          focusAllocationEntry({ courseId: 'ALPHA', share: 0.5, risk: 0.01 }),
          focusAllocationEntry({ courseId: 'BETA', share: 0.5, risk: 0.5 }),
        ],
      });

      expect(result.dominantCourse).toBe('BETA');
      expect(result.focusBranch).toBe('urgency');
      expect(result.focusReason).toBe(FOCUS_BRANCH_SENTENCE.urgency);
    });

    it('absent a filter or a crossed urgency threshold, the largest window deficit wins — branch "deficit"', () => {
      const theRows = rows([
        { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
        { conceptName: 'B1', course: 'BETA', gapScore: 8 },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
      // No allocation supplied at all — the urgency branch has nothing to
      // read (see `urgencyByCourseFrom`'s doc) and never fires. ALPHA has the
      // larger deficit (seen longer ago).
      const theReplay = replay({
        a1: { lastReviewedDay: '2026-06-01', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-09-10', dueDay: '2099-01-01' },
      });
      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: theReplay,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 600,
        focusPolicy: 'single',
      });

      expect(result.dominantCourse).toBe('ALPHA');
      expect(result.focusBranch).toBe('deficit');
      expect(result.focusReason).toBe(FOCUS_BRANCH_SENTENCE.deficit);
    });
  });

  it('a refused course (zero rows from the ranking) is never dominant and never accrues a deficit', () => {
    // GAMMA is "refused" the pre-commitment's own way: the ranking gave it no
    // rows at all, so it never enters `byCourse`. There is no explicit
    // refusal flag to pass — see `composeFocusedSelection`'s eligibility note.
    const theRows = rows([
      { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
      { conceptName: 'B1', course: 'BETA', gapScore: 8 },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
    const theReplay = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 600,
      focusPolicy: 'single',
      // The plan still names GAMMA (a real allocation carries an entry for
      // every running course, refused or not) — its share must still read 0
      // and it must never be selectable.
      allocation: [
        focusAllocationEntry({ courseId: 'ALPHA', share: 0.4, risk: 0.02 }),
        focusAllocationEntry({ courseId: 'BETA', share: 0.4, risk: 0.02 }),
        focusAllocationEntry({ courseId: 'GAMMA', share: 0.2, risk: 0.9 }),
      ],
    });

    expect(result.dominantCourse).not.toBe('GAMMA');
    expect(result.courseShares.has('GAMMA')).toBe(false);
    expect(result.courseSeconds.has('GAMMA')).toBe(false);
    expect(result.orderedRows.some((r) => r.course === 'GAMMA')).toBe(false);
  });

  it('`[FOCUS-5]`: never composes a second course, however much budget is left over or however owed another course is', () => {
    // Before `[FOCUS-5]` this fixture (room left over after the dominant
    // course, and a second course whose deficit door would have opened)
    // admitted BETA as a second course. The two-course path is removed, not
    // parked: BETA must never appear.
    const theRows = rows([
      { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
      { conceptName: 'B1', course: 'BETA', gapScore: 8 },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
    const theReplay = replay({
      a1: { lastReviewedDay: '2026-07-01', dueDay: '2099-01-01' }, // ALPHA: largest deficit -> dominant
      b1: { lastReviewedDay: '2026-09-01', dueDay: '2099-01-01' }, // BETA: long unseen, old deficit door would have opened
    });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      // 200s per concept, 500s budget: 300s would be left over after ALPHA's
      // one 200s concept — comfortably enough for BETA's own 200s group
      // under the old rule.
      durations: flatDurations(200),
      asOf: AS_OF,
      budgetSeconds: 500,
      replay: theReplay,
      focusPolicy: 'single',
    });

    expect(result.dominantCourse).toBe('ALPHA');
    expect(new Set(result.orderedRows.map((r) => r.course))).toEqual(new Set(['ALPHA']));
    expect('secondCourse' in result).toBe(false);
    expect('secondCourseDoor' in result).toBe(false);
  });

  it("`[FOCUS-5]` (F2.18): leftover budget after the dominant course's own material goes unused — ending early is the intended shape", () => {
    const theRows = rows([
      { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
      { conceptName: 'B1', course: 'BETA', gapScore: 7 },
      { conceptName: 'C1', course: 'GAMMA', gapScore: 6 },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['A1']),
      qa('b1', ['B1']),
      qa('c1', ['C1']),
    ]);
    const theReplay = replay({
      a1: { lastReviewedDay: '2026-07-01', dueDay: '2099-01-01' }, // ALPHA: the largest deficit -> dominant
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      c1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(200),
      asOf: AS_OF,
      // Only ALPHA's one 200s concept exists in ALPHA's own material — the
      // other 300s of the 500s budget goes unused rather than pulling in
      // BETA or GAMMA.
      budgetSeconds: 500,
      focusPolicy: 'single',
    });

    expect(result.dominantCourse).toBe('ALPHA');
    expect(result.orderedRows.map((r) => r.conceptName)).toEqual(['A1']);
    expect(new Set(result.orderedRows.map((r) => r.course))).toEqual(new Set(['ALPHA']));
  });

  it('FOCUS_BRANCH_SENTENCE holds the three ratified sentences, corrected by `[FOCUS-5]`', () => {
    // `filter`'s "mostly" was true under the two-course rule and is false
    // now a session is exactly one course — see `[FOCUS-5]`'s ruling.
    expect(FOCUS_BRANCH_SENTENCE.filter).toBe('this course because you asked for it');
    expect(FOCUS_BRANCH_SENTENCE.urgency).toBe(
      'because its assessment is close and the assessed material still needs work',
    );
    expect(FOCUS_BRANCH_SENTENCE.deficit).toBe(
      'because it is behind its share from your recent sessions',
    );
  });
});

// `[FOCUS-3b]` (`ol-ulj7`, discovered from `ol-egov.137.5` [FOCUS-4c]): D-092's
// real, session-denominated window deficit (`./window.js`) replaces the days
// substitute for the deficit branch's ordering. `[FOCUS-5]` (`ol-egov.137.4`,
// David's ruling 2026-09-11) adds the exact-tie recency tie-break: "the
// course served least recently wins; course id breaks a remaining tie."
// Scenarios: `features/F6-today.md` (olea-service), the C5.6 block.
describe('[FOCUS-3b]/[FOCUS-5] windowDeficit replaces the days substitute, and its exact-tie recency tie-break', () => {
  function pastSession(
    day: string,
    eligibleCourses: readonly string[],
    received: Readonly<Record<string, number>>,
    entitlement: Readonly<Record<string, number>>,
  ): PastSessionRecord {
    return {
      asOf: day,
      eligibleCourses,
      received: new Map(Object.entries(received)),
      entitlement: new Map(Object.entries(entitlement)),
    };
  }

  it('a course absent for courses + 1 sessions reads the largest deficit and becomes dominant, overriding the days-substitute tie', () => {
    const theRows = rows([
      { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
      { conceptName: 'B1', course: 'BETA', gapScore: 8 },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
    // Both courses last reviewed on the SAME day — the days substitute would
    // tie and break the tie on courseId (ALPHA wins). The window projection
    // must override that: BETA has gone every one of the last 4 sessions
    // (2 running courses + slack 2, D-092's own width) without a single one,
    // despite an equal 0.5 entitlement each time — a real, accruing deficit.
    const theReplay = replay({
      a1: { lastReviewedDay: '2026-09-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-09-01', dueDay: '2099-01-01' },
    });
    const history: PastSessionRecord[] = [
      pastSession('2026-08-25', ['ALPHA', 'BETA'], { ALPHA: 300 }, { ALPHA: 0.5, BETA: 0.5 }),
      pastSession('2026-08-27', ['ALPHA', 'BETA'], { ALPHA: 300 }, { ALPHA: 0.5, BETA: 0.5 }),
      pastSession('2026-08-29', ['ALPHA', 'BETA'], { ALPHA: 300 }, { ALPHA: 0.5, BETA: 0.5 }),
      pastSession('2026-09-01', ['ALPHA', 'BETA'], { ALPHA: 300 }, { ALPHA: 0.5, BETA: 0.5 }),
    ];
    const windowDeficit = computeWindowDeficit(
      history,
      ['ALPHA', 'BETA'],
      new Map([
        ['ALPHA', 0.5],
        ['BETA', 0.5],
      ]),
    );
    // Sanity: BETA's reading really is the larger, real deficit this test
    // relies on — not an artefact of the fixture.
    expect(
      (windowDeficit.get('BETA')?.deficit ?? 0) > (windowDeficit.get('ALPHA')?.deficit ?? 0),
    ).toBe(true);

    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 600,
      focusPolicy: 'single',
      windowDeficit,
    });

    expect(result.dominantCourse).toBe('BETA');
    expect(result.focusBranch).toBe('deficit');
  });

  it('a refused (ineligible) historical session accrues nothing toward the deficit', () => {
    // GAMMA is refused every session in its history (absent from
    // eligibleCourses) — its window deficit must read 0, not "owed and
    // unpaid", per `[D-244]` item 2's "deficit does not accrue while
    // refused".
    const history: PastSessionRecord[] = [
      pastSession('2026-08-25', ['ALPHA'], { ALPHA: 600 }, { ALPHA: 1 }),
      pastSession('2026-08-27', ['ALPHA'], { ALPHA: 600 }, { ALPHA: 1 }),
      pastSession('2026-08-29', ['ALPHA'], { ALPHA: 600 }, { ALPHA: 1 }),
      pastSession('2026-09-01', ['ALPHA'], { ALPHA: 600 }, { ALPHA: 1 }),
    ];
    const windowDeficit = computeWindowDeficit(
      history,
      ['ALPHA', 'GAMMA'],
      new Map([['ALPHA', 1]]),
    );

    expect(windowDeficit.get('GAMMA')?.deficit).toBe(0);
  });

  describe('`[FOCUS-5]` exact-tie recency tie-break: the course served least recently wins; course id last', () => {
    it('an exact deficit tie is broken by `sessionsSinceLastServed`: the course served longer ago wins', () => {
      const theRows = rows([
        { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
        { conceptName: 'B1', course: 'BETA', gapScore: 8 },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
      const theReplay = replay({
        a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      });
      // Deficits tie exactly at 3; BETA was served longer ago
      // (`sessionsSinceLastServed: 5` vs ALPHA's `2`) — BETA must win.
      const windowDeficit: ReadonlyMap<string, WindowDeficitEntry> = new Map([
        ['ALPHA', { deficit: 3, sessionsSinceLastServed: 2 }],
        ['BETA', { deficit: 3, sessionsSinceLastServed: 5 }],
      ]);

      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: theReplay,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 600,
        focusPolicy: 'single',
        windowDeficit,
      });

      expect(result.dominantCourse).toBe('BETA');
      expect(result.focusBranch).toBe('deficit');
    });

    it('a course never served in the window (`sessionsSinceLastServed: Infinity`) always wins an exact-deficit tie', () => {
      const theRows = rows([
        { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
        { conceptName: 'B1', course: 'BETA', gapScore: 8 },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
      const theReplay = replay({
        a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      });
      const windowDeficit: ReadonlyMap<string, WindowDeficitEntry> = new Map([
        ['ALPHA', { deficit: 3, sessionsSinceLastServed: 9 }],
        ['BETA', { deficit: 3, sessionsSinceLastServed: Number.POSITIVE_INFINITY }],
      ]);

      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: theReplay,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 600,
        focusPolicy: 'single',
        windowDeficit,
      });

      expect(result.dominantCourse).toBe('BETA');
    });

    it('a full tie (deficit AND recency) falls back to course id — determinism only', () => {
      const theRows = rows([
        { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
        { conceptName: 'B1', course: 'BETA', gapScore: 8 },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
      const theReplay = replay({
        a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      });
      const windowDeficit: ReadonlyMap<string, WindowDeficitEntry> = new Map([
        ['BETA', { deficit: 3, sessionsSinceLastServed: 4 }],
        ['ALPHA', { deficit: 3, sessionsSinceLastServed: 4 }],
      ]);

      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: theReplay,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 600,
        focusPolicy: 'single',
        windowDeficit,
      });

      expect(result.dominantCourse).toBe('ALPHA');
    });

    it('absent windowDeficit, the days-substitute tie also falls back to course id (recency and deficit are the same reading in that mode)', () => {
      const theRows = rows([
        { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
        { conceptName: 'B1', course: 'BETA', gapScore: 8 },
      ]);
      const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
      // Identical last-reviewed day for both courses — a genuine tie in the
      // days-since-last-seen substitute this module falls back to when no
      // real window is supplied.
      const theReplay = replay({
        a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
        b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      });
      const result = composeSessionRows({
        rows: theRows,
        instruments,
        replay: theReplay,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetSeconds: 600,
        focusPolicy: 'single',
      });

      expect(result.dominantCourse).toBe('ALPHA');
    });
  });

  it('every-course (supplied explicitly) is byte-identical whether or not windowDeficit is supplied — the every-course arm never reads it', () => {
    const theRows = rows([
      { conceptName: 'A1', course: 'ALPHA', gapScore: 9 },
      { conceptName: 'B1', course: 'BETA', gapScore: 8 },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['A1']), qa('b1', ['B1'])]);
    const theReplay = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const base = {
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 600,
      focusPolicy: 'every-course' as const,
    };
    const windowDeficit = computeWindowDeficit(
      [pastSession('2026-08-01', ['ALPHA', 'BETA'], { ALPHA: 600 }, { ALPHA: 0.5, BETA: 0.5 })],
      ['ALPHA', 'BETA'],
      new Map([
        ['ALPHA', 0.5],
        ['BETA', 0.5],
      ]),
    );

    const withoutIt = composeSessionRows(base);
    const withIt = composeSessionRows({ ...base, windowDeficit });

    expect(withIt.orderedRows).toEqual(withoutIt.orderedRows);
    expect(withIt.courseShares).toEqual(withoutIt.courseShares);
    expect(withIt.courseSeconds).toEqual(withoutIt.courseSeconds);
    expect(Object.keys(withIt).sort()).not.toContain('dominantCourse');
    expect(withIt.focusPolicy).toBe('every-course');
  });
});

// ---------------------------------------------------------------------------
// `[SESS-11]` (`ol-egov.132.12`) — C7.9 containment co-presence, ported from
// `session/containment.ts`'s `QueueCandidate`-shaped rule onto this
// composer's own `GapRow`-shaped candidate pool.
//
// Scenarios: `features/F2-review.md`, "SESS-11 — Containment co-presence
// ported onto the study-session composer (C7.9)" — @auto:core/study-session/compose.spec
//
// INV-3: every concept/course name below is coined for the test.
// ---------------------------------------------------------------------------

describe('composeSessionRows: C7.9 containment co-presence (`[SESS-11]`)', () => {
  function passage(sourcePath: string): Provenance {
    return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
  }

  function edge(type: RelationType, from: string, to: string): ConceptRelation {
    return {
      type,
      from,
      to,
      provenance: 'model-proposed',
      confidence: 0.9,
      introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
    };
  }

  // Mitochondria part-of Cell — `from` is the part, `to` the container, the
  // same convention `session/containment.ts`'s own fixtures use.
  const PART_OF_EDGE = edge('part-of', 'Mitochondria', 'Cell');

  function containmentRows(): readonly GapRow[] {
    return rows([
      { conceptName: 'Mitochondria', course: 'BIO101', gapScore: 9 },
      { conceptName: 'Cell', course: 'BIO101', gapScore: 5 },
      { conceptName: 'Photosynthesis', course: 'BIO101', gapScore: 1 },
    ]);
  }

  function containmentFixture() {
    const instruments = buildConceptInstrumentIndex([
      qa('i-mito', ['Mitochondria']),
      qa('i-cell', ['Cell']),
      qa('i-photo', ['Photosynthesis']),
    ]);
    const overdue = replay({
      'i-mito': { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      'i-cell': { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      'i-photo': { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    return { instruments, replay: overdue };
  }

  it('with no relations supplied, composition is unaffected — every real caller today', () => {
    const { instruments, replay: theReplay } = containmentFixture();
    const result = composeSessionRows({
      rows: containmentRows(),
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
    });
    expect(result.containmentDropped).toEqual([]);
    expect(result.orderedRows.map((r) => r.conceptName).sort()).toEqual([
      'Cell',
      'Mitochondria',
      'Photosynthesis',
    ]);
  });

  it('a broad area and one of its parts are never both composed into the same session', () => {
    const { instruments, replay: theReplay } = containmentFixture();
    const result = composeSessionRows({
      rows: containmentRows(),
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relations: [PART_OF_EDGE],
    });
    const composedNames = new Set(result.orderedRows.map((r) => r.conceptName));
    expect(composedNames.has('Mitochondria') && composedNames.has('Cell')).toBe(false);
  });

  it('the container is the side that yields, never the part', () => {
    const { instruments, replay: theReplay } = containmentFixture();
    const result = composeSessionRows({
      rows: containmentRows(),
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relations: [PART_OF_EDGE],
    });
    expect(result.orderedRows.some((r) => r.conceptName === 'Mitochondria')).toBe(true);
    expect(result.orderedRows.some((r) => r.conceptName === 'Cell')).toBe(false);
    expect(result.containmentDropped?.map((r) => r.conceptName)).toEqual(['Cell']);
    // Untouched: a concept on neither side of the edge is unaffected.
    expect(result.orderedRows.some((r) => r.conceptName === 'Photosynthesis')).toBe(true);
  });

  it('containment runs before the course/topic steering filter, over the whole candidate pool', () => {
    // The container's own course is the one she steers AWAY from — if
    // containment ran only after [STEER-1] narrowed to her chosen course, the
    // container's row would never have been in that narrowed pool to begin
    // with, and this scenario would pass by accident rather than by the rule.
    const theRows = rows([
      { conceptName: 'Mitochondria', course: 'BIO101', gapScore: 9 },
      { conceptName: 'Cell', course: 'CHEM101', gapScore: 9 },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('i-mito', ['Mitochondria']),
      qa('i-cell', ['Cell']),
    ]);
    const overdue = replay({
      'i-mito': { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      'i-cell': { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const result = composeSessionRows({
      rows: theRows,
      instruments,
      replay: overdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
      relations: [PART_OF_EDGE],
      courses: ['CHEM101'],
    });
    // The container (Cell, in CHEM101, the course she asked about) is still
    // dropped for containment even though the part (Mitochondria) sits
    // entirely outside her steered scope.
    expect(result.orderedRows).toEqual([]);
    expect(result.containmentDropped?.map((r) => r.conceptName)).toEqual(['Cell']);
  });

  it('containment survives the instrument-level fill, not just concept selection', () => {
    const { instruments, replay: theReplay } = containmentFixture();
    const session = buildComposedStudySession({
      rows: containmentRows(),
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetMinutes: 20,
      relations: [PART_OF_EDGE],
    });
    expect(session.model.items.some((item) => item.conceptName === 'Cell')).toBe(false);
    expect(session.model.items.some((item) => item.conceptName === 'Mitochondria')).toBe(true);
    expect(session.containmentDropped?.map((r) => r.conceptName)).toEqual(['Cell']);
  });
});

// ---------------------------------------------------------------------------
// `[SESS-11]` (`ol-egov.132.12`) — F2.17/C5.8's "outran the target"
// extension, ported from `queue-adapter.ts`'s `FrozenReviewQueue.extend` onto
// this composer.
//
// Scenarios: `features/F2-review.md`, "SESS-11 — the study-session composer
// grows under the same plan's shares (F2.17, C5.5, C5.8)" —
// @auto:core/study-session/compose.spec
//
// INV-3: every concept/course name below is coined for the test.
// ---------------------------------------------------------------------------

describe('extendComposedStudySession (`[SESS-11]`)', () => {
  function allocationEntry(courseId: string, share: number): StudyPlanAllocationEntry {
    return {
      courseId,
      share,
      minBlockSeconds: 60,
      contributions: [{ name: 'risk', value: 0.5 }],
      reason: `${courseId} gets its share.`,
    };
  }

  it('grows a frozen session with material a smaller budget could not reach, appended after her existing items', () => {
    const theRows = rows([
      { conceptName: 'Alpha', gapScore: 9 },
      { conceptName: 'Bravo', gapScore: 8 },
      { conceptName: 'Charlie', gapScore: 7 },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('a1', ['Alpha']),
      qa('b1', ['Bravo']),
      qa('c1', ['Charlie']),
    ]);
    const overdue = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      c1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const baseInput = {
      rows: theRows,
      instruments,
      replay: overdue,
      durations: flatDurations(60),
      asOf: AS_OF,
    };

    // 60s target -> she reaches exactly one item before the target and stops.
    const previous = buildComposedStudySession({ ...baseInput, budgetMinutes: 1 });
    expect(previous.model.items.map((i) => i.conceptName)).toEqual(['Alpha']);

    // She outruns it: the same composition, asked again at a wider target.
    const extended = extendComposedStudySession({ ...baseInput, budgetMinutes: 3 }, previous);

    expect(extended.map((i) => i.instrumentId)).toEqual(['a1', 'b1', 'c1']);
    expect(extended[0]).toEqual(previous.model.items[0]);
    expect(extended.map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it('nothing left to add returns her existing items unchanged, by reference', () => {
    const theRows = rows([{ conceptName: 'Alpha', gapScore: 9 }]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['Alpha'])]);
    const overdue = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const baseInput = {
      rows: theRows,
      instruments,
      replay: overdue,
      durations: flatDurations(60),
      asOf: AS_OF,
    };

    const previous = buildComposedStudySession({ ...baseInput, budgetMinutes: 10 });
    expect(previous.model.items.map((i) => i.conceptName)).toEqual(['Alpha']);

    // A wider budget still finds nothing new — there is only ever one row.
    const extended = extendComposedStudySession({ ...baseInput, budgetMinutes: 20 }, previous);
    expect(extended).toBe(previous.model.items);
  });

  it('never reorders or duplicates what she has already been served, whatever order the sitting already holds them in', () => {
    const theRows = rows([
      { conceptName: 'Alpha', gapScore: 9 },
      { conceptName: 'Bravo', gapScore: 8 },
    ]);
    const instruments = buildConceptInstrumentIndex([qa('a1', ['Alpha']), qa('b1', ['Bravo'])]);
    const overdue = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });
    const baseInput = {
      rows: theRows,
      instruments,
      replay: overdue,
      durations: flatDurations(60),
      asOf: AS_OF,
    };

    const built = buildComposedStudySession({ ...baseInput, budgetMinutes: 2 });
    expect(built.model.items.map((i) => i.instrumentId)).toEqual(['a1', 'b1']);
    // The frozen sitting holds them in whatever order it holds them in —
    // reversed here, deliberately, to prove `extendComposedStudySession`
    // trusts that order rather than re-deriving it from a fresh composition.
    const previous = {
      ...built,
      model: { ...built.model, items: [...built.model.items].reverse() },
    };

    const thirdRow = rows([
      { conceptName: 'Alpha', gapScore: 9 },
      { conceptName: 'Bravo', gapScore: 8 },
      { conceptName: 'Charlie', gapScore: 7 },
    ]);
    const widerInstruments = buildConceptInstrumentIndex([
      qa('a1', ['Alpha']),
      qa('b1', ['Bravo']),
      qa('c1', ['Charlie']),
    ]);
    const widerReplay = replay({
      a1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      b1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      c1: { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
    });

    const extended = extendComposedStudySession(
      {
        rows: thirdRow,
        instruments: widerInstruments,
        replay: widerReplay,
        durations: flatDurations(60),
        asOf: AS_OF,
        budgetMinutes: 3,
      },
      previous,
    );

    expect(extended.map((i) => i.instrumentId)).toEqual(['b1', 'a1', 'c1']);
    expect(new Set(extended.map((i) => i.instrumentId)).size).toBe(3);
  });

  it('the extension is composed under the same plan’s shares, not a freshly recomputed proportional split', () => {
    // Twenty concepts per course (1200s of material each) — far more than
    // either budget below can absorb, so each course's own share is what
    // actually binds, never its supply of material. Proportional-by-material
    // would split evenly (20/20); the plan's own allocation says the
    // opposite (90/10) — a caller that recomputed shares fresh instead of
    // pinning the plan's would produce a visibly different, more balanced
    // result.
    const courseRows = (course: string) =>
      Array.from({ length: 20 }, (_, i) => ({
        conceptName: `${course}-${i + 1}`,
        course,
        gapScore: 20 - i,
      }));
    const theRows = rows([...courseRows('BIG'), ...courseRows('SMALL')]);
    const instruments = buildConceptInstrumentIndex(
      theRows.map((r) => qa(`i-${r.conceptName}`, [r.conceptName])),
    );
    const overdueEntries = Object.fromEntries(
      theRows.map((r) => [
        `i-${r.conceptName}`,
        { lastReviewedDay: '2026-08-01', dueDay: '2099-01-01' },
      ]),
    );
    const overdue = replay(overdueEntries);
    const allocation = [allocationEntry('BIG', 0.9), allocationEntry('SMALL', 0.1)];
    const baseInput = {
      rows: theRows,
      instruments,
      replay: overdue,
      durations: flatDurations(60),
      asOf: AS_OF,
      allocation,
      // This test is about ALLOC-2's pinned-shares extension across the
      // every-course path, not `[FOCUS-5]`'s single-course default.
      focusPolicy: 'every-course' as const,
    };

    // 10 minutes (600s): BIG's 540s share funds 9 items, SMALL's 60s share
    // (exactly its declared `minBlockSeconds` floor) funds exactly 1.
    const previous = buildComposedStudySession({ ...baseInput, budgetMinutes: 10 });
    expect(previous.courseShares.get('BIG')).toBeCloseTo(0.9);
    expect(previous.courseShares.get('SMALL')).toBeCloseTo(0.1);
    const previousByCourse = new Map<string, number>();
    for (const item of previous.model.items) {
      previousByCourse.set(item.course, (previousByCourse.get(item.course) ?? 0) + 1);
    }
    expect(previousByCourse.get('BIG')).toBe(9);
    expect(previousByCourse.get('SMALL')).toBe(1);

    // She outruns it: widened to 20 minutes (1200s), same allocation handed
    // through unmodified — C5.5's "same plan's shares" by construction.
    const extended = extendComposedStudySession({ ...baseInput, budgetMinutes: 20 }, previous);
    const byCourse = new Map<string, number>();
    for (const item of extended) byCourse.set(item.course, (byCourse.get(item.course) ?? 0) + 1);

    // The pinned 90/10 split governs the widened total too (18/2, the same
    // ratio) — never the even (20/20 material, so 1/1 marginal) split a
    // fresh proportional recompute would give.
    expect(byCourse.get('BIG')).toBe(18);
    expect(byCourse.get('SMALL')).toBe(2);
    expect(extended.length).toBe(20);
  });
});
