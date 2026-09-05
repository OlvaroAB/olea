/**
 * C5.4 — the mastery rollup: growth stage as a pure projection of the whole
 * review log (P4-T06, R3, R7, R9, §7.1; rebuilt for `MAT-6` / `ol-95vv.7`).
 *
 * ## What "rollup" means here, and what it deliberately does not mean
 *
 * The knowledge model names exactly one rollup relationship for mastery —
 * **R3: "Concept mastery is a rollup over its instruments' states plus
 * non-card evidence. Do not run FSRS at concept level."** The "children"
 * being rolled up are the review events her instruments produced, not a
 * concept-to-concept hierarchy: `concept ↔ concept` edges exist in the
 * knowledge model's table (§5, "prerequisite, part-of, contrasts-with") but
 * nothing in this codebase extracts, stores or consumes them, and no
 * functional-scope item asks mastery to climb one. Building a parent-concept
 * rollup over child *concepts* would be inventing a second, un-contracted
 * kind of aggregation on top of the one the knowledge model actually names.
 * So "children" below means **the review events that are evidence for a
 * concept**, and "parent" means **the concept**.
 *
 * ## THE HIGH-WATER MARK — why there is no window and no rate any more
 *
 * **Growth stage is the strongest evidence she has EVER produced for the
 * concept, over the whole log.** R3, in its own words: *"seed · sprout ·
 * sapling · tree records the best she has ever demonstrated on the concept,
 * over the whole history. It is a high-water mark: it never regresses, no
 * implementation may express decay by lowering it, and nothing later — a
 * lapse, a fresh misconception, a pruning (F8.5) — takes back a
 * demonstration that actually happened."* The knowledge model's §8 test 4
 * states the failure directly: *"if a growth stage has ever fallen for any
 * concept ... R3 has been implemented backwards."*
 *
 * This module previously bucketed a **recent windowed success rate** — the
 * superseded model the component register's row 3.1 named as such. It could
 * and did fall back from `tree` to `sprout` when enough failures entered the
 * window, which is exactly the behaviour the clause above forbids; the
 * monotonicity health check (`../checks/mastery-stage-health.ts`, CHK-2) was
 * built against the ratified target and left red for that reason. The three
 * sliding-window constants (`recentWindowSize`, `highSuccessRate`,
 * `minSpacedDays`, the last surviving as the declared spacing gate below)
 * are gone with the window.
 *
 * **Every predicate this fold reads is monotone in the log.** "At least one
 * scored event exists", "successes fell on at least N distinct days", "a
 * graded explain-back ever reached the depth threshold": each can only turn
 * from false to true as events are appended, never back. The stage is the
 * maximum of the stages those predicates unlock, so replaying any prefix of
 * a log prefix-by-prefix produces a non-decreasing sequence **by
 * construction**, not by a check that happens to pass. That is the property
 * `checkMasteryMonotonicity` asserts and `scripts/harness/mastery-checks.mjs`
 * (in `olea-service`) runs.
 *
 * ## Decay is vitality's job, and it is a different function
 *
 * Nothing here models forgetting. R3 assigns that to the scheduler, per
 * instrument, and to the **vitality** axis — *"an overlay on the stage, never
 * a demotion: a `tree` whose recall has faded reads as needing tending and
 * stays a `tree`."* `readConceptVitality` / `readAllConceptVitality`, below,
 * are that axis's own functions; they take a `now` and a holding cut, which
 * `computeConceptMastery` deliberately does not (see "Purity", below).
 * `[D-116]` / F2.11 binds every *consumer*: any surface rendering a growth
 * stage renders vitality alongside.
 *
 * ## The four growth stages, as evidence rules (F2.11, R7, `[D-049]`)
 *
 * 1. **`seed`** — no evidence at all: no scored review, and no graded
 *    explain-back. An explain-back *attempt* with no verdict on it is
 *    recorded (`explainBackAttempts`) but is not evidence about what she
 *    knows — R7's word is success, not attempt — so it does not lift `seed`.
 * 2. **`sprout`** — "practised; recall is not holding yet" (vocabulary
 *    registry §1). Any scored review event exists, whatever its outcome.
 *    This is the floor once evidence exists: a run of outright misses reads
 *    as `sprout`, not as a fifth, worse word the product does not have.
 * 3. **`sapling`** — "recalled reliably across spaced attempts". Successful
 *    scored reviews fell on at least `MIN_SPACED_RETRIEVAL_DAYS` distinct
 *    calendar days. R7 as amended by `[D-145]`: *"recall evidence must
 *    spread across at least `MIN_SPACED_RETRIEVAL_DAYS` (declared, default
 *    3) distinct calendar days — a good streak crammed into one sitting
 *    stays `sprout`"* (Karpicke & Roediger 2008; N-037). Recognition-tier
 *    evidence counts toward this — R7: *"a concept may reach `sapling` on
 *    any evidence mix"* — and `sapling` is the ceiling it can reach.
 * 4. **`tree`** — a graded explain-back for this concept ever reached the
 *    **depth threshold** (`DEPTH_GATE_SOLO_LEVEL`, below). R7: *"`tree` is
 *    reachable only through an explain-back graded at sufficient depth —
 *    separate ideas integrated under a principle, rather than listed
 *    alongside one another — and recall alone can never reach it."*
 *
 * **`tree` does not additionally require `sapling`.** The stage is the
 * high-water mark of evidence *strength*, and R7 orders the tiers
 * recognition < recall < explanation; making the strongest demonstration she
 * has produced wait on a weaker one she has not would be a cap on depth of
 * exactly the kind `[D-080]` removed (knowledge model §3.1, "Size does not
 * cap the depth gate"). Monotonicity holds either way — this reading is
 * chosen because it is the one the clause states.
 *
 * ## The depth gate reads the verdict; it never asks a model for a stage
 *
 * R9 — *"a model grades an answer; the state holds the estimate"* — is
 * structural here, not a convention. The only thing this fold reads off a
 * graded explain-back is `explainBackGrade.soloLevel`, a five-value SOLO
 * verdict about one answer that `packages/contracts/src/review-log.ts` makes
 * unrepresentable as a mastery estimate. The arithmetic — which level clears
 * the gate, and therefore which stage she is at — is entirely this module's.
 * Supersession is a read-time chronological fact (GLOSSARY SOLO rule 3), and
 * a high-water mark needs no ordering to resolve it at all: the gate asks
 * whether the deepest verdict *ever* recorded cleared the threshold, so a
 * later shallower attempt cannot take a stage back, per R3.
 *
 * ## Purity and rebuildability
 *
 * Every export here except the vitality pair is a pure function of its
 * `entries` argument (and the explicit `conceptId`/options it is given) — no
 * clock, no I/O, no module state. `entries` is assumed already at the current
 * schema version (v5): this module never reads `schemaVersion` itself,
 * matching every other log-folding module in core (`../today/streak.ts`,
 * `../review-log/suspension.ts`) — the caller reads the log through
 * `../review-log/parse.ts` (which migrates through `upgrade.ts` before
 * anything downstream sees a record) and hands the result here. That is what
 * makes "discard the projection and recompute it from the log" the whole
 * rebuild story: there is no cache inside this module for a rebuild to
 * disagree with.
 */

