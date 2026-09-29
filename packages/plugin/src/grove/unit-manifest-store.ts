/**
 * `createVaultUnitManifestStore` — the durable unit manifest (`[D-445]`, ruled 2026-09-29 as row 26
 * of the decision sheet; `[D-294]`/`[D-326]` fix what it holds; `ol-egov.141.89.8.43`). It gives the
 * grove census the per-source `UnitManifest` its `unitManifests` thunk (`./provider.ts`,
 * `ol-egov.141.89.8.42`) had no supplier for.
 *
 * **Where it lives and what it is.** Olea's own layer in her vault, `.olea/unit-manifests/`, one file
 * per day per device, append-only (`olea-core`'s `unit-manifest/log.ts`). Never her authored notes
 * (INV-6), never the Worker (the boundary document, section 1): a manifest says what this install
 * has read of her material, and the Worker sees only the transient page it is asked to read. The
 * projection in memory is a disposable fold of those files; deleting the folder loses nothing the
 * fold cannot say is unknown.
 *
 * **What the ruling asks, and where it lands here.**
 *
 *  - *Append-only per-device records, separate reading and extraction states, explicit revision
 *    retirement:* the record kinds and the fold are core's (`records.ts`, `projection.ts`); this
 *    module appends them, one Lamport-stamped record at a time, through one serial queue.
 *  - *Unread or pending units stay unknown, never absent:* {@link UnitManifestStore.manifestsFor} is
 *    the reader boundary and never leaves a supported source out. A source with no live manifest is
 *    handed the unknown manifest (`unknownUnitManifest`: one pending unit), and a page the
 *    enumeration named but nothing has read reads pending.
 *  - *Rebuilding after deletion never shows false completeness:* a reader never gets the text-layer
 *    verdict in place of a manifest. Before `load()` has finished, or when the files could not be
 *    read, every source reads unknown. After the folder is deleted, the first read of each source
 *    rebuilds it by enumeration before answering: the text layer settles the pages it actually
 *    served, and every page routed to vision waits pending for its reading again. Nothing about a
 *    vision reading or a finished concept extraction is invented on the way back, so a source whose
 *    image pages had been read reads unfinished again until they are.
 *
 * **Who writes.**
 *  - *Enumeration* — `manifestsFor` does it, before answering, for a source it has no verified
 *    manifest for. It reads the bytes once, hashes them (the revision digest, the same hash a queue
 *    job is keyed by), and if the live revision already has that digest writes nothing. Otherwise it
 *    runs the same extractor with the same routing options the ingestion queue used and appends, in
 *    one write, a retirement of the older revision if there was one, an enumeration record naming
 *    every page, and a state record for each page the text layer settled. A source the pass cannot
 *    enumerate (unparseable bytes) is remembered as such for the session and left out of the answer,
 *    so the census's own verdict on it stands. This is the cost the census already paid on every
 *    load (it re-extracted each source), paid once per source per session and, past that, once per
 *    change.
 *  - *Vision readings* — `recordReading`, the sink for `vision-page-runner.ts`'s `onManifestEntry`.
 *    A reading of a source with no live revision enumerates it first, so a reading can never make a
 *    manifest that names one page and reads as complete by omission.
 *  - *Concept extraction* — `recordConceptExtraction`, called with the sources a concept read pass
 *    consumed in full. It marks only units the text layer read: that pass reads the text layer, never
 *    a vision reading, so it says nothing about a page read from an image.
 *  - *A reading that changes* resets that unit's extraction state to `not-started`: extraction ran
 *    over the earlier reading, not this one. The two fields are still never derived from each other;
 *    this only stops a stale "extracted" surviving a different reading.
 *
 * **Revisions.** The digest names the bytes a record speaks for, and a live manifest is trusted only
 * once this session has re-hashed its source (a file can change while Obsidian is closed, and a
 * vault sync can carry another device's edit in). A vault `modify` event withdraws that trust: the
 * path reads unknown until the next read re-hashes it. The same bytes write nothing; different bytes
 * append a retirement and an enumeration. A `delete` or `rename` appends a retirement for the
 * removed path (`source-removed`); the new path is simply unrecorded and is enumerated afresh (her
 * vault sync carries no rename, so nothing is guessed across one).
 *
 * **Merge.** Two devices never write one file. The clock is a Lamport counter: a writer stamps
 * `max(clock seen) + 1`, and `load()` folds every device's files. New records from another device
 * reach this projection at the next `load()`; a dot-prefixed folder raises no vault event, so nothing
 * here pretends to be told.
 *
 * **D-005.** Counts, paths, page numbers and states only; nothing here logs a path's content, a
 * coverage note or a digest of her words.
 */

