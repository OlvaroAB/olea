/**
 * `GateStagePersistence` + `SerializingDataHost` — the tests this bead's
 * persistence exposure needed (`[JEV-11]`, `ol-3ux7.96`). The bug this
 * catches: an unserialized, uncoalesced write-per-attribution raced against
 * itself and against anything else writing the same shared `data.json`,
 * silently discarding a SIBLING key's most recent value. The tests below
 * instrument the underlying file access directly (never a mock that assumes
 * correctness) so an overlap, a lost sibling write, or a wrong final total
 * all fail loudly rather than passing by construction.
 */
import { describe, expect, it, vi } from 'vitest';
import { GateStagePersistence } from '../../src/retrieval/gate-stage-persistence.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';

/**
 * A fake `data.json` with instrumented `loadData`/`saveData`. `delayMs`
 * simulates real disk latency so overlapping calls actually have a window
 * to race in — without it, microtask ordering alone could hide the bug even
 * with no serialization at all.
 */
function instrumentedFile(delayMs: number) {
  let blob: Record<string, unknown> = {};
  let inFlight = 0;
  let maxConcurrent = 0;
  let writeCount = 0;

  return {
    raw: {
      loadData: async (): Promise<unknown> => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const snapshot = { ...blob };
        inFlight -= 1;
        return snapshot;
      },
      saveData: async (data: unknown): Promise<void> => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        blob = data as Record<string, unknown>;
        writeCount += 1;
        inFlight -= 1;
      },
    },
    readBlob: () => ({ ...blob }),
    /** The highest number of `loadData`/`saveData` operations ever in flight together — 1 proves no two file operations ever overlapped. */
    maxConcurrentFileOps: () => maxConcurrent,
    writeCount: () => writeCount,
  };
}

/**
 * A NON-atomic read-modify-write against one key — `loadData()` then,
 * separately, `saveData()` — the exact shape `ground-streak-store.ts`,
 * `settings-store.ts` and `overrides-store.ts` still use today. Used only
 * where a test needs that specific (still-exposed) shape; every assertion
 * about the fix itself uses `host.readModifyWrite` instead, which is the
 * atomic primitive that actually closes the race (see
 * `serializing-data-host.ts`'s doc on why the two are not equivalent).
 */
async function nonAtomicReadModifyWriteKey(
  host: { loadData(): Promise<unknown>; saveData(data: unknown): Promise<void> },
  key: string,
  value: unknown,
): Promise<void> {
  const current = await host.loadData();
  const blob = typeof current === 'object' && current !== null ? { ...(current as object) } : {};
  await host.saveData({ ...blob, [key]: value });
}

/** The atomic shape production actually uses (`gate-stage-store.ts`'s `save`, when given a host with `readModifyWrite`). */
function atomicWriteKey(host: SerializingDataHost, key: string, value: unknown): Promise<void> {
  return host.readModifyWrite((current) => {
    const blob = typeof current === 'object' && current !== null ? { ...(current as object) } : {};
    return { ...blob, [key]: value };
  });
}

