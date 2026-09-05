/**
 * The seed-events overlay, END TO END (`ol-3ux7.5.57.9.7` [MOM-8.8 / BD-8],
 * under `[D-230]`; scenarios `features/F9-measurement-playback.md` F9.26 in
 * the private repo).
 *
 * WHY THIS EXISTS, given `simulator-seed-events.spec.ts` already passes.
 * That file proves each piece in isolation — the loader parses, the layout
 * groups by day, the writer calls `vault.write` once per day. None of it
 * proves the CLAIM the build delta was filed for: that a persona world opens
 * on the record of what the student DID, not only on her notes. That claim is
 * only true if the bytes those three pieces produce are, to `olea-core`'s own
 * review-log reader running over the persisted vault afterwards, exactly what
 * a real device's own appends would have been. This test asserts that join —
 * real `PersistentVaultSource`, real overlay, real reader — so a change to
 * either half (the C5.2 path convention, the JSONL line discipline, the
 * overlay's write ordering) fails here rather than showing up as a persona
 * world that renders an empty term.
 *
 * `[D-230]` is what makes it worth a test of its own: the measured run and the
 * seen run are one object, and this is the exact seam where the seen half
 * picks up the history the measured half was taken over.
 */
import { readReviewLogHistory, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { PersistentVaultSource } from '../src/simulator/persistent-vault.js';
import {
  type SimulatorSeedEventRecord,
  writeSeedEventsIntoVault,
} from '../src/simulator/seed-events.js';
import { createMemoryStore } from '../src/simulator/store.js';
import { MemoryVaultSource } from '../src/vault/memory-source.js';

const DEVICE_ID = 'sim-steady';

/**
 * Two days of history in the exact persisted shape `olea-core`'s
 * `appendReviewLogRecord` writes and `packages/synthetic`'s `generateStream`
 * produces — the same shape a persona world's `seed-events.json` carries.
 * Invented here rather than read from a world file: this package is public and
 * a world is private data, and the point under test is the schema join, which
 * two hand-written records exercise exactly as well as a hundred generated
 * ones.
 */
const RECORDS: readonly SimulatorSeedEventRecord[] = [
  {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'syn:evt:overlay-spec:000001',
    timestamp: '2026-05-04T19:00:00.000+01:00',
    instrumentId: 'syn:inst:melspar:cloze',
    instrumentType: 'cloze',
    conceptIds: ['syn:concept:melspar'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 10_888,
    selectionContext: {
      dueState: 'new',
      examProximity: 42,
      yieldRank: null,
      instrumentTypesOffered: ['cloze', 'qa'],
      planVersion: null,
    },
  },
  {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'syn:evt:overlay-spec:000002',
    timestamp: '2026-05-04T19:04:00.000+01:00',
    instrumentId: 'syn:inst:dornith:cloze',
    instrumentType: 'cloze',
    conceptIds: ['syn:concept:dornith'],
    rating: 'hard',
    wasUnsure: true,
    durationMs: 21_004,
    selectionContext: {
      dueState: 'new',
      examProximity: 42,
      yieldRank: null,
      instrumentTypesOffered: ['cloze', 'qa'],
      planVersion: null,
    },
  },
  {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'syn:evt:overlay-spec:000003',
    timestamp: '2026-05-06T08:30:00.000+01:00',
    instrumentId: 'syn:inst:melspar:cloze',
    instrumentType: 'cloze',
    conceptIds: ['syn:concept:melspar'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 8_100,
    selectionContext: {
      dueState: 'due',
      examProximity: 40,
      yieldRank: null,
      instrumentTypesOffered: ['cloze'],
      planVersion: null,
    },
  },
];

describe('a persona world opens on the record of what the student did', () => {
  it("olea-core's own reader returns every seeded record, unchanged, from the persisted vault", async () => {
    const store = createMemoryStore();
    const vault = await PersistentVaultSource.create(MemoryVaultSource.fromBytes(new Map()), store);

    const dayFiles = await writeSeedEventsIntoVault(vault, RECORDS, DEVICE_ID);
    expect(dayFiles).toBe(2);

    const history = await readReviewLogHistory(vault);
    expect(history.invalidLines).toEqual([]);
    expect(history.entries.map((entry) => entry.eventId)).toEqual([
      'syn:evt:overlay-spec:000001',
      'syn:evt:overlay-spec:000002',
      'syn:evt:overlay-spec:000003',
    ]);
    expect(history.files).toEqual([
      reviewLogPath('2026-05-04', DEVICE_ID),
      reviewLogPath('2026-05-06', DEVICE_ID),
    ]);
  });

  it('the history survives a reload — a fresh base with the same store still has her term', async () => {
    const store = createMemoryStore();
    const first = await PersistentVaultSource.create(MemoryVaultSource.fromBytes(new Map()), store);
    await writeSeedEventsIntoVault(first, RECORDS, DEVICE_ID);

    // A reload never reuses the old MemoryVaultSource — it re-fetches a fresh one.
    const second = await PersistentVaultSource.create(
      MemoryVaultSource.fromBytes(new Map()),
      store,
    );

    const history = await readReviewLogHistory(second);
    expect(history.entries).toHaveLength(RECORDS.length);
  });

  it('the term scrubber hides a later day without losing it — the seeded bytes are never rewritten', async () => {
    const store = createMemoryStore();
    const vault = await PersistentVaultSource.create(MemoryVaultSource.fromBytes(new Map()), store);
    await writeSeedEventsIntoVault(vault, RECORDS, DEVICE_ID);

    vault.setVisibilityCutoff('2026-05-05');
    expect((await readReviewLogHistory(vault)).entries).toHaveLength(2);

    vault.setVisibilityCutoff(null);
    expect((await readReviewLogHistory(vault)).entries).toHaveLength(3);
  });

  it('seeding twice writes the same day files rather than duplicating a day', async () => {
    const store = createMemoryStore();
    const vault = await PersistentVaultSource.create(MemoryVaultSource.fromBytes(new Map()), store);
    await writeSeedEventsIntoVault(vault, RECORDS, DEVICE_ID);
    await writeSeedEventsIntoVault(vault, RECORDS, DEVICE_ID);

    // Each day file is REPLACED, not appended to, so a double-seed cannot double a term. The
    // controller's own marker (`store.loadSeededWorldMarker`) is what stops the second call
    // happening at all; this asserts the writer is safe even if it ever does.
    const history = await readReviewLogHistory(vault);
    expect(history.entries).toHaveLength(RECORDS.length);
  });
});
