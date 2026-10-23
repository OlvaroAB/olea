/**
 * Every static string the "Explain it back" view (`./modal.ts`, `ol-12gs`)
 * renders — the voice charter (`[D-096]`, vocabulary registry §9) binds all
 * of them, the same discipline `../review/copy.ts` already applies to F2.7's
 * on-demand channel and F5's own folded-path refusals. `copy.spec.ts` sweeps
 * this file's exported strings the same way `review/copy.spec.ts` sweeps
 * its own.
 *
 * **In v0.9 explain-back is ungraded practice** (`[D-603]`; functional scope
 * F5's heading note, F5.2, F5.3, F5.4). The words on the practice view are
 * vocabulary registry §39's (`[D-611]`), byte for byte, and none promises an
 * assessment that does not run: the submit control reads "Show the passages"
 * with no wait line, the notice on every prompt says nothing here is graded,
 * the passages sit under "From your notes", the reflection prompts are fixed
 * per prompt shape, and the end controls are "Done" and "Try again".
 *
 * **Retired by §39:** the graded view's submit label and its wait line, which
 * promised a check that no longer runs. **Removed with the graded view**
 * (F5.3 as amended): the depth heading `[D-217]` ruled (`explainBackDepthHeading`),
 * the omission and misconception region headings, and `[D-322]`'s placeholder
 * practice-only notice, which §39's notice replaces on every prompt.
 */

/** The prompt's two shapes (D7.1's `promptShape`), with the two wordings a relation's reflection prompt names. */
export type ExplainBackReflectionShape =
  | { readonly kind: 'concept' }
  | {
      readonly kind: 'relation';
      /** The subject concept's current wording. */
      readonly concept: string;
      /** The neighbour concept's current wording. */
      readonly neighbour: string;
    };

export const EXPLAIN_BACK_MODAL_TITLE = 'Explain it back';

export const EXPLAIN_BACK_TOPIC_PROMPT = 'What would you like to explain?';
export const EXPLAIN_BACK_TOPIC_CONTINUE_LABEL = 'Continue';

export const EXPLAIN_BACK_QUESTION_LABEL = 'The question';
export const EXPLAIN_BACK_ANSWER_PLACEHOLDER = 'Explain it in your own words.';

/** Registry §39, the submit control. No wait line follows it: the passages are already on her device. */
export const EXPLAIN_BACK_SUBMIT_LABEL = 'Show the passages';

/**
 * Registry §39, the notice on every prompt, whatever its shape and whichever ruled entry point
 * opened it (F5.1). It replaces `[D-322]`'s placeholder practice-only notice, which was shown only
 * for an unmatched free-form topic: in v0.9 every prompt is practice.
 */
export const EXPLAIN_BACK_PRACTICE_NOTICE = 'This is practice: nothing here is graded.';

/** Registry §39, the heading over the passages (kept from the graded view). */
export const EXPLAIN_BACK_PASSAGES_HEADING = 'From your notes';

/** Registry §39, the first reflection prompt, for every prompt shape. */
export const EXPLAIN_BACK_REFLECTION_READ_ALONGSIDE = 'Read these alongside what you wrote.';

/** Registry §39, the second reflection prompt, for every prompt shape. */
export const EXPLAIN_BACK_REFLECTION_ADD_OR_REPHRASE =
  'Is there anything here you would add, or put differently?';

/** Registry §39, the third reflection prompt, a relation's only: its two concepts named in place of the placeholders. */
export function explainBackRelationReflectionPrompt(concept: string, neighbour: string): string {
  return `What do these passages say links ${concept} and ${neighbour}?`;
}

/**
 * The reflection prompts shown below the passages (F5.4 as amended, registry §39). **Chosen by the
 * prompt's shape alone**: the one argument is the shape and, for a relation, the two concepts'
 * wordings; nothing here can see her answer, a model's output or any reading of either, so the
 * prompts are the same for every explanation of one shape. Each asserts nothing about her
 * explanation and supplies no answer, and the view gives none an answer field.
 */
export function explainBackReflectionPrompts(shape: ExplainBackReflectionShape): readonly string[] {
  const shared = [EXPLAIN_BACK_REFLECTION_READ_ALONGSIDE, EXPLAIN_BACK_REFLECTION_ADD_OR_REPHRASE];
  return shape.kind === 'relation'
    ? [...shared, explainBackRelationReflectionPrompt(shape.concept, shape.neighbour)]
    : shared;
}

/** Registry §39, the end control that leaves the answer and closes the view. */
export const EXPLAIN_BACK_DONE_LABEL = 'Done';

