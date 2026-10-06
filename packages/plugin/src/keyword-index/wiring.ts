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
 * **Every PDF, deck and document in the vault (`ol-egov.141.89.1.95`, David's ruling 2026-10-06,
 * option a).** Given `deps.binarySources`, the engine indexes every PDF, slide deck and Word
 * document the vault lists beside her notes, registered or not, text layer only (a scanned page
 * and an image never enter the index; nothing calls a vision model), each block carrying the
 * citation pipeline's page or slide anchor, and keeps them current from the same watch (see
 * `KeywordIndexEngine`'s module doc for the set, the events and the course precedence). Her
 * registrations (`binarySources.registeredFiles`: `main.ts` passes `projectRegisteredFiles` over
 * `readReviewLogHistory`, the projection the grove, the plan, the session builder and the
 * registry read) now decide only a binary's course. On this wiring's side:
 *  - the first-run rebuild indexes notes and transcripts only (`deferBinaries`), so plugin load
 *    waits on her notes and never on extracting every PDF in the vault;
 *  - every load then runs one `syncBinarySources` in the background (`binarySourcesSynced`):
 *    after a first run it extracts every binary; on a reload that trusts a populated index it
 *    extracts a binary the persisted index lacks (one added while Obsidian was closed, or before
 *    this change shipped), drops one gone from the vault, and trusts one already indexed, like a
 *    note;
 *  - `syncBinarySources` is also what a registration calls (S1 in the grove, S2 in the file menu):
 *    a registration can change a binary's course, and her event log lives in a dot-folder that
 *    raises no vault event.
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
 * recorded here rather than silently assumed away. (The load-time binary sync above adds and drops
 * whole files; a binary changed in place while Obsidian was closed is, like a note, trusted as
 * persisted until it is next modified or a rebuild runs.)
 */

import {
  type BinarySourcesDeps,
  type BinarySourcesSync,
  type DeviceCapability,
  KeywordIndexEngine,
  type KeywordIndexStore,
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
   * `ol-egov.141.89.1.95`: index every PDF, deck and document in the vault, with her registered
   * sources (read fresh on each call; production: the "source registered" events folded by
   * `projectRegisteredFiles`) supplying their courses. Omitted, the index holds notes and
   * transcripts only, as before. Ignored where `capability.canDrain` is false.
   */
  readonly binarySources?: BinarySourcesDeps;
}

export interface KeywordIndexWiring {
  readonly engine: KeywordIndexEngine;
  /** Stops the engine from applying further vault events. Call on unload. */
  readonly unsubscribe: () => void;
  /**
   * `ol-egov.141.89.1.95`: brings the index's binaries in line with the vault and her registered
   * courses (`KeywordIndexEngine.syncBinarySources`). A registration calls it. Never rejects: a
   * failure is logged by name and resolves `null`.
   */
  readonly syncBinarySources: () => Promise<BinarySourcesSync | null>;
  /** The background sync every load starts (see the module doc). Never rejects; `null` where binaries are not indexed. */
  readonly binarySourcesSynced: Promise<BinarySourcesSync | null>;
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
  const binarySources = deps.capability.canDrain ? deps.binarySources : undefined;
  const engine = await KeywordIndexEngine.create({
    vault: deps.vault,
    store: deps.store,
    ...(binarySources !== undefined ? { binarySources } : {}),
  });

  if (engine.toPersisted().documents.length === 0 && deps.capability.canDrain) {
    // Fire-and-forget from this function's own perspective would leave the
    // caller unable to tell "empty because nothing indexed yet" from "empty
    // because nothing is there" for the whole first rebuild — awaiting here
    // costs nothing extra a caller wasn't already going to pay by calling
    // this function in the first place, and mirrors `buildIngestionRunner`
    // awaiting `IngestionQueueEngine.create` rather than racing it.
    // `ol-egov.141.89.1.95`: her notes only; the background sync below extracts the binaries.
    await engine.rebuild({ deferBinaries: true });
  }

  const unsubscribe = deps.watch((event) => {
    void engine.applyEvent(event);
  });

  const syncBinarySources = async (): Promise<BinarySourcesSync | null> => {
    if (binarySources === undefined) return null;
    try {
      return await engine.syncBinarySources();
    } catch (error) {
      // D-005: the error's name only; a path or a passage can ride in a message.
      console.error(
        'Olea: could not bring PDFs, decks and documents into the keyword index',
        error instanceof Error ? error.name : 'unknown',
      );
      return null;
    }
  };
  // In the background: plugin load never waits on extraction (see the module doc).
  const binarySourcesSynced = syncBinarySources();

  return { engine, unsubscribe, syncBinarySources, binarySourcesSynced };
}
