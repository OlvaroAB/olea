import { EMPTY_REGISTRY_OVERRIDES, pruneConcept, renameConcept } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type ObsidianDataHost,
  ObsidianRegistryOverridesStore,
  REGISTRY_OVERRIDES_STORAGE_KEY,
} from '../../src/registry/overrides-store.js';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

describe('ObsidianRegistryOverridesStore', () => {
  it('returns EMPTY_REGISTRY_OVERRIDES when nothing is stored', async () => {
    const store = new ObsidianRegistryOverridesStore(new FakeDataHost());
    expect(await store.load()).toEqual(EMPTY_REGISTRY_OVERRIDES);
  });

  it('round-trips a rename and a prune', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianRegistryOverridesStore(host);

    const renamed = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'concept-a', 'Concept A', 'Renamed A');
    const pruned = pruneConcept(renamed, 'concept-b');
    await store.save(pruned);

    const reloaded = await store.load();
    expect(reloaded).toEqual(pruned);
  });

  it('never touches any other key already in data.json (read-modify-write)', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'kept' };
    const store = new ObsidianRegistryOverridesStore(host);

    await store.save(pruneConcept(EMPTY_REGISTRY_OVERRIDES, 'concept-a'));

    expect(host.blob).toMatchObject({ someOtherPluginSetting: 'kept' });
    expect((host.blob as Record<string, unknown>)[REGISTRY_OVERRIDES_STORAGE_KEY]).toBeDefined();
  });

  it('falls back to EMPTY_REGISTRY_OVERRIDES for a malformed stored value, never throws', async () => {
    const host = new FakeDataHost();
    host.blob = { [REGISTRY_OVERRIDES_STORAGE_KEY]: { version: 2, garbage: true } };
    const store = new ObsidianRegistryOverridesStore(host);
    expect(await store.load()).toEqual(EMPTY_REGISTRY_OVERRIDES);
  });
});