import type {
  InstrumentType,
  MasteryAtTime,
  MasteryState,
  Rating,
  ReviewLogEntry,
  ReviewLogRecord,
  SoloLevel,
} from 'olea-contracts';
import type { Scheduler } from '../scheduler/types.js';
import { type ReplayResult, replayedStateOf, replaySchedulerStates } from '../session/replay.js';
import { calendarDayOfTimestamp } from '../today/calendar-day.js';
import { readVitality, type VitalityInstrument, type VitalityReading } from './vitality.js';

/** R7's three evidence tiers, ordered weakest to strongest. */
export type EvidenceTier = 'recognition' | 'recall' | 'explanation';

/** Which R7 tier an instrument type demonstrates. Explain-back is `explanation`. */
export function evidenceTierOf(instrumentType: InstrumentType): EvidenceTier {
  switch (instrumentType) {
    case 'mcq':
      return 'recognition';
    case 'qa':
    case 'cloze':
      return 'recall';
    case 'explain-back':
      return 'explanation';
  }
}

/** SOLO levels weakest to strongest — `contracts/review-log.ts`'s `soloLevel` enum, in order. */
const SOLO_LEVEL_ORDER: readonly SoloLevel[] = [
  'prestructural',
  'unistructural',
  'multistructural',
  'relational',
  'extended-abstract',
];