/**
 * Registry §39, the end control that leaves the answer and returns to answering with her text
 * still in the field. The name is the graded view's; the dormant unable-to-assess path
 * (`./decline-kind.ts`) shares the word.
 */
export const EXPLAIN_BACK_DISCARD_LABEL = 'Try again';

/**
 * **Not rendered by the v0.9 view** (`[D-603]`): no control keeps, accepts or checks a result.
 * Kept exported only because `packages/workbench/src/simulator/controller.ts` (outside
 * `ol-egov.141.89.6.129`'s files) imports it for its scripted explain driver; it goes with that
 * driver's update.
 */
export const EXPLAIN_BACK_ACCEPT_LABEL = 'Keep this';

/**
 * `[D-321]` / `ol-0r92.130`: pass one could not tell whether this was a
 * genuine attempt at all — a defined non-verdict. **Dormant in v0.9**
 * (`[D-603]`): no answer is graded, so the view never shows it; it is
 * `./decline-kind.ts`'s message for when grading returns (F5.5).
 *
 * **PLACEHOLDER COPY — no ruled string exists for this outcome.**
 */
export const EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE =
  "Olea couldn't tell whether this was a real attempt at an answer, so nothing was graded.";

/**
 * `[D-564]` (c) condition 2 / `ol-egov.141.89.6.113`: the judge declined a genuine attempt because
 * her notes as delivered cannot decide (`./decline-kind.ts`, the `insufficient-material:` reason).
 * David ruled this wording on 2026-10-21 under `[D-564]` (c). **Dormant in v0.9** (`[D-603]`).
 */
export const EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE =
  "Olea couldn't find enough in your notes to check this answer, so nothing was graded.";

/**
 * `[D-564]` (c) condition 2 / `ol-egov.141.89.6.113`: the judge declined a genuine attempt because
 * the question is defective or contradictory (`./decline-kind.ts`, the `defective-question:`
 * reason). David ruled this wording on 2026-10-21 under `[D-564]` (c). **Dormant in v0.9**
 * (`[D-603]`).
 */
export const EXPLAIN_BACK_DECLINED_DEFECTIVE_QUESTION_MESSAGE =
  "This question couldn't be answered as asked, so nothing was graded. That's down to the question, not your answer.";

/**
 * `[D-171]`'s one-step affordance, worded for this surface (F8.4), which F8.4b (`[D-175]`) reuses
 * for the instrument's explain-back history. **Not rendered by the v0.9 view**: it rendered only
 * after cited findings, and in v0.9 there are none (F5.3). Where F8.4b's affordance sits on the
 * practice view is an open question with the hub; the wording is kept here for it.
 */
export const EXPLAIN_BACK_REGISTRY_ENTRY_ACTION = 'See in registry';

/**
 * The session-builder / Today-suggestion affordance's own label (F4.6, F6.4
 * — two of `[D-163]`'s four ruled entry points). Declared here, in the
 * OWNED explain-back package, rather than in `session-builder/copy.ts`,
 * so that module's own exhaustiveness sweep (`allSessionBuilderStrings`)
 * never needs to learn about a string this cluster owns.
 */
export const EXPLAIN_BACK_SESSION_ENTRY_LABEL = 'Explain something back';

// ---------------------------------------------------------------------------
// [STY-0h] (`ol-l5og.18.8`) — the insufficient-notes refusal, drawn the way
// `docs/design/pass5-refusal-trends-shell/ui_kits/olea-plugin/Pass5Refusal.jsx`
// (`olea-service`) draws it (C4.7, `[D-089]`). `./modal.ts`'s
// `renderRefusedPhase` renders the FACT sentence from `../review/copy.ts`'s
// `explainBackInsufficientNotesRefusal` and reads this eyebrow plus the
// found-list caption to draw the edge and evidence cues around it. In v0.9 it
// is reached only when a free-form topic finds nothing to explain against,
// before any answer, exactly as before `[D-603]`; the could-not-check family
// went with the grading call that produced it.
// ---------------------------------------------------------------------------

/** `reason: 'insufficient-notes'` — retrieval ran and came back too thin. */
export const EXPLAIN_BACK_NOTHING_MATCHED_EYEBROW = 'Nothing matched · what your notes returned';

/**
 * The found-list caption (C4.7's permitted content: which notes, at what
 * position — never a summary claim about the vault beyond them). Shown only
 * when retrieval returned something; an empty list renders no found-list at
 * all rather than an empty one.
 */
export const EXPLAIN_BACK_FOUND_LIST_CAPTION = 'What your notes returned';
