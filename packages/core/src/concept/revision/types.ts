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
