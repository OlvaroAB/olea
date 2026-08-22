/**
 * Instrument formats as they exist **in her vault** (F2.1, F2.15, C5.3, C1.4).
 *
 * Two formats, two owners, and the difference is the whole reason this file
 * has two halves:
 *
 *   - **Q&A and cloze are somebody else's format.** C5.3 requires them to stay
 *     readable and editable in an Obsidian spaced-repetition plugin, so their
 *     shape is not ours to design — see `card-format.ts` for what the target
 *     format is and where that was established from.
 *   - **MCQ is Olea's own** (F2.15 — no SR plugin defines an MCQ format, so
 *     there is nothing for ours to interoperate with). See `mcq-format.ts`
 *     for the block and why it looks the way it does.
 *
 * Every parsed shape carries `raw` and `span`. That is not diagnostics — it is
 * how INV-2 survives contact with this module. A caller that wants to change
 * one instrument in a note edits its span through `block/edit.ts`; a caller
 * that merely read a note has nothing to write back, because reading produced
 * no re-rendered text to write.
 */

/** A byte range in the note's source, in UTF-16 code units. */
export interface SourceSpan {
  readonly start: number;
  /** Exclusive, such that `source.slice(start, end) === raw`. */
  readonly end: number;
}

/**
 * The four Q&A shapes the target SR plugin defines. Named for what they are in
 * that plugin's own settings (`singleLineCardSeparator`,
 * `singleLineReversedCardSeparator`, `multilineCardSeparator`,
 * `multilineReversedCardSeparator`) so the mapping is checkable rather than
 * remembered.
 */
export type QaCardStyle =
  | 'single-line'
  | 'single-line-reversed'
  | 'multi-line'
  | 'multi-line-reversed';

/** The cloze delimiters this module recognises. See `card-format.ts` for why bold is not one. */
export type ClozeDelimiter = '==' | '{{';

interface VaultInstrumentCommon {
  /** The exact source slice this instrument was parsed from. */
  readonly raw: string;
  readonly span: SourceSpan;
  /**
   * A `^blockid` found on the instrument's own line, if any (C1.4). Read here,
   * written only where `card-format.ts` documents that it writes one.
   */
  readonly blockId: string | null;
  /**
   * Another plugin's scheduling comment attached to this card, verbatim and
   * including its delimiters, or `null`.
   *
   * **Read-only, always.** C5.3's single-owner rule for scheduling state cuts
   * both ways: we do not read this as authority and we never write, edit or
   * delete it. It is surfaced so that
   * a card she has already been reviewing elsewhere can be *recognised* as
   * such, and so that its bytes are excluded from the card's answer text
   * rather than being shown to her as part of the answer.
   */
  readonly foreignScheduling: string | null;
}

export interface QaCardInstrument extends VaultInstrumentCommon {
  readonly type: 'qa';
  readonly style: QaCardStyle;
  readonly front: string;
  readonly back: string;
  /** True for the two reversed styles, which the plugin also reviews back-to-front. */
  readonly reversed: boolean;
}

export interface ClozeCardInstrument extends VaultInstrumentCommon {
  readonly type: 'cloze';
  readonly delimiter: ClozeDelimiter;
  /** Text on the line before the deletion. */
  readonly before: string;
  /** The blanked span, without its delimiters. */
  readonly clozeText: string;
  /** Text on the line after the deletion. */
  readonly after: string;
}

export type CardInstrument = QaCardInstrument | ClozeCardInstrument;

/**
 * **F2.15's floor, enforced at the parse/serialize boundary.**
 *
 * The pool is distractors only; the correct answer is not one of them. Four is
 * not a round number picked for tidiness: `PRESENTED_DISTRACTORS` of them are
 * sampled per presentation, so a pool of exactly three cannot rotate — sampling
 * three from three shows her the same options every time, and a repeated item
 * degrades into remembering which option was right last time, which is the
 * exact degradation F2.15 exists to prevent. A block below this floor is not a
 * slightly-worse MCQ; it is a different instrument wearing the same name, and
 * it fails to parse rather than being accepted and quietly under-rotating.
 *
 * The generation schema enforces the same floor on the way in (amendment §5.2,
 * `ol-fyc`). Two boundaries, one number, deliberately: generation is not the
 * only way an MCQ can reach the vault — she can type one — and the parse
 * boundary is the one every MCQ crosses.
 */
export const MIN_DISTRACTOR_POOL = 4;

/** How many distractors a single presentation samples from the pool (F2.15). */
export const PRESENTED_DISTRACTORS = 3;

/** Options shown per presentation: the sampled distractors plus the answer. */
export const PRESENTED_OPTIONS = PRESENTED_DISTRACTORS + 1;

export interface McqInstrument {
  readonly type: 'mcq';
  /**
   * The `id:` field, or `null` for a block that has none.
   *
   * Hand-authored MCQs will not have one and are still valid instruments —
   * the format can *express* identity, which is all this bead owes; deriving
   * and stamping a stable instrument id for an un-`id`'d block belongs to
   * queue composition, and is filed rather than smuggled in here.
   */
  readonly id: string | null;
  readonly stem: string;
  readonly answer: string;
  /** At least `MIN_DISTRACTOR_POOL` of them, guaranteed by the parser. */
  readonly distractors: readonly string[];
  /** Shown after she answers, regardless of correctness (F3.4's explanation). `null` when absent. */
  readonly feedback: string | null;
  /** The whole fenced block including both fence lines, byte-exact. */
  readonly raw: string;
  readonly span: SourceSpan;
  /**
   * The fence characters this block was actually written with, and the line
   * terminator it actually uses.
   *
   * These are *format* facts, not content, and they are carried for the same
   * reason `CodeBlock.fence` is: serializing a parsed instrument back has to be
   * a round-trip, not a reformat. Without them, writing an MCQ back would
   * normalise a `~~~~` fence to ``` ``` ``` and a CRLF note to LF — a diff she
   * never asked for, in the one place INV-2 is defined.
   */
  readonly fence: string;
  readonly terminator: '\n' | '\r\n';
}

/** Why a block that announced itself as an MCQ is not one. */
export type McqInvalidReason =
  | 'missing-stem'
  | 'missing-answer'
  | 'repeated-field'
  | 'insufficient-distractors'
  | 'duplicate-option'
  | 'empty-value'
  | 'unknown-field';

/**
 * A block that opened with the MCQ fence and did not parse.
 *
 * Reported, never dropped. A quiz item that vanishes silently because of a
 * typo is worse than one that never existed: she wrote it, she expects to see
 * it, and nothing tells her why she does not.
 */
export interface InvalidMcqBlock {
  readonly reason: McqInvalidReason;
  /** Human-readable specifics — which field, how many distractors were found. */
  readonly detail: string;
  readonly raw: string;
  readonly span: SourceSpan;
}
