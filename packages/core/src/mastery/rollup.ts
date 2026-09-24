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
 * 4. **`tree`** — **what it claims, per `[D-281]` (`ol-95vv.10`): that on a
 *    specific occasion she explained the concept correctly and deeply, in her
 *    own account of it.** A record of something that happened, never a
 *    prediction of what she could do now — readiness for an assessment is a
 *    different question, answered by a demand-aware calculation elsewhere, and
 *    the two are permanently separate. A concept she genuinely understood
 *    months ago is still understood and may simultaneously be one she is not
 *    ready to be assessed on; both are true at once.
 *
 *    R7 remains the depth half — *"`tree` is reachable only through an
 *    explain-back graded at sufficient depth — separate ideas integrated under
 *    a principle, rather than listed alongside one another — and recall alone
 *    can never reach it"* — but depth alone no longer grants it. `[D-281]`
 *    requires FOUR pieces of qualifying evidence on the SAME attempt and the
 *    same instrument version — correctness, depth, assistance, instrument
 *    validity — plus correction; see `qualifiesForTopStage` below, which is
 *    the single place that predicate lives.
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
 * rebuild story.
 *
 * **One exception, added by `MAT-6a` / `ol-95vv.9`:** a `WeakMap`, keyed by
 * `entries`' own array identity, memoises a single pass that groups records
 * by concept id (see `indexEntries`, below `conceptEvidence`). It holds no
 * state a rebuild could disagree with — a different log is a different
 * array and a cold cache entry — it only avoids re-scanning the same array
 * once per concept when a caller folds many concepts over one log, which is
 * every batch caller in this file.
 */

import type {
  InstrumentType,
  MasteryAtTime,
  MasteryState,
  Rating,
  ReviewLogEntry,
  ReviewLogRecord,
  SoloLevel,
  SupportLevel,
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
 * **THE ADMITTED SUPPORT LEVELS — declared, `[D-281]` / `ol-95vv.10`.** Which
 * `supportLevelShown` values still permit the top stage's claim.
 *
 * `[D-281]` fixes the meaning of the top stage as **demonstrated deep
 * understanding on a specific occasion** — explicitly *not* durable retention
 * and *not* independent performance in the general case. So assistance is read
 * to tell demonstration-with-help from independent demonstration, not to
 * require the latter: `independent` (no support) and `prompted` (a targeted
 * hint on demand, D-094) both leave the explanation hers. `guided` does not:
 * D-094's guided rung expands the SOURCE beside her while she answers, so the
 * explanation may be a reading of the text rather than an account of her own
 * understanding — the one thing the stage claims.
 *
 * **Unknown is not a level and never admits the claim** (`[D-281]` item 3, in
 * its own words: "where the level is unknown, it does not"). A record with no
 * `supportLevelShown` qualifies nothing, the same discipline `correctness`'s
 * absence follows.
 */
export const ADMITTED_SUPPORT_LEVELS: readonly SupportLevel[] = ['independent', 'prompted'];

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
  /**
   * `[D-281]` item 3: the `supportLevelShown` values that still permit the
   * top stage. Defaults to `ADMITTED_SUPPORT_LEVELS`; a record whose support
   * level is absent is never admitted, whatever this list holds.
   */
  readonly admittedSupportLevels?: readonly SupportLevel[];
  /**
   * `[D-281]` item 4 — instrument validity: the ids of instruments that are
   * **withdrawn, rejected, or built on evidence that has gone stale**, whose
   * graded attempts therefore qualify nothing. Her ACCEPTANCE of an
   * instrument is not validity and must never be passed here as if it were.
   *
   * Supplied by the caller rather than derived here, because validity is a
   * fact about the instrument's current standing (F8.5 withdrawal, a
   * rejected draft, a source that has since changed) and not about the
   * review event, so it can change long after the event was written — a fold
   * that cached it on the record would be reading a stale answer. Empty by
   * default: a caller that knows of no invalidated instrument states that by
   * saying nothing, and the write side refuses to record a correctness
   * verdict at all when the grading it came from was rejected as stale
   * (`packages/plugin/src/explain-back/solo-review.ts`), so a stale-source
   * attempt cannot qualify even where no caller supplies this list.
   */
  readonly invalidInstrumentIds?: readonly string[];
}

