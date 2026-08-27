// Scenarios: `features/F6-today.md`, "F6.9 — rhythm reading data plumbing" —
// @auto:plugin/today/term-window-store.spec.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_TERM_WINDOW,
  ObsidianTermWindowStore,
  TERM_WINDOW_STORAGE_KEY,
} from '../../src/today/term-window-store.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

describe('ObsidianTermWindowStore', () => {
  it('load returns null for a fresh install — F6.9 never blocks on this', async () => {
    const store = new ObsidianTermWindowStore(new FakeDataHost());
    expect(await store.load()).toBeNull();
  });

  it('round-trips a saved window', async () => {
    const store = new ObsidianTermWindowStore(new FakeDataHost());
    await store.save({ start: '2026-08-01', end: '2026-12-15' });
    expect(await store.load()).toEqual({ start: '2026-08-01', end: '2026-12-15' });
  });

  it('namespaces under its own top-level key, never clobbering the rest of data.json', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginKey: { untouched: true } };
    const store = new ObsidianTermWindowStore(host);
    await store.save({ start: '2026-08-01', end: '2026-12-15' });
    expect(host.blob.someOtherPluginKey).toEqual({ untouched: true });
    expect(host.blob[TERM_WINDOW_STORAGE_KEY]).toBeDefined();
  });

  it('a half-recorded pair (one bound missing) resolves to null, never a one-sided window', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [TERM_WINDOW_STORAGE_KEY]: { version: 1, start: '2026-08-01', end: null },
    };
    const store = new ObsidianTermWindowStore(host);
    expect(await store.load()).toBeNull();
  });

  it('treats a corrupted entry as the empty state rather than throwing', async () => {
    const host = new FakeDataHost();
    host.blob = { [TERM_WINDOW_STORAGE_KEY]: { garbage: true } };
    const store = new ObsidianTermWindowStore(host);
    expect(await store.load()).toBeNull();
  });

  it('EMPTY_TERM_WINDOW is the persisted shape a fresh install starts in', () => {
    expect(EMPTY_TERM_WINDOW).toEqual({ version: 1, start: null, end: null });
  });
});
