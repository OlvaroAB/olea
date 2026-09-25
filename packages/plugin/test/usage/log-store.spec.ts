/**
 * `log-store.ts` tests (F7.3, `ol-p3t09`, extended `ol-egov.141.89.10.50`).
 * Follows the same fake-host pattern `worker/config-store.spec.ts` uses for
 * `ObsidianWorkerConfigStore` — a plain in-memory object standing in for
 * Obsidian's `loadData`/`saveData`, so this runs under plain Vitest with no
 * real Obsidian host.
 */
import { describe, expect, it } from 'vitest';
import {
  type ObsidianDataHost,
  ObsidianUsageLogStore,
  USAGE_LOG_MAX_ENTRIES,
  USAGE_LOG_STORAGE_KEY,
} from '../../src/usage/log-store.js';
import { buildFailedUsageLogEntry, type UsageLogEntry } from '../../src/usage/types.js';

function fakeHost(initial: Record<string, unknown> = {}): ObsidianDataHost {
  let blob: Record<string, unknown> = { ...initial };
  return {
    loadData: async () => blob,
    saveData: async (data: unknown) => {
      blob = data as Record<string, unknown>;
    },
  };
}

function entry(recordedAt: string): UsageLogEntry {
  return { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'model-a', recordedAt };
}

describe('ObsidianUsageLogStore', () => {
  it('loads an empty array when nothing is persisted yet', async () => {
    const store = new ObsidianUsageLogStore(fakeHost());
    expect(await store.load()).toEqual([]);
  });

  it('loads an empty array when the blob is corrupted, rather than throwing', async () => {
    const store = new ObsidianUsageLogStore(fakeHost({ [USAGE_LOG_STORAGE_KEY]: 'not an object' }));
    expect(await store.load()).toEqual([]);
  });

  it('round-trips a recorded entry', async () => {
    const store = new ObsidianUsageLogStore(fakeHost());
    await store.record(entry('2026-08-01T00:00:00.000Z'));
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.taskId).toBe('quiz.generate.v1');
  });

  it('never clobbers sibling keys already in the blob', async () => {
    const host = fakeHost({ deviceId: 'abc-123', keywordIndex: { some: 'value' } });
    const store = new ObsidianUsageLogStore(host);
    await store.record(entry('2026-08-01T00:00:00.000Z'));
    const blob = (await host.loadData()) as Record<string, unknown>;
    expect(blob.deviceId).toBe('abc-123');
    expect(blob.keywordIndex).toEqual({ some: 'value' });
  });

  it('caps the log: the oldest entry is dropped once the cap is reached, the newest is kept', async () => {
    const host = fakeHost();
    const store = new ObsidianUsageLogStore(host);
    for (let i = 0; i < USAGE_LOG_MAX_ENTRIES; i++) {
      await store.record(entry(`2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`));
    }
    await store.record(entry('2026-12-31T23:59:59.000Z'));

    const loaded = await store.load();
    expect(loaded).toHaveLength(USAGE_LOG_MAX_ENTRIES);
    expect(loaded[loaded.length - 1]?.recordedAt).toBe('2026-12-31T23:59:59.000Z');
  });

  describe('a failed call (ol-egov.141.89.10.50)', () => {
    it('round-trips a failed-call row exactly like a successful one', async () => {
      const store = new ObsidianUsageLogStore(fakeHost());
      const failed = buildFailedUsageLogEntry(
        { taskId: 'quiz.generate.v1', errorCode: 'upstream_timeout' },
        '2026-09-25T00:00:00.000Z',
      );
      await store.record(failed);
      const loaded = await store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(failed);
    });

    it('a mixed log keeps a failed row and a successful row distinct on read', async () => {
      const store = new ObsidianUsageLogStore(fakeHost());
      await store.record(entry('2026-09-25T00:00:00.000Z'));
      await store.record(
        buildFailedUsageLogEntry(
          { taskId: 'quiz.generate.v1', errorCode: 'upstream_timeout' },
          '2026-09-25T00:01:00.000Z',
        ),
      );
      const loaded = await store.load();
      expect(loaded).toHaveLength(2);
      expect(loaded[0]?.outcome).toBeUndefined();
      expect(loaded[1]?.outcome).toBe('failed');
    });

    it('a data.json holding a corrupted failed-row shape (smuggled promptVersion) loads as empty, not as a fabricated success row', async () => {
      const host = fakeHost({
        [USAGE_LOG_STORAGE_KEY]: {
          version: 1,
          entries: [
            {
              taskId: 'quiz.generate.v1',
              recordedAt: '2026-09-25T00:00:00.000Z',
              outcome: 'failed',
              promptVersion: '1.0.0', // never legitimate on a failed row
            },
          ],
        },
      });
      const store = new ObsidianUsageLogStore(host);
      expect(await store.load()).toEqual([]);
    });
  });
});
