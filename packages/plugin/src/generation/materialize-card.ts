/**
 * `materializeAcceptedCardDraft` — the write path for a generated, unanchored
 * Q&A card (F2.1, F3.4, INV-6, `ol-0r92.116`, ruling `[D-353]`).
 *
 * ## Why this file exists, and what it is not
 *
 * `[D-353]` (David, 2026-09-25, ruled on `ol-0r92.115`): a generated card
 * with no hand-authored note to anchor it must be written through **a new,
 * dedicated write path built for this case**, mirroring the existing write
 * path for generated MCQ items (`materialize-mcq.ts`'s
 * `materializeAcceptedDraft`) — **never** by stamping a synthetic anchor and
 * reusing `createQaCard` (`olea-core`'s hand-authoring writer, which requires
 * `anchorBlockIndex` — C1.4 anchoring, a fact a generated item cannot
 * supply), and **never** as a second, separate persisted card shape. This
 * file is that dedicated path. It writes the SAME `qa`-instrument block
 * shape (`olea-core`'s `QaCardInstrument`, the multi-line `?`/`??` form) a
 * hand-authored card already produces — `enumerate.ts` and `card-format.ts`
 * read it back exactly as they would her own typing — but never calls
 * `createQaCard`, because that function's whole contract is "the block she
 * ran the command on," which a generated, source-grounded card is not.
 *
 * **The clarification, binding:** this path reuses the existing instrument
 * identity and provenance conventions exactly — the same identity scheme and
 * provenance fields already used elsewhere — rather than inventing new ones.
 * See "THE IDENTITY DERIVATION" below for exactly how. Absence of a note
 * anchor does not waive source-grounding: `input.sourceCitation` is
 * forwarded to the same citation sidecar `materialize-mcq.ts` writes to, on
 * the same terms (present only when the pipeline had one to record; never
 * fabricated).
 *
 * ## Where it writes
 *
 * Same rule `materialize-mcq.ts` states for MCQ, restated because the block
 * shape differs: a card's `sourcePath` is the note that embedded the
 * material it was drafted from, and the card is inserted at the TOP of that
 * note's content — after its frontmatter block when it has one (never
 * before it, for the identical reason `materialize-mcq.ts`'s own doc gives:
 * inserting at literal offset zero would push a leading `topic:`/`course:`
 * frontmatter block down, and `enumerateVaultInstruments` requires
 * frontmatter to be first to bind the note's concept at all — an instrument
 * materialized past that point silently enumerates unbound). This function
 * reproduces that same frontmatter-skip check rather than importing
 * `insertMcqBlock` (MCQ-shaped, wraps a fenced code block — wrong shape for
 * a card) or `createQaCard` (anchored — wrong contract, per `[D-353]`
 * above). The insertion itself goes through `applyDocumentEdits`
 * (`olea-core`), the same round-trip primitive every write path in this
 * codebase uses and nowhere else, so INV-2 byte-identical round-tripping is
 * a property of the primitive, not a promise this file makes on its own.
 *
 * ## THE IDENTITY DERIVATION (`[D-353]`'s clarification, in full)
 *
 * An MCQ block carries its identity as an explicit `id:` field
 * (`stampMcqId`) — `instrument-id.ts`'s rule 1 reads that back forever,
 * position never contributing again. A Q&A card has no equivalent
 * explicit-id field; `instrument-id.ts`'s rule 4 derives a card's identity
 * from `<note root>#^<blockId>:<ordinal>` — the note's `olea-uid` (or its
 * path, where there is none), the card's OWN stamped `^blockId`
 * (`stampQaCardBlockId`, `olea-core`), and its 1-based ordinal among every
 * instrument anchored at that same block id. That is what "reuses the
 * existing identity scheme exactly" means here: this function does not
 * invent a card-specific id format. It:
 *
 *   1. Reads the note's `olea-uid` the same way `enumerate.ts`'s (private,
 *      unexported) `uidOf` does — `parseDocument` + `parseFrontmatter` +
 *      `readScalar(fm, OLEA_UID_KEY)`, all public `olea-core` exports, so
 *      this needs no core change to reproduce faithfully;
 *   2. Mints a deterministic block id for the card's own last line (see
 *      "THE RETRY-ORPHAN ARGUMENT" below) and stamps it with
 *      `stampQaCardBlockId`;
 *   3. Sets `ordinal: 1` — sound because the minted block id is freshly
 *      derived from THIS draft's own identity (see below) and therefore
 *      unique to it; nothing else in the vault is anchored there, so this is
 *      the first (and only) instrument `enumerate.ts`'s own
 *      `blockOrdinals.get(blockId) ?? 0) + 1` will ever count at that anchor
 *      — the same "an anchor unique to one instrument always ordinal-1s"
 *      fact `instrument-id.ts`'s own doc rests rule 4 on;
 *   4. Calls `provisionalInstrumentId` (`olea-core`, the SAME exported
 *      function `enumerate.ts` calls on every vault walk) with that
 *      `noteUid`/`notePath`/`blockId`/`ordinal` — never a hand-rolled
 *      `${prefix}-${hash}` string the way `materialize-mcq.ts`'s
 *      `deriveInstrumentId` builds one for MCQ, because MCQ's `id:` is
 *      itself the final identity (rule 1), while a card's is always
 *      POSITION-derived (rule 4) — reusing the private derivation would
 *      silently drift from whatever `enumerate.ts` computes on the next
 *      vault walk the moment either changes independently. Calling the same
 *      exported function `enumerate.ts` calls is what makes "exactly the
 *      existing identity scheme" a property of the code, not a promise in
 *      this comment: the id this function returns and the id a later vault
 *      walk derives for this same card are, by construction, the same call
 *      to the same function with the same inputs.
 *
 * The returned id therefore carries `[PROVISIONAL_ID_PREFIX]`
 * (`instrument-id.ts`'s own doc: "not because the rule is provisional — it
 * is ruled — but because the id is: what a caller sees for an instrument
 * that has not been stamped yet"). That is correct and expected: a Q&A card
 * has no unstamped/stamped distinction the way MCQ's `id:` field does —
 * every Q&A card's id, hand-authored or generated, is always this
 * derivation. `accept.ts`'s `DraftAcceptPort` treats whatever a materializer
 * returns as the real instrument id regardless of its prefix, so nothing
 * downstream needs to know this.
 *
 * ## THE RETRY-ORPHAN ARGUMENT (mirrors `materialize-mcq.ts`'s own section)
 *
 * `stampQaCardBlockId`'s default block-id mint is random
 * (`crypto.getRandomValues`). If attempt 1 writes the citation sidecar below
 * and is then interrupted before `vault.write` runs, a retry re-inserts the
 * card from scratch and — with the default mint — would derive a SECOND,
 * different block id, orphaning attempt 1's citation record exactly the way
 * `materialize-mcq.ts`'s own "retry-orphan fix" section describes for MCQ.
 * The fix is identical in shape: `deriveCardBlockId` below hashes exactly
 * what a retry of the SAME draft always resupplies identically — `draftId`
 * (folded in first, so two distinct drafts with identical front/back text
 * still diverge — the same argument `materialize-mcq.ts`'s own
 * `deriveInstrumentId` makes for `mcq-` ids), `sourcePath`, `front`, `back`
 * — through `hashText` (`olea-core`, the same SHA-256-hex primitive the
 * stale-input guard below and `materialize-mcq.ts`'s own derivation both
 * already use), mapped into `stampQaCardBlockId`'s own block-id alphabet
 * (`[a-z0-9]`) via `generateBlockId`. A retry against the same unchanged
 * note re-derives the SAME block id, hence the same `provisionalInstrumentId`
 * result, hence the same citation-sidecar path — attempt 1's write is found
 * and left alone (see the guarded `vault.exists` check below), not
 * re-thrown-into.
 *
 * ## The `[ol-0r92.87]` stale-input guard and the `[D-181]` citation sidecar
 *
 * Both reproduced verbatim from `materialize-mcq.ts` — same
 * `StaleSourceRevisionError` class (imported from that module, not
 * redefined, so `accept.ts`'s single `catch` clause keeps working for
 * either kind without change), same "refuse before anything is written"
 * ordering, same "sidecar write is skipped, never fabricated, when the
 * pipeline had nothing to record, and guarded by `vault.exists` so a retry
 * never re-throws into a write a prior attempt already made" posture. There
 * is no distractor-provenance sidecar here — cards have no distractors
 * (`[D-220]` is MCQ-only) — and no `[D-133]` succession handling: nothing
 * drafts a card REVISION yet, so `predecessorInstrumentId` has no producer
 * to forward from (`DraftRecord`'s own field stays `undefined` for every
 * card draft today, same as it would for any caller with nothing to
 * supply).
 */

