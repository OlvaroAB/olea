/**
 * The reading record of a lecture transcript, per part (`ol-egov.141.89.8.51`; `[D-448]`; PERSISTENCE
 * 2.3). A transcript is not paged, but the unit manifest's `page` field carries the part ordinal
 * (1-based, one revision only), so a transcript rides the same records, fold and readers as a deck.
 *
 * **The rules, in the ruling's words.**
 *  - *Every part starts waiting.* A text read of a transcript is a read of the file, not of any part:
 *    a part is `read` only when a pass actually consumed it. Nothing here ever calls a part read that
 *    no pass consumed, and nothing ever calls one absent.
 *  - *A read cut short leaves the rest waiting.* {@link transcriptPartsRead} marks exactly the parts a
 *    pass consumed, in ordinal order; the others keep their state, and a later pass resumes from them.
 *  - *Pure.* No storage here; the plugin store (`plugin/src/grove/unit-manifest-store.ts`) appends the
 *    records these produce.
 */

import type { SourceEnumeration } from './enumerate.js';
import type { UnitManifest, UnitReadingState } from './types.js';

/** The starting enumeration of a transcript: every part ordinal listed, none settled, so every part reads waiting. `partCount` 0 is an empty document: a finished read of nothing. */
export function transcriptEnumeration(partCount: number): SourceEnumeration {
  const pages = Array.from({ length: partCount }, (_, index) => index + 1);
  return { pages, settled: [] };
}

/** The state a part reaches when a pass consumed it. Text only: no model produced it, so no provenance. */
export const TRANSCRIPT_PART_READ_STATE: UnitReadingState = {
  kind: 'read',
  method: 'text-layer',
};

export interface TranscriptPartReading {
  readonly page: number;
  readonly readingState: UnitReadingState;
}

/**
 * The state changes for a pass that consumed the parts in `ordinals`. Only a part of this manifest
 * that is not already read is returned (a repeat writes nothing); an ordinal the manifest does not
 * hold is ignored, never invented. Parts not named are untouched: they stay waiting.
 */
export function transcriptPartsRead(
  manifest: UnitManifest,
  ordinals: readonly number[],
): readonly TranscriptPartReading[] {
  const wanted = new Set(ordinals);
  const out: TranscriptPartReading[] = [];
  for (const entry of manifest.entries) {
    if (!wanted.has(entry.page)) continue;
    if (entry.readingState.kind === 'read') continue;
    out.push({ page: entry.page, readingState: TRANSCRIPT_PART_READ_STATE });
  }
  return out;
}

/** How many parts of a transcript's manifest are still waiting (pending or unavailable). */
export function transcriptPartsWaiting(manifest: UnitManifest): number {
  return manifest.entries.filter(
    (entry) => entry.readingState.kind === 'pending' || entry.readingState.kind === 'unavailable',
  ).length;
}
