/**
 * `OleaLayerWriteSeal` (`ol-egov.141.8.14`): the one gate every write the plugin makes under
 * `.olea/` passes through, so a full delete can close it before it clears the folder.
 *
 * **Why one gate reaches every writer.** Every store, log and sidecar under `.olea/` writes
 * through a `VaultSource`, and the only production `VaultSource` is `ObsidianSource`, which only
 * `main.ts` builds — once, wrapped in this seal, and handed to everything that writes. So the gate
 * is where the writes are, not a list of writers that a new store could be missing from.
 * `test/privacy/olea-layer-write-seal.spec.ts` pins both halves in source: `main.ts` builds
 * `ObsidianSource` exactly once and wraps it, and no other plugin source builds one at all.
 *
 * **What the seal does.** While sealed, a `write` to a path under `.olea/` is dropped: it resolves
 * without writing, so a job of the old plugin instance that finishes after the delete cannot
 * recreate a file the delete removed. Sealing waits for every `.olea/` write already in flight to
 * settle, so a write issued before the seal lands before the delete runs, and the delete removes
 * it. The delete itself works on the unsealed source underneath (`seal().vault`). A path whose first
 * segment is `.olea` in any letter case counts, because a case-insensitive disk stores both in one
 * folder; the check fails closed rather than open.
 *
 * **What it leaves alone, on purpose.** Reads, listing, watching and `delete` pass through always:
 * none of them can put content back. A write outside `.olea/` passes too — an item she accepted
 * into one of her notes, a `[D-179]` home note, an export file under `Olea exports/`. A full delete
 * does not remove those, so dropping the write would lose her edit without clearing anything.
 *
 * **Lifetime.** Mirrors `FullDeleteWriteSeal` (`./settings-section.ts`), which composes this seal
 * and drives it: `retire` is `onunload`'s call, and a sealed instance that retires stays sealed for
 * good, because the unload is the reload that follows the delete. When no reload happened, the seal
 * is released and the instance writes as before. What the plugin writes after the reload is not
 * decided here (`[D-406]`).
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import { OLEA_LAYER_ROOT } from './log-discovery.js';

/** True for any path whose first real segment is `.olea` (the root F7.4's delete clears), in any letter case (module doc). */
export function isSealedOleaPath(path: VaultPath): boolean {
  const first = path.split('/').find((segment) => segment !== '' && segment !== '.');
  return first !== undefined && first.toLowerCase() === OLEA_LAYER_ROOT.toLowerCase();
}

/** `listUnder` — the dot-folder walk `ObsidianSource` offers outside the `VaultSource` contract. */
type ListUnder = (
  dotPath: VaultPath,
  options?: { readonly extensions?: readonly string[] },
) => Promise<readonly VaultPath[]>;

export class OleaLayerWriteSeal implements VaultSource {
  private sealDepth = 0;
  private retired = false;
  private readonly inFlight = new Set<Promise<void>>();

  // The optional capabilities exist on the wrapper exactly when the source underneath has them:
  // callers test for them by presence (`vault.delete === undefined`, `listFolder`'s `listUnder`
  // check), so an always-present forwarder would claim a capability the host lacks.
  declare readonly delete?: (path: VaultPath) => Promise<void>;
  declare readonly firstSeen?: (path: VaultPath) => Promise<number | null>;
  declare readonly removeEmptyFolder?: (path: VaultPath) => Promise<void>;
  declare readonly listUnder?: ListUnder;

  constructor(private readonly source: VaultSource) {
    const inner = source as VaultSource & { listUnder?: ListUnder };
    if (inner.delete !== undefined) Object.assign(this, { delete: inner.delete.bind(inner) });
    if (inner.firstSeen !== undefined)
      Object.assign(this, { firstSeen: inner.firstSeen.bind(inner) });
    if (inner.removeEmptyFolder !== undefined)
      Object.assign(this, { removeEmptyFolder: inner.removeEmptyFolder.bind(inner) });
    if (typeof inner.listUnder === 'function')
      Object.assign(this, { listUnder: inner.listUnder.bind(inner) });
  }

  list(options?: ListOptions): Promise<readonly VaultPath[]> {
    return this.source.list(options);
  }

  read(path: VaultPath): Promise<string> {
    return this.source.read(path);
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.source.readBinary(path);
  }

  exists(path: VaultPath): Promise<boolean> {
    return this.source.exists(path);
  }

  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    return this.source.watch(handler);
  }

  write(path: VaultPath, content: string): Promise<void> {
    if (!isSealedOleaPath(path)) return this.source.write(path, content);
    if (this.sealDepth > 0) return Promise.resolve();
    const write = this.source.write(path, content);
    const tracked = write.then(
      () => undefined,
      () => undefined,
    );
    this.inFlight.add(tracked);
    void tracked.then(() => this.inFlight.delete(tracked));
    return write;
  }

  /**
   * Seals, then resolves once every `.olea/` write issued before the seal has settled. `vault` is
   * the unsealed source the delete works through; `release` lifts this seal unless the instance
   * retired meanwhile.
   */
  async seal(): Promise<{ readonly vault: VaultSource; release(): void }> {
    this.sealDepth += 1;
    let released = false;
    await Promise.all([...this.inFlight]);
    return {
      vault: this.source,
      release: () => {
        if (released || this.retired) return;
        released = true;
        this.sealDepth -= 1;
      },
    };
  }

  /** `onunload`: marks the instance done. `true` when unsealed. */
  retire(): boolean {
    this.retired = true;
    return this.sealDepth === 0;
  }
}
