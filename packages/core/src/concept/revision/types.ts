/**
 * Types for `[CORP-3]` (`ol-2zfj.2`, component register row 1.4's second
 * duty) — the corpus stays live at the INSTRUMENT-CITATION grain, per
 * `[D-093]` / C5.3 ("When the source passage changes underneath an item",
 * `olea-service/features/F3-learn-from-anything.md`).
 *
 * **This directory is structurally separate from row 1.4's file-level
 * trigger** (`packages/plugin/src/ingestion/materiality/`), which already
 * runs live in production (`ol-2zfj.15`, `ol-2zfj.18`) and decides "does
 * this FILE say anything materially new." That question is necessary but
 * not sufficient for an instrument: a file can gain new material elsewhere
 * while one specific cited passage sits untouched, and a file's own
 * materiality verdict cannot tell a caller WHICH span moved. This module
 * answers the narrower question `[D-093]` actually asks of an item: did
 * THIS instrument's own cited passage change, and if so, does the change
 * carry a different claim.
 *
 * **The route is reused, never duplicated.** `RevisionJudgePort` below is
 * SHAPE-IDENTICAL to `packages/plugin/src/ingestion/materiality/types.ts`'s
 * `MaterialityJudge` (`judge({ previousText, currentText }) => Promise<{
 * material, reason? }>`), on purpose: the production adapter that already
 * satisfies that shape, `WorkerMaterialityJudge`
 * (`packages/plugin/src/ingestion/materiality/workerJudge.ts`), sends
 * `materiality.judge.v1` and needs no change to also satisfy this port —
 * only what text it is called with differs (a whole file there, one cited
 * passage here). No second task id, no second registered route, no second
 * prompt. A caller wiring this module in production passes the same
 * `WorkerMaterialityJudge` instance (or one built the same way) as its
 * `RevisionJudgePort`.
 *
 * **`RevisionEvent` is an IN-MEMORY shape only.** Nothing in this directory
 * writes one to the vault, the review log, or any other durable store — see
 * `material-change.ts`'s module doc for exactly which persisted shape this
 * would need and why building that persistence is a decision-bead gap
 * (Class C: a new event kind or field on a schema `packages/contracts` owns,
 * which this bead does not have standing to add unprompted).
 */

import type { Provenance } from '../../extract/types.js';
import type { EnqueueInput } from '../../ingestion/types.js';

/** Mirrors `MaterialityJudgeInput` (plugin) field-for-field — see this file's module doc. */
export interface RevisionJudgeInput {
  readonly previousText: string;
  readonly currentText: string;
}

/** Mirrors `MaterialityJudgeVerdict` (plugin) field-for-field. `reason` is content-free (D-005) — a short structural note, never her wording. */
export interface RevisionJudgeVerdict {
  readonly material: boolean;
  readonly reason?: string | undefined;
}

/**
 * The service seam this module calls through — structurally identical to
 * `MaterialityJudge` so the same `materiality.judge.v1` route serves both
 * (see module doc). Declared separately, rather than imported from the
 * plugin package, because `olea-core` never depends on `packages/plugin`
 * (the dependency runs the other way) — duplicating a two-method shape here
 * is cheaper than an import cycle, and the doc comment is what keeps the two
 * from drifting apart silently.
 */
export interface RevisionJudgePort {
  judge(input: RevisionJudgeInput): Promise<RevisionJudgeVerdict>;
}

/**
 * What this module produces when a cited passage's hash changes and the
 * judge is called — the bead's own words: "the instrument, the time, the
 * old and new content hashes, and the change that caused it."
 *
 * **Never persisted by this module.** `change` is the judge's content-free
 * `reason` (D-005) — never her wording, never the passage text itself.
 */
export interface RevisionEvent {
  readonly instrumentId: string;
  /** Epoch ms, from the caller's `Clock` — never `Date.now()` read directly (same discipline as `ingestion/types.ts`'s `Clock`). */
  readonly at: number;
  readonly oldContentHash: string;
  readonly newContentHash: string;
  /** The change that caused it — the judge's structural reason, or a fixed literal when the judge supplied none. */
  readonly change: string;
}

