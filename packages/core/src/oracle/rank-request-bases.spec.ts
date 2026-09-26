/**
 * `toOracleRankRequestBases` tests (`ol-egov.142.2`).
 *
 * Validates output against a LOCAL mirror of the service's
 * `oracleConceptCandidate.bases` zod schema
 * (`olea-service/src/tasks/oracleRank.ts`):
 *
 *   z.array(z.object({
 *     basis: z.enum(['past-paper', 'objectives', 'assessment-brief']),
 *     confidence: z.number().min(0).max(1),
 *   })).default([])
 *
 * — never a real import (`[D-069]`: the two repos share no types across
 * that boundary, and this package carries no zod dependency to import a
 * real schema through). This module is not called from production anywhere
 * (see `./rank-request-bases.ts`'s module doc) — these are its only tests.
 *
 * Every fixture string here is INVENTED — course codes and concept names —
 * per INV-3; nothing below is drawn from a real vault.
 */

import { describe, expect, it } from 'vitest';
import type { ConceptAssessmentEdge } from '../evidence-edge/types.js';
import { toOracleRankRequestBases } from './rank-request-bases.js';

const VALID_BASES = new Set(['past-paper', 'objectives', 'assessment-brief']);

/** Mirrors `oracleConceptCandidate.bases` — see this file's module doc. Returns false for anything the real zod schema would also reject. */
function matchesOracleRankBasesSchema(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const basis = (entry as Record<string, unknown>).basis;
    const confidence = (entry as Record<string, unknown>).confidence;
    return (
      typeof basis === 'string' &&
      VALID_BASES.has(basis) &&
      typeof confidence === 'number' &&
      confidence >= 0 &&
      confidence <= 1
    );
  });
}

/** Minimal, valid `ConceptAssessmentEdge` literal — only the fields this suite varies are parameterised. */
function edge(
  basis: ConceptAssessmentEdge['basis'],
  confidence: number,
  course = 'TESTC101',
): ConceptAssessmentEdge {
  return {
    conceptName: 'Widget theory',
    conceptKey: 'concept:widget-theory',
    assessmentPath: '02 Assignments/Quiz 1.md',
    course,
    yieldRank: 1,
    confidence,
    citations: [],
    ...(basis !== undefined ? { basis } : {}),
  };
}

describe('toOracleRankRequestBases', () => {
  it('maps a past-paper edge to a schema-valid bases entry', () => {
    const bases = toOracleRankRequestBases([edge('past-paper', 0.75)]);
    expect(bases).toEqual([{ basis: 'past-paper', confidence: 0.75 }]);
    expect(matchesOracleRankBasesSchema(bases)).toBe(true);
  });

  it('maps an objectives edge to a schema-valid bases entry', () => {
    const bases = toOracleRankRequestBases([edge('objectives', 0.5)]);
    expect(bases).toEqual([{ basis: 'objectives', confidence: 0.5 }]);
    expect(matchesOracleRankBasesSchema(bases)).toBe(true);
  });

  it('maps an assessment-brief edge (D-247) to a schema-valid bases entry', () => {
    const bases = toOracleRankRequestBases([edge('assessment-brief', 1)]);
    expect(bases).toEqual([{ basis: 'assessment-brief', confidence: 1 }]);
    expect(matchesOracleRankBasesSchema(bases)).toBe(true);
  });

  it("defaults an edge with no basis field to past-paper, matching ConceptAssessmentEdge.basis's own documented default", () => {
    const bases = toOracleRankRequestBases([edge(undefined, 0.4)]);
    expect(bases).toEqual([{ basis: 'past-paper', confidence: 0.4 }]);
  });

  it('combines all three bases for one concept, sorted deterministically, never folding one into another', () => {
    const bases = toOracleRankRequestBases([
      edge('past-paper', 0.6),
      edge('objectives', 0.3),
      edge('assessment-brief', 1),
    ]);
    expect(bases).toEqual([
      { basis: 'assessment-brief', confidence: 1 },
      { basis: 'objectives', confidence: 0.3 },
      { basis: 'past-paper', confidence: 0.6 },
    ]);
    expect(matchesOracleRankBasesSchema(bases)).toBe(true);
  });

  it('deduplicates two edges sharing a basis (from two different courses) by keeping the higher confidence', () => {
    const bases = toOracleRankRequestBases([
      edge('past-paper', 0.2, 'TESTC101'),
      edge('past-paper', 0.9, 'TESTC202'),
    ]);
    expect(bases).toEqual([{ basis: 'past-paper', confidence: 0.9 }]);
  });

  it('returns an empty array for no edges, itself schema-valid', () => {
    const bases = toOracleRankRequestBases([]);
    expect(bases).toEqual([]);
    expect(matchesOracleRankBasesSchema(bases)).toBe(true);
  });

  it('sanity: the mirrored schema rejects a basis or confidence the real contract would also reject', () => {
    expect(matchesOracleRankBasesSchema([{ basis: 'taught-depth', confidence: 0.5 }])).toBe(false);
    expect(matchesOracleRankBasesSchema([{ basis: 'past-paper', confidence: 1.5 }])).toBe(false);
    expect(matchesOracleRankBasesSchema([{ basis: 'past-paper', confidence: -0.1 }])).toBe(false);
  });
});
