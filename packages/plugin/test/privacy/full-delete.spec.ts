/**
 * `runFullDelete` tests (F7.4, `ol-p6t01`) — the orchestration of the three
 * purges the bead's acceptance criterion names: "delete purges cache,
 * server config record, and vault artifacts on request." See
 * `features/F7-plugin-surface.md` for the scenarios this asserts
 * (`plugin/privacy/full-delete.spec`).
 */

import type { CalendarDay } from 'olea-core';
import { isValidDeviceId, misconceptionLogPath, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { DEVICE_ID_STORAGE_KEY } from '../../src/device/device-id.js';
import { runFullDelete } from '../../src/privacy/full-delete.js';
import type { DeleteHttpRequestFn } from '../../src/privacy/types.js';
import { FakeDataHost, MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';

describe('runFullDelete (F7.4, ol-p6t01)', () => {
  it('purges the cache, the vault artifacts, and calls the server delete route, all three', async () => {
    const dataHost = new FakeDataHost();
    dataHost.blob = { keywordIndex: { some: 'index' } };
    const vault = new MemoryVaultSource({
      [reviewLogPath(TODAY, DEVICE_ID)]: '{"kind":"review"}\n',
      [misconceptionLogPath(TODAY, DEVICE_ID)]: '{"kind":"observed"}\n',
    });
    let deleteCalled = false;
    const httpRequest: DeleteHttpRequestFn = async () => {
      deleteCalled = true;
      return { status: 200 };
    };

    const result = await runFullDelete({
      dataHost,
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      workerConfig: { baseUrl: 'https://olea.example.workers.dev', token: 'a-token' },
      httpRequest,
    });

    expect(result.cache.clearedDataJsonKeys).toEqual(['keywordIndex']);
    expect(result.vaultArtifacts.deletedReviewLogPaths).toHaveLength(1);
    expect(result.vaultArtifacts.deletedMisconceptionLogPaths).toHaveLength(1);
    expect(result.serverConfig).toEqual({ outcome: 'deleted' });
    expect(deleteCalled).toBe(true);
    expect(vault.paths()).toEqual([]);
  });

  it('skips the server call, honestly, when the Worker was never configured — never a fabricated success', async () => {
    const dataHost = new FakeDataHost();
    const vault = new MemoryVaultSource();
    let deleteCalled = false;
    const httpRequest: DeleteHttpRequestFn = async () => {
      deleteCalled = true;
      return { status: 200 };
    };

    const result = await runFullDelete({
      dataHost,
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      workerConfig: { baseUrl: '', token: '' },
      httpRequest,
    });

    expect(result.serverConfig).toEqual({ outcome: 'not-configured' });
    expect(deleteCalled).toBe(false);
  });

  it('still purges the local cache and vault artifacts even when the server call is unreachable', async () => {
    const dataHost = new FakeDataHost();
    dataHost.blob = { keywordIndex: { some: 'index' } };
    const vault = new MemoryVaultSource({
      [reviewLogPath(TODAY, DEVICE_ID)]: '{"kind":"review"}\n',
    });
    const httpRequest: DeleteHttpRequestFn = async () => {
      throw new Error('network down');
    };

    const result = await runFullDelete({
      dataHost,
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      workerConfig: { baseUrl: 'https://olea.example.workers.dev', token: 'a-token' },
      httpRequest,
    });

    expect(result.serverConfig).toEqual({ outcome: 'unreachable' });
    expect(result.cache.clearedDataJsonKeys).toEqual(['keywordIndex']);
    expect(result.vaultArtifacts.deletedReviewLogPaths).toHaveLength(1);
  });

  it('never touches an instrument-bearing note, even in a full delete', async () => {
    const dataHost = new FakeDataHost();
    const vault = new MemoryVaultSource({
      '01 Courses/SYN101/Lecture 1.md': 'What is X?::X is Y.\n',
    });
    const httpRequest: DeleteHttpRequestFn = async () => ({ status: 200 });

    await runFullDelete({
      dataHost,
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      workerConfig: { baseUrl: '', token: '' },
      httpRequest,
    });

    expect(vault.raw('01 Courses/SYN101/Lecture 1.md')).toBe('What is X?::X is Y.\n');
  });

  it('mints and persists a fresh device id (ol-1ttf, ruled by ol-ppxj.16) — full delete does not preserve identity', async () => {
    const dataHost = new FakeDataHost();
    dataHost.blob = { [DEVICE_ID_STORAGE_KEY]: DEVICE_ID };
    const vault = new MemoryVaultSource();
    const httpRequest: DeleteHttpRequestFn = async () => ({ status: 200 });

    const result = await runFullDelete({
      dataHost,
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      workerConfig: { baseUrl: '', token: '' },
      httpRequest,
    });

    expect(isValidDeviceId(result.newDeviceId)).toBe(true);
    expect(result.newDeviceId).not.toBe(DEVICE_ID);
    expect((dataHost.blob as Record<string, unknown>)[DEVICE_ID_STORAGE_KEY]).toBe(
      result.newDeviceId,
    );
  });

  it('resets the device id AFTER discovering this installs own logs by the OLD id — the reset never blinds the vault-artifact purge to its own files', async () => {
    // A host that refuses to list a dot-prefixed folder (log-discovery.ts's
    // documented, common case — most real Obsidian hosts): this device's own
    // log is then found ONLY by exact-path probing against `deviceId`. If
    // `resetDeviceId` ran before this probe, the probe would look for a file
    // named by the NEW id — which was never written — and this device's own
    // log would wrongly survive the delete.
    class NoListingVaultSource extends MemoryVaultSource {
      override async list(): Promise<readonly never[]> {
        throw new Error('this host refuses to list a dot-prefixed folder');
      }
    }
    const dataHost = new FakeDataHost();
    dataHost.blob = { [DEVICE_ID_STORAGE_KEY]: DEVICE_ID };
    const vault = new NoListingVaultSource({
      [reviewLogPath(TODAY, DEVICE_ID)]: '{"kind":"review"}\n',
    });
    const httpRequest: DeleteHttpRequestFn = async () => ({ status: 200 });

    const result = await runFullDelete({
      dataHost,
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      workerConfig: { baseUrl: '', token: '' },
      httpRequest,
    });

    expect(result.vaultArtifacts.deletedReviewLogPaths).toContain(reviewLogPath(TODAY, DEVICE_ID));
    expect(vault.exists(reviewLogPath(TODAY, DEVICE_ID))).resolves.toBe(false);
    expect(result.newDeviceId).not.toBe(DEVICE_ID);
    // C5.2: the reset itself never touches the vault — any log file it does
    // NOT find (a different device's, or one outside the probe window) is
    // simply left exactly as it was; the new id just never names it.
  });
});
