/**
 * Writing a recovered instrument id back into her note once she has confirmed a deleted-id
 * repair (`ol-v7r5.103`), or once the ruling's near-certainty test repairs it silently
 * (`ol-v7r5.105`) — the write half `ol-v7r5.91` left undone.
 *
 * ## The rulings this rests on
 *
 * - **C5.3 as amended by `[D-090]` and `[D-392]`**: an item's markdown carries its own item-id;
 *   repair of a deleted id is silent only at near-certainty and goes to her otherwise; where more
 *   than one candidate could carry the id she is offered one grouped choice, and the deleted id
 *   keeps its identity and history until she answers. Choosing a candidate is what attaches the
 *   deleted id to it (`../review/repair-choice.ts`'s `resolveRepairChoice`, `'attached'`).
 * - **`[D-030]`**: Olea may write a durable identity marker into her notes, written once and
 *   thereafter only read, never recomputed. **`[D-177]`** (C1.4): the marker lives in the item's
 *   own block (an MCQ's `id:` field, a Q&A card's trailing block id) or, for a cloze, in the
 *   note's frontmatter map.
 * - **INV-6 part (a) (`[D-097]`)**: never write into her authored notes without consent. This
 *   module writes only after she has answered the grouped choice by picking this candidate, and
 *   what it writes is the same identity marker `[D-030]` already permits, in the same position,
 *   through the same idempotent primitives (`./port.ts`'s `stampOnFirstSight`). It never
 *   changes a byte of her own text.
 *
 * ## What it refuses, and why each refusal writes nothing
 *
 * The one failure that matters here is a silent wrong write: an id landing on a block she did not
 * choose hands one card's scheduling history to another. So every doubt ends in a refusal that
 * leaves the note untouched:
 *
 * - **Not her confirmed answer** — anything but a `'confirmed'` resolution naming this id.
 * - **Not near-certain** (the silent path only) — the successor's text or file differs from what
 *   the deleted id was last observed with.
 * - **The id is live elsewhere** — `[D-090]`: a claimed id is a duplication case, not a repair.
 * - **The block cannot be pinned exactly** — the caller must hand the exact text of the block she
 *   was shown (`candidateRaw`), and exactly one instrument in the chosen note must still carry
 *   that text, or the confirmed answer's `[D-409]` digest must pin exactly one of several
 *   identical-text blocks by heading path ({@link pinByDigest}). Zero (she edited or removed it),
 *   or several that neither the text nor the digest can tell apart (no digest, or two identical
 *   blocks under the same heading too), is a refusal.
 * - **The block already carries a durable marker** — `[D-030]`: an existing id is read, never
 *   overwritten.
 * - **A different instrument type** — the history belongs to the kind of item that earned it.
 * - **The id cannot be reproduced at that location** — a Q&A card's id includes its note's
 *   identity root, so a Q&A id recovered onto a card in another note would not come back as the
 *   same id; an unstamped (position-derived) id has no marker to write at all.
 * - **The block id is already in use in that note** — two blocks sharing one block id would
 *   break her own links as well as the id.
 *
 * Idempotent: a note that already carries the recovered marker is reported as such and not
 * written again.
 *
 * ## The silent near-certain repair (`ol-v7r5.105`)
 *
 * C5.3 as ruled by `[D-090]` section 4 repairs a deleted id silently when, and only when, the
 * successor's text is byte-identical, it is in the same file, and the id is unclaimed.
 * {@link writeBackSilentRepair} is that path's write: it takes `../review/repair-choice.ts`'s
 * `'silent'` outcome together with the deleted id's own last-observed record and re-checks the
 * text and file conditions itself before writing, so a caller bug can never turn an uncertain
 * match into a silent write; the unclaimed condition is the shared write's own id-live checks.
 * The authority is the ruling itself rather than her answer, and the write is the same `[D-030]`
 * marker, in the same position, through the same primitives as the confirmed path.
 *
 * ## What it does not do
 *
 * It never moves scheduling history (history is keyed by id, so once the marker is back the next
 * vault walk reads the old id and its history follows), never resolves her answer, and never
 * persists the proposal.
 *
 * ## Callers (`[D-072]`)
 *
 * {@link writeBackSilentRepair}: `../review/open-session.ts`'s deleted-id repair step, on every
 * review open that has a previous walk to compare against. {@link writeBackRecoveredInstrumentId}
 * has no production caller yet: nothing in the plugin shows her the grouped choice or reads her
 * answer, because the words that choice would show her are not yet in the vocabulary registry;
 * the surface that does is this function's caller.
 */

