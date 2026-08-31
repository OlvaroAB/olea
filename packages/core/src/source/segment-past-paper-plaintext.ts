/**
 * `segmentPlainTextPastPaper` — question segmentation for a past-paper
 * `Source` whose text came from `../extract/` (PDF today; any future format
 * that yields plain `ExtractedUnit`s the same way) rather than from her own
 * markdown (`ol-pdfpastpaper`).
 *
 * **This is a sibling of `./segment-past-paper.js`, not a reuse of it.**
 * `segmentPastPaper` earns its safety from two properties of the *markdown
 * block parser*: only `paragraph` blocks are ever inspected for a `(x)`
 * marker (a `code`/`list` block never is), and a page-break artifact is its
 * own `thematicBreak` block, so it can never masquerade as a marker or close
 * an open part. Extracted PDF text has **no block kinds at all** — every
 * line is just a line — so neither argument is available here. A censused
 * 42-paper, 901-page real past-paper corpus (measurement only; no course
 * codes or quoted text belong outside that file — see
 * `olea-service/findings/H4-past-paper-question-structure.md`, cited by path
 * per this project's INV-3 convention) found the anticipated `(x)` sub-part
 * form in only 10 of 42 papers, a 61% false-positive rate on that regex
 * applied to raw text (`(Intercept)` — an R-console token — being the
 * majority contributor), and a naive line-wise top-level-question regex
 * producing 17–167 matches per paper against a true count of 5–18. So this
 * module does not port `segmentPastPaper`'s regexes onto raw text; it is
 * deliberately more conservative, on the reasoning the corpus's own finding
 * states explicitly: a plain-text segmenter needs its own, differently
 * argued defences, not the markdown segmenter's borrowed ones.
 *
 * **The defences this module actually uses:**
 *
 * 1. **Furniture stripping by repetition, not by content.** A line whose
 *    exact (normalised) text recurs on at least half of a multi-page
 *    document's pages (`FURNITURE_MIN_PAGE_FRACTION`) is treated as a
 *    running header or footer artifact and is never considered a candidate
 *    question anchor or part marker. This needs no institution-specific
 *    word list — real prose essentially never repeats verbatim across half
 *    a document, so the *shape* of repetition is evidence enough, the same
 *    principle `../concept/evidence.js`'s `detectBoilerplateHeads` already
 *    uses for slide-template headings (there: repeated leading phrase
 *    across several *documents*; here: repeated whole line across several
 *    *pages* of one document).
 * 2. **A positive test for a marker, not a merely non-negative one.** A
 *    top-level anchor requires either the literal word "Question" plus a
 *    number, or a number followed by a delimiter and visible prose on the
 *    same paragraph — never a bare digit run with nothing after it (which is
 *    what a page-footer fraction or a plot's axis tick renders as in
 *    extracted text). A sub-part marker requires a **single** letter inside
 *    parentheses — `(a)`, not `(Intercept)` — which is what the finding's
 *    §5.6 names as the actual majority shape of the false positives the
 *    original marker regex accepts.
 * 3. **No roman-vs-letter nesting.** `segmentPastPaper`'s letter/roman state
 *    machine (module doc there, point 2) has no correct firing anywhere in
 *    the censused corpus — every `(x)`-roman token it would classify is
 *    actually a top-level sibling sub-part with no lettered parent, so the
 *    heuristic only ever mis-nests. This module does not attempt a second
 *    nesting level at all: every recognised `(x)` marker is a flat, direct
 *    child of the top-level question. This is a documented simplification,
 *    exactly the way `segmentPastPaper` documents its own roman-marker
 *    limitation — a paper whose sub-parts container legitimately reaches two
 *    levels deep collapses to one level here, which loses structure but
 *    never invents a wrong parent.
 * 4. **Degrade to "unsegmented", never guess.** A document that yields no
 *    recognised top-level anchor at all, or whose anchors repeat a label
 *    already used (the shape both a restarting section numbering and a
 *    concatenated question+answer booklet produce — findings §3 and §5.1),
 *    is reported with `status: 'unsegmented'` and a plain-English `reason`.
 *    No `QuestionBlock`s are fabricated from a shape this module cannot
 *    trust, and the caller is never left inferring "zero questions" from an
 *    empty array with no explanation — the same honest-report convention
 *    `SourceRegistrationReport` and `ExtractionOutcome` already use.
 *
 * **What this module deliberately does not attempt**, because the corpus
 * finding is explicit that chasing a segmentation rate against the
 * anticipated structure would hide rather than fix the real failure shapes:
 * the F3 duplicate question/answer-booklet join, continuation headers that
 * re-open a question, and per-section numbering restarts. All three surface
 * as a duplicate top-level label and degrade this document to
 * `'unsegmented'` rather than silently double-counting or mis-splitting.
 *
 * **Provenance is a documented deviation from `../extract/types.js`'s
 * general convention.** That module's `SourceLocation` doc says `charRange`
 * is always relative to *that page's own* extracted text. A past-paper
 * question routinely overflows one PDF page (a long-answer part filling
 * most of a page, its closing lines wrapping onto the next), and
 * `QuestionBlock.provenance` — reused unchanged from `./segment-past-paper.js`
 * so a caller sees ONE shape regardless of source format — carries only one
 * `page` and one `charRange`. This module resolves that the same way
 * `segmentPastPaper` resolves its own single-page markdown note: all of a
 * source's pages are stitched into one continuous text (pages joined by a
 * single `\n`, preserving each page's own text byte-for-byte) and
 * `charRange` is an offset into *that* stitched text, not into one page's
 * text alone. `location.page` still names the real PDF page the block's
 * *own* content starts on — genuinely useful information markdown's fixed
 * `page: 1` never had — so a citation can point a reader at "roughly here,"
 * even though the exact offset spans the stitched document rather than one
 * page in isolation.
 *
 * **D-005 / `ol-pdfmeta`: nothing here reads or surfaces PDF document
 * metadata.** This module's only input is `ExtractionResult`, which
 * `../extract/pdf.ts` already builds from page *content* alone — it has no
 * `/Info` dictionary field anywhere in its shape, so there is nothing for
 * this module to accidentally propagate into a log or a report reason.
 *
 * **Anchor-recognition coverage (`ol-m0kx`, diagnosed by `ol-j4p4`).** The
 * finding's own §3 catalogues six distinct top-level question-numbering
 * conventions actually observed in the censused corpus. Five of them share
 * one shape this module already matches — a number (via `QUESTION_KEYWORD_RE`,
 * `NUMBER_DELIM_RE` or `NUMBER_BARE_RE`) immediately followed by visible
 * prose on the same paragraph, however that number is dressed (`"3."`,
 * `"Question 3."`, a bare gutter integer, a bare gutter integer immediately
 * preceding a restated `"Q3."` label). The sixth — a capital letter with no
 * number at all (`"A. Using examples, outline…"`, findings §3, §5.11) — was
 * genuinely invisible to every prior anchor and is what `LETTER_DELIM_RE`
 * adds. It is deliberately **capital-letter-only**: every lettered *sub-part*
 * and MCQ-option form the censused corpus uses (`a.`, `a)`, `(a)`, `i.`,
 * `(i)`) is lowercase (findings §4.1), so requiring a capital letter is a
 * positive test that never overlaps the widespread lowercase conventions —
 * it does not "extend" `PART_MARKER_RE`'s territory, it recognises a
 * genuinely disjoint shape. The one convention this module still does not
 * attempt to disambiguate is the restated `"Question N."` in an F3 answer
 * booklet (findings §5.1, §5.2): that already matches the existing number
 * anchor, and matching it is exactly what makes the duplicate-label guard
 * below fire and degrade the document, which is the correct, conservative
 * outcome for a shape this module cannot safely resolve — not a gap to
 * close by guessing which occurrence is the real one.
 */

