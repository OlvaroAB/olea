/**
 * `ol-egov.141.89.4.19` (`[D-402]`): a relation names its endpoints by wording, and since `[D-402]`
 * one wording can name one identity per course. Reconciliation resolves such a wording to the
 * identity whose passages sit in the document the relation was proposed in, carries both endpoint
 * keys on the edge, and drops (and counts) a relation it cannot place — never the first identity.
 * The readers downstream that join `part-of` and `prerequisite` edges to concept keys use those
 * keys before the name.
 *
 * INV-3: every string here is coined. No course code, note title or wording comes from any vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../extract/types.js';
import { containerConceptKeysToDrop } from '../session/containment.js';
import type { VaultPath } from '../vault/types.js';
import { resolvePrerequisiteConceptKeys } from './prerequisite-order.js';
import {
  type ReconcilableConcept,
  reconcileRelations,
  type ScopedProposedRelation,
  totalDropped,
} from './reconcile.js';
import type { ConceptRelation } from './relation.js';
import type { ConceptRecord } from './types.js';

const DOC_A = 'Courses/COURSEA/Week 1.md' as VaultPath;
const DOC_B = 'Courses/COURSEB/Week 1.md' as VaultPath;
const LOOSE = 'Notes/Loose.md' as VaultPath;

function at(sourcePath: VaultPath, start = 0): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end: start + 10 } } };
}

function concept(
  name: string,
  key: string,
  anchor: Provenance | undefined,
  overrides: Partial<ReconcilableConcept> = {},
): ReconcilableConcept {
  return { name, key, aliases: [], anchor, alsoIn: [], ...overrides };
}

function partOf(
  from: string,
  to: string,
  sourcePath?: VaultPath,
  overrides: Partial<ScopedProposedRelation> = {},
): ScopedProposedRelation {
  return {
    type: 'part-of',
    from,
    to,
    confidence: 0.7,
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    ...overrides,
  };
}

// One wording, two course identities: the first course's entry comes first, as `./read.js` orders
// them, so resolving to "the first claimant" is the defect under test.
const cellA = concept('Cell', 'key-cell-a', at(DOC_A));
const cellB = concept('Cell', 'key-cell-b', at(DOC_B));
const organelle = concept('Organelle', 'key-organelle', at(DOC_A, 20));
const electrode = concept('Electrode', 'key-electrode', at(DOC_B, 20));

describe('a split wording resolves to the identity of the document the relation came from', () => {
  it('tagged with the second course document: resolves to that course identity, with both keys', () => {
    const result = reconcileRelations(
      [partOf('Electrode', 'Cell', DOC_B)],
      [cellA, cellB, organelle, electrode],
    );

    expect(result.relations).toEqual([
      {
        type: 'part-of',
        from: 'Electrode',
        to: 'Cell',
        provenance: 'model-proposed',
        confidence: 0.7,
        introducingPassages: { from: at(DOC_B, 20), to: at(DOC_B) },
        fromKey: 'key-electrode',
        toKey: 'key-cell-b',
      },
    ]);
    expect(totalDropped(result.dropped)).toBe(0);
  });

  it('the same relation wording from both courses: two edges, one per course identity', () => {
    const membraneA = concept('Membrane', 'key-membrane', at(DOC_A, 40));
    const membraneB = concept('Membrane', 'key-membrane', at(DOC_B, 40));

    const result = reconcileRelations(
      [partOf('Membrane', 'Cell', DOC_A), partOf('Membrane', 'Cell', DOC_B)],
      [cellA, cellB, membraneA, membraneB],
    );

    expect(result.relations.map((r) => [r.fromKey, r.toKey])).toEqual([
      ['key-membrane', 'key-cell-a'],
      ['key-membrane', 'key-cell-b'],
    ]);
    // Each edge cites the passages of its own document, for both endpoints.
    expect(
      result.relations.map((r) => [
        r.introducingPassages.from.sourcePath,
        r.introducingPassages.to.sourcePath,
      ]),
    ).toEqual([
      [DOC_A, DOC_A],
      [DOC_B, DOC_B],
    ]);
  });

  it('a split reached through the reader own wording, kept as an alias of each identity', () => {
    const result = reconcileRelations(
      [partOf('Electrode', 'cells', DOC_B)],
      [
        concept('Cell', 'key-cell-a', at(DOC_A), { aliases: ['cells'] }),
        concept('Cell', 'key-cell-b', at(DOC_B), { aliases: ['cells'] }),
        electrode,
      ],
    );

    expect(result.relations.map((r) => r.toKey)).toEqual(['key-cell-b']);
  });

  it('untagged: the pair of endpoints that shares a document decides', () => {
    const result = reconcileRelations(
      [partOf('Electrode', 'Cell'), partOf('Organelle', 'Cell')],
      [cellA, cellB, organelle, electrode],
    );

    expect(result.relations.map((r) => [r.from, r.fromKey, r.toKey])).toEqual([
      ['Electrode', 'key-electrode', 'key-cell-b'],
      ['Organelle', 'key-organelle', 'key-cell-a'],
    ]);
  });

  it('a record the read never anchored is not a candidate: the anchored identity is chosen', () => {
    const unread = concept('Cell', 'key-cell-a', undefined);

    const tagged = reconcileRelations(
      [partOf('Electrode', 'Cell', DOC_B)],
      [unread, cellB, electrode],
    );
    const untagged = reconcileRelations([partOf('Electrode', 'Cell')], [unread, cellB, electrode]);

    expect(tagged.relations.map((r) => r.toKey)).toEqual(['key-cell-b']);
    expect(untagged.relations.map((r) => r.toKey)).toEqual(['key-cell-b']);
  });
});

describe('a relation that cannot be placed is dropped and counted, never resolved to the first identity', () => {
  it('untagged, both endpoints present in both documents: ambiguous', () => {
    const membraneA = concept('Membrane', 'key-membrane', at(DOC_A, 40));
    const membraneB = concept('Membrane', 'key-membrane', at(DOC_B, 40));

    const result = reconcileRelations(
      [partOf('Membrane', 'Cell')],
      [cellA, cellB, membraneA, membraneB],
    );

    expect(result.relations).toEqual([]);
    expect(result.dropped['ambiguous-concept']).toBe(1);
    expect(totalDropped(result.dropped)).toBe(1);
  });

  it('a document in no course, whose passage sits with every identity: ambiguous (open question on the bead)', () => {
    const looseA = concept('Cell', 'key-cell-a', at(LOOSE));
    const looseB = concept('Cell', 'key-cell-b', at(LOOSE));
    const nucleus = concept('Nucleus', 'key-nucleus', at(LOOSE, 20));

    const tagged = reconcileRelations(
      [partOf('Nucleus', 'Cell', LOOSE)],
      [looseA, looseB, nucleus],
    );
    const untagged = reconcileRelations([partOf('Nucleus', 'Cell')], [looseA, looseB, nucleus]);

    expect(tagged.relations).toEqual([]);
    expect(tagged.dropped['ambiguous-concept']).toBe(1);
    expect(untagged.relations).toEqual([]);
    expect(untagged.dropped['ambiguous-concept']).toBe(1);
  });

  it('tagged, no identity of the split wording sits in the relation document: ambiguous', () => {
    const other = 'Courses/COURSEC/Week 1.md' as VaultPath;
    const anode = concept('Anode', 'key-anode', at(other));

    const result = reconcileRelations([partOf('Anode', 'Cell', other)], [cellA, cellB, anode]);

    expect(result.relations).toEqual([]);
    expect(result.dropped['ambiguous-concept']).toBe(1);
  });

  it('an unknown wording is still unknown, not ambiguous', () => {
    const result = reconcileRelations([partOf('Nothing proposed', 'Cell', DOC_A)], [cellA, cellB]);

    expect(result.dropped['unknown-concept']).toBe(1);
    expect(result.dropped['ambiguous-concept']).toBe(0);
  });
});

describe('a wording with one identity resolves exactly as before', () => {
  it('untagged: the first claimant, now with its key', () => {
    const cell = concept('Cell', 'key-cell', at(DOC_A));
    const result = reconcileRelations([partOf('Organelle', 'Cell')], [cell, organelle]);

    expect(result.relations).toEqual([
      {
        type: 'part-of',
        from: 'Organelle',
        to: 'Cell',
        provenance: 'model-proposed',
        confidence: 0.7,
        introducingPassages: { from: at(DOC_A, 20), to: at(DOC_A) },
        fromKey: 'key-organelle',
        toKey: 'key-cell',
      },
    ]);
  });

  it('one identity under one name in two documents, untagged: the first entry, as before', () => {
    const cellHere = concept('Cell', 'key-cell', at(DOC_A));
    const cellThere = concept('Cell', 'key-cell', at(DOC_B));

    const result = reconcileRelations(
      [partOf('Electrode', 'Cell')],
      [cellHere, cellThere, electrode],
    );

    expect(result.relations.map((r) => [r.toKey, r.introducingPassages.to.sourcePath])).toEqual([
      ['key-cell', DOC_A],
    ]);
  });

  it('the same, tagged: the entry in the relation document, so the edge cites its own passage', () => {
    const cellHere = concept('Cell', 'key-cell', at(DOC_A));
    const cellThere = concept('Cell', 'key-cell', at(DOC_B));

    const result = reconcileRelations(
      [partOf('Electrode', 'Cell', DOC_B)],
      [cellHere, cellThere, electrode],
    );

    expect(result.relations.map((r) => [r.toKey, r.introducingPassages.to.sourcePath])).toEqual([
      ['key-cell', DOC_B],
    ]);
  });

  it('an alias shared by two differently named concepts keeps the first-claimant rule', () => {
    const wall = concept('Cell wall', 'key-wall', at(DOC_A), { aliases: ['Wall'] });
    const wallProper = concept('Wall', 'key-wall-proper', at(DOC_A, 60));

    const result = reconcileRelations([partOf('Organelle', 'Wall')], [wall, wallProper, organelle]);

    expect(result.relations.map((r) => [r.to, r.toKey])).toEqual([['Cell wall', 'key-wall']]);
  });

  it('concepts without keys resolve by wording and the edge carries no keys (the pre-change shape)', () => {
    const result = reconcileRelations(
      [partOf('Organelle', 'Cell')],
      [
        { name: 'Cell', aliases: [], anchor: at(DOC_A) },
        { name: 'Cell', aliases: [], anchor: at(DOC_B) },
        { name: 'Organelle', aliases: [], anchor: at(DOC_A, 20) },
      ],
    );

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).not.toHaveProperty('fromKey');
    expect(result.relations[0]).not.toHaveProperty('toKey');
    expect(result.relations[0]?.introducingPassages.to.sourcePath).toBe(DOC_A);
  });
});

function record(name: string, key: string): ConceptRecord {
  return { name, key } as ConceptRecord;
}

describe('readers downstream join by the edge keys before the name', () => {
  // Her records in vault order: the first course's identity first, so a name join picks it.
  const records = [record('Cell', 'key-cell-a'), record('Cell', 'key-cell-b')];

  it('containment: the second course container is dropped when its own part is present', () => {
    const [edge] = reconcileRelations(
      [partOf('Electrode', 'Cell', DOC_B)],
      [cellA, cellB, electrode],
    ).relations;
    if (edge === undefined) throw new Error('expected one edge');
    const keyOfName = new Map([
      ['Cell', 'key-cell-a'],
      ['Electrode', 'key-electrode'],
    ]);

    const drop = containerConceptKeysToDrop(
      [edge],
      keyOfName,
      new Set(['key-electrode', 'key-cell-b']),
    );

    expect([...drop]).toEqual(['key-cell-b']);
  });

  it('containment: an edge without keys still joins by name (unchanged)', () => {
    const edge: ConceptRelation = {
      type: 'part-of',
      from: 'Electrode',
      to: 'Cell',
      provenance: 'model-proposed',
      confidence: 0.7,
      introducingPassages: { from: at(DOC_B, 20), to: at(DOC_B) },
    };
    const keyOfName = new Map([
      ['Cell', 'key-cell-a'],
      ['Electrode', 'key-electrode'],
    ]);

    const drop = containerConceptKeysToDrop(
      [edge],
      keyOfName,
      new Set(['key-electrode', 'key-cell-a']),
    );

    expect([...drop]).toEqual(['key-cell-a']);
  });

  it('prerequisite order: a keyed edge orders the identity it names, not the name first claimant', () => {
    const edge = {
      type: 'prerequisite' as const,
      from: 'Voltage',
      to: 'Cell',
      provenance: 'model-proposed' as const,
      confidence: 0.7,
      introducingPassages: { from: at(DOC_B, 20), to: at(DOC_B) },
      fromKey: 'key-voltage',
      toKey: 'key-cell-b',
    };

    const { prerequisiteConceptKeys, unresolvedEndpointCount } = resolvePrerequisiteConceptKeys(
      [edge],
      records,
    );

    expect([...prerequisiteConceptKeys.entries()].map(([k, v]) => [k, [...v]])).toEqual([
      ['key-cell-b', ['key-voltage']],
    ]);
    expect(unresolvedEndpointCount).toBe(0);
  });
});
