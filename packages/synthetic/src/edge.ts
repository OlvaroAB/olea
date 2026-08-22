/**
 * The edge set: empty history, single session ever, and two devices on the same
 * day.
 *
 * The first two are ordinary personas driven with degenerate specs (see
 * `./personas.ts`). The third is not a persona at all — it is a *pair of
 * files*, and it needs its own constructor because the thing under test is what
 * happens when they are put back together.
 *
 * ## What "actually exercises the merge" means here
 *
 * `mergeReviewLogRecords` is idempotent and commutative on `eventId`
 * (`olea-core`'s `review-log/merge.ts`). A two-device fixture where the two
 * files share nothing would exercise concatenation, not merging — it would pass
 * against a merger that did no deduplication at all. So the fixture below
 * deliberately contains all three cases at once:
 *
 *  - events only device A saw,
 *  - events only device B saw,
 *  - events **both** files carry, with identical `eventId` *and* byte-identical
 *    content — the vault-sync case, where the same event reaches both devices.
 *
 * The third group is the one with teeth: after a merge it must appear exactly
 * once, and it must be reported in `duplicateEventIds`. And because the merger
 * throws when one `eventId` carries two different bodies, the shared records
 * are literally the same objects — reserialised from the same source — rather
 * than regenerated, so a drift in the generator can never turn this fixture
 * into an accidental collision test.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { StreamSpec, SyntheticStream } from './generate.js';
import { generateStream, streamSpec } from './generate.js';
import type { PersonaId } from './personas.js';

/** A stream with no events at all. Every history-bearing surface has to survive it. */
export function emptyHistoryStream(seed = 'edge-empty'): SyntheticStream {
  return generateStream(streamSpec('empty-history', seed, { days: 30 }));
}

/** One session, ever: a single day of first exposures. */
export function singleSessionStream(seed = 'edge-single'): SyntheticStream {
  return generateStream(streamSpec('single-session', seed, { days: 1 }));
}

export interface TwoDeviceSameDay {
  /** Device A's file contents, as a stream. */
  readonly deviceA: SyntheticStream;
  /** Device B's file contents, as a stream. */
  readonly deviceB: SyntheticStream;
  /** `eventId`s present in both files — what a correct merge must collapse and report. */
  readonly sharedEventIds: readonly string[];
  /** The full, deduplicated event set a correct merge must produce. */
  readonly expectedMerged: readonly ReviewLogEntry[];
}

/**
 * One day, two devices, a partially-synced log.
 *
 * The split is deterministic and index-based (never a fixture string, never a
 * random draw): with the day's events in chronological order, the first third
 * reached only device A, the last third only device B, and the middle third
 * reached both.
 */
export function twoDeviceSameDayStreams(
  seed = 'edge-two-device',
  persona: PersonaId = 'single-session',
): TwoDeviceSameDay {
  const base = generateStream(
    streamSpec(persona, seed, {
      days: 1,
      deviceId: 'syn-laptop',
      behaviour: { dailyCap: 9, newPerDay: 9 },
    }),
  );
  const all = base.entries;
  const third = Math.floor(all.length / 3);
  const onlyA = all.slice(0, third);
  const shared = all.slice(third, all.length - third);
  const onlyB = all.slice(all.length - third);

  const specFor = (deviceId: string): StreamSpec => ({ ...base.spec, deviceId });

  return {
    deviceA: { ...base, spec: specFor('syn-laptop'), entries: [...onlyA, ...shared] },
    // Device B's copy of the shared events is the *same* entries, not a
    // regeneration: `mergeReviewLogRecords` throws when one eventId carries two
    // different bodies, so identity here is what makes this a duplicate test
    // rather than a collision test.
    deviceB: { ...base, spec: specFor('syn-phone'), entries: [...shared, ...onlyB] },
    sharedEventIds: shared.map((e) => e.eventId),
    expectedMerged: all,
  };
}
