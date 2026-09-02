/**
 * The first-sight stamping trigger (`ol-2zfj.53`) — the write half of `[D-030]`/
 * `[D-177]`'s stamped identity that had no production caller. `stampMcqId`,
 * `stampQaCardBlockId` and `stampClozeId` (`olea-core`) have existed since
 * `ol-k7eg`/`ol-2zfj.46`; nothing in the plugin ever called them for a
 * vault-AUTHORED instrument (`materialize-mcq.ts`'s `stampMcqId` call is the
 * one exception, and it only ever runs on an AI draft the moment it is
 * accepted — never on something she typed herself). This module is that
 * caller, for all three types.
 *
 * ## Where it hooks in, and why there
 *
 * `ol-k7eg`'s notes weighed two moments: on enumeration (writes merely
 * because she opened the panel) or on first review (writes only what she has
 * touched) — "the smaller promise and probably the right one." `review/
 * session.ts`'s `logAndAdvance` is that moment: it already is the one place
 * a graded review becomes durable (the review-log write, the scheduler
 * call), so stamping happens there too, immediately before both — see this
 * module's `StampOnFirstSightPort` and `session.ts`'s own use of it.
 *
 * ## Locating the instrument without re-walking the vault
 *
 * `open-session.ts` already runs `enumerateVaultInstruments` once per opened
 * session (via `buildReviewSession`) and keeps every result in
 * `composed.recordsById` (`ReadonlyMap<string, VaultInstrumentRecord>`) to
 * adapt the queue. `createStampOnFirstSightPort` closes over that SAME map
 * rather than triggering a second walk — the record already carries the
 * note path, the anchor (`blockId`/`heading`), the ordinal and (for MCQ/QA)
 * the parsed instrument's own `span`, which is exactly what `stampMcqId`/
 * `stampQaCardBlockId` need to splice a marker in.
 *
 * **The span on the record can be stale by the time this runs.** Two
 * instruments can share one note; if an earlier review in the *same* session
 * already stamped one of them, its `id:`/`^id` insertion shifts every byte
 * position after it in that note, including whatever span a later
 * instrument's record captured at enumeration time. `stampMcqId`/
 * `stampQaCardBlockId` locate their block by exact span match and throw if
 * it no longer resolves, so this module re-derives a CURRENT span from a
 * fresh read instead of trusting the record's own — `locateCurrentSpan`
 * reproduces `session/enumerate.ts`'s anchor-plus-ordinal computation (merge
 * cards and MCQs by source order, count occurrences per anchor key) rather
 * than importing it: `enumerate.ts` is a different bead's `owns`, and this is
 * the same "reproduce the small pure helper rather than reach across an
 * ownership boundary" call `cloze-identity.ts` already made for
 * `escapeComponent`.
 *
 * Heading text and per-heading ordinal are unaffected by splicing an inline
 * marker into a *different* instrument's OWN line: `ol-8ae9`'s core-level fix
 * (`session/enumerate.ts`) made a heading's ordinal count every occupant it
 * has ever had, stamped or not, so a sibling moving to its own block-id
 * anchor no longer vacates the slot this module's re-derivation depends on.
 * `locateCurrentSpan` below mirrors that same counting rule. See "`ol-8ae9`,
 * fixed upstream" below for what this module used to have to guard against
 * on its own.
 *
 * A cloze needs no relocation at all: `stampClozeId` addresses its target by
 * `(noteUid, notePath, heading, ordinal)` against the frontmatter map, never
 * by a body span, so the record's own fields are handed straight through.
 *
 * ## `ol-8ae9`, fixed upstream — what this module used to guard against
 *
 * A Q&A card's block id doubles as BOTH its identity carrier AND
 * `enumerate.ts`'s ordinal-counting anchor key. Before `ol-8ae9`'s core-level
 * fix landed, stamping one card silently reassigned a heading-sharing
 * sibling's ordinal (and therefore its derived id) on the next fresh
 * enumeration — a genuine, then-PRE-EXISTING gap in `olea-core`'s shipped
 * scheme, reproduced and confirmed independent of this port, merely
 * unreachable in production before something (this trigger) actually wrote a
 * Q&A block id. Filed as `ol-8ae9` (`discovered-from: ol-2zfj.53`) and fixed
 * in `session/enumerate.ts`/`session/instrument-id.ts` (a different bead's
 * `owns`, and a persisted-identity change): a heading's ordinal now counts
 * the instrument's position among every occupant that heading has ever had,
 * whether or not one of them has since moved to its own block-id anchor —
 * see that module's own doc for the full argument.
 *
 * This module previously carried a narrower, conservative mitigation for the
 * gap, inside its own `owns`: only stamp a Q&A card that was CURRENTLY the
 * highest-ordinal occupant of its heading anchor, deferring every other card
 * to a later review (removing the last occupant shifts nobody, because
 * nothing comes after it). With the upstream fix in place that mitigation is
 * no longer needed — stamping any occupant, in any order, can no longer
 * reassign a sibling — so the `'qa'` branch below stamps unconditionally,
 * the same as the `'mcq'` branch always has.
 *
 * ## Deciding what still needs a marker
 *
 * `provisionalInstrumentId`'s `PROVISIONAL_ID_PREFIX` marks an id that was
 * *derived* rather than read back — but for a stamped Q&A card the id is
 * STILL `prov1:`-prefixed forever (`instrument-id.ts`'s module doc: the
 * block id is the anchor component `anchorComponent` reads, never a rule-1
 * style bypass the way an MCQ's `id:` field is), so the prefix alone cannot
 * tell a durably-anchored Q&A card from an unstamped one. `record.blockId`
 * (the card's own trailing block id, non-`null` once stamped) is the honest
 * signal for that one case; MCQ and cloze both drop the prefix entirely the
 * moment they are stamped (`instrument-id.spec.ts`'s `.not.toContain`
 * assertions), so the prefix check alone is sufficient — and cheap: an
 * already-durable MCQ or cloze never even reaches a `vault.read`.
 *
 * ## What this module does not do
 *
 * It never runs during enumeration (`enumerate.ts`'s own "nothing here
 * writes" is unchanged — this is a different module, called from a
 * different place) and it is never offered a reason to run outside a graded
 * review: nothing here is wired into any read-only listing, panel count or
 * queue composition path. It is also not network-dependent — a vault write
 * is entirely local, so there is no offline gate to check.
 */

