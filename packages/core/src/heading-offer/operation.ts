/**
 * Heading operation (F2.10's heading-card offer, component 2.6, extended by
 * `docs/dev/intelligence-build/pra.md` §2's target chain: "the heading's
 * asked operation (a 'why' or 'how' heading) becomes the practice need's
 * operation instead of a concept-name request" — `[ILB-PRA-4]`).
 *
 * **Not wired.** Nothing calls `intendedOperationForHeading` yet —
 * `[ILB-PRA-5]` is where the heading-card offer's accept path
 * (`packages/plugin/src/review/heading-offer.ts`) would thread its result
 * into a practice need's `operation` field. This module is the mapping
 * alone.
 *
 * **Reuses `IntendedOperation`, never a parallel enum.** The five values
 * (`define`, `explain`, `calculate`, `apply`, `compare`) are
 * `../retrieval/groundedContext.js`'s existing `IntendedOperation` — the same
 * union `../retrieval/request.js`'s `RetrievalRequest.operation` and
 * `GroundingJudgeRequest.intendedOperation` already carry (`[JEV-5]` /
 * `ol-3ux7.88`). Inventing a second union here would let the two drift, the
 * same reasoning `request.ts`'s own module doc states for itself.
 *
 * **Reuses `./detect.js`'s `stripEmphasis`**, not a parallel copy — both
 * modules read the same raw heading text and strip the same markdown
 * decoration before looking at words.
 *
 * ## The cue table, and why each row is here
 *
 * DECLARED, not fitted — the same conservative-bias posture `./detect.ts`'s
 * own word lists document: a cue list chosen to accept a false negative
 * (returns `undefined`, the heading is simply not offered an operation this
 * pass) over a false positive (a heading confidently mapped to the wrong
 * operation). Checked in the order below, first match wins — the order
 * matters because several cue phrases share a leading word ("what is..."
 * opens both a `define` heading and a `compare` heading, "how..." opens
 * `calculate`, `apply` and `explain` headings), so the more specific rows are
 * checked first and the most generic (`explain`, which owns the bare
 * "why"/"how does" residue) is checked last.
 *
 *  1. **`compare`** — "compare", "contrast", "difference between",
 *     "differs from", "versus"/"vs". These phrases are never used to ask for
 *     one thing's meaning or value; they structurally require two things
 *     named, so this row is checked before `define` even though "what is the
 *     difference between X and Y" also opens with "what is".
 *  2. **`calculate`** — "calculate", "compute", "solve", "determine", "how
 *     much", "how many", "value of", "result of". Asks for a derived numeric
 *     answer, not a stated fact — checked before `define` for the same
 *     "what is the value of X" collision `compare` avoids, and before `apply`
 *     /`explain` because "how much"/"how many" is a distinct grammatical cue
 *     from either.
 *  3. **`apply`** — "how do/would/can/should you", or "how is/are/do/does
 *     ... applied/used". Asks the principle to be used on a case, not
 *     restated or explained — checked before `explain` because both can open
 *     with "how does", and only the explicit "applied"/"used" wording
 *     distinguishes "how does X apply to Y" (apply) from "how does X work"
 *     (explain).
 *  4. **`define`** — "what is/are", "define", "what does ... mean". The
 *     term's meaning, not its use — F2.10's own worked example.
 *  5. **`explain`** — "why", "explain", "describe why", or the residual bare
 *     "how does/do" that matched none of the more specific rows above. This
 *     is deliberately the LAST row: every heading that opens with "how" and
 *     is not a `calculate` or `apply` cue lands here, on the reading that
 *     "how does X work" is the default sense of an un-narrowed "how"
 *     question.
 *
 * A heading matching none of these — including a plain yes/no question like
 * "Is photosynthesis reversible?" — returns `undefined` rather than a
 * guessed operation. That is the intended shape of the bias, matching
 * `./detect.ts`'s own "a heading matching none of these is not offered" rule
 * applied to operation, not just to question-shape.
 */

import type { IntendedOperation } from '../retrieval/groundedContext.js';
import { stripEmphasis } from './detect.js';

export type { IntendedOperation };

interface OperationCue {
  readonly operation: IntendedOperation;
  readonly pattern: RegExp;
  /** Why this cue means this operation — see the module doc's own numbered list for the full argument; this is the one-line version carried on the table itself. */
  readonly why: string;
}

/** Checked in order, first match wins — see the module doc's "cue table" section for why the order is load-bearing. */
const OPERATION_CUES: readonly OperationCue[] = [
  {
    operation: 'compare',
    pattern: /\b(compare|contrast|difference between|differs?\s+from|versus|\bvs\.?)\b/i,
    why: '"compare"/"difference between"/"versus" structurally name two things, never one meaning or value',
  },
  {
    operation: 'calculate',
    pattern:
      /^(calculate|compute|solve|determine)\b|\bhow\s+(much|many)\b|\b(value|result)\s+of\b/i,
    why: '"calculate"/"how much"/"how many"/"value of" ask for a derived numeric answer, not a stated fact',
  },
  {
    operation: 'apply',
    pattern:
      /^how\s+(do|would|can|should)\s+you\b|\bhow\s+(is|are|do|does)\b.*\b(applied|used|use)\b|^apply\b/i,
    why: '"how do you..."/"how is X applied/used" ask the principle to be used on a case, not restated',
  },
  {
    operation: 'define',
    pattern: /^(what\s+(is|are)|define)\b|\bwhat\s+does\b.*\bmean\b/i,
    why: '"what is/are"/"define" ask for the term\'s meaning — F2.10\'s own worked example',
  },
  {
    operation: 'explain',
    pattern: /^(why|explain|describe\s+why)\b|^how\s+(does|do)\b/i,
    why: 'the residual class: "why"/"explain", or a bare "how does/do" that matched none of the more specific rows above',
  },
];

/** Every cue row, exposed so a caller (or a test) can render the full declared table without re-deriving it. */
export function operationCues(): readonly OperationCue[] {
  return OPERATION_CUES;
}

/**
 * Maps one heading's wording to the operation it clearly asks for, or
 * `undefined` when it does not clearly ask one — see the module doc for the
 * declared cue table and why order matters. Pure: the same `headingText`
 * always produces the same result.
 */
export function intendedOperationForHeading(headingText: string): IntendedOperation | undefined {
  const text = stripEmphasis(headingText);
  if (text === '') return undefined;

  for (const cue of OPERATION_CUES) {
    if (cue.pattern.test(text)) return cue.operation;
  }
  return undefined;
}