import type {
  DeletedInstrumentRecord,
  VaultInstrumentRecord,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  PROVISIONAL_ID_PREFIX,
  parseCards,
  parseMcqBlocks,
  provisionalInstrumentId,
  readClozeId,
} from 'olea-core';
import {
  digestOfInstrumentRecord,
  type RepairChoiceAttachedResult,
  type RepairChoiceSilentOutcome,
} from '../review/repair-choice.js';
import { stampOnFirstSight } from './port.js';

export type RecoverableInstrumentType = VaultInstrumentRecord['instrumentType'];

export interface WriteBackRecoveredIdInput {
  /** Her answer to the grouped choice, as `resolveRepairChoice` returned it. */
  readonly resolution: RepairChoiceAttachedResult;
  /** The type the deleted id was reviewed as (its review-log records carry it). */
  readonly recoveredInstrumentType: RecoverableInstrumentType;
  /** The exact text of the block she was shown and chose, which pins it within its note. */
  readonly candidateRaw: string;
  /** Every instrument a fresh vault walk sees now. */
  readonly currentRecords: readonly VaultInstrumentRecord[];
}

/**
 * The silent near-certain repair's write (`[D-090]` section 4) — see the module doc's "The silent
 * near-certain repair".
 */
export interface WriteBackSilentRepairInput {
  /** `buildRepairChoice`'s `'silent'` outcome for this deleted id. */
  readonly repair: RepairChoiceSilentOutcome;
  /** The deleted id as the previous walk last observed it — the certainty test's left-hand side. */
  readonly deleted: DeletedInstrumentRecord;
  /** The type the previous walk observed the deleted id as. */
  readonly recoveredInstrumentType: RecoverableInstrumentType;
  /** The successor block's exact text now, which pins it within its note. */
  readonly candidateRaw: string;
  /** Every instrument a fresh vault walk sees now. */
  readonly currentRecords: readonly VaultInstrumentRecord[];
}

export type WriteBackRefusalReason =
  | 'not-confirmed'
  | 'not-near-certain'
  | 'id-live-elsewhere'
  | 'candidate-not-found'
  | 'candidate-ambiguous'
  | 'type-mismatch'
  | 'candidate-already-identified'
  | 'recovered-id-not-reproducible'
  | 'marker-in-use'
  | 'candidate-moved';

export type WriteBackRecoveredIdResult =
  | { readonly kind: 'written'; readonly instrumentId: string; readonly notePath: VaultPath }
  | {
      readonly kind: 'already-carried';
      readonly instrumentId: string;
      readonly notePath: VaultPath;
    }
  | { readonly kind: 'refused'; readonly reason: WriteBackRefusalReason };

/** Deliberately narrow: the shapes Olea's own generators mint, and a plain hand-typed token. */
const PLAIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** A Q&A card's durable id: `<prefix>:<root>#^<blockId>:1` — see `provisionalInstrumentId`. */
const QA_DURABLE_ID_RE = /#\^([A-Za-z0-9][A-Za-z0-9-]*):1$/;

function rawOf(record: VaultInstrumentRecord): string {
  return record.instrumentType === 'mcq' ? record.mcq.raw : record.card.raw;
}

/** Mirrors `./port.ts`'s `alreadyCarriesDurableMarker`. */
function carriesDurableMarker(record: VaultInstrumentRecord): boolean {
  if (!record.instrumentId.startsWith(`${PROVISIONAL_ID_PREFIX}:`)) return true;
  return record.instrumentType === 'qa' && record.blockId !== null;
}

