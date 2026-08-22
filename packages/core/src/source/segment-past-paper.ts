/**
 * `segmentPastPaper` — per-question segmentation for past-paper `Source`s
 * (F1.5, F7.9, P5-T01).
 *
 * Per-question blocks are the reason this bead exists (see the P5-T01 task
 * brief): the exam oracle (F4.2–F4.4) clusters on individual questions, not
 * on a wall of past-paper text, so each question — and each addressable
 * sub-part — has to survive ingestion as its own citable unit.
 *
 * **Reuses `../block/parse.js` and `../block/outline.js` rather than
 * regexing raw text**, per the task instructions: `buildOutline` already
 * groups a heading with the blocks that belong to it (up to the next
 * heading), which is exactly the top-level "one question, its stem, its
 * lists, its code blocks" grouping this module needs. What it adds on top:
 *
 * 1. **Which headings are questions.** A heading matches `TOP_LEVEL_QUESTION_RE`
 *    ("Question 3", "3.", "3)") or it doesn't. A non-matching heading (a
 *    section divider like "Section B — Short Answer Questions") contributes
 *    no `QuestionBlock` and is reported separately in `nonQuestionHeadings`
 *    — present, not silently dropped, matching the honest-report convention
 *    `../assessment/types.js` sets.
 * 2. **Multi-part sub-structure.** Real past papers write sub-parts
 *    (`(a)`, `(b)`, `(i)`, `(ii)`) as their own paragraphs, not as nested
 *    headings, so `buildOutline` alone cannot see them — a question's whole
 *    `(a)`...`(b)(ii)` structure would otherwise land as one undifferentiated
 *    blob. This module scans each question's own content blocks *in document
 *    order* for a leading `(x)` marker at the start of a paragraph block
 *    (never inside a list item or code block — see the disambiguation note
 *    below) and threads a small state machine through them: a marker is a
 *    new **letter** part unless a **lettered part is already open**, in
 *    which case a roman-numeral token (`i`, `ii`, ... `xii`) is read as a
 *    sub-part nested one level under it. This is a deliberate simplification
 *    (documented the way `../extract/embeds.js` documents its own link-
 *    resolution simplification): a paper that used a bare `(v)` as a
 *    *letter* part, rather than roman five, would misparse. Not exercised by
 *    the fixture past paper and worth a discovered-from bead if a real paper
 *    ever needs it.
 *
 * **Why a code block or a list inside a question cannot break this**: only
 * `paragraph` blocks are ever inspected for a `(x)` marker. A `code` or
 * `list` block is never a candidate — it is always absorbed as content of
 * whichever part is currently open, exactly like a plain paragraph with no
 * marker. This is what makes segmentation immune to "split on blank lines":
 * a code block or list surrounded by blank lines looks, line-by-line,
 * exactly like a paragraph boundary, but it is not a *marker* boundary, and
 * only marker boundaries end a part here.
 *
 * **Why a page break inside a question cannot break this**: a page-break
 * artifact from PDF-to-markdown transcription — this module's fixture uses a
 * thematic-break line (`***`) — is not a `paragraph` block either (the block
 * parser gives it its own `thematicBreak` kind), so it is never inspected
 * for a marker and never closes the currently-open part. Content immediately
 * following it keeps accumulating into whatever part was open before the
 * break, which is what lets "3(b)(i)" run right up to a page boundary and
 * "3(b)(ii)" pick up cleanly on the far side, both still filed under `3(b)`.
 */

import { buildOutline } from '../block/outline.js';
import { parseDocument } from '../block/parse.js';
import type { Block, OutlineNode } from '../block/types.js';
import type { CharRange, Provenance } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * One addressable question or sub-part. Flat, not a tree — `parentLabel`
 * threads the hierarchy (`"3(b)(ii)"` → `"3(b)"` → `"3"` → `undefined`) so a
 * caller can walk up or down without this module committing to one
 * tree-shape API. `label` mirrors how a human would cite it: `"3"`,
 * `"3(a)"`, `"3(b)(ii)"`.
 */
export interface QuestionBlock {
  readonly label: string;
  /** `undefined` for a top-level question; its immediate parent's `label` otherwise. */
  readonly parentLabel: string | undefined;
  /**
   * This part's own text, verbatim from the source — the top-level
   * question's `text` includes its own heading line (so "Question 3 (15
   * marks)" is part of "3"'s citable text); a sub-part's `text` is the exact
   * concatenation of the blocks between its own marker and the next one, own
   * heading not applicable since sub-parts are never headings (see module
   * doc, point 2).
   */
  readonly text: string;
  /**
   * Best-effort mark allocation, tried against parenthetical (`(10 marks)`),
   * bracketed (`[5 marks]`), and bare (`6 marks`) forms in that order.
   * `undefined`, never guessed, when none match — past papers are not
   * consistent about stating marks on every sub-part, and a fabricated
   * default would be worse than an honest gap here (same principle
   * `AssessmentRecord.weight` follows).
   */
  readonly marks: number | undefined;
  /**
   * Where this block came from, reusing `../extract/types.js`'s `Provenance`
   * shape rather than inventing a parallel one — the exam oracle (F4.2–F4.4)
   * will eventually need to cite past-paper evidence and generic extracted
   * material through the same shape. `location.page` is always `1`: a
   * markdown past-paper note has no page concept of its own, the same
   * reasoning `../extract/docx.js` documents for why *its* pages are always
   * `1`. `location.charRange` is exact — `[start, end)` into the note's raw
   * source text — so a citation can quote the precise span, not just name
   * the note.
   */
  readonly provenance: Provenance;
}

/** A heading that looked like it might be a question boundary but did not match `TOP_LEVEL_QUESTION_RE` — e.g. a section divider. Reported, not dropped. */
export interface NonQuestionHeading {
  readonly text: string;
  readonly charRange: CharRange;
}