function soloRank(level: SoloLevel): number {
  return SOLO_LEVEL_ORDER.indexOf(level);
}

/**
 * **THE DEPTH THRESHOLD — declared, not fitted** (component register row 3.1;
 * `MAT-6`/`ol-95vv.7`). The SOLO level a graded explain-back must reach for
 * the concept to clear the depth gate into `tree`.
 *
 * **Why `relational`, in plain English.** R7 states the gate in words, and
 * the words name a specific SOLO level: *"separate ideas integrated under a
 * principle, rather than listed alongside one another."* "Listed alongside
 * one another" is SOLO **multistructural**; "integrated under a principle" is
 * SOLO **relational**. The threshold is therefore read off the clause rather
 * than chosen — the first level at which the clause's description becomes
 * true. `extended-abstract` (transferring the principle to a new domain)
 * would set the bar above what R7 asks for; `multistructural` is the state
 * R7 explicitly contrasts the gate against.
 *
 * This is a **declared** constant in the register's sense: defensible in
 * plain English, never fitted against a corpus. No review corpus could fit
 * it — the verdict it thresholds is defined over free text a ratings corpus
 * does not contain (row 3.1's own amendment says exactly this).
 *
 * **Boundary note.** Row 3.1 assigns the depth threshold and the depth gate
 * to the service and the fold over the local event log to the client, and
 * whether a now-declared constant may move client-side is the standing
 * question `[BND-5]` (`ol-3ux7.3`) — **not re-decided here**. The number
 * ships in the client fold, as `minSpacedDays` already did, and
 * `MasteryRollupOptions.depthGate` lets a service-side caller hand its own.
 */
export const DEPTH_GATE_SOLO_LEVEL: SoloLevel = 'relational';

/**
 * **THE SPACING GATE — declared, `[D-145]` / `ol-2zfj.30`.** Distinct
 * calendar days that successful scored reviews must fall on before a concept
 * reads as `sapling`. R7 names both the constant and its value: *"recall
 * evidence must spread across at least `MIN_SPACED_RETRIEVAL_DAYS`
 * (declared, default 3) distinct calendar days — a good streak crammed into
 * one sitting stays `sprout`."* Correct answers produced in a single sitting
 * are evidence of restudy, not of durable retrieval (Karpicke & Roediger
 * 2008; N-037, `docs/research/learning-science-bibliography.md:61-62`). Three
 * is the smallest number that is unambiguously more than "she reviewed it a
 * few times just now".
 *
 * This is **not** one of the superseded model's sliding-window constants: it
 * counts distinct days over the WHOLE log, which is monotone, where the old
 * `minSpacedDays` counted them inside a sliding window, which was not.
 */
export const MIN_SPACED_RETRIEVAL_DAYS = 3;

/**
 * Tunable parameters for `computeConceptMastery`. Both defaults are
 * **declared** — argued in plain English where the constant is defined above,
 * never fitted from data (`eval/CLAUDE.md` forbids tuning any threshold from
 * synthetic data, and row 3.1 records that neither of these is answerable
 * from a review corpus at all). Moving either is a decision bead.
 */
export interface MasteryRollupOptions {
  /**
   * Distinct calendar days successful scored reviews must fall on for
   * `sapling`. Defaults to `MIN_SPACED_RETRIEVAL_DAYS` (3, `[D-145]`).
   */
  readonly minSpacedRetrievalDays?: number;
  /**
   * The SOLO level a graded explain-back must reach to clear the depth gate
   * into `tree`. Defaults to `DEPTH_GATE_SOLO_LEVEL` (`relational`, R7).
   */
  readonly depthGate?: SoloLevel;
}

interface ResolvedOptions {
  readonly minSpacedRetrievalDays: number;
  readonly depthGate: SoloLevel;
}

