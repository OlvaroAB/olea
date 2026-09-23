/**
 * Heading demand (F2.10's heading-card offer, component 2.6, extended by
 * `docs/dev/intelligence-build/pra.md` §2's target chain: "the heading's
 * asked operation (a 'why' or 'how' heading) becomes the practice need's
 * operation instead of a concept-name request" — `[ILB-PRA-4]`).
 *
 * **Not wired.** Nothing calls `demandForHeading` yet —
 * `[ILB-PRA-5]` is where the heading-card offer's accept path
 * (`packages/plugin/src/review/heading-offer.ts`) would thread its result
 * into a practice need's `operation` field. This module is the mapping
 * alone.
 *
 * **Reuses `PaperDemand`, `[D-262]`'s ruled demand vocabulary, never a
 * parallel enum.** The five words (`recall-a-fact`, `calculate`,
 * `compare-or-choose`, `apply-to-unfamiliar-case`, `interpret-printed-result`)
 * are `../oracle/paper-types.js`'s existing `PaperDemand` — the same
 * vocabulary `../retrieval/request.js`'s `RetrievalRequest.operation` now
 * carries. This module previously reused `groundedContext.ts`'s older
 * `IntendedOperation` stratification enum (`define`/`explain`/`calculate`/
 * `apply`/`compare`) instead; that enum still exists and still types the
 * grounding judge's own wire field exactly as before, but it is not what a
 * question asks her to do in the ruled sense, and reusing it here let the
 * two drift. `../retrieval/demand.ts` carries the mapping between the two
 * vocabularies for the one caller that needs to cross from a judge-shaped
 * signal into a demand.
 *
 * **Reuses `./detect.js`'s `stripEmphasis`**, not a parallel copy — both
 * modules read the same raw heading text and strip the same markdown
 * decoration before looking at words.
 *
 * ## The cue table, and why each row is here
 *
 * DECLARED, not fitted — the same conservative-bias posture `./detect.ts`'s
 * own word lists document: a cue list chosen to accept a false negative
 * (returns `undefined`, the heading is simply not offered a demand this
 * pass) over a false positive (a heading confidently mapped to the wrong
 * demand). Checked in the order below, first match wins — the order matters
 * because several cue phrases share a leading word ("what is..." opens both
 * a `recall-a-fact` heading and a `compare-or-choose` heading, "how..."
 * opens `calculate`, `apply-to-unfamiliar-case` and the unmapped residual
 * class), so the more specific rows are checked first.
 *
 *  1. **`compare-or-choose`** — "compare", "contrast", "difference between",
 *     "differs from", "versus"/"vs". These phrases are never used to ask for
 *     one thing's meaning or value; they structurally require two things
 *     named, so this row is checked before `recall-a-fact` even though "what
 *     is the difference between X and Y" also opens with "what is".
 *  2. **`calculate`** — "calculate", "compute", "solve", "determine", "how
 *     much", "how many", "value of", "result of". Asks for a derived numeric
 *     answer, not a stated fact — checked before `recall-a-fact` for the same
 *     "what is the value of X" collision `compare-or-choose` avoids, and
 *     before `apply-to-unfamiliar-case` because "how much"/"how many" is a
 *     distinct grammatical cue from either.
 *  3. **`apply-to-unfamiliar-case`** — "how do/would/can/should you", "how
 *     is/are/do/does ... applied/used", "in this case", or a bare "apply".
 *     Asks the principle to be used on a case, not restated or explained —
 *     checked before the residual "how does" class because both can open
 *     with "how does", and only the explicit "applied"/"used"/"in this case"
 *     wording distinguishes "how does X apply to Y" (apply-to-unfamiliar-
 *     case) from "how does X work" (the residual class, below).
 *  4. **`interpret-printed-result`** — "what does this/the graph/chart/
 *     table/figure/data/result(s) show/indicate/tell". Asks her to read a
 *     printed result and reason from it, not recall or derive one — checked
 *     before `recall-a-fact` for the same "what does..." collision the
 *     `recall-a-fact` row's own "mean" requirement already avoids, but placed
 *     here, before it, so the more specific reading-cue reading wins first.
 *  5. **`recall-a-fact`** — "what is/are", "define", "what does ... mean".
 *     The term's meaning, not its use — F2.10's own worked example.
 *
 * A heading matching none of these — including a bare "why" or "how does"
 * heading, and a plain yes/no question like "Is photosynthesis reversible?"
 * — returns `undefined` rather than a guessed demand. **The bare "why"/"how
 * does" class is deliberately left unmapped**, not merely uncovered: an
 * earlier version of this table read that residual class as `explain`
 * (`IntendedOperation`'s own residual member), but an explanation is not one
 * of `[D-262]`'s five demands, so there is no `PaperDemand` for it to become.
 * What demand (if any) a why-question actually serves depends on the item
 * written from it, not on the heading's wording alone — an open point
 * recorded in the practice-authoring case keys, left to routing rather than
 * guessed here. This is the intended shape of the bias, matching
 * `./detect.ts`'s own "a heading matching none of these is not offered" rule
 * applied to demand, not just to question-shape.
 */

