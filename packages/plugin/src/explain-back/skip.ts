/**
 * `[DOS-I9]` (`ol-0r92.104`; SKIP-1..4, `[D-273]`, `[D-304]`, `[D-305]`,
 * `[D-306]`): the named skip action's own copy, and the one pure predicate
 * `./modal.ts` calls to decide whether a non-attempt record can be written
 * for a given resolved prompt.
 *
 * A separate, `obsidian`-free file for the same reason `./first-full-depth.ts`
 * and `./solo-review.ts` already are one: `modal.ts` imports Obsidian's
 * `Modal`, and `obsidian`'s `package.json` `main` is `""`, so nothing
 * `modal.ts` exports can be imported under Vitest at all. This file can be,
 * and is tested directly with real inputs (`skip.spec.ts`), not only by
 * matching `modal.ts`'s source text the way `submit-guard.spec.ts` must for
 * anything that lives inside the class itself.
 *
 * **Not added to `./copy.ts`.** `ol-0r92.104`'s `owns` is `modal.ts` plus new
 * files dedicated to the skip event inside this directory — not the existing
 * shared `copy.ts`, which stays another lane's to change. `copy.spec.ts`'s
 * voice-charter sweep therefore does not see `EXPLAIN_BACK_SKIP_LABEL`; nothing
 * here contradicts that charter (no apology, no celebration, no effort
 * language, no actor other than her), so a later lane folding this string
 * into `copy.ts` needs no wording change, only a house-move.
 */

/**
 * The word for the named action (vocabulary registry §19): plain language,
 * deliberately not an olive word — a plain verb already carries the meaning,
 * so no invented noun replaces it. **Never** framed as giving up, quitting or
 * failing, and never paired with a warning or a consequence sentence: a skip
 * costs her nothing, and there is nothing here to caution her about.
 */
export const EXPLAIN_BACK_SKIP_LABEL = 'Skip';

/**
 * Whether a non-attempt record can be written for a resolved prompt that
 * concerned these concept ids. `nonAttemptLogRecordV5.conceptIds`
 * (`packages/contracts/src/review-log.ts`, `[D-273]`) is non-empty by
 * schema — a record naming no concept is invisible to the per-offer, per-
 * concept counting F5.7 defines. A free-form, topic-seeded entry
 * (`ExplainBackSeed`'s `'freeform'` kind, `./modal.ts`) genuinely has no
 * concept id: `resolveTopicPrompt` resolves `subjectConceptId: null` for
 * every topic she types, whatever the wording, so there is nothing a
 * non-attempt record could name it against.
 *
 * **`false` here never blocks the skip action or the close-without-answering
 * path themselves** — both still close the prompt with no result line either
 * way (`[D-305]`; see `./modal.ts`'s `renderSkippedPhase`). It only gates
 * whether `deps.recordNonAttempt` is called: no fabricated concept id is
 * ever invented to satisfy the schema. This asymmetry (a skip on a
 * topic-seeded prompt closes the same way but leaves no event) is disclosed
 * in `ol-0r92.104`'s report as a follow-up, not silently absorbed — D7.1 and
 * F5.7 do not say what a concept-less non-attempt is, because there is no
 * ruled way to record one that names no concept.
 */
export function canRecordNonAttempt(conceptIds: readonly string[]): boolean {
  return conceptIds.length > 0;
}