import type { ExtractionResult } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';
import type { QuestionBlock } from './segment-past-paper.js';

/**
 * Declared, not fitted (per this project's constants rule): a line whose
 * exact text repeats on at least this fraction of a document's pages reads
 * as PDF furniture (a running header or footer), never as question content.
 * Real prose does not repeat verbatim across half a multi-page document;
 * this is a structural property of how PDF extractors emit repeated page
 * chrome, not a number tuned against any specific paper.
 */
const FURNITURE_MIN_PAGE_FRACTION = 0.5;

/**
 * Declared, not fitted: no exam or test paper in this product's domain runs
 * to 200 questions. A top-level anchor number above this is far more likely
 * to be extraction noise — a page-count fragment, a timestamp, an axis
 * value, a session code — than a real question label, so it is never
 * treated as one.
 */
const MAX_TOP_LEVEL_QUESTION_NUMBER = 200;

/** `"Question 3"` — the one anchor form the censused corpus never actually used, kept for forward tolerance. Also what a restated `"Question 2."` in an F3 answer booklet matches — see the module doc's coverage note for why that is the correct outcome, not a gap. */
const QUESTION_KEYWORD_RE = /^Question\s+(\d{1,4})\b/i;
/** `"3."` / `"3)"` followed by visible prose on the same paragraph — never a bare trailing delimiter. Also the form the F3 booklet's `"3. This question refers to…"` restatement matches (findings §3). */
const NUMBER_DELIM_RE = /^(\d{1,4})[.)]\s*(?=\S)/;
/** A bare digit run immediately followed by a letter — `"3 Briefly outline…"` — never followed by another digit (an axis-tick run) or punctuation (a footer fraction, a session code). This is also what the "gutter integer plus restated `Q3.` label" convention matches through (findings §3): the leading digit is read as the anchor and the following `"Q3."` token is absorbed as this question's own prose. */
const NUMBER_BARE_RE = /^(\d{1,4})\s+(?=[A-Za-z])/;

