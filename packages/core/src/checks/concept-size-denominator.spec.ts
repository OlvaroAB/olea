// IL-D9 (`ol-2zfj.148`) — row 4.1's coverage-denominator population record
// health check — @auto:core/checks/concept-size-denominator.spec
//
// Three properties, matching this bead's "Done when": a declared counted
// unit on every scope-present case, containment deduplicated wherever a
// container/part pair is in play (exercising the real C7.9 fold,
// `../scope/coverage.js`'s `containerNamesToFold`, the same "exercise the
// real algorithm, never a re-implementation" discipline
// `./size-denominator.spec.ts` uses), and an unknown denominator withheld
// rather than fabricated when scope is absent.
//
// Every concept name below is invented, per INV-3.
import { describe, expect, it } from 'vitest';
import type { ConceptRelation, RelationType } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import { containerNamesToFold } from '../scope/coverage.js';
import {
  type CoverageDenominatorCase,
  checkCoverageDenominator,
} from './concept-size-denominator.js';

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

// A part-of B: `from` is the finer/part side, `to` is the coarser/container
// side — same convention `../scope/coverage.spec.ts`'s own `partOf` helper
// and `./size-denominator.spec.ts` use.
function partOf(from: string, to: string, type: RelationType = 'part-of'): ConceptRelation {
  return {
    type,
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
  };
}

const CONTAINER = 'Invented Broad Area';
const PART_A = 'Invented Part A';
const PART_B = 'Invented Part B';

