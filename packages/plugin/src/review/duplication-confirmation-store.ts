/**
 * The duplication confirmation record — `[D-380]` (`ol-v7r5.88`), the persisted half of C5.3's
 * duplication rule as amended by `[D-090]`: a duplicated item id's LOSING copy "routes through the
 * confirmation queue, inert until she answers". `olea-core`'s `resolveInstrumentDuplications`
 * (`instrument/duplication.ts`) computes the entries and persists nothing; this module is where
 * they persist.
 *
 * **Its own record, never the automatic processing queue.** `[D-380]` ruled the separate record
 * over a new job kind in the ingestion queue store: that queue runs without her, this one waits on
 * her, and mixing the two would let an automatic drain treat a question for her as work it can
 * finish. So: its own dot-prefixed folder, one small JSON file per losing note, schema-versioned,
 * read and written through the injected `VaultSource` exactly the way `olea-core`'s outcome
 * near-match proposals are (`outcome/near-match.ts` — the precedent `[D-380]` names: `listFolder`
 * for a dot folder, a validator that skips a corrupt file rather than throwing, the same
 * `JSON.stringify(record, null, 2)` plus newline serialisation, and the same
 * `'proposed' | 'confirmed' | 'declined'` status vocabulary core's `DuplicationConfirmationStatus`
 * already mirrors). Nothing here writes into a note she authored (INV-6): every path this module
 * writes is under {@link DUPLICATION_CONFIRMATION_FOLDER}.
 *
 * ## Identity, and why a rename neither loses nor duplicates a proposal
 *
 * `[D-380]`'s follow-up: the record names stable identities for both copies, the reason, and the
 * confirmation status, and renaming either note must never lose or duplicate the proposal.
 *
 * - **The proposal's identity is the set of item ids the losing note collided on.** An item id is
 *   persisted identity written once into the note and only ever read after (`[D-030]`,
 *   `olea-core`'s `session/instrument-id.ts`); both copies carry it, and a rename of either note
 *   moves neither. Paths are what C1.3 ruled untrustworthy, so no path is part of the identity.
 * - **Each copy is recorded as where Olea last observed it — `notePath` — plus its `olea-uid`,
 *   when the note carries one.** The uid is this codebase's rename-surviving note identity
 *   (`uid/stamp.ts`); it is read, never stamped here (`[D-030]`'s hard constraint, and INV-6 —
 *   stamping one would be a write into her note). Two copies of a whole file carry the same uid,
 *   so the uid alone never tells a pair apart; it only breaks a tie between two losing copies that
 *   moved at once (see {@link proposeDuplicationConfirmations}).
 * - **Matching is by content, never by file name.** Each call reads every record and pairs it with
 *   the current entries: first a record whose losing copy is still where it was (its kept copy may
 *   have moved — that is only a location to refresh); then a record whose losing copy is no longer
 *   observed losing anywhere, sharing the id set (a rename of the losing note, or a rename that
 *   flipped which copy the walk keeps). A matched record keeps its file, its status, its
 *   `proposedAt` and anything it carries this module does not know; only the observed locations
 *   are refreshed. An entry nothing matches is a new proposal. A record nothing matches is left
 *   exactly as it is — its collision is no longer observed, and deciding what that means is not
 *   this module's to do.
 * - **File names are deterministic, so two devices observing one duplication write one file**:
 *   the SHA-256 of the sorted id set (`olea-core`'s `hashText`), with `-2`, `-3`, … only when
 *   several losing notes share one id set (three or more copies of one item). The name is where a
 *   record was first written, never re-derived; a later change to the set is refreshed inside it.
 *
 * **What cannot be told apart, stated once.** A losing copy deleted and a fresh copy made elsewhere
 * between two reads looks exactly like a rename, and is read as one — the same location-based
 * reading C5.3 itself gives. Two copies of a whole file that BOTH moved, with no uid, pair by id set
 * and then by path order.
 *
 * ## INV-2: round trips
 *
 * A record is written only when what it would say differs from what it already says, compared
 * field by field with key order ignored: an unchanged observation never rewrites a file, so a record
 * formatted by another writer survives byte for byte, and a record read and re-serialised equals
 * the file it came from. A record of a schema version this module does not write is matched (so no
 * second proposal shadows it) and never rewritten.
 *
 * ## What this module does not do
 *
 * For a duplication it never transitions a status and never reads her answer: no clause defines
 * an affordance for her to confirm or decline a duplication, so this module stops at the record.
 * (A repair choice is different — `[D-392]` defines her grouped choice, so its answer is saved
 * here; see below.) It never decides
 * what she is served — the withholding is `./open-session.ts`'s, computed from the live
 * collision every time, whatever status a record holds (F3's "it holds while the loser waits in
 * the queue as much as after she answers"). It never deletes a record.
 *
 * ## `[D-392]`'s repair-choice records, sharing this same folder (`ol-v7r5.91`, `ol-v7r5.100`)
 *
 * `[D-392]` ruled that an ambiguous deleted-id repair (more than one candidate, or a single
 * candidate short of `[D-090]`'s near-certainty test) shares THIS store "under a second reason
 * value," rather than a store of its own (part 2 of the ruling — a persisted shape is David's to
 * decide, per this module's own precedent). `./repair-choice.ts`'s `buildRepairChoice`/
 * `resolveRepairChoice` are the pure decision; {@link proposeRepairChoiceConfirmations} and
 * {@link listRepairChoiceConfirmationRecords} below are its persisted half, structurally distinct
 * from {@link DuplicationConfirmationRecord} (one deleted id and every candidate she must choose
 * among, never a losing/kept pair) but sharing the folder, the read-then-mint idempotent write
 * discipline, and the `'proposed' | 'confirmed' | 'declined'` status vocabulary. Identity here is
 * simply `instrumentId` — the deleted id itself never renames, so this needs none of the
 * losing-note rename-tracking the duplication half above does. `[D-392]` binding condition 1 (the
 * original identity is preserved until she resolves it): once a record leaves `'proposed'`, a
 * later walk that still finds the same or different candidates for an already-resolved id never
 * re-litigates it. The one way back to `'proposed'` is `[D-409]`'s: a confirmed answer whose
 * block no longer matches its digest is re-proposed by {@link applyConfirmedRepairChoice} rather
 * than applied — nothing was attached, so the identity is still the one she has not yet given away.
 *
 * ### `[D-409]` (`ol-v7r5.105`): schema version 2, candidates identified by digest
 *
 * Version 1 named each candidate by note path only, so two candidates in one note could not be
 * told apart. Version 2 adds, to every candidate, `digest` — `./repair-choice.ts`'s
 * `repairCandidateDigest` of the block's text plus its heading path, a one-way hash that stores
 * none of her wording — and, once she answers with a candidate, `resolvedDigest` beside
 * `resolvedNotePath`. Candidates are ordered by note path, then digest.
 *
 * - **Persisted shape, version 1 (read, never newly written for a digested entry):**
 *   `{ instrumentId, candidates: [{ notePath, meetsCertaintyTest }], status, reason, proposedAt,
 *   confirmedAt?, declinedAt?, resolvedNotePath?, schemaVersion: 1 }`.
 * - **Version 2:** the same, with `digest` required on every candidate and `resolvedDigest`
 *   required on a `'confirmed'` record: `{ instrumentId, candidates: [{ notePath,
 *   meetsCertaintyTest, digest }], status, reason, proposedAt, confirmedAt?, declinedAt?,
 *   resolvedNotePath?, resolvedDigest?, schemaVersion: 2 }`.
 *
 * **Migration posture.** Reading never writes: {@link listRepairChoiceConfirmationRecords} accepts
 * both versions as they are on disk. A version 1 record still `'proposed'` is rewritten as version
 * 2 only by {@link proposeRepairChoiceConfirmations}, and only when a walk hands it digested
 * candidates for the same deleted id — the same in-place refresh this store has always made when
 * a proposal's candidates change. A resolved version 1 record is never rewritten by a walk. An
 * entry whose candidates are not all digested (a caller that cannot compute one yet) is still
 * written as version 1, exactly as before, and never downgrades a version 2 record. A version 1
 * candidate carries no digest, so an answer naming one is stale ({@link saveRepairChoiceAnswer})
 * and a version 1 confirmed record is re-proposed rather than applied — never guessed onto a
 * block by note path. A record of any other version is matched, so nothing shadows it, and
 * never rewritten or answered.
 *
 * ## `[D-265]` ruling 3's item-validation proposals, sharing this same folder (`ol-egov.141.53.1`)
 *
 * F2.23's mismatch trigger (`../../../core/src/concept/revision/item-validation.ts`'s
 * `checkItemValidation`) produces a `'proposed'` outcome for her to confirm or dismiss — the
 * SAME "share the existing folder under a reason of their own" arrangement `[D-392]` chose over a
 * store of its own for repair choices, reused here for the identical reason: a persisted shape
 * distinct from both existing records (one item, one suspected defect kind, never a losing/kept
 * pair or a candidate list) but sharing the folder, the read-then-mint idempotent write
 * discipline, and the `'proposed' | 'confirmed' | 'declined'` status vocabulary. Identity here is
 * simply `instrumentId`, the same as `[D-392]`'s repair-choice records and for the same reason —
 * F2.23 flags the item itself, never a pair. `./item-validation-wiring.ts`'s
 * `createItemValidationProposalReader` is this record's only writer today; **no reader consumes
 * it yet** — the same honest-gap posture `[D-392]`'s own module doc already states for its
 * candidates ("no clause defines an affordance for her to confirm or decline a duplication"),
 * carried through to this third reason value.
 */

