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

import { describe, expect, it } from 'vitest';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { ReplayResult } from '../session/replay.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildStudySession } from './build.js';
import {
  buildComposedStudySession,
  classifyObligation,
  composeSessionRows,
  RETRIEVAL_BASELINE_STAGE_LADDER_DAYS,
} from './compose.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';

const AS_OF = '2026-09-14';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface RowSpec {
  readonly conceptName: string;
  readonly course?: string;
  readonly gapScore?: number;
  readonly masteryState?: OracleMasteryState;
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
    });

    expect(result.forcedCourses).toEqual(['B']);
    expect(result.orderedRows.map((r) => r.conceptName)).toContain('Neglected');
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
    });

    // Course B's block (unmet, precedence 0) sorts ahead of course A's (elective, precedence 3).
    expect(result.orderedRows.map((r) => r.course)).toEqual(['B', 'A']);
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

    const expectedOrder = composeSessionRows({
      rows: theRows,
      instruments,
      replay: theReplay,
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetSeconds: 1200,
    }).orderedRows;
    const expectedModel = buildStudySession({
      rows: expectedOrder,
      instruments,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
      order: 'given',
    });

    expect(composed.model).toEqual(expectedModel);
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
    });

    // The whole result is exactly these four structural fields — obligation
    // classes, an order, shares, counts — never a fifth, prose-shaped one. A
    // future edit adding a rendered "composition sentence" field here would
    // fail this test, which is the point: that sentence belongs to
    // `session-builder/copy.ts`, over this structure, not to this module.
    expect(Object.keys(composed).sort()).toEqual(
      ['courseShares', 'forcedCourses', 'model', 'overflow'].sort(),
    );
  });
});
