/**
 * `createGenerationPrioritySource` — the live "current need" and "expected
 * item count" reading `[D-368]`'s drain-order comparator
 * (`../ingestion/wiring.ts#compareGenerationPriority`) needs from
 * `IngestionWiringDeps.generation.priority` (`ol-2zfj.173`).
 *
 * `../ingestion/wiring.ts`'s own module doc, "Read fresh at drain time," and
 * `IngestionWiringDeps.generation.priority`'s own doc are explicit about the
 * shape a caller must fill: read `olea-core`'s `readAllConceptReadiness` /
 * `readNeed` (`mastery/attainment.ts`) fresh, never a value captured at
 * enqueue time; apply `readNeed`'s own `[D-348]`-ruled unknown-basis default
 * rather than inventing a second one; and answer a job's own expected item
 * count as a SEPARATE, declared number (this bead's to name — no module
 * computes one yet). This file is that caller — nothing here re-implements
 * `readAllConceptReadiness`'s or `readNeed`'s arithmetic; both are imported
 * from `olea-core` unchanged, the same two functions
 * `packages/core/src/oracle/compose.ts#resolveRetrievabilityScores` already
 * folds a review log through for the identical "current recall, per
 * concept" shape (`session-builder/provider.ts`'s own `readReviewLogHistory`
 * + `deps.scheduler` pairing is the pattern this module reuses, not a
 * second copy of it).
 *
 * ## The synchronous seam forces a two-step split
 *
 * `IngestionWiringDeps.generation.priority` is
 * `(payload: GenerationJobPayload) => GenerationPrioritySignal | null` —
 * SYNCHRONOUS, because `IngestionQueueEngine.tick()`'s `nextEligibleIndex`
 * calls the comparator (and, through it, this function) synchronously while
 * scanning eligible jobs (`packages/core/src/ingestion/engine.ts`). Reading
 * the review log is I/O and cannot happen inside that call. So this module
 * splits the work: `refresh()` is async and does the one vault read (`
 * readReviewLogHistory`) plus the one validity fold (`projectInstrumentValidity`)
 * a drain needs; `priority()` is the synchronous per-comparison read the
 * engine calls, answering out of whatever `refresh()` last produced.
 *
 * **Cache per tick, explicit invalidation, never across ticks.** A caller
 * that awaits `refresh()` immediately before each `engine.tick()` call gets
 * exactly `[D-368]`'s "read fresh at drain time... never a frozen snapshot":
 * every tick's drain order is decided from a read taken for THAT tick, and
 * `refresh()` always REPLACES the previous snapshot wholesale (never merges
 * into it), so no stale reading from an earlier tick can leak into a later
 * one. What this trades away, deliberately: within one tick, every
 * `priority()` call answers from the SAME snapshot rather than re-reading
 * the vault once per pairwise comparison — re-reading per comparison would
 * mean O(eligible jobs) vault reads to decide the drain order of a single
 * job, on every tick, for a benefit (a few hundred milliseconds' more
 * currency within one tick's own drain decision) the ruling never asks for.
 * `priority()` returning `null` before `refresh()` has ever run is the same
 * honest "no reading composed" default `../ingestion/wiring.ts`'s
 * `DEFAULT_GENERATION_PRIORITY_SIGNAL` already documents — every job ties,
 * arrival order governs, exactly as before this module existed.
 *
 * ## No production caller yet — named, not hidden (`[D-072]`)
 *
 * `IngestionWiringDeps.generation` requires `draft` and `hasAnyBuiltKind`
 * alongside `priority` — TypeScript will not accept `priority` alone. Both
 * already have real, tested implementations
 * (`generation-job-runner.ts#createGenerationDraftRunner` /
 * `#createHasAnyBuiltKind`, `ol-2zfj.135` [GEN-3.4]), but `main.ts` does not
 * yet supply `deps.generation` at all: composing it would make the
 * ingestion queue call the Worker's generation task automatically on every
 * material arrival — a new, unauthorised automatic-spend surface while
 * `[D-261]` holds ledger spend at zero. That composition is deliberately
 * HELD, not this bead's to do: `ol-2zfj.171` (open, blocked by `[D-261]`)
 * is the named follow-up, with the held `main.ts`/`main-wiring.spec.ts` diff
 * already written and waiting in the orchestrator's own scratchpad. This
 * module is built and tested on its own terms so `ol-2zfj.171`'s eventual
 * `generation: { draft, hasAnyBuiltKind, priority }` object literal has a
 * third field ready to add — `priority: createGenerationPrioritySource({
 * vault, scheduler }).priority` — the day `[D-261]` authorises it. See
 * `main.ts`'s own comment beside its `buildIngestionRunner` call.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  type GenerationJobPayload,
  type InstrumentValidityProjection,
  projectInstrumentValidity,
  readAllConceptReadiness,
  readNeed,
  readReviewLogHistory,
  type SchedulableInstrumentType,
  type Scheduler,
  type VaultSource,
} from 'olea-core';
import type { GenerationPrioritySignal } from '../ingestion/wiring.js';

/**
 * `[D-368]`'s second tie-break dimension (after need, before arrival order):
 * each job's own expected item count. Declared, plain English, Class B,
 * never fitted — no module in this codebase counts how many items a
 * generation call actually returns, and `generation/constants.ts`'s own
 * `MAX_CONCEPTS_PER_SWEEP` doc already records the deliberate decision NOT
 * to declare a client-side question-count constant, because that number is
 * tuned server-side (`draftQuizCardsForConcept`'s own default `questionCount`,
 * C4.6) and this pipeline does not override it. This module needs a NUMBER
 * (the comparator subtracts it), not a policy of deferring to the server, so
 * it declares the smallest honest one available: a small, round, equal
 * figure for every kind, standing in for "a few items" until a real per-call
 * count is ever recorded (`DraftRecord` — `generation/types.ts` — records
 * one item per file, never a call's own total, so there is nothing to read
 * yet). Kept as a per-`SchedulableInstrumentType` table, not one bare
 * number, so the day a real reading exists for one kind (`'mcq'` is the only
 * kind any drafting path serves today — component register row 2.1) it can
 * change without widening this constant's shape. Equal across kinds today
 * means this dimension never actually discriminates between different-kind
 * jobs tied on need — an honest consequence of having no basis to prefer one
 * kind's yield over another's, not a bug to route around.
 */
