/**
 * C5.4 — the mastery rollup: concept mastery as a pure projection of the
 * review log (P4-T06, R7, §7.1, R3).
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
 * concept**, and "parent" means **the concept**. A concept whose evidence
 * disagrees sharply (some instruments solid, some failing) is exactly the
 * "children disagree" case this module has to get right — see this file's
 * spec for that scenario.
 *
 * ## Why a weighted recency window, not `min`, not a continuous decay curve
 *
 * Three shapes were on the table (per this task's brief):
 *
 * - **`min` over instruments** — rejected. R7 states evidence is *weighted*,
 *   not that the weakest instrument governs the whole concept. A concept
 *   drilled solidly by three cards and only shakily by a fourth is not "as
 *   bad as its worst card" — F2.11's "shaky: recalled sometimes, missed
 *   sometimes" is a statement about a *rate*, which `min` cannot express (it
 *   can only ever say "at least one full miss exists").
 * - **A continuous decay curve (half-life weighting)** — rejected for v0.9.
 *   R3 explicitly reserves forgetting-curve modelling to FSRS, at the
 *   instrument level ("do not run FSRS at concept level" — a decay curve
 *   *is* a forgetting model). Nothing in the knowledge model or the amendment
 *   states a half-life, a weighting function, or even that mastery should
 *   decay with elapsed wall-clock time at all — inventing one would be
 *   inventing authority the contract does not carry. See "recency and
 *   forgetting", below, for the stronger architectural reason this also had
 *   to be rejected regardless of the contract question.
 * - **A weighted recent-evidence rate, bucketed into the five named states**
 *   — adopted. R7's own language is a rate ("recalled *more often than
 *   not*, and recently"), and F2.11's five words read as a rate's five
 *   buckets: no evidence · mixed · mostly-recalled-recently ·
 *   reliable-across-spaced-attempts · produced-or-explained-at-least-once.
 *   A bounded recent-evidence window is the simplest shape that can express
 *   "recently" without a wall-clock dependency (below), is auditable event
 *   by event, and needs no unjustified decay constant.
 *
 * ## Recency and forgetting: what enters, and what deliberately does not
 *
 * **Recency enters as a window over the evidence sequence, not over
 * wall-clock time.** `computeConceptMastery` takes no `now`. "Recent" means
 * "at the end of this concept's own evidence, in the log" — the last
 * `recentWindowSize` scored events — never "within N real days of whenever
 * this function happens to run." This is not a stylistic choice; it is
 * required by this task's own rebuild-from-log-equivalence property. §7.1
 * says mastery is "deterministically recomputed from the event log" — if
 * recency were wall-clock-relative, projecting the *same* log at two
 * different real moments would produce two different mastery states with no
 * new event between them, which is not a deterministic function of the log
 * any more. A pure function of `entries` alone is what makes "project,
 * discard, re-project" provably identical regardless of when either
 * projection happens to run.
 *
 * **Forgetting (the FSRS sense — retrievability decaying between reviews) is
 * not modelled here at all.** R3 assigns that to the scheduler, per
 * instrument, where lapse history actually lives (`../scheduler/`). This
 * module never asks "how stale is this evidence in real time"; it only asks
 * "what does the tail of what actually happened say." Consequence, stated
 * plainly: a concept she has not touched in six months reads exactly as it
 * did the day she stopped — mastery here moves only on new events, never on
 * elapsed time alone. That is a deliberate reading of an authority-silent
 * question (the contract never says mastery should decay by itself), and it
 * is the reading consistent with R3 and with §7.1's purity requirement; it
 * is recorded as a Class B default in this task's report, reversible if
 * David wants wall-clock staleness surfaced later (e.g. as a *separate*,
 * explicitly time-stamped "evidence is N days old" fact alongside the state,
 * never folded into the state itself without a new decision).
 *
 * ## The five states, as evidence rules (F2.11, R7, D-017)
 *
 * 1. **`new`** — no scored evidence at all for this concept.
 * 2. **`shaky`** — some scored evidence exists; the recent success rate is
 *    at or below `MID_SUCCESS_RATE`. F2.11's own words are "recalled
 *    *sometimes*, missed sometimes" — read as at most half, not just under
 *    half, so an exact coin-flip record reads as `shaky`, not `coming`. This
 *    is also the floor once *any* evidence exists — the vocabulary has no
 *    state below `shaky` other than `new`, so a run of outright misses
 *    still reads as `shaky`, not as a sixth, worse word the product does
 *    not have.
 * 3. **`coming`** — recent success rate strictly above `MID_SUCCESS_RATE`,
 *    below `HIGH_SUCCESS_RATE`; or a `HIGH_SUCCESS_RATE` run that has not
 *    yet happened on enough distinct days (see below) — a good streak
 *    crammed into one sitting reads as `coming`, not `solid`.
 * 4. **`solid`** — recent success rate at or above `HIGH_SUCCESS_RATE`,
 *    **and** spread across at least `minSpacedDays` distinct calendar days
 *    within that same recent window ("recalled reliably *across spaced
 *    attempts*" — R7). This is also the ceiling for any concept whose
 *    scored evidence is recognition-only (MCQ) — R7's named rule and this
 *    task's named test.
 * 5. **`yours`** — everything `solid` requires, **and** the recent window
 *    contains at least one *recall* success: a Q&A or cloze review she
 *    answered without failing (`rating !== 'again'`). Recognition (MCQ)
 *    never counts, however many times it succeeds — R7 in its own words:
 *    "recognising a definition among four options five times is not the
 *    same knowledge as producing it once."
 *
 * ## Explain-back: recorded, not yet scored — a contract gap, not a choice
 *
 * The review log can carry an `instrumentType: 'explain-back'` review event,
 * but `rating` is `null` for it by schema (F2.16 — explain-back "produces no
 * rating"), and **the record has no field of any kind for the grading
 * verdict** (omissions/errors/confusions) that P4-T02's grading pipeline is
 * meant to produce. R7 says the top state requires "at least one *recent
 * recall or explanation success*" — the word is success, not attempt, and
 * an attempt with an unknown outcome is not evidence of success. So an
 * explain-back review event is counted here (`explainBackAttempts`,
 * `tiersPracticed.explanation`) but never enters the scored evidence
 * `recognitionOnly` and the success-rate window are computed over — it is
 * neither a recognition success nor a recall success, so it does **not**,
 * on its own, lift a recognition-only concept's cap or satisfy the `yours`
 * gate — only a recall success does today. **This is a contract
 * silence this module had to resolve, not a modelling preference**: once
 * P4-T02 wires a real per-attempt outcome into the log (or into transient
 * D-008 context), the honest fix is to let a *successful* explain-back also
 * satisfy the gate, matching a recall success. Filed as a follow-up rather
 * than guessed at here, because widening what counts as "success" for
 * `yours` is exactly the kind of threshold this project reserves for a
 * decision bead, never a lane's silent call.
 *
 * ## Purity and rebuildability
 *
 * Every export here is a pure function of its `entries` argument (and the
 * explicit `conceptId`/options it is given) — no clock, no I/O, no module
 * state. `entries` is assumed already at the current schema version (v4):
 * this module never reads `schemaVersion` itself, matching every other
 * log-folding module in core (`../today/streak.ts`, `../review-log/suspension.ts`)
 * — the caller reads the log through `../review-log/parse.ts` (which
 * migrates through `upgrade.ts` before anything downstream sees a record)
 * and hands the result here. That is what makes "discard the projection and
 * recompute it from the log" the whole rebuild story: there is no cache
 * inside this module for a rebuild to disagree with.
 */

