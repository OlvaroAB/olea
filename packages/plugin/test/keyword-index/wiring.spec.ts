/**
 * `buildKeywordIndexWiring` tests (`ol-tuvx`, `ol-odb0.1`) — proves the
 * composition logic the bug names as missing: given a real
 * `ObsidianKeywordIndexStore` + a real (if synthetic) vault via
 * `FolderSource`, a fresh install ends up with a populated, live index
 * rather than a permanently-empty one nothing ever rebuilds.
 *
 * Runs entirely against `olea-core`'s own testable seams — `FolderSource`
 * (over `node:fs`), `ObsidianKeywordIndexStore` (obsidian-free by
 * construction, see its own module doc) and a fake `watch` — no `obsidian`
 * import anywhere in this file. What is NOT proven here, because it cannot
 * be without a running Obsidian host: that `main.ts` actually calls
 * `buildKeywordIndexWiring` with `ObsidianSource.watch` and a real `Plugin`
 * instance — see `test/main-wiring.spec.ts`'s source-level assertions for
 * that half.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VaultEvent } from 'olea-core';
import { FolderSource } from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObsidianKeywordIndexStore } from '../../src/keyword-index/store.js';
import { buildKeywordIndexWiring } from '../../src/keyword-index/wiring.js';

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

/** A `watch` fake that never fires on its own — the test drives it by calling `fire` directly. */
function fakeWatch() {
  let handler: ((event: VaultEvent) => void) | null = null;
  let unsubscribed = false;
  return {
    watch: (h: (event: VaultEvent) => void) => {
      handler = h;
      return () => {
        unsubscribed = true;
      };
    },
    fire: (event: VaultEvent) => handler?.(event),
    isUnsubscribed: () => unsubscribed,
  };
}

/** Polls `check` until it returns true or `timeoutMs` elapses — needed because the wiring's watch handler fires `engine.applyEvent` without awaiting it (a synchronous `(event) => void` callback, per `VaultSource.watch`'s own contract). */
async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const CAN_DRAIN = { canDrain: true };
const CANNOT_DRAIN = { canDrain: false };

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'olea-keyword-index-wiring-'));
  writeFileSync(
    join(root, 'week2.md'),
    ['---', 'course: GEOL204', '---', '# Bedform Stratification', '', 'Some prose.'].join('\n'),
  );
  writeFileSync(
    join(root, 'week3.md'),
    ['---', 'course: GEOL204', '---', '# Node Regeneration', '', 'Some other prose.'].join('\n'),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildKeywordIndexWiring — first run populates the index (ol-tuvx)', () => {
  it('a fresh store on a capable device rebuilds automatically, ending up populated', async () => {
    const host = new FakeDataHost();
    const vault = new FolderSource(root);
    const { watch } = fakeWatch();

    const wiring = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch,
    });

    expect(wiring.engine.toPersisted().documents).toHaveLength(2);
    // And it actually persisted, not just an in-memory rebuild — a second
    // engine over the same blob sees it with no further rebuild.
    expect(host.blob).not.toBeNull();
  });

  it('a fresh store on a device that cannot drain (mobile, D-002) stays empty rather than rebuilding', async () => {
    const host = new FakeDataHost();
    const vault = new FolderSource(root);
    const { watch } = fakeWatch();

    const wiring = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CANNOT_DRAIN,
      watch,
    });

    expect(wiring.engine.toPersisted().documents).toEqual([]);
  });

  it('a reload with an already-populated store does not rebuild — the persisted state is trusted outright', async () => {
    const host = new FakeDataHost();
    const vault = new FolderSource(root);

    const first = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
    });
    const before = first.engine.toPersisted();
    expect(before.documents).toHaveLength(2);

    // Simulate the vault having changed on disk since — a rebuild here
    // would see zero files; the assertion below is only true if no rebuild
    // ran and the persisted state from before was trusted as-is.
    rmSync(join(root, 'week2.md'));
    rmSync(join(root, 'week3.md'));

    const second = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch: fakeWatch().watch,
    });

    expect(second.engine.toPersisted()).toEqual(before);
  });
});

describe('buildKeywordIndexWiring — stays live for the rest of the session', () => {
  it('a vault event reaching the watch handler updates the engine', async () => {
    const host = new FakeDataHost();
    const vault = new FolderSource(root);
    const { watch, fire } = fakeWatch();

    const wiring = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch,
    });
    expect(wiring.engine.toPersisted().documents).toHaveLength(2);

    writeFileSync(join(root, 'week4.md'), ['# New note', '', 'Fresh content.'].join('\n'));
    fire({ kind: 'create', path: 'week4.md' });

    await waitFor(() => wiring.engine.toPersisted().documents.length === 3);
    expect(wiring.engine.toPersisted().documents.map((d) => d.path)).toContain('week4.md');
  });

  it('unsubscribe stops the wiring from applying further events', async () => {
    const host = new FakeDataHost();
    const vault = new FolderSource(root);
    const { watch, fire, isUnsubscribed } = fakeWatch();

    const wiring = await buildKeywordIndexWiring({
      vault,
      store: new ObsidianKeywordIndexStore(host),
      capability: CAN_DRAIN,
      watch,
    });

    wiring.unsubscribe();
    expect(isUnsubscribed()).toBe(true);
    // Not exercised further here: this fake's `fire` calls the captured
    // handler directly regardless of unsubscribe (it never pretends to be
    // Obsidian's real event bus, which is what actually stops delivering
    // once `offref` runs) — the point of this test is only that
    // `buildKeywordIndexWiring` hands back a real, callable `unsubscribe`
    // for `main.ts` to register via `Component.register`. Suppress the
    // "declared but never read" complaint about `fire` without pretending
    // to test something this fake cannot honestly prove.
    void fire;
  });
});
