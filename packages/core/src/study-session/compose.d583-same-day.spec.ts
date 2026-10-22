/**
 * `[D-583]` (`ol-egov.141.89.10.137`, David, 2026-10-22): an instrument answered today (its last
 * review falls on the composition's calendar day) is not served again that day while anything
 * else is eligible. Scenarios: `features/F2-review.md`, "F2.17 / [D-583]" (olea-service).
 *
 * A dedicated file, not an addition to `compose.spec.ts`, which other lanes co-own. Fixture
 * helpers are copied from `compose.prerequisite-tie-break.spec.ts`, not imported.
 *
 * The lift of `[D-554]` enters composition only as a higher `gapScore` on the rows it lifts, so
 * "with the lift" below is a row whose `gapScore` is far above the others; no spacing signal exists
 * at cap 0 either, so both readings must give the same answer.
 *
 * INV-3: every concept/course name below is coined for this test file.
 */

import { describe, expect, it } from 'vitest';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { ReplayResult } from '../session/replay.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildComposedStudySession, extendComposedStudySession } from './compose.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';

const AS_OF = '2026-09-14';
const TODAY = '2026-09-14';
const YESTERDAY = '2026-09-13';
const EARLIER = '2026-09-01';

function row(conceptName: string, gapScore: number, rank: number): GapRow {
  return {
    conceptName,
    conceptKey: conceptName,
    course: 'CRS101',
    gapClass: 'mastery-gap' as GapClass,
    rank,
    oracleRank: rank,
    priorityScore: gapScore,
    gapScore,
    readiness: {
      assessmentFormat: 'unknown' as AssessmentFormat,
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: 'seed',
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

/** Reviewed on `lastReviewedDay` (at midday, as a real review is), next due far ahead: elective. */
function replay(entries: Readonly<Record<string, string>>): ReplayResult {
  const states = new Map(
    Object.entries(entries).map(([instrumentId, lastReviewedDay]) => [
      instrumentId,
      {
        instrumentId,
        state: {
          schemaVersion: 1 as const,
          due: '2099-01-01T00:00:00.000Z',
          stability: 10,
          difficulty: 5,
          scheduledDays: 10,
          learningStepIndex: 0,
          reps: 1,
          lapses: 0,
          learningState: 'review' as const,
          lastReview: `${lastReviewedDay}T12:00:00.000Z`,
        },
        reviewCount: 1,
        lastReviewedAt: `${lastReviewedDay}T12:00:00.000Z`,
      },
    ]),
  );
  return { states, replayedCount: states.size, skippedCount: 0 };
}

/** Two concepts answered today and two answered earlier; the today ones outrank the rest on score. */
function world(todayScore: number) {
  return {
    rows: [
      row('Tdone1', todayScore, 1),
      row('Tdone2', todayScore, 2),
      row('Other1', 5, 3),
      row('Other2', 5, 4),
    ],
    instruments: buildConceptInstrumentIndex([
      qa('t1', ['Tdone1']),
      qa('t2', ['Tdone2']),
      qa('o1', ['Other1']),
      qa('o2', ['Other2']),
    ]),
    replay: replay({ t1: TODAY, t2: TODAY, o1: EARLIER, o2: EARLIER }),
    durations: flatDurations(60),
    asOf: AS_OF,
  };
}

const ids = (s: { readonly model: { readonly items: readonly { instrumentId: string }[] } }) =>
  s.model.items.map((i) => i.instrumentId);

describe('[D-583] an instrument answered today is not served again that day while anything else is eligible', () => {
  // 9 = no lift in play (cap 0); 99 = a lift that puts the answered-today rows far ahead on score.
  it.each([9, 99])('not chosen while another instrument is servable (score %d)', (todayScore) => {
    const session = buildComposedStudySession({ ...world(todayScore), budgetMinutes: 2 });
    expect(ids(session)).toEqual(['o1', 'o2']);
    expect(session.model.items.every((i) => !['t1', 't2'].includes(i.instrumentId))).toBe(true);
  });

  it('is served last, from what budget is left, when the session has room after everything else', () => {
    const session = buildComposedStudySession({ ...world(9), budgetMinutes: 4 });
    expect(ids(session)).toEqual(['o1', 'o2', 't1', 't2']);
  });

  it('is served as before, with no new field, when nothing else could be served', () => {
    const allToday = {
      ...world(9),
      rows: [row('Tdone1', 9, 1), row('Tdone2', 8, 2)],
      replay: replay({ t1: TODAY, t2: TODAY }),
    };
    const afterRule = buildComposedStudySession({ ...allToday, budgetMinutes: 2 });
    // The same composition with the reviews a day earlier is the behaviour before the rule.
    const before = buildComposedStudySession({
      ...allToday,
      replay: replay({ t1: YESTERDAY, t2: YESTERDAY }),
      budgetMinutes: 2,
    });
    expect(ids(afterRule)).toEqual(['t1', 't2']);
    expect(ids(afterRule)).toEqual(ids(before));
    expect(afterRule.model.items.map((i) => Object.keys(i).sort())).toEqual(
      before.model.items.map((i) => Object.keys(i).sort()),
    );
    expect(afterRule.model.leftOut).toEqual(before.model.leftOut);
  });

  it('an instrument answered the previous day is unaffected', () => {
    const base = world(99);
    const session = buildComposedStudySession({
      ...base,
      replay: replay({ t1: YESTERDAY, t2: YESTERDAY, o1: EARLIER, o2: EARLIER }),
      budgetMinutes: 2,
    });
    expect(ids(session)).toEqual(['t1', 't2']);
  });

  it('a concept with one instrument answered today and one not serves the other', () => {
    const session = buildComposedStudySession({
      rows: [row('Mixed', 9, 1), row('Other1', 5, 2)],
      instruments: buildConceptInstrumentIndex([
        qa('m1', ['Mixed']),
        qa('m2', ['Mixed']),
        qa('o1', ['Other1']),
      ]),
      replay: replay({ m1: TODAY, o1: EARLIER }),
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetMinutes: 2,
    });
    expect(ids(session)).not.toContain('m1');
    expect(ids(session)).toEqual(['m2', 'o1']);
  });

  it('a concept with no instrument at all is not something else to serve: the answered-today ones are still served', () => {
    const session = buildComposedStudySession({
      rows: [row('Tdone1', 9, 1), row('Empty', 5, 2)],
      instruments: buildConceptInstrumentIndex([qa('t1', ['Tdone1'])]),
      replay: replay({ t1: TODAY }),
      durations: flatDurations(60),
      asOf: AS_OF,
      budgetMinutes: 2,
    });
    expect(ids(session)).toEqual(['t1']);
  });

  it('extending the session follows the same rule', () => {
    const input = world(99);
    const previous = buildComposedStudySession({ ...input, budgetMinutes: 1 });
    expect(ids(previous)).toEqual(['o1']);
    const extended = extendComposedStudySession({ ...input, budgetMinutes: 2 }, previous);
    expect(extended.map((i) => i.instrumentId)).toEqual(['o1', 'o2']);
  });
});
