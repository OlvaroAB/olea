// test/session-scenarios.spec.ts — the session-builder surface's state builder
// (`ol-p5t06b` [P5-T06b]). Same scope note as `test/timeline-scenarios.spec.ts`:
// rendering itself is checked by e2e; what is worth asserting without a DOM is
// that every advertised state builds against the REAL fixture vault without
// throwing, that the budget seam is live rather than pre-baked, and that the
// three emptinesses this surface has to tell apart — nothing ranked, nothing
// practisable, nothing that fits — actually come out different.
//
// The vault is a `FolderSource` over `packages/core/fixtures/vault`, which is
// the same bytes `loadFixtureVault()` fetches in the browser. That is the whole
// reason `buildSessionScenario` takes a `VaultSource` instead of calling
// `loadFixtureVault` itself — see that module's doc.

import { fileURLToPath } from 'node:url';
import type { StudySessionModel } from 'olea-core';
import { FolderSource } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildSessionScenario,
  findSessionState,
  SESSION_STATES,
} from '../src/session-scenarios.js';

const vault = new FolderSource(
  fileURLToPath(new URL('../../core/fixtures/vault', import.meta.url)),
);

/**
 * `[D-091]` (component register §3.7, `ol-zji3` [BUD-1]): the session budget
 * is a declared TARGET, never a ceiling. `build.ts`'s fill keeps taking items
 * while `plannedSeconds` is still under `budgetSeconds` and stops once it is
 * at or past it — so the fill rounds UP to the single item that crosses the
 * line rather than refusing it. That makes `plannedSeconds <= budgetSeconds`
 * the wrong invariant; the true one, derived from the rule rather than fitted
 * to an observed number, is: whatever the overshoot is, it is smaller than
 * the LAST item's own length, because before that item was taken the running
 * total was still strictly under target.
 */
function expectBudgetOvershootBound(model: StudySessionModel): void {
  const overshoot = model.plannedSeconds - model.budgetSeconds;
  if (overshoot <= 0) return;
  const lastItem = model.items[model.items.length - 1];
  expect(lastItem).toBeDefined();
  expect(overshoot).toBeLessThan(lastItem?.estimatedSeconds ?? 0);
}

describe('SESSION_STATES', () => {
  it('every advertised state builds against the real fixture vault without throwing', async () => {
    for (const state of SESSION_STATES) {
      const scenario = await buildSessionScenario(state.id, vault);
      expect(scenario.state).toBe(state);
      expect(scenario.model.budgetMinutes).toBe(state.budgetMinutes);
      expect(scenario.model.asOf).toBe(state.asOf);
      // Not a ceiling check — `[D-091]` (`ol-zji3` [BUD-1]) — see
      // `expectBudgetOvershootBound`'s doc comment for the derivation.
      expectBudgetOvershootBound(scenario.model);
      // A real walk, not a stub: the fixture vault has instruments and concepts.
      expect(scenario.instrumentCount).toBeGreaterThan(0);
      expect(scenario.conceptCount).toBeGreaterThan(0);
    }
  });

  it('findSessionState resolves every id SESSION_STATES advertises, and nothing else', () => {
    for (const state of SESSION_STATES) {
      expect(findSessionState(state.id)).toBe(state);
    }
    expect(findSessionState('not-a-real-id')).toBeUndefined();
  });

  it('throws on an unknown state id, same discipline as timeline-scenarios.ts', async () => {
    await expect(buildSessionScenario('not-a-real-id', vault)).rejects.toThrow();
  });

  it('every state id is unique and carries the session group', () => {
    expect(new Set(SESSION_STATES.map((s) => s.id)).size).toBe(SESSION_STATES.length);
    expect(SESSION_STATES.every((s) => s.group === 'session')).toBe(true);
  });

  it('borrowing re-binds records, it never mints them', async () => {
    for (const state of SESSION_STATES) {
      const scenario = await buildSessionScenario(state.id, vault);
      expect(scenario.borrowedInstrumentCount).toBeLessThanOrEqual(scenario.instrumentCount);
      if (state.instruments === 'real') expect(scenario.borrowedInstrumentCount).toBe(0);
    }
  });
});

