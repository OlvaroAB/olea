/**
 * Proves `checkReentryEquality` against the real production seam
 * (`../study-session/reentry.js`'s `composeReentrySession`), not a stubbed
 * struct — the same discipline `rhythm-neutralised-twin.spec.ts` follows for
 * its own detector.
 */
import { describe, expect, it } from 'vitest';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { ReplayResult } from '../session/replay.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { DurationModel } from '../study-session/duration.js';
import { buildConceptInstrumentIndex } from '../study-session/instrument-index.js';
import { composeReentrySession, REENTRY_SIZE_FLOOR_MINUTES } from '../study-session/reentry.js';
import type { VaultPath } from '../vault/types.js';
import { checkReentryEquality, type ReentryEqualityCase } from './reentry-equality.js';

const AS_OF = '2026-09-14';

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

function orderedIdsFrom(daysSinceLastReview: number): readonly string[] {
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

  const result = composeReentrySession({
    rows: theRows,
    instruments,
    replay: emptyReplay(),
    durations: flatDurations(60),
    asOf: AS_OF,
    daysSinceLastReview,
    candidateBudgetMinutes: REENTRY_SIZE_FLOOR_MINUTES,
    ordinaryBudgetMinutes: REENTRY_SIZE_FLOOR_MINUTES,
  });
  return result.full.model.items.map((item) => item.instrumentId);
}

describe('checkReentryEquality', () => {
  it('passes on the real production seam: re-entry and ordinary composed at the same budget are identical', () => {
    const reentryIds = orderedIdsFrom(21); // clears the absence threshold
    const ordinaryIds = orderedIdsFrom(0); // does not

    const cases: readonly ReentryEqualityCase[] = [
      {
        id: 'case-1',
        reentryOrderedInstrumentIds: reentryIds,
        ordinaryOrderedInstrumentIds: ordinaryIds,
      },
    ];
    const verdict = checkReentryEquality(cases);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.diverged).toEqual([]);
    expect(reentryIds.length).toBeGreaterThan(0); // not a vacuous pass over two empty lists
  });

  it('FAILS on a reordering — a same-item, different-order case, standing in for a second selection mechanism', () => {
    const cases: readonly ReentryEqualityCase[] = [
      {
        id: 'reordered',
        reentryOrderedInstrumentIds: ['a1', 'b1', 'c1'],
        ordinaryOrderedInstrumentIds: ['b1', 'a1', 'c1'],
      },
    ];
    const verdict = checkReentryEquality(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.diverged).toEqual(['reordered']);
  });

  it('FAILS on a different item set (e.g. a baseline-driven counterfactual that pulls in different concepts)', () => {
    const cases: readonly ReentryEqualityCase[] = [
      {
        id: 'different-set',
        reentryOrderedInstrumentIds: ['a1', 'b1'],
        ordinaryOrderedInstrumentIds: ['a1', 'c1'],
      },
    ];
    const verdict = checkReentryEquality(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.diverged).toEqual(['different-set']);
  });

  it('reports which of several cases diverged, not just that some did', () => {
    const cases: readonly ReentryEqualityCase[] = [
      { id: 'ok-1', reentryOrderedInstrumentIds: ['x'], ordinaryOrderedInstrumentIds: ['x'] },
      {
        id: 'bad-1',
        reentryOrderedInstrumentIds: ['x', 'y'],
        ordinaryOrderedInstrumentIds: ['y', 'x'],
      },
      { id: 'ok-2', reentryOrderedInstrumentIds: [], ordinaryOrderedInstrumentIds: [] },
    ];
    const verdict = checkReentryEquality(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(3);
    expect(verdict.measured.diverged).toEqual(['bad-1']);
  });

  it('fails on zero cases (N-013)', () => {
    const verdict = checkReentryEquality([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
  });
});