import type {
  ItemDefectEvidenceKind,
  VaultInstrumentRecord,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { hashText, listFolder } from 'olea-core';
import {
  compareRepairChoiceCandidates,
  digestOfInstrumentRecord,
  type RepairChoiceAttachedResult,
  type RepairChoiceProposal,
  rawOfInstrumentRecord,
} from './repair-choice.js';

/** The vault folder this module owns — dot-prefixed, its own, never inside another store's. */
export const DUPLICATION_CONFIRMATION_FOLDER: VaultPath = '.olea/duplication-confirmation';

export const DUPLICATION_CONFIRMATION_RECORD_SCHEMA_VERSION = 1;

/**
 * `'proposed'` — the losing copy awaits her answer. `'confirmed'` / `'declined'` — reserved for her
 * answer, the same vocabulary `olea-core`'s `DuplicationConfirmationStatus` and the outcome
 * near-match record use; nothing writes either yet (see the module doc).
 */
export type DuplicationConfirmationRecordStatus = 'proposed' | 'confirmed' | 'declined';

/** Why a record exists — a closed union of one member, as in `olea-core`'s `DuplicationConfirmationReason`. */
export type DuplicationConfirmationRecordReason = 'duplicate-instrument-id';

/** One copy of a duplicated item, as Olea last observed it — see the module doc's "Identity". */
export interface DuplicateCopyIdentity {
  /** Where the copy was last observed. Refreshed on every read that finds it; never the identity. */
  readonly notePath: VaultPath;
  /** The note's `olea-uid`, or `null` when it carries none. Read only — never stamped here. */
  readonly noteUid: string | null;
}

/** One item id the losing note lost, and the copy that kept it. */
export interface DuplicationConfirmationCollisionRecord {
  readonly instrumentId: string;
  readonly kept: DuplicateCopyIdentity;
}

/** One file under {@link DUPLICATION_CONFIRMATION_FOLDER}: everything one losing note lost. */
export interface DuplicationConfirmationRecord {
  readonly losing: DuplicateCopyIdentity;
  /** Non-empty, sorted by `instrumentId`. More than one exactly when a whole file duplicated at once. */
  readonly collisions: readonly DuplicationConfirmationCollisionRecord[];
  readonly status: DuplicationConfirmationRecordStatus;
  readonly reason: DuplicationConfirmationRecordReason;
  /** ISO 8601 — when this losing note was first proposed. Never moved by a later read. */
  readonly proposedAt: string;
  readonly confirmedAt?: string;
  readonly declinedAt?: string;
  readonly schemaVersion: number;
}

/**
 * What a caller hands in — structurally the fields of `olea-core`'s
 * `DuplicationConfirmationQueueEntry` this store reads, so that entry type is accepted as is.
 */
export interface DuplicationConfirmationEntryInput {
  readonly losingNotePath: VaultPath;
  readonly collisions: readonly {
    readonly instrumentId: string;
    readonly keptNotePath: VaultPath;
  }[];
  /** Epoch ms — the caller's clock. */
  readonly proposedAt: number;
}

export interface ProposeDuplicationConfirmationsOptions {
  /** The note's `olea-uid` at a path, or `null`. Omitted reads every note as carrying none. */
  readonly noteUidOf?: (notePath: VaultPath) => string | null;
}

export interface StoredDuplicationConfirmationRecord {
  readonly path: VaultPath;
  readonly record: DuplicationConfirmationRecord;
}

/** `[D-392]`'s second reason value — this store's own name for it, never a clause's verbatim wording (unlike `repair-choice.ts`'s user-facing label). */
export type RepairChoiceConfirmationReason = 'deleted-id-repair';

export const REPAIR_CHOICE_CONFIRMATION_REASON: RepairChoiceConfirmationReason =
  'deleted-id-repair';

/** `[D-409]` (`ol-v7r5.105`): version 2 identifies each candidate by digest — see the module doc. */
export const REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION = 2;

/** The pre-`[D-409]` version: candidates by note path only. Read, and still written for an undigested entry. */
export const REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION_V1 = 1;

/** One candidate as recorded — `./repair-choice.ts`'s `RepairChoiceCandidate`, persisted. */
export interface RepairChoiceConfirmationCandidateRecord {
  readonly notePath: VaultPath;
  readonly meetsCertaintyTest: boolean;
  /** `[D-409]`: `./repair-choice.ts`'s `repairCandidateDigest`. Required at version 2, absent at version 1. */
  readonly digest?: string;
}

/**
 * One deleted id awaiting her grouped choice (`[D-392]`) — persisted the same folder as
 * {@link DuplicationConfirmationRecord}, under {@link REPAIR_CHOICE_CONFIRMATION_REASON}.
 */
export interface RepairChoiceConfirmationRecord {
  readonly instrumentId: string;
  /** Non-empty; every candidate `./repair-choice.ts`'s `buildRepairChoice` named for `instrumentId`. */
  readonly candidates: readonly RepairChoiceConfirmationCandidateRecord[];
  readonly status: DuplicationConfirmationRecordStatus;
  readonly reason: RepairChoiceConfirmationReason;
  /** ISO 8601 — when this deleted id was first proposed. Never moved by a later read. */
  readonly proposedAt: string;
  readonly confirmedAt?: string;
  readonly declinedAt?: string;
  /** Set only once `status` is `'confirmed'` — which candidate she chose. */
  readonly resolvedNotePath?: VaultPath;
  /** `[D-409]`: set with `resolvedNotePath` at version 2 — the chosen candidate's digest. */
  readonly resolvedDigest?: string;
  readonly schemaVersion: number;
}

/** What a caller (`./open-session.ts`) hands in — one entry per deleted id `buildRepairChoice` sent to `'choice-needed'`. */
export interface RepairChoiceConfirmationEntryInput {
  readonly instrumentId: string;
  readonly candidates: readonly RepairChoiceConfirmationCandidateRecord[];
  /** Epoch ms — the caller's clock. */
  readonly proposedAt: number;
}

export interface StoredRepairChoiceConfirmationRecord {
  readonly path: VaultPath;
  readonly record: RepairChoiceConfirmationRecord;
}

export interface ProposeRepairChoiceConfirmationsResult {
  /** The record each entry now corresponds to, in the entries' own order. */
  readonly records: readonly StoredRepairChoiceConfirmationRecord[];
  /** Every path this call wrote — empty when nothing observed had changed. */
  readonly written: readonly VaultPath[];
}

export interface ProposeDuplicationConfirmationsResult {
  /** The record each entry now corresponds to, in the entries' own order. */
  readonly records: readonly StoredDuplicationConfirmationRecord[];
  /** Every path this call wrote — empty when nothing observed had changed. */
  readonly written: readonly VaultPath[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCopyIdentity(value: unknown): value is DuplicateCopyIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isNonEmptyString(v.notePath) && (v.noteUid === null || isNonEmptyString(v.noteUid));
}

function isCollisionRecord(value: unknown): value is DuplicationConfirmationCollisionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isNonEmptyString(v.instrumentId) && isCopyIdentity(v.kept);
}

export function isDuplicationConfirmationRecord(
  value: unknown,
): value is DuplicationConfirmationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isCopyIdentity(v.losing)) return false;
  if (!Array.isArray(v.collisions) || v.collisions.length === 0) return false;
  if (!v.collisions.every(isCollisionRecord)) return false;
  if (v.status !== 'proposed' && v.status !== 'confirmed' && v.status !== 'declined') return false;
  if (v.reason !== 'duplicate-instrument-id') return false;
  if (!isNonEmptyString(v.proposedAt)) return false;
  if (v.confirmedAt !== undefined && !isNonEmptyString(v.confirmedAt)) return false;
  if (v.declinedAt !== undefined && !isNonEmptyString(v.declinedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

function isRepairChoiceCandidateRecord(
  value: unknown,
): value is RepairChoiceConfirmationCandidateRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v.notePath) &&
    typeof v.meetsCertaintyTest === 'boolean' &&
    (v.digest === undefined || isNonEmptyString(v.digest))
  );
}