import {
  applyDocumentEdits,
  type DocumentEdit,
  citationStorePath,
  hashText,
  type InstrumentCitation,
  MULTI_LINE_SEPARATOR,
  OLEA_UID_KEY,
  parseCards,
  parseDocument,
  parseFrontmatter,
  provisionalInstrumentId,
  readScalar,
  stampQaCardBlockId,
  type VaultPath,
  type VaultSource,
  writeInstrumentCitation,
} from 'olea-core';
import { StaleSourceRevisionError } from './materialize-mcq.js';
import type { DraftCardContent } from './types.js';

export { StaleSourceRevisionError };

export interface MaterializeAcceptedCardDraftInput {
  readonly sourcePath: VaultPath;
  readonly card: DraftCardContent;
  /**
   * `DraftRecord.draftId` — see the module doc's "THE RETRY-ORPHAN ARGUMENT"
   * section. `undefined` only for a caller with no draft identity, which
   * falls back to a hash with no draft component (matching
   * `materialize-mcq.ts`'s identical `undefined` fallback for the same
   * reason).
   */
  readonly draftId?: string;
  /**
   * `[D-181]`/`ol-2zfj.52`: the passage this draft was generated from — see
   * `materialize-mcq.ts`'s `MaterializeAcceptedDraftInput.sourceCitation`
   * for the identical field. `undefined` skips the sidecar write entirely.
   */
  readonly sourceCitation?: InstrumentCitation;
  /**
   * `ol-0r92.87`'s stale-input guard — see `materialize-mcq.ts`'s identical
   * field. `undefined` skips the check entirely.
   */
  readonly expectedSourceContentHash?: string;
}

