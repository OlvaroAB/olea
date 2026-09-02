// test/trends-scenarios.spec.ts — the trends surface's state builder, and the
// place F6.5's two detectors are held to a planted ground truth (`ol-lohq`,
// `ol-p6t04`).
//
// Same scope note as `test/timeline-scenarios.spec.ts` for the first half:
// rendering is checked by e2e, and what is worth asserting without a DOM is
// that every advertised state builds without throwing and that the builder's
// contract holds.
//
// The second half is a different kind of test and the reason this file exists.
// A detector validated only against fixtures its own author wrote has graded
// its own homework — `ol-inv2vacuity` in a new costume, which this repo has now
// hit in five mechanisms. So both detectors are run against
// `olea-synthetic`'s personas, where the pattern is planted by a generator that
// knows nothing about them, and against each persona's `planted.neutralise`
// twin: the same seed with the pattern removed from the generator and nothing
// else changed.
//
// **The numbers below are measurements, not targets.** Where a detector does
// not separate cleanly, that is asserted as what it is rather than repaired by
// moving a threshold: calibrating a threshold against a synthetic distribution
// is exactly what N-015 forbids, and a result that survives only a narrow
// window of parameter values is fragile whatever it says (the run charter's
// plateau rule). Every count here is exact so that a change in either the
// detector or the generator turns this file red instead of quietly shifting.

import { detectEffortImbalance, detectSpacing, MIN_GAP } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { DUE_UNAVAILABLE, NOTHING_DUE } from '../src/plugin-bridge.js';
import { generateStream, PERSONAS, type PersonaId, streamSpec } from '../src/synthetic-bridge.js';
import {
  buildTrendsScenario,
  buildTrendsViewModel,
  findTrendsState,
  TRENDS_ASSESSMENTS,
  TRENDS_CONCEPTS,
  TRENDS_STATES,
} from '../src/trends-scenarios.js';

describe('TRENDS_STATES', () => {
  it('every advertised state builds without throwing, over the real TodayView deps', async () => {
    for (const state of TRENDS_STATES) {
      const scenario = buildTrendsScenario(state.id);
      expect(scenario.persona).toBe(state.persona);
      expect(scenario.neutralised).toBe(state.neutralised);
      const vm = await scenario.deps.load();
      expect(vm).toBe(scenario.viewModel);
      // The trends half is present on every state of this surface — that is
      // what the surface is. `mastery: null` here would mean the builder forgot
      // to pass a concept set, which is silent everywhere else.
      expect(vm.mastery).not.toBeNull();
      expect(vm.insights).not.toBeNull();
      // WBF-2 (`ol-9j3w`): `due` must never be `null` here — that renders
      // `DUE_UNAVAILABLE`, a claim that a vault read just failed, which never
      // happens on this surface (see the module doc). `[]` instruments makes
      // it a real, known zero instead.
      expect(vm.due).not.toBeNull();
      expect(vm.due?.total).toBe(0);
    }
  });

  it('WBF-2: no trends state renders the read-failure message', async () => {
    for (const state of TRENDS_STATES) {
      const vm = buildTrendsViewModel(state.id);
      expect(vm.due).not.toBeNull();
      // Belt and braces on the string itself, not just the null check above —
      // a future change to `renderDue`'s branching should not silently start
      // showing `DUE_UNAVAILABLE` again for a total of 0 without this failing.
      expect(JSON.stringify(vm.due)).not.toContain(DUE_UNAVAILABLE);
      expect(vm.due?.total).toBe(0);
    }
    // Sanity: the two strings really are distinct, so the assertion above is
    // not vacuously true.
    expect(DUE_UNAVAILABLE).not.toBe(NOTHING_DUE);
  });

  it('findTrendsState resolves every id TRENDS_STATES advertises, and nothing else', () => {
    for (const state of TRENDS_STATES) {
      expect(findTrendsState(state.id)).toBe(state);
    }
    expect(findTrendsState('not-a-real-id')).toBeUndefined();
  });

  it('throws on an unknown state id, same discipline as the other surfaces', () => {
    expect(() => buildTrendsScenario('not-a-real-id')).toThrow();
    expect(() => buildTrendsViewModel('not-a-real-id')).toThrow();
  });

  it('every state ids uniquely and carries the trends group', () => {
    expect(new Set(TRENDS_STATES.map((s) => s.id)).size).toBe(TRENDS_STATES.length);
    for (const state of TRENDS_STATES) expect(state.group).toBe('trends');
  });
});