interface ResolvedOptions {
  readonly minSpacedRetrievalDays: number;
  readonly depthGate: SoloLevel;
  readonly admittedSupportLevels: ReadonlySet<SupportLevel>;
  readonly invalidInstrumentIds: ReadonlySet<string>;
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
  return {
    minSpacedRetrievalDays,
    depthGate,
    admittedSupportLevels: new Set(options?.admittedSupportLevels ?? ADMITTED_SUPPORT_LEVELS),
    invalidInstrumentIds: new Set(options?.invalidInstrumentIds ?? []),
  };
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
  /** Every R7 tier at least one scored-or-attempted event for this concept demonstrated, whatever its outcome. */
  readonly tiersPracticed: Readonly<Record<EvidenceTier, boolean>>;
  /**
   * Every R7 tier at least one event for this concept **succeeded** at —
   * a scored review whose rating was not `again`, or a graded explain-back
   * whose independent correctness verdict was `correct`. Deliberately
   * separate from `tiersPracticed`, which is true on attempt alone and stays
   * that way for its own documented readers (the concept-detail "what
   * practice produced this state" line, BRIEF §3): a caller that discounts
   * need on *demonstrated* recognition — ol-lfhj, R7, review 3.4's "a wrong
   * answer never lowers need" — reads this field, never `tiersPracticed`.
   *
   * **Optional** so a fixture built before this field existed, elsewhere in
   * this codebase, still type-checks without editing every one of them —
   * `computeConceptMastery` always populates it; an absent value reads as no
   * demonstrated success, the conservative default a discounting reader
   * needs.
   */
  readonly tiersSucceeded?: Readonly<Record<EvidenceTier, boolean>>;
  /** True when every scored event is recognition (MCQ) — such a concept can never exceed `sapling`. */
  readonly recognitionOnly: boolean;
  /** Distinct calendar days, over the WHOLE log, on which a scored review succeeded — the spacing gate's input. */
  readonly successfulScoredDays: number;
  /** The deepest SOLO verdict ever recorded for this concept; `null` when none was. */
  readonly deepestSoloLevel: SoloLevel | null;
  /**
   * `deepestSoloLevel` reached the depth threshold. **Depth alone, and since
   * `[D-281]` no longer the `tree` gate on its own** — it is kept as the
   * honest evidence fact ("she has explained this at that depth at least
   * once") that the concept-detail line reads, while
   * `topStageQualified` below is what the stage is actually set from.
   */
  readonly depthGateCleared: boolean;
  /**
   * **`[D-281]` / `ol-95vv.10`: at least one attempt carries ALL FOUR pieces
   * of qualifying evidence, on the SAME attempt** — an independent
   * correctness verdict of `correct`, a structural depth verdict at or above
   * the depth threshold, a support level this decision admits
   * (`ADMITTED_SUPPORT_LEVELS`; unknown never admits), and an instrument that
   * still stands (`MasteryRollupOptions.invalidInstrumentIds`) — and has not
   * been superseded by a later corrective grade (`explainBackGrade.revisionOf`).
   * This, not depth alone, is what sets the top stage.
   */
  readonly topStageQualified: boolean;
}

/** One concept's rolled-up mastery: the state, and the evidence it was read from. */
export interface ConceptMasteryResult {
  readonly conceptId: string;
  readonly state: MasteryState;
  readonly evidence: ConceptMasteryEvidence;
}

