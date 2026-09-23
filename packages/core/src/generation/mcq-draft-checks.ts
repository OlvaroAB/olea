/**
 * Exact MCQ checks (`docs/dev/intelligence-build/pra.md` §2's "exact checks:
 * shape, distinct options, floor, ... presentation compatibility", `[ILB-PRA-4]`).
 *
 * **Pure, total, no I/O.** Same posture as `../retrieval/draftingEligibility.ts`:
 * a code stage that runs before any risk-selected (bounded-decision) check,
 * never after. `checkMcqDraft` returns every defect it finds, not just the
 * first — a caller decides what to do with the list (pra.md §3: `invalid-draft`
 * carries "the defect", singular in the target prose but this module returns
 * the full set a caller needs to explain a rejection, matching
 * `mcq-format.ts`'s `InvalidMcqBlock`/`McqInvalidReason` precedent of naming a
 * reason rather than stopping at the first).
 *
 * **Not wired.** No production caller exists yet — `[ILB-PRA-5]` wires this
 * into the drafting path once `[D-288]`'s risk-selected checks and the
 * validation-receipt shape (pra.md §7) are also ready. This module is the
 * "exact checks" step alone.
 *
 * **Reused rather than re-derived, per input:**
 *  - `draft`'s shape is `../instrument/mcq-generated.js`'s existing
 *    `GeneratedMcqCandidate` (`{stem, correctAnswer, distractors, feedback}`)
 *    — the one shape `quiz.generate.v1`'s response schema and
 *    `acceptGeneratedMcq` already agree on. No parallel "draft" type.
 *  - The distractor floor is `../instrument/types.js`'s existing
 *    `MIN_DISTRACTOR_POOL` (`[D-195]`), not a new number.
 *  - `'presentation-incompatible'` calls `../instrument/mcq-present.js`'s own
 *    `presentMcq` in a `try`/`catch` rather than re-deriving what the
 *    presenter requires — see that function's own doc for what it currently
 *    throws on (below `MIN_DISTRACTOR_POOL`, or an internal invariant). This
 *    means that specific failure mode is reported under TWO defect kinds at
 *    once today (`'below-distractor-floor'` from this module's own explicit
 *    check, AND `'presentation-incompatible'` from calling the presenter) —
 *    deliberate, not an oversight: the first names the numeric rule
 *    (`[D-195]`) a caller can act on without reading a thrown message; the
 *    second is a forward-looking net that starts reporting a NEW presenter
 *    validation the day one is added, with no change needed here.
 *  - Option-distinctness reuses `../concept/revision/relocate.js`'s
 *    `normalizeWhitespace` for the whitespace half of "distinct after
 *    normalisation"; case-folding is one `.toLocaleLowerCase()` call, the
 *    same un-shared idiom `heading-offer/detect.ts`'s own `firstLower` uses
 *    rather than reaching for a third module for one built-in call.
 *
 * **What is deliberately NOT a defect** (pra.md §2's own words): "a draft
 * with fewer sound distractors is not a defect as long as the floor holds."
 * This module never checks distractor count against anything higher than
 * `MIN_DISTRACTOR_POOL` — a two-distractor draft that clears the floor is
 * clean, matching `[D-195]`'s "shuffle-only" ratified degrade
 * (`mcq-present.ts`'s module doc).
 */

import { normalizeWhitespace } from '../concept/revision/relocate.js';
import type { GeneratedMcqCandidate } from '../instrument/mcq-generated.js';
import { presentMcq } from '../instrument/mcq-present.js';
import { MIN_DISTRACTOR_POOL } from '../instrument/types.js';

/**
 * Every defect kind `checkMcqDraft` can report. Named, not numbered, matching
 * this codebase's existing `McqInvalidReason` convention (`instrument/types.js`)
 * for the same reason: a caller building copy for her needs a stable string
 * to switch on, not a position in an array.
 */
export type McqDraftDefectKind =
  | 'duplicate-distractors'
  | 'key-among-distractors'
  | 'below-distractor-floor'
  | 'above-style-option'
  | 'empty-stem'
  | 'empty-feedback'
  | 'presentation-incompatible';

export interface McqDraftDefect {
  readonly kind: McqDraftDefectKind;
  /** Human-readable specifics — which option, how many distractors were found, or the presenter's own thrown message. */
  readonly detail: string;
}

