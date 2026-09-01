/**
 * `DraftCacheStore` — the unreviewed-draft cache (F3.3, `[CACHE-1]`/C6.2,
 * `ol-p3t07a`), written **inside the vault** through `VaultSource`, never in
 * the plugin data folder. `[CACHE-1]` is explicit about why: the cache is
 * per-student, not per-device, and what reaches her phone is exactly what
 * Olea writes inside the vault — a plugin-data-folder cache would make
 * unreviewed drafts a desktop-only fact, which is the exact failure C6.2's
 * amendment exists to close.
 *
 * **Per-record files, one per draft, under `.olea/drafts/`** — C6.2's own
 * words: "Records are written per record, as separate files, so two devices
 * touching different concepts merge as ordinary file additions instead of
 * racing over one large shared index." `put()` never rewrites another
 * draft's file, and `.olea/drafts/<draftId>.json` is the unit two devices'
 * sync tool merges.
 *
 * **The one thing this module cannot avoid, disclosed rather than hidden:**
 * `.olea/` is dot-prefixed (matching `.olea/reviews/`'s own convention,
 * `review-log/path.ts`), and `ObsidianSource.list()` — built on Obsidian's
 * `vault.getFiles()` — never enumerates anything under a dot-prefixed
 * folder, `under` or no `under` (the same limitation `open-session.ts`'s own
 * comment records for the review log). So per-record files alone cannot be
 * *discovered*; something has to say which draft ids exist without
 * listing the directory. `.olea/drafts/index.json` is that something: a
 * single small file — draft id, course, concept, status, nothing content-
 * shaped — that `put()` keeps in sync with the per-record files it points
 * at. It is the one piece of this cache that is NOT per-record, and
 * therefore the one place two devices drafting different concepts in the
 * same window can race (a lost update to the index, not to any draft's own
 * file). The bounded consequence of that race is a temporarily
 * under-discovered draft — never lost data, since the per-record file a
 * losing write already wrote survives untouched and a later `put()` from
 * either device repairs the index entry the next time that same draft is
 * touched. **`ol-y6ty`'s look at closing this properly, and why it stays
 * flagged rather than attempted:**
 *
 * - **No fix is buildable from inside this module.** Closing the race for
 *   real needs one of two things this file does not control: a conditional/
 *   compare-and-swap write on `VaultSource` (there is none — `write()` always
 *   unconditionally replaces), or `ObsidianSource` gaining the ability to
 *   enumerate `.olea/drafts/` so a stray per-record file with no index entry
 *   could be found and the entry rebuilt. The second is `ol-yk1c`'s scope
 *   (closed for `.olea/reviews/`'s read path, not for this folder), not this
 *   one's. An in-process read-verify-retry around `writeIndex` was
 *   considered and rejected: the clobber this race describes happens when a
 *   second device's *already-written* file reaches this vault later, via
 *   whatever sync tool she uses, on a timeline this process is not running
 *   on — re-reading our own write moments later cannot observe a clobber
 *   that has not synced in yet, so the retry would pass every time and
 *   supply false confidence rather than protection.
 * - **The concrete cost is slightly worse than "temporarily invisible."**
 *   `findByKey` (below) answers `pipeline.ts`'s dedupe check
 *   (`packages/plugin/src/generation/pipeline.ts:196`) from the index alone.
 *   A dropped entry makes that check report "no existing draft" for a
 *   concept that already has one, so the sweep drafts a **second** record for
 *   the same `(courseCode, conceptName)` pair — a spent generation call and a
 *   duplicate item in review, not data loss (both records' files are intact
 *   and independently reviewable, and either can be rejected without
 *   touching the other).
 * - **The real fix needs two landings, not one.** A merge-safe index (one
 *   shard per device, `.olea/reviews/`'s own `<date>.<deviceId>` shape)
 *   removes the *write* race the same way it does there — two devices never
 *   share a file to race on. But unioning shards at *read* time needs the
 *   same enumeration `ol-yk1c` found missing from `ObsidianSource`; shipping
 *   the shard half alone, before that lands, would make every non-writing
 *   device's shards permanently invisible in production — a regression on
 *   today's "eventually repaired by a touch," not a fix. That is why this
 *   stays flagged rather than partially built.
 * - **One narrower path is real and does not wait on `ol-yk1c`:** if a
 *   caller minted `draftId` deterministically from `(courseCode,
 *   conceptName)` instead of at random, `findByKey`'s specific race would
 *   close outright — compute the expected `draftPath` and check it directly,
 *   the same "no listing needed" move `reviewLogPath` makes for a known
 *   `(date, deviceId)` pair. That is a call-site decision in `pipeline.ts`
 *   (`generateDraftId`), outside this module's ownership and this bead's
 *   `owns`, so it is named here rather than built here.
 *
 * See the `ol-p3t07a` close evidence for the original flag and `ol-y6ty` for
 * this look.
 */

