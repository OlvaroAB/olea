/**
 * `RBLD-1` (`ol-o7hr`), component register row 3.6, `[D-076]` round 4 "When
 * does the queue rebuild?" — @auto:core/queue/rebuild-controller.spec
 */
import { describe, expect, it } from 'vitest';
import {
  assessmentDatePassedSince,
  assessmentProximityBand,
  checkRebuildWasteRate,
  DEFAULT_SITTING_IDLE_THRESHOLD_MS,
  decideRebuild,
  diffSittingScopeSnapshots,
  EMPTY_SITTING_SCOPE_SNAPSHOT,
  enterSitting,
  evaluateRebuildTrigger,
  evaluateSittingStaleness,
  exitSitting,
  MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK,
  type RebuildOutcomeCase,
  type SittingScopeSnapshot,
  type SittingStalenessInput,
  type SittingState,
  WASTED_REBUILD_RATE_CEILING,
} from './rebuild-controller.js';

const DAY_1 = '2026-08-10';
const DAY_2 = '2026-08-11';

function noTrigger(day = DAY_1) {
  return {
    lastRebuiltDay: day,
    today: day,
    materialLandedSinceLastRebuild: false,
    assessmentDatePassedSinceLastRebuild: false,
  } as const;
}

describe('evaluateRebuildTrigger', () => {
  it('never fires when nothing named has changed — explicitly not a timer', () => {
    const result = evaluateRebuildTrigger(noTrigger());
    expect(result).toEqual({ shouldRebuild: false, reasons: [] });
  });

  it('fires on material landing', () => {
    const result = evaluateRebuildTrigger({
      ...noTrigger(),
      materialLandedSinceLastRebuild: true,
    });
    expect(result).toEqual({ shouldRebuild: true, reasons: ['material-landed'] });
  });

  it('fires on an assessment date passing', () => {
    const result = evaluateRebuildTrigger({
      ...noTrigger(),
      assessmentDatePassedSinceLastRebuild: true,
    });
    expect(result).toEqual({ shouldRebuild: true, reasons: ['assessment-date-passed'] });
  });

  it('fires on a day boundary', () => {
    const result = evaluateRebuildTrigger({ ...noTrigger(), today: DAY_2 });
    expect(result).toEqual({ shouldRebuild: true, reasons: ['day-boundary'] });
  });

  it('reports every trigger that fired, not just the first', () => {
    const result = evaluateRebuildTrigger({
      lastRebuiltDay: DAY_1,
      today: DAY_2,
      materialLandedSinceLastRebuild: true,
      assessmentDatePassedSinceLastRebuild: true,
    });
    expect(result.shouldRebuild).toBe(true);
    expect(result.reasons).toEqual(['material-landed', 'assessment-date-passed', 'day-boundary']);
  });

  it('throws on a malformed calendar day, the same caller-error discipline buildStudySession uses', () => {
    expect(() => evaluateRebuildTrigger({ ...noTrigger(), today: 'not-a-day' })).toThrow(
      /today must be a YYYY-MM-DD day/,
    );
    expect(() => evaluateRebuildTrigger({ ...noTrigger(), lastRebuiltDay: 'not-a-day' })).toThrow(
      /lastRebuiltDay must be a YYYY-MM-DD day/,
    );
  });
});

describe('assessmentDatePassedSince', () => {
  it('is true for a date strictly after the last rebuild and on or before today', () => {
    expect(assessmentDatePassedSince(['2026-08-15'], '2026-08-10', '2026-08-15')).toBe(true);
  });

  it('is false for a date already past at the last rebuild', () => {
    expect(assessmentDatePassedSince(['2026-08-05'], '2026-08-10', '2026-08-15')).toBe(false);
  });

  it('is false for a date still in the future past today', () => {
    expect(assessmentDatePassedSince(['2026-08-20'], '2026-08-10', '2026-08-15')).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(assessmentDatePassedSince([], '2026-08-10', '2026-08-15')).toBe(false);
  });
});

function noStaleness(): SittingStalenessInput {
  return {
    itemsDueInScope: false,
    materialArrivedInScope: false,
    assessmentProximityBandCrossedInScope: false,
  };
}

