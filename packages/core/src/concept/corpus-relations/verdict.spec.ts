/**
 * The combined-passage verdict and its reconciliation (`[EXT-5]`,
 * `ol-2zfj.7`) — every emitted edge was produced with the introducing
 * passages of BOTH endpoints in context, and records which passages those
 * were. This suite is the acceptance criteria's "a test fails if any edge
 * is emitted without them" oracle.
 *
 * INV-3: every string here is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../../extract/types.js';
import type { VaultPath } from '../../vault/types.js';
import type { CorpusConcept, CorpusRelationCandidate } from './types.js';
import type { CorpusVerdict } from './verdict.js';
import { reconcileCorpusVerdicts } from './verdict.js';

function anchor(sourcePath: VaultPath, start = 0, end = 10): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end } } };
}

function concept(name: string, overrides: Partial<CorpusConcept> = {}): CorpusConcept {
  return { name, aliases: [], anchor: anchor('Lecture 1.md'), ...overrides };
}

function candidate(
  a: CorpusConcept,
  b: CorpusConcept,
  signals: CorpusRelationCandidate['signals'] = ['embedding-proximity'],
): CorpusRelationCandidate {
  return { a, b, signals };
}

function verdict(overrides: Partial<CorpusVerdict> = {}): CorpusVerdict {
  return {
    a: 'Osmosis',
    b: 'Diffusion basics',
    type: 'prerequisite',
    direction: 'b-to-a',
    confidence: 0.75,
    ...overrides,
  };
}

describe('reconcileCorpusVerdicts — every emitted edge carries both endpoints’ introducing passages', () => {
  it('emits an edge carrying BOTH endpoints’ introducing passages', () => {
    const osmosis = concept('Osmosis', { anchor: anchor('Lecture 1.md', 0, 5) });
    const diffusion = concept('Diffusion basics', { anchor: anchor('Lecture 2.md', 10, 20) });
    const result = reconcileCorpusVerdicts([verdict()], [candidate(osmosis, diffusion)]);

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.introducingPassages).toEqual({
      from: anchor('Lecture 2.md', 10, 20), // b-to-a: diffusion -> osmosis
      to: anchor('Lecture 1.md', 0, 5),
    });
    expect(result.relations[0]?.from).toBe('Diffusion basics');
    expect(result.relations[0]?.to).toBe('Osmosis');
  });

  it('every emitted edge carries an explicit provenance and confidence, never defaulted', () => {
    const osmosis = concept('Osmosis');
    const diffusion = concept('Diffusion basics');
    const result = reconcileCorpusVerdicts([verdict()], [candidate(osmosis, diffusion)]);
    expect(result.relations[0]?.provenance).toBe('model-proposed');
    expect(result.relations[0]?.confidence).toBe(0.75);
  });

  it('emits `contrasts-with` without requiring a direction (symmetric type)', () => {
    const a = concept('Type I error');
    const b = concept('Type II error');
    const symmetricVerdict: CorpusVerdict = {
      a: 'Type I error',
      b: 'Type II error',
      type: 'contrasts-with',
      confidence: 0.6,
    };
    const result = reconcileCorpusVerdicts([symmetricVerdict], [candidate(a, b)]);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.type).toBe('contrasts-with');
  });

  it('honours `a-to-b` direction for a directed type', () => {
    const a = concept('Foundational idea');
    const b = concept('Advanced idea');
    const result = reconcileCorpusVerdicts(
      [verdict({ a: 'Foundational idea', b: 'Advanced idea', direction: 'a-to-b' })],
      [candidate(a, b)],
    );
    expect(result.relations[0]?.from).toBe('Foundational idea');
    expect(result.relations[0]?.to).toBe('Advanced idea');
  });

  it("pins prerequisite's canonical endpoint reading: `from` is the prerequisite, `to` is the dependent (ol-2zfj.17)", () => {
    // The named example `../relation.js`'s `ProposedRelation`/`ConceptRelation`
    // doc points at: "Foundational Skill" is prerequisite to "Advanced Skill"
    // — she must be solid on the foundational skill before the advanced one
    // is attempted. `direction: 'a-to-b'` reads as "a is prerequisite to b",
    // so `a` (the prerequisite) must land in `from` and `b` (the dependent)
    // in `to` — never the reverse.
    const foundational = concept('Foundational Skill');
    const advanced = concept('Advanced Skill');
    const result = reconcileCorpusVerdicts(
      [
        verdict({
          a: 'Foundational Skill',
          b: 'Advanced Skill',
          type: 'prerequisite',
          direction: 'a-to-b',
        }),
      ],
      [candidate(foundational, advanced)],
    );
    expect(result.relations).toHaveLength(1);
    // The prerequisite (must be solid first) is `from`.
    expect(result.relations[0]?.from).toBe('Foundational Skill');
    // The dependent concept (what requires it) is `to`.
    expect(result.relations[0]?.to).toBe('Advanced Skill');
  });

  it('drops a directed verdict with no direction stated, rather than guessing one', () => {
    const a = concept('Foundational idea');
    const b = concept('Advanced idea');
    const undirectedVerdict: CorpusVerdict = {
      a: 'Foundational idea',
      b: 'Advanced idea',
      type: 'prerequisite',
      confidence: 0.75,
    };
    const result = reconcileCorpusVerdicts([undirectedVerdict], [candidate(a, b)]);
    expect(result.relations).toHaveLength(0);
    expect(result.dropped['no-relation']).toBe(1);
  });

  it('drops a verdict naming a type this stage may not emit (is-a, part-of, causes, related)', () => {
    const a = concept('Osmosis');
    const b = concept('Diffusion basics');
    for (const type of ['is-a', 'part-of', 'causes', 'related'] as const) {
      const result = reconcileCorpusVerdicts(
        [verdict({ a: 'Osmosis', b: 'Diffusion basics', type, direction: 'a-to-b' })],
        [candidate(a, b)],
      );
      expect(result.relations).toHaveLength(0);
      expect(result.dropped['not-corpus-eligible-type']).toBe(1);
    }
  });

  it('drops a verdict naming a concept outside the candidate set that was actually sent', () => {
    const a = concept('Osmosis');
    const b = concept('Diffusion basics');
    const result = reconcileCorpusVerdicts(
      [verdict({ a: 'Osmosis', b: 'A concept never nominated this run' })],
      [candidate(a, b)],
    );
    expect(result.relations).toHaveLength(0);
    expect(result.dropped['unknown-concept']).toBe(1);
  });

  it('the drop record carries no concept name (D-005) — a fixed record of counts', () => {
    const a = concept('Osmosis');
    const b = concept('Diffusion basics');
    const result = reconcileCorpusVerdicts(
      [verdict({ a: 'Osmosis', b: 'A specific unknown concept name' })],
      [candidate(a, b)],
    );
    const serialised = JSON.stringify(result.dropped);
    expect(serialised).not.toContain('unknown concept name');
    expect(serialised).not.toContain('Osmosis');
  });

  it('[D-070/ol-9qwy] a candidate her own wikilink nominated reconciles to the strongest provenance tier (`hers`)', () => {
    const osmosis = concept('Osmosis');
    const diffusion = concept('Diffusion basics');
    const result = reconcileCorpusVerdicts(
      [verdict()],
      [candidate(osmosis, diffusion, ['her-link'])],
    );
    expect(result.relations[0]?.provenance).toBe('hers');
  });

  it('[D-070/ol-9qwy] `hers` wins even when another cheap signal ALSO nominated the same pair', () => {
    const osmosis = concept('Osmosis');
    const diffusion = concept('Diffusion basics');
    const result = reconcileCorpusVerdicts(
      [verdict()],
      [candidate(osmosis, diffusion, ['embedding-proximity', 'her-link'])],
    );
    expect(result.relations[0]?.provenance).toBe('hers');
  });

  it('[D-070/ol-9qwy] a candidate with no her-link signal stays `model-proposed` — the type may still be model-inferred either way', () => {
    const osmosis = concept('Osmosis');
    const diffusion = concept('Diffusion basics');
    const result = reconcileCorpusVerdicts(
      [verdict()],
      [candidate(osmosis, diffusion, ['assessment-cooccurrence'])],
    );
    expect(result.relations[0]?.provenance).toBe('model-proposed');
    expect(result.relations[0]?.type).toBe('prerequisite'); // still model-typed, only provenance differs
  });

  it('[D-070/ol-9qwy] provenance is looked up per PAIR, not leaked across two unrelated candidates in the same batch', () => {
    const osmosis = concept('Osmosis');
    const diffusion = concept('Diffusion basics');
    const typeI = concept('Type I error');
    const typeII = concept('Type II error');
    const result = reconcileCorpusVerdicts(
      [
        verdict({ a: 'Osmosis', b: 'Diffusion basics' }),
        { a: 'Type I error', b: 'Type II error', type: 'contrasts-with', confidence: 0.5 },
      ],
      [
        candidate(osmosis, diffusion, ['her-link']),
        candidate(typeI, typeII, ['embedding-proximity']),
      ],
    );
    expect(result.relations).toHaveLength(2);
    const byType = new Map(result.relations.map((r) => [r.type, r.provenance]));
    expect(byType.get('prerequisite')).toBe('hers');
    expect(byType.get('contrasts-with')).toBe('model-proposed');
  });

  it('an empty verdict list reconciles to no edges and no drops', () => {
    const result = reconcileCorpusVerdicts(
      [],
      [candidate(concept('Osmosis'), concept('Diffusion basics'))],
    );
    expect(result.relations).toEqual([]);
    expect(Object.values(result.dropped).reduce((s, n) => s + (n ?? 0), 0)).toBe(0);
  });
});