/**
 * **THE SINGLE-PASS INDEX — `MAT-6a` / `ol-95vv.9`, the fix for the
 * whole-log-per-concept blowup MAT-6 introduced.**
 *
 * `conceptEvidence` (below) and `conceptVitalityInstruments` used to scan
 * the *entire* `entries` array once per concept id — correct, since the
 * high-water mark genuinely needs the whole log, but a caller folding many
 * concepts over the same log (`computeAllConceptMastery`,
 * `readAllConceptVitality`, and the retrospective's own per-concept loop
 * over an already-computed vitality map) turned that into an O(concepts ×
 * log length) rescan. Measured on the real vault: the retrospective view's
 * mount went from 149-348ms to 7.6-23.4s at some weeks (`ol-95vv.9`).
 *
 * The fix is a single pass that buckets every `kind: 'review'` entry by
 * every concept it is evidence for (D-031's many-to-many `conceptIds`), plus
 * the first-seen instrument type per concept (`conceptVitalityInstruments`'s
 * own tie-break, preserved exactly). Grouped-by-concept entries are still
 * folded through the SAME per-concept logic below — this changes only which
 * array is iterated, never the arithmetic, so the high-water-mark result for
 * any one concept is unchanged.
 *
 * **Cached in a `WeakMap` keyed by the `entries` array's own identity, guarded
 * by the array's `length` at index-build time (`ol-i8ga`, fixing the
 * regression `ol-95vv.9` introduced).** The original doc here claimed "a
 * different log is a different array" — false for a caller that mutates the
 * *same* array in place (`Array.prototype.push`, as
 * `response-function.spec.ts`'s incremental-replay construction does, and as
 * any in-memory event log appending to a live array would): the reference
 * stays identical while the content it should be evidence for grows, so a
 * bare identity-keyed cache silently served an index built from a shorter
 * prefix of the log forever after. Storing `length` alongside the index and
 * rebuilding whenever it no longer matches `entries.length` restores the
 * "same entries, same conceptId, same answer" purity contract for the common
 * append-only case without giving up the memoisation this module exists for:
 * a caller that never mutates its `entries` reference (every production
 * caller today) still hits a warm cache on every repeat call within one
 * view-open. It does not protect an in-place mutation that leaves `length`
 * unchanged (e.g. replacing an element at a fixed index) — no known caller
 * does that, and the module doc's "single pass over `entries`" contract
 * already assumes callers treat a given `entries` array as an immutable log
 * once appended-to, matching `ReviewLogEntry`'s own append-only event-log
 * semantics.
 */
interface ReviewLogEntryIndex {
  /** Every `kind: 'review'` record naming a given concept id, in log order. */
  readonly recordsByConcept: ReadonlyMap<string, readonly ReviewLogRecord[]>;
  /**
   * Per concept, every instrument's type, first-seen order —
   * `conceptVitalityInstruments`'s exact prior per-concept scan, batched.
   */
  readonly instrumentTypesByConcept: ReadonlyMap<string, ReadonlyMap<string, InstrumentType>>;
  /** `conceptIdsInLog`'s result — every concept id at least one entry names, sorted. */
  readonly conceptIds: readonly string[];
}

interface CachedReviewLogEntryIndex {
  readonly length: number;
  readonly index: ReviewLogEntryIndex;
}

const entryIndexCache = new WeakMap<readonly ReviewLogEntry[], CachedReviewLogEntryIndex>();

