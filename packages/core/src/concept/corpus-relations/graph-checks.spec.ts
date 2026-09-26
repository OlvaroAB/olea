/**
 * `./graph-checks.ts` — rel.md §3 Default 2: a prerequisite-only cycle report that blocks only the
 * edges strictly between two of its own members, never a member's edge to a dependent outside it.
 *
 * INV-3: every key here is coined. No course code, note title or wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import {
  findPrerequisiteCycles,
  isEdgeBlockedByCycle,
  violatesPredicateContract,
} from './graph-checks.js';

describe('findPrerequisiteCycles', () => {
  it('reports no cycle over an acyclic chain', () => {
    const report = findPrerequisiteCycles([
      { fromKey: 'ck-a', toKey: 'ck-b' },
      { fromKey: 'ck-b', toKey: 'ck-c' },
    ]);
    expect(report.cycles).toHaveLength(0);
    expect(report.blockedEdgeIds.size).toBe(0);
  });

  it('reports a three-member cycle and blocks exactly its own edges', () => {
    const report = findPrerequisiteCycles([
      { fromKey: 'ck-a', toKey: 'ck-b' },
      { fromKey: 'ck-b', toKey: 'ck-c' },
      { fromKey: 'ck-c', toKey: 'ck-a' },
    ]);
    expect(report.cycles).toHaveLength(1);
    expect(report.memberKeys).toEqual(new Set(['ck-a', 'ck-b', 'ck-c']));
    expect(isEdgeBlockedByCycle({ fromKey: 'ck-a', toKey: 'ck-b' }, report)).toBe(true);
    expect(isEdgeBlockedByCycle({ fromKey: 'ck-b', toKey: 'ck-c' }, report)).toBe(true);
    expect(isEdgeBlockedByCycle({ fromKey: 'ck-c', toKey: 'ck-a' }, report)).toBe(true);
  });

  it("a cycle member's edge to a dependent outside the cycle stays unblocked (Default 2, clarified ol-egov.141.89.4.12)", () => {
    const report = findPrerequisiteCycles([
      { fromKey: 'ck-a', toKey: 'ck-b' },
      { fromKey: 'ck-b', toKey: 'ck-c' },
      { fromKey: 'ck-c', toKey: 'ck-a' },
      { fromKey: 'ck-a', toKey: 'ck-dependent' },
    ]);
    expect(isEdgeBlockedByCycle({ fromKey: 'ck-a', toKey: 'ck-dependent' }, report)).toBe(false);
  });

  it("two disjoint cycles never cross-block each other's edges", () => {
    const report = findPrerequisiteCycles([
      { fromKey: 'ck-a', toKey: 'ck-b' },
      { fromKey: 'ck-b', toKey: 'ck-a' },
      { fromKey: 'ck-x', toKey: 'ck-y' },
      { fromKey: 'ck-y', toKey: 'ck-x' },
    ]);
    expect(report.cycles).toHaveLength(2);
    expect(isEdgeBlockedByCycle({ fromKey: 'ck-a', toKey: 'ck-x' }, report)).toBe(false);
  });

  it('an unrelated valid edge on a cycle key that touches no other member stays eligible (rel.md §4 failure class)', () => {
    const report = findPrerequisiteCycles([
      { fromKey: 'ck-a', toKey: 'ck-b' },
      { fromKey: 'ck-b', toKey: 'ck-c' },
      { fromKey: 'ck-c', toKey: 'ck-a' },
    ]);
    // A contrasts-with edge on ck-a is never even offered to this module (prerequisite-only), and
    // ck-a's own OTHER prerequisite edge to a non-member is unblocked, per the test above. This
    // test pins the negative: no global "any edge touching a member key" rule exists here.
    expect(isEdgeBlockedByCycle({ fromKey: 'ck-a', toKey: 'ck-unrelated' }, report)).toBe(false);
    expect(isEdgeBlockedByCycle({ fromKey: 'ck-unrelated', toKey: 'ck-a' }, report)).toBe(false);
  });
});

describe('violatesPredicateContract', () => {
  it('flags a self-loop', () => {
    expect(violatesPredicateContract({ fromKey: 'ck-a', toKey: 'ck-a' })).toBe(true);
  });

  it('does not flag two distinct endpoints', () => {
    expect(violatesPredicateContract({ fromKey: 'ck-a', toKey: 'ck-b' })).toBe(false);
  });
});
