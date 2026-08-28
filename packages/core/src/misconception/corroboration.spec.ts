/**
 * `corroboration.ts` — `ol-2zfj.32`, `[D-130]`. This suite pins the two
 * things this wrapper adds over the already-tested join
 * (`../concept/confusion-pairing/corroborate.spec.ts`'s 16 cases): the
 * honest-empty-input guard, and the verdict rename
 * (`'uncorroborated'` → `'noise-candidate'`). It does not re-prove the join
 * itself (resolution, symmetric matching, occurrence summation) — that
 * coverage already exists and this wrapper delegates to it unchanged.
 *
 * INV-3: every concept name, id and statement here is coined. No course
 * code, note title or wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { ConfusionPairingConcept } from '../concept/confusion-pairing/types.js';
import { type ConceptRelation, deriveRelationSet, type RelationSet } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import { corroborateConfusionPairings } from './corroboration.js';
import type { MisconceptionRecord } from './types.js';

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

describe('corroborateConfusionPairings', () => {
  it('HONEST EMPTY INPUT: zero misconception records yields zero verdicts, never a default noise-candidate', () => {
    // Today's real production state (ol-2zfj.27 context): the misconception
    // projection has zero real records. A real contrasts-with edge exists —
    // if this wrapper defaulted silence to 'noise-candidate' it would flag
    // every live edge for retirement on day one, purely because nothing has
    // been graded yet.
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const verdicts = corroborateConfusionPairings(set, [], [concept('Alpha'), concept('Beta')]);
    expect(verdicts).toEqual([]);
  });

  it('HONEST EMPTY INPUT: records present but none carry evidence (confusedWithConceptId null) also yields zero verdicts', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const verdicts = corroborateConfusionPairings(
      set,
      [record({ confusedWithConceptId: null })],
      [concept('Alpha'), concept('Beta')],
    );
    expect(verdicts).toEqual([]);
  });

  it('reports a corroborated verdict when a misconception record evidences a served contrasts-with edge', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const verdicts = corroborateConfusionPairings(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Beta' })],
      [concept('Alpha'), concept('Beta')],
    );

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.verdict).toBe('corroborated');
    expect(verdicts[0]?.a).toBe('Alpha');
    expect(verdicts[0]?.b).toBe('Beta');
    expect(verdicts[0]?.misconceptionRecordCount).toBe(1);
    expect(verdicts[0]?.misconceptionOccurrenceCount).toBe(1);
  });

  it("renames the join's 'uncorroborated' standing to 'noise-candidate' once real evidence exists elsewhere", () => {
    // Real evidence exists in this run (on a DIFFERENT pair), so silence on
    // this edge is a meaningful measurement rather than "we never looked" —
    // this is the case the honest-empty-input guard must NOT suppress.
    const set = setOf(contrastsWith('Alpha', 'Beta'), contrastsWith('Gamma', 'Delta'));
    const verdicts = corroborateConfusionPairings(
      set,
      [record({ conceptId: 'Gamma', confusedWithConceptId: 'Delta' })],
      [concept('Alpha'), concept('Beta'), concept('Gamma'), concept('Delta')],
    );

    expect(verdicts).toHaveLength(2);
    const alphaBeta = verdicts.find((v) => v.a === 'Alpha' || v.b === 'Alpha');
    const gammaDelta = verdicts.find((v) => v.a === 'Gamma' || v.b === 'Gamma');
    expect(alphaBeta?.verdict).toBe('noise-candidate');
    expect(alphaBeta?.misconceptionRecordCount).toBe(0);
    expect(gammaDelta?.verdict).toBe('corroborated');
  });

  it('matches evidence symmetrically, same as the underlying join', () => {
    const set = setOf(contrastsWith('Alpha', 'Beta'));
    const verdicts = corroborateConfusionPairings(
      set,
      [record({ conceptId: 'Beta', confusedWithConceptId: 'Alpha' })],
      [concept('Alpha'), concept('Beta')],
    );
    expect(verdicts[0]?.verdict).toBe('corroborated');
  });

  it('returns an empty array when the relation set has no contrasts-with edges, even with real evidence present', () => {
    const set = setOf();
    const verdicts = corroborateConfusionPairings(
      set,
      [record({ conceptId: 'Alpha', confusedWithConceptId: 'Beta' })],
      [concept('Alpha'), concept('Beta')],
    );
    expect(verdicts).toEqual([]);
  });
});
