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

import { detectEffortImbalance, detectSpacing, SHORTFALL_RATIO_K } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { DUE_UNAVAILABLE, NOTHING_DUE } from '../src/plugin-bridge.js';
import {
  COURSE_VANTREL,
  generateStream,
  PERSONAS,
  type PersonaId,
  streamSpec,
} from '../src/synthetic-bridge.js';
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
    // The live rule (`ol-v7r5.63` / `[DOS-C4]`): a ratio, not an absolute
    // gap. The widest course's timeShare/floorShare must clear
    // SHORTFALL_RATIO_K for the detector to stay quiet.
    // ol-wyqk: same override `trends-scenarios.ts` applies to this state's
    // own pair (0.08, not 0.01 — this call only needs one seed, not a
    // worst-case-over-forty margin) — see `TrendsWorkbenchState
    // .behaviourOverride`'s doc. Without it `measured` is `null` (too few
    // windowed reviews) and this assertion would pass vacuously on the
    // no-comparison default (`1`) rather than a real ratio.
    const stream = streamFor('lopsided-effort', 'workbench', true, { defaultSuccess: 0.08 });
    expect(widestShortfallRatio(stream)).toBeGreaterThanOrEqual(SHORTFALL_RATIO_K);
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

/**
 * `ol-wyqk`: what a call site may add on top of a persona's own behaviour (and,
 * for a neutralised stream, on top of `planted.neutralise` too) — see
 * `trends-scenarios.ts`'s `TrendsWorkbenchState.behaviourOverride` doc for the
 * shared argument. Two fields only, both left OUT of every persona's own
 * `carriedBy` list (`personas.ts`), so neither can be mistaken for a second
 * planted pattern: `defaultSuccess` for the two-course comparisons where
 * boosting the ATTENDED course's due-churn is enough on its own
 * (lopsided-effort, steady-reviewer — her `courseTakeRate`/absence-of-pattern
 * stays exactly as planted either way), and `successByCourse[COURSE_VANTREL]`
 * for struggler, where `defaultSuccess` alone would ALSO speed up her other
 * course's churn and wash out the very gap being measured (see
 * `STRUGGLER_SUFFICIENCY_DENSITY`'s own doc).
 */
type BehaviourOverride = {
  readonly defaultSuccess?: number;
  readonly successByCourse?: Readonly<Record<string, number>>;
};

/**
 * `ol-wyqk`: an optional behaviour override, layered on top of `neutralised`'s
 * own (never replacing it) — see `trends-scenarios.ts`'s
 * `TrendsWorkbenchState.behaviourOverride` doc for the full argument. Default
 * `{}` reproduces every call site's exact pre-existing stream, so F6.5(a)'s
 * spacing assertions (including the crammer's, which this same helper feeds)
 * are untouched by this addition.
 */
function streamFor(
  persona: PersonaId,
  seed: string,
  neutralised: boolean,
  behaviourOverride: BehaviourOverride = {},
) {
  const behaviour = {
    ...(neutralised ? PERSONAS[persona].planted.neutralise : {}),
    ...behaviourOverride,
  };
  return generateStream(
    streamSpec(persona, seed, {
      ...WORLD,
      ...(Object.keys(behaviour).length > 0 ? { behaviour } : {}),
    }),
  );
}

/**
 * `ol-wyqk`: the density this file's F6.5(b) effort assertions need to clear
 * `MIN_WINDOWED_TIMED_REVIEWS` on every one of the forty seeds — worst case
 * over all forty, lopsided-effort's windowed count is 44 at this value
 * (plateau: as low as 0.03 still clears 40-of-40 at 41; 0.05 does not, at
 * 38). struggler clears the same floor by a wide margin (90) at this value
 * because her own planted `successByCourse` already drives high windowed
 * density — this override only lowers her *other* course's success, which
 * `successByCourse` does not name. Never applied to `firingCounts` calls in
 * the F6.5(a) describe block above, including the crammer's and the "fires
 * on NO other persona" spacing check, which stay at today's density
 * (default `{}`) — this constant exists only where the effort insight's own
 * sufficiency gate is being cleared, not the spacing one.
 */