import type {
  HeadingBlock,
  SourceSpan,
  VaultInstrumentRecord,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  PROVISIONAL_ID_PREFIX,
  parseCards,
  parseDocument,
  parseMcqBlocks,
  provisionalInstrumentId,
  stampClozeId,
  stampMcqId,
  stampQaCardBlockId,
} from 'olea-core';

export interface StampOnFirstSightResult {
  /**
   * The instrument id to use from this point on — the durable one when a
   * marker was just written or already existed, unchanged (still
   * provisional, possibly still `prov1:`-prefixed) when nothing could be
   * stamped yet.
   */
  readonly instrumentId: string;
}

/**
 * The seam `ReviewSession` calls. Takes the instrument id it currently
 * holds and returns the id to use from now on — a no-op that returns the
 * same id back for anything that does not need stamping.
 */
export type StampOnFirstSightPort = (instrumentId: string) => Promise<StampOnFirstSightResult>;

export interface StampOnFirstSightDeps {
  /** Injectable for deterministic tests; defaults to `stampMcqId`'s own random generator. */
  readonly generateMcqId?: () => string;
  /** Injectable for deterministic tests; defaults to `stampQaCardBlockId`'s own random generator. */
  readonly generateBlockId?: () => string;
  /** Injectable for deterministic tests; defaults to this module's own random generator. */
  readonly generateClozeId?: () => string;
}

const CLOZE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Alphabet and shape distinct from `mcq-format.ts`'s `mcq-` ids and `card-format.ts`'s bare block ids, so the three id families are never confused on sight. */
function defaultGenerateClozeId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let suffix = '';
  for (const byte of bytes) {
    suffix += CLOZE_ID_ALPHABET[byte % CLOZE_ID_ALPHABET.length];
  }
  return `cloze-${suffix}`;
}

/** One instrument, merged across `parseCards`/`parseMcqBlocks`, stripped to what `locateCurrentSpan` needs. */
interface LocatableInstrument {
  readonly type: 'qa' | 'cloze' | 'mcq';
  readonly span: SourceSpan;
  readonly blockId: string | null;
}

/** Mirrors `session/enumerate.ts`'s `instrumentsOf` merge — see this module's doc for why it is reproduced rather than imported. */
function locatableInstrumentsOf(source: string): readonly LocatableInstrument[] {
  const cards = parseCards(source).map(
    (card): LocatableInstrument => ({ type: card.type, span: card.span, blockId: card.blockId }),
  );
  const mcqs = parseMcqBlocks(source).instruments.map(
    (mcq): LocatableInstrument => ({ type: 'mcq', span: mcq.span, blockId: null }),
  );
  return [...cards, ...mcqs].sort((a, b) => a.span.start - b.span.start);
}

