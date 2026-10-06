/**
 * The unit manifest projection (`[D-445]`, `ol-egov.141.89.8.43`): the fold from the records of
 * `./records.ts`, drawn from every device's files, to the `UnitManifest` a consumer reads. Pure,
 * deterministic, disposable: delete it and it rebuilds from the same records to the same value, in
 * whatever order the files were read.
 *
 * **Row 26 of David's 2026-09-29 rulings, as this fold's rules.**
 *
 *  1. **Unread or pending units are unknown, never absent.** A revision's units are exactly the pages
 *     its `enumerated` record names (plus any page a state record names). A page with no state record
 *     reads `pending` (queued), the honest starting state (`./manifest.ts#newPendingEntry`); it is
 *     never left out of the manifest, so a manifest can never read as complete by omission. State
 *     records for a revision that was never enumerated make no manifest at all.
 *  2. **A source with no manifest is unknown too, and the boundary says so.** {@link unknownUnitManifest}
 *     is what a consumer is handed for a source this fold has nothing current for: one pending unit,
 *     so every existing reader (`hasPendingUnits`, `reasonForUnitManifest`, `readRecordOf`,
 *     `isFullyRead`) answers unfinished and none answers complete. It is never persisted.
 *  3. **Rebuilding after deletion never shows false completeness.** Delete the folder and the fold
 *     yields no manifests; {@link manifestsWithUnknown} then gives every source the unknown manifest
 *     until it is enumerated again, so the interval between deletion and rebuild reads unknown, not
 *     the text-layer verdict that would call a source complete while its image pages were never read.
 *  4. **Reading state and concept-extraction state stay two fields** on every record; the fold
 *     copies each from the winning record and derives neither from the other.
 *  5. **Explicit revision retirement.** A `retired` record retires the revision it names. A retirement
 *     is ordered like everything else: it retires a revision only if no later enumeration of the same
 *     digest followed it, so a source reverted to bytes it once had is live again with the readings
 *     already made of those bytes. Where no device wrote a retirement (two devices edited offline, a
 *     lost line), the revision enumerated last supersedes the others, deterministically.
 *
 * **The order.** Records compare by `(clock, deviceId)`, the Lamport counter first and the device id
 * breaking a tie; no wall time is ever compared. The latest record per page wins, whole (a record is
 * a state, not a delta). Two devices that read the same page concurrently keep the later; either way
 * the result never says more was read than a record says.
 *
 * **The outcomes-extracted mark (`[D-531]` B, `ol-egov.141.89.7.78`).** A unit record may carry the
 * per-page mark (`./records.ts`). It is the third separate field, derived from neither of the other
 * two, and it reaches the retire-on-revision rule (`../../outcome/retire-on-revision.ts`) through
 * {@link UnitManifestFold.outcomeRevisionPagesOf}: the live revision's expected pages (its
 * enumeration), every listed revision of the path, and its page history. The fold keeps every unit
 * record per revision for this, not only the latest per page, because the rule asks whether the
 * revision was ever read in full, and a later record (a page read again, a reading that failed) must
 * not reopen a revision that was.
 *
 * **When a mark counts.** Only after the revision's current listing, and after every listing of any
 * other revision of the path. The listing is the revision's first enumeration since another revision
 * of the path was last enumerated: a revision returned to after another (A, then B, then A's bytes
 * restored) starts a new listing, because while B was current its deliveries restamped the outcomes
 * A states, and only a fresh extraction of A's pages restamps them back; a mark from A's first
 * listing would let A read in full on stale stamps and retire outcomes A states. The same bytes
 * listed again with no other revision between (a second device enumerating them, a file removed and
 * restored unchanged) keep their listing, so a completed revision stays completed and a later
 * delivery of it stays a reread. Another device can list a revision after this one's last
 * enumeration while this one stays live (it listed B, then removed the file); a mark here then
 * counts only after that other listing. A mark that does not count is the safe direction: the
 * revision is not read in full until its pages are extracted again.
 */

