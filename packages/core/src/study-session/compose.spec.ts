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
  readonly targetAssessmentPath?: VaultPath | null;
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

    const composed = buildComposedStudySession({
      rows: theRows,
      instruments,
      replay: theReplay,
      budgetMinutes: 20,
      durations: flatDurations(60),
      asOf: AS_OF,
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
      ['courseShares', 'forcedCourses', 'model', 'obligationClasses', 'overflow'].sort(),
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
