/**
 * The reading record for a transcript a concept read pass could only partly reach
 * (`ol-egov.141.89.8.59`; D-448, D-466). A read cut short by the per-read passage limit marks
 * exactly the parts it consumed, by the ordinals the read reported on its coverage row
 * (`ConceptReadCoverage.partsRead`, in memory only); the rest stay waiting. A source read in full
 * is marked by `recordConceptExtraction` instead, so this handles only the cut-short ones. Without
 * ordinals nothing is marked, which is the safe side: every part stays waiting.
 */
import type { ConceptReadCoverage } from 'olea-core';
import type { UnitManifestStore } from './unit-manifest-store.js';

export async function recordCappedTranscriptReads(
  store: Pick<UnitManifestStore, 'recordTranscriptReading'> | null | undefined,
  coverage: readonly ConceptReadCoverage[],
): Promise<void> {
  if (store === null || store === undefined) return;
  for (const row of coverage) {
    if (!row.truncatedByBudget) continue;
    if (row.partsRead === undefined || row.partsRead.length === 0) continue;
    await store.recordTranscriptReading(row.sourcePath, row.partsRead);
  }
}
