/**
 * `data-manifest.ts` behaviour (`ol-egov.141.8.11`, ruled by `[D-393]`): a full delete clears every
 * content-derived settings key and every unlisted one, keeps configuration and safety state,
 * replaces the device id, and leaves no pending job behind; the export carries exactly the
 * content-derived keys and never the Worker token. Every listed key is exercised, so a key added
 * to the manifest is covered here without a new test. `data-manifest-coverage.spec.ts` is the
 * guard that every key in the source tree is listed.
 */

import type { CalendarDay } from 'olea-core';
import { reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ContestRegradeQueueStore } from '../../src/contest-regrade/queue-store.js';
import { DEVICE_ID_STORAGE_KEY } from '../../src/device/device-id.js';
import { ObsidianQueueStore } from '../../src/ingestion/queue-store.js';
import { CACHE_DATA_JSON_KEYS } from '../../src/privacy/cache-purge.js';
import {
  CONTENT_DERIVED_SETTINGS_KEYS,
  clearContentDerivedSettings,
  KEPT_SETTINGS_KEYS,
  SETTINGS_KEY_MANIFEST,
  settingsKeyEntry,
} from '../../src/privacy/data-manifest.js';
import { buildPrivacyExportBundle } from '../../src/privacy/export-bundle.js';
import { runFullDelete } from '../../src/privacy/full-delete.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import { FakeDataHost, MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';
const SYNTHETIC_TOKEN = 'synthetic-worker-token-7f3a';
const SYNTHETIC_BASE_URL = 'https://olea.example.workers.dev';
const UNLISTED_KEY = 'syntheticLegacyKey';

/** A settings file holding a distinct synthetic value under every listed key, plus one unlisted key. */
function fullSettingsBlob(): Record<string, unknown> {
  const blob: Record<string, unknown> = {};
  for (const { key } of SETTINGS_KEY_MANIFEST) blob[key] = { synthetic: key };
  blob[WORKER_CONFIG_STORAGE_KEY] = {
    version: 1,
    baseUrl: SYNTHETIC_BASE_URL,
    token: SYNTHETIC_TOKEN,
  };
  blob[DEVICE_ID_STORAGE_KEY] = DEVICE_ID;
  blob[UNLISTED_KEY] = { synthetic: 'unlisted' };
  return blob;
}

async function fullDelete(dataHost: FakeDataHost, vault = new MemoryVaultSource()) {
  return runFullDelete({
    dataHost,
    vault,
    deviceId: DEVICE_ID,
    today: TODAY,
    workerConfig: { baseUrl: '', token: '' },
    httpRequest: async () => ({ status: 200 }),
  });
}

describe('the settings manifest (ol-egov.141.8.11, D-393)', () => {
  it('classifies the Worker connection as credential-bearing configuration, never content-derived', () => {
    expect(settingsKeyEntry(WORKER_CONFIG_STORAGE_KEY)).toMatchObject({
      classification: 'configuration',
      credential: true,
    });
    for (const entry of SETTINGS_KEY_MANIFEST) {
      if (entry.credential === true) expect(entry.classification).toBe('configuration');
    }
  });

  it('keeps the explain-back audit gate as safety state', () => {
    expect(settingsKeyEntry('explainBackAuditGate')?.classification).toBe('safety');
  });

  it('classifies pending work as content-derived: both job queues', () => {
    expect(CONTENT_DERIVED_SETTINGS_KEYS).toContain('ingestionQueue');
    expect(CONTENT_DERIVED_SETTINGS_KEYS).toContain('contestRegradeQueue');
  });

  it('classifies each of the five cache-purge keys as content-derived, so the purge never clears a kept key', () => {
    for (const key of CACHE_DATA_JSON_KEYS) {
      expect(settingsKeyEntry(key)?.classification).toBe('content-derived');
    }
  });
});

