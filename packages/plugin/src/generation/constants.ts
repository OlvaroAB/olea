/**
 * Declared (not derived — `docs/Olea_component_register.md`'s constant-shape
 * rule) pacing constants for the F3.3 automatic generation pipeline
 * (`ol-p3t07a`). Plain-English defended, per that rule, rather than fitted
 * against a corpus.
 */

/**
 * How many NEW concepts one pipeline sweep will draft, at most.
 *
 * **Defence.** Each drafted concept costs exactly one grounded `retrieve()`
 * call (local, free) that may or may not clear `[D-042]`'s composite, and — only
 * when it clears — one `quiz.generate.v1` call against the Worker's daily
 * neuron budget (`ol-p2t...`'s cost model §4). A burst of freshly-ingested
 * material (a whole lecture folder dropped at once) can surface dozens of
 * concepts in one sweep; drafting all of them the instant they appear would
 * let one ingestion event spend a large, unpredictable share of the day's
 * generative budget before anything else — a session build, an explain-back
 * grading call — gets a turn. Bounding the sweep converts an unpredictable
 * burst into a small, repeatable unit of work: the next sweep (the same
 * `INGESTION_TICK_INTERVAL_MS` cadence `main.ts` already runs) picks up
 * where this one stopped, because an undrafted concept is simply revisited
 * next time (`pipeline.ts`'s dedupe check only skips concepts that already
 * have a cache record). F3.7 rules out ever *skipping* a concept for being
 * low-priority; this constant only orders *when* it gets its turn, which is
 * exactly what F3.7 asks mastery/yield to decide upstream of this — this
 * pipeline does not do that ordering itself yet (see `pipeline.ts`'s module
 * doc), so a small, conservative cap keeps today's arbitrary source-order
 * bias small in the same way it keeps burst cost small.
 */
export const MAX_CONCEPTS_PER_SWEEP = 3;

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
