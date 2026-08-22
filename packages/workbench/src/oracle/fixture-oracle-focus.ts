/**
 * Which part of the fixture-vault oracle screen a walkthrough step is about
 * (`ol-akla`, WBF-3).
 *
 * `mountFixtureOracle` (`main.ts`) mounts the SAME real `GapView` over the
 * SAME real computation for both step 7 ("what's likely to come up") and
 * step 8 ("where the holes are") — one derivation, not two, per
 * `oracle/fixture-oracle.ts`'s module doc. Before this bead, the `stateId`
 * that was meant to tell the two steps apart was accepted and never read, so
 * both rendered byte-identical screens.
 *
 * **This module invents no second computation and no data.** `GapView`
 * already renders the ranking (`.olea-gap-course` sections) and the
 * coverage/gap section (`.olea-gap-coverage`) together, in one pass, over
 * one real result — that is what step 8's own copy needs, since all three
 * gap classes it names are rows in the SAME ranked list, not a separate
 * query (see `test/fixture-oracle.spec.ts` for what the fixture vault
 * actually yields there). What differs between the two steps is which part
 * of that one screen a viewer's attention is pointed at first: step 7 opens
 * on the ranking, step 8 opens scrolled to the coverage section. `main.ts`
 * is where the scroll and the caption actually happen; this module is only
 * the (pure, unit-tested) mapping from a walkthrough `stateId` to which one.
 */

export type FixtureOracleFocus = 'ranking' | 'coverage';

const FOCUS_BY_STATE: ReadonlyMap<string, FixtureOracleFocus> = new Map([
  ['oracle-ranked', 'ranking'],
  ['gap-coverage', 'coverage'],
]);

/** Throws on a `stateId` this surface does not know — same discipline every other `find*State`/`build*Scenario` in this package holds itself to. */
export function fixtureOracleFocus(stateId: string): FixtureOracleFocus {
  const focus = FOCUS_BY_STATE.get(stateId);
  if (focus === undefined) {
    throw new Error(`workbench: unknown fixture-oracle state ${JSON.stringify(stateId)}`);
  }
  return focus;
}

export const FIXTURE_ORACLE_RANKING_NOTE =
  "Reading top to bottom: this is her ranking, ordered by what's most likely to come up.";

export const FIXTURE_ORACLE_COVERAGE_NOTE =
  'Scrolled to the coverage section below the ranking — this is where the holes are.';

/** The caption `main.ts` shows in the host pane for a given focus. */
export function fixtureOracleFocusNote(focus: FixtureOracleFocus): string {
  return focus === 'ranking' ? FIXTURE_ORACLE_RANKING_NOTE : FIXTURE_ORACLE_COVERAGE_NOTE;
}
