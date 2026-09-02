// Register row 1.3's denominator-fold health check —
// @auto:core/checks/size-denominator.spec
//
// Two kinds of evidence, matching this bead's acceptance criteria and
// `./floor-load-linearity.spec.ts`'s own "exercise the real algorithm,
// never a re-implementation" discipline:
//  - GREEN: `../scope/coverage.js`'s real `containerNamesToFold` (C7.9,
//    `ol-5phn`) applied before assembling the counted set —
//    `checkSizeDenominatorFold` must pass it.
//  - RED: the identical scope, with the fold skipped — the counted set is
//    `declaredNames` verbatim, so the broad area and its own part are
//    counted as separate peers (N+1) — `checkSizeDenominatorFold` must
//    fail it and name the offending case.
//
// Every concept name below is invented, per INV-3.
import { describe, expect, it } from 'vitest';
import type { ConceptRelation, RelationType } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import { containerNamesToFold } from '../scope/coverage.js';
import { checkSizeDenominatorFold, type SizeDenominatorScopeCase } from './size-denominator.js';

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

// A part-of B: `from` is the finer/part side, `to` is the coarser/container
// side — same convention `../scope/coverage.spec.ts`'s own `partOf` helper
// uses.
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

describe('checkSizeDenominatorFold', () => {
  it('SEEN GREEN: a broad area and its parts pass once the real C7.9 fold has run', () => {
    const declaredNames = new Set([CONTAINER, PART_A, PART_B]);
    const edges = [partOf(PART_A, CONTAINER), partOf(PART_B, CONTAINER)];

    // Exercise the real fold rather than re-deriving which names to drop.
    const dropped = containerNamesToFold(edges, declaredNames);
    const countedNames = new Set([...declaredNames].filter((name) => !dropped.has(name)));

    expect(countedNames.has(CONTAINER)).toBe(false); // the container folded out
    expect(countedNames.has(PART_A)).toBe(true);
    expect(countedNames.has(PART_B)).toBe(true);

    const cases: SizeDenominatorScopeCase[] = [
      { id: 'case-folded', containerName: CONTAINER, partNames: [PART_A, PART_B], countedNames },
    ];

    const verdict = checkSizeDenominatorFold(cases);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.offending).toEqual([]);
    expect(verdict.detail).toContain('folded its broad area out');
  });

  it('SEEN RED: fails when the fold is skipped — the container and a part are counted as separate peers (N+1)', () => {
    const declaredNames = new Set([CONTAINER, PART_A, PART_B]);
    // Fold deliberately NOT run — the counted set is the raw declared
    // names, reproducing exactly the regression this check exists to catch.
    const countedNames = declaredNames;

    const cases: SizeDenominatorScopeCase[] = [
      {
        id: 'case-unfolded',
        containerName: CONTAINER,
        partNames: [PART_A, PART_B],
        countedNames,
      },
    ];

    const verdict = checkSizeDenominatorFold(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.offending).toEqual(['case-unfolded']);
    expect(verdict.detail).toContain('did not hold');
    expect(verdict.detail).toContain('case-unfolded');
  });

  it('never flags a container declared alongside a part that belongs to a DIFFERENT container', () => {
    // Regression against a fold that dropped the wrong container: PART_A's
    // real container is CONTAINER, not this scope's declared-but-unrelated
    // second area — so both may legitimately be counted at once.
    const otherArea = 'Invented Unrelated Area';
    const countedNames = new Set([otherArea, PART_A]);

    const cases: SizeDenominatorScopeCase[] = [
      {
        id: 'case-unrelated',
        containerName: otherArea,
        partNames: ['Invented Part Z'],
        countedNames,
      },
    ];

    const verdict = checkSizeDenominatorFold(cases);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.offending).toEqual([]);
  });

  it('counts, but never fails, a case with no declared parts — there is no fold question to ask', () => {
    const countedNames = new Set([CONTAINER]);
    const cases: SizeDenominatorScopeCase[] = [
      { id: 'case-childless', containerName: CONTAINER, partNames: [], countedNames },
    ];

    const verdict = checkSizeDenominatorFold(cases);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.n).toBe(1);
    expect(verdict.measured.withDeclaredParts).toBe(0);
  });

  it('flags only the offending case among several, and passes a scope where only one side is counted', () => {
    const foldedCounted = new Set([PART_A, PART_B]); // container correctly dropped
    const containerOnlyCounted = new Set([CONTAINER]); // no part reached the denominator yet — fine
    const unfoldedCounted = new Set([CONTAINER, PART_A]); // fold skipped — offending

    const cases: SizeDenominatorScopeCase[] = [
      {
        id: 'ok-folded',
        containerName: CONTAINER,
        partNames: [PART_A, PART_B],
        countedNames: foldedCounted,
      },
      {
        id: 'ok-container-only',
        containerName: CONTAINER,
        partNames: [PART_A],
        countedNames: containerOnlyCounted,
      },
      {
        id: 'bad-unfolded',
        containerName: CONTAINER,
        partNames: [PART_A],
        countedNames: unfoldedCounted,
      },
    ];

    const verdict = checkSizeDenominatorFold(cases);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.offending).toEqual(['bad-unfolded']);
    expect(verdict.measured.n).toBe(3);
    expect(verdict.measured.withDeclaredParts).toBe(3);
  });

  it('declines zero cases — a check that ran nothing cannot report a pass', () => {
    const verdict = checkSizeDenominatorFold([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('nothing was checked');
  });
});