/** `[D-392]`'s reader accepts this reason value; {@link isDuplicationConfirmationRecord} is unchanged and still recognises only the other. */
export function isRepairChoiceConfirmationRecord(
  value: unknown,
): value is RepairChoiceConfirmationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (!Array.isArray(v.candidates) || v.candidates.length === 0) return false;
  if (!v.candidates.every(isRepairChoiceCandidateRecord)) return false;
  if (v.status !== 'proposed' && v.status !== 'confirmed' && v.status !== 'declined') return false;
  if (v.reason !== REPAIR_CHOICE_CONFIRMATION_REASON) return false;
  if (!isNonEmptyString(v.proposedAt)) return false;
  if (v.confirmedAt !== undefined && !isNonEmptyString(v.confirmedAt)) return false;
  if (v.declinedAt !== undefined && !isNonEmptyString(v.declinedAt)) return false;
  if (v.resolvedNotePath !== undefined && !isNonEmptyString(v.resolvedNotePath)) return false;
  if (v.resolvedDigest !== undefined && !isNonEmptyString(v.resolvedDigest)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  if (v.schemaVersion === REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION) {
    // `[D-409]`: at version 2 every candidate is identified by digest, and a confirmed answer
    // names one by note path and digest together.
    const candidates = v.candidates as readonly RepairChoiceConfirmationCandidateRecord[];
    if (!candidates.every((candidate) => isNonEmptyString(candidate.digest))) return false;
    if (
      v.status === 'confirmed' &&
      (!isNonEmptyString(v.resolvedNotePath) || !isNonEmptyString(v.resolvedDigest))
    ) {
      return false;
    }
  }
  return true;
}