import type { OutcomePageState, OutcomeRevisionPages } from '../../outcome/retire-on-revision.js';
import type { VaultPath } from '../../vault/types.js';
import { newPendingEntry } from './manifest.js';
import { outcomePageReadingOf } from './outcome-extraction.js';
import {
  serialiseUnitManifestRecord,
  type UnitManifestRecord,
  type UnitStateRecord,
} from './records.js';
import type { UnitManifest, UnitManifestEntry } from './types.js';

/** The page number of the one unit {@link unknownUnitManifest} holds. Not a page: it stands for a source nothing has enumerated yet. Real pages are 1-based. */
export const UNENUMERATED_UNIT_PAGE = 0;

/** The digest of a manifest that speaks for no particular bytes: it is unknown, never current (build plan README, consumers rule). */
export const UNVERIFIED_REVISION_DIGEST = 'unverified';

/**
 * The manifest of a source nothing has enumerated: a single pending unit. Every consumer reads it as
 * "not read yet", none as read, complete or absent.
 */
export function unknownUnitManifest(sourcePath: VaultPath): UnitManifest {
  return {
    sourcePath,
    revisionDigest: UNVERIFIED_REVISION_DIGEST,
    entries: [newPendingEntry(sourcePath, UNENUMERATED_UNIT_PAGE)],
  };
}

/**
 * Every path in `paths`, each with its live manifest or, where there is none, the unknown one. The
 * boundary a consumer reads through: a source is never simply missing from what it is handed.
 */
export function manifestsWithUnknown(
  live: ReadonlyMap<VaultPath, UnitManifest>,
  paths: readonly VaultPath[],
): ReadonlyMap<VaultPath, UnitManifest> {
  const out = new Map<VaultPath, UnitManifest>();
  for (const path of paths) out.set(path, live.get(path) ?? unknownUnitManifest(path));
  return out;
}

/** The Lamport clock a writer stamps its next record with, given the highest clock it has seen. */
export function nextUnitManifestClock(maxClockSeen: number): number {
  return maxClockSeen + 1;
}

export interface UnitManifestProjection {
  /** One manifest per source path with a live, enumerated revision. A path with none is not here: it is unknown. */
  readonly manifests: ReadonlyMap<VaultPath, UnitManifest>;
  /** The highest clock over every record folded, retired and superseded ones included: a writer stamps above it. */
  readonly maxClock: number;
}

/** An incremental fold: the same result as {@link foldUnitManifests}, one record at a time. */
export interface UnitManifestFold {
  add(record: UnitManifestRecord): void;
  project(): UnitManifestProjection;
  /** The live manifest of one path, or `undefined` (unknown). */
  manifestOf(path: VaultPath): UnitManifest | undefined;
  /**
   * `[D-531]`: the live revision of one path as the retire-on-revision rule reads it: its expected
   * pages, its page history since it was listed (module doc, "When a mark counts"), and every
   * revision the path has had listed. `undefined` when no revision is live. The fold cannot know the
   * file's bytes: a caller checks `revisionDigest` against them before trusting the answer.
   */
  outcomeRevisionPagesOf(path: VaultPath): OutcomeRevisionPages | undefined;
  /** The highest clock folded so far. */
  maxClock(): number;
}

interface Stamp {
  readonly clock: number;
  readonly deviceId: string;
}

function compareStamps(a: Stamp, b: Stamp): number {
  if (a.clock !== b.clock) return a.clock < b.clock ? -1 : 1;
  if (a.deviceId === b.deviceId) return 0;
  return a.deviceId < b.deviceId ? -1 : 1;
}

/** Stamp order, then the serialised line, so two distinct records never tie whatever order they arrive in. */
function beats(candidate: UnitStateRecord, incumbent: UnitStateRecord): boolean {
  const order = compareStamps(candidate, incumbent);
  if (order !== 0) return order > 0;
  return serialiseUnitManifestRecord(candidate) > serialiseUnitManifestRecord(incumbent);
}

interface RevisionBucket {
  readonly digest: string;
  enumeratedPages: Set<number> | null;
  enumeratedAt: Stamp | null;
  /** Every enumeration's stamp, for the listing a mark must follow (module doc, "When a mark counts"). */
  readonly enumerations: Stamp[];
  retiredAt: Stamp | null;
  readonly units: Map<number, UnitStateRecord>;
  /** Every unit record of the revision, in arrival order: the page history `[D-531]` replays. */
  readonly history: UnitStateRecord[];
}

