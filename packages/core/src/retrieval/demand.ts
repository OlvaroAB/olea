/**
 * The two-way mapping between the grounding judge's older stratification enum
 * (`IntendedOperation`, `./groundedContext.js`) and `[D-262]`'s ruled demand
 * vocabulary (`PaperDemand`, `../oracle/paper-types.js`).
 *
 * **Why this module exists at all.** `IntendedOperation` (`define` / `explain`
 * / `calculate` / `apply` / `compare`) still types
 * `GroundingJudgeRequest.intendedOperation` exactly as before — it is the
 * judge's own existing wire field, and this change does not touch it. But a
 * demand-shaped caller (`./request.ts`'s `RetrievalRequest.operation`,
 * `../heading-offer/operation.ts`'s `demandForHeading`) now speaks
 * `PaperDemand` directly, `[D-262]`'s ruled vocabulary for "what a question
 * asks her to do" — `recall-a-fact` / `calculate` / `compare-or-choose` /
 * `apply-to-unfamiliar-case` / `interpret-printed-result`. Something still has
 * to cross between the two for the one caller that reads a judge-shaped
 * signal and needs a demand (or the reverse), and that mapping belongs in one
 * place rather than re-derived at each call site.
 *
 * **The mapping is necessarily partial in both directions**, because the two
 * vocabularies were never the same shape to begin with:
 *
 * - `explain` has no demand it maps to. An explanation is not a demand a
 *   drafted instrument serves — F4.11's five demands are all things a
 *   question can ask her to DO (recall, calculate, compare, apply, read a
 *   result), and "explain why" is not one of them. `judgeOperationToDemand`
 *   returns `undefined` for it.
 * - `interpret-printed-result` has no judge operation it maps to.
 *   `IntendedOperation`'s five values predate `[D-262]`'s demand and never
 *   had a "read a printed result" member. `demandToJudgeOperation` returns
 *   `undefined` for it.
 *
 * Every other value has an exact counterpart, so the two functions are
 * inverses of each other everywhere both sides are defined.
 */

import type { PaperDemand } from '../oracle/paper-types.js';
import type { IntendedOperation } from './groundedContext.js';

/**
 * Maps a grounding-judge operation reading to `[D-262]`'s demand vocabulary.
 * `undefined` for `explain` — see this module's doc for why an explanation is
 * not a demand.
 */
export function judgeOperationToDemand(operation: IntendedOperation): PaperDemand | undefined {
  switch (operation) {
    case 'define':
      return 'recall-a-fact';
    case 'calculate':
      return 'calculate';
    case 'compare':
      return 'compare-or-choose';
    case 'apply':
      return 'apply-to-unfamiliar-case';
    case 'explain':
      return undefined;
  }
}

/**
 * Maps a `[D-262]` demand back to the grounding judge's operation
 * vocabulary. `undefined` for `interpret-printed-result` — see this module's
 * doc for why `IntendedOperation` has no counterpart for it.
 */
export function demandToJudgeOperation(demand: PaperDemand): IntendedOperation | undefined {
  switch (demand) {
    case 'recall-a-fact':
      return 'define';
    case 'calculate':
      return 'calculate';
    case 'compare-or-choose':
      return 'compare';
    case 'apply-to-unfamiliar-case':
      return 'apply';
    case 'interpret-printed-result':
      return undefined;
  }
}