/** Mirrors `session/enumerate.ts`'s private `headingAbove` exactly. */
function headingAbove(headings: readonly HeadingBlock[], offset: number): string | null {
  let found: string | null = null;
  for (const heading of headings) {
    if (heading.start >= offset) break;
    found = heading.text;
  }
  return found;
}

interface LocatedInstrument {
  readonly span: SourceSpan;
}

/**
 * Re-derives the CURRENT span of the instrument `record` names, by
 * recomputing the same heading-ordinal `session/enumerate.ts` computes when
 * this record was built, against a fresh read — mirroring that module's
 * `ol-8ae9` counting rule exactly: a heading's ordinal counts every
 * instrument it has ever had, whether or not one has since moved to its own
 * block-id anchor. `undefined` when the note has changed enough that the
 * heading/ordinal no longer resolves to exactly one still-unstamped
 * instrument of the right type (she deleted or restructured the content
 * between enumeration and this review, or a concurrent stamp in this same
 * session already gave it a block id) — the caller treats that as "nothing
 * to stamp yet," never as an error, since a stale, unstampable record is
 * exactly the read-only-fallback case `provisionalInstrumentId` already
 * exists to cover.
 */
function locateCurrentSpan(
  source: string,
  record: VaultInstrumentRecord,
): LocatedInstrument | undefined {
  const headings = parseDocument(source).blocks.filter(
    (block): block is HeadingBlock => block.kind === 'heading',
  );

  const headingOrdinals = new Map<string, number>();
  const blockOrdinals = new Map<string, number>();
  let match: SourceSpan | undefined;

  for (const instrument of locatableInstrumentsOf(source)) {
    const heading = headingAbove(headings, instrument.span.start);
    const headingKey = heading ?? '';
    const headingPosition = (headingOrdinals.get(headingKey) ?? 0) + 1;
    headingOrdinals.set(headingKey, headingPosition);

    let ordinal: number;
    if (instrument.blockId !== null) {
      ordinal = (blockOrdinals.get(instrument.blockId) ?? 0) + 1;
      blockOrdinals.set(instrument.blockId, ordinal);
    } else {
      ordinal = headingPosition;
    }

    if (
      match === undefined &&
      instrument.type === record.instrumentType &&
      instrument.blockId === record.blockId &&
      heading === record.heading &&
      ordinal === record.ordinal
    ) {
      match = instrument.span;
    }
  }
  return match === undefined ? undefined : { span: match };
}

/**
 * `record.instrumentId` still carries `PROVISIONAL_ID_PREFIX` forever for a
 * durably-stamped Q&A card (see this module's doc) — `record.blockId` is
 * the carrier-specific signal that case needs. MCQ and cloze both drop the
 * prefix the moment they are stamped, so the prefix check alone answers it
 * for them.
 */
function alreadyCarriesDurableMarker(record: VaultInstrumentRecord): boolean {
  if (!record.instrumentId.startsWith(`${PROVISIONAL_ID_PREFIX}:`)) return true;
  if (record.instrumentType === 'qa' && record.blockId !== null) return true;
  return false;
}

/**
 * Stamps ONE instrument, given its own already-enumerated record. Exported
 * for direct testing; `createStampOnFirstSightPort` below is what
 * production wires into `ReviewSession`.
 *
 * Read-then-mint and idempotent throughout, because every write it can make
 * goes through a read-then-mint primitive (`stampMcqId`, `stampQaCardBlockId`,
 * `stampClozeId`) that is itself idempotent — calling this twice on the same
 * instrument writes at most once.
 */
