/**
 * `buildIngestionArrivalWatch` — the vault-watch-to-`IngestionQueueEngine
 * .enqueue` glue for the multi-format ingestion path (`ol-2zfj.38`,
 * discovered from `ol-84my`'s own close reason: the debounce and the queue
 * engine both existed, and nothing in production ever called
 * `IngestionQueueEngine.enqueue()` for a file newly arriving in the vault —
 * the only production `enqueue` call before this file, `main.ts`'s
 * `tickCitationRevisions`, admits an already-drafted instrument's successor
 * into the SAME queue (`[CORP-3b]`), never a fresh PDF/PPTX/DOCX/image. So
 * the whole extraction/generation path this queue feeds was built and
 * unreached from a real vault edit, exactly as `ol-84my`'s close reason and
 * `ol-84my`'s own adopter note named.
 *
 * **Composition, same shape as `keyword-index/wiring.ts` and
 * `ingestion/materiality/wiring.ts` one directory over.** No `obsidian`
 * import (INV-1) — `deps.watch` is production's `vault.watch` (`main.ts`
 * supplies it, the same seam the keyword index subscribes through), a fake
 * in tests. `deps.enqueuer` is structurally anything with an `enqueue`
 * method — `IngestionQueueEngine` itself, satisfied without importing its
 * class — so this module never needs to know how the engine was built, only
 * that `main.ts` builds one (`buildIngestionRunner`) before wiring this.
 *
 * **Which files, and why the extension-driven answer rather than a second,
 * hand-maintained list.** `formatFromExtension` (`extract/registry.ts`) is
 * the one place C3.1 names as owning "which extension maps to which
 * `SourceFormat`" — pdf/pptx/docx/image, the same four
 * `extraction-runner.ts`'s own `KNOWN_FORMATS` set (private to that module)
 * gates on. Reusing the function rather than re-declaring the set here means
 * a fifth format added to the registry is picked up by this watch with no
 * second edit — the same "one decision, one place" argument `registry.ts`'s
 * own module doc makes for every other caller.
 *
 * **`'create'`/`'modify'` only** — matching the materiality trigger's own
 * `'modify'`-only filter one directory over for the identical reason: a
 * `'delete'`/`'rename'` names no new content to extract, and a `'create'` is
 * the one event kind a markdown-only watch (materiality) never needed to
 * handle but a binary-file watch does, since a dropped-in PDF fires
 * `'create'`, never `'modify'`, the first time it lands.
 *
 * **The ENQUEUE debounce (`ol-84my`), threaded end to end.** `main.ts`
 * constructs the engine with `enqueueDebounce: DEFAULT_ENQUEUE_DEBOUNCE_POLICY`
 * (`buildIngestionRunner`'s own doc); this module is the other half — it
 * must supply `EnqueueInput.lastChangedAt` on every call or that policy is
 * inert (`EngineDeps.enqueueDebounce`'s own doc: "both sides must opt in").
 * `lastChangedAt` is "the last time THIS PATH was observed changing", not
 * "the last time its bytes actually differed" — tracked in a tiny in-memory,
 * per-path map (`createInMemoryLastChangedTracker` below), the same
 * session-scoped shape `PreviousTextTracker` uses one directory over
 * (`materiality/previous-text.ts`) for the identical reason: nothing here
 * needs to survive a plugin reload, and a fresh session treating every path
 * as a first sighting is always safe — `evaluateEnqueueDebounce`'s own
 * contract settles a `null`/never-seen `lastChangedAt` immediately, never
 * debounces it. Recorded on every observed event, whatever the outcome
 * (queued, duplicate, or debounced) — the same "reset on any observation"
 * rule `MaterialityTrigger.evaluate` uses for its own quiet-window fields,
 * so a continuous burst of saves during a large file's arrival keeps
 * resetting the quiet clock rather than measuring from the first byte
 * written.
 *
 * **What this does not attempt.** A debounced call is never retried by a
 * timer this module owns — `EnqueueResult`'s own doc names the caller's
 * obligation as "typically by re-evaluating on the next vault event for the
 * same path," and that is exactly this module's posture: it reacts to real
 * vault events only, the same as the materiality trigger and the keyword
 * index both already do, and invents no polling loop neither of those needed
 * either.
 *
 * **Never lets a read/hash/enqueue failure propagate** — same "a downstream
 * failure must never make the watch look like it misfired" posture every
 * other `vault.watch` handler in `main.ts` already takes.
 */