function resolveOptions(options: MasteryRollupOptions | undefined): ResolvedOptions {
  const minSpacedRetrievalDays = options?.minSpacedRetrievalDays ?? MIN_SPACED_RETRIEVAL_DAYS;
  const depthGate = options?.depthGate ?? DEPTH_GATE_SOLO_LEVEL;
  if (!Number.isInteger(minSpacedRetrievalDays) || minSpacedRetrievalDays < 1) {
    throw new Error(
      `computeConceptMastery: minSpacedRetrievalDays must be a positive integer, got ${minSpacedRetrievalDays}`,
    );
  }
  if (soloRank(depthGate) < 0) {
    throw new Error(`computeConceptMastery: depthGate must be a SOLO level, got ${depthGate}`);
  }
  return { minSpacedRetrievalDays, depthGate };
}

/**
 * A rating counts as a success whenever it is not a lapse. `again` is FSRS's
 * only failure rating; `hard`, `good` and `easy` all mean she recalled or
 * recognised the thing, differing only in how easily — R7 weights *tiers*
 * (recognition/recall/explanation), not the four-way rating's internal
 * gradations, so this module does not re-litigate FSRS's own scale.
 */
function isSuccessRating(rating: Rating | null): boolean {
  return rating !== null && rating !== 'again';
}

/** The honest "what practice produced this state" line the concept-detail surface needs (BRIEF §3). */
export interface ConceptMasteryEvidence {
  /** Total scored (recall or recognition) review events for this concept, across the whole log. */
  readonly scoredEventCount: number;
  /**
   * How many of those scored events succeeded (a rating other than `again`).
   * Part of the honest "what practice produced this state" line, and the only
   * place a caller can read how her practice is *going* off this axis: the
   * stage itself is a high-water mark and cannot fall, so it can never say
   * "this is going badly right now". That question belongs to vitality
   * (`readConceptVitality`); this count is the evidence beneath the stage,
   * never a rate the stage is bucketed from.
   */
  readonly scoredSuccessCount: number;
  /** Explain-back review events for this concept, graded or not. */
  readonly explainBackAttempts: number;
  /** Explain-back review events for this concept that carry an `explainBackGrade`. */
  readonly gradedExplainBackCount: number;
  /** Every R7 tier at least one scored-or-attempted event for this concept demonstrated. */
  readonly tiersPracticed: Readonly<Record<EvidenceTier, boolean>>;
  /** True when every scored event is recognition (MCQ) — such a concept can never exceed `sapling`. */
  readonly recognitionOnly: boolean;
  /** Distinct calendar days, over the WHOLE log, on which a scored review succeeded — the spacing gate's input. */
  readonly successfulScoredDays: number;
  /** The deepest SOLO verdict ever recorded for this concept; `null` when none was. */
  readonly deepestSoloLevel: SoloLevel | null;
  /** `deepestSoloLevel` reached the depth threshold — the `tree` gate, R7. */
  readonly depthGateCleared: boolean;
}

/** One concept's rolled-up mastery: the state, and the evidence it was read from. */
export interface ConceptMasteryResult {
  readonly conceptId: string;
  readonly state: MasteryState;
  readonly evidence: ConceptMasteryEvidence;
}

/**
 * Folds `entries` into the evidence facts for `conceptId`
 * (D-031/`ol-t3sd`: many-to-many, so one event is evidence for every concept
 * its `conceptIds` names — this reads that list, never a singular field).
 * Suspend/unsuspend events are excluded, matching `../today/streak.ts`:
 * stopping study of something is not evidence about what she knows.
 *
 * **No sort.** Every fact below is a count, a set or a maximum over the whole
 * log — all order-independent by construction, which is what a high-water
 * mark means. The superseded model needed `../review-log/merge.ts`'s total
 * order to decide which events were "recent"; nothing here does, so trailing
 * that dependency would be claiming a determinism this fold gets for free.
 */