import {
  type CalendarDay,
  calendarDayFromLocalDate,
  EXTRACTORS,
  type ExtractionResult,
  type ExtractOptions,
  formatFromExtension,
  hashContent,
  markConceptExtractionComplete,
  type SourceFormat,
  stableUnitId,
  type UnitManifest,
  type UnitManifestEntry,
  type UnitReadingState,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { enumerationOfExtraction } from '../../../core/src/ingestion/unit-manifest/enumerate.js';
import {
  appendUnitManifestRecords,
  readUnitManifestLog,
  UNIT_MANIFEST_FOLDER,
  unitManifestLogPath,
} from '../../../core/src/ingestion/unit-manifest/log.js';
import {
  createUnitManifestFold,
  nextUnitManifestClock,
  type UnitManifestFold,
  unknownUnitManifest,
} from '../../../core/src/ingestion/unit-manifest/projection.js';
import {
  type RevisionRetirementReason,
  sameUnitReadingState,
  UNIT_MANIFEST_RECORD_VERSION,
  type UnitManifestRecord,
} from '../../../core/src/ingestion/unit-manifest/records.js';
import { DEFAULT_LOG_PROBE_DAYS, discoverLogPaths } from '../privacy/log-discovery.js';
import { isoWithLocalOffset } from '../review/ports.js';

/** How long a burst of writes waits before subscribers are told, so a deck of readings refreshes a view once, not once per page. */
export const UNIT_MANIFEST_NOTIFY_DELAY_MS = 750;

export interface UnitManifestStoreDeps {
  readonly vault: VaultSource;
  /** Names this device's own files, for discovery by exact path on a host that lists nothing under a dot folder. */
  readonly deviceId: string;
  /** Injected so the store is deterministic under test; production passes `this.now`. */
  readonly now: () => Date;
  /** How many days back this device's own files are probed by exact path. Defaults to `DEFAULT_LOG_PROBE_DAYS`. */
  readonly probeDays?: number;
  /**
   * The routing options the ingestion queue extracts with (the delivered vision-route threshold),
   * read afresh at each enumeration so a page routes here exactly as it routed there. `undefined`
   * leaves the extractors' own declared default.
   */
  readonly extractOptions?: () => ExtractOptions | undefined;
  /** Runs one extractor over bytes already read. Injected for tests; production uses the real registry. */
  readonly extractSource?: (input: {
    readonly path: VaultPath;
    readonly bytes: Uint8Array;
    readonly format: SourceFormat;
    readonly options: ExtractOptions | undefined;
  }) => Promise<ExtractionResult>;
  /** The revision digest of some bytes. Injected for tests; production uses `hashContent`. */
  readonly digestOf?: (bytes: Uint8Array) => Promise<string>;
  /** Timer seam for the notification delay. Defaults to `setTimeout`. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** The durable unit manifest, as `main.ts` composes it. */
export interface UnitManifestStore {
  /**
   * Folds every device's files into the projection. Idempotent, and safe to repeat after a sync:
   * it rebuilds the fold from disk and keeps this session's clock ahead of anything it read. A
   * failure to read rejects and leaves the store unloaded, which reads every source as unknown,
   * never as empty.
   */
  load(): Promise<void>;
  /** True once a `load()` has finished. Until then every source reads unknown. */
  isLoaded(): boolean;
  /** The live manifests as the fold holds them: enumerated, unretired revisions only. A path with none is unknown, not here. */
  manifests(): ReadonlyMap<VaultPath, UnitManifest>;
  /**
   * The reader boundary: for each path a supported source, its live manifest or the unknown one,
   * never left out. A source not yet verified this session is enumerated before the answer (module
   * doc), so the unknown manifest is what a reader gets only when the store is not loaded or the
   * records could not be written. Paths no extractor claims are not manifest-able and are omitted,
   * as is a source this session found it cannot enumerate (the census keeps its own verdict on it).
   */
  manifestsFor(paths: readonly VaultPath[]): Promise<ReadonlyMap<VaultPath, UnitManifest>>;
  /** The sink for `vision-page-runner.ts`'s `onManifestEntry`: fire and forget, serialised, best effort. */
  recordReading(entry: UnitManifestEntry): void;
  /** Marks the text-layer units of these sources extracted, for sources a concept read pass consumed in full. */
  recordConceptExtraction(paths: readonly VaultPath[]): Promise<void>;
  /** Feeds one vault event: a modify withdraws trust in the path until it is re-hashed; a delete or rename retires it. */
  observe(event: VaultEvent): void;
  /** Called after records land from a writer (a reading, an extraction pass, a retirement), debounced. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Resolves when every queued write has finished and any pending notification has been sent. For tests and shutdown. */
  idle(): Promise<void>;
}

function sameReading(a: UnitReadingState | undefined, b: UnitReadingState): boolean {
  return a !== undefined && sameUnitReadingState(a, b);
}

export function createVaultUnitManifestStore(deps: UnitManifestStoreDeps): UnitManifestStore {
  const digestOf = deps.digestOf ?? hashContent;
  const extract =
    deps.extractSource ??
    (({ path, bytes, format, options }) => EXTRACTORS[format].extract({ path, bytes }, options));
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let fold: UnitManifestFold = createUnitManifestFold();
  let loaded = false;
  let clock = 0;
  /** Paths whose live manifest this session has checked against the file's current bytes. Only these are trusted. */
  const verified = new Set<VaultPath>();
  /** Paths the last enumeration could not enumerate, until the file changes: the census keeps its own verdict. */
  const unenumerable = new Set<VaultPath>();
  let loadPromise: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let notifyHandle: unknown = null;
  let chain: Promise<void> = Promise.resolve();

  const run = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const notifyNow = (): void => {
    if (notifyHandle !== null) {
      clearTimer(notifyHandle);
      notifyHandle = null;
    }
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A subscriber that throws must not stop the others or the store.
      }
    }
  };

  const notifyLater = (): void => {
    if (notifyHandle !== null) return;
    notifyHandle = setTimer(() => {
      notifyHandle = null;
      notifyNow();
    }, UNIT_MANIFEST_NOTIFY_DELAY_MS);
  };

  const stamp = (): { clock: number; at: string } => {
    clock = nextUnitManifestClock(Math.max(clock, fold.maxClock()));
    return { clock, at: isoWithLocalOffset(deps.now()) };
  };

  /** Appends to disk first, folds only what reached disk: a failed write leaves the projection saying what the files say. */
  const append = async (records: readonly UnitManifestRecord[]): Promise<void> => {
    if (records.length === 0) return;
    await appendUnitManifestRecords(deps.vault, records);
    for (const record of records) fold.add(record);
  };

  const retirement = (
    sourcePath: VaultPath,
    revisionDigest: string,
    reason: RevisionRetirementReason,
  ): UnitManifestRecord => ({
    v: UNIT_MANIFEST_RECORD_VERSION,
    kind: 'retired',
    deviceId: deps.deviceId,
    ...stamp(),
    sourcePath,
    revisionDigest,
    reason,
  });

  /**
   * Makes `path` have a live manifest for its current bytes. Returns whether records were written.
   * Re-hashing is what "verify" means here: bytes equal to the live revision's write nothing.
   */
  const ensureEnumerated = async (path: VaultPath): Promise<boolean> => {
    const format = formatFromExtension(path);
    if (format === null) return false;

    let bytes: Uint8Array;
    try {
      bytes = await deps.vault.readBinary(path);
    } catch {
      // Gone, or unreadable now: nothing true to record, and nothing to call read.
      unenumerable.add(path);
      verified.delete(path);
      return false;
    }
    const digest = await digestOf(bytes);
    const live = fold.manifestOf(path);
    if (live !== undefined && live.revisionDigest === digest) {
      verified.add(path);
      return false;
    }

    let enumeration: ReturnType<typeof enumerationOfExtraction> = null;
    try {
      enumeration = enumerationOfExtraction(
        await extract({ path, bytes, format, options: deps.extractOptions?.() }),
      );
    } catch {
      enumeration = null;
    }

    const records: UnitManifestRecord[] = [];
    if (live !== undefined) records.push(retirement(path, live.revisionDigest, 'superseded'));
    if (enumeration === null) {
      // The pass could not enumerate these bytes. The old revision, if any, no longer describes the
      // file, so it is retired; nothing new is claimed.
      await append(records);
      unenumerable.add(path);
      verified.delete(path);
      return records.length > 0;
    }
    records.push({
      v: UNIT_MANIFEST_RECORD_VERSION,
      kind: 'enumerated',
      deviceId: deps.deviceId,
      ...stamp(),
      sourcePath: path,
      revisionDigest: digest,
      pages: enumeration.pages,
    });
    for (const settled of enumeration.settled) {
      records.push({
        v: UNIT_MANIFEST_RECORD_VERSION,
        kind: 'unit',
        deviceId: deps.deviceId,
        ...stamp(),
        sourcePath: path,
        revisionDigest: digest,
        unitId: stableUnitId(path, settled.page),
        page: settled.page,
        readingState: settled.readingState,
        conceptExtractionState: 'not-started',
      });
    }
    await append(records);
    unenumerable.delete(path);
    verified.add(path);
    return true;
  };

  const applyReading = async (entry: UnitManifestEntry): Promise<void> => {
    const path = entry.sourcePath;
    if (unenumerable.has(path)) return;
    let live = fold.manifestOf(path);
    if (live === undefined || !verified.has(path)) {
      await ensureEnumerated(path);
      live = fold.manifestOf(path);
    }
    // A reading with no live revision to sit in is not recorded: a manifest that named only this
    // page would read as complete by omission. The source stays unknown and is enumerated later.
    if (live === undefined) return;
    const current = live.entries.find((unit) => unit.page === entry.page);
    // Extraction ran over the earlier reading, not a different one.
    const conceptExtractionState = sameReading(current?.readingState, entry.readingState)
      ? (current?.conceptExtractionState ?? 'not-started')
      : 'not-started';
    await append([
      {
        v: UNIT_MANIFEST_RECORD_VERSION,
        kind: 'unit',
        deviceId: deps.deviceId,
        ...stamp(),
        sourcePath: path,
        revisionDigest: live.revisionDigest,
        unitId: stableUnitId(path, entry.page),
        page: entry.page,
        readingState: entry.readingState,
        conceptExtractionState,
      },
    ]);
    notifyLater();
  };

  const applyConceptExtraction = async (paths: readonly VaultPath[]): Promise<void> => {
    const records: UnitManifestRecord[] = [];
    for (const path of paths) {
      if (unenumerable.has(path)) continue;
      if (!verified.has(path)) await ensureEnumerated(path);
      const live = fold.manifestOf(path);
      if (live === undefined || !verified.has(path)) continue;
      for (const entry of live.entries) {
        const state = entry.readingState;
        // The concept read pass reads the text layer. It says nothing about a page read from an image.
        if (state.kind !== 'read' || state.method !== 'text-layer') continue;
        if (entry.conceptExtractionState === 'complete') continue;
        const marked = markConceptExtractionComplete(entry);
        records.push({
          v: UNIT_MANIFEST_RECORD_VERSION,
          kind: 'unit',
          deviceId: deps.deviceId,
          ...stamp(),
          sourcePath: path,
          revisionDigest: live.revisionDigest,
          unitId: marked.unitId,
          page: marked.page,
          readingState: marked.readingState,
          conceptExtractionState: marked.conceptExtractionState,
        });
      }
    }
    if (records.length === 0) return;
    await append(records);
    notifyLater();
  };

  const retireRemoved = async (path: VaultPath): Promise<void> => {
    const live = fold.manifestOf(path);
    verified.delete(path);
    unenumerable.delete(path);
    if (live === undefined) return;
    await append([retirement(path, live.revisionDigest, 'source-removed')]);
    notifyLater();
  };

  const today = (): CalendarDay => calendarDayFromLocalDate(deps.now());

  return {
    load() {
      const done = (async () => {
        await run(async () => {
          const paths = await discoverLogPaths(
            deps.vault,
            UNIT_MANIFEST_FOLDER,
            unitManifestLogPath,
            deps.deviceId,
            today(),
            deps.probeDays ?? DEFAULT_LOG_PROBE_DAYS,
          );
          const { records } = await readUnitManifestLog(deps.vault, paths);
          const rebuilt = createUnitManifestFold();
          for (const record of records) rebuilt.add(record);
          fold = rebuilt;
          clock = Math.max(clock, fold.maxClock());
          loaded = true;
          // What was verified was verified against the fold this replaced.
          verified.clear();
        });
        notifyLater();
      })();
      loadPromise = done;
      return done;
    },

    isLoaded: () => loaded,

    manifests: () => fold.project().manifests,

    async manifestsFor(paths) {
      if (!loaded && loadPromise !== null) {
        try {
          await loadPromise;
        } catch {
          // The files could not be read: unknown, below, never empty.
        }
      }
      const out = new Map<VaultPath, UnitManifest>();
      for (const path of paths) {
        if (formatFromExtension(path) === null) continue;
        if (!loaded) {
          out.set(path, unknownUnitManifest(path));
          continue;
        }
        if (unenumerable.has(path)) continue;
        if (!verified.has(path)) {
          try {
            await run(() => ensureEnumerated(path));
          } catch (error) {
            console.error('Olea: could not enumerate a source for the unit manifest', error);
          }
        }
        if (unenumerable.has(path)) continue;
        const live = verified.has(path) ? fold.manifestOf(path) : undefined;
        out.set(path, live ?? unknownUnitManifest(path));
      }
      return out;
    },

    recordReading(entry) {
      void run(async () => {
        try {
          await applyReading(entry);
        } catch (error) {
          console.error('Olea: could not record a reading in the unit manifest', error);
        }
      });
    },

    recordConceptExtraction(paths) {
      return run(async () => {
        try {
          await applyConceptExtraction(paths);
        } catch (error) {
          console.error('Olea: could not record concept extraction in the unit manifest', error);
        }
      });
    },

    observe(event) {
      switch (event.kind) {
        case 'modify': {
          unenumerable.delete(event.path);
          if (verified.delete(event.path)) notifyLater();
          return;
        }
        case 'create': {
          unenumerable.delete(event.path);
          return;
        }
        case 'delete': {
          void run(() => retireRemoved(event.path)).catch((error) => {
            console.error('Olea: could not retire a removed source in the unit manifest', error);
          });
          return;
        }
        case 'rename': {
          unenumerable.delete(event.path);
          if (event.oldPath !== undefined) {
            const oldPath = event.oldPath;
            void run(() => retireRemoved(oldPath)).catch((error) => {
              console.error('Olea: could not retire a renamed source in the unit manifest', error);
            });
          }
          return;
        }
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async idle() {
      let previous: Promise<void>;
      do {
        previous = chain;
        await previous;
      } while (previous !== chain);
      if (notifyHandle !== null) notifyNow();
    },
  };
}