import type {
  InstrumentType,
  MasteryAtTime,
  MasteryState,
  Rating,
  ReviewLogEntry,
} from 'olea-contracts';
import { calendarDayOfTimestamp } from '../today/calendar-day.js';

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

/**
 * Tunable parameters for `computeConceptMastery`. Every default below is
 * **provisional** (Class B, this task's report) — v0.9 has never had a real
 * review logged against it, so none of these can be, or should be, tuned
 * from data yet, and `eval/CLAUDE.md` forbids tuning any threshold from
 * synthetic data even once that changes. Ratifying them needs a real
 * semester of her review log, read against how the states actually felt to
 * her, and goes through a decision bead like every other threshold that
 * decides what she sees.
 */
export interface MasteryRollupOptions {
  /**
   * How many of a concept's most recent *scored* events (recall or
   * recognition; explain-back is never scored — see module doc) form the
   * evidence window the success rate and the spacing check are computed
   * over. Default 5 — chosen only as "a handful of attempts", not measured.
   */
  readonly recentWindowSize?: number;
  /**
   * Recent success rate strictly above this promotes `shaky` to `coming`;
   * at or below, it stays `shaky`. Default 0.5 — "more often than not"
   * (R7) read literally, so an exact half does not yet qualify.
   */
  readonly midSuccessRate?: number;
  /**
   * Recent success rate at or above this is eligible for `solid` (subject
   * to the spacing check). Default 0.8 — unmeasured; picked only to sit
   * clearly above `midSuccessRate`.
   */
  readonly highSuccessRate?: number;
  /**
   * Minimum distinct calendar days within the recent window required to
   * confirm `solid` instead of demoting a high-success but single-sitting
   * run to `coming`. Default 3 — unmeasured; the smallest number that is
   * unambiguously more than "she reviewed it a few times just now."
   */
  readonly minSpacedDays?: number;
}

