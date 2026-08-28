/**
 * test/feedback-points.spec.ts — `ol-opmb.5` [TB-4]'s feedback-point
 * inventory: the things she will actually SEE, enumerated from the real
 * plugin views (`packages/plugin/src/gap/{copy,view}.ts`,
 * `packages/plugin/src/today/{copy,view}.ts` — read-only for this bead) and
 * asserted to fire against a scenario built to trigger the condition and stay
 * silent against one built not to.
 *
 * Per David's scope correction: whether a feedback point's firing condition
 * holds is entirely OUR code (the gap/coverage builder, the mastery rollup,
 * the readiness weighting, the streak fold, the due summary), so this is
 * exactly the class of claim synthetic data may test. What each point's
 * WORDING means to her — is "high-yield" the right word — stays untestable
 * and is not attempted here.
 *
 * A feedback point that cannot be made to fire, or that fires identically for
 * both scenarios, is reported as a FINDING, not silently worked around — see
 * the `FINDING:` cases below and the task report.
 */

import { buildTodayPanel, type DueInstrument } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { deriveOracle } from '../src/oracle/derive.js';
import { deriveOracleTimeline } from '../src/oracle/timeline.js';
import { coverageClosingLine, newCountSentence, readinessNote } from '../src/plugin-bridge.js';
import { buildWorld, type WorldSpec } from '../src/synthetic-bridge.js';

function specFor(
  persona: WorldSpec['persona'],
  corpusVariant?: WorldSpec['corpusVariant'],
): WorldSpec {
  return {
    persona,
    seed: 'feedback-point-spec',
    startDate: '2026-10-17',
    days: 90,
    deviceId: 'syn-laptop',
    utcOffset: '+00:00',
    assessmentDayOffsets: [42, 93],
    ...(corpusVariant === undefined ? {} : { corpusVariant }),
  };
}

function computedAtFor(asOf: string): string {
  return `${asOf}T09:15:00.000Z`;
}

// ---------------------------------------------------------------------------
// FP1 — today/view.ts's streak strip: a day marked "studied" (`is-studied`,
// `StreakDay.studied`) vs not. The blackout-date claim's visible half: she
// does not see a mark for a day she was never asked to study on either.
// ---------------------------------------------------------------------------

