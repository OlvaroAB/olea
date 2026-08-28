/**
 * Question-shaped heading detection (F2.10, `ol-f210bead`).
 *
 * F2.10's own words: *"Where a note heading reads as a question and has no
 * card, offer one — 'this looks like a question but has no card yet' — never
 * create it silently. Toggleable in settings. Her notes are already written
 * this way, which makes this plausibly the highest value-per-effort feature
 * in the product."*
 *
 * **This module is the detection half only.** It answers two pure
 * questions — "does this heading read as a question" and "does it already
 * have a card" — and returns candidates. It does not render an offer, does
 * not touch settings, and does not create anything; the toggle F2.10 asks
 * for is the caller's business (whether to call `detectHeadingOffers` at
 * all), not a parameter this module carries, matching `course/lifecycle.ts`'s
 * "detection proposes, it never creates" shape for the same kind of clause.
 * Wiring the result onto a real surface — where and how "this looks like a
 * question" appears, and what accepting it does — is a separate bead; see
 * this module's README-equivalent note in the owning bead's close evidence
 * for the exact seam.
 *
 * ## The detection rules, and why each one is here
 *
 * Every rule is a closed, declared word list — never fitted against a corpus
 * (component register 1c's declared/derived line) — chosen for **conservative
 * bias**: F2.10's contract phrasing already banks on this ("a missed heading
 * is recoverable [it is simply not offered this pass — see the latency
 * brief's §2.2], a junk offer costs trust"), so every rule below is written
 * to accept a false negative over a false positive.
 *
 *  - **`question-mark`** — the heading ends with a literal `?`. English
 *    reserves that mark for exactly one thing; nothing else is read as
 *    equivalent to it.
 *  - **`yes-no-inversion`** — the heading opens with an auxiliary or modal
 *    verb ("Is", "Does", "Can", "Should", ...). Subject-auxiliary inversion is
 *    the grammatical marker English uses for a yes/no question even with no
 *    terminal punctuation ("Is photosynthesis reversible"), so word order
 *    alone is enough here.
 *  - **`wh-inversion`** — the heading opens with a wh-word ("What", "How",
 *    "Why", ...) *and* the very next word is also an auxiliary or modal verb
 *    ("What is...", "How does..."). The wh-word by itself is deliberately not
 *    a rule: "How Enzymes Work" and "Why Evolution Matters" are declarative
 *    topic titles that happen to start with a wh-word, and a rule matching on
 *    the wh-word alone would offer a card against every heading shaped like
 *    that. Requiring the inversion is what keeps this rule inside the actual
 *    interrogative pattern.
 *
 * A heading matching none of these is not offered. That is the intended
 * shape of the bias, not a gap — a title-cased topic heading with no
 * question-shaped punctuation or word order is exactly the case F2.10 asks
 * this feature to leave alone.
 *
 * ## "Has no card" — why the coverage window is wider than the heading's own content
 *
 * `block/outline.ts`'s `OutlineNode.contentIndices` deliberately excludes a
 * heading's nested sub-headings' content — the right scope for outline
 * walking, wrong for this check. Here the question is "would offering a card
 * against this heading be redundant", and a card that already exists three
 * levels down under this heading answers that question exactly as well as
 * one sitting directly beneath it — a student who has broken a question
 * heading into sub-headings and answered one of them there has not left the
 * question unanswered in any sense F2.10 cares about. So `detectHeadingOffers`
 * checks the heading's full subtree — itself plus every block under every
 * descendant heading, stopping only at the next heading of equal or higher
 * level (or end of source) — for an existing instrument. Conservative bias
 * again: this is the wider of the two reasonable windows, and the wider
 * window is the one that avoids the junk offer.
 *
 * Existing instrument locations are a caller-supplied fact, not something
 * this module goes and finds — same "caller supplies the fact" split
 * `course/lifecycle.ts` uses for `knownCourseCodes`. In practice a caller
 * gets them by parsing the same source with `instrument/card-format.ts`'s
 * `parseCards` and `instrument/mcq-format.ts`'s `parseMcqBlocks` and passing
 * through each result's `.span` — this module takes only the spans, never the
 * instruments themselves, so it stays agnostic to which instrument kind
 * (Q&A, cloze, MCQ) satisfied a heading.
 *
 * INV-1 / §7.1: pure. No `obsidian`, no vault I/O, no clock, no network,
 * nothing stored — same inputs in, same candidates out, forever.
 */

