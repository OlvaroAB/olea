/**
 * The refusal, proved rather than promised.
 *
 * SYN-1: *"write a test that proves a synthetic stream cannot be written to a
 * real vault log path — not a comment saying it shouldn't."* So the central
 * test here hands `writeSyntheticStream` `olea-core`'s own `reviewLogPath` as
 * its destination resolver — the exact function the product uses to place a
 * real log file — and requires it to throw with nothing written.
 *
 * The `MemoryVault` underneath accepts every write it is given (see its own
 * doc). If it refused too, this file would pass with the guard deleted.
 */

import { REVIEW_LOG_FOLDER, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  assertSyntheticSafePath,
  generateStream,
  isProductVaultPath,
  isRealVaultReviewLogPath,
  SYNTHETIC_LOG_FOLDER,
  streamSpec,
  syntheticLogFiles,
  syntheticLogPath,
  toJsonl,
  writeSyntheticStream,
} from '../src/index.js';
import { MemoryVault } from './helpers/memory-vault.js';

const stream = generateStream(streamSpec('steady-reviewer', 'guard', { days: 20 }));

describe('a synthetic stream cannot be written to a real vault log path', () => {
  it('refuses when aimed at core’s own reviewLogPath, and writes nothing', async () => {
    const vault = new MemoryVault();
    await expect(writeSyntheticStream(vault, stream, { pathFor: reviewLogPath })).rejects.toThrow(
      /refusing to write a synthetic stream to a real vault review-log path/,
    );
    expect(vault.writes).toEqual([]);
    expect(vault.files.size).toBe(0);
  });

  it('refuses anywhere else in the product’s vault namespace, and writes nothing', async () => {
    const vault = new MemoryVault();
    await expect(
      writeSyntheticStream(vault, stream, {
        pathFor: (date, deviceId) => `.olea/cache/${date}.${deviceId}.jsonl`,
      }),
    ).rejects.toThrow(/vault namespace/);
    expect(vault.writes).toEqual([]);
  });

  it('refuses even a single bad day inside an otherwise fine batch — all or nothing', async () => {
    const vault = new MemoryVault();
    const days = [...new Set(stream.entries.map((e) => e.timestamp.slice(0, 10)))];
    const poisoned = days[Math.floor(days.length / 2)];
    expect(poisoned).toBeDefined();
    await expect(
      writeSyntheticStream(vault, stream, {
        pathFor: (date, deviceId) =>
          date === poisoned ? reviewLogPath(date, deviceId) : syntheticLogPath(date, deviceId),
      }),
    ).rejects.toThrow(/real vault review-log path/);
    // The good days come first in the batch; none of them may have landed.
    expect(vault.writes).toEqual([]);
  });

  it('refuses a path spelled to slip past a naive prefix check', () => {
    for (const path of [
      '.olea/reviews/2027-02-01.laptop.jsonl',
      './.olea/reviews/2027-02-01.laptop.jsonl',
      '.olea//reviews/2027-02-01.laptop.jsonl',
      '.olea/reviews',
      '.olea',
      '.olea/anything/at/all.jsonl',
    ]) {
      expect(() => assertSyntheticSafePath(path)).toThrow();
    }
  });

  it('refuses every path reviewLogPath can produce, across dates and devices', () => {
    for (const date of ['2026-01-01', '2027-02-14', '2099-12-31']) {
      for (const deviceId of ['laptop', 'phone-2', 'A.b_c-9']) {
        const real = reviewLogPath(date, deviceId);
        expect(isRealVaultReviewLogPath(real)).toBe(true);
        expect(() => assertSyntheticSafePath(real)).toThrow();
        // …and the synthetic destination for the same day is never that path.
        expect(syntheticLogPath(date, deviceId)).not.toBe(real);
      }
    }
  });

  it('the synthetic folder is outside the product’s namespace by construction', () => {
    expect(isProductVaultPath(SYNTHETIC_LOG_FOLDER)).toBe(false);
    expect(isRealVaultReviewLogPath(SYNTHETIC_LOG_FOLDER)).toBe(false);
    expect(SYNTHETIC_LOG_FOLDER.startsWith(`${REVIEW_LOG_FOLDER}/`)).toBe(false);
  });

  it('writes happily to the synthetic destination, one file per local day', async () => {
    const vault = new MemoryVault();
    const paths = await writeSyntheticStream(vault, stream);
    const days = [...new Set(stream.entries.map((e) => e.timestamp.slice(0, 10)))];
    expect(paths).toHaveLength(days.length);
    for (const path of paths) {
      expect(path.startsWith(`${SYNTHETIC_LOG_FOLDER}/`)).toBe(true);
      expect(isProductVaultPath(path)).toBe(false);
    }
    // The bytes on disk are the stream's bytes, split by day and nothing else.
    const rejoined = paths.map((p) => vault.files.get(p) ?? '').join('');
    expect(rejoined).toBe(toJsonl(stream.entries));
  });

  it('an empty stream produces no files at all', async () => {
    const vault = new MemoryVault();
    const empty = generateStream(streamSpec('empty-history', 'guard-empty', { days: 10 }));
    expect(syntheticLogFiles(empty)).toEqual([]);
    expect(await writeSyntheticStream(vault, empty)).toEqual([]);
    expect(vault.writes).toEqual([]);
  });
});
