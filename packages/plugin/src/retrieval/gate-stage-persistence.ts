/**
 * `GateStagePersistence` — the write-scheduling half of `[JEV-11]`'s
 * (`ol-3ux7.96`) persisted gate-stage counts, split out of `main.ts` so it
 * can be tested without an Obsidian host (`main.ts` imports `obsidian`
 * directly and has no runtime under Vitest — same reasoning
 * `diagnostics-clipboard.ts`'s own module doc gives for splitting the
 * Obsidian-touching glue from the logic worth unit-testing).
 *
 * **The exposure this exists to close.** `ObsidianGateStageStore.save` is a
 * read-modify-write against the WHOLE shared `data.json` blob — every store
 * in this plugin that uses the `ObsidianDataHost` pattern
 * (`../grove/ground-streak-store.ts`, `../plan/settings-store.ts`,
 * `../registry/overrides-store.ts`, and others) does the same thing. Two
 * overlapping saves against that one file race on the read: each reads the
 * current blob, changes only its own top-level key, and writes the WHOLE
 * blob back — so the later write silently discards whatever the earlier one
 * had just added under a *different* key, invisibly, because nothing
 * throws. A generation sweep (`../generation/pipeline.js`'s
 * `runGenerationSweep`) attributes many stages in quick succession, so
 * without this module, `main.ts` firing one unawaited
 * `gateStageStore.save()` per attribution would race against itself, and
 * against anything else `data.json`-backed the plugin writes in that same
 * window.
 *
 * **Two mechanisms, for two different reasons:**
 *
 * 1. **Serialization** (`chain`) — every actual write is chained onto the
 *    promise the previous write produced, so a write in flight is always
 *    settled before the next one starts reading. `.catch(() => undefined)`
 *    at the head of each link means a rejected write can never break the
 *    chain for writes queued after it: the next link still runs once its
 *    turn arrives, because it is chained onto the result of the `catch`,
 *    never onto the original (possibly rejected) promise.
 * 2. **Coalescing** (`schedule`'s debounce timer) — collapses a burst of
 *    `schedule()` calls into ONE write, safe here specifically because
 *    every write persists the CURRENT running total, never a delta: any
 *    number of `schedule()` calls collapsed into the write that eventually
 *    fires produces the identical persisted result a write-per-call would
 *    have, just written once. `flush()` cancels a pending timer and writes
 *    immediately — `main.ts`'s `onunload` calls it so a session's tail
 *    inside the debounce window is not lost to a reload.
 *
 * **Fails open, always.** A rejected write (or one that never resolves in
 * time — there is no timeout here; `deps.save` is expected to be the same
 * fail-closed `ObsidianGateStageStore.save`, which never rejects on a
 * malformed disk read, only on a genuine I/O failure) is reported through
 * `deps.onError` and the chain otherwise continues; nothing here can throw
 * into `schedule()`'s or `flush()`'s caller, and neither method is ever
 * awaited by `main.ts` — the gate's own decision and card drafting proceed
 * regardless of whether or when a write lands.
 */

export interface GateStagePersistenceDeps<TCounts> {
  /** Returns the wall-clock time to stamp a write with — injected so tests control it exactly. */
  now(): string;
  /** Reads the CURRENT running total at write time, not at schedule time — a write always reflects everything recorded up to the moment it actually runs. */
  getCounts(): TCounts;
  save(counts: TCounts, now: string): Promise<void>;
  /** Called after a write succeeds, with the `now` it was stamped with. */
  onSaved?(now: string): void;
  /** Called after a write throws or rejects. Never re-thrown. */
  onError?(error: unknown): void;
  /** Milliseconds of quiet-period coalescing. Defaults to 2000 — see this module's doc and `main.ts`'s own constant for the argument. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 2_000;

export class GateStagePersistence<TCounts> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: GateStagePersistenceDeps<TCounts>) {}

  /** Arms a debounce timer if none is already armed; a call while one is armed coalesces into it — see module doc. */
  schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.enqueue();
    }, this.deps.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  /** Cancels any pending debounce timer and writes immediately — for a session's tail at unload. Still goes through the same serialization chain as `schedule()`. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.enqueue();
  }

  /** Whether a debounce timer is currently armed — exposed for tests, not meant for production call sites to branch on. */
  isScheduled(): boolean {
    return this.timer !== null;
  }

  private enqueue(): void {
    this.chain = this.chain.catch(() => undefined).then(() => this.writeNow());
  }

  private async writeNow(): Promise<void> {
    try {
      const now = this.deps.now();
      const counts = this.deps.getCounts();
      await this.deps.save(counts, now);
      this.deps.onSaved?.(now);
    } catch (error) {
      this.deps.onError?.(error);
    }
  }
}
