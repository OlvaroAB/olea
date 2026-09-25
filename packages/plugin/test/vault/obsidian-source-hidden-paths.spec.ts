/**
 * ol-egov.141.89.10.57: the real ObsidianSource class over the fake hosts in
 * hidden-path-fallback.fake.ts, to prove it is a thin caller of hidden-path-fallback.ts and
 * that a real store (olea-core's review-log writer) keeps every record on a host whose index
 * hides dot paths. obsidian-source.ts needs only TFile at runtime (for watch), so a one-line
 * mock of the obsidian module is enough to import it here; everything else it touches is the
 * fake App's vault.
 */

import type { App } from 'obsidian';
import { appendReviewLogRecord, type ReviewLogRecordInput } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ TFile: class TFile {} }));

import { ObsidianSource } from '../../src/vault/obsidian-source.js';
import {
  AWKWARD,
  BYTES,
  type FakeHost,
  HIDDEN,
  hidingHost,
  indexingHost,
  NOTE,
} from './hidden-path-fallback.fake.js';

function sourceOver(host: FakeHost): ObsidianSource {
  return new ObsidianSource({ vault: host.vault } as unknown as App);
}

function qaReview(timestamp: string): ReviewLogRecordInput {
  return {
    timestamp,
    instrumentId: 'qa:synthetic-concept:1',
    instrumentType: 'qa',
    conceptIds: ['synthetic-concept'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 3000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

for (const [name, makeHost] of [
  ['hides', hidingHost],
  ['knows', indexingHost],
] as const) {
  describe(`ObsidianSource on a host whose index ${name} dot paths`, () => {
    it('keeps every review-log record of a day (core appendReviewLogRecord, three appends)', async () => {
      const host = makeHost();
      const source = sourceOver(host);
      const paths: string[] = [];
      for (const [index, time] of ['09:00', '09:05', '09:10'].entries()) {
        const { path } = await appendReviewLogRecord(
          source,
          qaReview(`2026-09-25T${time}:00-04:00`),
          { deviceId: 'desktop', generateEventId: () => `event-${index}` },
        );
        paths.push(path);
      }
      expect(new Set(paths).size).toBe(1);
      const [logPath] = paths;
      if (logPath === undefined) throw new Error('no log path');
      const lines = (await source.read(logPath)).split('\n').filter((line) => line !== '');
      expect(lines.map((line) => JSON.parse(line).eventId)).toEqual([
        'event-0',
        'event-1',
        'event-2',
      ]);
      expect([...host.files.keys()]).toEqual([logPath]);
      expect(await source.listUnder('.olea/reviews')).toEqual([logPath]);
    });

    it('read, readBinary, exists, firstSeen, write and delete on a hidden path', async () => {
      const host = makeHost();
      const source = sourceOver(host);
      host.seed(HIDDEN, '{}');
      host.seed('.olea/cache/blob.bin', BYTES);
      expect(await source.exists(HIDDEN)).toBe(true);
      expect(await source.firstSeen(HIDDEN)).toBe(host.ctimeOf(HIDDEN));
      await source.write(HIDDEN, AWKWARD);
      expect(await source.read(HIDDEN)).toBe(AWKWARD);
      expect([...(await source.readBinary('.olea/cache/blob.bin'))]).toEqual([...BYTES]);
      await source.delete(HIDDEN);
      expect(await source.exists(HIDDEN)).toBe(false);
      await expect(source.read(HIDDEN)).rejects.toThrow(`ObsidianSource: no such file: ${HIDDEN}`);
    });

    it('an ordinary note makes exactly the vault calls it made before', async () => {
      const host = makeHost();
      const source = sourceOver(host);
      host.seedFolder('Course/Week 1');
      await source.write(NOTE, AWKWARD);
      expect(await source.read(NOTE)).toBe(AWKWARD);
      expect(await source.exists(NOTE)).toBe(true);
      await source.write(NOTE, 'second');
      expect(host.calls).toEqual([
        `vault.getFileByPath ${NOTE}`,
        'vault.getFolderByPath Course',
        'vault.getFolderByPath Course/Week 1',
        `vault.create ${NOTE}`,
        `vault.getFileByPath ${NOTE}`,
        `vault.read ${NOTE}`,
        `vault.getFileByPath ${NOTE}`,
        `vault.getFileByPath ${NOTE}`,
        `vault.modify ${NOTE}`,
      ]);
      expect(await source.list()).toEqual([NOTE]);
    });

    it('rejects an invalid path with the same messages as before', async () => {
      const source = sourceOver(makeHost());
      await expect(source.read('/abs.md')).rejects.toThrow(
        'ObsidianSource: not a valid vault path: "/abs.md"',
      );
      await expect(source.readBinary('../up.pdf')).rejects.toThrow(
        'ObsidianSource: not a valid vault path: "../up.pdf"',
      );
      await expect(source.write('/abs.md', 'x')).rejects.toThrow(
        'ObsidianSource.write: not a valid vault path: "/abs.md"',
      );
      expect(await source.exists('/abs.md')).toBe(false);
      expect(await source.firstSeen('/abs.md')).toBeNull();
    });
  });
}