function refused(reason: WriteBackRefusalReason): WriteBackRecoveredIdResult {
  return { kind: 'refused', reason };
}

/** The Q&A block id that reproduces `recoveredId` on `target`, or `undefined` when none can. */
function qaBlockIdFor(recoveredId: string, target: VaultInstrumentRecord): string | undefined {
  if (!recoveredId.startsWith(`${PROVISIONAL_ID_PREFIX}:`)) return undefined;
  const blockId = QA_DURABLE_ID_RE.exec(recoveredId)?.[1];
  if (blockId === undefined) return undefined;
  const reproduced = provisionalInstrumentId({
    noteUid: target.noteUid,
    notePath: target.notePath,
    blockId,
    heading: target.heading,
    ordinal: 1,
    explicitId: null,
    instrumentType: 'qa',
  });
  return reproduced === recoveredId ? blockId : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What the note already says about the recovered marker: `'carried'` when an instrument of the
 * recovered type already carries it (a repeat call), `'in-use'` when the text is present but not
 * as that instrument's marker, `'absent'` otherwise.
 */
function markerState(
  source: string,
  type: RecoverableInstrumentType,
  value: string,
  target: VaultInstrumentRecord,
): 'carried' | 'in-use' | 'absent' {
  if (type === 'mcq') {
    return parseMcqBlocks(source).instruments.some((mcq) => mcq.id === value)
      ? 'carried'
      : 'absent';
  }
  if (type === 'cloze') {
    const anchor = {
      noteUid: target.noteUid,
      notePath: target.notePath,
      heading: target.heading,
      ordinal: target.ordinal,
    };
    return readClozeId(source, anchor) === value ? 'carried' : 'absent';
  }
  if (parseCards(source).some((card) => card.type === 'qa' && card.blockId === value)) {
    return 'carried';
  }
  const anywhere = new RegExp(`\\^${escapeRegExp(value)}(?![A-Za-z0-9-])`);
  return anywhere.test(source) ? 'in-use' : 'absent';
}

/**
 * Writes `input.resolution.instrumentId` back into the block she chose, or refuses and writes
 * nothing — see the module doc for every refusal.
 */
export async function writeBackRecoveredInstrumentId(
  vault: VaultSource,
  input: WriteBackRecoveredIdInput,
): Promise<WriteBackRecoveredIdResult> {
  const { resolution, recoveredInstrumentType, candidateRaw, currentRecords } = input;

  if (
    resolution.kind !== 'attached' ||
    resolution.proposal.status !== 'confirmed' ||
    resolution.proposal.instrumentId !== resolution.instrumentId ||
    resolution.proposal.resolvedNotePath !== resolution.notePath
  ) {
    return refused('not-confirmed');
  }

  return writeRecoveredId(vault, {
    recoveredId: resolution.instrumentId,
    notePath: resolution.notePath,
    recoveredInstrumentType,
    candidateRaw,
    currentRecords,
    ...(resolution.digest !== undefined ? { digest: resolution.digest } : {}),
  });
}

/**
 * Writes a silently repaired id back into its near-certain successor, or refuses and writes
 * nothing. Re-checks `[D-090]`'s text and file conditions against `input.deleted` itself (refusing
 * `'not-near-certain'`), then applies every refusal the confirmed path applies.
 */
export async function writeBackSilentRepair(
  vault: VaultSource,
  input: WriteBackSilentRepairInput,
): Promise<WriteBackRecoveredIdResult> {
  const { repair, deleted, recoveredInstrumentType, candidateRaw, currentRecords } = input;

  if (
    repair.kind !== 'silent' ||
    repair.instrumentId !== deleted.instrumentId ||
    repair.notePath !== deleted.notePath ||
    candidateRaw !== deleted.raw
  ) {
    return refused('not-near-certain');
  }

  return writeRecoveredId(vault, {
    recoveredId: repair.instrumentId,
    notePath: repair.notePath,
    recoveredInstrumentType,
    candidateRaw,
    currentRecords,
  });
}

interface RecoveredIdWrite {
  readonly recoveredId: string;
  readonly notePath: VaultPath;
  readonly recoveredInstrumentType: RecoverableInstrumentType;
  readonly candidateRaw: string;
  readonly currentRecords: readonly VaultInstrumentRecord[];
  /**
   * `[D-409]`: the chosen candidate's digest, when the resolution carries one. Text alone cannot
   * tell two identical blocks in one note apart; the digest can, because it is computed over the
   * block's heading path as well as its text (`../review/repair-choice.ts`'s
   * `digestOfInstrumentRecord`). Used only to disambiguate `candidateRaw`'s multiple matches —
   * never to widen or replace the exact-text pin.
   */
  readonly digest?: string;
}

/**
 * Among blocks that all share `candidateRaw`'s exact text, the one `digest` names by heading path
 * — or `undefined` when `digest` cannot pin exactly one (no digest given, no record carries a
 * heading path, or more than one candidate resolves to the same digest, e.g. two identical blocks
 * under the same heading).
 */
async function pinByDigest(
  pinned: readonly VaultInstrumentRecord[],
  digest: string,
): Promise<VaultInstrumentRecord | undefined> {
  const matches: VaultInstrumentRecord[] = [];
  for (const record of pinned) {
    if ((await digestOfInstrumentRecord(record)) === digest) matches.push(record);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** The write both authorities share, once each has established its own authority to write. */
async function writeRecoveredId(
  vault: VaultSource,
  input: RecoveredIdWrite,
): Promise<WriteBackRecoveredIdResult> {
  const { recoveredId, notePath, recoveredInstrumentType, candidateRaw, currentRecords, digest } =
    input;

  const carriers = currentRecords.filter((record) => record.instrumentId === recoveredId);
  if (carriers.some((record) => record.notePath !== notePath)) return refused('id-live-elsewhere');
  if (carriers.length > 0) return { kind: 'already-carried', instrumentId: recoveredId, notePath };

  const pinned = currentRecords.filter(
    (record) => record.notePath === notePath && rawOf(record) === candidateRaw,
  );
  if (pinned.length === 0) return refused('candidate-not-found');
  let target: VaultInstrumentRecord | undefined = pinned.length === 1 ? pinned[0] : undefined;
  if (target === undefined && digest !== undefined) {
    // `[D-409]`: several blocks share this exact text — the digest may still pin exactly one of
    // them by heading path. Still a refusal when it cannot (same heading too, or no match).
    target = await pinByDigest(pinned, digest);
  }
  if (target === undefined) return refused('candidate-ambiguous');

  if (target.instrumentType !== recoveredInstrumentType) return refused('type-mismatch');
  if (carriesDurableMarker(target)) return refused('candidate-already-identified');

  let markerValue: string | undefined;
  if (recoveredInstrumentType === 'qa') {
    markerValue = qaBlockIdFor(recoveredId, target);
  } else if (PLAIN_ID_RE.test(recoveredId)) {
    markerValue = recoveredId;
  }
  if (markerValue === undefined) return refused('recovered-id-not-reproducible');

  const source = await vault.read(notePath);
  const state = markerState(source, recoveredInstrumentType, markerValue, target);
  if (state === 'carried') return { kind: 'already-carried', instrumentId: recoveredId, notePath };
  if (state === 'in-use') return refused('marker-in-use');

  const value = markerValue;
  const refuseMint = (): string => {
    throw new Error('repair write-back: minted for the wrong instrument type');
  };
  const stamped = await stampOnFirstSight(vault, target, {
    generateMcqId: recoveredInstrumentType === 'mcq' ? () => value : refuseMint,
    generateBlockId: recoveredInstrumentType === 'qa' ? () => value : refuseMint,
    generateClozeId: recoveredInstrumentType === 'cloze' ? () => value : refuseMint,
  });

  if (stamped.instrumentId === recoveredId) {
    return { kind: 'written', instrumentId: recoveredId, notePath };
  }
  if (stamped.instrumentId === target.instrumentId) return refused('candidate-moved');
  throw new Error('repair write-back: the marker written does not reproduce the recovered id');
}
