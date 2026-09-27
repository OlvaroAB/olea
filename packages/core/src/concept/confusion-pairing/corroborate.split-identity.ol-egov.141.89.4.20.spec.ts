/**
 * `ol-egov.141.89.4.20` (`[D-402]`): `corroborateConfusionPairs` matched a misconception record to
 * a `contrasts-with` fold entry by the plain name-pair key alone (`confusionPairKey`). Since
 * `[D-402]`, one wording can name one identity per course, and `../relation.js`'s
 * `deriveRelationSet` already splits such a name pair into more than one `RelationSetEntry` (one
 * per course's endpoint-key pair, `entry.key` carrying the pair as a suffix) — a plain name-pair
 * lookup cannot tell those entries apart, so a misconception record resolved via `[D-088]`'s
 * opaque key risked being counted against the wrong course's edge, or matched to neither.
 *
 * The fix: when the fold actually split this name pair AND both endpoints resolved to a concept
 * carrying a `key`, match by the same `baseKey` + sorted key-pair suffix `deriveRelationSet`
 * computed for `entry.key`, falling back to the plain name-pair key exactly as before everywhere
 * else — a name pair that never split, or a record whose endpoints carry no key, is unaffected.
 *
 * A dedicated file, not an addition to `corroborate.spec.ts` — this bead owns `corroborate.ts`
 * only, and that file (and `corroborate.legacy-read-path.spec.ts`) are shared files other lanes
 * may be editing concurrently. Fixture helpers are copied from those files' own `anchor`/
 * `contrastsWith`/`record`/`concept`/`setOf` rather than imported, matching their own stated
 * convention for this reader's test suite.
 *
 * INV-3: every concept name, id and statement below is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../../extract/types.js';
import type { MisconceptionRecord } from '../../misconception/types.js';
import { OPAQUE_CONCEPT_KEY_PREFIX } from '../concept-key.js';
import type { RelationWithEndpointKeys } from '../related-concept-keys.js';
import { type ConceptRelation, deriveRelationSet, type RelationSet } from '../relation.js';
import { corroborateConfusionPairs } from './corroborate.js';
import type { ConfusionPairingConcept } from './types.js';

function anchor(sourcePath: string, start = 0, end = 10): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end } } };
}

/** `keys`, spread structurally onto the returned `ConceptRelation` — the shape a reconciled edge
 * carrying `[D-088]`'s endpoint keys actually takes (`RelationWithEndpointKeys`). */
function contrastsWith(
  from: string,
  to: string,
  keys?: { readonly fromKey?: string; readonly toKey?: string },
): ConceptRelation {
  return {
    type: 'contrasts-with',
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.7,
    introducingPassages: { from: anchor(`${from}.md`), to: anchor(`${to}.md`) },
    ...keys,
  };
}

function record(overrides: Partial<MisconceptionRecord>): MisconceptionRecord {
  return {
    id: 'm-default',
    conceptId: 'Alpha',
    confusedWithConceptId: 'Beta',
    statement: 'Believes Alpha implies Beta unconditionally.',
    correction: 'Alpha only implies Beta under condition Z.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
    firstSeen: '2026-08-01T09:00:00-04:00',
    lastSeen: '2026-08-01T09:00:00-04:00',
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:alpha:1',
    ...overrides,
  };
}

function concept(
  name: string,
  overrides: Partial<ConfusionPairingConcept> = {},
): ConfusionPairingConcept {
  return { name, aliases: [], ...overrides };
}

function setOf(...relations: readonly ConceptRelation[]): RelationSet {
  return deriveRelationSet(relations);
}

/** The winning attestation's own `fromKey`, read back through the structural cast every real
 * reconciled edge already supports (`RelationWithEndpointKeys`) — used only to tell this test's
 * two split entries apart, never a claim this reader itself reads the field this way. */
function fromKeyOf(entry: {
  readonly edge: { readonly edge: ConceptRelation };
}): string | undefined {
  return (entry.edge.edge as RelationWithEndpointKeys).fromKey;
}

const courseAAlphaKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:course-a-alpha`;
const courseABetaKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:course-a-beta`;
const courseBAlphaKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:course-b-alpha`;
const courseBBetaKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:course-b-beta`;

describe('corroborateConfusionPairs: split-wording fold entries (`ol-egov.141.89.4.20`, `[D-402]`)', () => {
  it("split wording: a misconception record keyed to one course only corroborates THAT course's entry, not the other", () => {
    // Both courses' contrasts-with edges name the identical wording pair ('Alpha', 'Beta') — the
    // exact split-fold shape `../relation.js`'s `deriveRelationSet` produces two entries for.
    const edgeA = contrastsWith('Alpha', 'Beta', {
      fromKey: courseAAlphaKey,
      toKey: courseABetaKey,
    });
    const edgeB = contrastsWith('Alpha', 'Beta', {
      fromKey: courseBAlphaKey,
      toKey: courseBBetaKey,
    });
    const set = setOf(edgeA, edgeB);
    expect(set.entries).toHaveLength(2); // the split really happened before this reader even runs

    const result = corroborateConfusionPairs(
      set,
      [
        // Evidences course A's identity pair only — a real opaque-key-scheme record.
        record({
          id: 'm-a',
          conceptId: courseAAlphaKey,
          confusedWithConceptId: courseABetaKey,
          occurrenceCount: 3,
        }),
      ],
      [
        concept('Alpha', { key: courseAAlphaKey }),
        concept('Beta', { key: courseABetaKey }),
        concept('Alpha', { key: courseBAlphaKey }),
        concept('Beta', { key: courseBBetaKey }),
      ],
    );

    expect(result.entries).toHaveLength(2);
    const entryA = result.entries.find((e) => fromKeyOf(e) === courseAAlphaKey);
    const entryB = result.entries.find((e) => fromKeyOf(e) === courseBAlphaKey);
    expect(entryA?.standing).toBe('corroborated');
    expect(entryA?.misconceptionRecordCount).toBe(1);
    expect(entryA?.misconceptionOccurrenceCount).toBe(3);
    // Course B's own entry — same wording, no keyed evidence of its own — stays uncorroborated.
    // Before this fix, a plain name-pair join could not tell the two entries apart at all.
    expect(entryB?.standing).toBe('uncorroborated');
    expect(entryB?.misconceptionRecordCount).toBe(0);
    expect(result.unmatchedMisconceptionPairs).toBe(0);
  });

  it('unsplit wording, both endpoints keyed: ordinary opaque-key matching is unaffected by this fix', () => {
    // Only ONE course's edge for this wording exists — `baseKeyCounts` never exceeds 1, so this
    // reader must still use the plain name-pair key exactly as before, even though both endpoints
    // carry a key (the ordinary, non-split production case since `ol-egov.141.89.4.19`).
    const set = setOf(
      contrastsWith('Alpha', 'Beta', { fromKey: courseAAlphaKey, toKey: courseABetaKey }),
    );
    expect(set.entries).toHaveLength(1);

    const result = corroborateConfusionPairs(
      set,
      [
        record({
          conceptId: courseAAlphaKey,
          confusedWithConceptId: courseABetaKey,
          occurrenceCount: 4,
        }),
      ],
      [concept('Alpha', { key: courseAAlphaKey }), concept('Beta', { key: courseABetaKey })],
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.standing).toBe('corroborated');
    expect(result.entries[0]?.misconceptionRecordCount).toBe(1);
    expect(result.entries[0]?.misconceptionOccurrenceCount).toBe(4);
    expect(result.unmatchedMisconceptionPairs).toBe(0);
  });
});