import type { VaultPath, VaultSource } from 'olea-core';
import { type DraftRecord, isDraftRecord } from './types.js';

export const DRAFT_CACHE_FOLDER: VaultPath = '.olea/drafts';
const INDEX_PATH: VaultPath = `${DRAFT_CACHE_FOLDER}/index.json`;

interface IndexEntry {
  readonly draftId: string;
  readonly courseCode: string;
  readonly conceptName: string;
  readonly status: DraftRecord['status'];
}

interface DraftIndex {
  readonly version: 1;
  readonly entries: readonly IndexEntry[];
}

function isIndexEntry(value: unknown): value is IndexEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.draftId === 'string' &&
    typeof v.courseCode === 'string' &&
    typeof v.conceptName === 'string' &&
    (v.status === 'pending' ||
      v.status === 'accepted' ||
      v.status === 'edited' ||
      v.status === 'rejected')
  );
}

function draftPath(draftId: string): VaultPath {
  return `${DRAFT_CACHE_FOLDER}/${draftId}.json`;
}

export interface DraftCacheStore {
  /** Every draft record on file, in no particular order. Corrupt/unreadable per-record files are skipped rather than thrown on — same "report, don't crash" posture `olea-core`'s review-log parser uses for one bad line. */
  list(): Promise<readonly DraftRecord[]>;
  get(draftId: string): Promise<DraftRecord | null>;
  /** Writes (or overwrites) one draft record and keeps `index.json` in sync. Never removes a file — F3.3's "reject prunes… never deleted" (see this module's doc for the index's own, disclosed exception). */
  put(record: DraftRecord): Promise<void>;
  /** Dedupe check (`ol-p3t07a`'s acceptance: "dupe-checked against existing instruments"): any prior draft — pending, accepted, edited, or rejected — for this exact (course, concept) pair. Reads only the index, not every record, so this is cheap to call once per candidate concept per sweep. */
  findByKey(courseCode: string, conceptName: string): Promise<DraftRecord | null>;
  /** Every `status: 'pending'` draft, full records — what `open-session.ts` merges into today's queue. */
  listPending(): Promise<readonly DraftRecord[]>;
}

async function readIndex(vault: VaultSource): Promise<DraftIndex> {
  if (!(await vault.exists(INDEX_PATH))) return { version: 1, entries: [] };
  try {
    const parsed: unknown = JSON.parse(await vault.read(INDEX_PATH));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).entries)
    ) {
      const entries = (parsed as { entries: unknown[] }).entries.filter(isIndexEntry);
      return { version: 1, entries };
    }
  } catch {
    // Corrupt index: rebuilt from scratch below rather than thrown on — the
    // per-record files are the source of truth and survive this untouched.
  }
  return { version: 1, entries: [] };
}

async function writeIndex(vault: VaultSource, index: DraftIndex): Promise<void> {
  await vault.write(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
}

function upsertEntry(index: DraftIndex, entry: IndexEntry): DraftIndex {
  const withoutExisting = index.entries.filter((e) => e.draftId !== entry.draftId);
  return { version: 1, entries: [...withoutExisting, entry] };
}

export function createVaultDraftCacheStore(vault: VaultSource): DraftCacheStore {
  return {
    async get(draftId) {
      const path = draftPath(draftId);
      if (!(await vault.exists(path))) return null;
      try {
        const parsed: unknown = JSON.parse(await vault.read(path));
        return isDraftRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },

    async list() {
      const index = await readIndex(vault);
      const records: DraftRecord[] = [];
      for (const entry of index.entries) {
        const path = draftPath(entry.draftId);
        if (!(await vault.exists(path))) continue; // index stale — the record was never written or the index entry is orphaned; skip rather than fabricate
        try {
          const parsed: unknown = JSON.parse(await vault.read(path));
          if (isDraftRecord(parsed)) records.push(parsed);
        } catch {
          // corrupt per-record file — skip, matching review-log's per-line tolerance
        }
      }
      return records;
    },

    async put(record) {
      await vault.write(draftPath(record.draftId), `${JSON.stringify(record, null, 2)}\n`);
      const index = await readIndex(vault);
      const next = upsertEntry(index, {
        draftId: record.draftId,
        courseCode: record.courseCode,
        conceptName: record.conceptName,
        status: record.status,
      });
      await writeIndex(vault, next);
    },

    async findByKey(courseCode, conceptName) {
      const index = await readIndex(vault);
      const entry = index.entries.find(
        (e) => e.courseCode === courseCode && e.conceptName === conceptName,
      );
      if (entry === undefined) return null;
      return this.get(entry.draftId);
    },

    async listPending() {
      const all = await this.list();
      return all.filter((r) => r.status === 'pending');
    },
  };
}
