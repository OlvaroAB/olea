/**
 * Scenario: `ol-95vv.3`'s carried-along scope item — a new
 * `NominationSignalKind` member for `[D-083]`'s `CandidateEdgeNomination`
 * (`../../mastery/gradingInputContract.ts`), the enum addition only. Wiring
 * `./nominate.js` to actually emit it is separate, unstarted work (this
 * bead's `owns` is `types.ts` alone) — this spec pins the type-level
 * addition itself: the new kind is a real member of the union, usable
 * anywhere a `NominationSignal`/`NominationSignalKind` is, and every
 * pre-existing member is untouched.
 */

import { describe, expect, it } from 'vitest';
import type { NominationSignal, NominationSignalKind } from './types.js';

describe('NominationSignalKind — explain-back-relation-demonstrated (ol-95vv.3)', () => {
  it('is a valid member usable in a NominationSignal literal', () => {
    const signal: NominationSignal = {
      kind: 'explain-back-relation-demonstrated',
      a: 'Permeability',
      b: 'Porosity',
    };
    expect(signal.kind).toBe('explain-back-relation-demonstrated');
  });

  it('leaves every pre-existing member in place, unrenamed', () => {
    const kinds: readonly NominationSignalKind[] = [
      'assessment-cooccurrence',
      'embedding-proximity',
      'her-link',
      'assessment-error-adjacency',
      'explain-back-relation-demonstrated',
    ];
    // A compile-time check as much as a runtime one: this array only type-checks
    // if every one of these five literals is still assignable to the union.
    expect(kinds).toHaveLength(5);
    expect(new Set(kinds).size).toBe(5);
  });
});