function isLive(revision: RevisionBucket): boolean {
  if (revision.enumeratedAt === null) return false;
  return (
    revision.retiredAt === null || compareStamps(revision.retiredAt, revision.enumeratedAt) <= 0
  );
}

/**
 * `[D-531]`: the stamp a mark on `revision` must follow to count (module doc, "When a mark counts"):
 * the revision's first enumeration later than every enumeration of the path's other revisions, or,
 * when none of its enumerations is, the latest of those. `null` only when nothing was enumerated.
 */
function markThreshold(
  revision: RevisionBucket,
  revisions: ReadonlyMap<string, RevisionBucket>,
): Stamp | null {
  let otherLatest: Stamp | null = null;
  for (const other of revisions.values()) {
    if (other === revision) continue;
    for (const stamp of other.enumerations) {
      if (otherLatest === null || compareStamps(stamp, otherLatest) > 0) otherLatest = stamp;
    }
  }
  let listed: Stamp | null = null;
  for (const stamp of revision.enumerations) {
    if (otherLatest !== null && compareStamps(stamp, otherLatest) <= 0) continue;
    if (listed === null || compareStamps(stamp, listed) < 0) listed = stamp;
  }
  return listed ?? otherLatest;
}

/** Whether a record was written after `threshold`. Nothing is, when there is no threshold. */
function isAfter(record: Stamp, threshold: Stamp | null): boolean {
  return threshold !== null && compareStamps(record, threshold) > 0;
}

function manifestOfRevision(
  sourcePath: VaultPath,
  revision: RevisionBucket,
  threshold: Stamp | null,
): UnitManifest {
  const pages = new Set<number>(revision.enumeratedPages ?? []);
  for (const page of revision.units.keys()) pages.add(page);
  const entries: UnitManifestEntry[] = [...pages]
    .sort((a, b) => a - b)
    .map((page) => {
      const record = revision.units.get(page);
      if (record === undefined) return newPendingEntry(sourcePath, page);
      return {
        unitId: record.unitId,
        sourcePath,
        page,
        readingState: record.readingState,
        conceptExtractionState: record.conceptExtractionState,
        // `[D-531]`: the mark counts only after the revision's listing (module doc).
        ...(record.outcomeExtractionState === 'complete' && isAfter(record, threshold)
          ? { outcomeExtractionState: 'complete' as const }
          : {}),
      };
    });
  return { sourcePath, revisionDigest: revision.digest, entries };
}

/**
 * `[D-531]`: the live revision's page history as `OutcomeRevisionPages.history` defines it. First,
 * each page whose latest record is older than the listing, with that record's reading and no mark;
 * then every record written after the listing in the page record's own order (stamp, then the
 * serialised line, so the same records in any arrival order give the same history; a record read
 * twice appears once).
 */
function outcomeHistoryOf(
  revision: RevisionBucket,
  threshold: Stamp | null,
): readonly OutcomePageState[] {
  const history: OutcomePageState[] = [];
  for (const page of [...revision.units.keys()].sort((a, b) => a - b)) {
    const latest = revision.units.get(page);
    if (latest === undefined || isAfter(latest, threshold)) continue;
    history.push({
      page,
      reading: outcomePageReadingOf(latest.readingState),
      outcomesExtracted: false,
    });
  }
  const since = revision.history
    .filter((record) => isAfter(record, threshold))
    .map((record) => ({ record, line: serialiseUnitManifestRecord(record) }))
    .sort((a, b) => {
      const order = compareStamps(a.record, b.record);
      if (order !== 0) return order;
      if (a.line === b.line) return 0;
      return a.line < b.line ? -1 : 1;
    });
  let previousLine: string | null = null;
  for (const { record, line } of since) {
    if (line === previousLine) continue;
    previousLine = line;
    history.push({
      page: record.page,
      reading: outcomePageReadingOf(record.readingState),
      outcomesExtracted: record.outcomeExtractionState === 'complete',
    });
  }
  return history;
}