export async function stampOnFirstSight(
  vault: VaultSource,
  record: VaultInstrumentRecord,
  deps: StampOnFirstSightDeps = {},
): Promise<StampOnFirstSightResult> {
  if (alreadyCarriesDurableMarker(record)) return { instrumentId: record.instrumentId };

  const source = await vault.read(record.notePath);

  if (record.instrumentType === 'cloze') {
    const mint = deps.generateClozeId ?? defaultGenerateClozeId;
    const anchor = {
      noteUid: record.noteUid,
      notePath: record.notePath,
      heading: record.heading,
      ordinal: record.ordinal,
    };
    const stamped = stampClozeId(source, anchor, mint);
    if (!stamped.changed) return { instrumentId: record.instrumentId };
    await vault.write(record.notePath, stamped.content);
    return {
      instrumentId: provisionalInstrumentId({
        noteUid: record.noteUid,
        notePath: record.notePath,
        blockId: null,
        heading: record.heading,
        ordinal: record.ordinal,
        explicitId: null,
        instrumentType: 'cloze',
        stampedClozeId: stamped.value,
      }),
    };
  }

  const located = locateCurrentSpan(source, record);
  if (located === undefined) return { instrumentId: record.instrumentId };

  if (record.instrumentType === 'mcq') {
    // An MCQ's ordinal-counting anchor is always its heading (`enumerate.ts`'s
    // `ParsedInstrument` mapping hardcodes `blockId: null` for every MCQ,
    // whether or not it carries an `id:` field), so stamping one's `id:`
    // never vacates a heading-ordinal slot the way a Q&A card's block id
    // does below — no sibling-safety check needed here.
    const stamped = stampMcqId(
      source,
      located.span,
      deps.generateMcqId !== undefined ? { generateId: deps.generateMcqId } : {},
    );
    if (!stamped.changed) return { instrumentId: record.instrumentId };
    await vault.write(record.notePath, stamped.content);
    return { instrumentId: stamped.id };
  }

  // 'qa'.
  //
  // Once a genuine, then-PRE-EXISTING gap in `olea-core`'s shipped id scheme
  // (`session/enumerate.ts` + `session/instrument-id.ts`): a Q&A card's
  // block id IS its ordinal-counting anchor key once stamped, so writing one
  // used to move this card from the shared `h:<heading>` anchor to its own,
  // globally-unique `^<blockId>` anchor — vacating its slot in the heading's
  // ordinal sequence and silently reassigning every higher-ordinal sibling's
  // derived id on the next fresh enumeration, orphaning whatever scheduling
  // history it already had. Filed as `ol-8ae9` and fixed upstream (see this
  // module's own doc, "`ol-8ae9`, fixed upstream"): `enumerate.ts`'s heading
  // ordinal now counts every occupant a heading has ever had, so nothing
  // this card does to its own anchor can reassign a sibling any more. No
  // sibling-safety check is needed here — stamp unconditionally, the same
  // as the `'mcq'` branch above always has.
  const stamped = stampQaCardBlockId(
    source,
    located.span,
    deps.generateBlockId !== undefined ? { generateBlockId: deps.generateBlockId } : {},
  );
  if (!stamped.changed) return { instrumentId: record.instrumentId };
  await vault.write(record.notePath, stamped.content);
  return {
    instrumentId: provisionalInstrumentId({
      noteUid: record.noteUid,
      notePath: record.notePath,
      blockId: stamped.blockId,
      heading: record.heading,
      // Always `1`, never `record.ordinal`: `record.ordinal` was computed
      // under the OLD anchor (the heading this card sat under, alongside
      // however many siblings), but the anchor is now this card's own
      // freshly-minted block id — globally unique by construction
      // (`defaultGenerateBlockId`'s random alphabet), so exactly one
      // instrument in the whole vault ever occupies it. A fresh
      // `enumerateVaultInstruments` run over the just-written content would
      // derive the same `1` (`instrument-id.spec.ts`'s own
      // `^durable1` assertion is this exact case) — reusing `record.ordinal`
      // here would silently mint an id `enumerateVaultInstruments` could
      // never itself reproduce, breaking the very durability this stamp
      // exists to buy.
      ordinal: 1,
      explicitId: null,
      instrumentType: 'qa',
      stampedClozeId: null,
    }),
  };
}

/**
 * Builds the port `ReviewSessionDeps.stampOnFirstSight` expects, over a
 * vault and a fresh enumeration's `recordsById` (`buildReviewSession`'s own
 * result field) — composed once per opened session in `open-session.ts`, so
 * no second vault walk happens just to make stamping possible. An
 * instrument id the map does not recognise (should not happen: every id
 * `ReviewSession` ever holds came from this same enumeration) is returned
 * unchanged rather than thrown on, matching every other "nothing to stamp
 * yet" fallback in this module.
 */
export function createStampOnFirstSightPort(
  vault: VaultSource,
  recordsById: ReadonlyMap<string, VaultInstrumentRecord>,
  deps: StampOnFirstSightDeps = {},
): StampOnFirstSightPort {
  return async (instrumentId: string): Promise<StampOnFirstSightResult> => {
    const record = recordsById.get(instrumentId);
    if (record === undefined) return { instrumentId };
    return stampOnFirstSight(vault, record, deps);
  };
}

export type { VaultInstrumentRecord, VaultPath };