export interface MaterializeAcceptedCardDraftResult {
  readonly instrumentId: string;
}

/** `enumerate.ts`'s private `uidOf`, reproduced from only public `olea-core` exports — see the module doc's "THE IDENTITY DERIVATION" section, step 1. */
function noteUidOf(source: string): string | null {
  const first = parseDocument(source).blocks[0];
  if (first?.kind !== 'frontmatter') return null;
  const uid = readScalar(parseFrontmatter(first.inner), OLEA_UID_KEY).scalar;
  return uid === '' ? null : uid;
}

const CARD_BLOCK_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Deterministic, not `stampQaCardBlockId`'s default random mint — see the
 * module doc's "THE RETRY-ORPHAN ARGUMENT" section. Maps `hashText`'s hex
 * digest into `stampQaCardBlockId`'s own alphabet two hex characters (one
 * byte) at a time, six characters total — the same length
 * `defaultGenerateBlockId` (`card-format.ts`) produces, so a derived id is
 * indistinguishable in shape from a hand-authored one.
 */
async function deriveCardBlockId(input: {
  readonly draftId: string | undefined;
  readonly sourcePath: string;
  readonly card: DraftCardContent;
}): Promise<string> {
  const canonical = JSON.stringify({
    draftId: input.draftId ?? null,
    sourcePath: input.sourcePath,
    front: input.card.front,
    back: input.card.back,
  });
  const digest = await hashText(canonical);
  let id = '';
  for (let i = 0; i < 6; i++) {
    const byte = Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16);
    id += CARD_BLOCK_ID_ALPHABET[byte % CARD_BLOCK_ID_ALPHABET.length];
  }
  return id;
}

