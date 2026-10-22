/**
 * `[D-554]` / `[D-113]` item 3 (`ol-egov.141.89.10.139`): the wrong-answer lift never moves a
 * concept past one with more days waiting. Composition orders by days waiting first
 * (`overdueFirst`'s `overdueDays` key, `compose.ts`); the lift acts only through the gap score,
 * which the order reads strictly after days waiting. The lift's real size is bounded by
 * `DECLARED_WRONG_ANSWER_LIFT_MAX_NEED_SHARE` (0.25) in `oracle/rank.ts`; a stand-in score far
 * beyond any real lift is also used, so the assertion does not rest on the lift staying small.
 *
 * Fixture helpers are copied from `compose.prerequisite-tie-break.spec.ts`, not imported.
 * INV-3: every name below is invented and subject-neutral.
 */

import { describe, expect, it } from 'vitest';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import { DECLARED_WRONG_ANSWER_LIFT_MAX_NEED_SHARE } from '../oracle/rank.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { ReplayResult } from '../session/replay.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { composeSessionRows } from './compose.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';

const AS_OF = '2026-09-14';

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

/** Concept `waiter` is due `waiterDueDay`, `lifted` is due `liftedDueDay`; `lifted` carries `liftedScore`. */
function compose(opts: {
  readonly waiterDueDay: string;
  readonly liftedDueDay: string;
  readonly baseScore: number;
  readonly liftedScore: number;
}): readonly string[] {
  const gapRows = rows([
    { conceptName: 'Waiter', gapScore: opts.baseScore },
    { conceptName: 'Lifted', gapScore: opts.liftedScore },
  ]);
  const instrumentIndex = buildConceptInstrumentIndex([
    qa('i-Waiter', ['Waiter']),
    qa('i-Lifted', ['Lifted']),
  ]);
  const replayed = replay({
    'i-Waiter': { lastReviewedDay: '2026-07-01', dueDay: opts.waiterDueDay },
    'i-Lifted': { lastReviewedDay: '2026-07-01', dueDay: opts.liftedDueDay },
  });
  return composeSessionRows({
    rows: gapRows,
    instruments: instrumentIndex,
    replay: replayed,
    durations: flatDurations(60),
    asOf: AS_OF,
    budgetSeconds: 1200,
  }).orderedRows.map((r) => r.conceptName);
}

/** A score the real lift could never produce: the lifted concept's score is `base * (1 + cap)`. */
const CAPS = [0.05, DECLARED_WRONG_ANSWER_LIFT_MAX_NEED_SHARE, 0.5] as const;
const BASE = 4;
const EXAGGERATED = 1_000_000;

describe('composeSessionRows: `[D-554]` wrong-answer lift versus days waiting (`[D-113]` item 3)', () => {
  it('control: with equal days waiting the lifted gap score does decide the order', () => {
    expect(
      compose({
        waiterDueDay: '2026-09-01',
        liftedDueDay: '2026-09-01',
        baseScore: BASE,
        liftedScore: BASE * (1 + 0.25),
      }),
    ).toEqual(['Lifted', 'Waiter']);
  });

  for (const cap of CAPS) {
    it(`a concept with fewer days waiting stays behind one with more, at lift cap ${cap}`, () => {
      expect(
        compose({
          waiterDueDay: '2026-08-01', // 44 days waiting
          liftedDueDay: '2026-09-12', // 2 days waiting
          baseScore: BASE,
          liftedScore: BASE * (1 + cap),
        }),
      ).toEqual(['Waiter', 'Lifted']);
    });
  }

  it('holds even for a lift far beyond any real cap (exaggerated score stand-in)', () => {
    expect(
      compose({
        waiterDueDay: '2026-08-01',
        liftedDueDay: '2026-09-12',
        baseScore: BASE,
        liftedScore: EXAGGERATED,
      }),
    ).toEqual(['Waiter', 'Lifted']);
  });

  it('holds when the gap is a single day waiting and the lifted score is exaggerated', () => {
    expect(
      compose({
        waiterDueDay: '2026-09-12', // 2 days waiting
        liftedDueDay: '2026-09-13', // 1 day waiting
        baseScore: BASE,
        liftedScore: EXAGGERATED,
      }),
    ).toEqual(['Waiter', 'Lifted']);
  });
});
