/**
 * `deleteVaultArtifacts` tests (F7.4, `ol-p6t01`). See
 * `features/F7-plugin-surface.md` for the scenarios this asserts
 * (`plugin/privacy/vault-artifact-delete.spec`).
 */
import { type CalendarDay, misconceptionLogPath, reviewLogPath, shiftCalendarDay } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { deleteVaultArtifacts } from '../../src/privacy/vault-artifact-delete.js';
import { MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';

describe('deleteVaultArtifacts (F7.4, ol-p6t01)', () => {
  it("deletes this device's review-log and misconception-log files, found by exact path even when the host cannot list a dot-prefixed folder", async () => {
    const reviewPath = reviewLogPath(TODAY, DEVICE_ID);
    const misconceptionPath = misconceptionLogPath(TODAY, DEVICE_ID);
    const vault = new MemoryVaultSource({
      [reviewPath]: '{"kind":"review"}\n',
      [misconceptionPath]: '{"kind":"observed"}\n',
    });
    // Simulate a host that refuses to list a dot-prefixed folder at all.
    const originalList = vault.list.bind(vault);
    vault.list = async (options) => {
      if (options?.under?.startsWith('.olea/')) throw new Error('cannot list dot-prefixed folder');
      return originalList(options);
    };

    const result = await deleteVaultArtifacts({
      vault,
      vaultDelete: vault,
      deviceId: DEVICE_ID,
      today: TODAY,
    });

    expect(result.deletedReviewLogPaths).toEqual([reviewPath]);
    expect(result.deletedMisconceptionLogPaths).toEqual([misconceptionPath]);
    expect(vault.paths()).toEqual([]);
  });

  it("finds another device's files via list() when the host does surface the folder", async () => {
    const otherDeviceReview = reviewLogPath(TODAY, 'phone-device');
    const vault = new MemoryVaultSource({ [otherDeviceReview]: '{"kind":"review"}\n' });

    const result = await deleteVaultArtifacts({
      vault,
      vaultDelete: vault,
      // This device has never written anything — the other device's file is
      // still found and deleted, because the host's list() surfaces it.
      deviceId: 'this-device-never-wrote-anything',
      today: TODAY,
    });

    expect(result.deletedReviewLogPaths).toEqual([otherDeviceReview]);
    expect(vault.paths()).toEqual([]);
  });

  it("never touches .olea/drafts/ — that is cache-purge.ts's job, not a vault-artifact removal", async () => {
    const vault = new MemoryVaultSource({
      '.olea/drafts/index.json': '{"version":1,"entries":[]}',
      '.olea/drafts/d1.json': '{}',
    });

    await deleteVaultArtifacts({ vault, vaultDelete: vault, deviceId: DEVICE_ID, today: TODAY });

    expect(vault.paths()).toEqual(['.olea/drafts/d1.json', '.olea/drafts/index.json']);
  });

  it('never touches an instrument-bearing note — INV-6, only the two Olea-owned log folders are ever reached', async () => {
    const vault = new MemoryVaultSource({
      '01 Courses/SYN101/Lecture 1.md': '# Lecture 1\n\nQ: What is X?\nA: X is Y.\n',
    });

    await deleteVaultArtifacts({ vault, vaultDelete: vault, deviceId: DEVICE_ID, today: TODAY });

    expect(vault.raw('01 Courses/SYN101/Lecture 1.md')).toBeDefined();
  });

  it('reaches back multiple days within the probe window, not only today', async () => {
    const threeDaysAgo = shiftCalendarDay(TODAY, -3);
    const oldPath = reviewLogPath(threeDaysAgo, DEVICE_ID);
    const vault = new MemoryVaultSource({ [oldPath]: '{"kind":"review"}\n' });

    const result = await deleteVaultArtifacts({
      vault,
      vaultDelete: vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 10,
    });

    expect(result.deletedReviewLogPaths).toEqual([oldPath]);
  });

  it('a narrow probe window misses old history when the host cannot list the folder either — the disclosed, inherited discovery limitation', async () => {
    const longAgo = shiftCalendarDay(TODAY, -30);
    const oldPath = reviewLogPath(longAgo, DEVICE_ID);
    const vault = new MemoryVaultSource({ [oldPath]: '{"kind":"review"}\n' });
    // Without this, MemoryVaultSource.list() would find the file regardless
    // of the probe window — exactly as a real host that *does* support
    // listing a dot-prefixed folder would. The probe-window limit only ever
    // bites when listing also fails, which is the scenario this asserts.
    const originalList = vault.list.bind(vault);
    vault.list = async (options) => {
      if (options?.under?.startsWith('.olea/')) throw new Error('cannot list dot-prefixed folder');
      return originalList(options);
    };

    const result = await deleteVaultArtifacts({
      vault,
      vaultDelete: vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 5,
    });

    expect(result.deletedReviewLogPaths).toEqual([]);
    expect(vault.raw(oldPath)).toBeDefined();
  });
});