export async function materializeAcceptedCardDraft(
  vault: VaultSource,
  input: MaterializeAcceptedCardDraftInput,
): Promise<MaterializeAcceptedCardDraftResult> {
  const source = await vault.read(input.sourcePath);

  // `ol-0r92.87`'s stale-input guard — see the module doc. Checked before
  // anything else so a mismatch never reaches the insert or `vault.write`.
  if (input.expectedSourceContentHash !== undefined) {
    const currentHash = await hashText(source);
    if (currentHash !== input.expectedSourceContentHash) {
      throw new StaleSourceRevisionError(
        `materializeAcceptedCardDraft: ${input.sourcePath} changed since this draft was cached — refusing to accept against content that was never reviewed (F3.3)`,
      );
    }
  }

  if (input.card.front.trim() === '' || input.card.back.trim() === '') {
    throw new Error('materializeAcceptedCardDraft: a card needs both a front and a back');
  }

  const doc = parseDocument(source);
  // "Top of the note" skips a leading frontmatter block — see the module
  // doc's "Where it writes" section (the same `ol-p3t07b` fact
  // `materialize-mcq.ts` states for MCQ).
  const firstBlock = doc.blocks[0];
  const afterBlockIndex = firstBlock?.kind === 'frontmatter' ? 0 : -1;
  const anchor = afterBlockIndex === -1 ? null : (doc.blocks[afterBlockIndex] ?? null);
  // Same terminator rule `insertMcqBlock` (`mcq-format.ts`) uses for the
  // identical unanchored, top-of-note insertion — the note's own dominant
  // line ending, not any one block's.
  const terminator = source.includes('\r\n') ? '\r\n' : '\n';

  const cardText = `${input.card.front.trim()}${terminator}${MULTI_LINE_SEPARATOR}${terminator}${input.card.back.trim()}${terminator}`;

  const next = afterBlockIndex === -1 ? doc.blocks[0] : doc.blocks[afterBlockIndex + 1];
  const followsBlank = next?.kind === 'blank';
  const insertAt = anchor === null ? 0 : followsBlank && next ? next.end : anchor.end;
  const endsWithNewline = insertAt === 0 || source.slice(0, insertAt).endsWith('\n');
  const lead =
    insertAt === 0 ? '' : endsWithNewline ? (followsBlank ? '' : terminator) : `${terminator}${terminator}`;
  const trail = insertAt < source.length ? terminator : '';
  const text = `${lead}${cardText}${trail}`;

  const edits: DocumentEdit[] = [{ kind: 'insert', at: insertAt, text }];
  const inserted = applyDocumentEdits(doc, edits);
  const insertedSpan = inserted.spans[0];
  if (!insertedSpan) {
    throw new Error('materializeAcceptedCardDraft: internal error, missing inserted span');
  }

  const found = parseCards(inserted.content).find(
    (c) => c.span.start >= insertedSpan.start && c.span.end <= insertedSpan.end && c.type === 'qa',
  );
  if (found === undefined) {
    throw new Error(
      'materializeAcceptedCardDraft: could not locate the freshly-inserted Q&A card after insertion',
    );
  }

  // Deterministic — see the module doc's "THE RETRY-ORPHAN ARGUMENT" section.
  const derivedBlockId = await deriveCardBlockId({
    draftId: input.draftId,
    sourcePath: input.sourcePath,
    card: input.card,
  });
  const stamped = stampQaCardBlockId(inserted.content, found.span, {
    generateBlockId: () => derivedBlockId,
  });

  // `[D-181]`: the sidecar, never text written into her notes — see
  // `materialize-mcq.ts`'s identical section. Skipped, not fabricated, when
  // the pipeline had no citation to record, and guarded so a retry that
  // reached this write on a prior attempt does not re-throw into it.
  const noteUid = noteUidOf(source);
  // `[D-353]`'s identity derivation — see the module doc's "THE IDENTITY
  // DERIVATION" section: the SAME exported `provisionalInstrumentId` a later
  // vault walk (`enumerate.ts`) calls, with the SAME inputs it would compute
  // — never a hand-rolled format.
  const instrumentId = provisionalInstrumentId({
    noteUid,
    notePath: input.sourcePath,
    blockId: stamped.blockId,
    heading: null,
    ordinal: 1,
    explicitId: null,
    instrumentType: 'qa',
  });

  if (input.sourceCitation !== undefined) {
    if (!(await vault.exists(citationStorePath(instrumentId)))) {
      await writeInstrumentCitation(vault, instrumentId, input.sourceCitation);
    }
  }

  await vault.write(input.sourcePath, stamped.content);

  return { instrumentId };
}