function conceptEvidence(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
): ConceptMasteryEvidence {
  const tiersPracticed: Record<EvidenceTier, boolean> = {
    recognition: false,
    recall: false,
    explanation: false,
  };
  const successDays = new Set<string>();
  let scoredEventCount = 0;
  let scoredSuccessCount = 0;
  let recognitionScoredCount = 0;
  let explainBackAttempts = 0;
  let gradedExplainBackCount = 0;
  let deepestSoloLevel: SoloLevel | null = null;

  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (!entry.conceptIds.includes(conceptId)) continue;

    const record: ReviewLogRecord = entry;
    tiersPracticed[evidenceTierOf(record.instrumentType)] = true;

    if (record.instrumentType === 'explain-back') {
      explainBackAttempts += 1;
      const grade = record.explainBackGrade;
      if (grade !== undefined) {
        gradedExplainBackCount += 1;
        if (deepestSoloLevel === null || soloRank(grade.soloLevel) > soloRank(deepestSoloLevel)) {
          deepestSoloLevel = grade.soloLevel;
        }
      }
      continue;
    }

    scoredEventCount += 1;
    if (record.instrumentType === 'mcq') recognitionScoredCount += 1;
    if (isSuccessRating(record.rating)) {
      scoredSuccessCount += 1;
      const day = calendarDayOfTimestamp(record.timestamp);
      if (day !== null) successDays.add(day);
    }
  }

  return {
    scoredEventCount,
    scoredSuccessCount,
    explainBackAttempts,
    gradedExplainBackCount,
    tiersPracticed,
    recognitionOnly: scoredEventCount > 0 && recognitionScoredCount === scoredEventCount,
    successfulScoredDays: successDays.size,
    deepestSoloLevel,
    depthGateCleared: false,
  };
}

/**
 * Rolls up one concept's growth stage from the review log — the pure C5.4
 * projection, a high-water mark over the whole log. Same `entries` and
 * `conceptId` always give the same answer; nothing is written, nothing is
 * cached, nothing consults a clock. See this module's doc for the full
 * argument, and `readConceptVitality` below for the other axis.
 */
export function computeConceptMastery(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  options?: MasteryRollupOptions,
): ConceptMasteryResult {
  if (conceptId.length === 0) {
    throw new Error('computeConceptMastery: conceptId must be non-empty');
  }
  const { minSpacedRetrievalDays, depthGate } = resolveOptions(options);
  const facts = conceptEvidence(entries, conceptId);

  const depthGateCleared =
    facts.deepestSoloLevel !== null && soloRank(facts.deepestSoloLevel) >= soloRank(depthGate);
  const evidence: ConceptMasteryEvidence = { ...facts, depthGateCleared };

  // The high-water mark: the strongest stage any monotone predicate unlocks.
  // Each predicate can only turn from false to true as events are appended,
  // so the stage can only rise — R3's "no implementation may express decay by
  // lowering it", held by construction rather than by a later check.
  let state: MasteryState = 'seed';
  if (evidence.scoredEventCount > 0 || evidence.gradedExplainBackCount > 0) state = 'sprout';
  if (evidence.successfulScoredDays >= minSpacedRetrievalDays) state = 'sapling';
  if (depthGateCleared) state = 'tree';

  return { conceptId, state, evidence };
}

/** Every concept id at least one `kind: 'review'` entry in `entries` names. */
export function conceptIdsInLog(entries: readonly ReviewLogEntry[]): readonly string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    for (const id of entry.conceptIds) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * `computeConceptMastery` for every concept the log names. A convenience
 * fold, not a different algorithm — D-031's ruling that mastery is per
 * concept, never an aggregate, means there is no single number to compute
 * here either; this just runs the one-concept projection once per concept
 * and returns the per-concept map, keyed by concept id.
 */
export function computeAllConceptMastery(
  entries: readonly ReviewLogEntry[],
  conceptIds?: readonly string[],
  options?: MasteryRollupOptions,
): ReadonlyMap<string, ConceptMasteryResult> {
  const ids = conceptIds ?? conceptIdsInLog(entries);
  const result = new Map<string, ConceptMasteryResult>();
  for (const id of ids) {
    result.set(id, computeConceptMastery(entries, id, options));
  }
  return result;
}

/**
 * Builds the `masteryAtTime` value a review-log writer stamps onto a new
 * v4 record at the moment it offers her an item (`ol-7328`'s ruling,
 * `ol-g6zg`'s v4 shape). `entries` must be the log **as it stood before**
 * the event being written — this is "what the system believed when it
 * offered her the item", not a value recomputed after the fact, so the
 * caller is responsible for excluding the not-yet-appended event.
 *
 * **Wired (`ol-rpr4`).** `packages/plugin/src/review/ports.ts`'s
 * `createVaultReviewLogPort` is the production caller: it reads the log to
 * completion, builds this value, and only then calls
 * `appendReviewLogRecord` — see that port's own doc for why that ordering,
 * not a filter, is what keeps the not-yet-appended event out of `entries`.
 */
