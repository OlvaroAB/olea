// test/home-scenarios.spec.ts — HomeView's own flat-surface state builder
// (`ol-qq61`, follow-up to `ol-z6x2` [WB-2]). Same scope note as
// `test/session-scenarios.spec.ts`: rendering itself is checked by e2e; what is
// worth asserting without a DOM is that every advertised state builds against
// the REAL fixture vault without throwing, and that the three things `[D-243]`
// moved onto `HomeView` — the composed session, the empty-session copy, and
// the session card's own `kind: 'unavailable'` box — plus `HomeView`'s OWN
// outer `kind: 'unavailable'` branch, actually come out as the distinct states
// their notes claim.
//
// The vault is a `FolderSource` over `packages/core/fixtures/vault`, the same
// bytes `session-scenarios.spec.ts` reads — see that file's own doc for why.

import { fileURLToPath } from 'node:url';
import { FolderSource } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildHomeScenario, findHomeState, HOME_STATES } from '../src/home-scenarios.js';

const vault = new FolderSource(
  fileURLToPath(new URL('../../core/fixtures/vault', import.meta.url)),
);

describe('HOME_STATES', () => {
  it('every advertised state builds against the real fixture vault without throwing', async () => {
    for (const state of HOME_STATES) {
      const scenario = await buildHomeScenario(state.id, vault);
      expect(scenario.workbenchState).toBe(state);
      expect(findHomeState(state.id)).toEqual({ id: state.id, note: state.note });
    }
  });

  it('rejects an unknown state id', async () => {
    await expect(buildHomeScenario('not-a-real-state', vault)).rejects.toThrow(
      /unknown home state/,
    );
  });

  it('home-composed: a real, non-empty composed session, courses left empty', async () => {
    const scenario = await buildHomeScenario('home-composed', vault);
    expect(scenario.state.kind).toBe('dashboard');
    if (scenario.state.kind !== 'dashboard') return;
    expect(scenario.state.session.kind).toBe('model');
    if (scenario.state.session.kind !== 'model') return;
    expect(scenario.state.session.model.items.length).toBeGreaterThan(0);
    expect(scenario.state.courses).toEqual([]);
    expect(scenario.state.avoidanceQuestion).toBeUndefined();
    // `HomeView`'s own `budgetMinutes` is hardcoded to
    // `DEFAULT_SESSION_BUDGET_MINUTES` (20) — this state's reused session
    // state must already sit at that budget, or the first real `onOpen` load
    // silently renders a different composition than this scenario pre-built.
    // See `home-scenarios.ts`'s own module doc.
    expect(scenario.state.session.model.budgetMinutes).toBe(20);
  });

  it('home-empty: the honest empty composition [D-243] relocated', async () => {
    const scenario = await buildHomeScenario('home-empty', vault);
    expect(scenario.state.kind).toBe('dashboard');
    if (scenario.state.kind !== 'dashboard') return;
    expect(scenario.state.session.kind).toBe('model');
    if (scenario.state.session.kind !== 'model') return;
    expect(scenario.state.session.model.items).toEqual([]);
  });

  it("home-session-unavailable: SessionBuilderView's own unavailable box, inside a dashboard state", async () => {
    const scenario = await buildHomeScenario('home-session-unavailable', vault);
    expect(scenario.state.kind).toBe('dashboard');
    if (scenario.state.kind !== 'dashboard') return;
    expect(scenario.state.session.kind).toBe('unavailable');
    expect(scenario.sessionScenario?.model).toBeNull();
  });

  it("home-unavailable: HomeView's own outer unavailable branch, with no session scenario at all", async () => {
    const scenario = await buildHomeScenario('home-unavailable', vault);
    expect(scenario.state).toEqual({ kind: 'unavailable' });
    expect(scenario.sessionScenario).toBeUndefined();
  });
});