/**
 * The succession log event's LOGICAL shape — `[D-133]`'s second durable home
 * (`ol-w00s`), recording only the fact of succession: which instrument was
 * superseded, which instrument superseded it, and when. **Never a copy of the
 * predecessor chain** — the metadata-position `predecessor` field on the
 * successor's own instrument block (`packages/plugin/src/instrument-blocks/`)
 * is the single source of truth for the chain itself; this event exists so
 * "was this instrument superseded, and by what" is answerable from the log
 * alone, the same way `suspendLogRecordV5` already answers "was this
 * instrument suspended."
 *
 * **This is the in-memory shape this module can produce today.** Persisting
 * it needs a new review-log event kind in `packages/contracts/src/review-log.ts`
 * (a `successionLogRecordV5` shape, additive to `reviewLogEntryV5` the way
 * `verdict` was additive at v4/v5) plus a writer in
 * `packages/core/src/review-log/write.ts` (an `appendSuccessionRecord`
 * mirroring `appendSuspendRecord`'s shape) — both outside this bead's `owns`.
 * See `ol-w00s`'s close notes for the exact addition named.
 */
export interface SuccessionEvent {
  /** The instrument this succeeds — the same id `RevisionEvent.instrumentId` names for the 'revised' outcome that led here. */
  readonly predecessorInstrumentId: string;
  /** The freshly-materialized successor's own id, known only once it has been written to the vault and stamped (`ol-p3t07b`'s `stampMcqId`-shaped write, out of this module's reach — core holds no vault access). */
  readonly successorInstrumentId: string;
  /** Epoch ms, from the caller's `Clock` — same discipline as {@link RevisionEvent.at}. */
  readonly at: number;
}

/** One candidate location this passage's exact (or near-exact) text might now live at — supplied by the caller, never searched for by this module (core holds no vault access). */
export interface RelocationCandidate {
  readonly anchor: Provenance;
  readonly text: string;
}

/**
 * What the caller observed at the instrument's recorded citation anchor.
 * `'not-found'` means the anchor no longer resolves to that text — `[D-093]`
 * requires relocation to run BEFORE the passage is treated as stranded, so
 * this shape carries whatever relocation candidates the caller already has
 * in hand (an exact vault-wide text search, e.g.) rather than assuming the
 * caller has none.
 */
export type CurrentPassageState =
  | { readonly kind: 'found-at-anchor'; readonly text: string }
  | { readonly kind: 'not-found'; readonly relocationCandidates: readonly RelocationCandidate[] };

/** One instrument's cited passage, as observed now, against what was last recorded for it. */
export interface CitedPassageInput {
  readonly instrumentId: string;
  /** The passage text last recorded for this citation — never persisted by this module; the caller's projection. */
  readonly previousText: string;
  /** SHA-256 hex of `previousText` (same algorithm as `ingestion/hash.ts`'s `hashText`) — passed in rather than recomputed, so a caller that already has it never re-hashes. */
  readonly previousContentHash: string;
  readonly current: CurrentPassageState;
}