describe('decideRebuild — the freeze contract', () => {
  it('holds unconditionally while idle-caused triggers would otherwise fire, once a sitting is active', () => {
    const state = enterSitting(new Date('2026-08-10T09:00:00.000Z'), ['a', 'b', 'c']);
    // Every trigger that would cause a rebuild between sittings is asserted
    // true here — the freeze must still hold, because the sitting is active.
    const decision = decideRebuild(state, {
      now: new Date('2026-08-10T09:05:00.000Z'),
      trigger: {
        lastRebuiltDay: DAY_1,
        today: DAY_2,
        materialLandedSinceLastRebuild: true,
        assessmentDatePassedSinceLastRebuild: true,
      },
      staleness: noStaleness(),
    });
    expect(decision).toEqual({ action: 'hold' });
  });

  it('holds right up to, but not past, the idle threshold — but only rebuilds past it if the sitting is ALSO materially stale', () => {
    const enteredAt = new Date('2026-08-10T09:00:00.000Z');
    const state = enterSitting(enteredAt, ['a']);
    const idleThresholdMs = 10 * 60_000;
    const justUnder = decideRebuild(state, {
      now: new Date(enteredAt.getTime() + idleThresholdMs - 1),
      idleThresholdMs,
      trigger: noTrigger(),
      staleness: { ...noStaleness(), itemsDueInScope: true },
    });
    expect(justUnder).toEqual({ action: 'hold' });

    const atThresholdButUnchanged = decideRebuild(state, {
      now: new Date(enteredAt.getTime() + idleThresholdMs),
      idleThresholdMs,
      trigger: noTrigger(),
      staleness: noStaleness(),
    });
    expect(atThresholdButUnchanged).toEqual({ action: 'hold' });

    const atThresholdAndStale = decideRebuild(state, {
      now: new Date(enteredAt.getTime() + idleThresholdMs),
      idleThresholdMs,
      trigger: noTrigger(),
      staleness: { ...noStaleness(), itemsDueInScope: true },
    });
    expect(atThresholdAndStale).toEqual({
      action: 'sitting-stale',
      reasons: ['items-due-in-scope'],
    });
  });

  it('uses the declared default idle threshold when none is supplied', () => {
    const enteredAt = new Date('2026-08-10T09:00:00.000Z');
    const state = enterSitting(enteredAt, ['a']);
    const justUnderDefault = decideRebuild(state, {
      now: new Date(enteredAt.getTime() + DEFAULT_SITTING_IDLE_THRESHOLD_MS - 1),
      trigger: noTrigger(),
      staleness: { ...noStaleness(), materialArrivedInScope: true },
    });
    expect(justUnderDefault).toEqual({ action: 'hold' });

    const atDefault = decideRebuild(state, {
      now: new Date(enteredAt.getTime() + DEFAULT_SITTING_IDLE_THRESHOLD_MS),
      trigger: noTrigger(),
      staleness: { ...noStaleness(), materialArrivedInScope: true },
    });
    expect(atDefault).toEqual({ action: 'sitting-stale', reasons: ['material-arrived-in-scope'] });
  });

  it('a genuinely unchanged afternoon-old sitting resumes as-is: elapsed time alone, arbitrarily far past the idle threshold, never ends it absent a material change', () => {
    const enteredAt = new Date('2026-08-10T09:00:00.000Z');
    const state = enterSitting(enteredAt, ['a']);
    const hoursLater = new Date(enteredAt.getTime() + 6 * 60 * 60_000);
    const decision = decideRebuild(state, {
      now: hoursLater,
      trigger: noTrigger(),
      staleness: noStaleness(),
    });
    expect(decision).toEqual({ action: 'hold' });
  });

  it('a plan-version tick with materially identical scope is not a trigger: the idle threshold alone never ends a sitting without a staleness reason', () => {
    const enteredAt = new Date('2026-08-10T09:00:00.000Z');
    const state = enterSitting(enteredAt, ['a']);
    // Past the idle threshold, but the caller's own recompute produced no
    // materially different answer for this sitting's scope — every
    // staleness fact is false, exactly as a periodic version-counter tick
    // with no real change would report.
    const decision = decideRebuild(state, {
      now: new Date(enteredAt.getTime() + DEFAULT_SITTING_IDLE_THRESHOLD_MS + 60_000),
      trigger: noTrigger(),
      staleness: noStaleness(),
    });
    expect(decision).toEqual({ action: 'hold' });
  });

  it('throws if now precedes the sitting entry — a caller clock bug, never a negative elapsed time', () => {
    const enteredAt = new Date('2026-08-10T09:00:00.000Z');
    const state = enterSitting(enteredAt, ['a']);
    expect(() =>
      decideRebuild(state, {
        now: new Date(enteredAt.getTime() - 1),
        trigger: noTrigger(),
        staleness: noStaleness(),
      }),
    ).toThrow(/precedes the sitting's own entry time/);
  });

  it('evaluates the named trigger set only while idle', () => {
    const idle: SittingState<readonly string[]> = { status: 'idle' };
    const rebuilds = decideRebuild(idle, {
      now: new Date('2026-08-10T09:00:00.000Z'),
      trigger: { ...noTrigger(), materialLandedSinceLastRebuild: true },
      staleness: noStaleness(),
    });
    expect(rebuilds).toEqual({ action: 'rebuild', reasons: ['material-landed'] });

    const holds = decideRebuild(idle, {
      now: new Date('2026-08-10T09:00:00.000Z'),
      trigger: noTrigger(),
      staleness: noStaleness(),
    });
    expect(holds).toEqual({ action: 'no-rebuild' });
  });

  it('is never a timer: elapsed time alone, with no named trigger, never rebuilds while idle', () => {
    const idle: SittingState<readonly string[]> = { status: 'idle' };
    // Advance "now" by a huge amount with nothing named having changed.
    const oneYearLater = new Date('2027-08-10T09:00:00.000Z');
    const decision = decideRebuild(idle, {
      now: oneYearLater,
      trigger: noTrigger(),
      staleness: noStaleness(),
    });
    expect(decision).toEqual({ action: 'no-rebuild' });
  });
});

describe('evaluateSittingStaleness', () => {
  it('never stale when none of the three material-change facts hold', () => {
    expect(evaluateSittingStaleness(noStaleness())).toEqual({ stale: false, reasons: [] });
  });

  it('fires on new items coming due in the sitting"s own scope', () => {
    expect(evaluateSittingStaleness({ ...noStaleness(), itemsDueInScope: true })).toEqual({
      stale: true,
      reasons: ['items-due-in-scope'],
    });
  });

  it('fires on new material arriving in scope', () => {
    expect(evaluateSittingStaleness({ ...noStaleness(), materialArrivedInScope: true })).toEqual({
      stale: true,
      reasons: ['material-arrived-in-scope'],
    });
  });

  it('fires on an assessment crossing a proximity band the composition cares about', () => {
    expect(
      evaluateSittingStaleness({
        ...noStaleness(),
        assessmentProximityBandCrossedInScope: true,
      }),
    ).toEqual({ stale: true, reasons: ['assessment-proximity-band-crossed-in-scope'] });
  });

  it('reports every material-change kind that fired, not just the first', () => {
    const result = evaluateSittingStaleness({
      itemsDueInScope: true,
      materialArrivedInScope: true,
      assessmentProximityBandCrossedInScope: true,
    });
    expect(result.stale).toBe(true);
    expect(result.reasons).toEqual([
      'items-due-in-scope',
      'material-arrived-in-scope',
      'assessment-proximity-band-crossed-in-scope',
    ]);
  });
});

describe('property: the item list at session exit equals the item list at session entry', () => {
  it('holds across an arbitrary sequence of trigger facts and clock advances during one sitting', () => {
    const enteredAt = new Date('2026-08-10T09:00:00.000Z');
    const originalItems = Object.freeze(['card-1', 'card-2', 'mcq-3', 'cloze-4']);
    let state: SittingState<readonly string[]> = enterSitting(enteredAt, originalItems);
    const idleThresholdMs = 45 * 60_000;

    // A deterministic pseudo-random walk over trigger combinations and clock
    // advances, all strictly inside the idle threshold — the freeze must
    // survive every one of them, and `state.items` must never be swapped for
    // anything else while `status` stays 'active'. This module exposes no
    // function that could replace `state.items` short of leaving and
    // re-entering, so the property is really "no code path here ever calls
    // enterSitting again on its own" — asserted by never doing so in this
    // loop and checking identity held anyway.
    let seed = 42;
    function nextPseudoRandom(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    for (let step = 0; step < 200; step += 1) {
      const elapsedMs = Math.floor(nextPseudoRandom() * (idleThresholdMs - 1));
      const decision = decideRebuild(state, {
        now: new Date(enteredAt.getTime() + elapsedMs),
        idleThresholdMs,
        trigger: {
          lastRebuiltDay: DAY_1,
          today: nextPseudoRandom() < 0.5 ? DAY_1 : DAY_2,
          materialLandedSinceLastRebuild: nextPseudoRandom() < 0.5,
          assessmentDatePassedSinceLastRebuild: nextPseudoRandom() < 0.5,
        },
        staleness: {
          itemsDueInScope: nextPseudoRandom() < 0.5,
          materialArrivedInScope: nextPseudoRandom() < 0.5,
          assessmentProximityBandCrossedInScope: nextPseudoRandom() < 0.5,
        },
      });
      expect(decision).toEqual({ action: 'hold' });
      // The item list itself: identical reference, identical value, at every step.
      expect(state.status).toBe('active');
      if (state.status === 'active') {
        expect(state.items).toBe(originalItems);
        expect(state.items).toEqual(['card-1', 'card-2', 'mcq-3', 'cloze-4']);
      }
    }

    // Exit: this is "she finished" — the one legitimate way the freeze ends
    // without the hold cap firing.
    state = exitSitting();
    expect(state).toEqual({ status: 'idle' });
  });

  it('a sitting whose composition changed mid-flight against its own entry snapshot is the defect this asserts against', () => {
    // Constructed failure case, proving the property test can actually fail
    // (the self-test discipline `checks/materiality-trigger-health.ts` uses
    // for its own planted-failure case) — this is not exercising
    // rebuild-controller.ts at all, it is checking that comparing
    // `itemsAtEntry` against a hypothetically-mutated `itemsAtExit` would be
    // caught by a plain equality assertion, so a future refactor that started
    // swapping `state.items` mid-sitting would fail loudly here rather than
    // silently.
    const itemsAtEntry = Object.freeze(['card-1', 'card-2']);
    const itemsAtExitIfBuggy = ['card-1', 'card-3']; // hypothetical: 3.6's own defect shape
    expect(itemsAtExitIfBuggy).not.toEqual(itemsAtEntry);
  });
});

describe('checkRebuildWasteRate', () => {
  function cases(n: number, wastedCount: number): RebuildOutcomeCase[] {
    const out: RebuildOutcomeCase[] = [];
    for (let i = 0; i < n; i += 1) {
      const previous = ['a', 'b', 'c'];
      const next = i < wastedCount ? ['a', 'b', 'c'] : ['c', 'b', 'a'];
      out.push({
        id: `case-${i}`,
        previousOrderedInstrumentIds: previous,
        nextOrderedInstrumentIds: next,
      });
    }
    return out;
  }

  it('fails when fewer cases than the sample floor were supplied — N-013', () => {
    const verdict = checkRebuildWasteRate(cases(MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK - 1, 0));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/below the .*-case floor/);
  });

  it('fails when zero cases were supplied', () => {
    const verdict = checkRebuildWasteRate([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
  });

  it('passes when the wasted rate is below the declared ceiling', () => {
    const n = MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK;
    const wasted = Math.floor(n * (WASTED_REBUILD_RATE_CEILING - 0.2));
    const verdict = checkRebuildWasteRate(cases(n, wasted));
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.wastedCount).toBe(wasted);
  });

  it('fails when the wasted rate is at or above the declared ceiling — the planted-failure case', () => {
    const n = MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK;
    const verdict = checkRebuildWasteRate(cases(n, n)); // every rebuild reproduced its predecessor
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.wastedRate).toBe(1);
    expect(verdict.detail).toMatch(/ceiling/);
  });

  it('counts and reports wasted rebuilds by id rather than passing silently', () => {
    const verdict = checkRebuildWasteRate(cases(MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK, 3));
    expect(verdict.measured.wasted).toEqual(['case-0', 'case-1', 'case-2']);
  });
});

// `ol-v7r5.26` — the three staleness facts, wired to real signals: bucketing
// a proximity date, and diffing two scope snapshots into real
// `SittingStalenessInput` facts. See `queue/rebuild-controller.ts`'s own
// module doc, "turning the three staleness facts into real signals".
describe('assessmentProximityBand', () => {
  it('reads a same-day-or-tomorrow due date as imminent-or-passed', () => {
    expect(assessmentProximityBand(0)).toBe('imminent-or-passed');
    expect(assessmentProximityBand(1)).toBe('imminent-or-passed');
    expect(assessmentProximityBand(-3)).toBe('imminent-or-passed');
  });

  it('reads a week out as near, a fortnight out as approaching, further as far', () => {
    expect(assessmentProximityBand(7)).toBe('near');
    expect(assessmentProximityBand(14)).toBe('approaching');
    expect(assessmentProximityBand(21)).toBe('far');
  });

  it('reads an unknown/unparseable date as far, never as a veto or a crash', () => {
    expect(assessmentProximityBand(null)).toBe('far');
  });
});

describe('diffSittingScopeSnapshots', () => {
  function snapshot(overrides: Partial<SittingScopeSnapshot> = {}): SittingScopeSnapshot {
    return { ...EMPTY_SITTING_SCOPE_SNAPSHOT, ...overrides };
  }

  it('fires itemsDueInScope only for a concept newly due, never one already due at freeze', () => {
    const freeze = snapshot({ dueConceptKeys: new Set(['already-due']) });
    const unchanged = snapshot({ dueConceptKeys: new Set(['already-due']) });
    expect(diffSittingScopeSnapshots(freeze, unchanged).itemsDueInScope).toBe(false);

    const newlyDue = snapshot({ dueConceptKeys: new Set(['already-due', 'new-concept']) });
    expect(diffSittingScopeSnapshots(freeze, newlyDue).itemsDueInScope).toBe(true);
  });

  it('fires materialArrivedInScope only when the watermark actually advances', () => {
    const freeze = snapshot({ materialArrivalWatermark: '2026-08-10' });
    expect(
      diffSittingScopeSnapshots(freeze, snapshot({ materialArrivalWatermark: '2026-08-10' }))
        .materialArrivedInScope,
    ).toBe(false);
    expect(
      diffSittingScopeSnapshots(freeze, snapshot({ materialArrivalWatermark: '2026-08-11' }))
        .materialArrivedInScope,
    ).toBe(true);
    // No arrival signal at freeze, one appearing now — also a real arrival.
    expect(
      diffSittingScopeSnapshots(
        snapshot({ materialArrivalWatermark: undefined }),
        snapshot({ materialArrivalWatermark: '2026-08-10' }),
      ).materialArrivedInScope,
    ).toBe(true);
  });

  it('fires assessmentProximityBandCrossedInScope only when a band actually differs', () => {
    const freeze = snapshot({
      assessmentProximityBands: new Map([['a.md', 'approaching']]),
    });
    const unchanged = snapshot({ assessmentProximityBands: new Map([['a.md', 'approaching']]) });
    expect(diffSittingScopeSnapshots(freeze, unchanged).assessmentProximityBandCrossedInScope).toBe(
      false,
    );

    const crossed = snapshot({ assessmentProximityBands: new Map([['a.md', 'near']]) });
    expect(diffSittingScopeSnapshots(freeze, crossed).assessmentProximityBandCrossedInScope).toBe(
      true,
    );
  });

  it('reports all three facts false when nothing in scope changed at all', () => {
    const same = snapshot({
      dueConceptKeys: new Set(['x']),
      materialArrivalWatermark: '2026-08-10',
      assessmentProximityBands: new Map([['a.md', 'far']]),
    });
    expect(diffSittingScopeSnapshots(same, same)).toEqual({
      itemsDueInScope: false,
      materialArrivedInScope: false,
      assessmentProximityBandCrossedInScope: false,
    });
  });
});