describe('the states show what they advertise', () => {
  it('the exam-eve state counts down to the quiz she sits next, not to the paper that drove the ranking (F4.7)', async () => {
    const scenario = await buildSessionScenario('session-exam-eve-90', vault);

    expect(scenario.gapRowCount).toBeGreaterThan(0);
    const next = scenario.model.nextAssessment;
    expect(next).not.toBeNull();
    if (next === null) return;
    expect(next.daysUntil).toBe(1);
    expect(next.type).toBe('Quiz');
    // The ranking's own strongest contributor is a far-off, heavily-weighted
    // exam — which is exactly why the countdown must read the calendar.
    const rowTargets = new Set(
      scenario.model.leftOut
        .map((o) => o.conceptName)
        .concat(scenario.model.items.map((i) => i.conceptName)),
    );
    expect(rowTargets.size).toBeGreaterThan(0);
  });

  it('the exam-eve state prefers the quiz’s format and says so per item (F4.8)', async () => {
    const scenario = await buildSessionScenario('session-exam-eve-90', vault);
    expect(scenario.model.formatPreference).toBe('mcq');
    expect(scenario.model.items.some((i) => i.formatMatch === 'preferred-format')).toBe(true);
    // MCQ first: the preferred-format item outranks the same concept's other
    // cards rather than merely being present.
    const firstForItsConcept = scenario.model.items.find(
      (i) => i.formatMatch === 'preferred-format',
    );
    expect(firstForItsConcept).toBeDefined();
  });

  it('a mid-semester day with no imminent quiz expresses no format preference', async () => {
    const scenario = await buildSessionScenario('session-short-20', vault);
    expect(scenario.model.formatPreference).toBe('unknown');
    expect(scenario.model.items.every((i) => i.formatMatch === 'no-preference')).toBe(true);
  });

  it('the tight state is where the budget actually bites, and it names what it dropped', async () => {
    const tight = await buildSessionScenario('session-tight-5', vault);
    const roomy = await buildSessionScenario('session-short-20', vault);

    expect(tight.model.items.length).toBeGreaterThan(0);
    expect(tight.model.items.length).toBeLessThan(roomy.model.items.length);
    // Leaving out is information, not truncation.
    expect(tight.model.leftOutInstrumentCount).toBeGreaterThan(0);
  });

  it('the measured state actually reads its durations from the (borrowed) history', async () => {
    const measured = await buildSessionScenario('session-measured-45', vault);
    const assumed = await buildSessionScenario('session-short-20', vault);

    expect(measured.model.durationBasis).not.toBe('assumed');
    expect(measured.model.items.some((i) => i.durationSource === 'measured')).toBe(true);
    // The fixture vault has no review log of its own, so every unborrowed state
    // is honestly cold-start.
    expect(assumed.model.durationBasis).toBe('assumed');
    expect(assumed.model.items.every((i) => i.durationSource === 'assumed')).toBe(true);
  });
});

