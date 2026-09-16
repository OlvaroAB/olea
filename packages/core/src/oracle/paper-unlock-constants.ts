/**
 * `[D-255]` (private repo `ol-egov.141.26`, `[PAPER-2]`) — the ratified provisional baseline for
 * `evaluatePaperUnlock`'s two required numbers (`./paper-unlock.ts`). Split into its own module,
 * separate from `paper-unlock.ts` itself, so the pure evaluator keeps taking both numbers as
 * required parameters with no default (`paper-unlock.ts`'s own module doc: "a caller cannot
 * accidentally ship an unbaked constant by omission") while every real call site has exactly one
 * declared source to import from, rather than re-typing the two literals at each composition.
 *
 * **DECLARED, not derived** (`docs/Olea_component_register.md`'s declared/derived line, private
 * repo): David ratified these as a plain-English provisional baseline, not a value fitted against
 * a corpus — `docs/Olea_ai_workload_and_cost_model.md`'s sibling private-repo sweep
 * (`scripts/harness/paper-unlock-sweep.mjs`, `[D-194]`) swept a sensitivity grid to confirm the
 * shape is safe, but the ratified NUMBER itself is David's call, per the run charter's "numbers
 * are decided by data... he ratifies the baseline and the revisit condition; he does not pick the
 * number [from an open menu]" — here the sweep found a flat, safe region and David pinned a
 * plain-English value inside it.
 *
 * **Revisit condition** (the thing that fires next, not a date): the alpha student's own answer
 * to "how far before an assessment does she want a practice paper, and does she want one for a
 * course she has barely started?" (private repo `ol-egov.141.27`, `[HUMAN]`, not yet asked). If
 * she wants one far out regardless of coverage, `COVERAGE_GATE_SHARE` is the number that moves,
 * never `PROXIMITY_WINDOW_DAYS` — the window is a floor bounded by the tightest real same-course
 * assessment gap and cannot widen past it without fusing consecutive assessments into one unlock
 * event (same reasoning `ol-egov.141.27`'s own text states).
 */

/**
 * Days before an assessment inside which proximity alone unlocks a practice paper, regardless of
 * material coverage (`[D-252]` ruling 4a's proximity-first leg). `[D-255]` provisional baseline.
 */
export const PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS = 7;

/**
 * Share of a course's declared scope (Outcomes with at least one attached concept —
 * `OutcomeConceptCoverage.outcomeCoverageShare`, `../outcome/reconcile-coverage.js`) that must
 * carry evidence before a practice paper unlocks outside the proximity window. `[D-255]`
 * provisional baseline.
 */
export const PAPER_UNLOCK_COVERAGE_GATE_SHARE = 0.3;