const EFFORT_SUFFICIENCY_DENSITY = { defaultSuccess: 0.01 } as const;

/**
 * `ol-wyqk`: struggler's own equivalent of `EFFORT_SUFFICIENCY_DENSITY`, and
 * NOT the same override — `defaultSuccess` names every course except the ones
 * `successByCourse` already does, so applying `EFFORT_SUFFICIENCY_DENSITY` to
 * struggler lowers Quorbin's success (her *attended*, non-struggling course)
 * while leaving Vantrel's own planted `0.34` untouched. Measured: that WASHES
 * OUT the gap rather than merely sufficiency-gating it — Quorbin's own
 * due-churn rises enough to close most of the distance, so `observed:Quorbin`
 * peaks around 25/40 near `defaultSuccess` 0.68 and falls on both sides of
 * it, never reaching all forty (full sweep: this bead's report, section 2).
 *
 * Lowering Vantrel's OWN success further instead — the course she is already
 * planted to be losing — raises windowed sufficiency AND widens the gap
 * together, since both come from the same course's due-churn. `0.34` (the
 * plant) gives 10/40 `observed:Quorbin`, 30/40 insufficient; `0.1` gives
 * 40/40 `observed:Quorbin`, none insufficient — the plateau: `0.2` still
 * leaves 4 seeds short (36/40), so the floor sits strictly between `0.1` and
 * `0.2`, and `0.1` was not swept further down only because it already clears
 * every seed with room (`0.05` and `0.02` both still read 40/40 in the same
 * sweep).
 */
const STRUGGLER_SUFFICIENCY_DENSITY: BehaviourOverride = {
  successByCourse: { [COURSE_VANTREL]: 0.1 },
};

/**
 * The ratio the live rule fires on (`ol-v7r5.63` / `[DOS-C4]`): the widest
 * course's (by `gap`, same tie-break as `detectEffortImbalance` itself)
 * timeShare over its own floorShare. `< SHORTFALL_RATIO_K` fires; `1` when
 * there is no widest course to compare (mirrors the detector's own
 * no-comparison default).
 */
function widestShortfallRatio(stream: ReturnType<typeof streamFor>): number {
  const result = detectEffortImbalance({
    entries: stream.entries,
    concepts: TRENDS_CONCEPTS,
    floorShares: TRENDS_ASSESSMENTS,
  });
  const widest = result.measured?.courses[0];
  return widest !== undefined && widest.floorShare > 0 ? widest.timeShare / widest.floorShare : 1;
}

