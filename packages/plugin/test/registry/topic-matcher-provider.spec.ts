/**
 * `[D-322]` production composer tests for `../../src/registry/topic-matcher-provider.ts`
 * (`ol-egov.141.89.6.4`). `../../src/explain-back/request.ts`'s pure
 * `matchFreeformTopicToConcept` already has its own matching-rule tests
 * (`explain-back/request.spec.ts`); this file exercises the one thing that
 * module cannot test itself — turning the plugin's already-cached
 * `ConceptRecord[]`/`RegistryOverrides` into the candidate list that pure
 * function needs, the same registry shape `registry/provider.ts`'s
 * `buildRegistryModel` reads (`resolvedDisplayName`, `aliasesFor`,
 * `isConceptPruned`), reused rather than re-derived.
 *
 * No `obsidian` import anywhere in this file (INV-1).
 */

import {
  type ConceptRecord,
  EMPTY_REGISTRY_OVERRIDES,
  type RegistryOverrides,
  renameConcept,
} from 'olea-core';
import { describe, expect, it } from 'vitest';

import {
  createFreeformTopicMatcher,
  freeformTopicConceptCandidatesFrom,
} from '../../src/registry/topic-matcher-provider.js';

function conceptFixture(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    key: 'concept-key-chunking',
    name: 'Chunking',
    tier: 1,
    courses: ['COGS214'],
    sourcePaths: ['zettelkasten/Chunking.md'],
    ...overrides,
  };
}

describe('freeformTopicConceptCandidatesFrom', () => {
  it('carries the key as conceptId, the vault name, and the course list verbatim', () => {
    const candidates = freeformTopicConceptCandidatesFrom(
      [conceptFixture()],
      EMPTY_REGISTRY_OVERRIDES,
    );
    expect(candidates).toEqual([
      { conceptId: 'concept-key-chunking', names: ['Chunking'], courses: ['COGS214'] },
    ]);
  });

  it("adds a rename override's displayName and prior-name alias to the candidate names, never dropping the vault name", () => {
    const overrides = renameConcept(
      EMPTY_REGISTRY_OVERRIDES,
      'concept-key-chunking',
      'Chunking',
      'Chunking together',
    );
    const candidates = freeformTopicConceptCandidatesFrom([conceptFixture()], overrides);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.conceptId).toBe('concept-key-chunking');
    expect(candidates[0]?.names).toEqual(expect.arrayContaining(['Chunking together', 'Chunking']));
  });

  it('excludes a pruned concept — a withdrawn concept never resolves as a freeform subject', () => {
    const overrides = {
      ...EMPTY_REGISTRY_OVERRIDES,
      prunedConceptKeys: ['concept-key-chunking'],
    } satisfies RegistryOverrides;
    const candidates = freeformTopicConceptCandidatesFrom([conceptFixture()], overrides);
    expect(candidates).toEqual([]);
  });

  it('keeps two different concepts that happen to share a name as two separate candidates', () => {
    const candidates = freeformTopicConceptCandidatesFrom(
      [
        conceptFixture({ key: 'concept-key-chunking-cogs', courses: ['COGS214'] }),
        conceptFixture({ key: 'concept-key-chunking-psych', courses: ['PSYCH326'] }),
      ],
      EMPTY_REGISTRY_OVERRIDES,
    );
    expect(candidates.map((c) => c.conceptId).sort()).toEqual([
      'concept-key-chunking-cogs',
      'concept-key-chunking-psych',
    ]);
  });
});

describe('createFreeformTopicMatcher', () => {
  it("resolves a unique name match to the concept's permanent id", () => {
    const match = createFreeformTopicMatcher({
      conceptRecords: () => [conceptFixture()],
      overrides: () => EMPTY_REGISTRY_OVERRIDES,
    })('chunking');
    expect(match).toEqual({ kind: 'unique', conceptId: 'concept-key-chunking' });
  });

  it('reports ambiguous, never a guess, when two courses share a name and no course is known', () => {
    const match = createFreeformTopicMatcher({
      conceptRecords: () => [
        conceptFixture({ key: 'concept-key-chunking-cogs', courses: ['COGS214'] }),
        conceptFixture({ key: 'concept-key-chunking-psych', courses: ['PSYCH326'] }),
      ],
      overrides: () => EMPTY_REGISTRY_OVERRIDES,
    })('chunking');
    expect(match.kind).toBe('ambiguous');
  });

  it('is course-aware: a known course code narrows an otherwise-ambiguous name to one candidate', () => {
    const match = createFreeformTopicMatcher({
      conceptRecords: () => [
        conceptFixture({ key: 'concept-key-chunking-cogs', courses: ['COGS214'] }),
        conceptFixture({ key: 'concept-key-chunking-psych', courses: ['PSYCH326'] }),
      ],
      overrides: () => EMPTY_REGISTRY_OVERRIDES,
      courseCode: () => 'PSYCH326',
    })('chunking');
    expect(match).toEqual({ kind: 'unique', conceptId: 'concept-key-chunking-psych' });
  });

  it('reports no-match rather than throwing when no vault walk has completed yet', () => {
    const match = createFreeformTopicMatcher({
      conceptRecords: () => null,
      overrides: () => EMPTY_REGISTRY_OVERRIDES,
    })('anything');
    expect(match).toEqual({ kind: 'no-match' });
  });

  it('matches a renamed concept by its prior (aliased) name, never only its current display name', () => {
    const overrides = renameConcept(
      EMPTY_REGISTRY_OVERRIDES,
      'concept-key-chunking',
      'Chunking',
      'Chunking together',
    );
    const match = createFreeformTopicMatcher({
      conceptRecords: () => [conceptFixture()],
      overrides: () => overrides,
    })('chunking');
    expect(match).toEqual({ kind: 'unique', conceptId: 'concept-key-chunking' });
  });
});
