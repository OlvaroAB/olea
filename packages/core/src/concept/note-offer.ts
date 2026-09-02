/**
 * The offer-to-create-a-note gate (knowledge model §3, *Amended Sep 2026 —
 * `[D-176]`*; `docs/Olea_alpha_functional_scope.md` F4.2's matching
 * cross-reference sentence; decision bead `ol-2jod.20`/[D-176/IDN-2]; surface
 * bead `ol-r1by`).
 *
 * The ratified clause: *"Where a derived concept has accepted instruments,
 * has been reviewed at least once, and sits in the top band of its course's
 * high-yield ranking (F4.2), Olea may OFFER to create a note for it in her
 * Zettelkasten."* All three, so the offer stays rare (D-176's own words) —
 * this module is exactly that three-way check, and nothing else. It does
 * not decide WHETHER a concept is derived-only (that is `ConceptRecord.tier`
 * / `RegistryConceptEntry.tier` — a concept already at tier 1 has an
 * authored note and the caller should never reach this gate for it), it
 * does not render the offer, and it does not create the note. It answers
 * one question: given a concept and the evidence already computed
 * elsewhere, may Olea offer.
 *
 * **Reuse, never recompute.** Each condition reads a field another module
 * already produced — no scoring, no re-derivation:
 *
 *   - **"has accepted instruments"** reads the vault-instrument records
 *     already filed under this concept's key (`session/enumerate.ts` /
 *     `study-session/instrument-index.ts`'s `ConceptInstrumentIndex`). A
 *     record existing here already means it survived F2.10's own
 *     offer/accept lifecycle for INSTRUMENTS (a different object from this
 *     module's note-offer — the decision bead is explicit the two do not
 *     collide) — so "accepted" is simply this list being non-empty. Pruned
 *     (F8.5-withdrawn) instruments still count: pruning is a queue-
 *     visibility flag, never an "un-accept" — `RegistryConceptEntry`'s own
 *     doc is explicit that prune state does not change what the underlying
 *     record computes from.
 *   - **"has been reviewed at least once"** reads
 *     `ConceptMasteryResult.evidence.scoredEventCount` (`mastery/rollup.ts`,
 *     already computed by `computeConceptMastery`). The decision bead's own
 *     phrasing is "at least one FSRS review cycle" — a SCORED event — so
 *     `explainBackAttempts` alone does not satisfy this condition:
 *     `rollup.ts`'s module doc is explicit that explain-back is "recorded;
 *     never scored". A concept with no mastery entry at all (never joined,
 *     or never appearing in the log) reads as zero, never as a silent pass.
 *   - **"sits in the top band of the F4.2 high-yield ranking for its
 *     course"** reads `CourseOracleRanking` — `rankOracle`'s (F4.2) own,
 *     already-computed output — and nothing here re-scores a concept or
 *     re-derives `ConceptPriority.priorityScore`. What this module DOES add
 *     is the only thing F4.2 does not itself expose: a partition of its
 *     ordering into a "top band". Neither `rank.ts`/`oracle/types.ts` nor
 *     `gap/build.ts` (which re-sorts the same ranking by a *different*,
 *     readiness-weighted score — see that module's doc — and is therefore
 *     the wrong ranking to read this condition from) define a band today,
 *     so `TOP_BAND_DIVISOR` below is this bead's own DECLARED, Class B,
 *     unratified constant, not a re-statement of one that already existed.
 *     A concept the ranking abstained on, or vetoed away entirely (so it
 *     never appears in `ranked`), is never in the top band — there is
 *     nothing to sit in.
 */

import type { ConceptMasteryResult } from '../mastery/rollup.js';
import type { CourseOracleRanking } from '../oracle/types.js';
import type { VaultInstrumentRecord } from '../session/types.js';

/**
 * DECLARED (Class B, unratified — run charter's ladder, `docs/
 * Olea_v09_implementation_plan.md` §2.7-adjacent Class B: "non-persisted
 * enum/vocabulary choices, threshold tunings"). **Plain-English defense:**
 * neither the ratified clause nor F4.2's own definition says how many
 * partitions "band" implies or how wide the top one is — this bead is the
 * first to make "top band" concrete and testable, and a three-way split
 * (top third / middle third / bottom third) is a plain, undebatable reading
 * of "band" that needs no corpus to defend, in the same spirit as this
 * package's other DECLARED constants (`oracle/rank.ts`'s
 * `DECLARED_FALLBACK_*`). It is not fitted, and it is not a stand-in for a
 * derived number — there is no derived number to approximate, because
 * nothing has ever measured what width of "top" actually correlates with a
 * concept she goes on to author a note for. Flagged for retroactive review
 * per the run charter; revisit once a semester of real offer/accept/decline
 * data exists to inform it.
 */