const DEFAULT_RECENT_WINDOW_SIZE = 5;
const DEFAULT_MID_SUCCESS_RATE = 0.5;
const DEFAULT_HIGH_SUCCESS_RATE = 0.8;
const DEFAULT_MIN_SPACED_DAYS = 3;

interface ResolvedOptions {
  readonly recentWindowSize: number;
  readonly midSuccessRate: number;
  readonly highSuccessRate: number;
  readonly minSpacedDays: number;
}

function resolveOptions(options: MasteryRollupOptions | undefined): ResolvedOptions {
  const recentWindowSize = options?.recentWindowSize ?? DEFAULT_RECENT_WINDOW_SIZE;
  const midSuccessRate = options?.midSuccessRate ?? DEFAULT_MID_SUCCESS_RATE;
  const highSuccessRate = options?.highSuccessRate ?? DEFAULT_HIGH_SUCCESS_RATE;
  const minSpacedDays = options?.minSpacedDays ?? DEFAULT_MIN_SPACED_DAYS;
  if (!Number.isInteger(recentWindowSize) || recentWindowSize < 1) {
    throw new Error(
      `computeConceptMastery: recentWindowSize must be a positive integer, got ${recentWindowSize}`,
    );
  }
  if (!Number.isInteger(minSpacedDays) || minSpacedDays < 1) {
    throw new Error(
      `computeConceptMastery: minSpacedDays must be a positive integer, got ${minSpacedDays}`,
    );
  }
  if (!(midSuccessRate >= 0 && midSuccessRate <= 1)) {
    throw new Error(
      `computeConceptMastery: midSuccessRate must be within [0, 1], got ${midSuccessRate}`,
    );
  }
  if (!(highSuccessRate >= midSuccessRate && highSuccessRate <= 1)) {
    throw new Error(
      `computeConceptMastery: highSuccessRate must be within [midSuccessRate, 1], got ${highSuccessRate}`,
    );
  }
  return { recentWindowSize, midSuccessRate, highSuccessRate, minSpacedDays };
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
  /** Explain-back review events for this concept. Recorded; never scored — see module doc. */
  readonly explainBackAttempts: number;
  /** Every R7 tier at least one scored-or-attempted event for this concept demonstrated. */
  readonly tiersPracticed: Readonly<Record<EvidenceTier, boolean>>;
  /** True when every scored event is recognition (MCQ) — the state can never exceed `solid`. */
  readonly recognitionOnly: boolean;
  /** Size of the recent-evidence window actually used (capped by how much scored evidence exists). */
  readonly recentWindowSize: number;
  /** Successes ÷ window size over the recent window; `null` when there is no scored evidence. */
  readonly recentSuccessRate: number | null;
  /** Distinct calendar days the recent window's events fall on. */
  readonly recentDistinctDays: number;
  /** At least one recall (Q&A/cloze) success inside the recent window — the `yours` gate. */
  readonly recentRecallSuccess: boolean;
}

/** One concept's rolled-up mastery: the state, and the evidence it was read from. */
export interface ConceptMasteryResult {
  readonly conceptId: string;
  readonly state: MasteryState;
  readonly evidence: ConceptMasteryEvidence;
}

interface ScoredEvent {
  readonly instant: number;
  readonly eventId: string;
  readonly instrumentType: InstrumentType;
  readonly success: boolean;
  readonly day: string | null;
}

