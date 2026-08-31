/**
 * `classifyDeclaredConcept` / `isVolunteer` / `containerNamesToFold`
 * acceptance tests — F8.2's scenarios (`features/F8-concepts-scope.md`,
 * service repo) plus C7.9's part-of fold scenario
 * (`features/F1-sources.md`, "a broad area and its own part are never
 * counted as separate peers against the examiner's denominator",
 * `ol-5phn`), asserted directly against the pure classification/fold rather
 * than through a view.
 *
 * Every concept name below is invented, per INV-3.
 */
import { describe, expect, it } from 'vitest';
import type { ConceptRelation, RelationType } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import {
  classifyDeclaredConcept,
  containerNamesToFold,
  GROUND_STALL_STREAK_THRESHOLD,
  isVolunteer,
} from './coverage.js';

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

// A part-of B: `from` is the finer/part side, `to` is the coarser/container
// side — the same convention `../session/containment.spec.ts`'s own `edge()`
// helper uses.
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

describe('classifyDeclaredConcept — F8.2 ground', () => {
  it('reads `ground` for material present with nothing generated yet, and nothing else', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).toEqual({ kind: 'cell', state: 'ground', stall: false, groundStreak: 1 });
  });

  it('never reads `ground` for a concept whose instruments exist and are simply unpractised — that is `seed`', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 1,
      masteryState: 'seed',
      priorGroundStreak: 0,
    });
    expect(result).toEqual({ kind: 'cell', state: 'seed', stall: false, groundStreak: 0 });
  });

  it('never reads `ground` where the material itself is absent — that is a material gap, not ground', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).toEqual({ kind: 'material-gap' });
  });

  it('week-one material gaps stay a material gap even with a nonzero prior ground streak', () => {
    // Guards against a caller accidentally carrying a streak across what is
    // actually a material gap this evaluation (e.g. her objectives doc named
    // lectures that have not happened yet).
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 3,
    });
    expect(result).toEqual({ kind: 'material-gap' });
  });
});

describe('classifyDeclaredConcept — F4.5 stall, under [D-063]', () => {
  it('a first-time `ground` reading is not yet a stall', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).toMatchObject({ state: 'ground', stall: false });
  });

  it('a `ground` cell that persists across desktop sessions is flagged a stall (F4.5), never a policy outcome', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: GROUND_STALL_STREAK_THRESHOLD - 1,
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'ground',
      stall: true,
      groundStreak: GROUND_STALL_STREAK_THRESHOLD,
    });
  });

  it('the streak resets to zero the moment an instrument exists', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 1,
      masteryState: 'sprout',
      priorGroundStreak: 5,
    });
    expect(result).toEqual({ kind: 'cell', state: 'sprout', stall: false, groundStreak: 0 });
  });

  it('throws rather than guess a mastery state when an instrument exists but none was supplied', () => {
    expect(() =>
      classifyDeclaredConcept({ hasMaterial: true, instrumentCount: 1, priorGroundStreak: 0 }),
    ).toThrow(/requires a masteryState/);
  });
});

describe('isVolunteer — F8.2 self-sown concepts', () => {
  it('a concept the declared scope never names is a volunteer', () => {
    expect(isVolunteer('Invented Concept X', new Set(['Invented Concept Y']))).toBe(true);
  });

  it('a concept the declared scope does name is never a volunteer', () => {
    expect(isVolunteer('Invented Concept Y', new Set(['Invented Concept Y']))).toBe(false);
  });
});

describe('containerNamesToFold — C7.9, "a broad area and its own part are never counted as separate peers" (features/F1-sources.md)', () => {
  it('a broad concept and one of its own sized parts are never counted as separate peers against the denominator', () => {
    // Given a broad concept and one of its own sized parts, both in a
    // course's grove (both declared) — when the fold runs, the container
    // side (`to`) is the one dropped, never the part.
    const declaredNames = new Set(['Invented Part', 'Invented Broad Area']);
    const drop = containerNamesToFold(
      [partOf('Invented Part', 'Invented Broad Area')],
      declaredNames,
    );
    expect(drop).toEqual(new Set(['Invented Broad Area']));
  });

  it('drops nothing when only the container is declared and its part is not', () => {
    const declaredNames = new Set(['Invented Broad Area']);
    const drop = containerNamesToFold(
      [partOf('Invented Part', 'Invented Broad Area')],
      declaredNames,
    );
    expect(drop.size).toBe(0);
  });

  it('drops nothing when only the part is declared and its container is not', () => {
    const declaredNames = new Set(['Invented Part']);
    const drop = containerNamesToFold(
      [partOf('Invented Part', 'Invented Broad Area')],
      declaredNames,
    );
    expect(drop.size).toBe(0);
  });

  it('ignores relation types other than part-of, even when both endpoints are declared', () => {
    const declaredNames = new Set(['Invented Concept A', 'Invented Concept B']);
    const drop = containerNamesToFold(
      [partOf('Invented Concept A', 'Invented Concept B', 'prerequisite')],
      declaredNames,
    );
    expect(drop.size).toBe(0);
  });

  it('is a no-op over an empty edge set — the default for every caller that has not threaded relations through', () => {
    const declaredNames = new Set(['Invented Part', 'Invented Broad Area']);
    expect(containerNamesToFold([], declaredNames).size).toBe(0);
  });
});
