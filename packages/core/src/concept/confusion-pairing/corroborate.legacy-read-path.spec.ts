/**
 * The explicit legacy read path for `corroborateConfusionPairs` (`ol-2zfj.155`,
 * `components-group1.md:1842` in the private `olea-service` repo). Pins the
 * three cases the bead's close evidence names: a legacy (name-keyed) record
 * resolves through the name/alias index; a new (opaque-keyed) record resolves
 * through `ConfusionPairingConcept.key` instead; an unmappable legacy record
 * is reported unresolved, never silently retried against the other scheme.
 *
 * INV-3: every concept name, id and statement here is coined. No course
 * code, note title or wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../../extract/types.js';
import type { MisconceptionRecord } from '../../misconception/types.js';
import { OPAQUE_CONCEPT_KEY_PREFIX } from '../concept-key.js';
import { type ConceptRelation, deriveRelationSet, type RelationSet } from '../relation.js';
import { corroborateConfusionPairs } from './corroborate.js';
import type { ConfusionPairingConcept } from './types.js';

function anchor(sourcePath: string, start = 0, end = 10): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end } } };
}

function contrastsWith(from: string, to: string): ConceptRelation {
  return {
    type: 'contrasts-with',
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.7,
    introducingPassages: { from: anchor(`${from}.md`), to: anchor(`${to}.md`) },
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

const alphaOpaqueKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:alpha-nonce`;
const betaOpaqueKey = `${OPAQUE_CONCEPT_KEY_PREFIX}:beta-nonce`;

describe('corroborateConfusionPairs — legacy read path (ol-2zfj.155)', () => {
  it('reads a legacy (name-keyed) record through the name/alias index', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Beta' })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.entries[0]?.standing).toBe('corroborated');
    expect(result.unresolvedRecords).toBe(0);
    expect(result.legacyUnresolvedRecords).toBe(0);
    expect(result.opaqueKeyUnresolvedRecords).toBe(0);
  });

  it('reads a new (opaque-keyed) record through ConfusionPairingConcept.key, not the name/alias index', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: alphaOpaqueKey, confusedWithConceptId: betaOpaqueKey })],
      [concept('Alpha', { key: alphaOpaqueKey }), concept('Beta', { key: betaOpaqueKey })],
    );

    expect(result.entries[0]?.standing).toBe('corroborated');
    expect(result.unresolvedRecords).toBe(0);
    expect(result.legacyUnresolvedRecords).toBe(0);
    expect(result.opaqueKeyUnresolvedRecords).toBe(0);
  });

  it('marks an unmappable legacy record unresolved, split into legacyUnresolvedRecords', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'NoSuchConcept', confusedWithConceptId: 'Beta' })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.unresolvedRecords).toBe(1);
    expect(result.legacyUnresolvedRecords).toBe(1);
    expect(result.opaqueKeyUnresolvedRecords).toBe(0);
    expect(result.entries[0]?.standing).toBe('uncorroborated');
  });

  it('marks an unmappable opaque-keyed record unresolved, split into opaqueKeyUnresolvedRecords — distinct from a legacy miss', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    // Concepts carry no `key` yet (the pre-wiring state every production caller is in today):
    // an opaque-keyed record must still fail honestly, not fall back to name matching.
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: alphaOpaqueKey, confusedWithConceptId: betaOpaqueKey })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.unresolvedRecords).toBe(1);
    expect(result.legacyUnresolvedRecords).toBe(0);
    expect(result.opaqueKeyUnresolvedRecords).toBe(1);
  });

  it('never falls back to the key index for a legacy-scheme id, even when its literal string equals a concept.key elsewhere', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    // No concept is literally named "Alpha" — but `Beta`'s `key` field is (deliberately, for
    // this test) the bare string "Alpha". A resolver that fell back to the opposite index on a
    // miss would wrongly resolve the legacy id "Alpha" to `Beta` via that `key`. The correct
    // behaviour: "Alpha" classifies as 'legacy-name' (no OPAQUE_CONCEPT_KEY_PREFIX prefix) and
    // is only ever looked up in the name/alias index, where it has no match.
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Beta' })],
      [concept('Gamma'), concept('Beta', { key: 'Alpha' })],
    );

    expect(result.unresolvedRecords).toBe(1);
    expect(result.legacyUnresolvedRecords).toBe(1);
    expect(result.opaqueKeyUnresolvedRecords).toBe(0);
  });

  it('resolves a fully opaque-keyed record correctly even when its ids collide with unrelated concept names', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    // Both ids are opaque-keyed (scheme 'opaque-key'), so they are looked up by `key`, never by
    // name — even though `Gamma`/`Delta` exist with unrelated names that share no literal
    // string with either opaque key.
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: alphaOpaqueKey, confusedWithConceptId: betaOpaqueKey })],
      [
        concept('Alpha', { key: alphaOpaqueKey }),
        concept('Beta', { key: betaOpaqueKey }),
        concept('Gamma'),
        concept('Delta'),
      ],
    );

    expect(result.entries[0]?.standing).toBe('corroborated');
    expect(result.unresolvedRecords).toBe(0);
  });

  it('a caller that never supplies concept.key still resolves every legacy record exactly as before (additive, non-breaking)', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Beta' })],
      // Mirrors packages/plugin/src/main.ts's production call site, which passes only
      // name/aliases — no `key` — today.
      [
        { name: 'Alpha', aliases: [] },
        { name: 'Beta', aliases: [] },
      ],
    );

    expect(result.entries[0]?.standing).toBe('corroborated');
    expect(result.unresolvedRecords).toBe(0);
  });
});