export function masteryAtTimeForConceptIds(
  entries: readonly ReviewLogEntry[],
  conceptIds: readonly string[],
  options?: MasteryRollupOptions,
): MasteryAtTime {
  const byConcept: Record<string, MasteryState> = {};
  for (const id of conceptIds) {
    byConcept[id] = computeConceptMastery(entries, id, options).state;
  }
  return { attribution: 'per-concept', byConcept };
}

// ---------------------------------------------------------------------------
// Register join 1-2 (`[D-087]`, `ol-95vv.1`): 3.2's per-instrument
// retrievability, wired into 3.1's vitality fold, per concept.
// ---------------------------------------------------------------------------

/**
 * Every instrument that is evidence for `conceptId` (D-031: many-to-many —
 * this reads `entry.conceptIds`, never a singular field, matching
 * `conceptScoredEvents` above), paired with its replayed scheduler state —
 * exactly the shape `./vitality.ts`'s `readVitality` needs to see.
 *
 * `replayed` is expected to be `replaySchedulerStates` run over the **whole**
 * log, not filtered to this concept: an instrument's FSRS state is a property
 * of the instrument's own review history (R3: scheduling stays on
 * instruments), not of which concept is asking about it, so filtering the
 * replay input would be wrong even though filtering the *instrument list*
 * below is exactly right. `readAllConceptVitality` replays once and reuses
 * the result across every concept for this reason.
 *
 * All instrument types are included, recognition-tier ones too — `vitality.ts`
 * applies R3's filter itself and documents that the filter belongs there, not
 * in the caller.
 */
export function conceptVitalityInstruments(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  replayed: ReplayResult,
): readonly VitalityInstrument[] {
  const types = new Map<string, InstrumentType>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (!entry.conceptIds.includes(conceptId)) continue;
    // First-seen type wins. An instrument's type does not change across its
    // own review events; this is a defensive tie-break, not a modelled case.
    if (!types.has(entry.instrumentId)) {
      types.set(entry.instrumentId, entry.instrumentType);
    }
  }

  return [...types.entries()].map(([instrumentId, instrumentType]) => ({
    instrumentId,
    instrumentType,
    state: replayedStateOf(replayed, instrumentId),
  }));
}

/**
 * Reads one concept's vitality (R3's fold, `[D-087]`) from the review log:
 * replays every instrument's scheduler state, gathers the ones that are
 * evidence for `conceptId`, and folds them through `readVitality`.
 *
 * Unlike `computeConceptMastery`, this is not a pure function of `entries`
 * alone — vitality is a current reading and needs `now` and the (derived,
 * handed-in, never-defaulted — see `./vitality.ts`) holding cut. See this
 * module's doc, "computeConceptMastery still computes one axis, not two."
 *
 * Replays the whole log on every call. A caller reading vitality for many
 * concepts from the same log should call `readAllConceptVitality` instead,
 * which replays once.
 */
export function readConceptVitality(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  scheduler: Scheduler,
  now: Date,
  holdingCut: number,
): VitalityReading {
  const replayed = replaySchedulerStates(entries, scheduler);
  const instruments = conceptVitalityInstruments(entries, conceptId, replayed);
  return readVitality({ instruments, scheduler, now, holdingCut });
}

/**
 * `readConceptVitality` for every concept in `conceptIds`, replaying the log
 * once and reusing the result — the vitality-axis counterpart to
 * `computeAllConceptMastery` above. Not "every concept the log names": the
 * caller supplies the set, matching `computeAllConceptMastery`'s own
 * default-from-log convenience being a separate, explicit choice
 * (`conceptIdsInLog`) rather than baked into this function.
 */
export function readAllConceptVitality(
  entries: readonly ReviewLogEntry[],
  conceptIds: readonly string[],
  scheduler: Scheduler,
  now: Date,
  holdingCut: number,
): ReadonlyMap<string, VitalityReading> {
  const replayed = replaySchedulerStates(entries, scheduler);
  const result = new Map<string, VitalityReading>();
  for (const id of conceptIds) {
    const instruments = conceptVitalityInstruments(entries, id, replayed);
    result.set(id, readVitality({ instruments, scheduler, now, holdingCut }));
  }
  return result;
}