function indexEntries(entries: readonly ReviewLogEntry[]): ReviewLogEntryIndex {
  const cached = entryIndexCache.get(entries);
  if (cached !== undefined && cached.length === entries.length) return cached.index;

  const recordsByConcept = new Map<string, ReviewLogRecord[]>();
  const instrumentTypesByConcept = new Map<string, Map<string, InstrumentType>>();
  const conceptIdSet = new Set<string>();

  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    const record: ReviewLogRecord = entry;
    for (const conceptId of record.conceptIds) {
      conceptIdSet.add(conceptId);

      const records = recordsByConcept.get(conceptId);
      if (records === undefined) recordsByConcept.set(conceptId, [record]);
      else records.push(record);

      let types = instrumentTypesByConcept.get(conceptId);
      if (types === undefined) {
        types = new Map<string, InstrumentType>();
        instrumentTypesByConcept.set(conceptId, types);
      }
      // First-seen type wins — `conceptVitalityInstruments`'s own tie-break,
      // preserved verbatim: an instrument's type does not change across its
      // own review events.
      if (!types.has(record.instrumentId)) types.set(record.instrumentId, record.instrumentType);
    }
  }

  const index: ReviewLogEntryIndex = {
    recordsByConcept,
    instrumentTypesByConcept,
    conceptIds: [...conceptIdSet].sort(),
  };
  entryIndexCache.set(entries, { length: entries.length, index });
  return index;
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
 *
 * Reads `entries` through `indexEntries`'s single-pass, cached grouping
 * rather than scanning `entries` itself — see that function's doc for why
 * this is still a pure fold over `entries` and `conceptId` alone.
 */