import type { PaperDemand } from '../oracle/paper-types.js';
import { stripEmphasis } from './detect.js';

interface DemandCue {
  readonly demand: PaperDemand;
  readonly pattern: RegExp;
  /** Why this cue means this demand — see the module doc's own numbered list for the full argument; this is the one-line version carried on the table itself. */
  readonly why: string;
}

/** Checked in order, first match wins — see the module doc's "cue table" section for why the order is load-bearing. */
const DEMAND_CUES: readonly DemandCue[] = [
  {
    demand: 'compare-or-choose',
    pattern: /\b(compare|contrast|difference between|differs?\s+from|versus|\bvs\.?)\b/i,
    why: '"compare"/"difference between"/"versus" structurally name two things, never one meaning or value',
  },
  {
    demand: 'calculate',
    pattern:
      /^(calculate|compute|solve|determine)\b|\bhow\s+(much|many)\b|\b(value|result)\s+of\b/i,
    why: '"calculate"/"how much"/"how many"/"value of" ask for a derived numeric answer, not a stated fact',
  },
  {
    demand: 'apply-to-unfamiliar-case',
    pattern:
      /^how\s+(do|would|can|should)\s+you\b|\bhow\s+(is|are|do|does)\b.*\b(applied|used|use)\b|^apply\b|\bin\s+this\s+case\b/i,
    why: '"how do you..."/"how is X applied/used"/"in this case" ask the principle to be used on a case, not restated',
  },
  {
    demand: 'interpret-printed-result',
    pattern:
      /\bwhat\s+(does|do)\s+(this|the)\s+(graphs?|charts?|tables?|figures?|diagrams?|data|results?)\s+(show|indicate|tell)\b/i,
    why: '"what does this graph/table/result show" asks her to read a printed result and reason from it, not recall or derive one',
  },
  {
    demand: 'recall-a-fact',
    pattern: /^(what\s+(is|are)|define)\b|\bwhat\s+does\b.*\bmean\b/i,
    why: '"what is/are"/"define" ask for the term\'s meaning — F2.10\'s own worked example',
  },
];

/** Every cue row, exposed so a caller (or a test) can render the full declared table without re-deriving it. */
export function demandCues(): readonly DemandCue[] {
  return DEMAND_CUES;
}

/**
 * Maps one heading's wording to the demand it clearly asks for, or
 * `undefined` when it does not clearly ask one — see the module doc for the
 * declared cue table and why order matters. Pure: the same `headingText`
 * always produces the same result.
 */
export function demandForHeading(headingText: string): PaperDemand | undefined {
  const text = stripEmphasis(headingText);
  if (text === '') return undefined;

  for (const cue of DEMAND_CUES) {
    if (cue.pattern.test(text)) return cue.demand;
  }
  return undefined;
}