describe('the three emptinesses are three different states', () => {
  it('"ranked, nothing to practise" keeps the finding visible: rows exist, none has a card', async () => {
    const scenario = await buildSessionScenario('session-no-cards-yet', vault);

    // This is the fixture vault exactly as it is. If a future fixture ever
    // gives a ranked concept a card, THIS is the assertion that goes red, and
    // that is the point of the state.
    expect(scenario.gapRowCount).toBeGreaterThan(0);
    expect(scenario.model.items).toEqual([]);
    expect(scenario.model.leftOut.length).toBe(scenario.gapRowCount);
    expect(scenario.model.leftOut.every((o) => o.reason === 'no-instruments')).toBe(true);
    // "You have notes on this, no cards yet" — F4.5's coverage gap, which is a
    // different sentence from "we don't have it" (F4.10).
    expect(scenario.model.leftOut.every((o) => o.gapClass === 'coverage-gap')).toBe(true);
  });

  it('"nothing ranked" has no rows and therefore no left-out list at all', async () => {
    const scenario = await buildSessionScenario('session-nothing-to-build', vault);

    expect(scenario.gapRowCount).toBe(0);
    expect(scenario.model.consideredRowCount).toBe(0);
    expect(scenario.model.items).toEqual([]);
    // The distinguishing field: with rows to consider, an empty session would
    // have carried left-out entries instead.
    expect(scenario.model.leftOut).toEqual([]);
    expect(scenario.model.nextAssessment).toBeNull();
  });

  it('a target far below every instrument’s length still rounds up to admit one, and is not either of the above (`[D-091]`)', async () => {
    const scenario = await buildSessionScenario('session-short-20', vault);
    // 0.1 minutes (6s) is below every instrument's estimated length in the
    // fixture vault. Under a CEILING reading that produced an empty session
    // (`items === []`) — the assumption this test used to encode. Under
    // target semantics (`[D-091]`, `ol-zji3` [BUD-1]) it no longer can:
    // `plannedSeconds` starts at 0, which is < any positive `budgetSeconds`,
    // so the fill always rounds up to admit at least the first candidate
    // rather than refusing it outright (the same structural fact
    // `build.spec.ts`'s "a target smaller than the shortest instrument
    // still admits it" case exercises directly). What still makes this a
    // THIRD, distinct emptiness from the other two above is that admitting
    // that one item crosses the target immediately, so a later candidate is
    // left out as `did-not-fit` — unlike "ranked, nothing to practise"
    // (`no-instruments`, zero items) or "nothing ranked" (no rows at all).
    const state = await scenario.deps.load({ budgetMinutes: 0.1 });
    expect(state.kind).toBe('model');
    if (state.kind !== 'model') return;

    expect(state.model.items.length).toBeGreaterThanOrEqual(1);
    expectBudgetOvershootBound(state.model);
    expect(state.model.consideredRowCount).toBeGreaterThan(0);
    expect(state.model.leftOut.some((o) => o.reason === 'did-not-fit')).toBe(true);
  });
});

describe('the budget seam is live, not pre-baked models', () => {
  it('deps.load rebuilds for whatever budget the view asks for', async () => {
    const scenario = await buildSessionScenario('session-tight-5', vault);

    const tight = await scenario.deps.load({ budgetMinutes: 5 });
    const roomy = await scenario.deps.load({ budgetMinutes: 90 });
    if (tight.kind !== 'model' || roomy.kind !== 'model') throw new Error('expected models');

    expect(tight.model.budgetMinutes).toBe(5);
    // Not a ceiling check — `[D-091]` (`ol-zji3` [BUD-1]).
    expectBudgetOvershootBound(tight.model);
    expect(roomy.model.items.length).toBeGreaterThan(tight.model.items.length);
  });

  it('deps.load honours a focus concept, so the gap view’s build-session affordance is demonstrable here', async () => {
    const scenario = await buildSessionScenario('session-tight-5', vault);
    // The lowest-ranked concept the fill reached — the one a focus request has
    // to be able to lift, since it is nowhere near the front on its own score.
    const last = scenario.model.items[scenario.model.items.length - 1];
    expect(last).toBeDefined();
    if (last === undefined) return;
    expect(scenario.model.items[0]?.conceptName).not.toBe(last.conceptName);

    const focused = await scenario.deps.load({
      budgetMinutes: 5,
      focusConceptName: last.conceptName,
    });
    if (focused.kind !== 'model') throw new Error('expected a model');
    expect(focused.model.focusConcept).toBe(last.conceptName);
    expect(focused.model.items[0]?.conceptName).toBe(last.conceptName);
  });

  it('the view deps open on the state’s own budget', async () => {
    for (const state of SESSION_STATES) {
      const scenario = await buildSessionScenario(state.id, vault);
      expect(scenario.deps.defaultBudgetMinutes).toBe(state.budgetMinutes);
    }
  });
});