export interface PastPaperSegmentationResult {
  readonly sourcePath: VaultPath;
  /**
   * Every question and sub-part, flattened. Order is document order: a
   * top-level question is emitted before its own sub-parts, and sub-parts in
   * the order their markers first appear — so a caller building a tree from
   * `parentLabel` never has to sort.
   */
  readonly questions: readonly QuestionBlock[];
  readonly nonQuestionHeadings: readonly NonQuestionHeading[];
}

/** `"Question 3"`, `"3."`, `"3)"`, bare `"3"` — the leading token that marks a heading as a question. */
const TOP_LEVEL_QUESTION_RE = /^(?:Question\s+)?(\d+)\b/i;

/** A leading `(x)` marker at the very start of a paragraph's text — letter or roman, disambiguated by `classifyMarker`. */
const PART_MARKER_RE = /^\(([a-z]+)\)\s*/i;

/**
 * Roman-numeral sub-part tokens this module recognises, i–xii — past papers
 * rarely nest deeper than that. See the module doc's disambiguation note for
 * why this is a fixed whitelist rather than general roman-numeral parsing.
 */
const ROMAN_TOKENS: ReadonlySet<string> = new Set([
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
  'xi',
  'xii',
]);

const MARKS_PATTERNS: readonly RegExp[] = [
  /\((\d+)\s*marks?\)/i,
  /\[(\d+)\s*marks?\]/i,
  /\b(\d+)\s*marks?\b/i,
];

function extractMarks(text: string): number | undefined {
  for (const pattern of MARKS_PATTERNS) {
    const match = pattern.exec(text);
    const captured = match?.[1];
    if (captured === undefined) continue;
    const value = Number(captured);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Depth-first flatten of an outline tree — a question's heading can appear at any nesting depth, so every node is a candidate regardless of level. */
function flattenOutline(nodes: readonly OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const node of nodes) {
    out.push(node);
    out.push(...flattenOutline(node.children));
  }
  return out;
}

/** Per-label bookkeeping while scanning one question's content blocks. */
interface LabelState {
  readonly order: string[];
  readonly ownIndices: Map<string, number[]>;
  readonly parentOf: Map<string, string | undefined>;
}

function openLabel(state: LabelState, label: string, parent: string | undefined): void {
  if (state.ownIndices.has(label)) return;
  state.ownIndices.set(label, []);
  state.parentOf.set(label, parent);
  state.order.push(label);
}

/**
 * Splits one question's `contentIndices` into the top-level question plus
 * any lettered/roman sub-parts, per the module doc's state machine.
 */
function splitIntoParts(
  topLabel: string,
  blocks: readonly Block[],
  indices: readonly number[],
): LabelState {
  const state: LabelState = {
    order: [topLabel],
    ownIndices: new Map([[topLabel, []]]),
    parentOf: new Map([[topLabel, undefined]]),
  };

  let currentLabel = topLabel;
  let currentLetter: string | undefined;

  for (const index of indices) {
    const block = blocks[index];
    if (block === undefined) continue;

    if (block.kind === 'paragraph') {
      const match = PART_MARKER_RE.exec(block.raw.trimStart());
      const token = match?.[1];
      if (token !== undefined) {
        const isRoman = currentLetter !== undefined && ROMAN_TOKENS.has(token.toLowerCase());
        if (isRoman) {
          const label = `${topLabel}(${currentLetter})(${token})`;
          openLabel(state, label, `${topLabel}(${currentLetter})`);
          currentLabel = label;
        } else {
          currentLetter = token;
          const label = `${topLabel}(${token})`;
          openLabel(state, label, topLabel);
          currentLabel = label;
        }
        state.ownIndices.get(currentLabel)?.push(index);
        continue;
      }
    }

    state.ownIndices.get(currentLabel)?.push(index);
  }

  return state;
}

export function segmentPastPaper(
  sourcePath: VaultPath,
  source: string,
): PastPaperSegmentationResult {
  const doc = parseDocument(source);
  const outline = flattenOutline(buildOutline(doc));

  const questions: QuestionBlock[] = [];
  const nonQuestionHeadings: NonQuestionHeading[] = [];

  const provenanceFor = (charRange: CharRange): Provenance => ({
    sourcePath,
    location: { page: 1, charRange },
  });

  for (const node of outline) {
    const headingMatch = TOP_LEVEL_QUESTION_RE.exec(node.heading.text.trim());
    const topLabel = headingMatch?.[1];
    if (topLabel === undefined) {
      nonQuestionHeadings.push({
        text: node.heading.text,
        charRange: { start: node.heading.start, end: node.heading.end },
      });
      continue;
    }

    const state = splitIntoParts(topLabel, doc.blocks, node.contentIndices);

    for (const label of state.order) {
      const isTop = label === topLabel;
      const indices = state.ownIndices.get(label) ?? [];
      const ownBlocks = indices
        .map((i) => doc.blocks[i])
        .filter((b): b is Block => b !== undefined);
      const lastBlock = ownBlocks[ownBlocks.length - 1];

      const start = isTop ? node.heading.start : (ownBlocks[0]?.start ?? node.heading.end);
      const end = lastBlock !== undefined ? lastBlock.end : isTop ? node.heading.end : start;
      const text = isTop
        ? source.slice(node.heading.start, end)
        : ownBlocks.map((b) => b.raw).join('');
      const marksSource = isTop ? node.heading.text : text;

      questions.push({
        label,
        parentLabel: state.parentOf.get(label),
        text,
        marks: extractMarks(marksSource),
        provenance: provenanceFor({ start, end }),
      });
    }
  }

  return { sourcePath, questions, nonQuestionHeadings };
}
