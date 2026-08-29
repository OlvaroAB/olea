/**
 * The sprig's render-ready data (F2.3, F2.11, P4-T06 — "+ sprig" in this
 * task's title).
 *
 * ## What a sprig is, established from the contract before building anything
 *
 * `docs/design/pass3-explainback-sprig/BRIEF.md` (§3, "The sprig and
 * mastery") named the original idea — *"a small olive sprig that grows
 * leaves as evidence accumulates"*, five growth stages, bare stem to five
 * leaves, one leaf per named mastery state (frozen by D-017 at the time).
 * **That five-fixed-leaf geometry is retired (D-048, D-049; `VOC-1`,
 * `ol-7efk`).** The ratified sprig is **parameterised geometry, not one leaf
 * per stage at a fixed position**: `seed` draws no stem and no leaves,
 * `sprout` one leaf, `sapling` three leaves, and `tree` the same three
 * leaves plus fruit — never a fourth leaf. Reference implementation:
 * `StageSprig` in
 * `docs/design/pass5b-mastery-ratified/ui_kits/olea-plugin/MasteryAxes.jsx`.
 * It remains a **rendering** of a concept's mastery state, nothing more: the
 * sprig does not carry independent state, it draws the state
 * `../mastery/rollup.ts` already computed, through the one vocabulary site
 * `./display.ts` already owns (F2.11: "one vocabulary used everywhere").
 *
 * So there is no separate "sprig data model" to invent here beyond what
 * those two modules already produce. This file's whole job is composing
 * them for **the Today mastery overview (F6.2)** — `masteryDistribution`,
 * feeding `TodayMastery.jsx`'s "row of sprigs or a compact distribution...
 * readable in two seconds."
 *
 * A single-concept counterpart, `conceptSprig`, once lived here to feed a
 * concept-detail surface (`ConceptMastery.jsx` in the design system). No such
 * surface exists in the plugin and no contract clause defines one, so per
 * `ol-sp9v` it was deleted rather than left unreached indefinitely — see
 * `docs/dev/wiring-register.md`'s sprig section for the finding and this
 * deletion. Re-add it if a concept-detail surface is ever actually built.
 *
 * `masteryDistribution` is a pure function of the review log and the set of
 * concepts to summarise — same inputs, same output, nothing cached, nothing
 * written. No Obsidian dependency, no styling, no SVG: that is the plugin's
 * job, same separation `./display.ts`'s own module doc already draws ("this
 * module holds no Obsidian dependency and no styling").
 */

import type { MasteryState, ReviewLogEntry } from 'olea-contracts';
import { MASTERY_ORDER } from './display.js';
import {
  computeAllConceptMastery,
  conceptIdsInLog,
  type MasteryRollupOptions,
} from './rollup.js';

/**
 * How many concepts (of the given set, or every concept the log names) sit
 * in each of the four named states — the Today mastery overview's compact
 * distribution (F6.2, BRIEF §3: "a row of sprigs or a compact
 * distribution"). Ordered `MASTERY_ORDER` (seed → tree), the same order
 * `../mastery/display.ts` fixes for any strip that renders a distribution.
 */
export interface MasteryDistribution {
  /** Concept count per state, in `MASTERY_ORDER`. Every state present, even at 0 — never a sparse map. */
  readonly counts: Readonly<Record<MasteryState, number>>;
  /** Total concepts summarised. */
  readonly total: number;
}

export function masteryDistribution(
  entries: readonly ReviewLogEntry[],
  conceptIds?: readonly string[],
  options?: MasteryRollupOptions,
): MasteryDistribution {
  const ids = conceptIds ?? conceptIdsInLog(entries);
  const all = computeAllConceptMastery(entries, ids, options);

  const counts = Object.fromEntries(MASTERY_ORDER.map((state) => [state, 0])) as Record<
    MasteryState,
    number
  >;
  for (const { state } of all.values()) {
    counts[state] += 1;
  }

  return { counts, total: ids.length };
}
