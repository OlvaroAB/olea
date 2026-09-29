/**
 * `groupPaperQuestions` — question groups and shared stimuli for a text past paper
 * (`ol-egov.141.89.7.12`; the 2026-09-28 ruling that papers keep their question groups and shared
 * stimuli; `olea-service/docs/dev/intelligence-build/scp.md` S.14).
 *
 * Core's two question splitters (`../source/segment-past-paper.ts` for her markdown,
 * `../source/segment-past-paper-plaintext.ts` for extracted PDF text) return a flat list of
 * `QuestionBlock`s threaded by `parentLabel`. That is one of the four group kinds the ruling names.
 * This pass reads the splitter's output, and the text its character ranges index into, and adds the
 * rest: the paper's sections, its "answer one of" choices, and the questions it sets on one scenario,
 * extract, table, figure or data set. It never changes, drops or re-labels a segmented question: each
 * one is placed exactly once, in document order, with its whole group path.
 *
 * It is a pass over the splitters' output rather than a change inside them, so each splitter keeps
 * its own, separately argued defences (see their module docs) and this pass can be read, tested and
 * replaced on its own.
 *
 * **What it recognises, all declared in plain English, none fitted:**
 *
 * 1. **Parent questions.** Every question with sub-parts is a `'parent-question'` group over its
 *    direct sub-parts. Its anchor is the parent's own text, which both splitters already cut off at
 *    the first sub-part marker, so the anchor is exactly the stem.
 * 2. **Sections.** A markdown heading the splitter reported as not a question
 *    (`NonQuestionHeading`) is a section when it reads as one: "Section B", "Part 2", or a heading
 *    naming a question form ("Short Answer Questions", "Essays"). In extracted text, a short line
 *    beginning "Section" or "Part" plus a letter, number or roman numeral is a section line; a
 *    repeat of the same section token (a running header, "Section B continued") opens nothing new.
 *    A section covers the top-level questions from its heading to the next section's. A section
 *    with no question under it forms no group.
 * 3. **Choices.** An instruction to answer, attempt, choose or select a stated number of questions
 *    or parts ("Answer ONE of the following", "Attempt TWO questions", "Answer either (a) or (b)")
 *    makes a `'choice'` group at the level it was stated: a section's instruction groups the
 *    section's questions; a parent question's stem groups its parts; the paper's preamble groups
 *    the section it names, every section ("from each section"), or else the questions under no
 *    section. A stated count at or above the number of members is not a choice ("answer three
 *    questions" over three) and forms no group.
 * 4. **Shared stimuli.** A sentence that names a stimulus form (scenario or case study; extract,
 *    passage or excerpt; table; figure, graph, diagram, chart, plot or image; data, data set or
 *    output) and either points at it ("the following", "below", "above", "shown") or numbers it
 *    ("Table 2"):
 *    - over a question range ("Questions 4 to 6 refer to the scenario below") makes a
 *      `'shared-stimulus'` group over those questions;
 *    - as a markdown heading with questions under it ("Case study", "Extract A") does the same for
 *      the questions up to the next heading that is not a question;
 *    - inside a parent question's stem sets that parent group's stimulus.
 *
 * **Where a stimulus is and is not identified.** The ruling: mark a stimulus not identified where
 * it cannot tell, and say why.
 * - Identified only when its text is in the paper's text: between a cue and the first question it
 *   serves, or in a parent's stem beyond the cue sentence (at least `STIMULUS_BODY_MIN_WORDS`
 *   words). The anchor spans the cue through that text.
 * - A figure's content is never text, so a figure is always `'not-identified'` with reason
 *   `'figure-not-in-text'` (so is a stimulus whose only body is an embedded image).
 * - A stimulus the paper refers to but does not print where this pass can find it, including a
 *   sub-part pointing back at "the table above" or "Table 1" when its stem names none, is
 *   `'not-identified'` with reason `'referenced-not-located'` and the form it was named by.
 * - Every other group reads `'not-identified'` with reason `'no-cue'`. This pass never says
 *   `'none'`: a text reader cannot rule out an image it was never given.
 *
 * **What it does not do.** It never decides what a question or a stimulus is about, and a concept a
 * stimulus concerns is never thereby attached to any part: whatever reads a group still judges
 * each part on its own. It reads no metadata and logs nothing (D-005). Group labels are the paper's own
 * wording, which is her material: local only, never sent to telemetry.
 *
 * **Provisional development defaults (David, 2026-09-29, decision sheet row 51).** Every declared
 * pattern and cutoff in this pass — `STIMULUS_BODY_MIN_WORDS`, `SECTION_LINE_MAX_LENGTH`, and the
 * section, choice, stimulus and question-range expressions — is a reasonable starting point and
 * nothing more: it is not validated by being declared. What checks it is the development cases in
 * `paper-question-groups.spec.ts`, which include short shared material at and beside the word
 * cutoff, tables, and headings beside and beyond the length cutoff. Structure a cue names but this
 * pass cannot place is PRESERVED in `unresolved`, never silently dropped (a section line over the
 * length cutoff, a section or stimulus heading with no question under it, a question range naming
 * no segmented question, a choice instruction naming a section that is not there). A concrete need
 * found in development evidence is a change to the extraction prompt or to a rule here, made
 * openly, not a quiet widening of a cutoff.
 *
 * **Reachability.** `groupMarkdownPastPaper` has its production caller in
 * `packages/plugin/src/generation/format-match.ts` (`buildFormatMatch`, beside `segmentPastPaper`),
 * carried in memory through `onPaperGroups`. It is not stored: the stored structure reading is the
 * Worker's (`[D-429]`, `./scope-reading-store.ts`), and this pass is its corroboration and its
 * fallback while a reading is pending (scp.md 2.2). The extracted-text sibling
 * (`groupPlainTextPastPaper`) has no caller yet.
 */

