import { describe, expect, it } from 'vitest';
import {
  aliasesFor,
  EMPTY_REGISTRY_OVERRIDES,
  isConceptPruned,
  pruneConcept,
  renameConcept,
  resolvedDisplayName,
  unpruneConcept,
} from './overrides.js';

describe('renameConcept', () => {
  it('resolves to the original name when no override exists', () => {
    expect(resolvedDisplayName(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication')).toBe('Imbrication');
    expect(aliasesFor(EMPTY_REGISTRY_OVERRIDES, 'k1')).toEqual([]);
  });

  it('applies a rename: resolves to the new name, and the old name becomes an alias', () => {
    const next = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication', 'Rock layering');
    expect(resolvedDisplayName(next, 'k1', 'Imbrication')).toBe('Rock layering');
    expect(aliasesFor(next, 'k1')).toEqual(['Imbrication']);
  });

  it('a second rename adds the most recent name to the front of aliases', () => {
    const once = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication', 'Rock layering');
    const twice = renameConcept(once, 'k1', 'Imbrication', 'Sediment stacking');
    expect(resolvedDisplayName(twice, 'k1', 'Imbrication')).toBe('Sediment stacking');
    expect(aliasesFor(twice, 'k1')).toEqual(['Rock layering', 'Imbrication']);
  });

  it('renaming to the same resolved name is a no-op — same reference back', () => {
    const once = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication', 'Rock layering');
    const again = renameConcept(once, 'k1', 'Imbrication', 'Rock layering');
    expect(again).toBe(once);
  });

  it('renaming to blank is a no-op', () => {
    const result = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication', '   ');
    expect(result).toBe(EMPTY_REGISTRY_OVERRIDES);
  });

  it('renaming with no prior override to the original name is a no-op', () => {
    const result = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication', 'Imbrication');
    expect(result).toBe(EMPTY_REGISTRY_OVERRIDES);
  });

  it('renaming back to the original name clears the override, and drops the alias trail', () => {
    const renamed = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication', 'Rock layering');
    const revertedBack = renameConcept(renamed, 'k1', 'Imbrication', 'Imbrication');
    expect(resolvedDisplayName(revertedBack, 'k1', 'Imbrication')).toBe('Imbrication');
    expect(aliasesFor(revertedBack, 'k1')).toEqual([]);
    expect(revertedBack.renames.k1).toBeUndefined();
  });

  it('never deletes evidence: renaming one concept leaves every other override untouched', () => {
    const withTwo = renameConcept(
      renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'A', 'A renamed'),
      'k2',
      'B',
      'B renamed',
    );
    const afterThirdRename = renameConcept(withTwo, 'k1', 'A', 'A renamed twice');
    expect(resolvedDisplayName(afterThirdRename, 'k2', 'B')).toBe('B renamed');
  });
});

describe('pruning', () => {
  it('a fresh concept is not pruned', () => {
    expect(isConceptPruned(EMPTY_REGISTRY_OVERRIDES, 'k1')).toBe(false);
  });

  it('prune marks withdrawn; unprune restores — never a delete', () => {
    const pruned = pruneConcept(EMPTY_REGISTRY_OVERRIDES, 'k1');
    expect(isConceptPruned(pruned, 'k1')).toBe(true);
    const restored = unpruneConcept(pruned, 'k1');
    expect(isConceptPruned(restored, 'k1')).toBe(false);
    // Restoring is total: nothing about the overrides shape carries a mark
    // that this concept was ever pruned.
    expect(restored).toEqual(EMPTY_REGISTRY_OVERRIDES);
  });

  it('pruning twice is a no-op — same reference back', () => {
    const pruned = pruneConcept(EMPTY_REGISTRY_OVERRIDES, 'k1');
    expect(pruneConcept(pruned, 'k1')).toBe(pruned);
  });

  it('unpruning a never-pruned concept is a no-op — same reference back', () => {
    expect(unpruneConcept(EMPTY_REGISTRY_OVERRIDES, 'k1')).toBe(EMPTY_REGISTRY_OVERRIDES);
  });

  it('pruning one concept leaves another concept unaffected', () => {
    const pruned = pruneConcept(pruneConcept(EMPTY_REGISTRY_OVERRIDES, 'k1'), 'k2');
    const restoredOne = unpruneConcept(pruned, 'k1');
    expect(isConceptPruned(restoredOne, 'k1')).toBe(false);
    expect(isConceptPruned(restoredOne, 'k2')).toBe(true);
  });
});
