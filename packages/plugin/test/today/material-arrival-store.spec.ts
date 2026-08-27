// Scenarios: `features/F6-today.md`, "F6.9 — rhythm reading data plumbing" —
// @auto:plugin/today/material-arrival-store.spec.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_MATERIAL_ARRIVALS,
  MATERIAL_ARRIVAL_STORAGE_KEY,
  ObsidianMaterialArrivalStore,
} from '../../src/today/material-arrival-store.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

describe('ObsidianMaterialArrivalStore', () => {
  it('load returns the empty state for a fresh install', async () => {
    const store = new ObsidianMaterialArrivalStore(new FakeDataHost());
    expect(await store.load()).toEqual(EMPTY_MATERIAL_ARRIVALS);
  });

  it('records and reads back one course', async () => {
    const store = new ObsidianMaterialArrivalStore(new FakeDataHost());
    await store.recordArrival('GEO101', '2026-08-10');
    expect(await store.load()).toEqual({
      version: 1,
      lastArrivalByCourse: { GEO101: '2026-08-10' },
    });
  });

  it('recording a later arrival advances the recorded day', async () => {
    const store = new ObsidianMaterialArrivalStore(new FakeDataHost());
    await store.recordArrival('GEO101', '2026-08-01');
    await store.recordArrival('GEO101', '2026-08-10');
    const loaded = await store.load();
    expect(loaded.lastArrivalByCourse.GEO101).toBe('2026-08-10');
  });

  it('never regresses a course to an earlier day (out-of-order events)', async () => {
    const store = new ObsidianMaterialArrivalStore(new FakeDataHost());
    await store.recordArrival('GEO101', '2026-08-10');
    await store.recordArrival('GEO101', '2026-08-01');
    const loaded = await store.load();
    expect(loaded.lastArrivalByCourse.GEO101).toBe('2026-08-10');
  });

  it('recording the same day again is a no-op, not an error', async () => {
    const store = new ObsidianMaterialArrivalStore(new FakeDataHost());
    await store.recordArrival('GEO101', '2026-08-10');
    await store.recordArrival('GEO101', '2026-08-10');
    const loaded = await store.load();
    expect(loaded.lastArrivalByCourse.GEO101).toBe('2026-08-10');
  });

  it('tracks courses independently, never clobbering one when the other is written', async () => {
    const store = new ObsidianMaterialArrivalStore(new FakeDataHost());
    await store.recordArrival('GEO101', '2026-08-05');
    await store.recordArrival('MUS101', '2026-08-10');
    expect(await store.load()).toEqual({
      version: 1,
      lastArrivalByCourse: { GEO101: '2026-08-05', MUS101: '2026-08-10' },
    });
  });

  it('namespaces under its own top-level key, never clobbering the rest of data.json', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginKey: { untouched: true } };
    const store = new ObsidianMaterialArrivalStore(host);
    await store.recordArrival('GEO101', '2026-08-10');
    expect(host.blob.someOtherPluginKey).toEqual({ untouched: true });
    expect(host.blob[MATERIAL_ARRIVAL_STORAGE_KEY]).toBeDefined();
  });

  it('treats a corrupted entry as the empty state rather than throwing', async () => {
    const host = new FakeDataHost();
    host.blob = { [MATERIAL_ARRIVAL_STORAGE_KEY]: { garbage: true } };
    const store = new ObsidianMaterialArrivalStore(host);
    expect(await store.load()).toEqual(EMPTY_MATERIAL_ARRIVALS);
  });
});