/**
 * A single **capital** letter followed by `.`/`)` and visible prose on the
 * same paragraph — `"A. Using examples, outline…"` (findings §3,
 * "capital-letter top-level items, no number at all"; observed as PSYCH305's
 * unnumbered Section 2 essay alternatives, findings §5.11). Capital-only is
 * the load-bearing choice, not an arbitrary restriction: every lettered
 * sub-part and MCQ-option form the censused corpus actually uses — `a.`,
 * `a)`, `(a)`, `i.`, `(i)` — is lowercase (findings §4.1), so this never
 * overlaps them; it is a positive test for a genuinely disjoint shape, not a
 * loosening of the existing one.
 */
const LETTER_DELIM_RE = /^([A-Z])[.)]\s*(?=\S)/;
/**
 * Declared, not fitted: the censused corpus's own lettered-alternative
 * documents never go past `D` (4 options). `F` leaves headroom for a paper
 * with a couple more alternatives without accepting an entire capitalised
 * outline (`A.` … `Z.`) as one implausibly-long run of top-level questions —
 * the same reasoning `MAX_TOP_LEVEL_QUESTION_NUMBER` applies to the numeric
 * form.
 */
const MAX_TOP_LEVEL_LETTER = 'F';

/** A single letter in parentheses — `"(a)"`, never `"(Intercept)"` (findings §5.6) or a roman-numeral run (`"(ii)"`, two characters). */
const PART_MARKER_RE = /^\(([a-zA-Z])\)/;

/**
 * Plain-text-specific mark patterns. Deliberately not shared with
 * `./segment-past-paper.js`'s `MARKS_PATTERNS` — that module's patterns stay
 * exactly as they were (task instruction: the markdown path is unchanged).
 * Two differences, both traced to censused failure shapes:
 *  - The captured number now allows a decimal (`\d+(?:\.\d+)?`), which fixes
 *    a silent wrong-value bug in the shared pattern shape: `"[1.5 marks]"`
 *    used to fall through to the bare pattern and match the substring
 *    `"5 marks"`, silently reporting 5 instead of 1.5 (findings §5.8).
 *  - A `"Maximum marks: N"` pattern is added, ahead of the bare fallback, so
 *    that form (invisible to all three of the shared module's patterns —
 *    findings §5.7, 390 occurrences across 22 of 42 papers) is read where
 *    stated, and so it is preferred over a same-span rubric sentence like
 *    "There is a total of 10 marks for these questions." that the bare
 *    fallback would otherwise seize on instead.
 */