function conceptEvidence(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  resolved: ResolvedOptions,
): ConceptMasteryEvidence {
  const tiersPracticed: Record<EvidenceTier, boolean> = {
    recognition: false,
    recall: false,
    explanation: false,
  };
  const tiersSucceeded: Record<EvidenceTier, boolean> = {
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
  let topStageQualified = false;

  const records = indexEntries(entries).recordsByConcept.get(conceptId) ?? [];

  // `[D-281]` correction: "where a grade supersedes an earlier one, the later
  // grade wins in the projection." `revisionOf` names the event a corrective
  // re-grade replaces, so the replaced event stops supporting anything —
  // collected before the fold below so a correction recorded later in the log
  // still disqualifies the attempt it corrects, whatever order the records
  // arrive in (this fold has no total order and needs none).
  const supersededEventIds = new Set<string>();
  for (const record of records) {
    const revisionOf = record.explainBackGrade?.revisionOf;
    if (revisionOf !== undefined && revisionOf !== null) supersededEventIds.add(revisionOf);
  }
  for (const record of records) {
    tiersPracticed[evidenceTierOf(record.instrumentType)] = true;

    if (record.instrumentType === 'explain-back') {
      explainBackAttempts += 1;
      const grade = record.explainBackGrade;
      if (grade !== undefined) {
        gradedExplainBackCount += 1;
        if (deepestSoloLevel === null || soloRank(grade.soloLevel) > soloRank(deepestSoloLevel)) {
          deepestSoloLevel = grade.soloLevel;
        }
        // Same success test `qualifiesForTopStage` reads first — an
        // independent verdict of `correct`, absent reads as unknown and
        // never counts as demonstrated.
        if (grade.correctness === 'correct') tiersSucceeded.explanation = true;
        if (qualifiesForTopStage(record, grade, resolved, supersededEventIds)) {
          topStageQualified = true;
        }
      }
      continue;
    }

    scoredEventCount += 1;
    if (record.instrumentType === 'mcq') recognitionScoredCount += 1;
    if (isSuccessRating(record.rating)) {
      scoredSuccessCount += 1;
      tiersSucceeded[evidenceTierOf(record.instrumentType)] = true;
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
    tiersSucceeded,
    recognitionOnly: scoredEventCount > 0 && recognitionScoredCount === scoredEventCount,
    successfulScoredDays: successDays.size,
    deepestSoloLevel,
    depthGateCleared:
      deepestSoloLevel !== null && soloRank(deepestSoloLevel) >= soloRank(resolved.depthGate),
    topStageQualified,
  };
}

/**
 * **`[D-281]` / `ol-95vv.10`: the four pieces of qualifying evidence, all read
 * off the SAME attempt, plus correction.** The top growth stage claims that on
 * a specific occasion she explained the concept correctly and deeply, in her
 * own account of it — so no one of these is sufficient and all of them are
 * read together:
 *
 * 1. **Correctness** — the judge's INDEPENDENT verdict, persisted on the grade
 *    record (`explainBackGrade.correctness`). `'correct'` and nothing else:
 *    depth without correctness is a confident wrong answer, and a record
 *    written before the field existed carries no verdict and reads as
 *    **unknown, never as correct**.
 * 2. **Depth** — the structural assessment (`soloLevel`), produced blind to
 *    correctness and unchanged by this decision, at or above the depth
 *    threshold.
 * 3. **Assistance** — the support level actually shown at the time
 *    (`supportLevelShown`), admitted per `ADMITTED_SUPPORT_LEVELS`. Absent is
 *    unknown and does not permit the claim.
 * 4. **Instrument validity** — the instrument is not withdrawn, not rejected,
 *    and not built on evidence that has gone stale
 *    (`MasteryRollupOptions.invalidInstrumentIds`). Her acceptance of an
 *    instrument is not validity and is never read as such here.
 *
 * Plus correction: an attempt a later grade supersedes (`revisionOf`) supports
 * nothing, so a wrongly high grade that was afterwards corrected does not keep
 * the stage it was awarded in error.
 *
 * **This is the one place the stage is no longer a pure high-water mark**, and
 * deliberately so: `[D-281]` rules that a corrected judgement *replaces* the
 * one it corrects rather than sitting beside it. Every other predicate in this
 * fold is monotone as before, and nothing here lowers a stage for a lapse, a
 * fresh misconception or the passage of time — decay remains vitality's job.
 */
function qualifiesForTopStage(
  record: ReviewLogRecord,
  grade: NonNullable<ReviewLogRecord['explainBackGrade']>,
  resolved: ResolvedOptions,
  supersededEventIds: ReadonlySet<string>,
): boolean {
  if (grade.correctness !== 'correct') return false;
  if (soloRank(grade.soloLevel) < soloRank(resolved.depthGate)) return false;
  const support = record.supportLevelShown;
  if (support === undefined || !resolved.admittedSupportLevels.has(support)) return false;
  if (resolved.invalidInstrumentIds.has(record.instrumentId)) return false;
  if (supersededEventIds.has(record.eventId)) return false;
  return true;
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
  const resolved = resolveOptions(options);
  const { minSpacedRetrievalDays } = resolved;
  const evidence = conceptEvidence(entries, conceptId, resolved);

  // The high-water mark: the strongest stage any monotone predicate unlocks.
  // Each predicate can only turn from false to true as events are appended,
  // so the stage can only rise — R3's "no implementation may express decay by
  // lowering it", held by construction rather than by a later check.
  let state: MasteryState = 'seed';
  if (evidence.scoredEventCount > 0 || evidence.gradedExplainBackCount > 0) state = 'sprout';
  if (evidence.successfulScoredDays >= minSpacedRetrievalDays) state = 'sapling';
  // `[D-281]`: depth alone no longer grants the top stage — all four pieces of
  // qualifying evidence must sit on one un-superseded attempt.
  if (evidence.topStageQualified) state = 'tree';

  return { conceptId, state, evidence };
}

/** Every concept id at least one `kind: 'review'` entry in `entries` names. */
export function conceptIdsInLog(entries: readonly ReviewLogEntry[]): readonly string[] {
  return indexEntries(entries).conceptIds;
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
 *
 * Reads `entries` through `indexEntries`'s single-pass, cached grouping
 * (same one `conceptEvidence` uses) rather than scanning `entries` itself per
 * call — the fix for the O(concepts × log length) rescan `ol-95vv.9` found.
 */
export function conceptVitalityInstruments(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  replayed: ReplayResult,
): readonly VitalityInstrument[] {
  const types = indexEntries(entries).instrumentTypesByConcept.get(conceptId);
  if (types === undefined) return [];

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
