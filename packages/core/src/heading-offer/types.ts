/**
 * Question-shaped heading detection (F2.10) — types.
 *
 * See `./detect.ts` for the module doc covering scope, the detection rules
 * and why "has no card" is checked the way it is. This file only names the
 * shapes that cross the boundary between this module and its caller.
 */

/**
 * Which detection rule matched, kept on the candidate rather than discarded
 * once a match is found. `[D-072]`'s reachability clause aside, a caller
 * building the eventual student-visible copy ("this looks like a question")
 * may want to phrase a bare `?` differently from an un-punctuated inversion
 * ("Is X true"), and re-deriving the rule from the heading text a second time
 * at the UI layer would silently drift from whatever this module decided.
 */
export type HeadingQuestionRule = 'question-mark' | 'yes-no-inversion' | 'wh-inversion';

/**
 * One question-shaped heading with no card yet — F2.10's candidate for
 * "offer one." Never created here: this module proposes, exactly the
 * "detection proposes, it never creates" shape `course/lifecycle.ts` uses for
 * F1.3/C7.8, applied to F2.10.
 */
export interface HeadingOfferCandidate {
  /** `HeadingBlock.text` (block/types.ts) — the heading exactly as written, markers and surrounding whitespace already stripped by the block parser. Display-only; never a join key. */
  readonly headingText: string;
  /** `HeadingBlock.level`, 1-6. */
  readonly level: number;
  /** Index of the heading block in `ParsedDocument.blocks` — the source location a caller places a decoration or a card-creation prefill against. */
  readonly blockIndex: number;
  /** `HeadingBlock.start` — UTF-16 offset of the heading line itself in the note's source. */
  readonly headingStart: number;
  /** `HeadingBlock.end` — exclusive, the heading line's own extent. */
  readonly headingEnd: number;
  /**
   * Exclusive UTF-16 offset up to which this heading is considered to
   * already have a card — the heading's own content plus every block under
   * every nested sub-heading, stopping only at the next heading of equal or
   * higher level (or end of source). See `detectHeadingOffers`'s doc for why
   * the coverage check is scoped this wide rather than to the heading's own
   * immediate content only.
   */
  readonly coverageEnd: number;
  readonly rule: HeadingQuestionRule;
}