import type { CharRange, ExtractionResult } from '../extract/types.js';
import type {
  PaperQuestionGroup,
  PaperQuestionGroupKind,
  PaperStimulus,
  PaperStimulusForm,
} from '../oracle/paper-types.js';
import type {
  NonQuestionHeading,
  PastPaperSegmentationResult,
  QuestionBlock,
} from '../source/segment-past-paper.js';
import type { PlainTextPastPaperSegmentationResult } from '../source/segment-past-paper-plaintext.js';

/** A question group read from a text paper: anchors are character ranges into the paper's text. */
export type TextPaperQuestionGroup = PaperQuestionGroup<CharRange>;

/** One segmented question and where it sits among the groups. */
export interface QuestionPlacement {
  readonly label: string;
  /** Ids of every group containing this question, outermost first. Empty when it sits in none. */
  readonly groupPath: readonly string[];
  /**
   * True when this question has sub-parts: its own text is then the stem of its
   * `'parent-question'` group, and the parts, not the stem, are what is answered.
   */
  readonly isStem: boolean;
}

/**
 * Structure a cue names that this pass could not place (decision sheet row 51: preserve unresolved
 * structure instead of silently dropping it):
 *
 * - `'section-line-too-long'` — an extracted-text line that opens as a section ("SECTION B ...") but
 *   is over `SECTION_LINE_MAX_LENGTH`, so it was not read as a heading;
 * - `'section-without-questions'` — a section heading with no top-level question under it;
 * - `'stimulus-range-without-questions'` — "Questions 4 to 6 refer to the scenario below" where none
 *   of those questions was segmented;
 * - `'stimulus-heading-without-questions'` — a heading that names a stimulus form with no question
 *   under it;
 * - `'choice-instruction-without-group'` — an instruction to answer some of a section's questions
 *   that names a section which is not in the paper.
 */
export type UnresolvedStructureKind =
  | 'section-line-too-long'
  | 'section-without-questions'
  | 'stimulus-range-without-questions'
  | 'stimulus-heading-without-questions'
  | 'choice-instruction-without-group';

export interface UnresolvedStructure {
  readonly kind: UnresolvedStructureKind;
  /** The paper's own wording of the cue, cut to `UNRESOLVED_LABEL_MAX_LENGTH`: local content, never logged (D-005). */
  readonly label: string;
  readonly anchor: CharRange;
}

export interface TextPaperQuestionGrouping {
  /** Outer groups before the groups inside them, in document order. */
  readonly groups: readonly TextPaperQuestionGroup[];
  /** One entry per segmented question, in the splitter's own (document) order. */
  readonly placements: readonly QuestionPlacement[];
  /** Present only when something was left unresolved: absent means nothing was, not that nothing was checked. */
  readonly unresolved?: readonly UnresolvedStructure[];
}

export interface TextPaperGroupingInput {
  /** A splitter's questions, in its document order. */
  readonly questions: readonly QuestionBlock[];
  /** The text the questions' character ranges index into. */
  readonly text: string;
  /**
   * The markdown splitter's non-question headings. When given, sections and stimulus headings are
   * read from them; when absent (extracted text has no headings), section lines are found in the
   * text itself.
   */
  readonly nonQuestionHeadings?: readonly NonQuestionHeading[];
}

/**
 * Declared, not fitted (a provisional development default, row 51): a stimulus printed in a stem
 * holds at least a sentence's worth of words beyond the sentence that names it. Fewer, and the stem
 * only mentions a stimulus it does not print ("Refer to the scenario on the insert") — reported as
 * not located rather than claimed.
 */