export const DECLARED_EXPECTED_YIELD_BY_INSTRUMENT_KIND: Readonly<
  Record<SchedulableInstrumentType, number>
> = {
  mcq: 3,
  qa: 3,
  cloze: 3,
};

export interface GenerationPrioritySourceDeps {
  readonly vault: VaultSource;
  /**
   * The SAME `Scheduler` a caller's other current readings use — `main.ts`'s
   * own comment above its one `createFsrsScheduler()` call: "One Scheduler,
   * built here, is what makes that literally the same computation rather
   * than two that match." This module takes it as a dependency rather than
   * constructing its own for exactly that reason.
   */
  readonly scheduler: Scheduler;
  /** Defaults to `() => new Date()`. Injected for deterministic tests, matching every sibling `now?` seam in this package. */
  readonly now?: () => Date;
}

export interface GenerationPrioritySource {
  /**
   * The one piece of I/O this module does: reads the whole review log fresh
   * (`readReviewLogHistory`) and folds it into an `InstrumentValidityProjection`
   * (`projectInstrumentValidity`) — the same pairing
   * `oracle/compose.ts#composeOracleRanking` already reads for the identical
   * reason. Replaces this source's cached snapshot wholesale; never merges
   * with what a previous `refresh()` produced, so nothing from an earlier
   * tick survives into a later one. A caller wiring this into production
   * awaits this immediately before each `engine.tick()` call — see this
   * module's own doc, "Cache per tick, explicit invalidation."
   */
  readonly refresh: () => Promise<void>;
  /**
   * `IngestionWiringDeps.generation.priority`'s exact shape — assign this
   * property directly, do not wrap it. Answers `null` (the engine's own "no
   * opinion, keep arrival order" default) when `refresh()` has never run, or
   * has run but this concept has no reading at all (`readAllConceptReadiness`
   * always answers every concept it is asked about, so in practice this is
   * only the "never refreshed" case — the defensive branch stays for the
   * `Map.get` type, not because it is expected to fire).
   */
  readonly priority: (payload: GenerationJobPayload) => GenerationPrioritySignal | null;
}

interface RefreshedReading {
  readonly entries: readonly ReviewLogEntry[];
  readonly validity: InstrumentValidityProjection;
  /** The instant `refresh()` read at — `readNeed`/`readAllConceptReadiness`'s "now", never re-read per comparison. */
  readonly at: Date;
}

export function createGenerationPrioritySource(
  deps: GenerationPrioritySourceDeps,
): GenerationPrioritySource {
  const now = deps.now ?? (() => new Date());
  let snapshot: RefreshedReading | null = null;

  return {
    async refresh() {
      const { entries } = await readReviewLogHistory(deps.vault);
      snapshot = { entries, validity: projectInstrumentValidity(entries), at: now() };
    },
    priority(payload) {
      if (snapshot === null) return null;
      const readings = readAllConceptReadiness(
        snapshot.entries,
        [payload.conceptKey],
        deps.scheduler,
        snapshot.at,
        snapshot.validity,
      );
      const readiness = readings.get(payload.conceptKey);
      if (readiness === undefined) return null;
      // `[D-348]`, ruled: `readNeed`'s own default (`UNKNOWN_NEED_VALUE`)
      // applies automatically when `readiness.weakest` is `null` — never a
      // second unknown-basis policy invented here.
      const need = readNeed(readiness).value;
      const expectedYield = DECLARED_EXPECTED_YIELD_BY_INSTRUMENT_KIND[payload.instrumentKind];
      return { need, expectedYield };
    },
  };
}