/** The live revision of one path: the enumerated, unretired one enumerated last. `null` when none is live. */
function liveRevision(revisions: ReadonlyMap<string, RevisionBucket>): RevisionBucket | null {
  let best: RevisionBucket | null = null;
  for (const revision of revisions.values()) {
    if (!isLive(revision) || revision.enumeratedAt === null) continue;
    if (best === null || best.enumeratedAt === null) {
      best = revision;
      continue;
    }
    const order = compareStamps(revision.enumeratedAt, best.enumeratedAt);
    if (order > 0 || (order === 0 && revision.digest > best.digest)) best = revision;
  }
  return best;
}

export function createUnitManifestFold(): UnitManifestFold {
  const paths = new Map<VaultPath, Map<string, RevisionBucket>>();
  const cache = new Map<VaultPath, UnitManifest | null>();
  let highestClock = 0;

  const bucketOf = (path: VaultPath, digest: string): RevisionBucket => {
    let revisions = paths.get(path);
    if (revisions === undefined) {
      revisions = new Map();
      paths.set(path, revisions);
    }
    let revision = revisions.get(digest);
    if (revision === undefined) {
      revision = {
        digest,
        enumeratedPages: null,
        enumeratedAt: null,
        enumerations: [],
        retiredAt: null,
        units: new Map(),
        history: [],
      };
      revisions.set(digest, revision);
    }
    return revision;
  };

  const manifestOf = (path: VaultPath): UnitManifest | undefined => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached ?? undefined;
    const revisions = paths.get(path);
    const live = revisions === undefined ? null : liveRevision(revisions);
    const manifest =
      live === null || revisions === undefined
        ? null
        : manifestOfRevision(path, live, markThreshold(live, revisions));
    cache.set(path, manifest);
    return manifest ?? undefined;
  };

  const outcomeRevisionPagesOf = (path: VaultPath): OutcomeRevisionPages | undefined => {
    const revisions = paths.get(path);
    if (revisions === undefined) return undefined;
    const live = liveRevision(revisions);
    if (live === null) return undefined;
    const threshold = markThreshold(live, revisions);
    return {
      sourcePath: path,
      revisionDigest: live.digest,
      expectedPages: [...(live.enumeratedPages ?? [])].sort((a, b) => a - b),
      history: outcomeHistoryOf(live, threshold),
      knownRevisions: [...revisions.values()]
        .filter((revision) => revision.enumeratedAt !== null)
        .map((revision) => revision.digest)
        .sort(),
    };
  };

  return {
    add(record) {
      if (record.clock > highestClock) highestClock = record.clock;
      const revision = bucketOf(record.sourcePath, record.revisionDigest);
      const stamp: Stamp = { clock: record.clock, deviceId: record.deviceId };
      switch (record.kind) {
        case 'enumerated': {
          // Two enumerations of one revision list its pages as each device saw them; a page either
          // saw is a page the source has, so the union, never the intersection.
          revision.enumeratedPages ??= new Set();
          for (const page of record.pages) revision.enumeratedPages.add(page);
          if (revision.enumeratedAt === null || compareStamps(stamp, revision.enumeratedAt) > 0) {
            revision.enumeratedAt = stamp;
          }
          revision.enumerations.push(stamp);
          break;
        }
        case 'retired': {
          if (revision.retiredAt === null || compareStamps(stamp, revision.retiredAt) > 0) {
            revision.retiredAt = stamp;
          }
          break;
        }
        case 'unit': {
          const incumbent = revision.units.get(record.page);
          if (incumbent === undefined || beats(record, incumbent)) {
            revision.units.set(record.page, record);
          }
          revision.history.push(record);
          break;
        }
      }
      cache.delete(record.sourcePath);
    },
    manifestOf,
    outcomeRevisionPagesOf,
    maxClock: () => highestClock,
    project() {
      const manifests = new Map<VaultPath, UnitManifest>();
      for (const path of [...paths.keys()].sort()) {
        const manifest = manifestOf(path);
        if (manifest !== undefined) manifests.set(path, manifest);
      }
      return { manifests, maxClock: highestClock };
    },
  };
}

/** Folds `records`, in any order, into the projection. The same records always give the same projection. */
export function foldUnitManifests(records: readonly UnitManifestRecord[]): UnitManifestProjection {
  const fold = createUnitManifestFold();
  for (const record of records) fold.add(record);
  return fold.project();
}
