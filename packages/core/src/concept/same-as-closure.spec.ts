import { describe, expect, it } from 'vitest';
import type { ConceptKeyCanonicalIndex } from './key-store.js';
import type { SameAsLinkRecord } from './same-as.js';
import {
  buildSameAsKeyRedirect,
  resolveConceptsWithSameAsLinks,
  type SameAsResolvableConcept,
} from './same-as-consumer.js';

// Identity closure ([D-295]): confirmed links read over canonical keys form connected classes;
// every member reads as one identity under one code-unit-first representative, whatever order
// the link files arrive in. Invented keys and course labels only.

function link(
  keyA: string,
  keyB: string,
  status: SameAsLinkRecord['status'] = 'confirmed',
): SameAsLinkRecord {
  return {
    keyA,
    keyB,
    status,
    reason: 'normalisation-collision',
    proposedAt: '2026-10-01T00:00:00.000Z',
    ...(status === 'confirmed' ? { confirmedAt: '2026-10-02T00:00:00.000Z' } : {}),
    schemaVersion: 1,
  };
}

function concept(key: string, course: string): SameAsResolvableConcept {
  return { key, courses: [course], sourcePaths: [] };
}

const noIndex: ConceptKeyCanonicalIndex = { canonicalOf: (k) => k, superseded: new Map() };

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/** The classes, as sorted member lists keyed by representative, over the keys given. */
function classesOf(
  redirect: ReadonlyMap<string, string>,
  keys: readonly string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of keys) {
    const rep = redirect.get(key) ?? key;
    // a representative must be a fixed point: one step reaches the final key
    expect(redirect.get(rep) ?? rep).toBe(rep);
    const members = out[rep] ?? [];
    members.push(key);
    out[rep] = members;
  }
  for (const members of Object.values(out)) members.sort();
  return out;
}

const KEYS = ['k-a', 'k-b', 'k-c', 'k-d'];