/** How many of the forty seeds each detector fires on, for one persona variant. */
function firingCounts(
  persona: PersonaId,
  neutralised: boolean,
  behaviourOverride: BehaviourOverride = {},
): {
  spacing: number;
  effort: number;
} {
  let spacing = 0;
  let effort = 0;
  for (const seed of SEEDS) {
    const stream = streamFor(persona, seed, neutralised, behaviourOverride);
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
    // ol-wyqk: `EFFORT_SUFFICIENCY_DENSITY` — see its own doc. Without it,
    // this reads 0/40: at this persona's own 0.86 success rate the windowed
    // review count inside the D-092 window (four sittings, for a two-course
    // comparison) never clears `MIN_WINDOWED_TIMED_REVIEWS` (40), so every
    // seed abstains `not-enough-history` rather than firing `observed`.
    expect(firingCounts('lopsided-effort', false, EFFORT_SUFFICIENCY_DENSITY).effort).toBe(
      SEEDS.length,
    );
  });

  it('goes silent on the same seeds once planted.neutralise is applied — 0 of 40', () => {
    // The falsifiability claim this detector is allowed to make, and the one
    // the spacing detector cannot: same seed, `courseTakeRate` back to `{}`,
    // nothing else touched, and the finding disappears every time. Left at
    // today's density (no override): insufficient windowed history already
    // reads as "not observed" for this claim's purposes (never `observed`),
    // so this one was not among the seven failing tests and needs no change.
    expect(firingCounts('lopsided-effort', true).effort).toBe(0);
  });

  it('reports the plateau around SHORTFALL_RATIO_K rather than a single passing number', () => {
    // Same shape as the retired MIN_GAP version, re-expressed on the live
    // rule: the ratio, not the absolute gap (`ol-v7r5.63` / `[DOS-C4]`).
    // ol-wyqk: `EFFORT_SUFFICIENCY_DENSITY` on both sides of the pair, or a
    // seed with insufficient windowed history reports the detector's
    // no-comparison default (`1`) rather than a real ratio — see
    // `widestShortfallRatio`'s own doc.
    const ratios = (neutralised: boolean): number[] =>
      SEEDS.map((seed) =>
        widestShortfallRatio(
          streamFor('lopsided-effort', seed, neutralised, EFFORT_SUFFICIENCY_DENSITY),
        ),
      );
    const plantedWorst = Math.max(...ratios(false));
    const removedWorst = Math.min(...ratios(true));
    // Any threshold in [plantedWorst, removedWorst) separates the pair on all
    // forty seeds. SHORTFALL_RATIO_K sits inside it with room on both sides —
    // that width is the claim, not the fact that 0.5 happens to work.
    expect(plantedWorst).toBeLessThan(SHORTFALL_RATIO_K);
    expect(removedWorst).toBeGreaterThan(SHORTFALL_RATIO_K);
    expect(removedWorst - plantedWorst).toBeGreaterThan(0.1);
  });

  it('also fires on the struggler on every seed, and that is CORRECT rather than a false positive', () => {
    // She fails one course repeatedly, so that course eats her hours — around
    // 93% of them — and the other course is 43% of the grade with 7% of the
    // time. That is a real effort imbalance arriving by a different route, and
    // a detector that stayed quiet on it would be wrong. Recorded here because
    // "40/40 on a persona nobody planted this in" is exactly the shape that
    // gets mistaken for a false-positive rate.
    // ol-wyqk: `STRUGGLER_SUFFICIENCY_DENSITY` — see its own doc for why this
    // is a DIFFERENT override from `EFFORT_SUFFICIENCY_DENSITY` above, not the
    // same one reused: lowering her already-struggling course's success
    // further raises windowed sufficiency and widens the gap together,
    // where lowering the other course's (as `EFFORT_SUFFICIENCY_DENSITY`
    // would) raises sufficiency by closing the very gap this test measures.
    expect(firingCounts('struggler', false, STRUGGLER_SUFFICIENCY_DENSITY).effort).toBe(
      SEEDS.length,
    );
    const stream = streamFor('struggler', 'workbench', false, STRUGGLER_SUFFICIENCY_DENSITY);
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
    //
    // STILL FAILING (`ol-wyqk`, reports 0 of 3, not planted-history-fixable):
    // this is the one of the seven originally-failing effort cases this bead's
    // report leaves red, on purpose. `EFFORT_SUFFICIENCY_DENSITY` is
    // deliberately NOT applied here — this claim is about incidental RNG noise
    // at these personas' own, undisturbed behaviour, and juicing density to
    // clear the D-092 window's sufficiency floor would measure a different,
    // unvalidated number instead of "3", not fix this one. Worse, it would be
    // measuring nothing at all for instrument-skipper regardless: swept to
    // defaultSuccess 0.001 (essentially never succeeds — already well past any
    // defensible fixture value), her worst-case windowed count over forty
    // seeds is 33, still short of `MIN_WINDOWED_TIMED_REVIEWS` (40) — her own
    // `cardTakeRateWhenMcqAvailable` filter removes most candidates before the
    // daily cap regardless of success rate, so no `defaultSuccess` clears this
    // floor for her. A real fix needs either the window widened or the floor
    // lowered (`D-365`, open) — a product-source change this bead's `owns`
    // does not reach. See this bead's report, section 2, for the full sweep.
    const stray =
      firingCounts('steady-reviewer', false).effort +
      firingCounts('instrument-skipper', false).effort +
      firingCounts('lapsed-returner', false).effort;
    expect(stray).toBe(3);
  });
});
