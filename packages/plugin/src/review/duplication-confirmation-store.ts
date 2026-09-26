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
 * It never transitions a status and never reads her answer: no clause defines an affordance for
 * her to confirm or decline a duplication, so this module stops at the record. It never decides
 * what she is served — the withholding is `./open-session.ts`'s, computed from the live
 * collision every time, whatever status a record holds (F3's "it holds while the loser waits in
 * the queue as much as after she answers"). It never deletes a record.
 */

import type { VaultPath, VaultSource } from 'olea-core';
import { hashText, listFolder } from 'olea-core';

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

function serialize(record: DuplicationConfirmationRecord): string {
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
