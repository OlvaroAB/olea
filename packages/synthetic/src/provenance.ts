/**
 * Synthetic provenance — the non-negotiable half of SYN-1.
 *
 * ## Why the stamp lives in `eventId`
 *
 * The D7.1 record is **frozen** (`olea-contracts`' `review-log.ts`, INV-4,
 * D-020). This package may not add a field to it, and would not want to: a
 * provenance field that only synthetic records carry is a field every future
 * reader has to know about, and a record shape that has somewhere to put "this
 * is fake" is a record shape that invites someone to write fake records.
 *
 * So the stamp goes in a field the contract already has and already treats as
 * an opaque unique string: `eventId`. Concretely, every event this package
 * emits has an id beginning `syn:evt:`. That choice is load-bearing rather than
 * cosmetic, because `eventId` is the one field that survives every path a
 * record can take through the system:
 *
 *  - it survives `JSON.stringify` / `parseReviewLog` round-trips (an extra
 *    *non-schema* key would not — zod strips unknown keys, so a stamp bolted on
 *    outside the schema is erased the first time anything reads the line back);
 *  - it survives `upgradeV1` (v1 → v2 carries `eventId` verbatim);
 *  - it is the **merge key** (`mergeReviewLogRecords`), so a synthetic record
 *    cannot be laundered by merging it with real ones — it keeps its id or it
 *    stops being the same event.
 *
 * `isSyntheticRecord` is therefore a *reader-side* check any consumer of a real
 * log can run, not a courtesy this package extends to itself.
 *
 * ## What this can and cannot guarantee
 *
 * It guarantees: nothing this package writes lands in a real vault log path
 * (`./guard.ts`), and anything this package produced is identifiable forever by
 * anyone who reads it. It does **not** guarantee that some other code cannot
 * hand a synthetic record to `olea-core`'s `appendReviewLogRecord` — core's
 * writer is not modified by this package (SYN-1's placement constraint), so the
 * defence there is detection (`assertNoSyntheticRecords`) rather than
 * prevention. Stated plainly because a guard whose limits are undocumented gets
 * trusted past them.
 */

import type { ReviewLogEntry } from 'olea-contracts';

/** Namespace every identifier this package invents lives under. */
export const SYNTHETIC_ID_PREFIX = 'syn:';

/**
 * The stamp. Every `eventId` emitted by this package starts with it, and
 * `isSyntheticRecord` is exactly the test "does the id start with this".
 */
export const SYNTHETIC_EVENT_ID_PREFIX = `${SYNTHETIC_ID_PREFIX}evt:`;

/** Name of the generator, carried on the stream-level manifest. */
export const SYNTHETIC_GENERATOR = 'olea-synthetic';

/**
 * Generator version. Bumped whenever a change alters emitted bytes for an
 * unchanged spec, so a stored stream can be told apart from a re-generation of
 * the "same" spec under different code.
 */
export const SYNTHETIC_GENERATOR_VERSION = 1 as const;

/**
 * Stream-level provenance: everything needed to regenerate these exact bytes,
 * and nothing derived from a clock (a `generatedAt` here would break byte
 * identity, which is the acceptance criterion this manifest exists to support).
 */
export interface SyntheticProvenance {
  readonly generator: typeof SYNTHETIC_GENERATOR;
  readonly generatorVersion: typeof SYNTHETIC_GENERATOR_VERSION;
  /** The persona whose planted pattern this stream carries. */
  readonly persona: string;
  /** The seed. Same seed + same spec + same generatorVersion => same bytes. */
  readonly seed: string;
  /** Human-readable statement of what this data is not. Present in every manifest. */
  readonly notice: string;
}

/**
 * The notice, spelled out once. N-015's line in a sentence: this is a golden
 * fixture for detectors, never evidence about a person.
 */
export const SYNTHETIC_NOTICE =
  'Synthetic D7.1 stream. Fabricated by olea-synthetic to exercise machinery and verify ' +
  'detectors against known ground truth. Never evidence about a user, never a threshold source ' +
  '(N-015), and never valid inside a real vault review log.';

export function buildProvenance(persona: string, seed: string): SyntheticProvenance {
  return {
    generator: SYNTHETIC_GENERATOR,
    generatorVersion: SYNTHETIC_GENERATOR_VERSION,
    persona,
    seed,
    notice: SYNTHETIC_NOTICE,
  };
}

/**
 * A `SyntheticWorld`'s provenance (`./world.ts`, N-015 layer 1 — see
 * `olea-service`'s `ol-opmb` parent bead for the four-layer enforcement this
 * is the first of).
 *
 * **Inherited, never assigned.** There is deliberately no constructor that
 * takes a string like `'real'` or `'synthetic'` and stamps it — the only way
 * to produce a `WorldProvenance` is to already hold a `SyntheticProvenance`,
 * and the only thing that produces one of those is `buildProvenance` /
 * `generateStream` (`./generate.ts`). So a caller assembling a world cannot
 * assert its own provenance; it can only supply a stream that already carries
 * one, and this function reads it off rather than taking a fresh claim. That
 * is the load-bearing property: the bad thing (a report that says "real" over
 * synthetic inputs) is not merely disallowed, it has no constructor.
 */
export interface WorldProvenance extends SyntheticProvenance {
  /** Every artifact this stamp covers. Always all three today — see `./world.ts`. */
  readonly components: readonly ['stream', 'curriculum', 'corpus'];
}

/**
 * Computes a `SyntheticWorld`'s provenance from its stream's — the one
 * genuinely seeded, persona-bearing input a world bundles. `curriculum.ts`
 * and `corpus.ts` are deterministic constants over the fixed vocabulary
 * (`./vocabulary.ts`), not separately seeded, so there is nothing of theirs
 * to join beyond the fact that they are joined at all (`components`).
 */
export function joinProvenance(streamProvenance: SyntheticProvenance): WorldProvenance {
  return { ...streamProvenance, components: ['stream', 'curriculum', 'corpus'] };
}

/** The stamped event id for the `n`th event of a stream. Deterministic, ordered, and readable. */
export function syntheticEventId(streamTag: string, n: number): string {
  return `${SYNTHETIC_EVENT_ID_PREFIX}${streamTag}:${String(n).padStart(6, '0')}`;
}

export function isSyntheticEventId(eventId: string): boolean {
  return eventId.startsWith(SYNTHETIC_EVENT_ID_PREFIX);
}

/** True when this entry was fabricated by this package. Safe to run on any log entry, from any source. */
export function isSyntheticRecord(entry: Pick<ReviewLogEntry, 'eventId'>): boolean {
  return isSyntheticEventId(entry.eventId);
}

/**
 * The reader-side assertion. A consumer that has just parsed a real vault log
 * calls this before folding it into anything; it throws naming the offending
 * ids rather than returning a boolean, because "there is fabricated data in the
 * event log that is supposed to be the truth" (plan §7.1) is not a condition
 * any caller should be able to ignore by not checking a return value.
 */
export function assertNoSyntheticRecords(
  entries: readonly Pick<ReviewLogEntry, 'eventId'>[],
  where: string,
): void {
  const offenders = entries.filter(isSyntheticRecord).map((e) => e.eventId);
  if (offenders.length > 0) {
    throw new Error(
      `assertNoSyntheticRecords: ${offenders.length} synthetic record(s) found in ${where} — ` +
        `the event log is the truth (plan §7.1) and may not contain fabricated events. ` +
        `First offending eventId: ${JSON.stringify(offenders[0])}`,
    );
  }
}
