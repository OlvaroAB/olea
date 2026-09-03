/**
 * `simulator/device-id.ts` + `simulator/plugin-data-host.ts` (`ol-3ux7.64.2`
 * [WBX-1]) — F9.S2's reset scenario depends on two properties: the id is
 * stable across reloads (a fresh `ObsidianDataHost` over the same store
 * returns the SAME id) and a full reset mints a fresh one (an empty store
 * returns a DIFFERENT id).
 */

import { isValidDeviceId } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ensureSimulatorDeviceId } from '../src/simulator/device-id.js';
import { createPluginDataHost } from '../src/simulator/plugin-data-host.js';
import { createMemoryStore } from '../src/simulator/store.js';

describe('ensureSimulatorDeviceId', () => {
  it('mints a valid device id on first use', async () => {
    const host = createPluginDataHost(createMemoryStore());
    const id = await ensureSimulatorDeviceId(host);
    expect(isValidDeviceId(id)).toBe(true);
  });

  it('is idempotent — a second call over the same host returns the same id', async () => {
    const host = createPluginDataHost(createMemoryStore());
    const first = await ensureSimulatorDeviceId(host);
    const second = await ensureSimulatorDeviceId(host);
    expect(second).toBe(first);
  });

  it('a fresh host over the SAME store returns the SAME id — reload behaviour', async () => {
    const store = createMemoryStore();
    const first = await ensureSimulatorDeviceId(createPluginDataHost(store));
    const second = await ensureSimulatorDeviceId(createPluginDataHost(store));
    expect(second).toBe(first);
  });

  it('a store cleared by resetAll mints a FRESH id on the next mount', async () => {
    const store = createMemoryStore();
    const first = await ensureSimulatorDeviceId(createPluginDataHost(store));

    await store.resetAll();

    const second = await ensureSimulatorDeviceId(createPluginDataHost(store));
    expect(second).not.toBe(first);
  });

  it('preserves an unrelated top-level key already in the plugin data blob', async () => {
    const store = createMemoryStore();
    await store.savePluginData({ someOtherFeature: 'keep-me' });

    await ensureSimulatorDeviceId(createPluginDataHost(store));

    const blob = (await store.loadPluginData()) as Record<string, unknown>;
    expect(blob.someOtherFeature).toBe('keep-me');
  });
});
