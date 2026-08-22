/**
 * The edge set: empty history, single session ever, two devices on the same day.
 *
 * The two-device case is the one with real content. `mergeReviewLogRecords` is
 * idempotent and commutative on `eventId` with no coordination between devices
 * — a claim that a fixture of two disjoint files would not test at all. These
 * assertions therefore turn on the *shared* records: they must collapse to one
 * occurrence, be reported as duplicates, and produce the identical result in
 * either input order and under repetition.
 */

import { mergeReviewLogRecords, parseReviewLog, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  emptyHistoryStream,
  eventDays,
  reviewsOf,
  singleSessionStream,
  syntheticLogFiles,
  toJsonl,
  twoDeviceSameDayStreams,
} from '../src/index.js';

describe('edge: empty history', () => {
  it('is a valid stream with no entries, no files and no ground truth to speak of', () => {
    const stream = emptyHistoryStream();
    expect(stream.entries).toEqual([]);
    expect(toJsonl(stream.entries)).toBe('');
    expect(syntheticLogFiles(stream)).toEqual([]);
    expect(stream.groundTruth.sessionDates).toEqual([]);
    // An empty file is still parseable, and reports nothing wrong with itself.
    expect(parseReviewLog('')).toEqual({ records: [], invalidLines: [] });
  });
});

describe('edge: a single session, ever', () => {
  it('is one day of first exposures', () => {
    const stream = singleSessionStream();
    expect(stream.entries.length).toBeGreaterThan(0);
    expect(eventDays(stream.entries)).toHaveLength(1);
    const seenConcepts = new Set<string>();
    for (const record of reviewsOf(stream.entries)) {
      // Every instrument is a first exposure — nothing can be due on day one.
      expect(record.selectionContext.dueState).toBe('new');
      // The *concept* can already have history, though, when a sibling
      // instrument for it was answered earlier in the same session. Mastery is
      // a concept rollup, so only the first record for each concept records
      // nothing — an absent field since `ol-g6zg`, a null before it, and the
      // same statement either way.
      // A synthetic instrument is evidence for exactly one concept, so
      // `conceptIds` is a singleton here, but this reads it the many-to-many
      // way (v3) rather than assuming that.
      for (const conceptId of record.conceptIds) {
        if (!seenConcepts.has(conceptId)) {
          expect(record.masteryAtTime).toBeUndefined();
          seenConcepts.add(conceptId);
        }
      }
    }
    expect(seenConcepts.size).toBeGreaterThan(0);
    expect(syntheticLogFiles(stream)).toHaveLength(1);
  });
});

describe('edge: two devices, same day', () => {
  const fixture = twoDeviceSameDayStreams();

  it('really does put the same events in both files', () => {
    expect(fixture.sharedEventIds.length).toBeGreaterThan(0);
    const a = new Set(fixture.deviceA.entries.map((e) => e.eventId));
    const b = new Set(fixture.deviceB.entries.map((e) => e.eventId));
    for (const id of fixture.sharedEventIds) {
      expect(a.has(id)).toBe(true);
      expect(b.has(id)).toBe(true);
    }
    // …and each file also holds something the other does not, so the merge has
    // work to do beyond deduplication.
    expect([...a].some((id) => !b.has(id))).toBe(true);
    expect([...b].some((id) => !a.has(id))).toBe(true);
  });

  it('merges to the full event set exactly once each, with the duplicates reported', () => {
    const merged = mergeReviewLogRecords(fixture.deviceA.entries, fixture.deviceB.entries);
    expect(merged.records).toEqual(fixture.expectedMerged);
    expect([...merged.duplicateEventIds].sort()).toEqual([...fixture.sharedEventIds].sort());
  });

  it('is commutative and idempotent, with no coordination between the devices', () => {
    const ab = mergeReviewLogRecords(fixture.deviceA.entries, fixture.deviceB.entries);
    const ba = mergeReviewLogRecords(fixture.deviceB.entries, fixture.deviceA.entries);
    const abab = mergeReviewLogRecords(
      fixture.deviceA.entries,
      fixture.deviceB.entries,
      fixture.deviceA.entries,
      fixture.deviceB.entries,
    );
    expect(ba.records).toEqual(ab.records);
    expect(abab.records).toEqual(ab.records);
  });

  it('lands in two distinct same-day files, one per device, and never in the real log folder', () => {
    const [fileA] = syntheticLogFiles(fixture.deviceA);
    const [fileB] = syntheticLogFiles(fixture.deviceB);
    expect(fileA).toBeDefined();
    expect(fileB).toBeDefined();
    expect(fileA?.path).not.toBe(fileB?.path);
    const day = fixture.expectedMerged[0]?.timestamp.slice(0, 10) ?? '';
    expect(fileA?.path).not.toBe(reviewLogPath(day, fixture.deviceA.spec.deviceId));
    expect(fileB?.path).not.toBe(reviewLogPath(day, fixture.deviceB.spec.deviceId));
  });

  it('survives the full file → parse → merge path both devices would actually take', () => {
    const parsedA = parseReviewLog(toJsonl(fixture.deviceA.entries));
    const parsedB = parseReviewLog(toJsonl(fixture.deviceB.entries));
    expect(parsedA.invalidLines).toEqual([]);
    expect(parsedB.invalidLines).toEqual([]);
    const merged = mergeReviewLogRecords(parsedA.records, parsedB.records);
    expect(merged.records).toEqual(fixture.expectedMerged);
  });
});
