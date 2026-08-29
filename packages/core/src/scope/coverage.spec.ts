/**
 * `classifyDeclaredConcept` / `isVolunteer` acceptance tests — F8.2's
 * scenarios (`features/F8-concepts-scope.md`, service repo), asserted
 * directly against the pure classification rather than through a view.
 *
 * Every concept name below is invented, per INV-3.
 */
import { describe, expect, it } from 'vitest';
import { classifyDeclaredConcept, GROUND_STALL_STREAK_THRESHOLD, isVolunteer } from './coverage.js';

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
