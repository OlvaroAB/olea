/**
 * The concept-reading seam through the Writing contract
 * (`ol-egov.141.89.20`), fed the seam's own `ConceptReadResult` arms.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import type { ConceptReadResult, ConceptsRead } from '../../concept/read.js';
import type { StageSeamContext } from '../provenance.js';
import { writingEnvelopeProblems } from '../writing.js';
import {
  NO_READABLE_MATERIAL_RULE,
  RELATIONS_RECONCILED_CHECK,
  writingFromConceptRead,
} from './concept-read.js';

const context: StageSeamContext = {
  seat: 'candidate',
  taskId: 'concepts.extract.v1',
  stamp: null,
  evidenceDigests: ['unit-digest-1'],
};

const base = { coverage: [], passagesOffered: 4, passagesRead: 4, truncatedByBudget: false };

function read(relationsDropped: number): ConceptsRead {
  return { outcome: 'read', concepts: [], relations: [], relationsDropped, ...base };
}

describe('writingFromConceptRead', () => {
  it('reads a clean read as written, the result itself as the draft', () => {
    const result = read(0);
    const outcome = writingFromConceptRead(result, context);
    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.draft).toBe(result);
    expect(outcome.receipt.passed).toEqual([{ check: RELATIONS_RECONCILED_CHECK, kind: 'code' }]);
    expect(outcome.receipt.disposition).toBe('checks-passed');
    expect(outcome.receipt.assurance).toBe('code-checks-only');
  });

  it('reads dropped relations as a repair, with the count and nothing else', () => {
    const outcome = writingFromConceptRead(read(3), context);
    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.receipt.repaired).toEqual([
      { check: RELATIONS_RECONCILED_CHECK, kind: 'code', note: '3 dropped' },
    ]);
    expect(outcome.receipt.disposition).toBe('repaired');
  });

  it('keeps nothing-to-read apart from an outage', () => {
    const unrecognised = (
      reason: 'no-readable-material' | 'reader-unavailable' | 'reader-failed',
      extra: Partial<ConceptReadResult> = {},
    ): ConceptReadResult =>
      ({
        outcome: 'unrecognised',
        concepts: [],
        reason,
        detail: 'coined detail',
        ...base,
        ...extra,
      }) as ConceptReadResult;

    expect(writingFromConceptRead(unrecognised('no-readable-material'), context)).toEqual({
      kind: 'declined',
      basis: 'nothing-to-write-from',
      provenance: {
        producer: { kind: 'code', rule: NO_READABLE_MATERIAL_RULE },
        evidenceDigests: ['unit-digest-1'],
      },
    });
    expect(
      writingFromConceptRead(
        unrecognised('reader-unavailable', { unavailableBecause: 'budget-exhausted' }),
        context,
      ),
    ).toMatchObject({ kind: 'unavailable', cause: 'budget-exhausted' });
    expect(writingFromConceptRead(unrecognised('reader-failed'), context)).toMatchObject({
      kind: 'unavailable',
      cause: 'call-failed',
    });
  });

  it('produces a well-formed envelope for every arm, before and after JSON', () => {
    const results: ConceptReadResult[] = [
      read(0),
      read(2),
      {
        outcome: 'unrecognised',
        concepts: [],
        reason: 'reader-unavailable',
        detail: 'coined',
        unavailableBecause: 'offline',
        ...base,
      },
    ];
    for (const result of results) {
      const outcome = writingFromConceptRead(result, context);
      expect(writingEnvelopeProblems(outcome)).toEqual([]);
      expect(writingEnvelopeProblems(JSON.parse(JSON.stringify(outcome)))).toEqual([]);
    }
  });
});
