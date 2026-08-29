/**
 * `resolveRelatedConceptKeys` (`ol-v7r5.11`, F2.19) — the name→`conceptKey`
 * join `study-session/compose.ts`'s within-block grouping seam needs and had
 * no production caller for. See the module doc for the reused derivation and
 * the reversible "every relation type counts, adjacency is symmetric"
 * default.
 *
 * INV-3: every concept name and course code below is coined for the test.
 * None is drawn from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../extract/types.js';
import { resolveRelatedConceptKeys } from './related-concept-keys.js';
import type { ConceptRelation, RelationProvenanceKind, RelationType } from './relation.js';
import type { ConceptRecord } from './types.js';

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

function edge(
  type: RelationType,
  from: string,
  to: string,
  options: { confidence?: number; provenance?: RelationProvenanceKind } = {},
): ConceptRelation {
  return {
    type,
    from,
    to,
    provenance: options.provenance ?? 'model-proposed',
    confidence: options.confidence ?? 0.5,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
  };
}

function concept(
  name: string,
  key: string,
  courses: readonly string[] = ['CRS101'],
): ConceptRecord {
  return { key, name, tier: 1, courses, sourcePaths: [] };
}

describe('resolveRelatedConceptKeys', () => {
  it('joins both endpoints of a resolvable relation to a symmetric adjacency entry, keyed on conceptKey (never the name)', () => {
    const concepts = [concept('Photosynthesis', 'key-photo'), concept('Respiration', 'key-resp')];
    const relations = [edge('related' as RelationType, 'Photosynthesis', 'Respiration')];

    const result = resolveRelatedConceptKeys(relations, concepts);

    expect(result.unresolvedEndpointCount).toBe(0);
    expect(result.relatedConceptKeys.get('key-photo')).toEqual(new Set(['key-resp']));
    expect(result.relatedConceptKeys.get('key-resp')).toEqual(new Set(['key-photo']));
    // The names themselves never appear as keys once resolution has run.
    expect(result.relatedConceptKeys.has('Photosynthesis')).toBe(false);
  });

  it('is type-agnostic: every C7.10 relation type present counts as a connection (the reversible default, per the module doc)', () => {
    const concepts = [concept('A', 'k-a'), concept('B', 'k-b'), concept('C', 'k-c')];
    const relations = [edge('prerequisite', 'A', 'B'), edge('contrasts-with', 'B', 'C')];

    const result = resolveRelatedConceptKeys(relations, concepts);

    expect(result.relatedConceptKeys.get('k-a')).toEqual(new Set(['k-b']));
    expect(result.relatedConceptKeys.get('k-b')).toEqual(new Set(['k-a', 'k-c']));
    expect(result.relatedConceptKeys.get('k-c')).toEqual(new Set(['k-b']));
  });

  it('drops an edge with one unresolved endpoint from the map, but COUNTS the miss rather than absorbing it silently', () => {
    const concepts = [concept('Photosynthesis', 'key-photo')];
    // 'Respiration' names no known concept.
    const relations = [edge('related' as RelationType, 'Photosynthesis', 'Respiration')];

    const result = resolveRelatedConceptKeys(relations, concepts);

    expect(result.unresolvedEndpointCount).toBe(1);
    expect(result.relatedConceptKeys.has('key-photo')).toBe(false);
    expect([...result.relatedConceptKeys.keys()]).toEqual([]);
  });

  it('counts BOTH endpoints when neither resolves (two misses from one edge)', () => {
    const result = resolveRelatedConceptKeys(
      [edge('related' as RelationType, 'Nowhere', 'AlsoNowhere')],
      [concept('Somewhere', 'key-somewhere')],
    );

    expect(result.unresolvedEndpointCount).toBe(2);
    expect(result.relatedConceptKeys.size).toBe(0);
  });

  it('is exact-match only, the same derivation evidence-edge/build.ts uses (ol-63e1) — a differently-cased name is an honest miss, not a fold', () => {
    const concepts = [concept('Photosynthesis', 'key-photo'), concept('Respiration', 'key-resp')];
    // Lower-cased 'respiration' does not exact-match 'Respiration'.
    const relations = [edge('related' as RelationType, 'Photosynthesis', 'respiration')];

    const result = resolveRelatedConceptKeys(relations, concepts);

    expect(result.unresolvedEndpointCount).toBe(1);
    expect(result.relatedConceptKeys.size).toBe(0);
  });

  it('multiple edges accumulate into one adjacency set per concept, deduplicated', () => {
    const concepts = [concept('A', 'k-a'), concept('B', 'k-b'), concept('C', 'k-c')];
    const relations = [
      edge('is-a', 'A', 'B'),
      edge('part-of', 'A', 'C'),
      edge('related' as RelationType, 'B', 'A'),
    ];

    const result = resolveRelatedConceptKeys(relations, concepts);

    expect(result.relatedConceptKeys.get('k-a')).toEqual(new Set(['k-b', 'k-c']));
    expect(result.unresolvedEndpointCount).toBe(0);
  });

  it('a self-relation (both endpoints resolve to the same key) contributes no adjacency and is not counted as a miss', () => {
    const concepts = [concept('A', 'k-a')];
    const result = resolveRelatedConceptKeys([edge('related' as RelationType, 'A', 'A')], concepts);

    expect(result.unresolvedEndpointCount).toBe(0);
    expect(result.relatedConceptKeys.size).toBe(0);
  });

  it('empty relations or empty concepts produce an empty map with zero misses', () => {
    expect(resolveRelatedConceptKeys([], [])).toEqual({
      relatedConceptKeys: new Map(),
      unresolvedEndpointCount: 0,
    });
  });
});