describe('same-as closure over confirmed links', () => {
  for (const [label, index] of [
    ['without the canonical-key index', undefined],
    ['with the canonical-key index', noIndex],
  ] as const) {
    describe(label, () => {
      it('I1 chain a=b, b=c reads as one class under k-a', () => {
        const r = buildSameAsKeyRedirect([link('k-a', 'k-b'), link('k-b', 'k-c')], index);
        expect(classesOf(r, KEYS.slice(0, 3))).toEqual({ 'k-a': ['k-a', 'k-b', 'k-c'] });
      });

      it('I2 star a=c, b=c reads as one class under k-a', () => {
        const r = buildSameAsKeyRedirect([link('k-a', 'k-c'), link('k-b', 'k-c')], index);
        expect(classesOf(r, KEYS.slice(0, 3))).toEqual({ 'k-a': ['k-a', 'k-b', 'k-c'] });
      });

      it('I3 reverse file order gives the same class and representative', () => {
        const r = buildSameAsKeyRedirect([link('k-b', 'k-c'), link('k-a', 'k-b')], index);
        expect(classesOf(r, KEYS.slice(0, 3))).toEqual({ 'k-a': ['k-a', 'k-b', 'k-c'] });
      });

      it('I3 every permutation of up to 4 links gives identical classes and representative', () => {
        const sets: SameAsLinkRecord[][] = [
          [link('k-a', 'k-b'), link('k-b', 'k-c'), link('k-c', 'k-d')], // chain of four
          [link('k-a', 'k-d'), link('k-b', 'k-d'), link('k-c', 'k-d')], // star
          [link('k-a', 'k-b'), link('k-c', 'k-d'), link('k-b', 'k-c'), link('k-a', 'k-d')], // cycle
          [link('k-b', 'k-c'), link('k-a', 'k-b'), link('k-c', 'k-d')],
        ];
        for (const links of sets) {
          const expected = JSON.stringify(classesOf(buildSameAsKeyRedirect(links, index), KEYS));
          expect(JSON.parse(expected)).toEqual({ 'k-a': KEYS });
          for (const perm of permutations(links)) {
            const got = classesOf(buildSameAsKeyRedirect(perm, index), KEYS);
            expect(JSON.stringify(got)).toBe(expected);
          }
        }
      });

      it('permutations of two disjoint classes stay two classes', () => {
        const links = [link('k-a', 'k-b'), link('k-c', 'k-d')];
        for (const perm of permutations(links)) {
          expect(classesOf(buildSameAsKeyRedirect(perm, index), KEYS)).toEqual({
            'k-a': ['k-a', 'k-b'],
            'k-c': ['k-c', 'k-d'],
          });
        }
      });

      it('a class of four built from two halves, then joined by one link', () => {
        const halves = [link('k-a', 'k-b'), link('k-c', 'k-d')];
        expect(classesOf(buildSameAsKeyRedirect(halves, index), KEYS)).toEqual({
          'k-a': ['k-a', 'k-b'],
          'k-c': ['k-c', 'k-d'],
        });
        const joined = [...halves, link('k-b', 'k-d')];
        for (const perm of permutations(joined)) {
          expect(classesOf(buildSameAsKeyRedirect(perm, index), KEYS)).toEqual({ 'k-a': KEYS });
        }
      });

      it('I4 chain then b=c severed gives two classes {a,b} and {c}', () => {
        const r = buildSameAsKeyRedirect(
          [link('k-a', 'k-b'), link('k-b', 'k-c', 'severed')],
          index,
        );
        expect(classesOf(r, KEYS.slice(0, 3))).toEqual({ 'k-a': ['k-a', 'k-b'], 'k-c': ['k-c'] });
      });

      it('proposed and declined links contribute no edge', () => {
        const r = buildSameAsKeyRedirect(
          [link('k-a', 'k-b'), link('k-b', 'k-c', 'proposed'), link('k-c', 'k-d', 'declined')],
          index,
        );
        expect(classesOf(r, KEYS)).toEqual({
          'k-a': ['k-a', 'k-b'],
          'k-c': ['k-c'],
          'k-d': ['k-d'],
        });
      });

      it('the representative is code-unit-first even when a link lists the larger key as keyA', () => {
        const r = buildSameAsKeyRedirect([link('k-c', 'k-b'), link('k-b', 'k-a')], index);
        expect(classesOf(r, KEYS.slice(0, 3))).toEqual({ 'k-a': ['k-a', 'k-b', 'k-c'] });
      });
    });
  }

  it('a superseded duplicate key inside a class reads as the class representative', () => {
    // k-z is a superseded duplicate of k-b (same anchor). a=z and b=c are confirmed; the
    // duplicate must land in the same class, in every link order.
    const index: ConceptKeyCanonicalIndex = {
      canonicalOf: (k) => (k === 'k-z' ? 'k-b' : k),
      superseded: new Map([['k-z', 'k-b']]),
    };
    const links = [link('k-a', 'k-z'), link('k-b', 'k-c')];
    for (const perm of permutations(links)) {
      const r = buildSameAsKeyRedirect(perm, index);
      expect(classesOf(r, ['k-a', 'k-b', 'k-c', 'k-z'])).toEqual({
        'k-a': ['k-a', 'k-b', 'k-c', 'k-z'],
      });
    }
  });

  it('a superseded duplicate of the class representative still redirects to it', () => {
    const index: ConceptKeyCanonicalIndex = {
      canonicalOf: (k) => (k === 'k-a2' ? 'k-a' : k),
      superseded: new Map([['k-a2', 'k-a']]),
    };
    const r = buildSameAsKeyRedirect([link('k-a', 'k-b'), link('k-b', 'k-c')], index);
    expect(classesOf(r, ['k-a', 'k-a2', 'k-b', 'k-c'])).toEqual({
      'k-a': ['k-a', 'k-a2', 'k-b', 'k-c'],
    });
  });

  describe('records folded through the class', () => {
    const concepts = [
      concept('k-a', 'course-A'),
      concept('k-b', 'course-B'),
      concept('k-c', 'course-C'),
    ];

    it('I1/I2/I3 fold to one identity under k-a with all three courses', () => {
      for (const links of [
        [link('k-a', 'k-b'), link('k-b', 'k-c')],
        [link('k-a', 'k-c'), link('k-b', 'k-c')],
        [link('k-b', 'k-c'), link('k-a', 'k-b')],
      ]) {
        for (const index of [undefined, noIndex]) {
          const out = resolveConceptsWithSameAsLinks(concepts, links, index);
          expect(out.concepts.map((c) => [c.key, c.courses])).toEqual([
            ['k-a', ['course-A', 'course-B', 'course-C']],
          ]);
          expect(out.merged).toBe(2);
        }
      }
    });

    it('I4 sever inside the chain leaves {a,b} and {c}', () => {
      const out = resolveConceptsWithSameAsLinks(concepts, [
        link('k-a', 'k-b'),
        link('k-b', 'k-c', 'severed'),
      ]);
      expect(out.concepts.map((c) => [c.key, c.courses])).toEqual([
        ['k-a', ['course-A', 'course-B']],
        ['k-c', ['course-C']],
      ]);
    });

    it('I6 a confirmed same-as across courses A and B: recognition reads both, nothing pools', () => {
      // Today's semantics: the folded identity carries the union of its course memberships
      // (what recognition reads); no record is rewritten, so readiness and demand support,
      // which stay keyed per course membership, are not pooled by this view.
      const input = [concept('k-a', 'course-A'), concept('k-b', 'course-B')];
      const out = resolveConceptsWithSameAsLinks(input, [link('k-a', 'k-b')]);
      expect(out.concepts).toHaveLength(1);
      expect(out.concepts[0]?.courses).toEqual(['course-A', 'course-B']);
      expect(input[1]?.key).toBe('k-b');
      expect(input[1]?.courses).toEqual(['course-B']);
    });
  });
});
