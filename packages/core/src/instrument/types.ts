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
 * The pool is distractors only; the correct answer is not one of them.
 *
 * **Lowered from 4 to 2 by `[D-195]` / `ol-2zfj.57`.** Before this ruling the
 * number here and `quiz.generate.v1`'s own `MIN_DISTRACTOR_POOL`
 * (`olea-service/src/tasks/quizGenerate.ts`) meant the same thing: a floor of
 * four *grounded* distractors, required on both the way in and the way out.
 * `[D-195]` found that coupling was itself the padding pressure it exists to
 * prevent — a model held to four grounded misconceptions manufactures a
 * fourth belief when only two or three genuinely exist for a concept — and
 * split the two numbers on purpose. The service's floor is now a
 * GENERATION-TIME minimum (2, unchanged by this bead); this one is the
 * PERSISTED/PRESENTATION floor, below which a block fails to parse and
 * `presentMcq` refuses outright — lowered to match, so the client can accept
 * and present exactly what a short-but-honest grounded pool actually
 * contains rather than reject or pad it. `scripts/check-instrument-floor.mjs`
 * (`olea-service`) documents the split and no longer asserts the two numbers
 * equal.
 *
 * **What this floor no longer guarantees on its own: rotation.**
 * `PRESENTED_DISTRACTORS` (below) draws up to that many from the pool, and at
 * the old floor of 4 that meant a genuine sample (`C(4,3) = 4` distinct
 * option sets). At this floor, a pool of exactly 2 or 3 cannot be sampled
 * down to 3 — `mcq-present.ts`'s `presentMcq` presents `min(
 * PRESENTED_DISTRACTORS, pool.length)` of them instead, shuffled, and never
 * pads with an invented option. F2.15's amendment names this "shuffle-only"
 * path as the ratified degrade: a short pool presents everything it has,
 * rather than being padded to hit a count or withheld outright. A block
 * below THIS floor (2) is still not a slightly-worse MCQ; it is a different
 * instrument wearing the same name, and it still fails to parse rather than
 * being accepted and quietly under-rotating.
 *
 * The generation schema enforces its own floor on the way in (amendment §5.2,
 * `ol-fyc`; renumbered to 2 by `[D-195]`). Two boundaries, two numbers now,
 * deliberately: generation is not the only way an MCQ can reach the vault —
 * she can type one — and the parse boundary is the one every MCQ crosses,
 * regardless of how honest the pool that reaches it is.
 */
export const MIN_DISTRACTOR_POOL = 2;

/**
 * How many distractors a single presentation samples from the pool (F2.15),
 * **when the pool is at least this large.** Below it — a pool of exactly
 * `MIN_DISTRACTOR_POOL` or anywhere between the two — `presentMcq` shows
 * `min(PRESENTED_DISTRACTORS, pool.length)` instead; see `mcq-present.ts`.
 */
export const PRESENTED_DISTRACTORS = 3;

/**
 * Options shown per presentation **at or above `PRESENTED_DISTRACTORS`'s own
 * pool size**: the sampled distractors plus the answer. A short pool (`[D-195]`)
 * presents `min(PRESENTED_DISTRACTORS, pool.length) + 1` instead — this
 * constant is the ceiling, not a guarantee, once `MIN_DISTRACTOR_POOL` no
 * longer equals `PRESENTED_DISTRACTORS + 1`'s own precondition.
 */
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
  /**
   * The `predecessor:` field — `[D-133]`'s revision-chain link, or `null` for
   * a block with none (every hand-authored MCQ, and any generated one that
   * is not a successor). Written once, by whatever materializes a successor
   * instrument (`packages/plugin/src/generation/materialize-mcq.ts`), never
   * recomputed thereafter — the same read-then-mint discipline `id` follows.
   * Names the PREDECESSOR instrument's id; this block's own id (above) is
   * the successor. The metadata-position field is the single source of
   * truth for the chain (see `packages/plugin/src/instrument-blocks/
   * predecessor.ts`'s module doc) — the review log's `succession` kind
   * records only the fact that succession happened, never a copy of it.
   */
  readonly predecessor: string | null;
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
