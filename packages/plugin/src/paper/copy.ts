/**
 * Practice-paper student-facing copy (F4.11, `[D-262]` ruling 4; vocabulary registry §13).
 *
 * **The partial-paper statement's exact wording is not ratified — only its shape is** (partial ·
 * which demand kind · where to look instead; vocabulary registry §13, "The exact copy is a
 * design question this ruling does not settle; the shape... is ratified"). Two copy paths follow
 * from that:
 *
 * - `'interpret-printed-result'` reuses, VERBATIM, the interim sentence already written for
 *   exactly this demand kind on `ol-ppxj.36`
 *   (`docs/dev/alpha-first-user-disclosure.md` §3, private repo) — per this bead's brief, never
 *   re-composed. That sentence is itself marked interim there, pending `[D-262]`'s final wording.
 * - The other four demand kinds have no ratified sentence anywhere. `DEMAND_PLAIN_PHRASE` below
 *   is this bead's own shape-conforming composition for them — Class B, flagged for retroactive
 *   review — never an invented AFFORDANCE (the shape itself is ratified; only these particular
 *   words are provisional).
 *
 * **The forbidden framing** (vocabulary registry §13's neighbour rule, `[D-262]`): nowhere on a
 * partial paper's face may "practice exam," "mock exam," "representative paper," or any other
 * unqualified claim of completeness appear without this statement beside it. This module never
 * emits such a phrase — the ratified noun throughout is "practice paper" alone.
 */

import type { PaperDemand } from './demand.js';

/** F4.11's own words for the one affordance this feature offers — never "the exam oracle" (`[D-157]`). */
export const PRACTICE_PAPER_COMMAND_NAME = 'Olea: Give me a practice paper for this course';

/** `docs/dev/alpha-first-user-disclosure.md` §3's interim sentence, verbatim, for the one demand kind it was written for. */
const INTERPRET_PRINTED_RESULT_INTERIM_SENTENCE =
  'This practice paper is partial: it does not include questions that ask you to read a printed ' +
  'result — a table or a chart — and reason from it, because Olea cannot yet reliably build ' +
  'that kind of question for this course. To practise that part, use the real past papers held ' +
  'for this course instead.';

/**
 * Plain-English phrase per demand kind, used to compose the four non-ratified sentences below.
 * `'interpret-printed-result'`'s own phrase matches the interim sentence's wording exactly, so
 * the template and the verbatim sentence agree rather than describing the same demand two ways.
 */
const DEMAND_PLAIN_PHRASE: Readonly<Record<PaperDemand, string>> = Object.freeze({
  'recall-a-fact': 'recall a fact',
  calculate: 'work through a calculation',
  'compare-or-choose': 'compare or choose between options',
  'apply-to-unfamiliar-case': 'apply what you know to an unfamiliar case',
  'interpret-printed-result': 'read a printed result — a table or a chart — and reason from it',
});

/** The rendered partial-paper statement, plus its pointers, ready for the view to place before any item. */
export interface PartialPaperStatement {
  readonly sentence: string;
  /** Opaque pointers (real vault paths) to the held, non-sealed past papers that ask this demand — hers to open, never opened by this pipeline. */
  readonly pointerPaths: readonly string[];
}

/**
 * Builds ruling 4's face statement for one unbuilt demand. `pointerSourceRefs` may be empty only
 * when the caller's own evidence was itself unattributable — `paper-blueprint.ts`'s
 * `PaperFaceDemandGap` never constructs one that way (`pointerSourceRefsForDemand` only feeds
 * this from a reading that already carried a `sourceRef`), so this is a defensive shape, not an
 * expected path.
 */
export function buildPartialPaperStatement(
  demand: PaperDemand,
  pointerSourceRefs: readonly string[],
): PartialPaperStatement {
  const sentence =
    demand === 'interpret-printed-result'
      ? INTERPRET_PRINTED_RESULT_INTERIM_SENTENCE
      : `This practice paper is partial: it does not include questions that ask you to ` +
        `${DEMAND_PLAIN_PHRASE[demand]}, because Olea cannot yet reliably build that kind of ` +
        `question for this course. To practise that part, use the real past papers held for ` +
        `this course instead.`;
  return { sentence, pointerPaths: pointerSourceRefs };
}

/** F8.3-compliant locked-affordance copy — a count and its source would need real Outcome-based coverage data, which this composition does not read yet (see `provider.ts`'s module doc); this never renders a percentage, ratio or completeness figure in its place. */
export function buildLockedCopy(course: string, daysUntilNearest: number, dueIso: string): string {
  return (
    `The practice paper for ${course} is not available yet. Its nearest assessment is on ` +
    `${dueIso} (${daysUntilNearest} day${daysUntilNearest === 1 ? '' : 's'} away) — this unlocks ` +
    `automatically once that assessment is close enough, or once enough of your material is in place.`
  );
}

/** Shown when no unpassed assessment exists for the course at all — F4.11: "the affordance is absent," never present with a reason. */
export function buildNoAssessmentAheadCopy(course: string): string {
  return `${course} has no upcoming assessment, so there is no practice paper to offer yet.`;
}

/** F7.8's grey-out copy — shown instead of a broken attempt when no Worker is configured. */
export const PRACTICE_PAPER_AI_UNAVAILABLE_COPY =
  'Practice papers need Olea AI features, which are not configured yet.';

/**
 * `[D-457]` (F4.11, vocabulary registry section 31): the two states a paper that is not whole can
 * be in, each with its own ruled sentence, VERBATIM. Never edit these without the clause.
 * Neither is ever worded as covering less of the course: a missing question may reduce depth or
 * demand coverage without removing a topic.
 */
export const UNFINISHED_PAPER_SENTENCE =
  "Olea couldn't finish this paper. Ask again to continue from where it stopped.";
export const INCOMPLETE_PAPER_SENTENCE =
  'This paper is incomplete. Some planned questions could not be written.';

/**
 * One omitted part of a partial paper. It carries the machine reason code only: the slot's free-text
 * `reason` is developer prose (tiers, file paths, a generator's error) and never reaches her. The
 * clause lists each part "with its ruled reason", and no wording per code is ruled yet, so the view
 * shows the part's name alone until a ruling words each code (ol-egov.141.89.7.44).
 */
export interface OmittedPaperPart {
  readonly conceptName: string;
  readonly reasonCode: string;
}

/** The partial state's face: the ruled sentence, then the omitted parts, each with its reason. */
export interface IncompletePaperStatement {
  readonly sentence: string;
  readonly omittedParts: readonly OmittedPaperPart[];
}

/**
 * Builds the partial state's statement from a finished record's own fields. Null unless the record's
 * completion is a qualified partial (a flat record has no completion and reads as before). A part
 * set aside by rank is extent, not a gap, so it is never listed as omitted.
 */
export function buildIncompletePaperStatement(
  completion: { readonly status: string } | undefined,
  emptySlots: readonly {
    readonly conceptName: string;
    readonly reasonCode: string;
  }[],
): IncompletePaperStatement | null {
  if (completion?.status !== 'qualified-partial') return null;
  return {
    sentence: INCOMPLETE_PAPER_SENTENCE,
    omittedParts: emptySlots
      .filter((slot) => slot.reasonCode !== 'rank-excluded')
      .map((slot) => ({ conceptName: slot.conceptName, reasonCode: slot.reasonCode })),
  };
}
