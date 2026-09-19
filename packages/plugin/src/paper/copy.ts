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
