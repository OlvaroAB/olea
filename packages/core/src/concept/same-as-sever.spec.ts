import { describe, expect, it } from 'vitest';
import type { ConceptKeyCanonicalIndex } from './key-store.js';
import type { SameAsLinkRecord } from './same-as.js';
import {
  buildSameAsKeyRedirect,
  findSameAsSeverConflicts,
  resolveConceptsWithSameAsLinks,
  type SameAsResolvableConcept,
} from './same-as-consumer.js';

// A sever inside a still-connected class ([D-498], KG-W1b, V-SEVER-HOLD): the conflicted class
// stays unfolded until she resolves it, so each identity reads alone. Invented keys only.

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
    ...(status === 'confirmed' || status === 'severed'
      ? { confirmedAt: '2026-10-02T00:00:00.000Z' }
      : {}),
    ...(status === 'severed' ? { severedAt: '2026-10-03T00:00:00.000Z' } : {}),
    schemaVersion: 1,
  };
}

function concept(key: string, course: string): SameAsResolvableConcept {
  return { key, courses: [course], sourcePaths: [] };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('sever inside a still-connected same-as class', () => {
  const ab = link('k-a', 'k-b');
  const bc = link('k-b', 'k-c');
  const acSevered = link('k-a', 'k-c', 'severed');

  it('a=b, b=c confirmed, a=c severed: the class does not fold through b', () => {
    const redirect = buildSameAsKeyRedirect([ab, bc, acSevered]);
    expect(redirect.size).toBe(0);
  });

  it('holds in every arrival order of the three link files', () => {
    for (const order of permutations([ab, bc, acSevered])) {
      expect(buildSameAsKeyRedirect(order).size).toBe(0);
    }
  });

  it('each identity reads alone: records keep their own keys and courses, nothing merges', () => {
    const concepts = [
      concept('k-a', 'course-1'),
      concept('k-b', 'course-2'),
      concept('k-c', 'course-3'),
    ];
    const out = resolveConceptsWithSameAsLinks(concepts, [ab, bc, acSevered]);
    expect(out.merged).toBe(0);
    expect(out.concepts).toBe(concepts);
  });

  it('her confirmations are preserved: the inputs are untouched and still confirmed', () => {
    const links = [ab, bc, acSevered];
    const before = JSON.stringify(links);
    buildSameAsKeyRedirect(links);
    expect(JSON.stringify(links)).toBe(before);
    expect(ab.status).toBe('confirmed');
    expect(bc.status).toBe('confirmed');
  });

  it('her sever is recorded: the conflict is reported with the severed pair and the held members', () => {
    const conflicts = findSameAsSeverConflicts([ab, bc, acSevered]);
    expect(conflicts).toEqual([
      {
        severed: [{ keyA: 'k-a', keyB: 'k-c' }],
        members: ['k-a', 'k-b', 'k-c'],
        confirmed: [
          { keyA: 'k-a', keyB: 'k-b' },
          { keyA: 'k-b', keyB: 'k-c' },
        ],
      },
    ]);
  });

  it('no alternate path folds: a longer detour a=b, b=d, d=c still holds the class', () => {
    const links = [link('k-a', 'k-b'), link('k-b', 'k-d'), link('k-c', 'k-d'), acSevered];
    expect(buildSameAsKeyRedirect(links).size).toBe(0);
    expect(findSameAsSeverConflicts(links)[0]?.members).toEqual(['k-a', 'k-b', 'k-c', 'k-d']);
  });

  it('an unrelated class is unaffected and still folds', () => {
    const links = [ab, bc, acSevered, link('k-x', 'k-y'), link('k-y', 'k-z')];
    const redirect = buildSameAsKeyRedirect(links);
    expect([...redirect.entries()].sort()).toEqual([
      ['k-y', 'k-x'],
      ['k-z', 'k-x'],
    ]);
    expect(findSameAsSeverConflicts(links)).toHaveLength(1);
  });

  it('a sever between two classes that are not otherwise connected is not a conflict (I4 still holds)', () => {
    const links = [link('k-a', 'k-b'), link('k-b', 'k-c', 'severed')];
    expect(buildSameAsKeyRedirect(links).get('k-b')).toBe('k-a');
    expect(buildSameAsKeyRedirect(links).has('k-c')).toBe(false);
    expect(findSameAsSeverConflicts(links)).toEqual([]);
  });

  it('she resolves it by severing another link: the remainder folds again, conflict gone', () => {
    const resolved = [link('k-a', 'k-b', 'severed'), bc, acSevered];
    const redirect = buildSameAsKeyRedirect(resolved);
    expect(redirect.get('k-c')).toBe('k-b');
    expect(redirect.has('k-a')).toBe(false);
    expect(findSameAsSeverConflicts(resolved)).toEqual([]);
  });

  it('a re-confirmed pair is no longer severed, so it is not a conflict', () => {
    const links = [ab, bc, link('k-a', 'k-c')];
    expect(buildSameAsKeyRedirect(links).get('k-c')).toBe('k-a');
    expect(findSameAsSeverConflicts(links)).toEqual([]);
  });

  it('works over canonical keys: a superseded duplicate does not smuggle the fold back in', () => {
    const index: ConceptKeyCanonicalIndex = {
      canonicalOf: (k) => (k === 'k-b2' ? 'k-b' : k),
      superseded: new Map([['k-b2', 'k-b']]),
    };
    const links = [link('k-a', 'k-b2'), bc, acSevered];
    const redirect = buildSameAsKeyRedirect(links, index);
    expect(redirect.get('k-b2')).toBe('k-b');
    expect(redirect.has('k-b')).toBe(false);
    expect(redirect.has('k-c')).toBe(false);
    expect(redirect.has('k-a')).toBe(false);
  });
});