const STIMULUS_BODY_MIN_WORDS = 8;

/** Declared: a section line in extracted text is a heading-length line, not a sentence of prose. A provisional development default (row 51). */
const SECTION_LINE_MAX_LENGTH = 120;

/** Declared: how much of the paper's own wording an unresolved cue keeps as its label. */
const UNRESOLVED_LABEL_MAX_LENGTH = 200;

/**
 * "Section B", "Part 2", "PART IV" — then the line ends, or goes on with punctuation or a capital
 * letter, never with lowercase prose ("Part B of the experiment"). The case test on what follows is
 * `sectionTokenOf`'s, since the token itself is read case-blind.
 */
const SECTION_TOKEN_RE = /^(?:section|part)\s+([A-Z]|\d{1,2}|[IVX]{1,4})\b(.*)$/i;
const SECTION_TAIL_RE = /^(?:$|[-\u2013\u2014:.,;()[\]]|[A-Z0-9])/;
const QUESTION_FORM_HEADING_RE =
  /\bquestions?\b|\bmultiple[- ]choice\b|\bshort[- ]answers?\b|\bessays?\b/i;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const COUNT = '(one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})';
/** "Answer ONE of the following", "Attempt TWO (2) questions", "Complete three parts". */
const CHOICE_ANSWER_RE = new RegExp(
  `\\b(?:answer|attempt|complete)\\s+(?:any\\s+)?(?:only\\s+)?${COUNT}\\s*(?:\\(\\d{1,2}\\)\\s*)?(?:of|from|questions?|parts?|topics?|essays?)\\b`,
  'i',
);
/**
 * "Choose ONE of the following questions", "Select two essay topics" — `choose`/`select` only when a
 * question, part, topic or essay is named soon after, so a multiple-choice stem's "select one option"
 * is never read as a choice between questions.
 */
const CHOICE_SELECT_RE = new RegExp(
  `\\b(?:choose|select)\\s+(?:any\\s+)?${COUNT}\\b[^.?!\\n]{0,40}?\\b(?:questions?|parts?|topics?|essays?)\\b`,
  'i',
);
const CHOICE_EITHER_RE = /\b(?:answer|attempt|choose)\s+either\b/i;

const FORM_PATTERNS: readonly (readonly [PaperStimulusForm, RegExp])[] = [
  ['scenario', /\b(?:scenarios?|case[- ]stud(?:y|ies)|vignettes?)\b/i],
  ['extract', /\b(?:extracts?|passages?|excerpts?|articles?|quotations?)\b/i],
  ['table', /\btables?\b/i],
  ['figure', /\b(?:figures?|fig\.|graphs?|diagrams?|charts?|plots?|images?|pictures?)(?=\W|$)/i],
  ['data-set', /\b(?:data\s*sets?|data|output)\b/i],
];

/** Points at a stimulus, or asks her to work from one ("Refer to the scenario", "Using the data"). */
const POINTING_RE =
  /\b(?:following|below|above|shown|presented|provided|given|printed|accompanying|refer|refers|read|using|use|consider|study|based\s+on)\b/i;
const BACK_POINTING_RE = /\babove\b/i;
const NUMBERED_STIMULUS_RE =
  /\b(?:table|figure|fig\.|graph|diagram|chart|extract|passage|scenario|case[- ]study|source)\s*(?:\d{1,3}|[A-Z])\b/i;
const QUESTION_RANGE_RE =
  /\bquestions?\s+(\d{1,3})\s*(?:-|–|—|to|through|and)\s*(?:questions?\s+)?(\d{1,3})\b/gi;
const RANGE_RELATION_RE =
  /\b(?:refers?|relates?|based|uses?|using|concerns?|about|following|below|above)\b/i;
/** A question's own label and stated marks at the start of its text ("## Question 3 (15 marks)", "4."), which are not stimulus. */
const QUESTION_LABEL_PREFIX_RE =
  /^\s*(?:#{1,6}\s*)?(?:question\s+)?(?:\d{1,4}|[A-Z])\b[.)]?\s*(?:\(\d+(?:\.\d+)?\s*marks?\)|\[\d+(?:\.\d+)?\s*marks?\])?/i;
const IMAGE_EMBED_RE = /!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g;

const KIND_NESTING_RANK: Readonly<Record<PaperQuestionGroupKind, number>> = {
  section: 0,
  'shared-stimulus': 1,
  choice: 2,
  'parent-question': 3,
};

interface Sentence {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Sentences with their offsets. A sentence ends at `.`, `?` or `!` followed by whitespace — never
 * after a common abbreviation ("Fig.", "e.g.") — or at a blank line.
 */
function splitSentences(text: string, offset: number): Sentence[] {
  const out: Sentence[] = [];
  const boundary = /(?<!\b(?:fig|e\.g|i\.e|cf|vs|no))[.?!]+(?=\s)|\n[ \t]*\n/gi;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    pushSentence(out, text, start, end, offset);
    start = end;
  }
  pushSentence(out, text, start, text.length, offset);
  return out;
}

function pushSentence(
  out: Sentence[],
  text: string,
  start: number,
  end: number,
  offset: number,
): void {
  const raw = text.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (trimmed === '') return;
  out.push({
    start: offset + start + lead,
    end: offset + start + lead + trimmed.length,
    text: trimmed,
  });
}

/** The form a sentence names first, if any. */
function formNamedIn(text: string): PaperStimulusForm | undefined {
  let best: { form: PaperStimulusForm; index: number } | undefined;
  for (const [form, pattern] of FORM_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null && (best === undefined || match.index < best.index)) {
      best = { form, index: match.index };
    }
  }
  return best?.form;
}

