/**
 * **RULED — D-030, option (b): stamped identity, the anchor-first rule.**
 *
 * `instrumentId` is *persisted identity*. It keys every `SchedulerState` (R3),
 * it lands in an append-only review log that has no rename event, and it is the
 * dedupe key of `mergeReviewLogRecords`. Change the derivation after a semester
 * of study and every instrument whose id moved reads as a brand-new item with
 * no history, while the history it did have is stranded against a string
 * nothing produces any more. There is no migration for that which does not
 * itself need a stable id to migrate *from*.
 *
 * David ruled D-030 2026-08-15 and confirmed it a second time 2026-08-16 on a
 * stronger argument (`ol-5qjz`): **an id is written into the note once and
 * thereafter only ever READ. The derivation exists solely to MINT an id that
 * is missing, never to recompute one that exists.** That is the whole
 * decision — after first sight, identity is *data*, not a computation — and it
 * is the same shape this module already had provisionally, which is why
 * ruling it did not require rewriting the rule below, only building the write
 * half that was deliberately left unbuilt until the ruling existed to build it
 * against:
 *
 *   - **One seam, unchanged.** `InstrumentIdSource` is still the only way an
 *     id is minted anywhere in the pipeline. `enumerateVaultInstruments` takes
 *     one, defaults to `provisionalInstrumentId`, and nothing downstream
 *     constructs an id.
 *   - **One implementation site, unchanged.** `provisionalInstrumentId` below
 *     is still the only function in the repo that assembles an instrument id
 *     from parts — the read half of read-then-mint.
 *   - **The write half now exists, elsewhere.** `mcq-format.ts`'s
 *     `stampMcqId` and `card-format.ts`'s `stampQaCardBlockId` are the two
 *     idempotent, `applyDocumentEdits`-only functions that turn a *missing*
 *     explicit id / block id into a durable one, once. Once either has run on
 *     an instrument, this module's rule below reads that stamp back verbatim
 *     forever (rule 1 and rule 4's block-id branch) — position never
 *     contributes again. **Cloze has no stamping path.** A cloze *is* her
 *     line, so a visible marker would sit inside the card text and break
 *     C5.3's stays-readable-and-editable property; a frontmatter-side id map
 *     was investigated as the candidate fix and found not to be the drop-in
 *     reuse of `uid/stamp.ts` it looked like (see `ol-k7eg`'s notes for what
 *     specifically doesn't hold). It remains open, ruled to be David's call
 *     rather than an implementer's, and a cloze's id is still purely derived
 *     — the weaker, position-based guarantee — until it is answered.
 *   - **The prefix still marks what it always marked.** Every id this
 *     function mints starts with `PROVISIONAL_ID_PREFIX` — not because the
 *     *rule* is provisional (it is ruled), but because the *id* is: it is
 *     what a caller sees for an instrument that has not been stamped yet
 *     (including every cloze, always, and an MCQ or Q&A card before its first
 *     review). "Which ids are still waiting on a stamp" stays answerable from
 *     one log line rather than by dating it.
 *
 * ## The rule, and why each part of it
 *
 *   1. **An explicit id wins.** An MCQ block carrying `id:` already states its
 *      own identity in her vault (`mcq-format.ts`), and a derivation that
 *      overrode it would make the field a lie. Nothing about the block's
 *      position contributes; that is the whole point of writing one down. A
 *      block with no `id:` gets one from `stampMcqId`, not from here.
 *   2. **The note's `olea-uid` is the root**, where the note has one. It is
 *      already this repo's note-identity primitive (`uid/stamp.ts`,
 *      `uid/table.ts`) and it survives a rename, which a path does not.
 *   3. **The note path is the root where there is no `olea-uid`** — and this
 *      module **never stamps one**. See the hard constraint below.
 *   4. **Then the instrument's anchor**: its `^blockid` (C1.4) where it has
 *      one, else the text of the nearest heading above it. Her notes are
 *      question-headed, so the heading is a real anchor and not a fallback —
 *      but it is still a *position*, not a stamp, and only used when there is
 *      no block id yet. A Q&A card with no block id gets one from
 *      `stampQaCardBlockId`, the same way an MCQ block does from `stampMcqId`;
 *      a cloze has neither a stamping path nor a block id to fall back to, so
 *      it stays on the heading (or the note path) for good, until the open
 *      question above is answered.
 *   5. **Then an ordinal within that anchor** — never a note-wide ordinal.
 *      This is the part that is easy to get wrong and expensive to discover:
 *      with a note-wide ordinal, inserting a card at the top of a note shifts
 *      every later card's id by one, and every one of them silently inherits
 *      the scheduling history of the card that used to sit in its slot. An
 *      ordinal scoped to the anchor moves only when cards are inserted under
 *      *that* anchor, which is a far smaller blast radius and is what
 *      `instrument-id.spec.ts` pins.
 *
 * ## The hard constraint: this file itself writes nothing
 *
 * There is no stamping *in this module*, and there must not be — it stays a
 * pure function of the note and the instrument's position in it, callable
 * before any stamp exists (that is what a transient, `PROVISIONAL_ID_PREFIX`
 * id is for) and after one does (that is what rules 1 and 4 short-circuit
 * into). The actual writes live beside the formats they stamp
 * (`mcq-format.ts`, `card-format.ts`), through `applyDocumentEdits`, and
 * *when* they run — on enumeration versus on first review of that specific
 * instrument — is a decision for whatever drives the review pipeline
 * (`ol-k7eg`'s notes recommend first-review, the smaller promise), not for
 * this module.
 *
 * ## What a replacement has to preserve
 *
 * Whatever a future case (cloze, or a wider ruling) adds, these are the
 * properties the pipeline is built on: the derivation is a **pure function**
 * of the note and the instrument's position in it; it is **stable** across a
 * run that reads the same bytes twice; it does not change when an unrelated
 * instrument is inserted elsewhere in the same note; it needs **no write** to
 * compute; and once an explicit id or block id exists, it is **read, never
 * recomputed** — even if the position that would have produced it has since
 * changed underneath it.
 */