/**
 * Every outcome `evaluateCitedPassageRevision` can reach — one arm per
 * `[D-093]` clause, in the order the clause states them (relocate before
 * stranding; hash before judge; same claim before changed claim).
 *
 * - `'unchanged'` — the hash at the recorded anchor is identical; no signal
 *   to act on.
 * - `'relocated'` — an exact (whitespace-normalised) match was found
 *   elsewhere; the citation heals silently, no judge call, no
 *   {@link RevisionEvent} — "moving a paragraph is not an edit to its
 *   claim."
 * - `'relocation-proposed'` — only a near match was found; `[D-093]`
 *   forbids healing this silently, so the caller must surface a re-bind
 *   proposal (this module states the candidate; it does not itself write
 *   anything to any confirmation queue — see this file's module doc).
 * - `'stranded'` — no relocation candidate at all, exact or near. `[D-093]`
 *   does not name what happens next for this case; treated conservatively
 *   as "nothing this module decides alone" rather than inventing a rule.
 * - `'judge-unavailable'` — the hash changed (a real signal) but no judge
 *   was configured to read it — mirrors row 1.4's own `wiring.ts` grey-out
 *   contract exactly: never fabricate a verdict, never silently drop the
 *   change.
 * - `'refreshed'` — the judge read old and new text and found the same
 *   claim: the {@link RevisionEvent} is produced, and the caller refreshes
 *   the instrument's text in place, keeping its id and review history.
 * - `'revised'` — the judge found a changed claim: the
 *   {@link RevisionEvent} is produced, `predecessorInstrumentId` names the
 *   instrument to suspend (history preserved, per `review-log/write.ts`'s
 *   existing generic `suspend` — no new field needed there), and
 *   `successorEnqueueInput` is a ready `EnqueueInput` for the existing
 *   ingestion queue to draft the successor — nothing here writes it to any
 *   confirmation queue or vault file.
 */
export type CitedPassageRevisionOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'relocated'; readonly candidate: RelocationCandidate }
  | { readonly kind: 'relocation-proposed'; readonly candidate: RelocationCandidate }
  | { readonly kind: 'stranded' }
  | { readonly kind: 'judge-unavailable' }
  | { readonly kind: 'refreshed'; readonly event: RevisionEvent }
  | {
      readonly kind: 'revised';
      readonly event: RevisionEvent;
      readonly predecessorInstrumentId: string;
      readonly successorEnqueueInput: EnqueueInput;
    };

/**
 * F2.23 (`[D-265]`, ruling 3) — item validation. Types for
 * `item-validation.ts`'s mismatch trigger and defect-evidence list. See that
 * module's doc for the full sequence; this block is the shape only.
 *
 * **Evidence about the ITEM, never about her.** Every shape below describes
 * something suspected of the instrument (its key, its stem, its cited
 * source) or a fact about two instruments' same-day outcomes. None of them
 * is, or produces, a diagnosis, a state, or a judgement about the student —
 * the component register's own prohibition (`docs/Olea_architecture_boundary.md`
 * §4a): "measurement counts no offered help as used and no suspected cause
 * as observed." A caller that stores one of these against the STUDENT rather
 * than the item has misused this module.
 */

/**
 * F2.23's own five-item list, in the clause's own order — the only defect
 * categories a check may report. Deliberately closed (not a free-form
 * string): the clause enumerates exactly these, and a check that suspects
 * something outside the list has no route to say so through this shape,
 * which is the point — validation checks for one of these five, or it has
 * nothing to propose.
 */
export type ItemDefectEvidenceKind =
  | 'key-conflicts-with-source'
  | 'stem-satisfied-by-multiple-options'
  | 'missing-central-assumption'
  | 'corrupted-prompt-or-source'
  | 'superseded-material';

/**
 * The two same-day outcomes F2.23's mismatch trigger reads on an instrument
 * — nothing else about that day's attempt matters to this trigger. A
 * partial, ungraded, or otherwise ambiguous outcome is out of scope; a
 * caller folds its own richer outcome into one of these two before calling,
 * or does not call at all.
 */
export type SameDayInstrumentOutcome = 'strong' | 'failed';

/**
 * What `evaluateItemValidationTrigger` needs to decide whether F2.23's
 * mismatch PRECONDITION holds — not whether a defect exists, only whether
 * the model may be asked to check. `sameClaim` and `sameDay` arrive already
 * decided by the caller (this module never reads the vault or a claim graph
 * — same discipline as `relocate.ts`'s candidate texts, supplied rather than
 * searched for): whether two instruments "concern the same claim" is a
 * judgement this module has no standing to make on its own.
 */