import {
  type Clock,
  formatFromExtension,
  hashContent,
  type JobEnqueuer,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';

/**
 * Session-scoped "when did I last observe this path change" cache — same
 * shape `PreviousTextTracker` uses one directory over
 * (`materiality/previous-text.ts`), for the identical reason: see this
 * module's own doc.
 */
export interface LastChangedTracker {
  /** The instant last recorded for `path` in this session, or `null` on first sighting. */
  get(path: string): number | null;
  /** Records `at` as what `get(path)` returns for the next observation. */
  record(path: string, at: number): void;
}

export function createInMemoryLastChangedTracker(): LastChangedTracker {
  const seen = new Map<string, number>();
  return {
    get: (path) => seen.get(path) ?? null,
    record: (path, at) => {
      seen.set(path, at);
    },
  };
}

export interface IngestionArrivalWatchDeps {
  readonly vault: VaultSource;
  /** `IngestionQueueEngine` satisfies this structurally — see the module doc. */
  readonly enqueuer: JobEnqueuer;
  /** Defaults to the real wall clock. Override in tests. */
  readonly clock?: Clock;
  /** Defaults to a fresh in-memory tracker. Inject in tests for determinism/inspection. */
  readonly tracker?: LastChangedTracker;
  /**
   * Subscribes to vault change events. Production hands in `(handler) =>
   * vault.watch(handler)` — the same seam `keyword-index/wiring.ts` uses;
   * defaults to exactly that when omitted, so a caller that already has
   * `deps.vault` need not repeat it. Tests supply a fake that fires
   * synthetic events on demand.
   */
  readonly watch?: (handler: (event: VaultEvent) => void) => Unsubscribe;
}

async function enqueueArrival(
  path: VaultPath,
  format: NonNullable<ReturnType<typeof formatFromExtension>>,
  vault: VaultSource,
  enqueuer: JobEnqueuer,
  clock: Clock,
  tracker: LastChangedTracker,
): Promise<void> {
  const lastChangedAt = tracker.get(path);
  try {
    const bytes = await vault.readBinary(path);
    const contentHash = await hashContent(bytes);
    await enqueuer.enqueue({
      contentHash,
      label: path,
      payload: { kind: 'source', sourcePath: path, format },
      lastChangedAt,
    });
  } catch (error) {
    console.error('Olea: could not enqueue an arriving source file', error);
  } finally {
    tracker.record(path, clock.now());
  }
}

/**
 * Wires `deps.vault`'s (or `deps.watch`'s) change events to
 * `deps.enqueuer.enqueue` for every arriving file `formatFromExtension`
 * recognises (pdf/pptx/docx/image). Returns the unsubscribe handle so a host
 * can register it for teardown (`main.ts` uses `Component.register`, the
 * same pattern `buildKeywordIndexWiring`'s own `unsubscribe` already uses).
 */
export function buildIngestionArrivalWatch(deps: IngestionArrivalWatchDeps): Unsubscribe {
  const clock: Clock = deps.clock ?? { now: () => Date.now() };
  const tracker = deps.tracker ?? createInMemoryLastChangedTracker();
  const watch = deps.watch ?? ((handler: (event: VaultEvent) => void) => deps.vault.watch(handler));

  return watch((event) => {
    if (event.kind !== 'create' && event.kind !== 'modify') return;
    const format = formatFromExtension(event.path);
    if (format === null) return;
    void enqueueArrival(event.path, format, deps.vault, deps.enqueuer, clock, tracker);
  });
}
