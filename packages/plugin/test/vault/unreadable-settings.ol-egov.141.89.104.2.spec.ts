/**
 * T12, plugin side (`ol-egov.141.89.104.2`): a settings file (`data.json`) that holds something
 * other than an object is never replaced. Every writer goes through the queued
 * `readModifyWrite`, and the queue refuses the write with a reported error, so the file's content
 * stays exactly as it was. An empty settings file (nothing stored yet) is not unreadable, and is
 * written as before. The moved-note same-as batch skips a pair whose record cannot be read and
 * proposes the rest. Every key and wording here is invented.
 */

import type { ConceptKeyRecord } from 'olea-core';
import { sameAsLinkRecordPath } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

// `../../src/privacy/settings-section.ts` imports `obsidian`, which has no runtime here; the full
// delete below needs none of it (the same stand-in `../privacy/settings-section.spec.ts` uses).
vi.mock('obsidian', () => ({
  Notice: class {},
  Setting: class {},
  requestUrl: () => Promise.reject(new Error('no network in this test')),
}));

import { proposeSameAsForMovedNoteAnchors } from '../../src/concept/wiring.js';
import { ensureDeviceId } from '../../src/device/device-id.js';
import { runFullDelete } from '../../src/privacy/full-delete.js';
import { FullDeleteWriteSeal } from '../../src/privacy/settings-section.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';
import { ObsidianWorkerConfigStore } from '../../src/worker/config-store.js';
import { FakeDataHost, MemoryVaultSource } from '../privacy/fakes.js';

const NON_OBJECTS: readonly [string, unknown][] = [
  ['an array', [1, 2, 3]],
  ['a string', 'not settings'],
  ['a number', 42],
  ['a boolean', true],
];

function hostOver(blob: unknown): { file: FakeDataHost; host: SerializingDataHost } {
  const file = new FakeDataHost();
  file.blob = blob;
  return { file, host: new SerializingDataHost(file) };
}

describe('T12: a settings file that is not an object is never replaced', () => {
  for (const [label, value] of NON_OBJECTS) {
    it(`${label}: a read-modify-write is refused and the file is unchanged`, async () => {
      const { file, host } = hostOver(value);
      const before = JSON.stringify(file.blob);
      await expect(
        host.readModifyWrite((current) => ({ ...(current as object), key: 1 })),
      ).rejects.toThrow();
      expect(JSON.stringify(file.blob)).toBe(before);
    });
  }

  it("a store's save is refused, and the file is unchanged", async () => {
    const { file, host } = hostOver([1, 2, 3]);
    await expect(
      new ObsidianWorkerConfigStore(host).save({
        version: 1,
        baseUrl: 'https://example.invalid',
        token: '',
      }),
    ).rejects.toThrow();
    expect(file.blob).toEqual([1, 2, 3]);
  });

  it('the device-id mint is refused rather than replacing the file', async () => {
    const { file, host } = hostOver('not settings');
    await expect(ensureDeviceId(host, () => 0.5)).rejects.toThrow();
    expect(file.blob).toBe('not settings');
  });

  it('an empty settings file is not unreadable: the first write lands as before', async () => {
    const { file, host } = hostOver(null);
    const id = await ensureDeviceId(host, () => 0.5);
    expect(file.blob).toEqual({ deviceId: id });
  });
});

describe('T12 and the full delete', () => {
  it('a full delete she asked for still replaces a settings file that is not an object', async () => {
    const file = new FakeDataHost();
    file.blob = [1, 2, 3];
    const sealed = await new FullDeleteWriteSeal(new SerializingDataHost(file)).seal();
    await runFullDelete({
      dataHost: sealed.dataHost,
      vault: new MemoryVaultSource(),
      deviceId: 'device-1',
      today: '2026-10-05',
      workerConfig: { baseUrl: '', token: '' },
      httpRequest: async () => ({ status: 200 }),
    });
    expect(Array.isArray(file.blob)).toBe(false);
    expect(typeof file.blob).toBe('object');
  });
});

describe('T12: the moved-note same-as batch', () => {
  it('skips a pair whose record cannot be read, keeps its bytes, and proposes the rest', async () => {
    const torn = '{"keyA":"concept-key1:a","keyB":"concept-key1:b","status":"conf';
    const unreadablePath = sameAsLinkRecordPath('concept-key1:a', 'concept-key1:b');
    const vault = new MemoryVaultSource({ [unreadablePath]: torn });
    const orphan = (key: string, notePath: string): { record: ConceptKeyRecord } => ({
      record: {
        key,
        tier: 1,
        anchor: { kind: 'note', noteUid: null, notePath },
        mintedAt: '2026-09-01',
        schemaVersion: 1,
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const proposed = await proposeSameAsForMovedNoteAnchors(
        vault,
        [
          { key: 'concept-key1:b', name: 'Widget' },
          { key: 'concept-key1:d', name: 'Gadget' },
        ],
        {
          records: [
            orphan('concept-key1:a', 'Old/Widget.md'),
            orphan('concept-key1:c', 'Old/Gadget.md'),
          ],
        },
      );
      expect(vault.raw(unreadablePath)).toBe(torn);
      expect(proposed.map((link) => [link.keyA, link.keyB])).toEqual([
        ['concept-key1:c', 'concept-key1:d'],
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