describe('the states show what their notes claim', () => {
  it('trends-healthy: a spread across both courses, and both detectors quiet', () => {
    const vm = buildTrendsViewModel('trends-healthy');
    expect(vm.mastery?.courses).toHaveLength(2);
    expect(vm.insights?.spacing.status).toBe('not-observed');
    expect(vm.insights?.effort.status).toBe('not-observed');
  });

  it('trends-course-behind: the effort insight fires and names the heavier course', () => {
    const vm = buildTrendsViewModel('trends-course-behind');
    expect(vm.insights?.effort.status).toBe('observed');
    const measured = vm.insights?.effort.measured;
    // `'Vantrel'`, not `'syn:course:vantrel'` — `TRENDS_ASSESSMENTS`/
    // `TRENDS_CONCEPTS` display-name their course fields (WBF-1, `ol-mxw3`),
    // and this detector only ever sees what those two hand it.
    expect(measured?.widestGapCourse).toBe('Vantrel');
    // The course carrying more of the grade than of the hours — stated as the
    // two shares the panel actually renders.
    const row = measured?.courses.find((c) => c.course === 'Vantrel');
    expect(row?.floorShare).toBeGreaterThan(0.5);
    expect(row?.timeShare).toBeLessThan(0.25);
  });

  it('trends-course-behind-neutralised: same seed, pattern removed, insight gone', () => {
    const vm = buildTrendsViewModel('trends-course-behind-neutralised');
    expect(vm.insights?.effort.status).toBe('not-observed');
    expect(vm.insights?.effort.measured?.widestGap).toBeLessThan(MIN_GAP);
  });

  it('trends-cramming: the spacing insight fires, on both of its conditions', () => {
    const vm = buildTrendsViewModel('trends-cramming');
    const spacing = vm.insights?.spacing;
    expect(spacing?.status).toBe('observed');
    expect(spacing?.measured?.concentration).toBeGreaterThan(10);
    expect(spacing?.measured?.attendanceRatio).toBeGreaterThan(3);
    expect(spacing?.measured?.earlyShare).toBeGreaterThan(0.3);
    // Read out of the log's own examProximity, never from an assessment note.
    expect(spacing?.measured?.assessmentDays).toHaveLength(2);
  });

  it('trends-too-early: both detectors decline, and the mastery strip still renders', () => {
    const vm = buildTrendsViewModel('trends-too-early');
    expect(vm.insights?.spacing.status).toBe('not-enough-history');
    expect(vm.insights?.effort.status).toBe('not-enough-history');
    expect(vm.insights?.spacing.measured).toBeNull();
    // "Every concept is seed" is a fact about a deck she has just met, not an
    // absence of evidence — so the overview is drawn.
    expect(vm.mastery?.courses).toHaveLength(2);
    expect(
      vm.mastery?.courses.reduce((sum, c) => sum + c.distribution.counts.seed, 0),
    ).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------ *
 * The planted-effect evidence.
 * ------------------------------------------------------------------------ */

/** Forty seeds, fixed. `workbench` first because it is the one the surface above renders. */
const SEEDS: readonly string[] = ['workbench', ...Array.from({ length: 39 }, (_, i) => `s${i}`)];

const WORLD = {
  startDate: '2026-10-17',
  days: 90,
  utcOffset: '+00:00',
  assessmentDayOffsets: [42, 93] as readonly number[],
};

function streamFor(persona: PersonaId, seed: string, neutralised: boolean) {
  return generateStream(
    streamSpec(persona, seed, {
      ...WORLD,
      ...(neutralised ? { behaviour: PERSONAS[persona].planted.neutralise } : {}),
    }),
  );
}

/** How many of the forty seeds each detector fires on, for one persona variant. */
function firingCounts(
  persona: PersonaId,
  neutralised: boolean,
): {
  spacing: number;
  effort: number;
} {
  let spacing = 0;
  let effort = 0;
  for (const seed of SEEDS) {
    const stream = streamFor(persona, seed, neutralised);
    if (detectSpacing(stream.entries).status === 'observed') spacing += 1;
    const effortResult = detectEffortImbalance({
      entries: stream.entries,
      concepts: TRENDS_CONCEPTS,
      floorShares: TRENDS_ASSESSMENTS,
    });
    if (effortResult.status === 'observed') effort += 1;
  }
  return { spacing, effort };
}

describe('F6.5(a) spacing — measured against a planted ground truth', () => {
  it('fires on the crammer on every one of the forty seeds', () => {
    expect(firingCounts('crammer', false).spacing).toBe(SEEDS.length);
  });

  it('fires on NO other persona, on any seed', () => {
    for (const persona of [
      'steady-reviewer',
      'instrument-skipper',
      'struggler',
      'lapsed-returner',
      'lopsided-effort',
    ] as const) {
      expect(firingCounts(persona, false).spacing, `${persona} tripped the spacing detector`).toBe(
        0,
      );
    }
  });

  it('still fires on the crammer’s neutralised twin on 3 of 40 seeds once the sufficiency gate holds', () => {
    // This is the finding, not a bug to be threshold-ed away. The neutralised
    // crammer is an irregular reviewer who studies on roughly a seventh of
    // days, so a ninety-day history gives her about ten pre-assessment calendar
    // days, and the rate over ten days is noisy: one busy evening among them
    // carries the ratio past 2.
    //
    // Clean separation on this corpus needs the concentration threshold near 5
    // (the neutralised twin reaches 4.09 at worst; the crammer bottoms out at
    // 7.78, so the plateau is (4.09, 7.78] — 3.7 wide). CONCENTRATION_RATIO has
    // NOT been moved there: it was chosen a priori as "twice the daily rate",
    // and moving it to fit this distribution is calibrating a detector on
    // fabricated data, which N-015 forbids outright. Whether to adopt a higher
    // operating point is a threshold decision with an owner, and it is flagged
    // in this task's report rather than taken here.
    //
    // An exact count so that any change to the detector or the generator turns
    // this red rather than drifting.
    //
    // SPC-1 (ol-5xg9, per the ol-cahv ruling): the threshold above was NOT
    // moved — a MIN_NEAR_STUDY_DAYS sufficiency floor now abstains when the
    // near window carries too few distinct study-days to support a rate.
    // Under the gate the count falls 8 -> 3; the ungated arithmetic is still
    // recoverable from each abstained result's populated `measured` field, so
    // the original 8-of-40 finding stays on the record below.
    expect(firingCounts('crammer', true).spacing).toBe(3);
  });
});

describe('F6.5(b) effort — measured against a planted ground truth', () => {
  it('fires on lopsided-effort on every one of the forty seeds', () => {
    expect(firingCounts('lopsided-effort', false).effort).toBe(SEEDS.length);
  });

  it('goes silent on the same seeds once planted.neutralise is applied — 0 of 40', () => {
    // The falsifiability claim this detector is allowed to make, and the one
    // the spacing detector cannot: same seed, `courseTakeRate` back to `{}`,
    // nothing else touched, and the finding disappears every time.
    expect(firingCounts('lopsided-effort', true).effort).toBe(0);
  });

  it('reports the plateau around MIN_GAP rather than a single passing number', () => {
    const gaps = (neutralised: boolean): number[] =>
      SEEDS.map((seed) => {
        const stream = streamFor('lopsided-effort', seed, neutralised);
        const result = detectEffortImbalance({
          entries: stream.entries,
          concepts: TRENDS_CONCEPTS,
          floorShares: TRENDS_ASSESSMENTS,
        });
        return result.measured?.widestGap ?? 0;
      });
    const planted = Math.min(...gaps(false));
    const removed = Math.max(...gaps(true));
    // Any threshold in (removed, planted] separates the pair on all forty
    // seeds. MIN_GAP sits inside it with room on both sides — that width is the
    // claim, not the fact that 0.2 happens to work.
    expect(removed).toBeLessThan(MIN_GAP);
    expect(planted).toBeGreaterThan(MIN_GAP);
    expect(planted - removed).toBeGreaterThan(0.1);
  });

  it('also fires on the struggler on every seed, and that is CORRECT rather than a false positive', () => {
    // She fails one course repeatedly, so that course eats her hours — around
    // 93% of them — and the other course is 43% of the grade with 7% of the
    // time. That is a real effort imbalance arriving by a different route, and
    // a detector that stayed quiet on it would be wrong. Recorded here because
    // "40/40 on a persona nobody planted this in" is exactly the shape that
    // gets mistaken for a false-positive rate.
    expect(firingCounts('struggler', false).effort).toBe(SEEDS.length);
    const stream = streamFor('struggler', 'workbench', false);
    const result = detectEffortImbalance({
      entries: stream.entries,
      concepts: TRENDS_CONCEPTS,
      floorShares: TRENDS_ASSESSMENTS,
    });
    // Display-named, same reason as the assertion above.
    expect(result.measured?.widestGapCourse).toBe('Quorbin');
  });

  it('fires on 3 of the 120 seeds across the three personas with no imbalance planted', () => {
    // steady-reviewer, instrument-skipper and lapsed-returner, one seed each,
    // at gaps of 0.20-0.24. The deck is introduced in `vocabulary.js` order
    // (one course's instruments first), so FSRS pulls the two courses' review
    // counts apart by luck alone, and on a 24-instrument deck that noise is
    // occasionally a fifth of the split. Asserted as a number so it cannot grow
    // unnoticed.
    const stray =
      firingCounts('steady-reviewer', false).effort +
      firingCounts('instrument-skipper', false).effort +
      firingCounts('lapsed-returner', false).effort;
    expect(stray).toBe(3);
  });
});
