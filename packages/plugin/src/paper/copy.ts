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

import type { PaperMarks, PaperStructuredShape } from 'olea-core';
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

function daysPhrase(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

function topicsPhrase(n: number): string {
  return `${n} topic${n === 1 ? '' : 's'}`;
}

/**
 * What the locked sentence states ([D-532], F4.11 as amended by [D-252]): the declared scope's topic
 * count, how many have her material behind them, and the two thresholds. "Topics" is the display word
 * for what the code counts as outcomes. Counts only, never a share (F8.3).
 */
export interface LockedCopyInput {
  readonly course: string;
  readonly daysUntilNearest: number;
  readonly nearestAssessmentDue: string;
  readonly coverage: {
    readonly outcomeCount: number;
    readonly attachedOutcomeCount: number;
    readonly outcomeCoverageKnown: boolean;
  };
  /** The smallest topic count the unlock gate accepts, computed from the gate (`provider.ts`'s `topicsNeededToUnlock`), never typed here. */
  readonly topicsNeeded: number;
  /** The proximity window in days, read from the unlock gate. */
  readonly windowDays: number;
}

/**
 * `[D-532]`'s locked sentences, VERBATIM from docs/direction/papers/examiner-scope-status/10-paper-sentences.md
 * (sentences 1 and 2a). With a declared scope: two counts and the denominator, and both thresholds.
 * With none: nothing to count, and no number shown (never a measured zero).
 */
export function buildLockedCopy(input: LockedCopyInput): string {
  const { course, daysUntilNearest, nearestAssessmentDue, coverage } = input;
  const assessment = `on ${nearestAssessmentDue} (${daysPhrase(daysUntilNearest)} away)`;
  if (!coverage.outcomeCoverageKnown) {
    return (
      `The practice paper for ${course} is not available yet. Olea hasn't read a scope for this ` +
      `course from its past papers or objectives, so there is nothing to count. It unlocks when ` +
      `your nearest assessment, ${assessment}, is close enough.`
    );
  }
  return (
    `The practice paper for ${course} is not available yet. Its declared scope lists ` +
    `${topicsPhrase(coverage.outcomeCount)}, and ${coverage.attachedOutcomeCount} of them have your ` +
    `material behind them. It unlocks when your nearest assessment, ${assessment}, is within ` +
    `${daysPhrase(input.windowDays)}, or when at least ${input.topicsNeeded} of those ` +
    `${topicsPhrase(coverage.outcomeCount)} have your material behind them.`
  );
}

/** Shown when no unpassed assessment exists for the course at all: today's line, still unruled (`[D-532]` rules only the undated case). `[D-622]`: shown only when that is true, never as the reason an offered paper was not made. */
export function buildNoAssessmentAheadCopy(course: string): string {
  return `${course} has no upcoming assessment, so there is no practice paper to offer yet.`;
}

/** `[D-532]` sentence 2b, VERBATIM: the course has assessments but none with a usable date. */
export function buildUndatedAssessmentCopy(course: string): string {
  return (
    `The practice paper for ${course} is not available yet. Olea doesn't know the date of any ` +
    `upcoming assessment for this course, and the paper unlocks only once there is one ahead.`
  );
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
/** Sheet v59 "Other composition errors", VERBATIM (typographic apostrophe as signed): any composition failure with no other ruled wording. */
export const COMPOSITION_FAILED_SENTENCE = 'Olea couldn’t finish this paper. Please try again.';
/** `[D-622]` (registry section 31), VERBATIM: a request finds that the assessment the paper was offered for has passed; shown above the course's current state (ol-egov.141.89.7.110). */
export const ASSESSMENT_PASSED_SENTENCE =
  'This assessment has passed, so a practice paper is no longer available for it.';
/** `[D-532]` (registry section 31), VERBATIM: shown once above the paper only when saved progress was discarded because her sources or the course's scope changed. */
export const MATERIAL_CHANGED_SENTENCE =
  'Your material changed since this paper was started, so Olea began a new one.';
/** `[D-532]` sentence 3, VERBATIM: the kept progress was set aside because Olea was updated, so the next request starts afresh. */
export const AUTHORING_SPEC_CHANGED_SENTENCE =
  "Olea was updated while this paper was being written, so it couldn't be finished. Ask again to start a new paper.";
export const INCOMPLETE_PAPER_SENTENCE =
  'This paper is incomplete. Some planned questions could not be written.';

/**
 * One omitted part of a partial paper. It carries the machine reason code only: the slot's free-text
 * `reason` is developer prose (tiers, file paths, a generator's error) and never reaches her. What
 * she reads for each code is `OMITTED_PART_REASONS` (`omittedPartLine`).
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

/**
 * `[D-519]` (vocabulary registry section 31): each omitted part's ruled reason, VERBATIM, by the
 * reason code the paper records. Never edit these without the registry. `rank-excluded` has no row:
 * a part set aside by rank is extent, never listed. A code with no row reads by name alone.
 */
export const OMITTED_PART_REASONS: Readonly<Record<string, string>> = Object.freeze({
  'no-held-source': 'Nothing of yours covers this yet.',
  'demand-unsupported': "Olea can't yet write this kind of question.",
  'no-held-stimulus':
    'This question needs a case, extract, table or figure, and none of your material supplies one.',
  'depends-on-empty-part': 'This part builds on an earlier part that could not be written.',
  'generator-refused': "Olea couldn't write a question on this that stays within your material.",
});

/** The line she reads for one omitted part: its name, then its ruled reason when one is ruled. */
export function omittedPartLine(part: OmittedPaperPart): string {
  const reason = Object.hasOwn(OMITTED_PART_REASONS, part.reasonCode)
    ? OMITTED_PART_REASONS[part.reasonCode]
    : undefined;
  return reason === undefined ? part.conceptName : `${part.conceptName} — ${reason}`;
}

// ---------------------------------------------------------------------------------------------
// The paper's face prints its structure (F4.11 as amended by `[D-586]`, `ol-egov.141.89.7.4.1`)
// ---------------------------------------------------------------------------------------------

/**
 * Every word Olea adds to the structured face, in ONE block, so the wording David settles is one
 * edit. The vocabulary registry has no entry for a marks allocation, and lists "mark" in other senses
 * (a growth-stage mark, section 31's "exclude the mark" for an attempt), so these are the most neutral
 * candidates, NOT settled wording. Section headings, question numbers and part numbers are the stored
 * paper's own strings and add no word of Olea's.
 *
 * - `marksAllocation`: a bracketed number with no word, so an allocation cannot read as "marks she
 *   got". Alternatives held for David: "(4 marks)" (reads as a score beside an answer area),
 *   "worth 4 marks".
 * - `WHOLE_PAPER_LABEL`: the label before the paper's whole allocation. "Total" is avoided: the
 *   registry forbids "a total" in the attempt-record sense (sections 'never a total', 'running total').
 */
export const PAPER_FACE_WORDING = Object.freeze({
  marksAllocation: (value: number): string => `[${value}]`,
  WHOLE_PAPER_LABEL: 'Whole paper',
});

/** A stated allocation as the face prints it; unknown (or an unusable number) is `null`: omitted, never 0, never estimated (`[D-431]`, `[D-586]`). */
export function paperMarksText(marks: PaperMarks): string | null {
  if (marks.status !== 'stated') return null;
  if (!Number.isFinite(marks.value) || marks.value < 0) return null;
  return PAPER_FACE_WORDING.marksAllocation(marks.value);
}

/** One part (a slot) on the structured face. `number` is the stored part label verbatim, `null` when the stored part carries none. */
export interface FacePartOutline {
  readonly slotId: string;
  readonly number: string | null;
  readonly marks: string | null;
}

/** One top-level question. `number` is derived only from the stored part labels (see {@link buildPaperFaceOutline}), else `null`. */
export interface FaceQuestionOutline {
  readonly number: string | null;
  readonly parts: readonly FacePartOutline[];
}

export interface FaceSectionOutline {
  /** The stored section's own label; `null` for parts the stored paper places in no section. */
  readonly heading: string | null;
  readonly marks: string | null;
  readonly questions: readonly FaceQuestionOutline[];
}

/** `flat`: today's face, one list. `structured`: sections, questions, parts, with the whole paper's allocation. */
export type PaperFaceOutline =
  | { readonly kind: 'flat' }
  | {
      readonly kind: 'structured';
      readonly wholePaperMarks: string | null;
      readonly sections: readonly FaceSectionOutline[];
      /** Items the stored structure has no part for: listed after the sections, with no heading or number. */
      readonly unplacedSlotIds: readonly string[];
    };

/**
 * What the face prints from the stored paper's structure (`PaperRecord.structure`), over the items
 * the paper actually carries (`itemSlotIds`, printed order).
 *
 * Derived, and from what:
 * - **Sections**: the stored `sections`, in stored order; a section with no item under it prints
 *   nothing. A part's section is its group's `sectionId`, else its nearest ancestor group's.
 * - **Part numbers**: the stored `label` of the part, verbatim (the paper's own numbering).
 * - **Top-level question**: the outermost `parent-question` group above the part; a part with none is
 *   a question by itself. A question gets a number only when every one of its parts' labels begins
 *   with the same token (the text before the first "(" or "."), at least one label goes beyond that
 *   token, and the token is non-empty: that token is the number. Otherwise no question number is
 *   printed. No ordinal is ever counted up here.
 * - **Allocations**: only `stated` marks (parts, sections, whole paper). A question's allocation is
 *   not stored, so it is not summed.
 *
 * A paper with no structure, no sections, or none of whose items match a stored part is `flat`: it
 * prints as before.
 */
export function buildPaperFaceOutline(
  structure: PaperStructuredShape | undefined,
  itemSlotIds: readonly string[],
): PaperFaceOutline {
  if (structure === undefined || structure.sections.length === 0) return { kind: 'flat' };
  const wanted = new Set(itemSlotIds);
  const groupById = new Map(structure.groups.map((g) => [g.groupId, g] as const));

  const ancestry = (groupId: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = groupId;
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      chain.push(cursor);
      cursor = groupById.get(cursor)?.parentGroupId;
    }
    return chain;
  };
  const sectionOf = (groupId: string): string | null => {
    for (const id of ancestry(groupId)) {
      const sectionId = groupById.get(id)?.sectionId;
      if (sectionId !== undefined && sectionId !== null) return sectionId;
    }
    return null;
  };
  const questionKeyOf = (slotId: string, groupId: string): string => {
    const outermost = ancestry(groupId)
      .filter((id) => groupById.get(id)?.kind === 'parent-question')
      .pop();
    return outermost === undefined ? `part:${slotId}` : `group:${outermost}`;
  };

  const placed = new Set<string>();
  // section key -> question key -> parts, all in first-seen (printed) order.
  const bySection = new Map<
    string | null,
    Map<string, { slotId: string; label: string; marks: PaperMarks }[]>
  >();
  for (const part of structure.parts) {
    if (!wanted.has(part.slotId) || placed.has(part.slotId)) continue;
    placed.add(part.slotId);
    const sectionKey = sectionOf(part.groupId);
    const questions = bySection.get(sectionKey) ?? new Map();
    const key = questionKeyOf(part.slotId, part.groupId);
    const parts = questions.get(key) ?? [];
    parts.push({ slotId: part.slotId, label: part.label.trim(), marks: part.marks });
    questions.set(key, parts);
    bySection.set(sectionKey, questions);
  }
  if (placed.size === 0) return { kind: 'flat' };

  const questionNumber = (parts: readonly { label: string }[]): string | null => {
    const tokens = parts.map((p) => p.label.split(/[(.]/, 1)[0]?.trim() ?? '');
    const first = tokens[0];
    if (first === undefined || first === '' || tokens.some((t) => t !== first)) return null;
    return parts.some((p) => p.label !== first) ? first : null;
  };
  const toQuestions = (
    questions: ReadonlyMap<string, { slotId: string; label: string; marks: PaperMarks }[]>,
  ): FaceQuestionOutline[] =>
    [...questions.values()].map((parts) => ({
      number: questionNumber(parts),
      parts: parts.map((p) => ({
        slotId: p.slotId,
        number: p.label === '' ? null : p.label,
        marks: paperMarksText(p.marks),
      })),
    }));

  const sections: FaceSectionOutline[] = [];
  for (const section of structure.sections) {
    const questions = bySection.get(section.sectionId);
    if (questions === undefined) continue;
    sections.push({
      heading: section.label,
      marks: paperMarksText(section.marks),
      questions: toQuestions(questions),
    });
  }
  // Parts in no stored section, or in one the stored section list does not hold, follow with no heading.
  const knownSections = new Set(structure.sections.map((s) => s.sectionId));
  const loose = new Map<string, { slotId: string; label: string; marks: PaperMarks }[]>();
  for (const [sectionKey, questions] of bySection) {
    if (sectionKey !== null && knownSections.has(sectionKey)) continue;
    for (const [key, parts] of questions) loose.set(`${sectionKey ?? ''}|${key}`, parts);
  }
  if (loose.size > 0) sections.push({ heading: null, marks: null, questions: toQuestions(loose) });

  return {
    kind: 'structured',
    wholePaperMarks: paperMarksText(structure.totalMarks),
    sections,
    unplacedSlotIds: itemSlotIds.filter((id) => !placed.has(id)),
  };
}
