/**
 * Count causes and receipts over the population (`ol-egov.141.89.11.4`; `[D-184]`,
 * `[D-272]`, `[D-309]`; case classes C15, C19). Scenarios: `features/F4-oracle.md`
 * (olea-service), "C15, C19: count causes and receipts over the population", written
 * before this code.
 *
 * Fixture ids are opaque (INV-3).
 */
import { describe, expect, it } from 'vitest';
import {
  COUNT_CAUSE_MIN_STEPS,
  checkCountCauseAttribution,
  countReceiptsBetween,
  type PopulationCountStep,
} from './count-cause.js';
import { buildCoursePopulation } from './population.js';
import type {
  ConceptEvidenceState,
  CoursePopulationInput,
  PopulationDeclarationInput,
} from './types.js';

const COURSE = 'crs-a';

function doc(documentId: string) {
  return {
    documentId,
    examiner: true as const,
    revision: 'r1',
    revisionDate: '2026-01-07',
    reading: { state: 'complete' as const },
    declarationExtraction: 'finished' as const,
  };
}

function declared(
  declarationId: string,
  documentId: string,
  ...conceptKeys: string[]
): PopulationDeclarationInput {
  return { declarationId, documentId, revision: 'r1', alignment: 'aligned', conceptKeys };
}

/** One course over the given documents and declarations, every concept read, practised and assessed. */
function course(
  documentIds: readonly string[],
  declarations: readonly PopulationDeclarationInput[],
): CoursePopulationInput {
  const conceptKeys = [...new Set(declarations.flatMap((d) => d.conceptKeys))];
  return {
    courseId: COURSE,
    documents: documentIds.map(doc),
    declarations,
    sources: conceptKeys.map((k) => ({
      sourceId: `src-${k}`,
      reading: { state: 'complete' as const },
    })),
    conceptExtraction: 'finished',
    concepts: conceptKeys.map((k) => ({ conceptKey: k, sourceIds: [`src-${k}`] })),
    instruments: conceptKeys.map((k) => ({
      instrumentId: `ins-${k}`,
      conceptKeys: [k],
      standing: 'eligible' as const,
    })),
    conceptEvidence: new Map(conceptKeys.map((k) => [k, 'assessed' as ConceptEvidenceState])),
  };
}

function step(
  id: string,
  input: CoursePopulationInput,
  cause?: NonNullable<PopulationCountStep['cause']>,
): PopulationCountStep {
  const population = buildCoursePopulation(input);
  return cause === undefined ? { id, population } : { id, population, cause };
}

describe('the count never moves between two reads with no named cause (C15)', () => {
  const before = course(
    ['doc-1'],
    [declared('unit-1', 'doc-1', 'c1'), declared('unit-2', 'doc-1', 'c2')],
  );
  const after = course(['doc-1'], [declared('unit-2', 'doc-1', 'c2')]);

  it('reports the later read as a silent move when no cause is attached', () => {
    const verdict = checkCountCauseAttribution([step('read-1', before), step('read-2', after)]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.silentMoves).toEqual(['read-2']);
    expect(verdict.measured.movedTransitions).toBe(1);
  });

  it.each(['registered', 'reclassified', 'revised', 're-read'] as const)(
    'reports no silent move once a %s cause is attached, whichever of the four kinds is named',
    (kind) => {
      const verdict = checkCountCauseAttribution([
        step('read-1', before),
        step('read-2', after, { kind }),
      ]);
      expect(verdict.ok).toBe(true);
      expect(verdict.measured.silentMoves).toEqual([]);
      expect(verdict.measured.movedTransitions).toBe(1);
    },
  );

  it('does not flag a transition where the counted-unit set did not move', () => {
    const verdict = checkCountCauseAttribution([step('read-1', before), step('read-2', before)]);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.movedTransitions).toBe(0);
    expect(verdict.measured.receiptsByStep.size).toBe(0);
  });

  it('a sequence of fewer than two reads cannot report a pass', () => {
    const single = checkCountCauseAttribution([step('read-1', before)]);
    expect(single.ok).toBe(false);
    expect(single.measured.n).toBe(1);
    expect(single.measured.transitions).toBe(0);

    const empty = checkCountCauseAttribution([]);
    expect(empty.ok).toBe(false);
    expect(empty.measured.n).toBe(0);
    expect(COUNT_CAUSE_MIN_STEPS).toBe(2);
  });

  it('reports every moved transition across a longer sequence, not only the first', () => {
    const dropTwo = course(['doc-1'], []);
    const verdict = checkCountCauseAttribution([
      step('read-1', before),
      step('read-2', after, { kind: 'revised' }),
      step('read-3', dropTwo),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.silentMoves).toEqual(['read-3']);
    expect(verdict.measured.movedTransitions).toBe(2);
    expect(verdict.measured.receiptsByStep.has('read-2')).toBe(true);
    expect(verdict.measured.receiptsByStep.has('read-3')).toBe(true);
  });
});

describe("a revision's receipt names the document and the units that left or returned (C19)", () => {
  it('names the revised document, the dropped unit and the returned unit; leaves an unchanged document out', () => {
    const before = course(
      ['doc-1', 'doc-2'],
      [declared('unit-1', 'doc-1', 'c1'), declared('unit-x', 'doc-2', 'cx')],
    );
    const after = course(
      ['doc-1', 'doc-2'],
      [declared('unit-3', 'doc-1', 'c3'), declared('unit-x', 'doc-2', 'cx')],
    );

    const receipts = countReceiptsBetween(
      buildCoursePopulation(before).units,
      buildCoursePopulation(after).units,
    );

    expect(receipts).toEqual([
      { documentId: 'doc-1', unitsLeft: ['unit-1'], unitsReturned: ['unit-3'] },
    ]);
  });

  it('names neither side for a unit id kept across the revision', () => {
    const before = course(
      ['doc-1'],
      [declared('unit-1', 'doc-1', 'c1'), declared('unit-2', 'doc-1', 'c2')],
    );
    const after = course(['doc-1'], [declared('unit-1', 'doc-1', 'c1')]);

    const receipts = countReceiptsBetween(
      buildCoursePopulation(before).units,
      buildCoursePopulation(after).units,
    );

    expect(receipts).toEqual([{ documentId: 'doc-1', unitsLeft: ['unit-2'], unitsReturned: [] }]);
    for (const line of receipts) {
      expect(line.unitsLeft).not.toContain('unit-1');
      expect(line.unitsReturned).not.toContain('unit-1');
    }
  });

  it('reports no receipt line at all when nothing changed', () => {
    const same = course(['doc-1'], [declared('unit-1', 'doc-1', 'c1')]);
    const receipts = countReceiptsBetween(
      buildCoursePopulation(same).units,
      buildCoursePopulation(same).units,
    );
    expect(receipts).toEqual([]);
  });
});
