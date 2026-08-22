/**
 * The transient misconception digest (D-008, M4, `ol-p4t02`'s "transient
 * misconception-digest context" acceptance clause).
 *
 * D-008: personalization artifacts are "derived projections... injected
 * transiently into each request — a few kilobytes of context per call. The
 * Worker never persists a profile." This is the one function that turns this
 * store's local projection into that per-call payload. It is deliberately
 * small and deliberately *not* the full `MisconceptionRecord`: no
 * `firstSeen`/`lastSeen` timestamps and no `originInstrumentId` travel here,
 * because the grading pipeline's only use for this digest is recognising
 * "has she raised this specific confusion before, on this concept" — nothing
 * else in the record shape is load-bearing for that, and D-005/D-008 both
 * argue for sending the *minimum* transient context a task needs, not
 * whatever happens to be convenient to serialise.
 *
 * **M4's "never leaves the device except transiently" is this function's
 * whole job.** There is no function anywhere in `./` that sends a
 * `MisconceptionRecord` or event to a network target — only this bounded,
 * synchronous, side-effect-free transform exists as the boundary. See
 * `digest.spec.ts` for the size-bound test and `store.fitness.spec.ts` for
 * the module-wide "no network call anywhere in this directory" assertion.
 */

import type { MisconceptionRecord } from './types.js';

export interface MisconceptionDigestEntry {
  readonly id: string;
  readonly conceptId: string;
  readonly statement: string;
  readonly status: MisconceptionRecord['status'];
  readonly occurrenceCount: number;
}

export interface BuildMisconceptionDigestOptions {
  /** Restrict to these concepts — the explain-back's actual target(s), never "everything she's ever gotten wrong." */
  readonly conceptIds: readonly string[];
  /** Upper bound on entries returned, so the digest stays "a few kilobytes" regardless of how large the projection grows over a semester. Sorted by `occurrenceCount` descending (most-recurring first) before truncating, so a cap never silently drops the misconception that matters most. */
  readonly maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 20;

/**
 * Builds the bounded, transient digest for one grading request. Only
 * `active`/`fading` records are included — a `resolved` misconception has
 * nothing left for the grader to recognise or route around, and including it
 * would just grow the payload for no use the task has.
 */
export function buildMisconceptionDigest(
  records: readonly MisconceptionRecord[],
  options: BuildMisconceptionDigestOptions,
): readonly MisconceptionDigestEntry[] {
  const conceptSet = new Set(options.conceptIds);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const eligible = records.filter(
    (record) => conceptSet.has(record.conceptId) && record.status !== 'resolved',
  );

  const sorted = [...eligible].sort((a, b) => {
    if (a.occurrenceCount !== b.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted.slice(0, maxEntries).map((record) => ({
    id: record.id,
    conceptId: record.conceptId,
    statement: record.statement,
    status: record.status,
    occurrenceCount: record.occurrenceCount,
  }));
}
