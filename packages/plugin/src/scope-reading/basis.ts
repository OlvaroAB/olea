/**
 * `documentReadingBasisFromManifest` — what the ingestion trigger tells the scope-reading store
 * about the document it has just read (`[D-429]`, `ol-egov.141.89.7.5`).
 *
 * The store keys every reading by the document revision's digest and decides "empty" versus
 * "partly read" from how much of the document was read (`./persistence.ts`). The trigger sees only
 * the units that landed in one batch, so it cannot know either fact itself. The durable unit
 * manifest (`../grove/unit-manifest-store.ts`, `[D-445]`) can: its revision digest is the hash of the
 * document's bytes, the same one a queue job is keyed by, and it names every unit and says which
 * have been read.
 *
 * **Conservative by construction.** Only a unit read in full counts as read. A unit that is pending,
 * unavailable, failed, partial or unreadable does not, so a document is never reported fully read
 * while anything about it is owed or doubtful, and an empty extraction result over it is recorded
 * as partly read, never as "the document states nothing". The cost is that a document with a blank
 * page stays partly read; the safe direction (`[D-429]`: pending is not empty; no record is not no
 * scope). A manifest that names no unit gives no basis at all (`null`): zero units read of zero is
 * not evidence of a complete reading.
 *
 * Counts and a digest only (D-005): no path, no text, no reading reason.
 */

import type { UnitManifest } from 'olea-core';

export interface DocumentReadingBasis {
  /** The document revision's digest, as the unit manifest holds it. */
  readonly revisionDigest: string;
  /** Units read in full. */
  readonly unitsRead: number;
  /** Units the manifest names. */
  readonly unitsTotal: number;
}

/** The basis the manifest supports, or `null` when it names no unit. */
export function documentReadingBasisFromManifest(
  manifest: UnitManifest,
): DocumentReadingBasis | null {
  if (manifest.entries.length === 0) return null;
  const unitsRead = manifest.entries.filter((entry) => entry.readingState.kind === 'read').length;
  return {
    revisionDigest: manifest.revisionDigest,
    unitsRead,
    unitsTotal: manifest.entries.length,
  };
}
