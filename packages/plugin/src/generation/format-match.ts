/**
 * `buildFormatMatch` — the production `deps.formatMatch` producer
 * `generation/pipeline.ts`'s `runGenerationSweep` has been able to consult
 * since `ol-0r92.35` but that no caller ever supplied (`ol-v7r5.37`, F4.8,
 * `[D-188]`).
 *
 * **What "format-matched" means here, restated from the contract.** F4.8:
 * her assignments table carries a free-text `type` column, and
 * `assessmentFormatOf` (`packages/core/src/gap/readiness.ts`) maps exactly
 * one value of it — `'quiz'` — to `'mcq'`; everything else, including an
 * absent or unrecognised `type`, is `'unknown'` and never format-matched.
 * `[D-188]`'s purpose clause then says a course whose **nearest, not-yet-passed**
 * assessment resolves to `'mcq'` gets every quiz drafted for it built in that
 * assessment's register — instructor-curated passages supply terminology,
 * past-paper text supplies sentence shape, and where past papers are thin
 * the terminology stands alone (the plain-declarative fallback below that is
 * `quiz.generate.v1`'s own, not this module's).
 *
 * **Where the register hint's two halves come from, and why they are quoted
 * rather than derived.** `../generate/voice-sources.ts`'s `VoiceExemplars`
 * already establishes the discipline this module follows for the identical
 * reason: an "instructor" passage is exemplified by quoting it verbatim, never
 * by extracting keywords from it. `registerSources`
 * (`packages/core/src/source/register.ts`, F1.5/F7.9) is the SAME reader
 * `concept/corpusRelationSignals.ts`'s `assessment-cooccurrence` signal
 * already uses to classify a vault note as a past paper or an objectives
 * document — no second "what counts as course material" heuristic is
 * invented here. For a format-matched course:
 *  - every registered `objectives` markdown source's own paragraphs (split on
 *    blank lines, frontmatter stripped) become `terminology` exemplars,
 *    quoted verbatim;
 *  - every registered `past-paper` markdown source is run through
 *    `segmentPastPaper` (`packages/core/src/source/segment-past-paper.ts`,
 *    P5-T01) and each question/sub-part's own opening sentence — heading and
 *    `(a)`/`(i)` markers stripped — becomes a `sentenceShapes` exemplar.
 *
 * **Markdown sources only** (`Source.format === null`), the same restriction
 * `corpusRelationSignals.ts`'s own `assessment-cooccurrence` signal and
 * `segment-past-paper.ts`'s own module doc both state: a PDF past paper needs
 * `../extract/` extraction and `segment-past-paper-plaintext.ts`'s separate
 * segmenter (`ol-pdfpastpaper`), which this module does not stand up. A
 * course whose registered sources are PDF-only degrades to thin terminology
 * and no sentence shapes — an honest gap, never a guess.
 *
 * **Purity boundary.** `deriveRegisterHint`, `sentenceShapeOf`,
 * `passagesFromMarkdown` and `nearestUpcomingAssessment` are pure — no vault
 * I/O, no clock read, no network — and are exercised directly in
 * `format-match.spec.ts` over literal strings and already-`segmentPastPaper`'d
 * `QuestionBlock`s. Only `buildFormatMatch` itself touches the vault
 * (`registerSources` plus one `vault.read` per registered objectives/past-paper
 * source), and it touches nothing else — no `WorkerTaskTransport`, no
 * generative call, no network of any kind. It runs once per sweep (composed
 * fresh in `main.ts`'s `onUnitsLanded`, mirroring how `draftQuizCardsDeps`
 * and the routing classifier are already read fresh per tick there) and
 * returns a plain synchronous lookup, matching `GenerationPipelineDeps
 * .formatMatch`'s own synchronous signature — `runGenerationSweep` calls it
 * at most once per course it visits, never per concept.
 *
 * **Scope this module deliberately stays inside.** It decides two things
 * only: whether a course is format-matched (`assessmentFormatOf` on its
 * nearest future assessment) and, if so, what register hint to offer. It
 * does not choose which instrument format to build (`quiz.generate.v1`
 * always builds MCQ; `readiness.ts`'s own doc records that mapping as the
 * one entry F4.8 currently states outright) and it never sends a request —
 * `draft-quiz-cards.ts`'s "PURPOSE / REGISTER" section is what forwards
 * `purpose`/`registerHint` onto the wire, verbatim, once `pipeline.ts` has
 * consulted this module's result.
 */

import type {
  AssessmentRecord,
  CalendarDay,
  QuestionBlock,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  assessmentFormatOf,
  calendarDayFromLocalDate,
  isCalendarDay,
  parseDocument,
  registerSources,
  segmentPastPaper,
} from 'olea-core';
import type { FormatMatchDecision } from './pipeline.js';

export type { FormatMatchDecision };