/** Deterministic order, matching `../review-log/merge.ts`'s own tiebreak — see module doc. */
function byInstantThenEventId(
  a: { instant: number; eventId: string },
  b: { instant: number; eventId: string },
): number {
  if (a.instant !== b.instant) return a.instant - b.instant;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/**
 * Folds `entries` into every review event that is evidence for `conceptId`
 * (D-031/`ol-t3sd`: many-to-many, so one event is evidence for every concept
 * its `conceptIds` names — this reads that list, never a singular field).
 * Suspend/unsuspend events are excluded, matching `../today/streak.ts`:
 * stopping study of something is not evidence about what she knows.
 */
function conceptScoredEvents(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
): {
  scored: readonly ScoredEvent[];
  explainBackAttempts: number;
  tiersPracticed: Record<EvidenceTier, boolean>;
} {
  const scored: ScoredEvent[] = [];
  let explainBackAttempts = 0;
  const tiersPracticed: Record<EvidenceTier, boolean> = {
    recognition: false,
    recall: false,
    explanation: false,
  };

  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (!entry.conceptIds.includes(conceptId)) continue;

    const tier = evidenceTierOf(entry.instrumentType);
    tiersPracticed[tier] = true;

    if (entry.instrumentType === 'explain-back') {
      explainBackAttempts += 1;
      continue;
    }

    const instant = Date.parse(entry.timestamp);
    scored.push({
      instant,
      eventId: entry.eventId,
      instrumentType: entry.instrumentType,
      success: isSuccessRating(entry.rating),
      day: calendarDayOfTimestamp(entry.timestamp),
    });
  }

  scored.sort(byInstantThenEventId);
  return { scored, explainBackAttempts, tiersPracticed };
}

/**
 * Rolls up one concept's mastery from the review log — the pure C5.4
 * projection. Same `entries` and `conceptId` always give the same answer;
 * nothing is written, nothing is cached, nothing consults a clock. See this
 * module's doc for the full argument.
 */
export function computeConceptMastery(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  options?: MasteryRollupOptions,
): ConceptMasteryResult {
  if (conceptId.length === 0) {
    throw new Error('computeConceptMastery: conceptId must be non-empty');
  }
  const { recentWindowSize, midSuccessRate, highSuccessRate, minSpacedDays } =
    resolveOptions(options);
  const { scored, explainBackAttempts, tiersPracticed } = conceptScoredEvents(entries, conceptId);

  const recognitionOnly = scored.length > 0 && scored.every((e) => e.instrumentType === 'mcq');

  if (scored.length === 0) {
    return {
      conceptId,
      state: 'new',
      evidence: {
        scoredEventCount: 0,
        explainBackAttempts,
        tiersPracticed,
        recognitionOnly: false,
        recentWindowSize: 0,
        recentSuccessRate: null,
        recentDistinctDays: 0,
        recentRecallSuccess: false,
      },
    };
  }

  const windowSize = Math.min(recentWindowSize, scored.length);
  const window = scored.slice(scored.length - windowSize);

  const successes = window.filter((e) => e.success).length;
  const recentSuccessRate = successes / window.length;

  const recentDistinctDays = new Set(
    window.map((e) => e.day).filter((d): d is string => d !== null),
  ).size;

  const recentRecallSuccess = window.some((e) => e.instrumentType !== 'mcq' && e.success);

  let state: MasteryState;
  if (recentSuccessRate <= midSuccessRate) {
    state = 'shaky';
  } else if (recentSuccessRate < highSuccessRate) {
    state = 'coming';
  } else if (recentDistinctDays < minSpacedDays) {
    // A high recent rate crammed into too few sessions reads as `coming`,
    // never `solid` — R7's "across spaced attempts", read literally.
    state = 'coming';
  } else if (recentRecallSuccess) {
    state = 'yours';
  } else {
    state = 'solid';
  }

  // Belt-and-suspenders, and this task's named acceptance test: a concept
  // whose *entire* scored history is recognition-only can never read as
  // `yours`, however this branch's arithmetic came out. Mechanically this is
  // already implied by `recentRecallSuccess` being false whenever
  // `recognitionOnly` is true over the full history and the window is a
  // suffix of it, but the rule is asserted directly rather than left to
  // follow from that coincidence.
  if (recognitionOnly && state === 'yours') {
    state = 'solid';
  }

  return {
    conceptId,
    state,
    evidence: {
      scoredEventCount: scored.length,
      explainBackAttempts,
      tiersPracticed,
      recognitionOnly,
      recentWindowSize: windowSize,
      recentSuccessRate,
      recentDistinctDays,
      recentRecallSuccess,
    },
  };
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
