/**
 * The confusion-pairing corroboration reader (`ol-2zfj.20`) — see
 * `./types.ts`'s module doc for the full scope argument this suite pins:
 * a `contrasts-with` edge is corroborated by real misconception evidence,
 * resolved against the same name/alias identity space `../relation.js` and
 * `corpusRelationSignals.ts`'s `assessment-error-adjacency` signal already
 * use, and this reader never mints a new edge from evidence alone.
 *
 * INV-3: every concept name, id and statement here is coined. No course
 * code, note title or wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../../extract/types.js';
import type { MisconceptionRecord } from '../../misconception/types.js';
import { type ConceptRelation, deriveRelationSet, type RelationSet } from '../relation.js';
import { corroborateConfusionPairs } from './corroborate.js';
import type { ConfusionPairingConcept } from './types.js';

function anchor(sourcePath: string, start = 0, end = 10): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end } } };
}

function contrastsWith(
  from: string,
  to: string,
  overrides: Partial<ConceptRelation> = {},
): ConceptRelation {
  return {
    type: 'contrasts-with',
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.7,
    introducingPassages: { from: anchor(`${from}.md`), to: anchor(`${to}.md`) },
    ...overrides,
  };
}

function prerequisite(from: string, to: string): ConceptRelation {
  return {
    type: 'prerequisite',
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

function concept(name: string, aliases: readonly string[] = []): ConfusionPairingConcept {
  return { name, aliases };
}

function setOf(...relations: readonly ConceptRelation[]): RelationSet {
  return deriveRelationSet(relations);
}

describe('corroborateConfusionPairs', () => {
  it('marks an edge corroborated when a misconception record evidences the same pair', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Beta' })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.standing).toBe('corroborated');
    expect(result.entries[0]?.misconceptionRecordCount).toBe(1);
    expect(result.entries[0]?.misconceptionOccurrenceCount).toBe(1);
    expect(result.unmatchedMisconceptionPairs).toBe(0);
    expect(result.unresolvedRecords).toBe(0);
    expect(result.evidenceBearingRecords).toBe(1);
  });

  it('matches evidence in either direction — contrasts-with is symmetric', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Beta', confusedWithConceptId: 'Alpha' })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.entries[0]?.standing).toBe('corroborated');
    expect(result.entries[0]?.misconceptionRecordCount).toBe(1);
  });

  it('sums occurrenceCount across multiple corroborating records, and counts them separately from record count', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [
        record({
          id: 'm-1',
          conceptId: 'Alpha',
          confusedWithConceptId: 'Beta',
          occurrenceCount: 3,
        }),
        record({
          id: 'm-2',
          conceptId: 'Beta',
          confusedWithConceptId: 'Alpha',
          occurrenceCount: 2,
        }),
      ],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.entries[0]?.misconceptionRecordCount).toBe(2);
    expect(result.entries[0]?.misconceptionOccurrenceCount).toBe(5);
  });

  it('marks an edge uncorroborated, with zero counts, when no misconception evidences it', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(set, [], [concept('Alpha'), concept('Beta')]);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.standing).toBe('uncorroborated');
    expect(result.entries[0]?.misconceptionRecordCount).toBe(0);
    expect(result.entries[0]?.misconceptionOccurrenceCount).toBe(0);
  });

  it('counts a misconception-evidenced pair with no contrasts-with edge as unmatched, and mints no edge for it', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Gamma', confusedWithConceptId: 'Delta' })],
      [concept('Alpha'), concept('Beta'), concept('Gamma'), concept('Delta')],
    );

    expect(result.entries).toHaveLength(1); // still only the Alpha/Beta edge
    expect(result.entries.every((e) => e.a !== 'Gamma' && e.b !== 'Gamma')).toBe(true);
    expect(result.unmatchedMisconceptionPairs).toBe(1);
  });

  it('resolves conceptId/confusedWithConceptId against aliases, not just canonical names', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Also-Alpha', confusedWithConceptId: 'Beta' })],
      [concept('Alpha', ['Also-Alpha']), concept('Beta')],
    );

    expect(result.entries[0]?.standing).toBe('corroborated');
  });

  it('counts a record as unresolved when either id matches no known concept name or alias', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Unknown', confusedWithConceptId: 'Beta' })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.unresolvedRecords).toBe(1);
    expect(result.evidenceBearingRecords).toBe(1);
    expect(result.unmatchedMisconceptionPairs).toBe(0);
    expect(result.entries[0]?.standing).toBe('uncorroborated');
  });

  it('never counts a record with confusedWithConceptId: null as evidence-bearing or unresolved', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: null })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.evidenceBearingRecords).toBe(0);
    expect(result.unresolvedRecords).toBe(0);
  });

  it('treats a record resolving both ids to the same concept as neither a pair nor an identity failure', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Also-Alpha' })],
      [concept('Alpha', ['Also-Alpha']), concept('Beta')],
    );

    expect(result.unresolvedRecords).toBe(0);
    expect(result.unmatchedMisconceptionPairs).toBe(0);
    expect(result.entries[0]?.standing).toBe('uncorroborated');
  });

  it('never includes a non-contrasts-with edge, even when current', () => {
    const set = setOf(prerequisite('Alpha', 'Beta'));
    const result = corroborateConfusionPairs(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Beta' })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.entries).toHaveLength(0);
    // Real evidence for a pair the fold never emitted a contrasts-with edge
    // for is exactly the unmatched case, regardless of what other types
    // exist for that pair.
    expect(result.unmatchedMisconceptionPairs).toBe(1);
  });

  it('respects the abstention gate — a stale contrasts-with entry is not served, even with corroborating evidence', () => {
    const edge = contrastsWith('Alpha', 'Beta');
    const current = deriveRelationSet([edge]);
    const staleSet: RelationSet = {
      ...current,
      entries: current.entries.map((entry) => ({ ...entry, evidence: 'stale' as const })),
    };
    const result = corroborateConfusionPairs(
      staleSet,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Beta' })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(result.entries).toHaveLength(0);
    expect(result.unmatchedMisconceptionPairs).toBe(1);
  });

  it('is pure — identical inputs in a different record order produce an identical result', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const records = [
      record({ id: 'm-1', conceptId: 'Alpha', confusedWithConceptId: 'Beta' }),
      record({ id: 'm-2', conceptId: 'Beta', confusedWithConceptId: 'Alpha' }),
    ];
    const concepts = [concept('Alpha'), concept('Beta')];

    const a = corroborateConfusionPairs(set, records, concepts);
    const b = corroborateConfusionPairs(set, [...records].reverse(), concepts);

    expect(a).toEqual(b);
  });
});
