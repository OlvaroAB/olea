// Scenarios: `features/F6-today.md`, "F6.9 — rhythm reading data plumbing"
// and `features/F7-plugin-surface.md`, "F7.2 — term dates ask-once-or-
// dismissed ([D-147])" — @auto:plugin/today/term-window-store.spec.

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
    expect(EMPTY_TERM_WINDOW).toEqual({ version: 2, start: null, end: null, skipped: false });
  });

  describe('askState ([D-147])', () => {
    it('is unanswered on a fresh install', async () => {
      const store = new ObsidianTermWindowStore(new FakeDataHost());
      expect(await store.askState()).toBe('unanswered');
    });

    it('is answered once both bounds are saved', async () => {
      const store = new ObsidianTermWindowStore(new FakeDataHost());
      await store.save({ start: '2026-08-01', end: '2026-12-15' });
      expect(await store.askState()).toBe('answered');
    });

    it('is skipped after an explicit skip, and load() still reads null — no default term length is ever invented', async () => {
      const store = new ObsidianTermWindowStore(new FakeDataHost());
      await store.skip();
      expect(await store.askState()).toBe('skipped');
      expect(await store.load()).toBeNull();
    });

    it('skipping twice is the same state as skipping once', async () => {
      const store = new ObsidianTermWindowStore(new FakeDataHost());
      await store.skip();
      await store.skip();
      expect(await store.askState()).toBe('skipped');
    });

    it('a value saved after a skip reads as answered, not skipped — filling the fields in later always wins', async () => {
      const store = new ObsidianTermWindowStore(new FakeDataHost());
      await store.skip();
      await store.save({ start: '2026-08-01', end: '2026-12-15' });
      expect(await store.askState()).toBe('answered');
    });

    it('clear() reverts a saved window to unanswered, never to skipped', async () => {
      const store = new ObsidianTermWindowStore(new FakeDataHost());
      await store.save({ start: '2026-08-01', end: '2026-12-15' });
      await store.clear();
      expect(await store.askState()).toBe('unanswered');
      expect(await store.load()).toBeNull();
    });

    it('a pre-[D-147] version-1 record with no dates migrates to unanswered, never skipped', async () => {
      const host = new FakeDataHost();
      host.blob = { [TERM_WINDOW_STORAGE_KEY]: { version: 1, start: null, end: null } };
      const store = new ObsidianTermWindowStore(host);
      expect(await store.askState()).toBe('unanswered');
    });

    it('a pre-[D-147] version-1 record with both dates migrates to answered', async () => {
      const host = new FakeDataHost();
      host.blob = {
        [TERM_WINDOW_STORAGE_KEY]: { version: 1, start: '2026-08-01', end: '2026-12-15' },
      };
      const store = new ObsidianTermWindowStore(host);
      expect(await store.askState()).toBe('answered');
    });

    it('a corrupted entry reads as unanswered, never skipped', async () => {
      const host = new FakeDataHost();
      host.blob = { [TERM_WINDOW_STORAGE_KEY]: { garbage: true } };
      const store = new ObsidianTermWindowStore(host);
      expect(await store.askState()).toBe('unanswered');
    });
  });
});
