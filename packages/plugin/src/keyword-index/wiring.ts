/**
 * `buildKeywordIndexWiring` — the composition root ol-tuvx asks for:
 * constructs a real `KeywordIndexEngine` over whichever `VaultSource`/
 * `KeywordIndexStore` it's given, populates it on first run, and hands back
 * an unsubscribe so a host can stop applying vault events on teardown.
 *
 * **Why this needed its own file rather than an inline call in `main.ts`.**
 * `ol-tuvx`'s diagnosis is exact: `ObsidianKeywordIndexStore` — a finished
 * adapter with its own reload/rebuild-equivalence tests
 * (`test/keyword-index/reload.spec.ts`) — was never constructed anywhere in
 * the plugin. The class existed, the port it implements existed, and nothing
 * called `new ObsidianKeywordIndexStore(...)`. Following `ingestion/wiring.ts`'s
 * own precedent (same diagnosis shape for `ObsidianQueueStore` before P3-T03a),
 * this module is the obsidian-free composition logic, unit-tested against
 * fakes; `main.ts` is the one place that supplies the real,
 * Obsidian-backed `VaultSource`/`KeywordIndexStore` and the real `Vault`
 * event stream `watch()` exposes.
 *
 * **Rebuild policy: only when nothing is persisted.** `KeywordIndexEngine.create`
 * already treats "nothing persisted" (fresh install, or a deleted cache per
 * D-006) as zero documents; this module is what actually calls `rebuild()`
 * in that case, exactly once, so a fresh install doesn't sit there
 * permanently empty waiting for individual vault events to trickle in one at
 * a time. A reload that finds a non-empty persisted index trusts it outright
 * — no rebuild — which is what "the index survives a plugin reload" means in
 * `reload.spec.ts`. Staying current *within* a session from that point on is
 * `watch()`'s job below, not a second rebuild.
 *
 * **Lecture transcripts (D-465, `ol-egov.141.89.1.62`).** Nothing is passed here for them: the
 * engine's own scan and its incremental `applyEvent` both index a plain-text file, and a Markdown
 * file declaring role transcript, as the transcript reader's parts (each carrying its part
 * ordinal), through the one `indexDocument`. So the rebuild-once step above, the persisted reload
 * and the watch below all cover transcripts with no second path. A persisted index written before
 * this change keeps a declared transcript's old note-shaped blocks until that file is next
 * modified or a rebuild runs (the cache is deletable, D-006).
 *
 * **Registered binary sources (`ol-egov.141.89.1.95`).** `deps.registeredFiles` is her registered
 * documents, folded from the "source registered" events in her log (`main.ts` passes
 * `projectRegisteredFiles` over `readReviewLogHistory`, the same projection the grove, the plan,
 * the session builder and the registry read). Given it, the engine indexes those PDFs, decks and
 * documents beside her notes, each block carrying the citation pipeline's page or slide anchor,
 * and keeps them current from the same watch (see `KeywordIndexEngine`'s module doc). On this
 * wiring's side:
 *  - the first-run rebuild above includes them;
 *  - every load then runs one `syncRegisteredSources` in the background
 *    (`registeredSourcesSynced`), so plugin load never waits on extraction: on a reload that
 *    trusts a populated index, a registered file the persisted index lacks (one registered on
 *    another device, or registered before this change shipped) is extracted then, and one no
 *    longer registered leaves; one already indexed is trusted, like a note. After a first-run
 *    rebuild it finds nothing to do, unless that rebuild could not read her log;
 *  - `syncRegisteredSources` is what a registration calls (S1 in the grove, S2 in the file menu),
 *    since her event log lives in a dot-folder that raises no vault event.
 * Only where the drain runs (`capability.canDrain`): extraction is the CPU work D-002 keeps off
 * mobile, so on a device that cannot drain the index stays notes and transcripts, as before.
 *
 * **What this does not attempt.** Catching up on vault edits made while
 * Obsidian was closed, on a different device, requires either a full rebuild
 * every launch (real CPU cost on every start, including mobile) or some
 * reconciliation `KeywordIndexEngine` does not offer today. Neither is this
 * bead's call to make unilaterally — the cache is safely deletable and
 * rebuildable on demand (D-006), so the honest interim position is
 * "current as of this session's own edits," not "always current," and it is
 * recorded here rather than silently assumed away.
 */

