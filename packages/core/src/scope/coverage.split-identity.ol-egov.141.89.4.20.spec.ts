/**
 * `ol-egov.141.89.4.20` (`[D-402]`): `containerNamesToFold` dropped a `part-of` edge's container
 * side by matching `edge.from`/`.to` against `declaredNames` — concept NAMES alone. Since
 * `[D-402]`, one wording can name one identity per course, so a container wording shared with
 * another course's own (undeclared, out-of-scope-here) part-of pair could be dropped by name match
 * even though this course's own material never declared that identity's container relationship.
 *
 * The fix adds an optional `declaredKeys` parameter: when both endpoints carry `[D-088]`'s opaque
 * `fromKey`/`toKey` AND the caller supplies `declaredKeys`, the drop decision is made by KEY
 * membership instead of by name, which can tell two identically-worded but differently-keyed
 * course pairs apart. Omitting `declaredKeys` (today's only real caller, `./grove.ts` — see this
 * function's own doc for why it cannot supply one yet) is a byte-for-byte no-op: the exact name
 * join this module has always run.
 *
 * A dedicated file, not an addition to `coverage.spec.ts` — this bead owns `coverage.ts` only, and
 * that file is a shared one other lanes may be editing concurrently. The `partOf`/`passage` fixture
 * helpers are copied from `coverage.spec.ts`'s own, matching that file's stated INV-3 convention.
 *
 * INV-3: every concept name below is coined. No course code, note title or wording comes from any
 * real vault.
 */

import { describe, expect, it } from 'vitest';
import type { RelationWithEndpointKeys } from '../concept/related-concept-keys.js';
import type { RelationType } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import { containerNamesToFold } from './coverage.js';

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

// A part-of B: `from` is the finer/part side, `to` is the coarser/container side — matching
// `coverage.spec.ts`'s own `partOf` helper. `keys`, when given, are spread structurally onto the
// edge, the shape a reconciled edge carrying `[D-088]`'s endpoint keys actually takes.
function partOf(
  from: string,
  to: string,
  keys?: { readonly fromKey?: string; readonly toKey?: string },
  type: RelationType = 'part-of',
): RelationWithEndpointKeys {
  return {
    type,
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
    ...keys,
  };
}

describe("containerNamesToFold: `declaredKeys` prefers an edge's own keys over the name join (`ol-egov.141.89.4.20`, `[D-402]`)", () => {
  it('split wording: the container drops only for the course whose own key pair is declared, even though the wording is shared with another course', () => {
    // Both courses' material happens to use the identical wording pair — the exact split-fold
    // shape `[D-402]` creates. Only course A's own concept keys are in scope here.
    const declaredNames = new Set(['Invented Part', 'Invented Broad Area']);
    const declaredKeys = new Set(['part-key-A', 'broad-key-A']);

    // Course B's identity pair: same wording, keys NOT in `declaredKeys` — must NOT drop.
    const courseBEdge = partOf('Invented Part', 'Invented Broad Area', {
      fromKey: 'part-key-B',
      toKey: 'broad-key-B',
    });
    expect(containerNamesToFold([courseBEdge], declaredNames, declaredKeys).size).toBe(0);

    // Course A's identity pair: same wording, keys ARE in `declaredKeys` — must drop the container.
    const courseAEdge = partOf('Invented Part', 'Invented Broad Area', {
      fromKey: 'part-key-A',
      toKey: 'broad-key-A',
    });
    expect(containerNamesToFold([courseAEdge], declaredNames, declaredKeys)).toEqual(
      new Set(['Invented Broad Area']),
    );
  });

  it('unsplit (no `declaredKeys` supplied): the name join alone still decides, even when the edge carries keys — a byte-for-byte no-op, unchanged from before this parameter existed', () => {
    const declaredNames = new Set(['Invented Part', 'Invented Broad Area']);
    const edge = partOf('Invented Part', 'Invented Broad Area', {
      fromKey: 'part-key-A',
      toKey: 'broad-key-A',
    });

    // No third argument — today's only real caller (`./grove.ts`) never supplies one.
    expect(containerNamesToFold([edge], declaredNames)).toEqual(new Set(['Invented Broad Area']));
  });
});
