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
import type { Scheduler } from '../scheduler/types.js';
import { MASTERY_ORDER } from './display.js';
import {
  computeAllConceptMastery,
  conceptIdsInLog,
  type MasteryRollupOptions,
  readAllConceptVitality,
} from './rollup.js';
import type { Vitality } from './vitality.js';

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

// ---------------------------------------------------------------------------
// `[VIT-2]` (`ol-a3hv`) — threading F2.11's vitality axis into the Today
// course-level aggregate, per D-116's co-presence clause ("no surface shows a
// growth stage without its vitality reading alongside").
// ---------------------------------------------------------------------------

/**
 * What `masteryVitalityByStage` needs to read a *current* vitality reading —
 * `./vitality.ts`'s own doc explains why growth stage (pure, no clock) and
 * vitality (a current reading) cannot share one signature: this is the
 * clock-and-scheduler half `masteryDistribution` deliberately does not take.
 * Optional at every caller one layer up (`MasteryOverviewInput.vitality`),
 * because no production caller has wired a scheduler/clock/cut into the
 * Today panel yet — see that field's own doc for the current gap and D-116's
 * fallback it produces meanwhile.
 */
export interface MasteryVitalityInputs {
  readonly scheduler: Scheduler;
  /** Never read from `Date.now()` by this module — the caller's instant, matching `readVitality`'s own rule. */
  readonly now: Date;
  /** The derived, never-defaulted cut (`[D-115]`) — see `./vitality.ts`'s module doc for why there is no default here either. */
  readonly holdingCut: number;
}

/**
 * One concept currently reading `needs tending`, named for the ladder's
 * tending line (F2.11, D-116, `[D-087]`) — vocabulary registry §1: "a
 * tending line naming the concepts explicitly".
 *
 * **No retrievability number anywhere on this shape.** `weakestInstrumentId`
 * is R3's named reason (`readVitality`'s `weakest.instrumentId`), never its
 * `recallProbability` — the three vitality words are the position a copy
 * layer may state, and a number beside them is the score principle 12's
 * second part bans.
 *
 * **`displayName`, optional, supplied by the caller (`ol-95vv.6`) — never by
 * this module.** `masteryVitalityByStage` below is a pure fold over entries
 * and bare concept ids; it has no vault access and cannot resolve wording of
 * its own. Its one production caller, `../today/mastery-overview.ts`, sits
 * outside this bead's `owns` and has no name map to pass through either — so
 * every `TendingConcept` this fold builds still carries `displayName`
 * absent, exactly as before this field existed. What changed instead:
 * `../../plugin/src/today/data-source.ts`'s `loadTodayPanel` is the one
 * place inside this bead's `owns` that sees both an already-built
 * `TodayViewModel` and a resolved concept-id → display-name map at once, so
 * it rewrites `tending` entries with a `displayName` after the fact — a pure
 * widening of an already-computed value, never a second computation of
 * mastery or vitality. `weakestInstrumentId` gets no such treatment: no
 * production surface inside this bead's `owns` can reach a human-readable
 * instrument label without a second, full vault walk (the instrument's
 * `notePath`/`heading`/`instrumentType` live only in `VaultInstrumentRecord`,
 * behind a walk `data-source.ts`'s `TodayInstrumentSource` does not expose,
 * and the "weakest" instrument need not even be one of the "due" instruments
 * that walk would return) — so it is kept raw, on purpose, until a caller
 * that already holds that walk's output can thread one through.
 */
export interface TendingConcept {
  readonly conceptId: string;
  readonly state: MasteryState;
  readonly weakestInstrumentId: string;
  /** Her vault's own wording for this concept, when a caller has resolved one. `undefined` falls back to `conceptId` at the copy layer (`../../plugin/src/today/copy.ts#tendingLine`). */
  readonly displayName?: string;
}

/** How a stage's concepts split across the three vitality values. Every value present, even at 0 — the same "never a sparse map" rule `MasteryDistribution.counts` already holds. */
export type VitalityByStage = Readonly<Record<MasteryState, Readonly<Record<Vitality, number>>>>;

export interface MasteryVitality {
  /** Every `MASTERY_ORDER` state × every vitality value, so a ladder row never has to ask "and what about vitality here?" */
  readonly byStage: VitalityByStage;
  /** Concepts reading `needs tending`, across every stage — the tending line's whole input. `[]` when nothing needs tending. */
  readonly tending: readonly TendingConcept[];
}

/** `holding` first — the "silent", unmarked value (F2.11: "holding is the value that carries no mark") — then the two marked values, in the order the vocabulary registry states them. */
const VITALITY_VALUES: readonly Vitality[] = ['holding', 'tending', 'early'];

function emptyByStage(): Record<MasteryState, Record<Vitality, number>> {
  return Object.fromEntries(
    MASTERY_ORDER.map((state) => [
      state,
      Object.fromEntries(VITALITY_VALUES.map((value) => [value, 0])) as Record<Vitality, number>,
    ]),
  ) as Record<MasteryState, Record<Vitality, number>>;
}

/**
 * Folds growth stage (`computeAllConceptMastery`) and vitality
 * (`readAllConceptVitality`) over the SAME `conceptIds`, so every concept
 * lands in the vitality tally under the one stage it actually sits at right
 * now — the per-stage counterpart `masteryDistribution` alone cannot give,
 * because it never reads vitality at all.
 *
 * Not pure the way `masteryDistribution` is: see `MasteryVitalityInputs`'s
 * doc for why `now`/`scheduler`/`holdingCut` are unavoidable here.
 */
export function masteryVitalityByStage(
  entries: readonly ReviewLogEntry[],
  conceptIds: readonly string[],
  vitality: MasteryVitalityInputs,
  options?: MasteryRollupOptions,
): MasteryVitality {
  const mastery = computeAllConceptMastery(entries, conceptIds, options);
  const readings = readAllConceptVitality(
    entries,
    conceptIds,
    vitality.scheduler,
    vitality.now,
    vitality.holdingCut,
  );

  const byStage = emptyByStage();
  const tending: TendingConcept[] = [];

  for (const [conceptId, { state }] of mastery) {
    const reading = readings.get(conceptId);
    // Both maps are built from the same `conceptIds` above, so this is
    // defensive only — never expected to actually skip a concept.
    if (reading === undefined) continue;

    byStage[state][reading.value] += 1;
    if (reading.value === 'tending' && reading.weakest !== null) {
      tending.push({ conceptId, state, weakestInstrumentId: reading.weakest.instrumentId });
    }
  }

  return { byStage, tending };
}
