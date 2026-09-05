/**
 * C7.10's `prerequisite` reader (`MOM-8.2`, `ol-3ux7.5.57.9.2`), scenario
 * `features/F2-review.md` "an edge resolves to a prerequisite-before-dependent
 * adjacency on concept keys".
 *
 * Mutation-style: every assertion here reads differently if the resolver
 * ignored the edge type, inverted `from`/`to`, or guessed at an unresolved
 * endpoint.
 */

import { describe, expect, it } from 'vitest';
import { orderByPrerequisite, resolvePrerequisiteConceptKeys } from './prerequisite-order.js';
import type { ConceptRelation } from './relation.js';
import type { ConceptRecord } from './types.js';

function concept(name: string, key: string): ConceptRecord {
  return {
    key,
    name,
    aliases: [],
    courses: [],
    sources: [],
    firstSeen: '2026-08-01T00:00:00.000Z',
  } as unknown as ConceptRecord;
}

function edge(type: ConceptRelation['type'], from: string, to: string): ConceptRelation {
  return {
    type,
    from,
    to,
    confidence: 0.9,
    provenance: {
      kind: 'model-proposed',
      fromPassage: { sourcePath: 'a.md', location: { page: 1, charRange: { start: 0, end: 5 } } },
      toPassage: { sourcePath: 'b.md', location: { page: 1, charRange: { start: 0, end: 5 } } },
    },
  } as unknown as ConceptRelation;
}

const CONCEPTS = [concept('Alpha', 'key-alpha'), concept('Beta', 'key-beta')];

describe('resolvePrerequisiteConceptKeys', () => {
  it('keys the dependent at the prerequisite, per the canonical from/to reading', () => {
    const { prerequisiteConceptKeys, unresolvedEndpointCount } = resolvePrerequisiteConceptKeys(
      [edge('prerequisite', 'Alpha', 'Beta')],
      CONCEPTS,
    );
    // `from` = prerequisite, `to` = dependent (ol-2zfj.17): Beta depends on Alpha.
    expect([...prerequisiteConceptKeys.keys()]).toEqual(['key-beta']);
    expect([...(prerequisiteConceptKeys.get('key-beta') ?? [])]).toEqual(['key-alpha']);
    expect(prerequisiteConceptKeys.has('key-alpha')).toBe(false);
    expect(unresolvedEndpointCount).toBe(0);
  });

  it('ignores every other relation type rather than rejecting it', () => {
    const { prerequisiteConceptKeys } = resolvePrerequisiteConceptKeys(
      [
        edge('is-a', 'Alpha', 'Beta'),
        edge('part-of', 'Alpha', 'Beta'),
        edge('contrasts-with', 'Alpha', 'Beta'),
      ],
      CONCEPTS,
    );
    expect(prerequisiteConceptKeys.size).toBe(0);
  });

  it('drops an edge whose endpoint matches no known concept, and counts the miss', () => {
    const { prerequisiteConceptKeys, unresolvedEndpointCount } = resolvePrerequisiteConceptKeys(
      [edge('prerequisite', 'Alpha', 'Nowhere')],
      CONCEPTS,
    );
    expect(prerequisiteConceptKeys.size).toBe(0);
    expect(unresolvedEndpointCount).toBe(1);
  });
});

describe('orderByPrerequisite', () => {
  const keyOf = (entry: string) => entry;

  it('moves the prerequisite ahead of its dependent', () => {
    const map = new Map([['key-beta', new Set(['key-alpha'])]]);
    expect(orderByPrerequisite(['key-beta', 'key-alpha'], keyOf, map)).toEqual([
      'key-alpha',
      'key-beta',
    ]);
  });

  it('is a byte-for-byte no-op with no map, an empty map, or no matching entry', () => {
    const incoming = ['key-beta', 'key-alpha'];
    expect(orderByPrerequisite(incoming, keyOf, undefined)).toBe(incoming);
    expect(orderByPrerequisite(incoming, keyOf, new Map())).toBe(incoming);
    expect(
      orderByPrerequisite(incoming, keyOf, new Map([['key-elsewhere', new Set(['key-other'])]])),
    ).toBe(incoming);
  });

  it('delays only the dependent, and leaves every unrelated entry where it was', () => {
    // Stable Kahn takes the earliest still-eligible entry, so `key-beta` waits
    // for `key-alpha` and nothing else moves — the smallest reordering that
    // satisfies the edge, rather than pulling the prerequisite to the front.
    const map = new Map([['key-beta', new Set(['key-alpha'])]]);
    expect(orderByPrerequisite(['x', 'key-beta', 'y', 'key-alpha', 'z'], keyOf, map)).toEqual([
      'x',
      'y',
      'key-alpha',
      'key-beta',
      'z',
    ]);
  });

  it('leaves a cycle in incoming order rather than throwing or dropping members', () => {
    const map = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['a'])],
    ]);
    expect(orderByPrerequisite(['b', 'a'], keyOf, map)).toEqual(['b', 'a']);
  });
});