describe('GateStagePersistence — serialization and coalescing of its OWN writes (`[JEV-11]`, ol-3ux7.96)', () => {
  it('coalesces a burst of schedule() calls into exactly one write, and the final total equals the number of attributions', async () => {
    vi.useFakeTimers();
    try {
      const file = instrumentedFile(0);
      let recorded = 0;
      const persistence = new GateStagePersistence<{ n: number }>({
        now: () => 'fixed-timestamp',
        getCounts: () => ({ n: recorded }),
        save: (counts, now) =>
          nonAtomicReadModifyWriteKey(file.raw, 'gateStagePeriod', { counts, lastRecordedAt: now }),
        debounceMs: 50,
      });

      for (let i = 0; i < 20; i += 1) {
        recorded += 1;
        persistence.schedule();
      }
      expect(file.writeCount()).toBe(0); // nothing written yet — still inside the quiet period

      await vi.advanceTimersByTimeAsync(60);

      expect(file.writeCount()).toBe(1); // 20 attributions collapsed into ONE write
      const persisted = file.readBlob().gateStagePeriod as { counts: { n: number } };
      expect(persisted.counts.n).toBe(20); // the final persisted total equals the number of attributions
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush() cancels a pending debounce timer and writes immediately, for a session tail at unload', async () => {
    const file = instrumentedFile(0);
    let recorded = 0;
    const persistence = new GateStagePersistence<{ n: number }>({
      now: () => 'fixed-timestamp',
      getCounts: () => ({ n: recorded }),
      save: (counts, now) =>
        nonAtomicReadModifyWriteKey(file.raw, 'gateStagePeriod', { counts, lastRecordedAt: now }),
      debounceMs: 10_000, // long enough that only flush(), not the timer, could produce a write inside this test
    });

    recorded += 1;
    persistence.schedule();
    expect(persistence.isScheduled()).toBe(true);

    persistence.flush();
    expect(persistence.isScheduled()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(file.writeCount()).toBe(1);
  });

  it('a rejected write cannot break the chain for saves queued after it', async () => {
    let calls = 0;
    const results: string[] = [];
    const persistence = new GateStagePersistence<{ n: number }>({
      now: () => 'fixed-timestamp',
      getCounts: () => ({ n: calls }),
      save: async () => {
        calls += 1;
        if (calls === 1) throw new Error('disk error on first write');
        results.push(`ok-${calls}`);
      },
      onError: () => undefined, // swallowed, same as production's console.error
      debounceMs: 5,
    });

    persistence.schedule();
    await new Promise((resolve) => setTimeout(resolve, 20));
    persistence.schedule();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toBe(2);
    expect(results).toEqual(['ok-2']); // the second save ran despite the first one rejecting
  });
});

/**
 * The cross-store exposure `GateStagePersistence` alone cannot close — see
 * `serializing-data-host.ts`'s own doc. This is the shape `main.ts` actually
 * wires: `GateStagePersistence`'s writes AND an independent "sibling store"'s
 * writes both go through the SAME `SerializingDataHost`, exactly as every
 * `ObsidianDataHost`-pattern store in the plugin shares `this` as its host.
 */
describe('SerializingDataHost — closes the cross-store overlap GateStagePersistence alone cannot (`[JEV-11]`, ol-3ux7.96)', () => {
  it('never overlaps two file operations, and a value written to another key mid-burst survives (the assertion that matters)', async () => {
    const file = instrumentedFile(15);
    const host = new SerializingDataHost(file.raw);

    let recorded = 0;
    const persistence = new GateStagePersistence<{ n: number }>({
      now: () => new Date().toISOString(),
      getCounts: () => ({ n: recorded }),
      save: (counts, now) =>
        atomicWriteKey(host, 'gateStagePeriod', { counts, lastRecordedAt: now }),
      debounceMs: 5,
    });

    // Fire several bursts of gate-stage attributions, each followed by an
    // INDEPENDENT store's write to a different key through the SAME host —
    // landing in the same window a naive unserialized implementation would
    // race in.
    const siblingWrites: Promise<void>[] = [];
    for (let burst = 0; burst < 4; burst += 1) {
      for (let i = 0; i < 3; i += 1) {
        recorded += 1;
        persistence.schedule();
      }
      siblingWrites.push(atomicWriteKey(host, `otherSetting${burst}`, `kept-${burst}`));
      await new Promise((resolve) => setTimeout(resolve, 8)); // let the debounce timer land mid-burst on some iterations
    }
    await Promise.all(siblingWrites);
    // Give any still-pending debounce timers time to fire and flush.
    await new Promise((resolve) => setTimeout(resolve, 80));
    persistence.flush();
    await new Promise((resolve) => setTimeout(resolve, 40));

    // The assertion that matters: every sibling key survives, none clobbered
    // by an overlapping gate-stage write racing it on the shared blob.
    const finalBlob = file.readBlob();
    for (let burst = 0; burst < 4; burst += 1) {
      expect(finalBlob[`otherSetting${burst}`]).toBe(`kept-${burst}`);
    }

    // No two file operations (load or save), from EITHER writer, were ever
    // in flight together.
    expect(file.maxConcurrentFileOps()).toBe(1);

    // The final persisted total equals the number of attributions fired.
    const persisted = finalBlob.gateStagePeriod as { counts: { n: number } };
    expect(persisted.counts.n).toBe(12);
  });

  it('a rejected operation from one writer cannot break the chain for the other writer', async () => {
    let calls = 0;
    const flakyRaw = {
      loadData: async (): Promise<unknown> => {
        calls += 1;
        if (calls === 1) throw new Error('disk error on the very first read');
        return {};
      },
      saveData: async (): Promise<void> => undefined,
    };
    const host = new SerializingDataHost(flakyRaw);

    // First operation's loadData rejects...
    await expect(atomicWriteKey(host, 'a', 1)).rejects.toThrow('disk error');
    // ...but the next, unrelated write through the same host still runs.
    await expect(atomicWriteKey(host, 'b', 2)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