function serialize(
  record:
    | DuplicationConfirmationRecord
    | RepairChoiceConfirmationRecord
    | ItemValidationConfirmationRecord,
): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Key order ignored — "does this record say something different", never "is it formatted differently". */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => byString(a, b)),
        )
      : v,
  );
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function idSetOf(collisions: readonly { readonly instrumentId: string }[]): readonly string[] {
  return [...new Set(collisions.map((collision) => collision.instrumentId))].sort(byString);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function intersects(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

/** Every well-formed record under the folder; a corrupt or unreadable file is skipped, never thrown. */
export async function listDuplicationConfirmationRecords(
  vault: VaultSource,
): Promise<readonly StoredDuplicationConfirmationRecord[]> {
  // `listFolder`, not `vault.list`: `ObsidianSource.list()` never sees a dot folder.
  const paths = await listFolder(vault, DUPLICATION_CONFIRMATION_FOLDER, { extensions: ['json'] });
  const out: StoredDuplicationConfirmationRecord[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isDuplicationConfirmationRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable: skipped, the same posture as every sibling sidecar.
    }
  }
  return out;
}

/**
 * Every well-formed repair-choice record under the same folder — `[D-392]`'s second reason value.
 * A duplication record (or anything else unrecognised) is silently excluded, the same "not this
 * reader's shape" posture {@link listDuplicationConfirmationRecords} already takes for a record of
 * the wrong schema version; neither reader throws on the other's records.
 */
export async function listRepairChoiceConfirmationRecords(
  vault: VaultSource,
): Promise<readonly StoredRepairChoiceConfirmationRecord[]> {
  const paths = await listFolder(vault, DUPLICATION_CONFIRMATION_FOLDER, { extensions: ['json'] });
  const out: StoredRepairChoiceConfirmationRecord[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isRepairChoiceConfirmationRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable: skipped, the same posture as every sibling sidecar.
    }
  }
  return out;
}

/** The first free deterministic path for a new record of this id set — see the module doc. */
async function newRecordPath(
  vault: VaultSource,
  idSet: readonly string[],
  taken: ReadonlySet<VaultPath>,
): Promise<VaultPath> {
  const base = `${DUPLICATION_CONFIRMATION_FOLDER}/${await hashText(idSet.join('\n'))}`;
  for (let n = 1; ; n += 1) {
    const path = n === 1 ? `${base}.json` : `${base}-${n}.json`;
    // `exists` too: a corrupt file at a path is skipped by the listing, never overwritten here.
    if (!taken.has(path) && !(await vault.exists(path))) return path;
  }
}

/**
 * Persists `entries` — one per losing note, as `olea-core`'s `resolveInstrumentDuplications`
 * produces them — against the records already in the folder, rename-safely. Idempotent: an entry
 * already on record writes nothing unless where a copy was observed changed. See the module doc
 * for the matching rule and what it cannot tell apart. Writes only under
 * {@link DUPLICATION_CONFIRMATION_FOLDER}; reads nothing at all when `entries` is empty.
 */