import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type { VaultPath } from '../vault/types.js';

/**
 * Marks every id minted by the unruled rule. Greppable in a review log, in a
 * `SchedulerState` key, and in a bug report.
 */
export const PROVISIONAL_ID_PREFIX = 'prov1';

/** Where an instrument sits, as far as identity is concerned. */
export interface InstrumentIdInput {
  /** The note's `olea-uid` frontmatter value, or `null` when it carries none. */
  readonly noteUid: string | null;
  /** Vault-relative path of the note. The root when there is no `olea-uid`. */
  readonly notePath: VaultPath;
  /** The instrument's own `^blockid` (C1.4), or `null`. */
  readonly blockId: string | null;
  /** Text of the nearest heading above the instrument, or `null` when there is none. */
  readonly heading: string | null;
  /**
   * 1-based position **within this instrument's anchor**, in source order.
   * Never within the note — see the module doc's point 5.
   */
  readonly ordinal: number;
  /** An id the instrument already carries in her vault (MCQ `id:`), or `null`. */
  readonly explicitId: string | null;
  readonly instrumentType: SchedulableInstrumentType;
}

/**
 * The single seam. Everything that needs an instrument id calls one of these
 * and nothing assembles a string itself.
 */
export type InstrumentIdSource = (input: InstrumentIdInput) => string;

/**
 * Percent-escapes the three characters the id format uses as structure, plus
 * `%` itself so the escaping is reversible. Without this a heading containing a
 * colon could collide with a different anchor/ordinal pair, and an id collision
 * is two instruments sharing one schedule.
 */
function escapeComponent(value: string): string {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A').replace(/#/g, '%23');
}

/** `^blockid` where there is one, `h:<heading>` where there is a heading, `-` otherwise. */
function anchorComponent(input: InstrumentIdInput): string {
  if (input.blockId !== null && input.blockId !== '') return `^${escapeComponent(input.blockId)}`;
  if (input.heading !== null && input.heading !== '') {
    return `h${escapeComponent(input.heading)}`;
  }
  return '-';
}

/**
 * The provisional derivation. See the module doc for the rule and for what a
 * D-030 ruling has to preserve.
 *
 * Pure, total, and free of I/O: it is handed everything it needs and reads
 * nothing else.
 */
export const provisionalInstrumentId: InstrumentIdSource = (input) => {
  if (input.explicitId !== null && input.explicitId !== '') return input.explicitId;

  const root = escapeComponent(
    input.noteUid !== null && input.noteUid !== '' ? input.noteUid : input.notePath,
  );
  return `${PROVISIONAL_ID_PREFIX}:${root}#${anchorComponent(input)}:${String(input.ordinal)}`;
};
