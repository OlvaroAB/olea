/**
 * Cross-store interleaving regression (`ol-ppxj.46`, `[DOS-6]`). The bead:
 * seventeen plugin stores share Obsidian's one `data.json`, and each did its
 * own `save()` as a plain `loadData()`-then-`saveData()` pair — two separate
 * host calls — REGARDLESS of whether the host it was given could do better.
 * `main.ts`'s `SerializingDataHost` (`[JEV-11]`, `ol-3ux7.96`) already
 * serializes INDIVIDUAL `loadData`/`saveData` calls against each other, but
 * a read-modify-write is two calls, and another store's entire cycle can
 * still land between one store's own load and save — see
 * `../../src/retrieval/serializing-data-host.ts`'s module doc for the exact
 * trace.
 *
 * This test uses two of the real store classes this bead migrates —
 * `ObsidianGroveGroundStreakStore` and `ObsidianWorkerConfigStore` — sharing
 * one `SerializingDataHost`, the same object `main.ts` wires every store's
 * host to (`this.dataFileHost`). Before this bead, neither store class ever
 * called `readModifyWrite` no matter what host it held, so this exact
 * scenario raced and lost a write (verified against the pre-fix method
 * bodies; see this bead's report for the captured failing line — it is not
 * re-derived here via a second, throwaway copy of old code, so this file
 * stays a permanent, ordinary passing regression test rather than another
 * `it.fails` pin). After this bead, both stores check `hasReadModifyWrite`
 * and use the atomic path when the host supports it, which
 * `SerializingDataHost` does — so both writes now survive.
 *
 * Real `setTimeout` delays on the fake file give the two cycles an actual
 * window to race in — without it, microtask ordering alone could hide the
 * bug even with zero serialization (same reasoning
 * `gate-stage-persistence.spec.ts` gives for its own instrumented file).
 */
import { describe, expect, it } from 'vitest';
import { ObsidianGroveGroundStreakStore } from '../../src/grove/ground-streak-store.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';
import { ObsidianWorkerConfigStore } from '../../src/worker/config-store.js';

function delayedRawHost(delayMs: number) {
  let blob: Record<string, unknown> = {};
  return {
    raw: {
      loadData: async (): Promise<unknown> => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { ...blob };
      },
      saveData: async (data: unknown): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        blob = { ...(data as Record<string, unknown>) };
      },
    },
    readBlob: () => ({ ...blob }),
  };
}

describe('Two different stores interleaved through one shared data.json, via the real atomic host (ol-ppxj.46)', () => {
  it('a ground-streak save and a worker-config save started concurrently both survive — neither is silently discarded', async () => {
    const file = delayedRawHost(10);
    const host = new SerializingDataHost(file.raw);

    const groundStreaks = new ObsidianGroveGroundStreakStore(host);
    const workerConfig = new ObsidianWorkerConfigStore(host);

    const writeA = groundStreaks.save(new Map([['concept-a', 3]]));
    // Store B's cycle is issued while A's own `loadData()` is still in
    // flight, giving B's whole cycle room to land inside A's
    // load-to-save window — the exact shape that discarded a write before
    // this bead moved both stores onto `readModifyWrite`.
    await new Promise((resolve) => setTimeout(resolve, 1));
    const writeB = workerConfig.save({ version: 1, baseUrl: 'https://example.test', token: 'tok' });

    await Promise.all([writeA, writeB]);

    const [loadedStreaks, loadedConfig] = await Promise.all([
      groundStreaks.load(),
      workerConfig.load(),
    ]);

    expect(loadedConfig.baseUrl).toBe('https://example.test');
    expect(loadedStreaks.get('concept-a')).toBe(3); // the write this bug used to discard
  });
});
