/**
 * CHK-1 (`ol-3ux7.1`, foundation item 34) — the shape every algorithm health
 * check returns.
 *
 * The whole point of this bead is named in its own description: "every
 * algorithm here returns a plausible answer whether or not it is working —
 * a ranking always ranks, a classifier always labels." A check that reports
 * only prose ("looks sensible") cannot be told apart from a check nobody
 * wrote. So every function in this directory returns the same three fields,
 * the cramming detector's own shape (`insights/types.ts`'s `InsightResult`)
 * generalised from "a pattern in her log" to "a property of an algorithm's
 * output":
 *
 * - `ok` — the pass/fail verdict a runner can gate on, computed from
 *   `measured` and never asserted independently of it.
 * - `measured` — every number the check computed, kept even when `ok` is
 *   `true`. A check that passes today must still be inspectable, not just
 *   trusted — the same "shows its working" rule `InsightResult` states.
 * - `detail` — a short, human-readable sentence naming why the check landed
 *   where it did. Content-free by construction: these functions never see a
 *   concept name, a course code, a note title or her wording, only counts,
 *   ids and ordered lists of ids (INV-3). Never rendered to her, never
 *   logged.
 *
 * **Pure, and deliberately not the algorithm itself.** Every check in this
 * directory takes the ALREADY-COMPUTED output of a real algorithm (or, for
 * checks that compare several runs — an ablation, a rebuild — several
 * already-computed outputs) and answers a yes/no question about it. Calling
 * the algorithm, replaying a log, or driving a model is the caller's job
 * (a harness script, a test, a production wiring point); these functions do
 * no I/O, read no clock, and import nothing that does.
 */
export interface CheckVerdict<Measured> {
  readonly ok: boolean;
  readonly measured: Measured;
  readonly detail: string;
}
