/**
 * Writing adapter for the concept-reading seam: `readConcepts`'s
 * `ConceptReadResult` (`../../concept/read.ts`). Pure; the seam's file is
 * not touched.
 *
 * The mapping:
 *
 * - `read` is `written`: the result itself is the draft, unchanged (an empty
 *   concept list is still a measurement, not a failure). Its receipt lists
 *   the one check this seam runs on what the reader returned: relations are
 *   reconciled against the concepts the read actually returned, and any
 *   naming a concept it did not return are dropped. None dropped is
 *   `passed`; some dropped is `repaired`, with the count as the note.
 *   Anchor validation runs inside the reader port, out of this seam's sight,
 *   so this receipt does not list it; the port's own adapter adds it when
 *   one is built.
 * - `unrecognised` for `no-readable-material` is `declined`,
 *   `nothing-to-write-from`, produced by code (INV-5: the reader was never
 *   asked).
 * - `unrecognised` for `reader-unavailable` is unavailable, with the seam's
 *   own reason as the cause.
 * - `unrecognised` for `reader-failed` is unavailable `call-failed`.
 *
 * A read the budget cut short is still `written`; `truncatedByBudget` and
 * the per-document coverage stay on the draft, where their consumers read
 * them.
 */

import type { ConceptReadResult, ConceptsRead } from '../../concept/read.js';
import {
  codeProvenance,
  failedCallProvenance,
  modelProvenance,
  type StageSeamContext,
} from '../provenance.js';
import { type WritingOutcome, writingFromChecks } from '../writing.js';

/** The code rule named when no readable material was found. */
export const NO_READABLE_MATERIAL_RULE = 'no-readable-material';

/** The receipt's name for the relation reconciliation check. */
export const RELATIONS_RECONCILED_CHECK = 'relations-reconciled';

export function writingFromConceptRead(
  result: ConceptReadResult,
  context: StageSeamContext,
): WritingOutcome<ConceptsRead> {
  if (result.outcome === 'read') {
    const dropped = result.relationsDropped;
    return writingFromChecks(
      result,
      [
        dropped === 0
          ? { check: RELATIONS_RECONCILED_CHECK, kind: 'code', status: 'passed' }
          : {
              check: RELATIONS_RECONCILED_CHECK,
              kind: 'code',
              status: 'repaired',
              note: `${dropped} dropped`,
            },
      ],
      modelProvenance(context),
    );
  }
  switch (result.reason) {
    case 'no-readable-material':
      return {
        kind: 'declined',
        basis: 'nothing-to-write-from',
        provenance: codeProvenance(NO_READABLE_MATERIAL_RULE, context.evidenceDigests),
      };
    case 'reader-unavailable':
      return {
        kind: 'unavailable',
        cause: result.unavailableBecause ?? 'call-failed',
        provenance: failedCallProvenance(context),
      };
    case 'reader-failed':
      return {
        kind: 'unavailable',
        cause: 'call-failed',
        provenance: failedCallProvenance(context),
      };
  }
}