/** Upper bound on how many verbatim exemplars each half of a register hint carries — a few kilobytes of request context, the same order `../generate/voice-sources.ts`'s `DEFAULT_MAX_EXEMPLARS` (8) already sets for the identical "quote a few, not the whole corpus" reason. */
const DEFAULT_MAX_TERMINOLOGY = 8;
const DEFAULT_MAX_SENTENCE_SHAPES = 8;

/** A sentence-shape exemplar longer than this is truncated with an ellipsis rather than dropped — still a real quotation of her paper's phrasing, just bounded. */
const MAX_SHAPE_LENGTH = 160;

export interface RegisterHintResult {
  readonly terminology: readonly string[];
  /** Omitted, never an empty array, when no past-paper sentence shape was found — `deps.formatMatch`'s own doc on `pipeline.ts` reads that absence as "past papers are thin" and falls back to plain declarative wording server-side. */
  readonly sentenceShapes?: readonly string[];
}

export interface DeriveRegisterHintOptions {
  readonly maxTerminology?: number;
  readonly maxSentenceShapes?: number;
}

function dedupePreserveOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * An objectives document's own paragraphs, frontmatter stripped, blank-line
 * separated, trimmed, empty ones dropped — the unit `deriveRegisterHint`
 * quotes verbatim as `terminology`. Pure: takes the note's raw text, nothing
 * else.
 */
export function passagesFromMarkdown(content: string): readonly string[] {
  const doc = parseDocument(content);
  const first = doc.blocks[0];
  const bodyStart = first?.kind === 'frontmatter' ? first.end : 0;
  return content
    .slice(bodyStart)
    .split(/\n\s*\n/)
    .map((passage) => passage.trim())
    .filter((passage) => passage.length > 0);
}

/**
 * A heading line ("## Question 3 (15 marks)") at the start of a top-level
 * `QuestionBlock.text` — see `segment-past-paper.ts`'s own doc on why the
 * top-level text includes it verbatim, ATX `#` markers and all
 * (`HeadingBlock.raw`/`.start`/`.end` span the whole source line;
 * `.text` alone, which the segmenter matches its own question number
 * against, has the markers already stripped).
 */
const HEADING_PREFIX_RE = /^#{0,6}\s*(?:Question\s+)?\d+[.)]?\s*(?:\(\d+\s*marks?\))?\s*/i;
/** A sub-part marker ("(a)", "(ii)") at the start of a sub-part `QuestionBlock.text` — see `segment-past-paper.ts`'s `PART_MARKER_RE`, restated here rather than imported since that constant is module-private there. */
const PART_MARKER_PREFIX_RE = /^\([a-z]+\)\s*/i;
/** The end of the first sentence: `.`, `?` or `:` followed by whitespace or end-of-string. */
const SENTENCE_END_RE = /[.?:](?:\s|$)/;

/**
 * One past-paper question's own opening sentence, heading/marker noise
 * stripped — the unit `deriveRegisterHint` quotes verbatim as a
 * `sentenceShapes` exemplar. `undefined` when nothing but heading/marker
 * text remains (an empty stem), never a fabricated shape. Pure: takes one
 * `QuestionBlock`'s own text, nothing else.
 */
export function sentenceShapeOf(questionText: string): string | undefined {
  const stripped = questionText
    .trim()
    .replace(HEADING_PREFIX_RE, '')
    .replace(PART_MARKER_PREFIX_RE, '')
    .trim();
  if (stripped.length === 0) return undefined;

  const match = SENTENCE_END_RE.exec(stripped);
  const sentence = (match ? stripped.slice(0, match.index + 1) : stripped).trim();
  if (sentence.length === 0) return undefined;

  return sentence.length > MAX_SHAPE_LENGTH
    ? `${sentence.slice(0, MAX_SHAPE_LENGTH).trimEnd()}…`
    : sentence;
}

/**
 * `[D-188]`'s register hint, assembled from already-parsed segments — no
 * vault I/O, no clock, no network. `objectivesPassages` and
 * `pastPaperQuestions` are exactly what `passagesFromMarkdown` and
 * `segmentPastPaper(...).questions` already produce for every registered
 * `objectives`/`past-paper` markdown source of one course; `buildFormatMatch`
 * below is the only caller that assembles those from a real vault.
 */
export function deriveRegisterHint(
  objectivesPassages: readonly string[],
  pastPaperQuestions: readonly QuestionBlock[],
  options: DeriveRegisterHintOptions = {},
): RegisterHintResult {
  const maxTerminology = options.maxTerminology ?? DEFAULT_MAX_TERMINOLOGY;
  const maxSentenceShapes = options.maxSentenceShapes ?? DEFAULT_MAX_SENTENCE_SHAPES;

  const terminology = dedupePreserveOrder(
    objectivesPassages.map((passage) => passage.trim()).filter((passage) => passage.length > 0),
  ).slice(0, maxTerminology);

  const sentenceShapes = dedupePreserveOrder(
    pastPaperQuestions
      .map((question) => sentenceShapeOf(question.text))
      .filter((shape): shape is string => shape !== undefined),
  ).slice(0, maxSentenceShapes);

  return sentenceShapes.length > 0 ? { terminology, sentenceShapes } : { terminology };
}