import {
  type DeviceCapability,
  KeywordIndexEngine,
  type KeywordIndexStore,
  type RegisteredFileSpec,
  type RegisteredSourcesSync,
  type VaultEvent,
  type VaultSource,
} from 'olea-core';

export interface KeywordIndexWiringDeps {
  readonly vault: VaultSource;
  readonly store: KeywordIndexStore;
  /**
   * Same reasoning D-002 already applies to the ingestion queue: a
   * full rebuild is real, possibly-lengthy CPU work, and a mobile OS
   * suspending backgrounded Obsidian can leave it half-finished with no
   * resume story (`KeywordIndexEngine.rebuild`'s cancellation exists for a
   * deliberate cancel, not a silent OS suspend). Desktop rebuilds
   * automatically on a first run; mobile starts empty and grows only from
   * `watch()`'s incremental events (whatever mobile Obsidian itself
   * generates), the same asymmetry D-002 draws for the drain.
   */
  readonly capability: DeviceCapability;
  /**
   * Subscribes to vault change events; production hands in
   * `ObsidianSource.watch`, tests a fake that never fires. Returns the
   * engine's own `Unsubscribe` so a host can register it for teardown
   * (`main.ts` uses `Component.register`).
   */
  readonly watch: (handler: (event: VaultEvent) => void) => () => void;
  /**
   * `ol-egov.141.89.1.95`: her registered sources, read fresh on each call (production: the
   * "source registered" events folded by `projectRegisteredFiles`). Omitted, the index holds notes
   * and transcripts only, as before. Ignored where `capability.canDrain` is false.
   */
  readonly registeredFiles?: () => Promise<readonly RegisteredFileSpec[]>;
}

export interface KeywordIndexWiring {
  readonly engine: KeywordIndexEngine;
  /** Stops the engine from applying further vault events. Call on unload. */
  readonly unsubscribe: () => void;
  /**
   * `ol-egov.141.89.1.95`: brings the index's registered binaries in line with her registered
   * sources (`KeywordIndexEngine.syncRegisteredSources`). A registration calls it. Never rejects:
   * a failure is logged by name and resolves `null`.
   */
  readonly syncRegisteredSources: () => Promise<RegisteredSourcesSync | null>;
  /** The background sync every load starts (see the module doc). Never rejects; `null` when there is nothing to sync from. */
  readonly registeredSourcesSynced: Promise<RegisteredSourcesSync | null>;
}

/**
 * Builds one real, live-updating keyword index: loads whatever is persisted,
 * rebuilds once if nothing was (desktop only — see the module doc), and
 * wires every subsequent vault event to `engine.applyEvent` for the rest of
 * this session.
 */
export async function buildKeywordIndexWiring(
  deps: KeywordIndexWiringDeps,
): Promise<KeywordIndexWiring> {
  const registeredFiles = deps.capability.canDrain ? deps.registeredFiles : undefined;
  const engine = await KeywordIndexEngine.create({
    vault: deps.vault,
    store: deps.store,
    ...(registeredFiles !== undefined ? { registeredFiles } : {}),
  });

  if (engine.toPersisted().documents.length === 0 && deps.capability.canDrain) {
    // Fire-and-forget from this function's own perspective would leave the
    // caller unable to tell "empty because nothing indexed yet" from "empty
    // because nothing is there" for the whole first rebuild — awaiting here
    // costs nothing extra a caller wasn't already going to pay by calling
    // this function in the first place, and mirrors `buildIngestionRunner`
    // awaiting `IngestionQueueEngine.create` rather than racing it.
    await engine.rebuild();
  }

  const unsubscribe = deps.watch((event) => {
    void engine.applyEvent(event);
  });

  const syncRegisteredSources = async (): Promise<RegisteredSourcesSync | null> => {
    if (registeredFiles === undefined) return null;
    try {
      return await engine.syncRegisteredSources();
    } catch (error) {
      // D-005: the error's name only; a path or a passage can ride in a message.
      console.error(
        'Olea: could not bring registered sources into the keyword index',
        error instanceof Error ? error.name : 'unknown',
      );
      return null;
    }
  };
  // In the background: plugin load never waits on extraction (see the module doc).
  const registeredSourcesSynced = syncRegisteredSources();

  return { engine, unsubscribe, syncRegisteredSources, registeredSourcesSynced };
}