const MARKS_PATTERNS_PLAINTEXT: readonly RegExp[] = [
  /\((\d+(?:\.\d+)?)\s*marks?\)/i,
  /\[(\d+(?:\.\d+)?)\s*marks?\]/i,
  /\bMaximum\s+marks?\s*:\s*(\d+(?:\.\d+)?)/i,
  /\b(\d+(?:\.\d+)?)\s*marks?\b/i,
];

function extractMarksPlainText(text: string): number | undefined {
  for (const pattern of MARKS_PATTERNS_PLAINTEXT) {
    const match = pattern.exec(text);
    const captured = match?.[1];
    if (captured === undefined) continue;
    const value = Number(captured);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

/** One page's worth of already-extracted text, ready to stitch. */
interface PageText {
  readonly page: number;
  readonly text: string;
}

/** Where one stitched page's text sits in the stitched document. */
interface PageBounds {
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

interface Stitched {
  readonly text: string;
  readonly bounds: readonly PageBounds[];
}

/** Joins every page's text into one continuous document, `\n`-separated, tracking each page's own span for `pageForOffset`. */
function stitchPages(pages: readonly PageText[]): Stitched {
  const parts: string[] = [];
  const bounds: PageBounds[] = [];
  let cursor = 0;
  for (const p of pages) {
    if (parts.length > 0) {
      parts.push('\n');
      cursor += 1;
    }
    const start = cursor;
    parts.push(p.text);
    cursor += p.text.length;
    bounds.push({ page: p.page, start, end: cursor });
  }
  return { text: parts.join(''), bounds };
}

function pageForOffset(bounds: readonly PageBounds[], offset: number): number {
  for (const b of bounds) {
    if (offset >= b.start && offset < b.end) return b.page;
  }
  return bounds[bounds.length - 1]?.page ?? 1;
}

interface Line {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      lines.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return lines;
}

function isBlankLine(line: Line): boolean {
  return line.text.trim() === '';
}

function normalizeLine(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Every normalised line that recurs on at least `FURNITURE_MIN_PAGE_FRACTION`
 * of the document's pages — see the module doc's furniture-stripping
 * defence. Requires at least 2 distinct pages regardless of the fraction, so
 * a one- or two-page document never has a line suppressed on repetition
 * alone.
 */
function computeFurnitureLines(lines: readonly Line[], bounds: readonly PageBounds[]): Set<string> {
  const pagesByLine = new Map<string, Set<number>>();
  for (const line of lines) {
    if (isBlankLine(line)) continue;
    const normalized = normalizeLine(line.text);
    if (normalized === '') continue;
    const page = pageForOffset(bounds, line.start);
    let pages = pagesByLine.get(normalized);
    if (pages === undefined) {
      pages = new Set();
      pagesByLine.set(normalized, pages);
    }
    pages.add(page);
  }

  const threshold = Math.max(2, Math.ceil(bounds.length * FURNITURE_MIN_PAGE_FRACTION));
  const furniture = new Set<string>();
  for (const [normalized, pages] of pagesByLine) {
    if (pages.size >= threshold) furniture.add(normalized);
  }
  return furniture;
}

interface Paragraph {
  readonly start: number;
  readonly end: number;
  readonly firstLine: string;
}

/** Blank-line-delimited runs of text, spanning page joins freely (a page break with no blank line around it never splits a paragraph — the same immunity `segmentPastPaper`'s A6 argues for, reached by a different mechanism). */
function splitParagraphs(lines: readonly Line[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && isBlankLine(lines[i] as Line)) i++;
    if (i >= lines.length) break;
    const first = lines[i] as Line;
    let j = i;
    while (j < lines.length && !isBlankLine(lines[j] as Line)) j++;
    const last = lines[j - 1] as Line;
    paragraphs.push({ start: first.start, end: last.end, firstLine: first.text });
    i = j;
  }
  return paragraphs;
}

/**
 * Matches a top-level question anchor against a paragraph's first line and
 * returns its label, honouring `MAX_TOP_LEVEL_QUESTION_NUMBER` for a numeric
 * anchor and `MAX_TOP_LEVEL_LETTER` for a lettered one. `undefined` when
 * nothing matches or the matched anchor is implausible. The numeric and
 * lettered regex families never both match the same line — every numeric
 * form requires the paragraph's first character to be a digit and
 * `LETTER_DELIM_RE` requires it to be a bare capital letter — so there is no
 * ordering question between them.
 */
function matchTopLevelAnchor(firstLine: string): string | undefined {
  const numberMatch =
    QUESTION_KEYWORD_RE.exec(firstLine) ??
    NUMBER_DELIM_RE.exec(firstLine) ??
    NUMBER_BARE_RE.exec(firstLine);
  const numberCaptured = numberMatch?.[1];
  if (numberCaptured !== undefined) {
    const value = Number(numberCaptured);
    if (!Number.isFinite(value) || value > MAX_TOP_LEVEL_QUESTION_NUMBER) return undefined;
    return String(value);
  }

  const letterCaptured = LETTER_DELIM_RE.exec(firstLine)?.[1];
  if (letterCaptured !== undefined && letterCaptured <= MAX_TOP_LEVEL_LETTER) {
    return letterCaptured;
  }
  return undefined;
}

export type PlainTextSegmentationStatus = 'segmented' | 'unsegmented';

/**
 * The plain-text sibling of `PastPaperSegmentationResult`. A discriminated
 * union rather than an optional `reason` field, so "why nothing segmented"
 * can never be silently absent when `status` says it should be present —
 * the same shape discipline `ExtractionOutcome` and
 * `SourceRegistrationReport` already use in this package.
 */
export type PlainTextPastPaperSegmentationResult =
  | {
      readonly sourcePath: VaultPath;
      readonly status: 'segmented';
      readonly questions: readonly QuestionBlock[];
    }
  | {
      readonly sourcePath: VaultPath;
      readonly status: 'unsegmented';
      /** Plain-English, content-free (D-005 / INV-3: never a quoted line, never a course name) reason this document could not be split with acceptable confidence. */
      readonly reason: string;
      readonly questions: readonly [];
    };

function unsegmented(sourcePath: VaultPath, reason: string): PlainTextPastPaperSegmentationResult {
  return { sourcePath, status: 'unsegmented', reason, questions: [] };
}

/**
 * Segments one past-paper `Source`'s already-extracted content
 * (`../extract/registry.js#extractFromVault`'s result for it) into the same
 * `QuestionBlock` shape `./segment-past-paper.js` produces for a markdown
 * past paper — see the module doc for what is shared (the output shape) and
 * what is not (the reasoning that makes producing it safe).
 *
 * Reachability: wired, not merely planned — `../tier3-evidence/build.ts`'s
 * `role === 'past-paper' ? segmentPlainTextPastPaper(result) : undefined`
 * line calls this for every registered past-paper source and is what
 * produces every `kind: 'past-paper'` citation the real corpus yields
 * (confirmed by `ol-j4p4`'s diagnosis; a stale "nothing calls this yet" note
 * lived here until `ol-m0kx`). `../evidence-edge/build.ts` also imports this
 * module directly for its own re-segmentation path. This coverage fix
 * (`ol-m0kx`) does not change the caller — it only widens which of the
 * caller's inputs come back `'segmented'` instead of `'unsegmented'`.
 */
export function segmentPlainTextPastPaper(
  extraction: ExtractionResult,
): PlainTextPastPaperSegmentationResult {
  const { sourcePath, outcome, pages } = extraction;

  if (outcome === 'unreadable' || outcome === 'empty-document' || outcome === 'no-pages-found') {
    return unsegmented(
      sourcePath,
      `extraction outcome was '${outcome}' — no page text was available to segment`,
    );
  }

  const pageTexts: PageText[] = [...pages]
    .sort((a, b) => a.page - b.page)
    .filter((p) => p.units.length > 0)
    .map((p) => ({ page: p.page, text: p.units.map((u) => u.text).join('') }));

  if (pageTexts.length === 0) {
    return unsegmented(
      sourcePath,
      `extraction outcome was '${outcome}' but every page stayed on the vision route or yielded no text — nothing was available to segment`,
    );
  }

  const stitched = stitchPages(pageTexts);
  const lines = splitLines(stitched.text);
  const furniture = computeFurnitureLines(lines, stitched.bounds);
  const paragraphs = splitParagraphs(lines);

  interface Span {
    start: number;
    end: number;
  }

  const order: string[] = [];
  const parentOf = new Map<string, string | undefined>();
  const spans = new Map<string, Span>();
  const seenTopLabels = new Set<string>();

  let currentTopLabel: string | undefined;
  let currentLabel: string | undefined;

  for (const paragraph of paragraphs) {
    const firstLineNormalized = normalizeLine(paragraph.firstLine);
    const isFurniture = furniture.has(firstLineNormalized);
    let handled = false;

    if (!isFurniture) {
      const topLabel = matchTopLevelAnchor(paragraph.firstLine);
      if (topLabel !== undefined) {
        const label = topLabel;
        if (seenTopLabels.has(label)) {
          // A restarting section (findings §3) and a concatenated
          // question/answer booklet (findings §5.1) both produce exactly
          // this shape — the same top-level label opened a second time.
          // Neither is safe to resolve by guessing which occurrence is
          // real, so the whole document degrades rather than emitting
          // silently duplicated or silently merged blocks.
          return unsegmented(
            sourcePath,
            `duplicate top-level question label "${label}" — likely a concatenated ` +
              'question/answer booklet or numbering that restarts partway through the paper',
          );
        }
        seenTopLabels.add(label);
        order.push(label);
        parentOf.set(label, undefined);
        spans.set(label, { start: paragraph.start, end: paragraph.end });
        currentTopLabel = label;
        currentLabel = label;
        handled = true;
      } else if (currentTopLabel !== undefined) {
        const partMatch = PART_MARKER_RE.exec(paragraph.firstLine);
        const letter = partMatch?.[1];
        if (letter !== undefined) {
          const label = `${currentTopLabel}(${letter.toLowerCase()})`;
          const existing = spans.get(label);
          if (existing === undefined) {
            order.push(label);
            parentOf.set(label, currentTopLabel);
            spans.set(label, { start: paragraph.start, end: paragraph.end });
          } else {
            existing.end = paragraph.end;
          }
          currentLabel = label;
          handled = true;
        }
      }
    }

    if (!handled && currentLabel !== undefined) {
      const span = spans.get(currentLabel);
      if (span !== undefined) span.end = paragraph.end;
    }
    // Content before the first recognised anchor (front matter, rubric,
    // instructions) and any furniture line is discarded rather than
    // attributed to a question it does not belong to — the same convention
    // `segmentPastPaper` follows for content outside any heading.
  }

  if (order.length === 0) {
    return unsegmented(
      sourcePath,
      'no recognisable question-numbering pattern found in the extracted text',
    );
  }

  const questions: QuestionBlock[] = order.map((label) => {
    const span = spans.get(label) as Span;
    const text = stitched.text.slice(span.start, span.end);
    return {
      label,
      parentLabel: parentOf.get(label),
      text,
      marks: extractMarksPlainText(text),
      provenance: {
        sourcePath,
        location: {
          page: pageForOffset(stitched.bounds, span.start),
          charRange: { start: span.start, end: span.end },
        },
      },
    };
  });

  return { sourcePath, status: 'segmented', questions };
}
