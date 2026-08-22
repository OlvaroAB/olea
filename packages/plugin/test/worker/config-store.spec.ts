/**
 * `ObsidianWorkerConfigStore` tests. Runs against a fake `ObsidianDataHost`
 * — this file never imports `obsidian` itself, same convention as
 * `test/ingestion/queue-store.spec.ts`.
 *
 * Scenario: `features/F7-plugin-surface.md`, "F7.1 — the Worker base URL
 * and token persist under their own key" — @auto:plugin/worker/config-store.spec.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORKER_CONFIG,
  isWorkerConfigured,
  type ObsidianDataHost,
  ObsidianWorkerConfigStore,
  type PersistedWorkerConfig,
  WORKER_CONFIG_STORAGE_KEY,
} from '../../src/worker/config-store.js';

/** Stands in for a real `Plugin`'s `loadData`/`saveData`, backed by an in-memory blob exactly as Obsidian persists one `data.json` per plugin. */
class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const sampleConfig: PersistedWorkerConfig = {
  version: 1,
  baseUrl: 'https://olea-service-staging.example.workers.dev',
  token: 'a-pasted-token',
};

describe('ObsidianWorkerConfigStore.load', () => {
  it('returns EMPTY_WORKER_CONFIG when nothing has ever been saved', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianWorkerConfigStore(host);
    expect(await store.load()).toEqual(EMPTY_WORKER_CONFIG);
  });

  it('returns EMPTY_WORKER_CONFIG when data.json holds an object but no workerConfig key yet', async () => {
    const host = new FakeDataHost();
    host.blob = { deviceId: 'olea-abc123' };
    const store = new ObsidianWorkerConfigStore(host);
    expect(await store.load()).toEqual(EMPTY_WORKER_CONFIG);
  });

  it('returns EMPTY_WORKER_CONFIG (not a throw) when the stored value is malformed', async () => {
    const host = new FakeDataHost();
    host.blob = { [WORKER_CONFIG_STORAGE_KEY]: { baseUrl: 42, version: 1 } };
    const store = new ObsidianWorkerConfigStore(host);
    expect(await store.load()).toEqual(EMPTY_WORKER_CONFIG);
  });

  it('round-trips a config saved by this same store', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianWorkerConfigStore(host);
    await store.save(sampleConfig);
    expect(await store.load()).toEqual(sampleConfig);
  });
});

describe('ObsidianWorkerConfigStore.save — namespacing inside the shared data.json blob', () => {
  it('writes under its own key without touching an empty/absent blob', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianWorkerConfigStore(host);
    await store.save(sampleConfig);
    expect(host.blob).toEqual({ [WORKER_CONFIG_STORAGE_KEY]: sampleConfig });
  });

  it('preserves unrelated keys already present in data.json — never clobbers another writer', async () => {
    const host = new FakeDataHost();
    host.blob = {
      deviceId: 'olea-abc123',
      ingestionQueue: { version: 1, jobs: [], headroom: null },
    };
    const store = new ObsidianWorkerConfigStore(host);
    await store.save(sampleConfig);
    expect(host.blob).toEqual({
      deviceId: 'olea-abc123',
      ingestionQueue: { version: 1, jobs: [], headroom: null },
      [WORKER_CONFIG_STORAGE_KEY]: sampleConfig,
    });
  });

  it('re-reads before writing, so a key written by another part of the plugin between two saves survives', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianWorkerConfigStore(host);
    await store.save(sampleConfig);

    host.blob = { ...(host.blob as Record<string, unknown>), otherFeature: 'value' };

    const updated: PersistedWorkerConfig = { ...sampleConfig, token: 'a-different-token' };
    await store.save(updated);

    expect(host.blob).toEqual({
      otherFeature: 'value',
      [WORKER_CONFIG_STORAGE_KEY]: updated,
    });
  });
});

describe('isWorkerConfigured', () => {
  it('is false when nothing is configured', () => {
    expect(isWorkerConfigured(EMPTY_WORKER_CONFIG)).toBe(false);
  });

  it('is false when only one of baseUrl/token is set', () => {
    expect(isWorkerConfigured({ version: 1, baseUrl: 'https://x', token: '' })).toBe(false);
    expect(isWorkerConfigured({ version: 1, baseUrl: '', token: 'tok' })).toBe(false);
  });

  it('is false for whitespace-only values', () => {
    expect(isWorkerConfigured({ version: 1, baseUrl: '   ', token: '  ' })).toBe(false);
  });

  it('is true once both are non-blank', () => {
    expect(isWorkerConfigured(sampleConfig)).toBe(true);
  });
});

describe('config-store.ts never logs — no console call exists in the source at all', () => {
  it('has zero `console.` occurrences', () => {
    const path = fileURLToPath(new URL('../../src/worker/config-store.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/console\./);
  });
});