/** Whitespace-collapsed, case-folded — see the module doc's "distinct after normalisation" note. */
function normalizeOption(text: string): string {
  return normalizeWhitespace(text).toLocaleLowerCase();
}

/**
 * Declared, not fitted — the same conservative-bias posture
 * `heading-offer/detect.ts`'s word lists document: an exact, normalised match
 * only, never a substring test, so a distractor that merely *contains* one of
 * these phrases inside a longer, real answer is never flagged. A false
 * negative here is recoverable at the risk-selected checks stage
 * (pra.md §2); a false positive would reject a sound item outright.
 */
const ABOVE_STYLE_OPTIONS: ReadonlySet<string> = new Set([
  'all of the above',
  'none of the above',
  'both of the above',
  'all the above',
  'none the above',
]);

/**
 * One MCQ draft's exact defects — the code stage, run before any risk-
 * selected check (pra.md §2). Pure: the same `draft` always produces the same
 * list, in the order the bullets appear in this module's own doc.
 */
export function checkMcqDraft(draft: GeneratedMcqCandidate): readonly McqDraftDefect[] {
  const defects: McqDraftDefect[] = [];

  const normalizedAnswer = normalizeOption(draft.correctAnswer);
  const normalizedDistractors = draft.distractors.map(normalizeOption);

  // Two distractors that normalise the same are one option shown twice —
  // `mcq-format.ts`'s own parse-time duplicate check catches this for a
  // block already written to the vault; this is the same fact, checked
  // before a draft ever reaches the vault, and case/whitespace-tolerant
  // where the parser's is exact-only.
  const seenDistractors = new Set<string>();
  for (let i = 0; i < draft.distractors.length; i++) {
    const normalized = normalizedDistractors[i];
    if (normalized === undefined) continue;
    if (seenDistractors.has(normalized)) {
      defects.push({
        kind: 'duplicate-distractors',
        detail: `distractor ${JSON.stringify(draft.distractors[i])} repeats another distractor after normalisation`,
      });
    }
    seenDistractors.add(normalized);
  }

  // The keyed answer appearing among the distractors — a different fact from
  // two distractors matching each other, and named separately so a caller
  // can tell "the pool has a repeat" from "the pool includes the answer
  // itself" without inspecting `detail`.
  if (normalizedDistractors.includes(normalizedAnswer)) {
    defects.push({
      kind: 'key-among-distractors',
      detail: `the keyed answer ${JSON.stringify(draft.correctAnswer)} also appears among the distractors`,
    });
  }

  // The two-distractor floor, `[D-195]` — the numeric rule by name, so a
  // caller does not have to parse a thrown message to act on it. See the
  // module doc for why `'presentation-incompatible'` below can ALSO fire for
  // this same input.
  if (draft.distractors.length < MIN_DISTRACTOR_POOL) {
    defects.push({
      kind: 'below-distractor-floor',
      detail: `${draft.distractors.length} distractor(s); the floor is ${MIN_DISTRACTOR_POOL}`,
    });
  }

  // "All/none of the above"-style options — declared list, exact match after
  // normalisation. Checked against every option, the key included: an
  // "all of the above" KEY is exactly as unusable as an "all of the above"
  // distractor, since neither is a real, checkable claim.
  const allOptions: readonly [string, string][] = [
    ['answer', draft.correctAnswer],
    ...draft.distractors.map((text): [string, string] => ['distractor', text]),
  ];
  for (const [role, text] of allOptions) {
    if (ABOVE_STYLE_OPTIONS.has(normalizeOption(text))) {
      defects.push({
        kind: 'above-style-option',
        detail: `${role} ${JSON.stringify(text)} reads as an "all/none of the above"-style option, which is never checkable on its own`,
      });
    }
  }

  if (draft.stem.trim() === '') {
    defects.push({ kind: 'empty-stem', detail: 'stem is empty or whitespace-only' });
  }
  if (draft.feedback.trim() === '') {
    defects.push({ kind: 'empty-feedback', detail: 'feedback is empty or whitespace-only' });
  }

  // Presentation compatibility — reuses `presentMcq`'s own validation rather
  // than re-deriving it (module doc). `PresentableMcq`'s shape
  // (`{stem, answer, distractors}`) is a structural subset `draft` already
  // satisfies.
  try {
    presentMcq({ stem: draft.stem, answer: draft.correctAnswer, distractors: draft.distractors });
  } catch (error) {
    defects.push({
      kind: 'presentation-incompatible',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return defects;
}