describe('runFullDelete over the settings file (ol-egov.141.8.11, D-393)', () => {
  it('clears every content-derived key and every unlisted key, and keeps configuration and safety state unchanged', async () => {
    const dataHost = new FakeDataHost();
    const before = fullSettingsBlob();
    dataHost.blob = structuredClone(before);

    const result = await fullDelete(dataHost);
    const after = dataHost.blob as Record<string, unknown>;

    for (const key of CONTENT_DERIVED_SETTINGS_KEYS) expect(after).not.toHaveProperty(key);
    expect(after).not.toHaveProperty(UNLISTED_KEY);
    for (const key of KEPT_SETTINGS_KEYS) expect(after[key]).toEqual(before[key]);
    expect(after[WORKER_CONFIG_STORAGE_KEY]).toEqual({
      version: 1,
      baseUrl: SYNTHETIC_BASE_URL,
      token: SYNTHETIC_TOKEN,
    });
    // The five cache keys go in the cache-purge step, every other content-derived key in the
    // settings step: together, every one of them, once.
    expect([...result.cache.clearedDataJsonKeys, ...result.settings.clearedKeys].sort()).toEqual(
      CONTENT_DERIVED_SETTINGS_KEYS.slice().sort(),
    );
    expect(result.settings.clearedUnlistedKeys).toEqual([UNLISTED_KEY]);
  });

  it('leaves exactly the kept keys plus a fresh device id, and no Olea folder', async () => {
    const dataHost = new FakeDataHost();
    dataHost.blob = fullSettingsBlob();
    const vault = new MemoryVaultSource({
      [reviewLogPath(TODAY, DEVICE_ID)]: '{"kind":"review"}\n',
      '.olea/concepts/concept-key1-synthetic.json': '{"synthetic":true}\n',
      '01 Courses/SYN101/Lecture 1.md': 'What is X?::X is Y.\n',
    });

    const result = await fullDelete(dataHost, vault);
    const after = dataHost.blob as Record<string, unknown>;

    expect(Object.keys(after).sort()).toEqual(
      [...KEPT_SETTINGS_KEYS, DEVICE_ID_STORAGE_KEY].sort(),
    );
    expect(after[DEVICE_ID_STORAGE_KEY]).toBe(result.newDeviceId);
    expect(result.newDeviceId).not.toBe(DEVICE_ID);
    expect(vault.paths()).toEqual(['01 Courses/SYN101/Lecture 1.md']);
    expect(result.remainingOleaPaths).toEqual([]);
  });

  it('leaves no pending job for the next tick to drain: a queue store built after the delete finds nothing', async () => {
    const dataHost = new FakeDataHost();
    const queue = { version: 1, jobs: [{ id: 'synthetic-job', kind: 'synthetic' }] };
    dataHost.blob = { ingestionQueue: queue, contestRegradeQueue: queue };
    expect(await new ObsidianQueueStore(dataHost).load()).not.toBeNull();
    expect(await new ContestRegradeQueueStore(dataHost).load()).not.toBeNull();

    await fullDelete(dataHost);

    expect(await new ObsidianQueueStore(dataHost).load()).toBeNull();
    expect(await new ContestRegradeQueueStore(dataHost).load()).toBeNull();
  });

  it('clears in one atomic read-modify-write when the host offers one, so a sibling write racing it is neither lost nor able to restore a cleared key', async () => {
    const log: string[] = [];
    let blob: unknown = fullSettingsBlob();
    const host = {
      loadData: async () => blob,
      saveData: async (data: unknown) => {
        log.push('saveData');
        blob = data;
      },
      readModifyWrite: async (mutate: (current: unknown) => unknown) => {
        log.push('readModifyWrite');
        blob = await mutate(blob);
      },
    };

    const result = await clearContentDerivedSettings(host);

    expect(log).toEqual(['readModifyWrite']);
    expect(result.clearedKeys.length).toBe(CONTENT_DERIVED_SETTINGS_KEYS.length);
    for (const key of CONTENT_DERIVED_SETTINGS_KEYS) expect(blob).not.toHaveProperty(key);
  });

  it('is a safe no-op on an empty or absent settings file', async () => {
    const dataHost = new FakeDataHost();
    const result = await clearContentDerivedSettings(dataHost);
    expect(result).toEqual({ clearedKeys: [], clearedUnlistedKeys: [] });
    expect(dataHost.blob).toEqual({});
  });
});

describe('buildPrivacyExportBundle over the settings file (ol-egov.141.8.11, D-393)', () => {
  it('carries every content-derived key with its value, and nothing else from the settings file', async () => {
    const dataHost = new FakeDataHost();
    const blob = fullSettingsBlob();
    dataHost.blob = blob;

    const bundle = await buildPrivacyExportBundle({
      vault: new MemoryVaultSource(),
      deviceId: DEVICE_ID,
      today: TODAY,
      dataHost,
      now: () => '2026-08-25T12:00:00.000Z',
    });

    expect(bundle.settings).not.toBeNull();
    expect(Object.keys(bundle.settings ?? {}).sort()).toEqual(
      CONTENT_DERIVED_SETTINGS_KEYS.slice().sort(),
    );
    for (const key of CONTENT_DERIVED_SETTINGS_KEYS) {
      expect(bundle.settings?.[key]).toEqual(blob[key]);
    }
  });

  it('never carries the Worker token, anywhere in the saved file', async () => {
    const dataHost = new FakeDataHost();
    dataHost.blob = fullSettingsBlob();

    const bundle = await buildPrivacyExportBundle({
      vault: new MemoryVaultSource(),
      deviceId: DEVICE_ID,
      today: TODAY,
      dataHost,
    });
    const saved = JSON.stringify(bundle, null, 2);

    expect(saved).not.toContain(SYNTHETIC_TOKEN);
    expect(saved).not.toContain(WORKER_CONFIG_STORAGE_KEY);
    expect(saved).not.toContain(UNLISTED_KEY);
  });

  it('exports what the delete clears: the same list, key for key', async () => {
    const exportHost = new FakeDataHost();
    exportHost.blob = fullSettingsBlob();
    const bundle = await buildPrivacyExportBundle({
      vault: new MemoryVaultSource(),
      deviceId: DEVICE_ID,
      today: TODAY,
      dataHost: exportHost,
    });

    const deleteHost = new FakeDataHost();
    deleteHost.blob = fullSettingsBlob();
    const result = await fullDelete(deleteHost);

    expect(Object.keys(bundle.settings ?? {}).sort()).toEqual(
      [...result.cache.clearedDataJsonKeys, ...result.settings.clearedKeys].sort(),
    );
  });

  it('carries settings: null when no settings host is passed, rather than an empty object that would read as "nothing stored"', async () => {
    const bundle = await buildPrivacyExportBundle({
      vault: new MemoryVaultSource(),
      deviceId: DEVICE_ID,
      today: TODAY,
    });
    expect(bundle.settings).toBeNull();
  });
});