describe('checkCoverageDenominator', () => {
  it('declares a counted unit: passes when every scope-present case names its counted-unit kind', () => {
    const cases: CoverageDenominatorCase[] = [
      {
        id: 'case-declared-grain',
        scopeDeclared: true,
        countedUnitKind: 'declaredConcept',
        denominatorValue: 3,
        denominatorFrom: 'examiner-objectives-document',
      },
      {
        id: 'case-aligned-grain',
        scopeDeclared: true,
        countedUnitKind: 'alignedConcept',
        denominatorValue: 5,
        denominatorFrom: 'examiner-past-paper',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.undeclaredUnit).toEqual([]);
    expect(verdict.measured.withDeclaredScope).toBe(2);
  });

  it('fails a scope-present case that names no counted-unit kind, whichever grain would have been named', () => {
    const cases: CoverageDenominatorCase[] = [
      {
        id: 'case-silent-default',
        scopeDeclared: true,
        // countedUnitKind deliberately omitted — the defect this check
        // exists to catch, independent of which grain [IL-D9] eventually
        // rules.
        denominatorValue: 4,
        denominatorFrom: 'examiner-objectives-document',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.undeclaredUnit).toEqual(['case-silent-default']);
    expect(verdict.detail).toContain('named no counted-unit kind');
  });

  it('containment dedup — SEEN GREEN: a broad area and its parts pass once the real C7.9 fold has run', () => {
    const declaredNames = new Set([CONTAINER, PART_A, PART_B]);
    const edges = [partOf(PART_A, CONTAINER), partOf(PART_B, CONTAINER)];

    const dropped = containerNamesToFold(edges, declaredNames);
    const countedNames = new Set([...declaredNames].filter((name) => !dropped.has(name)));
    expect(countedNames.has(CONTAINER)).toBe(false); // the container folded out

    const cases: CoverageDenominatorCase[] = [
      {
        id: 'case-folded',
        scopeDeclared: true,
        countedUnitKind: 'declaredConcept',
        containerName: CONTAINER,
        partNames: [PART_A, PART_B],
        countedNames,
        denominatorValue: countedNames.size,
        denominatorFrom: 'examiner-objectives-document',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.offending).toEqual([]);
    expect(verdict.measured.withDeclaredParts).toBe(1);
  });

  it('containment dedup — SEEN RED: fails when the fold is skipped — container and a part counted as separate peers (N+1)', () => {
    const declaredNames = new Set([CONTAINER, PART_A, PART_B]);
    // Fold deliberately NOT run — the counted set is the raw declared
    // names, reproducing exactly the regression this check exists to catch.
    const countedNames = declaredNames;

    const cases: CoverageDenominatorCase[] = [
      {
        id: 'case-unfolded',
        scopeDeclared: true,
        countedUnitKind: 'declaredConcept',
        containerName: CONTAINER,
        partNames: [PART_A, PART_B],
        countedNames,
        denominatorValue: countedNames.size,
        denominatorFrom: 'examiner-objectives-document',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.offending).toEqual(['case-unfolded']);
    expect(verdict.detail).toContain('IL-D9');
  });

  it('a scope-present case with no declared parts is counted but never flagged for containment — no fold question to ask', () => {
    const countedNames = new Set([CONTAINER]);
    const cases: CoverageDenominatorCase[] = [
      {
        id: 'case-childless',
        scopeDeclared: true,
        countedUnitKind: 'declaredConcept',
        containerName: CONTAINER,
        partNames: [],
        countedNames,
        denominatorValue: 1,
        denominatorFrom: 'examiner-objectives-document',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.withDeclaredParts).toBe(0);
  });

  it("unknown withheld: passes when a scope-absent case reads 'unknown' rather than a fabricated count", () => {
    const cases: CoverageDenominatorCase[] = [
      {
        id: 'case-no-scope-yet',
        scopeDeclared: false,
        denominatorValue: 'unknown',
        denominatorFrom: 'unknown',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.fabricatedWhenAbsent).toEqual([]);
  });

  it('fails a scope-absent case that reports a real value instead of unknown — a fabricated denominator', () => {
    const cases: CoverageDenominatorCase[] = [
      {
        id: 'case-fabricated-zero',
        scopeDeclared: false,
        denominatorValue: 0, // the exact failure mode the requirement forbids: unknown drawn as zero
        denominatorFrom: 'unknown',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.fabricatedWhenAbsent).toEqual(['case-fabricated-zero']);
    expect(verdict.detail).toContain('fabricated count');
  });

  it('fails a scope-absent case with a real value but a still-unknown source, and vice versa — both fields must read unknown together', () => {
    const cases: CoverageDenominatorCase[] = [
      {
        id: 'case-value-only',
        scopeDeclared: false,
        denominatorValue: 6,
        denominatorFrom: 'unknown',
      },
      {
        id: 'case-source-only',
        scopeDeclared: false,
        denominatorValue: 'unknown',
        denominatorFrom: 'examiner-objectives-document',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.fabricatedWhenAbsent).toEqual(['case-value-only', 'case-source-only']);
  });

  it('flags only the offending case among several mixed defects, reporting every measured count', () => {
    const foldedCounted = new Set([PART_A, PART_B]);
    const unfoldedCounted = new Set([CONTAINER, PART_A]);

    const cases: CoverageDenominatorCase[] = [
      {
        id: 'ok-declared-and-folded',
        scopeDeclared: true,
        countedUnitKind: 'declaredConcept',
        containerName: CONTAINER,
        partNames: [PART_A, PART_B],
        countedNames: foldedCounted,
        denominatorValue: foldedCounted.size,
        denominatorFrom: 'examiner-objectives-document',
      },
      {
        id: 'bad-undeclared-unit',
        scopeDeclared: true,
        containerName: CONTAINER,
        partNames: [],
        countedNames: new Set([CONTAINER]),
        denominatorValue: 1,
        denominatorFrom: 'examiner-objectives-document',
      },
      {
        id: 'bad-unfolded',
        scopeDeclared: true,
        countedUnitKind: 'declaredConcept',
        containerName: CONTAINER,
        partNames: [PART_A],
        countedNames: unfoldedCounted,
        denominatorValue: unfoldedCounted.size,
        denominatorFrom: 'examiner-objectives-document',
      },
      {
        id: 'bad-fabricated',
        scopeDeclared: false,
        denominatorValue: 0,
        denominatorFrom: 'unknown',
      },
      {
        id: 'ok-absent-unknown',
        scopeDeclared: false,
        denominatorValue: 'unknown',
        denominatorFrom: 'unknown',
      },
    ];

    const verdict = checkCoverageDenominator(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(5);
    expect(verdict.measured.withDeclaredScope).toBe(3);
    expect(verdict.measured.withDeclaredParts).toBe(2);
    expect(verdict.measured.undeclaredUnit).toEqual(['bad-undeclared-unit']);
    expect(verdict.measured.offending).toEqual(['bad-unfolded']);
    expect(verdict.measured.fabricatedWhenAbsent).toEqual(['bad-fabricated']);
  });

  it('declines zero cases — a check that ran nothing cannot report a pass', () => {
    const verdict = checkCoverageDenominator([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('nothing was checked');
  });
});