export interface SameClaimMismatchInput {
  readonly harderInstrumentId: string;
  readonly harderOutcome: SameDayInstrumentOutcome;
  readonly easierInstrumentId: string;
  readonly easierOutcome: SameDayInstrumentOutcome;
  readonly sameDay: boolean;
  readonly sameClaim: boolean;
}

/**
 * `'no-trigger'` covers both an ordinary lapse (the clause's own first
 * scenario: "forgetting happens and is not itself evidence of a problem")
 * and a mismatch that fails `sameDay`/`sameClaim` — this trigger names no
 * distinction between them because the clause draws none: either the
 * precondition holds or ordinary failure handling proceeds.
 */
export type ItemValidationTriggerOutcome =
  | { readonly kind: 'no-trigger' }
  | { readonly kind: 'check-warranted'; readonly suspectInstrumentId: string };

/**
 * What the model is asked to read when a check is warranted — the suspected
 * instrument's own text and the source it cites. Nothing about her or her
 * history: F2.23's suspicion is about the item, and this is the whole input
 * a check needs to evaluate it.
 */
export interface ItemValidationJudgeInput {
  readonly instrumentText: string;
  readonly citedSourceText: string;
}

/**
 * `kind` is populated only when `suspected` is true, and is always one of
 * {@link ItemDefectEvidenceKind} — never a free-form diagnosis. `reason` is
 * content-free (D-005): a short structural note, never her wording and
 * never the passage text itself.
 */
export interface ItemValidationJudgeVerdict {
  readonly suspected: boolean;
  readonly kind?: ItemDefectEvidenceKind | undefined;
  readonly reason?: string | undefined;
}

/**
 * The service seam `checkItemValidation` calls through — same shape
 * discipline as `RevisionJudgePort` above: declared rather than imported so
 * `olea-core` takes on no new dependency, kept in lockstep with its caller
 * by this doc comment rather than a shared import.
 */
export interface ItemValidationJudgePort {
  judge(input: ItemValidationJudgeInput): Promise<ItemValidationJudgeVerdict>;
}

/**
 * What `checkItemValidation` produces on a suspected defect — always a
 * PROPOSAL, never a verdict on the item's eligibility. F2.23 is explicit
 * that validation itself never changes eligibility or moves weight: only
 * `[D-093]`'s changed-evidence event, `[D-095]`'s contest mechanism, or her
 * own confirmation may do that. This shape carries nothing else — no weight
 * adjustment, no growth-stage change, no state about the student — because
 * this module has no route to write any of those (`core` holds no such
 * state) and none should be added here even if it did.
 */
export interface ItemValidationProposal {
  readonly instrumentId: string;
  readonly kind: ItemDefectEvidenceKind;
  /** Epoch ms, from the caller's `Clock` — same discipline as {@link RevisionEvent.at}. */
  readonly at: number;
  readonly reason?: string | undefined;
}

/**
 * Every outcome `checkItemValidation` can reach.
 *
 * - `'no-trigger'` — the mismatch precondition did not hold; ordinary
 *   failure handling applies and nothing here runs.
 * - `'not-suspected'` — the precondition held and the judge was asked, but
 *   it found no defect; the item's weight and eligibility are untouched,
 *   same as `'no-trigger'`.
 * - `'judge-unavailable'` — the precondition held but no judge was
 *   configured — mirrors `CitedPassageRevisionOutcome`'s own
 *   `'judge-unavailable'` arm: never fabricate a verdict, never silently
 *   drop the signal.
 * - `'proposed'` — the judge suspects one of F2.23's five defect kinds. This
 *   is a PROPOSAL for her to confirm, not a decision; nothing about the
 *   item's weight, eligibility or growth stage moves as a result of this
 *   outcome alone.
 */
export type ItemValidationOutcome =
  | { readonly kind: 'no-trigger' }
  | { readonly kind: 'not-suspected' }
  | { readonly kind: 'judge-unavailable' }
  | { readonly kind: 'proposed'; readonly proposal: ItemValidationProposal };
