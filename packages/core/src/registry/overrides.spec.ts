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

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-206] —
// the rename-proposal baseline survives a restart", tagged
// `@auto:core/registry/overrides.spec`.
describe('renameConcept — sourceTier (`[D-206]`)', () => {
  it('a rename accepted from a tiered candidate carries that tier as sourceTier', () => {
    const next = renameConcept(
      EMPTY_REGISTRY_OVERRIDES,
      'k1',
      'Slide-deck wording',
      'Tag wording',
      2,
    );
    expect(next.renames.k1).toEqual({
      displayName: 'Tag wording',
      aliases: ['Slide-deck wording'],
      sourceTier: 2,
    });
  });

  it('a plain rename with no tier argument carries no sourceTier at all', () => {
    const next = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication', 'Rock layering');
    expect(next.renames.k1?.sourceTier).toBeUndefined();
    expect('sourceTier' in (next.renames.k1 ?? {})).toBe(false);
  });

  it('a later hand-typed rename over an accepted one clears the earlier sourceTier', () => {
    const accepted = renameConcept(
      EMPTY_REGISTRY_OVERRIDES,
      'k1',
      'Slide-deck wording',
      'Tag wording',
      2,
    );
    const retyped = renameConcept(accepted, 'k1', 'Slide-deck wording', 'Her own wording');
    expect(retyped.renames.k1?.sourceTier).toBeUndefined();
    expect(retyped.renames.k1?.displayName).toBe('Her own wording');
  });

  it('renaming back to the original name clears sourceTier along with the rest of the override', () => {
    const accepted = renameConcept(
      EMPTY_REGISTRY_OVERRIDES,
      'k1',
      'Slide-deck wording',
      'Tag wording',
      2,
    );
    const revertedBack = renameConcept(accepted, 'k1', 'Slide-deck wording', 'Slide-deck wording');
    expect(revertedBack.renames.k1).toBeUndefined();
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-206] —
// existing overrides without the new fields still load", tagged
// `@auto:core/registry/overrides.spec`.
describe('RegistryOverrides — additive [D-206] fields, no migration', () => {
  it('an overrides value written before [D-206] has no sourceTier and no declinedRenameSignatures', () => {
    // Exactly the shape a pre-[D-206] `renameConcept` call already produced
    // — nothing here has been touched to add the new fields, matching what
    // a file written by the OLD code, then loaded by the NEW code, looks
    // like before anything is written again.
    const legacy = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'k1', 'Imbrication', 'Rock layering');
    expect(legacy.renames.k1?.sourceTier).toBeUndefined();
    expect(legacy.declinedRenameSignatures).toBeUndefined();
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