export async function proposeDuplicationConfirmations(
  vault: VaultSource,
  entries: readonly DuplicationConfirmationEntryInput[],
  options: ProposeDuplicationConfirmationsOptions = {},
): Promise<ProposeDuplicationConfirmationsResult> {
  if (entries.length === 0) return { records: [], written: [] };
  const noteUidOf = options.noteUidOf ?? (() => null);

  const stored = await listDuplicationConfirmationRecords(vault);
  const storedIdSets = stored.map(({ record }) => idSetOf(record.collisions));
  const entryIdSets = entries.map((entry) => idSetOf(entry.collisions));
  const currentLosingPaths = new Set(entries.map((entry) => entry.losingNotePath));
  const unmatched = new Set(stored.map((_, index) => index));
  const matchOf = new Map<number, number>();

  // Pass 1: the losing copy is still where the record last observed it.
  entries.forEach((entry, e) => {
    const ids = entryIdSets[e] ?? [];
    const candidates = [...unmatched].filter(
      (s) =>
        stored[s]?.record.losing.notePath === entry.losingNotePath &&
        intersects(storedIdSets[s] ?? [], ids),
    );
    candidates.sort(
      (a, b) =>
        Number(!sameSet(storedIdSets[a] ?? [], ids)) - Number(!sameSet(storedIdSets[b] ?? [], ids)),
    );
    const s = candidates[0];
    if (s !== undefined) {
      matchOf.set(e, s);
      unmatched.delete(s);
    }
  });

  // Pass 2: the record's losing copy is no longer observed losing anywhere — it moved (a rename of
  // the losing note, or a rename that flipped which copy the walk keeps). Equal id set first, then
  // the same non-null `olea-uid`, then path order.
  entries.forEach((entry, e) => {
    if (matchOf.has(e)) return;
    const ids = entryIdSets[e] ?? [];
    const uid = noteUidOf(entry.losingNotePath);
    const rank = (s: number): [number, number] => [
      sameSet(storedIdSets[s] ?? [], ids) ? 0 : 1,
      uid !== null && stored[s]?.record.losing.noteUid === uid ? 0 : 1,
    ];
    const candidates = [...unmatched].filter((s) => {
      const record = stored[s]?.record;
      return (
        record !== undefined &&
        !currentLosingPaths.has(record.losing.notePath) &&
        intersects(storedIdSets[s] ?? [], ids)
      );
    });
    candidates.sort((a, b) => {
      const [a0, a1] = rank(a);
      const [b0, b1] = rank(b);
      return a0 - b0 || a1 - b1 || byString(stored[a]?.path ?? '', stored[b]?.path ?? '');
    });
    const s = candidates[0];
    if (s !== undefined) {
      matchOf.set(e, s);
      unmatched.delete(s);
    }
  });

  const taken = new Set(stored.map(({ path }) => path));
  const records: StoredDuplicationConfirmationRecord[] = [];
  const written: VaultPath[] = [];

  for (const [e, entry] of entries.entries()) {
    const losing: DuplicateCopyIdentity = {
      notePath: entry.losingNotePath,
      noteUid: noteUidOf(entry.losingNotePath),
    };
    const collisions: DuplicationConfirmationCollisionRecord[] = [...entry.collisions]
      .sort((a, b) => byString(a.instrumentId, b.instrumentId))
      .map((collision) => ({
        instrumentId: collision.instrumentId,
        kept: { notePath: collision.keptNotePath, noteUid: noteUidOf(collision.keptNotePath) },
      }));

    const s = matchOf.get(e);
    const existing = s === undefined ? undefined : stored[s];
    if (existing !== undefined) {
      if (existing.record.schemaVersion !== DUPLICATION_CONFIRMATION_RECORD_SCHEMA_VERSION) {
        // Not a shape this module writes: matched, so nothing shadows it, and never rewritten.
        records.push(existing);
        continue;
      }
      const refreshed: DuplicationConfirmationRecord = { ...existing.record, losing, collisions };
      if (canonical(refreshed) !== canonical(existing.record)) {
        await vault.write(existing.path, serialize(refreshed));
        written.push(existing.path);
        records.push({ path: existing.path, record: refreshed });
      } else {
        records.push(existing);
      }
      continue;
    }

    const record: DuplicationConfirmationRecord = {
      losing,
      collisions,
      status: 'proposed',
      reason: 'duplicate-instrument-id',
      proposedAt: new Date(entry.proposedAt).toISOString(),
      schemaVersion: DUPLICATION_CONFIRMATION_RECORD_SCHEMA_VERSION,
    };
    const path = await newRecordPath(vault, entryIdSets[e] ?? [], taken);
    taken.add(path);
    await vault.write(path, serialize(record));
    written.push(path);
    records.push({ path, record });
  }

  return { records, written };
}

/** `[D-265]` ruling 3's own reason value — this store's own name for it, never a clause's verbatim wording. */
export type ItemValidationConfirmationReason = 'item-validation';

export const ITEM_VALIDATION_CONFIRMATION_REASON: ItemValidationConfirmationReason =
  'item-validation';

export const ITEM_VALIDATION_CONFIRMATION_RECORD_SCHEMA_VERSION = 1;

/**
 * One suspected item awaiting her confirmation or dismissal (F2.23) —
 * persisted the same shared folder as {@link DuplicationConfirmationRecord}
 * and {@link RepairChoiceConfirmationRecord}, under
 * {@link ITEM_VALIDATION_CONFIRMATION_REASON}. `kind` is always one of the
 * five defect kinds F2.23 names — never a free-form diagnosis, matching
 * `ItemValidationProposal.kind`'s own contract in `packages/core/src/
 * concept/revision/types.ts`.
 */
export interface ItemValidationConfirmationRecord {
  readonly instrumentId: string;
  readonly kind: ItemDefectEvidenceKind;
  /** Content-free (D-005): a short structural note from the judge, never her wording. */
  readonly reason?: string;
  readonly status: DuplicationConfirmationRecordStatus;
  readonly reasonKind: ItemValidationConfirmationReason;
  /** ISO 8601 — when this item was first proposed. Never moved by a later read. */
  readonly proposedAt: string;
  readonly confirmedAt?: string;
  readonly declinedAt?: string;
  readonly schemaVersion: number;
}

/** What a caller (`./item-validation-wiring.ts`) hands in — one entry per `'proposed'` `ItemValidationOutcome`. */
export interface ItemValidationConfirmationEntryInput {
  readonly instrumentId: string;
  readonly kind: ItemDefectEvidenceKind;
  readonly reason?: string;
  /** Epoch ms — the caller's clock. */
  readonly proposedAt: number;
}

export interface StoredItemValidationConfirmationRecord {
  readonly path: VaultPath;
  readonly record: ItemValidationConfirmationRecord;
}

export interface ProposeItemValidationConfirmationsResult {
  /** The record each entry now corresponds to, in the entries' own order. */
  readonly records: readonly StoredItemValidationConfirmationRecord[];
  /** Every path this call wrote — empty when nothing observed had changed. */
  readonly written: readonly VaultPath[];
}

/** Mirrors `olea-core`'s `ItemDefectEvidenceKind` literals verbatim (`packages/core/src/concept/revision/types.ts`) — that type has no exported value-level array to derive this from, the same hand-rolled-guard style `citation-store.ts`'s own doc names for this directory. */
const ITEM_DEFECT_EVIDENCE_KINDS: ReadonlySet<string> = new Set([
  'key-conflicts-with-source',
  'stem-satisfied-by-multiple-options',
  'missing-central-assumption',
  'corrupted-prompt-or-source',
  'superseded-material',
]);

function isItemDefectEvidenceKind(value: unknown): value is ItemDefectEvidenceKind {
  return typeof value === 'string' && ITEM_DEFECT_EVIDENCE_KINDS.has(value);
}