/**
 * The soonest assessment for `course` whose `due` is a readable calendar day
 * on or after `today` — F4.7's "an assessment whose date has passed exerts
 * no ... weight" read for format matching instead of countdown, mirroring
 * `study-session/build.ts`'s own (module-private) `nextAssessmentOf`
 * tie-break: soonest `due`, then the lexically-smaller `path` so two
 * assessments due the same day never depend on read order. `undefined` when
 * the course has no assessment record with a readable future date — never a
 * guess at which one she meets next.
 */
export function nearestUpcomingAssessment(
  course: string,
  assessments: readonly AssessmentRecord[],
  today: CalendarDay,
): AssessmentRecord | undefined {
  let best: AssessmentRecord | undefined;
  let bestDue: CalendarDay | undefined;
  for (const record of assessments) {
    if (record.course !== course) continue;
    const due = record.due;
    if (due === undefined || !isCalendarDay(due) || due < today) continue;
    const closer =
      bestDue === undefined ||
      due < bestDue ||
      (due === bestDue && best !== undefined && record.path < best.path);
    if (closer) {
      best = record;
      bestDue = due;
    }
  }
  return best;
}

export interface FormatMatchDeps {
  readonly vault: VaultSource;
  /** Every course's assessment records, e.g. `readAssessments(...).records` — the same shape `main.ts`'s `buildReviewSessionInput` already reads for F2.19. */
  readonly assessments: readonly AssessmentRecord[];
  /** Forwarded to `registerSources` — overrides its own `DEFAULT_SOURCES_FOLDER` ('03 Research', F7.9). Omit to use that default. */
  readonly sourcesFolder?: VaultPath;
  /** Defaults to `() => new Date()`. Injectable so a caller (and this module's own spec) can pin "today" rather than racing the clock. */
  readonly now?: () => Date;
}

/**
 * Composes `GenerationPipelineDeps.formatMatch` (`pipeline.ts`) for real:
 * reads every course's nearest not-yet-passed assessment, decides which
 * courses are format-matched (F4.8), and — only for those, so a course with
 * no MCQ-format assessment near costs no extra vault read — reads and
 * segments its registered objectives/past-paper sources into a register
 * hint. Returns a plain synchronous lookup, matching
 * `GenerationPipelineDeps.formatMatch`'s own signature; every I/O this
 * function does happens before that closure is returned, never inside it.
 *
 * `main.ts`'s `onUnitsLanded` is the one production caller — see that
 * method's own comment for why this is composed fresh per sweep rather than
 * once at `onload`, the same "read whatever is current" posture
 * `draftQuizCardsDeps` and the routing classifier already take there.
 */
export async function buildFormatMatch(
  deps: FormatMatchDeps,
): Promise<(courseCode: string) => FormatMatchDecision | undefined> {
  const decisions = new Map<string, FormatMatchDecision>();

  const courses = new Set<string>();
  for (const record of deps.assessments) {
    if (record.course !== undefined) courses.add(record.course);
  }
  if (courses.size === 0) return (courseCode) => decisions.get(courseCode);

  const today = calendarDayFromLocalDate(deps.now ? deps.now() : new Date());
  const matchedCourses: string[] = [];
  for (const course of courses) {
    const nearest = nearestUpcomingAssessment(course, deps.assessments, today);
    if (nearest !== undefined && assessmentFormatOf(nearest.type) === 'mcq') {
      matchedCourses.push(course);
    }
  }
  if (matchedCourses.length === 0) return (courseCode) => decisions.get(courseCode);

  const report = await registerSources(
    deps.vault,
    deps.sourcesFolder !== undefined ? { sourcesFolder: deps.sourcesFolder } : {},
  );

  for (const course of matchedCourses) {
    const objectivesSources = report.sources.filter(
      (source) =>
        source.course === course && source.role === 'objectives' && source.format === null,
    );
    const pastPaperSources = report.sources.filter(
      (source) =>
        source.course === course && source.role === 'past-paper' && source.format === null,
    );

    const objectivesPassages: string[] = [];
    for (const source of objectivesSources) {
      const content = await deps.vault.read(source.path);
      objectivesPassages.push(...passagesFromMarkdown(content));
    }

    const pastPaperQuestions: QuestionBlock[] = [];
    for (const source of pastPaperSources) {
      const content = await deps.vault.read(source.path);
      pastPaperQuestions.push(...segmentPastPaper(source.path, content).questions);
    }

    decisions.set(course, {
      registerHint: deriveRegisterHint(objectivesPassages, pastPaperQuestions),
    });
  }

  return (courseCode) => decisions.get(courseCode);
}
