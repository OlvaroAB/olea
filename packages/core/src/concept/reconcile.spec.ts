/**
 * The reconciliation contract (`[EXT-6]`, `ol-2zfj.8`) — a relation naming an
 * unknown concept is dropped and logged, never used to mint one.
 *
 * INV-3: every string here is coined. No course code, note title or wording
 * comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';
import { type ReconcilableConcept, reconcileRelations, totalDropped } from './reconcile.js';
import type { ProposedRelation } from './relation.js';

function anchor(sourcePath: VaultPath, start = 0, end = 10): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end } } };
}

function concept(name: string, overrides: Partial<ReconcilableConcept> = {}): ReconcilableConcept {
  return { name, aliases: [], anchor: anchor('Lecture 1.md'), ...overrides };
}

function relation(overrides: Partial<ProposedRelation> = {}): ProposedRelation {
  return {
    type: 'part-of',
    from: 'Osmosis',
    to: 'Membrane transport',
    confidence: 0.8,
    ...overrides,
  };
}

describe('reconcileRelations — the concept set is authoritative', () => {
  it('emits a relation whose both endpoints the concept call returned', () => {
    const result = reconcileRelations(
      [relation()],
      [concept('Osmosis'), concept('Membrane transport')],
    );
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toEqual({
      type: 'part-of',
      from: 'Osmosis',
      to: 'Membrane transport',
      provenance: 'model-proposed',
      confidence: 0.8,
      introducingPassages: {
        from: anchor('Lecture 1.md'),
        to: anchor('Lecture 1.md'),
      },
    });
    expect(totalDropped(result.dropped)).toBe(0);
  });

  it('drops a relation naming a concept the concept call did not return, and counts it', () => {
    const result = reconcileRelations(
      [relation({ to: 'A concept nothing proposed' })],
      [concept('Osmosis')],
    );
    expect(result.relations).toHaveLength(0);
    expect(result.dropped['unknown-concept']).toBe(1);
    expect(totalDropped(result.dropped)).toBe(1);
  });

  it('never mints a concept as a side effect of an unknown-concept relation', () => {
    const concepts = [concept('Osmosis')];
    reconcileRelations([relation({ to: 'Never seen anywhere' })], concepts);
    // The caller's own concept list is untouched — reconciliation reads it,
    // it never writes to it or returns anything that looks like a new one.
    expect(concepts).toHaveLength(1);
    expect(concepts.map((c) => c.name)).toEqual(['Osmosis']);
  });

  it('drops when EITHER endpoint is unknown, not only the "to" side', () => {
    const result = reconcileRelations(
      [relation({ from: 'Never seen anywhere' })],
      [concept('Membrane transport')],
    );
    expect(result.relations).toHaveLength(0);
    expect(result.dropped['unknown-concept']).toBe(1);
  });

  it('matches a relation endpoint against an alias, not only the canonical name', () => {
    const result = reconcileRelations(
      [relation({ from: 'osmotic flow' })],
      [concept('Osmosis', { aliases: ['osmotic flow'] }), concept('Membrane transport')],
    );
    expect(result.relations).toHaveLength(1);
    // The resolved edge carries the concept's real identity, not the alias
    // wording the relation happened to use.
    expect(result.relations[0]?.from).toBe('Osmosis');
  });

  it('the log line carries no concept name or identifier (D-005) — dropped is a fixed record of counts', () => {
    const result = reconcileRelations(
      [relation({ to: 'A specific unknown concept name' })],
      [concept('Osmosis')],
    );
    const serialised = JSON.stringify(result.dropped);
    expect(serialised).not.toContain('unknown concept name');
    expect(serialised).not.toContain('Osmosis');
    expect(Object.keys(result.dropped).sort()).toEqual([
      'missing-passage-provenance',
      'not-per-document-eligible',
      'unknown-concept',
    ]);
  });

  it('drops a type the per-document stage is not eligible to emit (contrasts-with, prerequisite, causes, related)', () => {
    const concepts = [concept('Osmosis'), concept('Membrane transport')];
    for (const type of ['contrasts-with', 'prerequisite', 'causes', 'related'] as const) {
      const result = reconcileRelations([relation({ type })], concepts);
      expect(result.relations).toHaveLength(0);
      expect(result.dropped['not-per-document-eligible']).toBe(1);
    }
  });

  it('drops a relation whose endpoint has no introducing passage — a filing-only concept the read never anchored', () => {
    const result = reconcileRelations(
      [relation()],
      [concept('Osmosis', { anchor: undefined }), concept('Membrane transport')],
    );
    expect(result.relations).toHaveLength(0);
    expect(result.dropped['missing-passage-provenance']).toBe(1);
  });

  it('every emitted edge carries the introducing passages of BOTH endpoints (C7.10)', () => {
    const result = reconcileRelations(
      [relation()],
      [
        concept('Osmosis', { anchor: anchor('Lecture 1.md', 0, 5) }),
        concept('Membrane transport', { anchor: anchor('Lecture 2.md', 10, 20) }),
      ],
    );
    expect(result.relations[0]?.introducingPassages).toEqual({
      from: anchor('Lecture 1.md', 0, 5),
      to: anchor('Lecture 2.md', 10, 20),
    });
  });

  it('an empty proposal list reconciles to no edges and no drops', () => {
    const result = reconcileRelations([], [concept('Osmosis')]);
    expect(result.relations).toEqual([]);
    expect(totalDropped(result.dropped)).toBe(0);
  });
});