describe('feedback point: today streak — a day marked studied', () => {
  it('fires for a steady reviewer on an ordinary study day', () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const studiedDay = world.stream.groundTruth.sessionDates[10];
    if (studiedDay === undefined) throw new Error('expected a session date');
    const vm = buildTodayPanel({
      entries: world.stream.entries,
      instruments: null,
      today: studiedDay,
      dueThrough: new Date(`${studiedDay}T23:59:59.999Z`),
      windowDays: 14,
    });
    const cell = vm.streak.week.find((d) => d.day === studiedDay);
    expect(cell?.studied).toBe(true);
  });

  it("stays silent (no mark) during the lapsed-returner's declared blackout window", () => {
    const world = buildWorld(specFor('lapsed-returner'));
    expect(world.stream.groundTruth.blackoutDates.length).toBeGreaterThan(0);
    const blackoutDay = world.stream.groundTruth.blackoutDates[5];
    if (blackoutDay === undefined) throw new Error('expected a blackout date');
    const vm = buildTodayPanel({
      entries: world.stream.entries,
      instruments: null,
      today: blackoutDay,
      dueThrough: new Date(`${blackoutDay}T23:59:59.999Z`),
      windowDays: 14,
    });
    const cell = vm.streak.week.find((d) => d.day === blackoutDay);
    expect(cell?.studied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FP2 — today/copy.ts's `newCountSentence`: "N of them are new" vs silent.
// Constructed directly over `DueInstrument[]` (plain data, no vault needed)
// rather than persona history, since `due` is never persona-shaped alone —
// see `due.ts`'s own module doc on why `due: null` means "never reviewed".
// ---------------------------------------------------------------------------

describe('feedback point: today "N of them are new" line', () => {
  const dueThrough = new Date('2027-01-15T23:59:59.999Z');

  it('fires when the due set contains never-reviewed instruments', () => {
    const instruments: DueInstrument[] = [
      { instrumentId: 'a', courseCode: 'TST101', courseName: 'Test', due: null },
      { instrumentId: 'b', courseCode: 'TST101', courseName: 'Test', due: null },
    ];
    const vm = buildTodayPanel({
      entries: [],
      instruments,
      today: '2027-01-15',
      dueThrough,
      windowDays: 14,
    });
    expect(vm.due?.newCount).toBe(2);
    expect(newCountSentence(vm.due?.newCount ?? 0)).not.toBeNull();
  });

  it('stays silent when every due instrument has already been reviewed before', () => {
    const instruments: DueInstrument[] = [
      {
        instrumentId: 'a',
        courseCode: 'TST101',
        courseName: 'Test',
        due: '2027-01-10T09:00:00.000Z',
      },
      {
        instrumentId: 'b',
        courseCode: 'TST101',
        courseName: 'Test',
        due: '2027-01-12T09:00:00.000Z',
      },
    ];
    const vm = buildTodayPanel({
      entries: [],
      instruments,
      today: '2027-01-15',
      dueThrough,
      windowDays: 14,
    });
    expect(vm.due?.newCount).toBe(0);
    expect(newCountSentence(vm.due?.newCount ?? 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FP3 — gap/copy.ts's `readinessNote` (R7's MCQ-readiness reweighting): "you
// have missed something repeatedly"'s positive-evidence cousin — "you have
// already drilled this in the format the paper will ask for". Uses the DAY
// LOOP directly: melspar's readiness never applies on day 0 (no MCQ evidence
// yet) and does apply once the steady reviewer has actually practised
// melspar's MCQ — found empirically at day 66 of this world/seed, not
// asserted from a guess.
// ---------------------------------------------------------------------------

describe('feedback point: gap-row readiness note (R7)', () => {
  it("stays silent on day 0 (no MCQ evidence yet), fires once melspar's MCQ has actually been practised", async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });

    function melsparRow(dayIndex: number) {
      const day = timeline.days[dayIndex];
      const vantrel = day?.result.gap.courses.find((c) => c.course === 'syn:course:vantrel');
      if (vantrel?.status !== 'ranked') return undefined;
      return vantrel.rows.find((r) => r.conceptName === 'syn:concept:melspar');
    }

    const day0Row = melsparRow(0);
    if (day0Row === undefined) throw new Error('expected a melspar row on day 0');
    expect(day0Row.readiness.applied).toBe(false);
    expect(readinessNote(day0Row)).toBeNull();

    const appliedDay = timeline.days.findIndex((_, i) => melsparRow(i)?.readiness.applied === true);
    expect(appliedDay).toBeGreaterThan(0); // it does eventually fire — not a dead condition
    const firedRow = melsparRow(appliedDay);
    if (firedRow === undefined)
      throw new Error('expected a melspar row on the day readiness applied');
    expect(readinessNote(firedRow)).not.toBeNull();
    expect(readinessNote(firedRow)).toContain('multiple-choice');
  });
});

// ---------------------------------------------------------------------------
// FP4 — gap/view.ts's material-gap heading ("Named by your past papers,
// missing from your materials"): "her materials don't cover what her past
// papers name". Fixed corpus, so the trigger/non-trigger pair is drawn across
// CONCEPTS (kelvane vs melspar) rather than across personas — the corpus is
// deliberately persona-invariant (`world.ts`'s own module doc), so this is
// the honest granularity for this specific point; every other point above
// varies genuinely by persona or by day.
// ---------------------------------------------------------------------------

describe('feedback point: gap-row material-gap ("missing from your materials")', () => {
  it('fires for kelvane (cited by a past paper, absent from her notes); silent for melspar (cited, and present)', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const { result } = await deriveOracle({
      world,
      asOf: '2027-01-15',
      computedAt: '2027-01-15T09:15:00.000Z',
    });
    const vantrel = result.gap.courses.find((c) => c.course === 'syn:course:vantrel');
    if (vantrel?.status !== 'ranked') throw new Error('expected vantrel to rank');
    const materialGapConcepts = new Set(
      vantrel.rows.filter((r) => r.gapClass === 'material-gap').map((r) => r.conceptName),
    );
    expect(materialGapConcepts.has('syn:concept:kelvane')).toBe(true);
    expect(materialGapConcepts.has('syn:concept:melspar')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FP5 — gap/copy.ts's `coverageClosingLine` ("Nothing else in the N sources
// we could read is missing from your materials"): the positive exhaustiveness
// claim.
//
// This point has two branches and each needs its own demonstration:
// withdrawal (the claim is unavailable) and the reassurance itself (the claim
// fires). `corpus.ts`'s default `'mixed'` `SOURCE_COVERAGE` always includes
// one 'unreadable' and one 'read-yielded-nothing' row BY CONSTRUCTION
// (`ol-cvsc`'s own deliberate design — see that file's module doc), so with
// that corpus alone `canStateExhaustiveness` is always false, for every
// persona, on every day — the withdrawal test below pins exactly that.
//
// `ol-opmb.5` [TB-4]'s FP5 finding (`ol-jji7`) was that this left the OTHER
// branch — she has, in fact, read everything and nothing is missing — with no
// demonstration anywhere in this workbench: a claim that can never be made to
// fire is not a passing test, it is an untested surface wearing one. The fix
// is `corpus.ts`'s `'all-read'` `CorpusVariant` (`SOURCE_COVERAGE_ALL_READ`):
// the same two past papers and lecture notes, minus the two deliberately
// imperfect rows, so `canStateExhaustiveness` is true by the same
// by-construction logic that keeps it false in the default corpus. The
// reassurance test below exercises that variant end to end (persona, day
// loop, real `coverageClosingLine`) rather than only unit-testing the pure
// function — the copy module's own spec (`packages/plugin/test/gap/copy.spec.ts`)
// already does that half in isolation; this is the demonstration that the
// full pipeline can actually produce the scope the copy function needs.
// ---------------------------------------------------------------------------

describe('feedback point: gap-scope exhaustiveness closing line — withdrawal branch', () => {
  it('canStateExhaustiveness is false, and coverageClosingLine is null, for every persona across a whole semester (default corpus)', async () => {
    const personas: readonly WorldSpec['persona'][] = [
      'steady-reviewer',
      'crammer',
      'struggler',
      'lapsed-returner',
      'instrument-skipper',
    ];
    for (const persona of personas) {
      const world = buildWorld(specFor(persona));
      const timeline = await deriveOracleTimeline({ world, totalDays: 20, computedAtFor });
      for (const day of timeline.days) {
        expect(day.result.gap.scope.canStateExhaustiveness).toBe(false);
        expect(coverageClosingLine(day.result.gap.scope)).toBeNull();
      }
    }
  });
});

describe('feedback point: gap-scope exhaustiveness closing line — reassurance branch', () => {
  it("fires for the steady reviewer once every source in the 'all-read' corpus variant has been read", async () => {
    const world = buildWorld(specFor('steady-reviewer', 'all-read'));
    const timeline = await deriveOracleTimeline({ world, totalDays: 20, computedAtFor });
    // Day 0 already has a full corpus (the corpus is time-invariant — see
    // `world.ts`'s module doc), so the claim is available from the first day,
    // not only once evidence accumulates.
    const day0 = timeline.days[0];
    if (day0 === undefined) throw new Error('expected a day 0');
    expect(day0.result.gap.scope.canStateExhaustiveness).toBe(true);
    expect(coverageClosingLine(day0.result.gap.scope)).toBe(
      'Nothing else in the 3 sources we could read is missing from your materials.',
    );
    // Holds for the whole semester, not just day 0 — the claim does not
    // silently withdraw as more history accumulates.
    for (const day of timeline.days) {
      expect(day.result.gap.scope.canStateExhaustiveness).toBe(true);
      expect(coverageClosingLine(day.result.gap.scope)).not.toBeNull();
    }
  });
});