/** `[D-265]` ruling 3's reader accepts this reason value; the other two readers are unchanged and still recognise only their own. */
export function isItemValidationConfirmationRecord(
  value: unknown,
): value is ItemValidationConfirmationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (!isItemDefectEvidenceKind(v.kind)) return false;
  if (v.reason !== undefined && !isNonEmptyString(v.reason)) return false;
  if (v.status !== 'proposed' && v.status !== 'confirmed' && v.status !== 'declined') return false;
  if (v.reasonKind !== ITEM_VALIDATION_CONFIRMATION_REASON) return false;
  if (!isNonEmptyString(v.proposedAt)) return false;
  if (v.confirmedAt !== undefined && !isNonEmptyString(v.confirmedAt)) return false;
  if (v.declinedAt !== undefined && !isNonEmptyString(v.declinedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

/**
 * Every well-formed item-validation record under the same folder. A record of either other
 * reason (or anything else unrecognised) is silently excluded — the same "not this reader's
 * shape" posture {@link listRepairChoiceConfirmationRecords} already takes for a duplication
 * record; none of the three readers throws on either other's records.
 */
export async function listItemValidationConfirmationRecords(
  vault: VaultSource,
): Promise<readonly StoredItemValidationConfirmationRecord[]> {
  const paths = await listFolder(vault, DUPLICATION_CONFIRMATION_FOLDER, { extensions: ['json'] });
  const out: StoredItemValidationConfirmationRecord[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isItemValidationConfirmationRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable: skipped, the same posture as every sibling sidecar.
    }
  }
  return out;
}

/**
 * Persists `entries` — one per `'proposed'` `ItemValidationOutcome`
 * (`./item-validation-wiring.ts`) — against the records already in the folder. Idempotent, keyed
 * by `instrumentId` alone, the same identity scheme {@link proposeRepairChoiceConfirmations}
 * uses and for the same reason (see this module's doc's "Identity here is simply
 * `instrumentId`"). Calling this again for an instrument already on record writes nothing new
 * unless its still-`'proposed'` fields changed; once a record leaves `'proposed'` (she has
 * answered — no reader does this yet, see the module doc), it is matched so nothing shadows it,
 * but never rewritten. Writes only under {@link DUPLICATION_CONFIRMATION_FOLDER}; reads nothing
 * when `entries` is empty.
 */
export async function proposeItemValidationConfirmations(
  vault: VaultSource,
  entries: readonly ItemValidationConfirmationEntryInput[],
): Promise<ProposeItemValidationConfirmationsResult> {
  if (entries.length === 0) return { records: [], written: [] };

  const existing = await listItemValidationConfirmationRecords(vault);
  const existingByInstrumentId = new Map(
    existing.map((stored) => [stored.record.instrumentId, stored]),
  );
  // Every path already claimed under the shared folder, whichever reason wrote it — so a new
  // item-validation record never collides with a duplication or repair-choice record's own
  // deterministic name.
  const taken = new Set(
    await listFolder(vault, DUPLICATION_CONFIRMATION_FOLDER, { extensions: ['json'] }),
  );

  const records: StoredItemValidationConfirmationRecord[] = [];
  const written: VaultPath[] = [];

  for (const entry of entries) {
    const stored = existingByInstrumentId.get(entry.instrumentId);

    if (stored !== undefined) {
      if (
        stored.record.schemaVersion !== ITEM_VALIDATION_CONFIRMATION_RECORD_SCHEMA_VERSION ||
        stored.record.status !== 'proposed'
      ) {
        records.push(stored);
        continue;
      }
      const refreshed: ItemValidationConfirmationRecord = {
        ...stored.record,
        kind: entry.kind,
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      };
      if (canonical(refreshed) !== canonical(stored.record)) {
        await vault.write(stored.path, serialize(refreshed));
        written.push(stored.path);
        records.push({ path: stored.path, record: refreshed });
      } else {
        records.push(stored);
      }
      continue;
    }

    const record: ItemValidationConfirmationRecord = {
      instrumentId: entry.instrumentId,
      kind: entry.kind,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      status: 'proposed',
      reasonKind: ITEM_VALIDATION_CONFIRMATION_REASON,
      proposedAt: new Date(entry.proposedAt).toISOString(),
      schemaVersion: ITEM_VALIDATION_CONFIRMATION_RECORD_SCHEMA_VERSION,
    };
    const path = await newRecordPath(vault, [entry.instrumentId], taken);
    taken.add(path);
    await vault.write(path, serialize(record));
    written.push(path);
    records.push({ path, record });
  }

  return { records, written };
}

/**
 * `[D-392]`'s persisted half: one grouped proposal per deleted id, in the SAME folder as
 * {@link proposeDuplicationConfirmations}, under {@link REPAIR_CHOICE_CONFIRMATION_REASON}.
 * Idempotent, keyed by `instrumentId` alone (see module doc's "Identity here is simply
 * `instrumentId`"): calling this again with the same deleted id writes nothing new unless its
 * still-`'proposed'` candidates changed. Once a record leaves `'proposed'` (she has answered), it
 * is matched so nothing shadows it, but never rewritten — binding condition 1's "the original
 * identity is preserved until she resolves it" is this store's own no-op for every call after
 * that. Writes only under {@link DUPLICATION_CONFIRMATION_FOLDER}; reads nothing when `entries` is
 * empty.
 *
 * `[D-409]`: an entry whose every candidate carries a digest is written as version 2 (upgrading a
 * still-proposed version 1 record in place); any other entry is written as version 1, as before,
 * and never downgrades a version 2 record. Candidates are stored in note-path-then-digest order.
 * See the module doc's migration posture.
 */
export async function proposeRepairChoiceConfirmations(
  vault: VaultSource,
  entries: readonly RepairChoiceConfirmationEntryInput[],
): Promise<ProposeRepairChoiceConfirmationsResult> {
  if (entries.length === 0) return { records: [], written: [] };

  const existing = await listRepairChoiceConfirmationRecords(vault);
  const existingByInstrumentId = new Map(
    existing.map((stored) => [stored.record.instrumentId, stored]),
  );
  // Every path already claimed under the shared folder, whichever reason wrote it — so a new
  // repair-choice record never collides with a duplication record's own deterministic name.
  const taken = new Set(
    await listFolder(vault, DUPLICATION_CONFIRMATION_FOLDER, { extensions: ['json'] }),
  );

  const records: StoredRepairChoiceConfirmationRecord[] = [];
  const written: VaultPath[] = [];

  for (const entry of entries) {
    const candidates = candidateRecordsOf(entry.candidates);
    const digested = candidates.every((candidate) => candidate.digest !== undefined);
    const schemaVersion = digested
      ? REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION
      : REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION_V1;
    const stored = existingByInstrumentId.get(entry.instrumentId);

    if (stored !== undefined) {
      if (
        !isWritableRepairChoiceVersion(stored.record.schemaVersion) ||
        stored.record.status !== 'proposed' ||
        // Never downgrade: an undigested entry leaves a version 2 record's digests as they are.
        stored.record.schemaVersion > schemaVersion
      ) {
        // Not this module's shape to rewrite, or already resolved: matched, so no second
        // proposal shadows it, and never rewritten (binding condition 1).
        records.push(stored);
        continue;
      }
      const refreshed: RepairChoiceConfirmationRecord = {
        ...stored.record,
        candidates,
        schemaVersion,
      };
      if (canonical(refreshed) !== canonical(stored.record)) {
        await vault.write(stored.path, serialize(refreshed));
        written.push(stored.path);
        records.push({ path: stored.path, record: refreshed });
      } else {
        records.push(stored);
      }
      continue;
    }

    const record: RepairChoiceConfirmationRecord = {
      instrumentId: entry.instrumentId,
      candidates,
      status: 'proposed',
      reason: REPAIR_CHOICE_CONFIRMATION_REASON,
      proposedAt: new Date(entry.proposedAt).toISOString(),
      schemaVersion,
    };
    const path = await newRecordPath(vault, [entry.instrumentId], taken);
    taken.add(path);
    await vault.write(path, serialize(record));
    written.push(path);
    records.push({ path, record });
  }

  return { records, written };
}

/** The two repair-choice versions this module reads, answers and refreshes; any other is left as it is. */
function isWritableRepairChoiceVersion(schemaVersion: number): boolean {
  return (
    schemaVersion === REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION ||
    schemaVersion === REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION_V1
  );
}

/**
 * The candidates as they are persisted: `[D-409]`'s note-path-then-digest order, and no `digest`
 * key at all on a candidate that has none (so a version 1 file stays exactly its old shape).
 */
function candidateRecordsOf(
  candidates: readonly RepairChoiceConfirmationCandidateRecord[],
): RepairChoiceConfirmationCandidateRecord[] {
  return [...candidates].sort(compareRepairChoiceCandidates).map((candidate) => ({
    notePath: candidate.notePath,
    meetsCertaintyTest: candidate.meetsCertaintyTest,
    ...(candidate.digest !== undefined ? { digest: candidate.digest } : {}),
  }));
}

/** The record for `instrumentId` — the same one {@link proposeRepairChoiceConfirmations} would match (the last listed). */
async function findRepairChoiceRecord(
  vault: VaultSource,
  instrumentId: string,
): Promise<StoredRepairChoiceConfirmationRecord | undefined> {
  const matches = (await listRepairChoiceConfirmationRecords(vault)).filter(
    (stored) => stored.record.instrumentId === instrumentId,
  );
  return matches[matches.length - 1];
}

/**
 * `[D-409]`: the one current block the candidate `(notePath, digest)` names, or `undefined` when
 * none or several do — the block was edited, its heading path changed, it moved to another note,
 * or two blocks with the same text sit under the same headings. Every such case is stale.
 */
async function pinCandidate(
  notePath: VaultPath,
  digest: string,
  currentRecords: readonly VaultInstrumentRecord[],
): Promise<VaultInstrumentRecord | undefined> {
  const pinned: VaultInstrumentRecord[] = [];
  for (const record of currentRecords) {
    if (record.notePath !== notePath) continue;
    if ((await digestOfInstrumentRecord(record)) === digest) pinned.push(record);
  }
  return pinned.length === 1 ? pinned[0] : undefined;
}

/** Her answer as the grouped choice saves it — `[D-409]`: a candidate by note path and digest, or none of these. */
export type RepairChoiceSavedAnswer =
  | { readonly kind: 'candidate'; readonly notePath: VaultPath; readonly digest: string }
  | { readonly kind: 'none-of-these' };

export interface SaveRepairChoiceAnswerInput {
  /** The deleted id the grouped choice is about. */
  readonly instrumentId: string;
  readonly answer: RepairChoiceSavedAnswer;
  /** Every instrument a fresh vault walk sees now — what her chosen candidate is re-checked against. */
  readonly currentRecords: readonly VaultInstrumentRecord[];
  /** Epoch ms — the caller's clock. */
  readonly now: number;
}

export type SaveRepairChoiceAnswerResult =
  /** Written: `'confirmed'` with `resolvedNotePath` and `resolvedDigest`, or `'declined'`. */
  | { readonly kind: 'saved'; readonly stored: StoredRepairChoiceConfirmationRecord }
  /**
   * `[D-409]`: her chosen block no longer matches its digest (edited, moved, or now ambiguous), or
   * the record predates digests. Nothing is written; the record stays `'proposed'`, to be
   * refreshed by the next walk's {@link proposeRepairChoiceConfirmations} and offered again.
   */
  | { readonly kind: 'stale'; readonly stored: StoredRepairChoiceConfirmationRecord }
  /** The deleted id is live again somewhere; there is nothing left to repair, and nothing is written. */
  | { readonly kind: 'id-live'; readonly stored: StoredRepairChoiceConfirmationRecord }
  /** Already answered — binding condition 1: an answer is saved once. */
  | { readonly kind: 'already-resolved'; readonly stored: StoredRepairChoiceConfirmationRecord }
  /** The answer names a candidate this record never offered — a caller bug, never a real choice. */
  | { readonly kind: 'unknown-candidate'; readonly stored: StoredRepairChoiceConfirmationRecord }
  /** A record version this module does not answer; left exactly as it is. */
  | { readonly kind: 'unsupported-version'; readonly stored: StoredRepairChoiceConfirmationRecord }
  | { readonly kind: 'not-found' };

/**
 * `[D-392]` / `[D-409]` (`ol-v7r5.105`): saves her answer to a grouped repair choice. "None of
 * these" is saved as `'declined'` whatever the vault now holds — declining attaches nothing, so
 * there is nothing to go stale. A candidate is saved as `'confirmed'` only when its
 * `(notePath, digest)` pins exactly one block in the current walk; otherwise the answer is
 * `'stale'` and nothing is written (re-proposed, never applied). Writes only the record, only
 * under {@link DUPLICATION_CONFIRMATION_FOLDER}; it never writes into her note — the write-back is
 * {@link applyConfirmedRepairChoice}'s caller's, through `../instrument-stamping/repair-write-back.ts`.
 */
export async function saveRepairChoiceAnswer(
  vault: VaultSource,
  input: SaveRepairChoiceAnswerInput,
): Promise<SaveRepairChoiceAnswerResult> {
  const { instrumentId, answer, currentRecords, now } = input;
  const stored = await findRepairChoiceRecord(vault, instrumentId);
  if (stored === undefined) return { kind: 'not-found' };
  const { record } = stored;
  if (!isWritableRepairChoiceVersion(record.schemaVersion)) {
    return { kind: 'unsupported-version', stored };
  }
  if (record.status !== 'proposed') return { kind: 'already-resolved', stored };
  if (currentRecords.some((current) => current.instrumentId === instrumentId)) {
    return { kind: 'id-live', stored };
  }

  const at = new Date(now).toISOString();
  if (answer.kind === 'none-of-these') {
    const declined: RepairChoiceConfirmationRecord = {
      ...record,
      status: 'declined',
      declinedAt: at,
    };
    await vault.write(stored.path, serialize(declined));
    return { kind: 'saved', stored: { path: stored.path, record: declined } };
  }

  // A version 1 record carries no digest: its candidates cannot be pinned to one block, so an
  // answer naming one is re-proposed, never guessed onto a block by note path.
  if (record.schemaVersion !== REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION) {
    return { kind: 'stale', stored };
  }
  const offered = record.candidates.some(
    (candidate) => candidate.notePath === answer.notePath && candidate.digest === answer.digest,
  );
  if (!offered) return { kind: 'unknown-candidate', stored };
  if ((await pinCandidate(answer.notePath, answer.digest, currentRecords)) === undefined) {
    return { kind: 'stale', stored };
  }

  const confirmed: RepairChoiceConfirmationRecord = {
    ...record,
    status: 'confirmed',
    confirmedAt: at,
    resolvedNotePath: answer.notePath,
    resolvedDigest: answer.digest,
  };
  await vault.write(stored.path, serialize(confirmed));
  return { kind: 'saved', stored: { path: stored.path, record: confirmed } };
}

export interface ApplyConfirmedRepairChoiceInput {
  readonly instrumentId: string;
  /** Every instrument a fresh vault walk sees now. */
  readonly currentRecords: readonly VaultInstrumentRecord[];
}

export type ApplyConfirmedRepairChoiceResult =
  /**
   * Her confirmed block still matches its digest: hand `resolution` and `candidateRaw` to
   * `../instrument-stamping/repair-write-back.ts`'s `writeBackRecoveredInstrumentId`, which applies
   * its own refusals before writing. `target` is the one current record the digest pinned.
   */
  | {
      readonly kind: 'apply';
      readonly stored: StoredRepairChoiceConfirmationRecord;
      readonly resolution: RepairChoiceAttachedResult;
      readonly candidateRaw: string;
      readonly target: VaultInstrumentRecord;
    }
  /** The deleted id is live again (the write-back already landed, or it is claimed): nothing to apply. */
  | { readonly kind: 'id-live'; readonly stored: StoredRepairChoiceConfirmationRecord }
  /**
   * `[D-409]`: the confirmed block no longer matches its digest, so the record was written back to
   * `'proposed'` (her answer's fields removed) to be offered again — never applied.
   */
  | { readonly kind: 'reproposed'; readonly stored: StoredRepairChoiceConfirmationRecord }
  | { readonly kind: 'not-confirmed'; readonly stored: StoredRepairChoiceConfirmationRecord }
  | { readonly kind: 'unsupported-version'; readonly stored: StoredRepairChoiceConfirmationRecord }
  | { readonly kind: 'not-found' };

/**
 * `[D-409]` (`ol-v7r5.105`): re-checks a confirmed answer's digest against the current walk
 * before anything is written into her note. Exactly one block at `resolvedNotePath` with
 * `resolvedDigest` is `'apply'`; anything else is stale and the record is re-proposed. Writes only
 * the record, and only when re-proposing; never her note.
 */
export async function applyConfirmedRepairChoice(
  vault: VaultSource,
  input: ApplyConfirmedRepairChoiceInput,
): Promise<ApplyConfirmedRepairChoiceResult> {
  const { instrumentId, currentRecords } = input;
  const stored = await findRepairChoiceRecord(vault, instrumentId);
  if (stored === undefined) return { kind: 'not-found' };
  const { record } = stored;
  if (!isWritableRepairChoiceVersion(record.schemaVersion)) {
    return { kind: 'unsupported-version', stored };
  }
  if (record.status !== 'confirmed') return { kind: 'not-confirmed', stored };
  if (currentRecords.some((current) => current.instrumentId === instrumentId)) {
    return { kind: 'id-live', stored };
  }

  const { resolvedNotePath, resolvedDigest } = record;
  const target =
    resolvedNotePath === undefined || resolvedDigest === undefined
      ? undefined
      : await pinCandidate(resolvedNotePath, resolvedDigest, currentRecords);

  if (target === undefined || resolvedNotePath === undefined || resolvedDigest === undefined) {
    const {
      confirmedAt: _confirmedAt,
      resolvedNotePath: _resolvedNotePath,
      resolvedDigest: _resolvedDigest,
      ...rest
    } = record;
    const reproposed: RepairChoiceConfirmationRecord = { ...rest, status: 'proposed' };
    await vault.write(stored.path, serialize(reproposed));
    return { kind: 'reproposed', stored: { path: stored.path, record: reproposed } };
  }

  const proposal: RepairChoiceProposal = {
    instrumentId: record.instrumentId,
    candidates: record.candidates.map((candidate) => ({ ...candidate })),
    status: 'confirmed',
    proposedAt: Date.parse(record.proposedAt),
    resolvedNotePath,
    resolvedDigest,
  };
  return {
    kind: 'apply',
    stored,
    resolution: {
      kind: 'attached',
      instrumentId: record.instrumentId,
      notePath: resolvedNotePath,
      digest: resolvedDigest,
      proposal,
    },
    candidateRaw: rawOfInstrumentRecord(target),
    target,
  };
}
