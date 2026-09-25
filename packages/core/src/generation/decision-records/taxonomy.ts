/**
 * `[IL-D4]` (`ol-2zfj.143`) — inspectable per-stage decision records and a failure taxonomy.
 *
 * Plan D4 (`docs/archive/direction/2026-09-21-plan-intelligence-layer-after-review.md`, item D4,
 * row 3.11): "Narrow per-stage types carrying the review's §12 fields; internal outcomes
 * distinguished (missing evidence, conflicting evidence, provider failure, stale inputs, privacy
 * refusal), each mapped to a named action." The five-way taxonomy itself is the external review's
 * own words (`docs/archive/direction/2026-09-21-external-review-intelligence-layer.md` §7,
 * "Retrieval and grounding"): "Internally, distinguish missing evidence, ambiguous or conflicting
 * evidence, provider failure, stale inputs and privacy refusal ... Connect each internal outcome
 * to a named action."
 *
 * **Deliberately generic over "stage."** The review's §7 text is about retrieval/grounding
 * specifically, but the plan's D4 item generalises it to "per-stage" — any step in a chain that
 * can fail for one of these five reasons gets the same closed vocabulary and the same
 * inspectable record shape, rather than each stage inventing its own outcome names. `stage` is an
 * opaque caller-supplied label (a task id, per D7.3 — this module stamps no prompt version or
 * model identity itself; a caller that ran a model attaches that separately, this module only
 * classifies the outcome once the caller already knows what happened).
 *
 * **Five outcomes, five actions — a fixed table, never inferred.** Mirrors this package's own
 * existing classifiers (`../authoring-outcome.ts`'s `classifyAuthoringOutcome`,
 * `../../stage-contract/decision.ts`'s envelope): a lookup table, not a heuristic, so the mapping
 * is auditable by reading the table rather than by tracing branches.
 *
 * - `missing-evidence` -> `defer-insufficient`: nothing to decide from (`[D-289]`'s own reading of
 *   an empty package — never a verdict about her material, an operational deferral).
 * - `conflicting-evidence` -> `escalate-for-review`: the evidence disagrees with itself; a single
 *   pass should not silently pick a side.
 * - `provider-failure` -> `retry-later`: transient, operational, retryable — the same class
 *   `../authoring-outcome.ts` already reads `'draft-error'`/`'unparseable'` into.
 * - `stale-inputs` -> `surface-for-recheck`: the inputs moved under an outstanding request (the
 *   citation store's `'stale'` freshness reading, `../../instrument/citation-store.ts`, is one
 *   concrete source of this outcome for a generated instrument specifically).
 * - `privacy-refusal` -> `refuse-silently`: INV-3's own posture — a refusal on privacy grounds is
 *   never surfaced as a defect or a retry prompt, and never logged with content (D-005).
 *
 * **This module never calls a model and never decides which of the five outcomes occurred** — a
 * caller that ran a stage and observed what happened classifies it. `classifyStageFailure` is a
 * pure lookup, total over {@link StageFailureKind}.
 */

/**
 * The review's five-way internal-outcome taxonomy (§7), generalised to any stage (plan D4). A
 * closed set: a caller with a sixth kind of failure names one of these five, or the failure is not
 * yet in scope for this taxonomy — never a free-text sixth value.
 */
export type StageFailureKind =
  | 'missing-evidence'
  | 'conflicting-evidence'
  | 'provider-failure'
  | 'stale-inputs'
  | 'privacy-refusal';

export const STAGE_FAILURE_KINDS: readonly StageFailureKind[] = [
  'missing-evidence',
  'conflicting-evidence',
  'provider-failure',
  'stale-inputs',
  'privacy-refusal',
];

/**
 * The named action each {@link StageFailureKind} maps to — see the module doc's table. Never
 * student-facing wording (this module produces no copy at all): a rendering surface reads the
 * action to decide WHAT TO DO, and owns its own words for what she sees, exactly as
 * `../../misconception/confusion-routing.ts`'s module doc keeps "what the offer says" separate
 * from "whether to offer."
 */
export type StageFailureAction =
  | 'defer-insufficient'
  | 'escalate-for-review'
  | 'retry-later'
  | 'surface-for-recheck'
  | 'refuse-silently';

const STAGE_FAILURE_ACTION: Readonly<Record<StageFailureKind, StageFailureAction>> = {
  'missing-evidence': 'defer-insufficient',
  'conflicting-evidence': 'escalate-for-review',
  'provider-failure': 'retry-later',
  'stale-inputs': 'surface-for-recheck',
  'privacy-refusal': 'refuse-silently',
};

/**
 * One inspectable per-stage decision record — the plan D4 shape: which stage, what internal
 * outcome it produced, and the named action that outcome maps to. `at` is the caller's own clock
 * reading (this module reads no clock itself, matching `../../concept/revision/item-validation.ts`'s
 * "the caller's `Clock.now()`, never `Date.now()` read here" discipline).
 */
export interface StageDecisionRecord {
  /** Opaque caller-supplied stage/task label — never her content, never a display name (D-005). */
  readonly stage: string;
  readonly outcome: StageFailureKind;
  readonly action: StageFailureAction;
  readonly at: number;
}

/**
 * Classifies one stage's internal failure into its named action and returns the inspectable
 * record. Pure and total over {@link StageFailureKind} — every one of the five outcomes has an
 * entry in the table, so this never falls through to a default.
 */
export function classifyStageFailure(
  stage: string,
  outcome: StageFailureKind,
  at: number,
): StageDecisionRecord {
  return { stage, outcome, action: STAGE_FAILURE_ACTION[outcome], at };
}
