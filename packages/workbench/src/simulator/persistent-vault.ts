/**
 * `PersistentVaultSource` — the lived-term half of the simulator
 * (`docs/dev/simulator-design.md` §3).
 *
 * Wraps a `MemoryVaultSource` (the fetched fixture snapshot — the base layer,
 * never mutated except through this wrapper) with a `SimulatorStore` overlay.
 * Every write and delete lands in the store FIRST (so a crash between the two
 * never leaves the in-memory vault ahead of what a reload would restore),
 * then in the base — exactly `docs/dev/simulator-design.md` §3's own
 * ordering ("`write` and `delete` go to the overlay first, then memory").
 *
 * At construction, every persisted overlay entry is replayed onto the base —
 * "startup applies the overlay over the base" — so after `create()` resolves,
 * the base `MemoryVaultSource` IS the up-to-date vault and every read
 * (`list`, `read`, `readBinary`, `exists`, `watch`) is plain delegation to it,
 * modulo the term scrubber's visibility cutoff below.
 *
 * **What lands in the overlay.** The plugin's own event files — the
 * per-device review log, suspend records, explain-back offers, contests,
 * scope, retrospective offers, misconceptions — are all written through
 * `VaultSource.write`/`delete`, so every one of them lands in the overlay
 * untouched: this wrapper never inspects a path to decide what to persist.
 *
 * **The term scrubber's visibility cutoff (`ol-3ux7.64.16` [WBX-13],
 * design doc §4b).** Scrubbing the clock backward "cannot un-write her
 * events" — the overlay above already holds every review-log record written
 * this session, and moving the scrubber back must not delete or rewrite any
 * of it. Instead, {@link setVisibilityCutoff} records a day (`YYYY-MM-DD`,
 * `SimulatorController`'s own current day, kept in step with the clock on
 * every advance/scrub/reset), and every read (`list`, `exists`, `read`,
 * `readBinary`) treats a review-log file dated AFTER that day as though it
 * does not exist — `exists` reports `false`, `read`/`readBinary` reject
 * exactly as they would for a path nobody ever wrote, and `list` omits it.
 * Moving the cutoff forward past that day makes the same file visible again,
 * with no re-write of any kind: the hiding is purely a read-time filter over
 * bytes that were never touched. **Only `.olea/reviews/` files are ever
 * hidden this way** — the cutoff never touches course material or any other
 * vault path, matching the design doc's "her material is frozen in both
 * directions" and this bead's own "material stays at its snapshot state."
 * `null` (the default, and what a fresh `create()`/`reset()` leaves it at
 * before `SimulatorController` first calls {@link setVisibilityCutoff}) means
 * no filtering at all.
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import { REVIEW_LOG_FOLDER } from 'olea-core';
import type { MemoryVaultSource } from '../vault/memory-source.js';
import type { SimulatorStore } from './store.js';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false });
const encoder = new TextEncoder();

/** Matches the C5.2 file name (`packages/core/src/review-log/path.ts`'s `reviewLogPath`) under `REVIEW_LOG_FOLDER`, whoever wrote it — mirrors `packages/plugin/src/today/data-source.ts`'s own `LOG_FILE_RE`, scoped here to a full vault path rather than a basename since this wrapper sees every path, not just ones already filtered to the folder. */
const REVIEW_LOG_PATH_RE = new RegExp(
  `^${REVIEW_LOG_FOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d{4}-\\d{2}-\\d{2})\\.[^/]+\\.jsonl$`,
);

/** The calendar day (`YYYY-MM-DD`) a review-log path is dated for, or `null` for any other vault path — including a malformed or differently-shaped file that happens to sit under `REVIEW_LOG_FOLDER`. */
function reviewLogDayOf(path: VaultPath): string | null {
  return REVIEW_LOG_PATH_RE.exec(path)?.[1] ?? null;
}

export class PersistentVaultSource implements VaultSource {
  /** See this file's own module doc. `null` = nothing hidden. */
  private visibilityCutoffDay: string | null = null;

  private constructor(
    private readonly base: MemoryVaultSource,
    private readonly store: SimulatorStore,
  ) {}

  /**
   * Loads the store's overlay and replays it onto `base` before returning —
   * a `PersistentVaultSource` is never handed back mid-restore.
   */
  static async create(
    base: MemoryVaultSource,
    store: SimulatorStore,
  ): Promise<PersistentVaultSource> {
    const overlay = await store.loadOverlay();
    for (const [path, value] of overlay) {
      if ('tombstoned' in value) {
        await base.delete(path);
      } else {
        await base.write(path, decoder.decode(value.bytes));
      }
    }
    return new PersistentVaultSource(base, store);
  }

  /**
   * Sets the term scrubber's visibility cutoff — see this file's own module
   * doc. Called by `SimulatorController` every time the simulated clock
   * moves (advance, scrub, reset), never by anything inside this class.
   */
  setVisibilityCutoff(day: string | null): void {
    this.visibilityCutoffDay = day;
  }

  /** True for a review-log path dated strictly after the current cutoff — the one thing every read method below hides. */
  private isHiddenByCutoff(path: VaultPath): boolean {
    if (this.visibilityCutoffDay === null) return false;
    const day = reviewLogDayOf(path);
    return day !== null && day > this.visibilityCutoffDay;
  }

  list(options?: ListOptions): Promise<readonly VaultPath[]> {
    return this.base
      .list(options)
      .then((paths) => paths.filter((path) => !this.isHiddenByCutoff(path)));
  }

  read(path: VaultPath): Promise<string> {
    if (this.isHiddenByCutoff(path)) {
      return Promise.reject(
        new Error(`PersistentVaultSource: no such file (hidden by the term scrubber): ${path}`),
      );
    }
    return this.base.read(path);
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    if (this.isHiddenByCutoff(path)) {
      return Promise.reject(
        new Error(`PersistentVaultSource: no such file (hidden by the term scrubber): ${path}`),
      );
    }
    return this.base.readBinary(path);
  }

  async write(path: VaultPath, content: string): Promise<void> {
    await this.store.putOverlay(path, { bytes: encoder.encode(content) });
    await this.base.write(path, content);
  }

  exists(path: VaultPath): Promise<boolean> {
    if (this.isHiddenByCutoff(path)) return Promise.resolve(false);
    return this.base.exists(path);
  }

  async delete(path: VaultPath): Promise<void> {
    await this.store.putOverlay(path, { tombstoned: true });
    await this.base.delete(path);
  }

  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    return this.base.watch(handler);
  }
}
