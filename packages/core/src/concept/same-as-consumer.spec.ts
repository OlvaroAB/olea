import { describe, expect, it } from 'vitest';
import type { RelationCacheAttestation, RelationCacheRecord } from './relation-cache.js';
import { propositionKey } from './relation-cache.js';
import type { SameAsLinkRecord } from './same-as.js';
import {
  buildSameAsKeyRedirect,
  canonicalKeyForLink,
  resolveConceptsWithSameAsLinks,
  resolveRelationCacheRecordsWithSameAsLinks,
  type SameAsResolvableConcept,
} from './same-as-consumer.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "The confirmed same-as link's first
// read consumer (ONT-R1, F8.6)", tagged `@auto:core/concept/same-as-consumer.spec`.

function link(overrides: Partial<SameAsLinkRecord> = {}): SameAsLinkRecord {
  return {
    keyA: 'key-a',
    keyB: 'key-b',
    status: 'confirmed',
    reason: 'normalisation-collision',
    proposedAt: '2026-09-15T00:00:00.000Z',
    confirmedAt: '2026-09-16T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

function proposedLink(overrides: Partial<SameAsLinkRecord> = {}): SameAsLinkRecord {
  return {
    keyA: 'key-a',
    keyB: 'key-b',
    status: 'proposed',
    reason: 'normalisation-collision',
    proposedAt: '2026-09-15T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

function declinedLink(overrides: Partial<SameAsLinkRecord> = {}): SameAsLinkRecord {
  return {
    keyA: 'key-a',
    keyB: 'key-b',
    status: 'declined',
    reason: 'normalisation-collision',
    proposedAt: '2026-09-15T00:00:00.000Z',
    declinedAt: '2026-09-16T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

interface TestConcept extends SameAsResolvableConcept {
  readonly name: string;
}

function concept(overrides: Partial<TestConcept> = {}): TestConcept {
  return {
    key: 'key-a',
    name: 'Cell',
    courses: ['BIO101'],
    sourcePaths: ['Cell.md'],
    ...overrides,
  };
}

describe('canonicalKeyForLink / buildSameAsKeyRedirect — the canonical rule', () => {
  it("a confirmed link resolves to keyA, the pair's already-persisted sorted-first key", () => {
    expect(canonicalKeyForLink(link({ status: 'confirmed' }))).toBe('key-a');
  });

  it('a proposed link contributes no canonical key at all (requirement 3)', () => {
    const proposed = proposedLink();
    expect(canonicalKeyForLink(proposed)).toBeUndefined();
    expect(buildSameAsKeyRedirect([proposed]).size).toBe(0);
  });

  it('a severed link contributes no canonical key either (requirement 2 — nothing to undo)', () => {
    const severed = link({ status: 'severed', severedAt: '2026-09-17T00:00:00.000Z' });
    expect(canonicalKeyForLink(severed)).toBeUndefined();
    expect(buildSameAsKeyRedirect([severed]).size).toBe(0);
  });

  it('a declined link contributes no canonical key either ([D-257] ruling 3 — a decline never asserts the two are different, so a reader never folds it)', () => {
    const declined = declinedLink();
    expect(canonicalKeyForLink(declined)).toBeUndefined();
    expect(buildSameAsKeyRedirect([declined]).size).toBe(0);
  });

  it('a confirmed link redirects keyB -> keyA only', () => {
    const redirect = buildSameAsKeyRedirect([link()]);
    expect(redirect.get('key-b')).toBe('key-a');
    expect(redirect.has('key-a')).toBe(false);
  });
});

describe('resolveConceptsWithSameAsLinks — concepts fold to the canonical key', () => {
  it('no confirmed link touching this set returns the input unchanged, by reference', () => {
    const concepts = [concept({ key: 'key-x' })];
    const result = resolveConceptsWithSameAsLinks(concepts, [proposedLink()]);
    expect(result.concepts).toBe(concepts);
    expect(result.merged).toBe(0);
  });

  it('a confirmed pair merges under keyA, unioning courses and sourcePaths (requirement 5)', () => {
    const a = concept({
      key: 'key-a',
      name: 'Cell',
      courses: ['BIO101'],
      sourcePaths: ['Cell.md'],
    });
    const b = concept({
      key: 'key-b',
      name: 'cells',
      courses: ['BIO201', 'BIO101'],
      sourcePaths: ['Cells.md'],
    });
    const result = resolveConceptsWithSameAsLinks([a, b], [link()]);

    expect(result.merged).toBe(1);
    expect(result.concepts).toHaveLength(1);
    const merged = result.concepts[0];
    expect(merged?.key).toBe('key-a');
    expect(merged?.name).toBe('Cell'); // the canonical side's own fields win.
    expect(merged?.courses).toEqual(['BIO101', 'BIO201']);
    expect(merged?.sourcePaths).toEqual(['Cell.md', 'Cells.md']);
  });

  it('a proposed pair changes nothing a consumer sees (requirement 3)', () => {
    const a = concept({ key: 'key-a' });
    const b = concept({ key: 'key-b', name: 'cells' });
    const result = resolveConceptsWithSameAsLinks([a, b], [proposedLink()]);
    expect(result.merged).toBe(0);
    expect(result.concepts).toEqual([a, b]);
  });

  it('a declined pair never reaches the identity fold — treated exactly like a proposed one, never folded', () => {
    const a = concept({ key: 'key-a' });
    const b = concept({ key: 'key-b', name: 'cells' });
    const result = resolveConceptsWithSameAsLinks([a, b], [declinedLink()]);
    expect(result.merged).toBe(0);
    expect(result.concepts).toEqual([a, b]);
  });

  it('a severed pair reads independently again — nothing was rewritten, so nothing needs restoring (requirement 2)', () => {
    const a = concept({ key: 'key-a' });
    const b = concept({ key: 'key-b', name: 'cells' });
    const severed = link({ status: 'severed', severedAt: '2026-09-17T00:00:00.000Z' });

    const confirmedView = resolveConceptsWithSameAsLinks([a, b], [link()]);
    expect(confirmedView.concepts).toHaveLength(1);

    const severedView = resolveConceptsWithSameAsLinks([a, b], [severed]);
    expect(severedView.merged).toBe(0);
    expect(severedView.concepts).toEqual([a, b]);
    // Round trip: confirm, then sever — the same two original records, untouched throughout.
    expect(a.key).toBe('key-a');
    expect(b.key).toBe('key-b');
  });

  it('the canonical key with no record of its own in this batch still resolves (total over any input)', () => {
    const onlyLosingSide = [concept({ key: 'key-b', name: 'cells' })];
    const result = resolveConceptsWithSameAsLinks(onlyLosingSide, [link()]);
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0]?.key).toBe('key-a');
    expect(result.merged).toBe(0); // one record redirected, nothing to merge it WITH.
  });
});

const introducingPassages = {
  from: { sourcePath: 'A.md', location: { page: 1, section: 'H1' } },
  to: { sourcePath: 'B.md', location: { page: 1, section: 'H2' } },
};

function attestation(overrides: Partial<RelationCacheAttestation> = {}): RelationCacheAttestation {
  return {
    provenance: 'model-proposed',
    confidence: 0.7,
    introducingPassages,
    fromName: 'Cell',
    toName: 'Mitosis',
    recordedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

function cacheRecord(overrides: Partial<RelationCacheRecord> = {}): RelationCacheRecord {
  const fromKey = overrides.fromKey ?? 'key-a';
  const toKey = overrides.toKey ?? 'key-z';
  return {
    propositionKey: propositionKey('prerequisite', fromKey, toKey),
    type: 'prerequisite',
    fromKey,
    toKey,
    attestations: [attestation()],
    mintedAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('resolveRelationCacheRecordsWithSameAsLinks — read-time endpoint resolution (requirement 4)', () => {
  it('no confirmed link touching this set returns the input unchanged, by reference', () => {
    const records = [cacheRecord()];
    const result = resolveRelationCacheRecordsWithSameAsLinks(records, [proposedLink()]);
    expect(result).toBe(records);
  });

  it('a record incident to the losing key resolves to the canonical key at read time, even though nothing wrote a remap', () => {
    const record = cacheRecord({ fromKey: 'key-b', toKey: 'key-z' }); // key-b is the LOSING side of link().
    const [resolved] = resolveRelationCacheRecordsWithSameAsLinks([record], [link()]);
    expect(resolved?.fromKey).toBe('key-a');
    expect(resolved?.toKey).toBe('key-z');
    expect(resolved?.propositionKey).toBe(propositionKey('prerequisite', 'key-a', 'key-z'));
    // Read-time only: the record's own `remappedFrom` provenance field is untouched — this is a
    // view, not the write-side remap `./same-as.ts`'s `remapIncidentRelationCacheRecords` performs.
    expect(resolved?.remappedFrom).toBeUndefined();
  });

  it('a proposed link changes nothing a relation-cache reader sees (requirement 3)', () => {
    const record = cacheRecord({ fromKey: 'key-b', toKey: 'key-z' });
    const [resolved] = resolveRelationCacheRecordsWithSameAsLinks([record], [proposedLink()]);
    expect(resolved).toBe(record);
  });

  it('two records that collide onto one proposition after resolution are folded, never left as two', () => {
    const survivorSide = cacheRecord({
      fromKey: 'key-a',
      toKey: 'key-z',
      attestations: [attestation({ provenance: 'model-proposed', confidence: 0.4 })],
    });
    const losingSide = cacheRecord({
      fromKey: 'key-b', // resolves to key-a — same proposition as survivorSide once resolved.
      toKey: 'key-z',
      attestations: [attestation({ provenance: 'hers', confidence: 0.9, fromName: 'cells' })],
    });

    const resolved = resolveRelationCacheRecordsWithSameAsLinks(
      [survivorSide, losingSide],
      [link()],
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.attestations).toHaveLength(2);
    // Provenance outranks confidence ([D-070]): the 'hers' attestation wins the top slot.
    expect(resolved[0]?.attestations[0]?.provenance).toBe('hers');
  });

  it('a severed link stops resolving on the very next read — no undo needed beyond that (requirement 2)', () => {
    const record = cacheRecord({ fromKey: 'key-b', toKey: 'key-z' });
    const severed = link({ status: 'severed', severedAt: '2026-09-17T00:00:00.000Z' });
    const [resolved] = resolveRelationCacheRecordsWithSameAsLinks([record], [severed]);
    expect(resolved).toBe(record);
    expect(resolved?.fromKey).toBe('key-b');
  });

  it('a declined link never remaps relation-cache records — treated exactly like a proposed one, never folded into the relation-cache remap', () => {
    const record = cacheRecord({ fromKey: 'key-b', toKey: 'key-z' });
    const [resolved] = resolveRelationCacheRecordsWithSameAsLinks([record], [declinedLink()]);
    expect(resolved).toBe(record);
    expect(resolved?.fromKey).toBe('key-b');
  });
});
