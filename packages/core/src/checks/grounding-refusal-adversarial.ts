/**
 * CHK-2 (`ol-3ux7.15`) — component register row 1.8's health check.
 *
 * Row 1.8 ("Refuse when nothing relevant was found") names it in plain
 * terms: **"the absolute gate — 100% refusal on the adversarial
 * empty-context set; one confabulation is a fail at any sample size."**
 *
 * INV-5's own adversarial empty-context suite (E3, `scripts/harness/evals.mjs`
 * in `olea-service`) already covers the GENERATIVE pipelines — does a model
 * asked to write a card from nothing actually refuse. Row 1.8 is a layer
 * earlier and pure: `../retrieval/groundedContext.js`'s
 * `assembleGroundedContext`/`assembleBandedGroundedContext` decide
 * ground-or-refuse from retrieval's own numeric signals, before any model is
 * ever called. That decision never touches the network (both functions'
 * own module doc), so this check can run every adversarial case for free —
 * no cassette, no spend guard, nothing E3 needs.
 *
 * **This module does the comparing, not the deciding.** A caller (a harness
 * script, in production the same place that would ever run this sweep)
 * builds one `assembleGroundedContext`/`assembleBandedGroundedContext` call
 * per adversarial case — an empty hit list, hits with every signal at the
 * floor, hits with only degenerate keyword overlap on gibberish — and hands
 * this function the resulting refused/grounded verdicts. Content-free by
 * construction: a case is named by an opaque id, never by its query text or
 * chunk text (INV-3).
 */
import type { CheckVerdict } from './types.js';

export interface GroundingRefusalCase {
  /** Opaque case id — e.g. `'no-hits'`, `'below-cosine-floor'` — never query or chunk text. */
  readonly id: string;
  readonly refused: boolean;
}

export interface GroundingRefusalMeasured {
  readonly n: number;
  readonly refusals: number;
  /** Case ids that did NOT refuse — a confabulation, by row 1.8's own definition. */
  readonly confabulations: readonly string[];
}

/**
 * One case per adversarial input in, a verdict out. Fails if even one case
 * failed to refuse, or if zero cases were supplied at all (N-013 — a sweep
 * that ran nothing cannot report 100%).
 */
export function checkGroundingRefusalOnAdversarial(
  cases: readonly GroundingRefusalCase[],
): CheckVerdict<GroundingRefusalMeasured> {
  const refusals = cases.filter((c) => c.refused).length;
  const confabulations = cases.filter((c) => !c.refused).map((c) => c.id);

  const measured: GroundingRefusalMeasured = { n: cases.length, refusals, confabulations };

  if (cases.length === 0) {
    return { ok: false, measured, detail: 'zero adversarial cases supplied — nothing was checked' };
  }
  if (confabulations.length > 0) {
    return {
      ok: false,
      measured,
      detail:
        `${confabulations.length} of ${cases.length} adversarial case(s) did NOT refuse: ` +
        confabulations.join(', '),
    };
  }
  return {
    ok: true,
    measured,
    detail: `${refusals} of ${cases.length} adversarial cases refused (100%)`,
  };
}