import type { Block, ParsedDocument } from '../block/types.js';
import type { SourceSpan } from '../instrument/types.js';
import type { HeadingOfferCandidate, HeadingQuestionRule } from './types.js';

/** Words that open an English interrogative clause on their own (wh-questions). Declared, not fitted — see the module doc. */
const WH_WORDS: ReadonlySet<string> = new Set([
  'who',
  'whom',
  'whose',
  'what',
  'which',
  'when',
  'where',
  'why',
  'how',
]);

/**
 * Auxiliary and modal verbs whose appearance before the subject is the
 * grammatical marker of an English yes/no question (subject-auxiliary
 * inversion). Declared, not fitted — see the module doc.
 */
const AUX_VERBS: ReadonlySet<string> = new Set([
  'is',
  'are',
  'was',
  'were',
  'am',
  'do',
  'does',
  'did',
  'can',
  'could',
  'shall',
  'should',
  'will',
  'would',
  'may',
  'might',
  'must',
  'has',
  'have',
  'had',
]);

/**
 * Strips leading/trailing markdown emphasis markers (`*`, `_`) only — the
 * decoration around a bolded or italicised heading, not part of the words —
 * so `**What is X?**` is read the same as `What is X?`. Nothing inside the
 * text is touched.
 */
function stripEmphasis(text: string): string {
  return text
    .replace(/^[*_]+/, '')
    .replace(/[*_]+$/, '')
    .trim();
}

function firstTwoWords(text: string): readonly [string, string | undefined] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return [words[0] ?? '', words[1]];
}

/**
 * Does `headingText` read as a question? Returns the rule that matched, or
 * `null`. Exported on its own — separate from `detectHeadingOffers` — so the
 * pure word-shape question can be tested and reasoned about without a
 * `ParsedDocument` fixture.
 */
export function isQuestionShapedHeading(headingText: string): HeadingQuestionRule | null {
  const text = stripEmphasis(headingText);
  if (text === '') return null;

  if (text.endsWith('?')) return 'question-mark';

  const [first, second] = firstTwoWords(text);
  const firstLower = first.toLowerCase();

  if (AUX_VERBS.has(firstLower)) return 'yes-no-inversion';

  const secondLower = (second ?? '').toLowerCase();
  if (WH_WORDS.has(firstLower) && AUX_VERBS.has(secondLower)) return 'wh-inversion';

  return null;
}

/**
 * The offset up to which `heading` (at `index`, of `level`) is considered to
 * already have a card — see the module doc's "has no card" section. Stops at
 * the next heading of equal or higher level, or at the end of `source`.
 */
function coverageEndFor(
  blocks: readonly Block[],
  index: number,
  level: number,
  sourceLength: number,
): number {
  for (let i = index + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (block && block.kind === 'heading' && block.level <= level) return block.start;
  }
  return sourceLength;
}

/**
 * Every question-shaped heading in `doc` that has no card yet. Pure: reads
 * only its arguments, creates nothing, and returns `[]` rather than guessing
 * when nothing qualifies.
 *
 * `existingInstrumentSpans` is checked by each span's `start` falling inside
 * a heading's coverage window — an instrument's own start offset is where it
 * was found in the note, and that is the fact this check needs; `end` is not
 * consulted; an instrument that starts inside the window and runs past it
 * (which does not happen for any instrument shape this codebase parses, but
 * this module does not depend on that staying true) still counts as
 * covering.
 */
export function detectHeadingOffers(
  doc: ParsedDocument,
  existingInstrumentSpans: readonly SourceSpan[],
): readonly HeadingOfferCandidate[] {
  const candidates: HeadingOfferCandidate[] = [];

  doc.blocks.forEach((block, index) => {
    if (block.kind !== 'heading') return;

    const rule = isQuestionShapedHeading(block.text);
    if (rule === null) return;

    const coverageEnd = coverageEndFor(doc.blocks, index, block.level, doc.source.length);
    const hasCard = existingInstrumentSpans.some(
      (span) => span.start >= block.start && span.start < coverageEnd,
    );
    if (hasCard) return;

    candidates.push({
      headingText: block.text,
      level: block.level,
      blockIndex: index,
      headingStart: block.start,
      headingEnd: block.end,
      coverageEnd,
      rule,
    });
  });

  return candidates;
}
