import { describe, expect, it } from 'vitest';
import type { ExtractionOutcome } from '../extract/types.js';
import type { SourceCoverage } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { readStateOf, sourcesInState, summariseCoverageScope } from './coverage.js';

function row(overrides: Partial<SourceCoverage> & { sourcePath: string }): SourceCoverage {
  return {
    sourcePath: overrides.sourcePath as VaultPath,
    kinds: overrides.kinds ?? ['registered-file'],
    role: overrides.role ?? 'past-paper',
    format: overrides.format ?? 'pdf',
    duplicateSourcePaths: overrides.duplicateSourcePaths ?? [],
    courses: overrides.courses ?? ['CRS101'],
    outcome: overrides.outcome ?? 'extracted',
    pages: overrides.pages ?? 3,
    units: overrides.units ?? 9,
    citations: overrides.citations ?? 2,
    limitations: overrides.limitations ?? [],
  };
}

describe('readStateOf — the four states stay four', () => {
  // The scenario "a source that could not be read is a visible state, never a
  // clean zero". Each outcome is asserted individually so a collapse of any
  // pair is a named failure rather than a count that happens to still add up.
  const cases: readonly (readonly [ExtractionOutcome, number, string])[] = [
    ['extracted', 9, 'read'],
    ['extracted', 0, 'read-yielded-nothing'],
    ['empty-document', 0, 'read-yielded-nothing'],
    ['no-pages-found', 0, 'unreadable'],
    ['unreadable', 0, 'unreadable'],
    ['reached-but-unreadable', 4, 'unreadable'],
  ];

  for (const [outcome, units, expected] of cases) {
    it(`reads outcome '${outcome}' with ${units} units as '${expected}'`, () => {
      expect(readStateOf(row({ sourcePath: 'a.pdf', outcome, units }))).toBe(expected);
    });
  }

  it('never collapses an unreadable source into the zero-yield state', () => {
    const zeroYield = readStateOf(
      row({ sourcePath: 'a.pdf', outcome: 'empty-document', units: 0 }),
    );
    const unreadable = readStateOf(row({ sourcePath: 'b.pdf', outcome: 'unreadable', units: 0 }));
    expect(zeroYield).not.toBe(unreadable);
    // And neither is the state a caller would treat as evidence.
    expect(zeroYield).not.toBe('read');
    expect(unreadable).not.toBe('read');
  });

  it('reads a markdown source with a role-specific reader as read', () => {
    // outcome: null is markdown — the block parser read it, no extractor ran.
    expect(readStateOf(row({ sourcePath: 'p.md', format: null, outcome: null, units: 1 }))).toBe(
      'read',
    );
  });

  it("reads a markdown source no tier-3 reader covers as 'not-attempted'", () => {
    // The scenario "a markdown source no tier-3 reader covers is not counted
    // as read": outcome: null here is the extractor's silence, not its verdict.
    expect(
      readStateOf(
        row({
          sourcePath: 'm.md',
          format: null,
          role: 'course-material',
          outcome: null,
          units: 1,
          limitations: ['no-tier3-reader-for-role'],
        }),
      ),
    ).toBe('not-attempted');
  });
});

describe('summariseCoverageScope', () => {
  it('counts every state and sorts rows by path', () => {
    const scope = summariseCoverageScope([
      row({ sourcePath: 'z.pdf', outcome: 'unreadable', units: 0, citations: 0 }),
      row({ sourcePath: 'a.pdf', outcome: 'extracted', units: 4, citations: 2 }),
      row({ sourcePath: 'm.pdf', outcome: 'empty-document', units: 0, citations: 0 }),
    ]);
    expect(scope.sources.map((s) => s.sourcePath)).toEqual(['a.pdf', 'm.pdf', 'z.pdf']);
    expect(scope.readCount).toBe(1);
    expect(scope.yieldedNothingCount).toBe(1);
    expect(scope.unreadableCount).toBe(1);
    expect(scope.notAttemptedCount).toBe(0);
  });

  it('keeps the extractor verdict beside the derived state, so the derivation is checkable', () => {
    const scope = summariseCoverageScope([
      row({ sourcePath: 'a.pdf', outcome: 'no-pages-found', units: 0, citations: 0 }),
    ]);
    expect(scope.sources[0]?.outcome).toBe('no-pages-found');
    expect(scope.sources[0]?.readState).toBe('unreadable');
  });

  // The gate. This is the scenario "the exhaustiveness claim is gated on every
  // source having been read" — and the test the mutation proof in the task
  // report targets.
  describe('canStateExhaustiveness', () => {
    const allRead = [
      row({ sourcePath: 'a.pdf', outcome: 'extracted', units: 4, citations: 2 }),
      row({ sourcePath: 'b.pdf', outcome: 'extracted', units: 6, citations: 1 }),
    ];

    it('is true when every source read successfully', () => {
      expect(summariseCoverageScope(allRead).canStateExhaustiveness).toBe(true);
    });

    it('is withdrawn by a single zero-yield source', () => {
      const scope = summariseCoverageScope([
        ...allRead,
        row({ sourcePath: 'c.pdf', outcome: 'empty-document', units: 0, citations: 0 }),
      ]);
      expect(scope.canStateExhaustiveness).toBe(false);
    });

    it('is withdrawn by a single unreadable source', () => {
      const scope = summariseCoverageScope([
        ...allRead,
        row({ sourcePath: 'c.pdf', outcome: 'unreadable', units: 0, citations: 0 }),
      ]);
      expect(scope.canStateExhaustiveness).toBe(false);
    });

    it('is withdrawn by a single source no reader was run against', () => {
      const scope = summariseCoverageScope([
        ...allRead,
        row({
          sourcePath: 'c.md',
          format: null,
          role: 'course-material',
          outcome: null,
          units: 1,
          citations: 0,
          limitations: ['no-tier3-reader-for-role'],
        }),
      ]);
      expect(scope.canStateExhaustiveness).toBe(false);
    });

    it('is false for an empty scope — "we checked all zero of your sources" is the purest form of the claim this bead rejects', () => {
      expect(summariseCoverageScope([]).canStateExhaustiveness).toBe(false);
    });

    it('is not weakened by a read source that simply cited nothing', () => {
      // Zero citations from a source that was read is a MEASUREMENT (her
      // vocabulary is not in that document), not a failure — the claim stands.
      const scope = summariseCoverageScope([
        row({ sourcePath: 'a.pdf', outcome: 'extracted', units: 4, citations: 0 }),
      ]);
      expect(scope.canStateExhaustiveness).toBe(true);
    });
  });

  it('sourcesInState selects exactly the rows in that state', () => {
    const scope = summariseCoverageScope([
      row({ sourcePath: 'a.pdf', outcome: 'extracted', units: 4 }),
      row({ sourcePath: 'b.pdf', outcome: 'unreadable', units: 0 }),
      row({ sourcePath: 'c.pdf', outcome: 'reached-but-unreadable', units: 2 }),
    ]);
    expect(sourcesInState(scope, 'unreadable').map((s) => s.sourcePath)).toEqual([
      'b.pdf',
      'c.pdf',
    ]);
    expect(sourcesInState(scope, 'read').map((s) => s.sourcePath)).toEqual(['a.pdf']);
  });
});