interface StimulusCue {
  readonly form: PaperStimulusForm;
  readonly sentence: Sentence;
}

/** The first sentence that names a stimulus form and points at it or numbers it. */
function findStimulusCue(text: string, offset: number): StimulusCue | undefined {
  for (const sentence of splitSentences(text, offset)) {
    const form = formNamedIn(sentence.text);
    if (form === undefined) continue;
    if (POINTING_RE.test(sentence.text) || NUMBERED_STIMULUS_RE.test(sentence.text)) {
      return { form, sentence };
    }
  }
  return undefined;
}

/** A sentence pointing back at a stimulus printed elsewhere ("the table above", "Figure 1"), never one printed below it. */
function findBackReference(text: string, offset: number): StimulusCue | undefined {
  for (const sentence of splitSentences(text, offset)) {
    const form = formNamedIn(sentence.text);
    if (form === undefined) continue;
    if (/\b(?:following|below)\b/i.test(sentence.text)) continue;
    if (BACK_POINTING_RE.test(sentence.text) || NUMBERED_STIMULUS_RE.test(sentence.text)) {
      return { form, sentence };
    }
  }
  return undefined;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function choiceCount(text: string): number | undefined {
  if (CHOICE_EITHER_RE.test(text)) return 1;
  const token = (CHOICE_ANSWER_RE.exec(text) ?? CHOICE_SELECT_RE.exec(text))?.[1]?.toLowerCase();
  if (token === undefined) return undefined;
  const value = NUMBER_WORDS[token] ?? Number(token);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function lineAt(text: string, index: number): CharRange {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const newline = text.indexOf('\n', index);
  return { start, end: newline === -1 ? text.length : newline };
}

/** `range` with surrounding whitespace removed; an all-blank range collapses to its start. */
function trimRange(text: string, range: CharRange): CharRange {
  let { start, end } = range;
  while (start < end && /\s/.test(text[start] ?? '')) start++;
  while (end > start && /\s/.test(text[end - 1] ?? '')) end--;
  return { start, end };
}

function headingLabel(line: string): string {
  return line.replace(/^#{1,6}\s*/, '').trim();
}

/** Records one cue this pass could not place (row 51). The label is the paper's own wording, cut short. */
function noteUnresolved(
  unresolved: UnresolvedStructure[],
  kind: UnresolvedStructureKind,
  text: string,
  anchor: CharRange,
): void {
  const trimmed = trimRange(text, anchor);
  unresolved.push({
    kind,
    label: text.slice(trimmed.start, trimmed.end).slice(0, UNRESOLVED_LABEL_MAX_LENGTH),
    anchor: trimmed,
  });
}

function rangeOf(question: QuestionBlock): CharRange {
  const range = question.provenance.location.charRange;
  return range ?? { start: 0, end: 0 };
}

/**
 * The stimulus a cue names, located or not. `bodyRange` is where its text would be, if printed;
 * `anchorStart` is where the cue begins.
 */
function stimulusFor(
  text: string,
  form: PaperStimulusForm,
  anchorStart: number,
  bodyRange: CharRange | undefined,
): PaperStimulus<CharRange> {
  if (form === 'figure') return { status: 'not-identified', form, reason: 'figure-not-in-text' };
  if (bodyRange === undefined) {
    return { status: 'not-identified', form, reason: 'referenced-not-located' };
  }
  const body = text.slice(bodyRange.start, bodyRange.end);
  const withoutImages = body.replace(IMAGE_EMBED_RE, ' ');
  if (withoutImages.trim() === '' && body.trim() !== '') {
    return { status: 'not-identified', form, reason: 'figure-not-in-text' };
  }
  if (wordCount(withoutImages) === 0) {
    return { status: 'not-identified', form, reason: 'referenced-not-located' };
  }
  const trimmed = trimRange(text, bodyRange);
  return { status: 'identified', form, anchor: { start: anchorStart, end: trimmed.end } };
}

const NO_CUE: PaperStimulus<CharRange> = { status: 'not-identified', reason: 'no-cue' };

interface DraftGroup {
  readonly id: string;
  readonly kind: PaperQuestionGroupKind;
  readonly label: string;
  readonly memberLabels: readonly string[];
  readonly choose?: number;
  readonly anchor: CharRange;
  readonly stimulus: PaperStimulus<CharRange>;
}

interface SectionDraft {
  readonly token: string;
  readonly label: string;
  readonly heading: CharRange;
}

interface PaperIndex {
  readonly text: string;
  readonly questions: readonly QuestionBlock[];
  readonly topLevels: readonly QuestionBlock[];
  readonly childrenOf: ReadonlyMap<string, readonly string[]>;
  readonly orderOf: ReadonlyMap<string, number>;
}

function indexPaper(input: TextPaperGroupingInput): PaperIndex {
  const childrenOf = new Map<string, string[]>();
  const orderOf = new Map<string, number>();
  input.questions.forEach((question, index) => {
    if (!orderOf.has(question.label)) orderOf.set(question.label, index);
    if (question.parentLabel === undefined) return;
    const siblings = childrenOf.get(question.parentLabel) ?? [];
    siblings.push(question.label);
    childrenOf.set(question.parentLabel, siblings);
  });
  return {
    text: input.text,
    questions: input.questions,
    topLevels: input.questions.filter((q) => q.parentLabel === undefined),
    childrenOf,
    orderOf,
  };
}

function sectionTokenOf(line: string): string | undefined {
  const match = SECTION_TOKEN_RE.exec(headingLabel(line));
  const token = match?.[1];
  if (token === undefined || !SECTION_TAIL_RE.test((match?.[2] ?? '').trim())) return undefined;
  return token.toUpperCase();
}

/** A markdown non-question heading reads as a section: "Section B", or one naming a question form that is not itself a stimulus cue. */
function isSectionHeading(text: string): boolean {
  return (
    sectionTokenOf(text) !== undefined ||
    (QUESTION_FORM_HEADING_RE.test(text) && findStimulusCue(text, 0) === undefined)
  );
}

function findSections(
  input: TextPaperGroupingInput,
  unresolved: UnresolvedStructure[],
): SectionDraft[] {
  const { text } = input;
  if (input.nonQuestionHeadings !== undefined) {
    return input.nonQuestionHeadings
      .filter((h) => isSectionHeading(h.text))
      .map((h) => ({
        token: sectionTokenOf(h.text) ?? headingLabel(h.text).toLowerCase(),
        label: headingLabel(h.text),
        heading: h.charRange,
      }));
  }
  const seen = new Set<string>();
  const sections: SectionDraft[] = [];
  let cursor = 0;
  for (const line of text.split('\n')) {
    const range = { start: cursor, end: cursor + line.length };
    cursor += line.length + 1;
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.length > SECTION_LINE_MAX_LENGTH) {
      // Over the heading-length cutoff, so not read as a heading — but if it opens as one, say so.
      if (sectionTokenOf(trimmed) !== undefined) {
        noteUnresolved(unresolved, 'section-line-too-long', text, range);
      }
      continue;
    }
    const token = sectionTokenOf(trimmed);
    if (token === undefined || seen.has(token)) continue;
    seen.add(token);
    sections.push({ token, label: trimmed, heading: trimRange(text, range) });
  }
  return sections;
}

interface PlacedSection {
  readonly id: string;
  readonly token: string;
  readonly members: readonly QuestionBlock[];
  /** Heading through to (not including) the section's first question. */
  readonly stem: CharRange;
}

function buildSections(
  paper: PaperIndex,
  drafts: readonly SectionDraft[],
  unresolved: UnresolvedStructure[],
): {
  groups: DraftGroup[];
  placed: PlacedSection[];
} {
  const sorted = [...drafts].sort((a, b) => a.heading.start - b.heading.start);
  const groups: DraftGroup[] = [];
  const placed: PlacedSection[] = [];
  sorted.forEach((draft, i) => {
    const limit = sorted[i + 1]?.heading.start ?? Number.POSITIVE_INFINITY;
    const members = paper.topLevels.filter((q) => {
      const start = rangeOf(q).start;
      return start >= draft.heading.start && start < limit;
    });
    const first = members[0];
    if (first === undefined) {
      noteUnresolved(unresolved, 'section-without-questions', paper.text, draft.heading);
      return;
    }
    const id = `section:${placed.length + 1}`;
    const stem = trimRange(paper.text, { start: draft.heading.start, end: rangeOf(first).start });
    placed.push({ id, token: draft.token, members, stem });
    groups.push({
      id,
      kind: 'section',
      label: draft.label,
      memberLabels: members.map((q) => q.label),
      anchor: stem,
      stimulus: NO_CUE,
    });
  });
  return { groups, placed };
}

/** A choice group anchored on the instruction sentence itself; none when the count cannot be a choice. */
function choiceGroup(
  id: string,
  cue: Sentence,
  count: number,
  memberLabels: readonly string[],
): DraftGroup | undefined {
  if (memberLabels.length < 2 || count >= memberLabels.length) return undefined;
  return {
    id,
    kind: 'choice',
    label: cue.text,
    memberLabels,
    choose: count,
    anchor: { start: cue.start, end: cue.end },
    stimulus: NO_CUE,
  };
}

function firstChoiceCue(
  text: string,
  range: CharRange,
): { sentence: Sentence; count: number } | undefined {
  for (const sentence of splitSentences(text.slice(range.start, range.end), range.start)) {
    const count = choiceCount(sentence.text);
    if (count !== undefined) return { sentence, count };
  }
  return undefined;
}

function buildChoices(
  paper: PaperIndex,
  sections: readonly PlacedSection[],
  unresolved: UnresolvedStructure[],
): DraftGroup[] {
  const groups: DraftGroup[] = [];
  const chosenSections = new Set<string>();

  for (const section of sections) {
    const cue = firstChoiceCue(paper.text, section.stem);
    if (cue === undefined) continue;
    const group = choiceGroup(
      `choice:${section.id}`,
      cue.sentence,
      cue.count,
      section.members.map((q) => q.label),
    );
    if (group !== undefined) {
      groups.push(group);
      chosenSections.add(section.id);
    }
  }

  for (const question of paper.questions) {
    const parts = paper.childrenOf.get(question.label);
    if (parts === undefined) continue;
    const cue = firstChoiceCue(paper.text, rangeOf(question));
    if (cue === undefined) continue;
    const group = choiceGroup(`choice:question:${question.label}`, cue.sentence, cue.count, parts);
    if (group !== undefined) groups.push(group);
  }

  // The preamble: everything before the first section heading and the first question.
  const firstQuestion = paper.topLevels[0];
  if (firstQuestion === undefined) return groups;
  const preambleEnd = Math.min(rangeOf(firstQuestion).start, ...sections.map((s) => s.stem.start));
  const inSomeSection = new Set(sections.flatMap((s) => s.members.map((q) => q.label)));
  let paperWideTaken = false;
  for (const sentence of splitSentences(paper.text.slice(0, preambleEnd), 0)) {
    const count = choiceCount(sentence.text);
    if (count === undefined) continue;
    const named = /\bsection\s+([A-Z]|\d{1,2}|[IVX]{1,4})\b/i.exec(sentence.text)?.[1];
    const targets: PlacedSection[] =
      named !== undefined
        ? sections.filter((s) => s.token === named.toUpperCase())
        : /\beach\s+section\b/i.test(sentence.text)
          ? [...sections]
          : [];
    if (targets.length > 0) {
      for (const section of targets) {
        if (chosenSections.has(section.id)) continue;
        const group = choiceGroup(
          `choice:${section.id}`,
          sentence,
          count,
          section.members.map((q) => q.label),
        );
        if (group !== undefined) {
          groups.push(group);
          chosenSections.add(section.id);
        }
      }
      continue;
    }
    if (paperWideTaken) continue;
    const loose = paper.topLevels.filter((q) => !inSomeSection.has(q.label)).map((q) => q.label);
    const group = choiceGroup('choice:paper', sentence, count, loose);
    if (group !== undefined) {
      groups.push(group);
      paperWideTaken = true;
    } else if (named !== undefined) {
      // An instruction to choose within a section this paper does not have, and no paper-wide
      // choice to fall back on: kept as unresolved, never dropped.
      noteUnresolved(unresolved, 'choice-instruction-without-group', paper.text, sentence);
    }
  }
  return groups;
}

function buildRangeStimuli(paper: PaperIndex, unresolved: UnresolvedStructure[]): DraftGroup[] {
  const groups: DraftGroup[] = [];
  for (const match of paper.text.matchAll(QUESTION_RANGE_RE)) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (!(from < to)) continue;
    const line = lineAt(paper.text, match.index ?? 0);
    const lineText = paper.text.slice(line.start, line.end);
    const form = formNamedIn(lineText);
    if (form === undefined || !RANGE_RELATION_RE.test(lineText)) continue;
    const members = paper.topLevels.filter((q) => {
      const n = Number(q.label);
      return Number.isInteger(n) && n >= from && n <= to;
    });
    const first = members[0];
    if (first === undefined) {
      noteUnresolved(unresolved, 'stimulus-range-without-questions', paper.text, line);
      continue;
    }
    const firstStart = rangeOf(first).start;
    const bodyRange = line.start < firstStart ? { start: line.end, end: firstStart } : undefined;
    groups.push({
      id: `stimulus:${groups.length + 1}`,
      kind: 'shared-stimulus',
      label: lineText.trim(),
      memberLabels: members.map((q) => q.label),
      anchor: trimRange(paper.text, line),
      stimulus: stimulusFor(paper.text, form, trimRange(paper.text, line).start, bodyRange),
    });
  }
  return groups;
}

function buildHeadingStimuli(
  paper: PaperIndex,
  headings: readonly NonQuestionHeading[],
  firstId: number,
  unresolved: UnresolvedStructure[],
): DraftGroup[] {
  const groups: DraftGroup[] = [];
  const sorted = [...headings].sort((a, b) => a.charRange.start - b.charRange.start);
  sorted.forEach((heading, i) => {
    if (isSectionHeading(heading.text)) return;
    const form = formNamedIn(heading.text);
    if (form === undefined) return;
    const limit = sorted[i + 1]?.charRange.start ?? Number.POSITIVE_INFINITY;
    const members = paper.topLevels.filter((q) => {
      const start = rangeOf(q).start;
      return start >= heading.charRange.start && start < limit;
    });
    const first = members[0];
    if (first === undefined) {
      noteUnresolved(
        unresolved,
        'stimulus-heading-without-questions',
        paper.text,
        heading.charRange,
      );
      return;
    }
    groups.push({
      id: `stimulus:${firstId + groups.length}`,
      kind: 'shared-stimulus',
      label: headingLabel(heading.text),
      memberLabels: members.map((q) => q.label),
      anchor: trimRange(paper.text, heading.charRange),
      stimulus: stimulusFor(paper.text, form, heading.charRange.start, {
        start: heading.charRange.end,
        end: rangeOf(first).start,
      }),
    });
  });
  return groups;
}

function parentStimulus(paper: PaperIndex, question: QuestionBlock): PaperStimulus<CharRange> {
  const range = rangeOf(question);
  const cue = findStimulusCue(question.text, range.start);
  if (cue !== undefined) {
    if (cue.form === 'figure') {
      return { status: 'not-identified', form: 'figure', reason: 'figure-not-in-text' };
    }
    const stem = paper.text.slice(range.start, range.end);
    const beyondCue =
      `${stem.slice(0, cue.sentence.start - range.start)} ${stem.slice(cue.sentence.end - range.start)}`
        .replace(QUESTION_LABEL_PREFIX_RE, '')
        .replace(IMAGE_EMBED_RE, ' ');
    if (wordCount(beyondCue) >= STIMULUS_BODY_MIN_WORDS) {
      return { status: 'identified', form: cue.form, anchor: trimRange(paper.text, range) };
    }
    return stimulusFor(paper.text, cue.form, range.start, undefined);
  }
  for (const label of descendantsOf(paper, question.label)) {
    const part = paper.questions.find((q) => q.label === label);
    if (part === undefined) continue;
    const back = findBackReference(part.text, rangeOf(part).start);
    if (back !== undefined) return stimulusFor(paper.text, back.form, range.start, undefined);
  }
  return NO_CUE;
}

function descendantsOf(paper: PaperIndex, label: string): string[] {
  const out: string[] = [];
  const stack = [...(paper.childrenOf.get(label) ?? [])].reverse();
  while (stack.length > 0) {
    const next = stack.pop() as string;
    out.push(next);
    stack.push(...[...(paper.childrenOf.get(next) ?? [])].reverse());
  }
  return out;
}

function buildParents(paper: PaperIndex): DraftGroup[] {
  const groups: DraftGroup[] = [];
  for (const question of paper.questions) {
    const parts = paper.childrenOf.get(question.label);
    if (parts === undefined || parts.length === 0) continue;
    const range = rangeOf(question);
    const firstLine = question.text.split('\n')[0] ?? '';
    groups.push({
      id: `question:${question.label}`,
      kind: 'parent-question',
      label: headingLabel(firstLine),
      memberLabels: parts,
      anchor: range,
      stimulus: parentStimulus(paper, question),
    });
  }
  return groups;
}

/** Every question label a group covers: its members and their sub-parts, plus a parent's own stem. */
function coverageOf(paper: PaperIndex, group: DraftGroup): Set<string> {
  const covered = new Set<string>();
  if (group.kind === 'parent-question') covered.add(group.id.slice('question:'.length));
  for (const member of group.memberLabels) {
    covered.add(member);
    for (const d of descendantsOf(paper, member)) covered.add(d);
  }
  return covered;
}

function isSuperset(outer: ReadonlySet<string>, inner: ReadonlySet<string>): boolean {
  for (const label of inner) if (!outer.has(label)) return false;
  return true;
}

/**
 * Groups and placements for one text paper. Pure: no I/O, no model, no logging.
 */
export function groupPaperQuestions(input: TextPaperGroupingInput): TextPaperQuestionGrouping {
  const paper = indexPaper(input);
  const unresolved: UnresolvedStructure[] = [];
  const { groups: sectionGroups, placed } = buildSections(
    paper,
    findSections(input, unresolved),
    unresolved,
  );
  const rangeStimuli = buildRangeStimuli(paper, unresolved);
  const headingStimuli =
    input.nonQuestionHeadings === undefined
      ? []
      : buildHeadingStimuli(paper, input.nonQuestionHeadings, rangeStimuli.length + 1, unresolved);

  const drafts: DraftGroup[] = [];
  const seenShapes = new Set<string>();
  for (const group of [
    ...sectionGroups,
    ...rangeStimuli,
    ...headingStimuli,
    ...buildChoices(paper, placed, unresolved),
    ...buildParents(paper),
  ]) {
    const shape = `${group.kind}|${group.memberLabels.join('\u0000')}`;
    if (seenShapes.has(shape)) continue;
    seenShapes.add(shape);
    drafts.push(group);
  }

  const covered = new Map(drafts.map((g) => [g.id, coverageOf(paper, g)] as const));
  const firstIndex = (g: DraftGroup): number =>
    Math.min(...[...(covered.get(g.id) ?? [])].map((l) => paper.orderOf.get(l) ?? 0));
  const ordered = [...drafts].sort(
    (a, b) =>
      firstIndex(a) - firstIndex(b) ||
      (covered.get(b.id)?.size ?? 0) - (covered.get(a.id)?.size ?? 0) ||
      KIND_NESTING_RANK[a.kind] - KIND_NESTING_RANK[b.kind],
  );

  const groups: TextPaperQuestionGroup[] = ordered.map((group, i) => {
    const own = covered.get(group.id) ?? new Set<string>();
    let parentGroupId: string | undefined;
    for (let j = 0; j < i; j++) {
      const candidate = ordered[j] as DraftGroup;
      if (isSuperset(covered.get(candidate.id) ?? new Set(), own)) parentGroupId = candidate.id;
    }
    return {
      id: group.id,
      kind: group.kind,
      label: group.label,
      ...(parentGroupId === undefined ? {} : { parentGroupId }),
      memberLabels: group.memberLabels,
      ...(group.choose === undefined ? {} : { choose: group.choose }),
      anchor: group.anchor,
      stimulus: group.stimulus,
    };
  });

  const placements: QuestionPlacement[] = paper.questions.map((question) => ({
    label: question.label,
    groupPath: ordered.filter((g) => covered.get(g.id)?.has(question.label)).map((g) => g.id),
    isStem: (paper.childrenOf.get(question.label)?.length ?? 0) > 0,
  }));

  return {
    groups,
    placements,
    ...(unresolved.length > 0 ? { unresolved } : {}),
  };
}

/** Groups for a markdown past paper, from `segmentPastPaper`'s result and the note's own source text. */
export function groupMarkdownPastPaper(
  segmentation: PastPaperSegmentationResult,
  source: string,
): TextPaperQuestionGrouping {
  return groupPaperQuestions({
    questions: segmentation.questions,
    text: source,
    nonQuestionHeadings: segmentation.nonQuestionHeadings,
  });
}

/**
 * The text `segmentPlainTextPastPaper`'s character ranges index into: every page with text, in page
 * order, joined by one newline. Restated from that module's private stitching, in the same order and
 * with the same filter; `paper-question-groups.spec.ts` asserts every segmented question's range
 * reads back its own text, so the two cannot drift silently.
 */
export function plainTextPaperText(extraction: ExtractionResult): string {
  return [...extraction.pages]
    .sort((a, b) => a.page - b.page)
    .filter((p) => p.units.length > 0)
    .map((p) => p.units.map((u) => u.text).join(''))
    .join('\n');
}

/**
 * Groups for an extracted-text past paper. An unsegmented paper has no questions to group, so it
 * returns no groups and no placements — its `reason` already says why.
 */
export function groupPlainTextPastPaper(
  extraction: ExtractionResult,
  segmentation: PlainTextPastPaperSegmentationResult,
): TextPaperQuestionGrouping {
  if (segmentation.status !== 'segmented') return { groups: [], placements: [] };
  return groupPaperQuestions({
    questions: segmentation.questions,
    text: plainTextPaperText(extraction),
  });
}
