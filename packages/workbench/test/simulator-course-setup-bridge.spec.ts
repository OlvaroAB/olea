/**
 * `simulator/course-setup-bridge.ts` (`ol-yng7`, follow-on to `ol-3ux7.64.11`
 * [WBX-9]) — proves two things, split the way this package's own convention
 * already splits DOM-touching code from logic (`test/obsidian-shim-whole-
 * plugin.spec.ts`'s own doc: this package's vitest suite runs under plain
 * Node with no DOM, so DOM wiring is proven by the real browser tour
 * instead, `docs/dev/simulator-design.md` §6/§7):
 *
 * 1. `selectNewlyOpenedCodes` — the actual bug. The ORIGINAL watcher tracked
 *    "the current code" by VALUE (`querySelector`'s first match compared
 *    against one scalar), which silently ignored a second, distinct modal
 *    instance proposing the SAME code as an instance already handled —
 *    exactly what a cross-mount repeat proposal is. This is provable with
 *    no DOM at all: `selectNewlyOpenedCodes` is generic over the node type,
 *    so two distinct plain objects that happen to read the same code are
 *    enough to reproduce the identity-vs-value distinction that was the
 *    defect.
 * 2. `loadCourseSetupSeenCodes`/`recordCourseSetupSeenCode` — the
 *    persistence half the bridge reads/writes, already DOM-free and
 *    (before this bead) untested.
 */

import { describe, expect, it } from 'vitest';
import {
  loadCourseSetupSeenCodes,
  recordCourseSetupSeenCode,
  selectNewlyOpenedCodes,
} from '../src/simulator/course-setup-bridge.js';
import { createPluginDataHost } from '../src/simulator/plugin-data-host.js';
import { createMemoryStore } from '../src/simulator/store.js';

describe('selectNewlyOpenedCodes', () => {
  it('treats every node as new the first time it is seen', () => {
    const nodeA = { code: 'CS101' };
    const nodeB = { code: 'MATH200' };
    const { newCodes, newlyHandled } = selectNewlyOpenedCodes(
      [nodeA, nodeB],
      new Set(),
      (n) => n.code,
    );
    expect(newCodes).toEqual(['CS101', 'MATH200']);
    expect(newlyHandled).toEqual([nodeA, nodeB]);
  });

  it('ol-yng7: a SECOND, DISTINCT node reading the SAME code as an already-handled node is still new', () => {
    // Two separate modal instances proposing the same course — exactly what
    // `Modal.open()` appending a fresh `.modal-container` on a cross-mount
    // repeat produces (`course-setup-bridge.ts`'s own doc). Identity differs
    // even though `readCode` returns an identical string for both.
    const firstInstance = { code: 'CS101' };
    const secondInstance = { code: 'CS101' };
    const handled = new Set([firstInstance]);

    const { newCodes, newlyHandled } = selectNewlyOpenedCodes(
      [firstInstance, secondInstance],
      handled,
      (n) => n.code,
    );

    expect(newCodes).toEqual(['CS101']);
    expect(newlyHandled).toEqual([secondInstance]);
  });

  it('the OLD value-keyed approach would have missed this — same input reproduced for contrast', () => {
    // This is what `react()` used to do: compare the DERIVED VALUE against
    // one scalar rather than tracking instances. Kept here as a documented
    // contrast, not as a claim about current behaviour.
    const oldBuggyCheck = (codes: readonly string[]): string[] => {
      const kept: string[] = [];
      let lastObserved: string | null = null;
      for (const code of codes) {
        if (code === lastObserved) continue;
        lastObserved = code;
        kept.push(code);
      }
      return kept;
    };
    // Two distinct modal instances, same code — the buggy value-keyed
    // reducer collapses them into one, exactly the reported symptom (a
    // repeat proposal never reaching the seen-code check at all).
    expect(oldBuggyCheck(['CS101', 'CS101'])).toEqual(['CS101']);

    // The fixed, identity-keyed version does not.
    const a = { code: 'CS101' };
    const b = { code: 'CS101' };
    const { newCodes } = selectNewlyOpenedCodes([a, b], new Set(), (n) => n.code);
    expect(newCodes).toEqual(['CS101', 'CS101']);
  });

  it('a node already handled twice over contributes nothing on the second look', () => {
    const node = { code: 'CS101' };
    const first = selectNewlyOpenedCodes([node], new Set(), (n) => n.code);
    const handled = new Set(first.newlyHandled);
    const second = selectNewlyOpenedCodes([node], handled, (n) => n.code);
    expect(second.newCodes).toEqual([]);
    expect(second.newlyHandled).toEqual([]);
  });

  it('an empty node list yields nothing new', () => {
    const { newCodes, newlyHandled } = selectNewlyOpenedCodes([], new Set(), (n: never) => n);
    expect(newCodes).toEqual([]);
    expect(newlyHandled).toEqual([]);
  });
});

describe('loadCourseSetupSeenCodes / recordCourseSetupSeenCode', () => {
  it('starts empty over a fresh host', async () => {
    const host = createPluginDataHost(createMemoryStore());
    expect(await loadCourseSetupSeenCodes(host)).toEqual(new Set());
  });

  it('a recorded code is read back by a fresh load', async () => {
    const host = createPluginDataHost(createMemoryStore());
    await recordCourseSetupSeenCode(host, 'CS101');
    expect(await loadCourseSetupSeenCodes(host)).toEqual(new Set(['CS101']));
  });

  it('accumulates codes across separate record calls, matching a real cross-mount sequence', async () => {
    const host = createPluginDataHost(createMemoryStore());
    await recordCourseSetupSeenCode(host, 'CS101');
    await recordCourseSetupSeenCode(host, 'MATH200');
    expect(await loadCourseSetupSeenCodes(host)).toEqual(new Set(['CS101', 'MATH200']));
  });

  it('recording the same code twice is a no-op the second time', async () => {
    const store = createMemoryStore();
    const host = createPluginDataHost(store);
    await recordCourseSetupSeenCode(host, 'CS101');
    await recordCourseSetupSeenCode(host, 'CS101');
    expect(await loadCourseSetupSeenCodes(host)).toEqual(new Set(['CS101']));
  });

  it('does not clobber an unrelated top-level key in the shared data blob', async () => {
    const store = createMemoryStore();
    await store.savePluginData({ someOtherFeature: 'keep-me' });
    const host = createPluginDataHost(store);

    await recordCourseSetupSeenCode(host, 'CS101');

    const blob = (await store.loadPluginData()) as Record<string, unknown>;
    expect(blob.someOtherFeature).toBe('keep-me');
  });

  it('a store cleared by resetAll (`SimulatorController.reset()`) forgets every seen code — the one legitimate reopen', async () => {
    const store = createMemoryStore();
    const host = createPluginDataHost(store);
    await recordCourseSetupSeenCode(host, 'CS101');

    await store.resetAll();

    expect(await loadCourseSetupSeenCodes(host)).toEqual(new Set());
  });

  it('tolerates malformed persisted data rather than throwing', async () => {
    const store = createMemoryStore();
    await store.savePluginData({ wbSimulatorCourseSetupSeenCodes: 'not-an-array' });
    const host = createPluginDataHost(store);
    expect(await loadCourseSetupSeenCodes(host)).toEqual(new Set());
  });
});
