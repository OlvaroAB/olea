/**
 * `ObsidianGateStageStore` round-trip tests (`[JEV-11]`, `ol-3ux7.96`).
 *
 * Nothing here holds anything derived from her content — see the module
 * doc's own privacy argument — so there is no INV-3 fixture to invent
 * around; every value below is a bare integer count or an ISO timestamp.
 */
import { describe, expect, it } from 'vitest';
import type { GateStage } from 'olea-core';
import {
  GATE_STAGE_STORAGE_KEY,
  ObsidianGateStageStore,
  zeroGateStageCounts,
} from '../../src/retrieval/gate-stage-store.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function counts(overrides: Partial<Record<GateStage, number>>): Record<GateStage, number> {
  return { ...zeroGateStageCounts(), ...overrides };
}

describe('ObsidianGateStageStore', () => {
  it('returns null when nothing is stored', async () => {
    const store = new ObsidianGateStageStore(new FakeDataHost());
    expect(await store.load()).toBeNull();
  });

  it('round-trips saved counts and the save timestamp', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGateStageStore(host);

    await store.save(counts({ 'below-band': 3, 'escalated-to-judge': 1 }), '2026-01-01T00:00:00.000Z');

    const reloaded = await store.load();
    expect(reloaded).toEqual({
      version: 1,
      periodStartedAt: '2026-01-01T00:00:00.000Z',
      lastRecordedAt: '2026-01-01T00:00:00.000Z',
      counts: counts({ 'below-band': 3, 'escalated-to-judge': 1 }),
    });
  });

  it('sets periodStartedAt only on the first-ever save, and carries it forward unchanged on every later one', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGateStageStore(host);

    await store.save(counts({ 'above-band': 1 }), '2026-01-01T00:00:00.000Z');
    await store.save(counts({ 'above-band': 2 }), '2026-01-02T00:00:00.000Z');
    await store.save(counts({ 'above-band': 3 }), '2026-01-03T00:00:00.000Z');

    const reloaded = await store.load();
    expect(reloaded?.periodStartedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(reloaded?.lastRecordedAt).toBe('2026-01-03T00:00:00.000Z');
    expect(reloaded?.counts['above-band']).toBe(3);
  });

  it('save REPLACES the whole counts object — the caller sends the current running total, not a delta', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianGateStageStore(host);

    await store.save(counts({ 'below-band': 5, 'above-band': 5 }), '2026-01-01T00:00:00.000Z');
    await store.save(counts({ 'below-band': 5 }), '2026-01-02T00:00:00.000Z'); // above-band reset to 0 by the caller

    const reloaded = await store.load();
    expect(reloaded?.counts).toEqual(counts({ 'below-band': 5 }));
  });

  it('never touches any other key already in data.json (read-modify-write)', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'kept' };
    const store = new ObsidianGateStageStore(host);

    await store.save(counts({ 'no-hits': 1 }), '2026-01-01T00:00:00.000Z');

    expect(host.blob).toMatchObject({ someOtherPluginSetting: 'kept' });
    expect((host.blob as Record<string, unknown>)[GATE_STAGE_STORAGE_KEY]).toMatchObject({
      version: 1,
      counts: counts({ 'no-hits': 1 }),
    });
  });

  it('falls back to null for a malformed stored value, never throws', async () => {
    const host = new FakeDataHost();
    host.blob = { [GATE_STAGE_STORAGE_KEY]: { version: 2, garbage: true } };
    const store = new ObsidianGateStageStore(host);
    expect(await store.load()).toBeNull();
  });

  it('falls back to null when a stored count is negative or non-integer', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [GATE_STAGE_STORAGE_KEY]: {
        version: 1,
        periodStartedAt: '2026-01-01T00:00:00.000Z',
        lastRecordedAt: '2026-01-01T00:00:00.000Z',
        counts: counts({ 'below-band': -1 }),
      },
    };
    const store = new ObsidianGateStageStore(host);
    expect(await store.load()).toBeNull();
  });

  it('falls back to null, never throws, when loadData itself rejects', async () => {
    const failingHost: ObsidianDataHost = {
      loadData: () => Promise.reject(new Error('disk error')),
      saveData: () => Promise.resolve(),
    };
    const store = new ObsidianGateStageStore(failingHost);
    expect(await store.load()).toBeNull();
  });

  it('clear removes the stored period without touching other keys, and is never reachable except by direct call', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'kept' };
    const store = new ObsidianGateStageStore(host);
    await store.save(counts({ 'no-hits': 1 }), '2026-01-01T00:00:00.000Z');

    await store.clear();

    expect(host.blob).toEqual({ someOtherPluginSetting: 'kept' });
    expect(await store.load()).toBeNull();
  });

  it('holds only integer counts and ISO timestamps — the sentinel test the recording capability requires', async () => {
    const sentinel = 'sentinel-8f31-never-persisted';
    const host = new FakeDataHost();
    const store = new ObsidianGateStageStore(host);
    // A caller cannot pass sentinel content through this store's own type —
    // `counts` is `Record<GateStage, number>` — but the same discipline
    // `groundedContext.spec.ts`'s sentinel test uses is repeated here at the
    // persistence boundary: nothing serialized ever contains the sentinel.
    await store.save(counts({ 'escalated-to-judge': 1 }), '2026-01-01T00:00:00.000Z');
    expect(JSON.stringify(host.blob)).not.toContain(sentinel);
  });

  it('uses the atomic readModifyWrite path when the host supports it (`[JEV-11]` overlap fix), and round-trips identically to the fallback path', async () => {
    const raw = new FakeDataHost();
    const atomicHost = new SerializingDataHost(raw);
    const store = new ObsidianGateStageStore(atomicHost);

    await store.save(counts({ 'above-band': 1 }), '2026-01-01T00:00:00.000Z');
    await store.save(counts({ 'above-band': 2 }), '2026-01-02T00:00:00.000Z');

    const reloaded = await store.load();
    expect(reloaded?.periodStartedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(reloaded?.lastRecordedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(reloaded?.counts['above-band']).toBe(2);
  });

  it('never overlaps its own two saves when given the atomic host, even when they race', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    let blob: unknown = null;
    const slowRaw: ObsidianDataHost = {
      loadData: async () => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return blob;
      },
      saveData: async (data) => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        blob = data;
        inFlight -= 1;
      },
    };
    const store = new ObsidianGateStageStore(new SerializingDataHost(slowRaw));

    await Promise.all([
      store.save(counts({ 'above-band': 1 }), '2026-01-01T00:00:00.000Z'),
      store.save(counts({ 'below-band': 1 }), '2026-01-01T00:00:01.000Z'),
    ]);

    expect(maxConcurrent).toBe(1);
  });
});