const TOP_BAND_DIVISOR = 3;

/** The concept `noteOfferEligible` is asked about. */
export interface NoteOfferConcept {
  /** The opaque join key (`[D-088]`/`[D-109]`) — what `evidence.mastery` and `evidence.ranking`'s entries are keyed/joined on. Never a display name (R2). */
  readonly conceptKey: string;
}

/** Everything `noteOfferEligible` reads, gathered by the caller from machinery this module never re-runs. */
export interface NoteOfferEvidence {
  /**
   * Every vault-instrument record filed under this concept
   * (`ConceptInstrumentIndex.instrumentsFor(conceptKey)`, or an equivalent
   * per-concept slice) — presence here is the "accepted" fact; see this
   * module's doc for why pruned records still count.
   */
  readonly instruments: readonly VaultInstrumentRecord[];
  /**
   * This concept's rolled-up mastery result (`computeConceptMastery`,
   * `mastery/rollup.ts`), or `undefined` when no mastery entry exists for
   * this concept at all (never reviewed, or mastery was not joined).
   */
  readonly mastery: ConceptMasteryResult | undefined;
  /**
   * This concept's COURSE ranking from `rankOracle` (F4.2), unmodified —
   * the caller picks the ranking for the course the offer is being
   * evaluated against (a concept naming more than one course, C7.2, has one
   * ranking per course; this gate answers the question for exactly one).
   */
  readonly ranking: CourseOracleRanking;
}

/** The three conditions, individually inspectable, plus the combined verdict — never asserted as a bare boolean, matching this codebase's "reasoning must be inspectable" convention (`oracle/types.ts`'s `OracleConceptFactors` is the same posture one layer up). */
export interface NoteOfferVerdict {
  /** `hasAcceptedInstruments && hasBeenReviewed && inTopBand` — the whole gate, per the ratified clause's "All three". */
  readonly eligible: boolean;
  readonly hasAcceptedInstruments: boolean;
  readonly hasBeenReviewed: boolean;
  readonly inTopBand: boolean;
}

/**
 * The whole of `[D-176]`'s trigger, and nothing else. Pure — INV-1/§7.1: no
 * vault I/O, no clock, no network, same inputs in, same verdict out.
 */
export function noteOfferEligible(
  concept: NoteOfferConcept,
  evidence: NoteOfferEvidence,
): NoteOfferVerdict {
  const hasAcceptedInstruments = evidence.instruments.length > 0;
  const hasBeenReviewed = (evidence.mastery?.evidence.scoredEventCount ?? 0) > 0;
  const inTopBand = isInTopBand(concept.conceptKey, evidence.ranking);
  return {
    eligible: hasAcceptedInstruments && hasBeenReviewed && inTopBand,
    hasAcceptedInstruments,
    hasBeenReviewed,
    inTopBand,
  };
}

/**
 * `ranking.ranked` is already sorted best-first (`rank.ts`: 1-based,
 * ascending, lower is higher-priority) — the top band is the leading
 * `ceil(ranked.length / TOP_BAND_DIVISOR)` entries, floored at 1 so a
 * course with any ranking at all always has a non-empty top band. A course
 * that abstained, or a concept every one of whose edges was vetoed (so it
 * never appears in `ranked` at all — see `OracleVetoedConcept`), is never
 * in the top band: there is no ranking to sit in.
 */
function isInTopBand(conceptKey: string, ranking: CourseOracleRanking): boolean {
  if (ranking.status !== 'ranked') return false;
  const entry = ranking.ranked.find((candidate) => candidate.conceptKey === conceptKey);
  if (entry === undefined) return false;
  const cutoff = Math.max(1, Math.ceil(ranking.ranked.length / TOP_BAND_DIVISOR));
  return entry.rank <= cutoff;
}
