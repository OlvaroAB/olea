/**
 * The production records that exist today, read as a population's inputs
 * (`ol-egov.141.89.11.4`). Each reader is pure; gathering the records (the vault,
 * the log) stays with the caller.
 *
 * - **Declarations** come from the Outcome records (`../outcome/types.ts`), the
 *   examiner's declared units in production (read today only by the practice paper).
 *   An Outcome with concept keys attached is aligned to them. An Outcome with none
 *   reads **extracted but not aligned**, never "no concept in her material": the
 *   record cannot tell a unit with nothing in her material from one the name
 *   reconciliation could not settle, and only the second reading is unknown rather
 *   than a claim that something is missing.
 * - **Readings** come from `[D-326]`'s completeness record, directly or through the
 *   coverage scope's row (which falls back to the extractor verdict where no record
 *   exists; the caller chooses which it passes, since that fallback is a Class B
 *   default of the gap view, not a ruling).
 * - **Evidence** comes from the attainment reading's displayed stage, over the
 *   evidence that stands now (proven-invalid instruments already excluded there).
 *
 * Nothing here reads the examiner-scope chain's declaration extraction state: no
 * production record says whether an examiner document's declarations finished
 * extracting, so a production caller passes `null` and the denominator reads not yet
 * known until that record exists.
 */

import { type CoverageScopeSource, readRecordOf } from '../gap/coverage.js';
import type { UnitManifest } from '../ingestion/unit-manifest/types.js';
import type { ConceptAttainment } from '../mastery/attainment.js';
import type { OutcomeRecord } from '../outcome/types.js';
import type {
  ConceptEvidenceState,
  PopulationDeclarationInput,
  PopulationExtractionState,
  PopulationReading,
} from './types.js';

/** The course's active Outcome records as its declarations (see the module doc for the alignment rule). */
export function declarationsFromOutcomeRecords(
  records: readonly OutcomeRecord[],
  courseId: string,
): PopulationDeclarationInput[] {
  return records
    .filter((r) => r.status === 'active' && r.courses.includes(courseId))
    .map((r) => ({
      declarationId: r.id,
      documentId: r.source.path,
      revision: null,
      alignment: r.conceptKeys.length > 0 ? ('aligned' as const) : ('not-aligned' as const),
      conceptKeys: [...r.conceptKeys],
    }));
}

/**
 * One source's `[D-326]` completeness record as a population reading, or `null` for
 * a record with no units. Every unit read in full → `complete` (every unit blank →
 * `read-empty`); a unit read only in part or failed beside read ones → `partial`,
 * with the count of units holding read material; every unit failed or not legible →
 * `unreadable`; nothing read yet with units still pending → `unread`, and with some
 * read → `partial`.
 */
export function populationReadingOfManifest(manifest: UnitManifest): PopulationReading | null {
  const recorded = readRecordOf(manifest);
  if (recorded === null) return null;
  const unitsTotal = manifest.entries.length;
  const unitsRead = manifest.entries.filter((u) => u.readingState.kind === 'read').length;
  if (recorded.readingCompleteness === 'full') {
    return { state: recorded.readState === 'read' ? 'complete' : 'read-empty' };
  }
  if (recorded.readState === 'read') return { state: 'partial', unitsRead, unitsTotal };
  if (recorded.readingCompleteness === 'partial') return { state: 'unreadable' };
  return { state: 'unread' };
}

/**
 * One coverage-scope row as a population reading: the completeness record's reading
 * where one was supplied, else the extractor verdict's (read → complete, read and
 * found nothing → read-empty, unreadable, not attempted → unread).
 */
export function populationReadingOfScopeSource(source: CoverageScopeSource): PopulationReading {
  switch (source.readingCompleteness) {
    case 'partial':
      return { state: source.readState === 'read' ? 'partial' : 'unreadable' };
    case 'unsettled':
      return { state: source.readState === 'read' ? 'partial' : 'unread' };
    case 'full':
    case 'not-recorded':
      switch (source.readState) {
        case 'read':
          return { state: 'complete' };
        case 'read-yielded-nothing':
          return { state: 'read-empty' };
        case 'unreadable':
          return { state: 'unreadable' };
        case 'not-attempted':
          return { state: 'unread' };
      }
  }
}

/** One coverage-scope row's concept extraction, or `null` where no record says. Unfinished reads as pending. */
export function conceptExtractionOfScopeSource(
  source: CoverageScopeSource,
): PopulationExtractionState | null {
  switch (source.conceptExtraction) {
    case 'complete':
    case 'nothing-to-extract':
      return 'finished';
    case 'unfinished':
      return 'pending';
    case 'not-recorded':
      return null;
  }
}

/** Whether one concept's attainment reading holds a scored attempt that stands now. */
export function conceptEvidenceOfAttainment(attainment: ConceptAttainment): ConceptEvidenceState {
  const e = attainment.displayed.evidence;
  const scored =
    e.scoredEventCount + e.gradedExplainBackCount + (e.correctnessOnlyExplainBackCount ?? 0);
  return scored > 0 ? 'assessed' : 'not-yet-assessed';
}

/** {@link conceptEvidenceOfAttainment} over `readAllConceptAttainment`'s map. */
export function conceptEvidenceFromAttainment(
  attainments: ReadonlyMap<string, ConceptAttainment>,
): ReadonlyMap<string, ConceptEvidenceState> {
  const out = new Map<string, ConceptEvidenceState>();
  for (const [key, attainment] of attainments)
    out.set(key, conceptEvidenceOfAttainment(attainment));
  return out;
}
