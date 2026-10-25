/**
 * Declared (not derived — `docs/Olea_component_register.md`'s constant-shape
 * rule) pacing constants for the F3.3 automatic generation pipeline
 * (`ol-p3t07a`). Plain-English defended, per that rule, rather than fitted
 * against a corpus.
 */

/**
 * How many NEW concepts one pipeline sweep will draft, at most. Unbounded
 * (`Number.POSITIVE_INFINITY`) during development and tuning.
 *
 * **Defence.** David ruled ([D-653]) that there is no per-sweep drafting cap
 * while the product is being developed and tuned: one sweep attempts every
 * undrafted concept it reaches, ordered as before (need, then yield, then
 * rotation), with refusals, duplicates and course scope unchanged. The cost
 * argument for a bound still stands for a real install: each drafted concept
 * costs one local grounded `retrieve()` and, only when it clears, one
 * `quiz.generate.v1` call against the Worker's daily budget, so a burst of
 * freshly-ingested material could spend a large share of it in one tick. A
 * pacing bound before install is filed as `ol-egov.141.89.2.49`. The named
 * constant is kept so a bound returns by changing this one value; the sweep
 * loops compare `attempted >= MAX_CONCEPTS_PER_SWEEP`, which is never true at
 * infinity, and nothing does arithmetic on it or serialises it.
 */
export const MAX_CONCEPTS_PER_SWEEP = Number.POSITIVE_INFINITY;

/**
 * How many quiz questions the pipeline asks for per concept.
 *
 * **Defence.** `draftQuizCardsForConcept`'s own default (unset
 * `questionCount`) is left to the Worker's prompt, which is tuned server-side
 * (C4.6) — this pipeline does not override it. No constant is declared here
 * for that reason; this entry exists to record the decision NOT to add one,
 * so a future reader does not read the absence as an oversight.
 */

/**
 * The knowledge-kind classifier's confidence floor, as consulted by
 * component 2.2's routing (`routing.ts`, `ol-tz7v` / `[WIRE-7]`).
 *
 * **This is NOT declared, and this constant says so rather than dressing a
 * guess as one.** Component register row 1.5 rules the confidence floor
 * DERIVED — its derivation needs real classifier output scored against the
 * vault snapshot (N-015: synthetic never tunes a threshold). `ol-3ux7.6`
 * (`findings/KCT-3-confidence-floor.md`, olea-service) ran that derivation
 * once already and found no usable floor on the real vault's 102-concept
 * census (AUC 0.576, every candidate floor on a plateau ≤ 0.05), and
 * recommends `0.0` as the **provisional baseline** — explicitly "not yet a
 * decision bead" (that document's own words). This constant carries that
 * exact number, named as provisional, so a caller of `routing.ts` never has
 * to invent one, and so the one place this changes when `[D-nnn]` ratifies a
 * different value is this line.
 */
export const PROVISIONAL_CONFIDENCE_FLOOR = 0.0;
