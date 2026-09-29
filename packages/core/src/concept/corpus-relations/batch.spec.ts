/**
 * `runCorpusRelationBatch` (`[EXT-5]`, `ol-2zfj.7`) — the corpus stage's
 * production-shaped entry point, end to end over a fake port.
 *
 * INV-3: every string here is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Provenance } from '../../extract/types.js';
import type { VaultPath } from '../../vault/types.js';
import { deriveRelationSet, servedRelations } from '../relation.js';
import { runCorpusRelationBatch } from './batch.js';
import {
  CORPUS_RELATIONS_CANDIDATE_CAP_PER_CALL_DECLARED_PENDING,
  type CorpusConcept,
} from './types.js';
import type { CorpusRelationVerdictPort } from './verdict.js';

function anchor(sourcePath: VaultPath, start = 0, end = 10): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start, end } } };
}

function concept(name: string, sourcePath: VaultPath = 'Lecture 1.md'): CorpusConcept {
  return { name, aliases: [], anchor: anchor(sourcePath) };
}

describe('runCorpusRelationBatch', () => {
  it('nominates, verdicts and reconciles end to end', async () => {
    const port: CorpusRelationVerdictPort = {
      verdict: vi.fn().mockResolvedValue({
        verdicts: [
          {
            a: 'Osmosis',
            b: 'Membrane transport',
            type: 'prerequisite',
            direction: 'b-to-a',
            confidence: 0.9,
          },
        ],
      }),
    };

    const result = await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport', 'Lecture 2.md')],
      signals: [{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Membrane transport' }],
      passageText: () => 'some passage text',
    });

    expect(result.relations).toHaveLength(1);
    expect(result.candidatesNominated).toBe(1);
    expect(result.relations[0]?.introducingPassages.to).toEqual(anchor('Lecture 1.md'));
  });

  it('[D-070/ol-9qwy] a `her-link` nomination signal reconciles to the strongest provenance tier, end to end', async () => {
    const port: CorpusRelationVerdictPort = {
      verdict: vi.fn().mockResolvedValue({
        verdicts: [
          {
            a: 'Osmosis',
            b: 'Membrane transport',
            type: 'prerequisite',
            direction: 'b-to-a',
            confidence: 0.9,
          },
        ],
      }),
    };

    const result = await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport', 'Lecture 2.md')],
      signals: [{ kind: 'her-link', a: 'Osmosis', b: 'Membrane transport' }],
      passageText: () => 'some passage text',
    });

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.provenance).toBe('hers');
  });

  it('[D-070/ol-9qwy] no her-link signal in the batch means every emitted edge stays `model-proposed` — breaks nothing where her links are absent', async () => {
    const port: CorpusRelationVerdictPort = {
      verdict: vi.fn().mockResolvedValue({
        verdicts: [
          {
            a: 'Osmosis',
            b: 'Membrane transport',
            type: 'prerequisite',
            direction: 'b-to-a',
            confidence: 0.9,
          },
        ],
      }),
    };

    const result = await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport', 'Lecture 2.md')],
      signals: [{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Membrane transport' }],
      passageText: () => 'some passage text',
    });

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.provenance).toBe('model-proposed');
  });

  it('never calls the port when nothing is nominated (INV-5, one level up from ../read.js)', async () => {
    const verdict = vi.fn();
    const port: CorpusRelationVerdictPort = { verdict };

    const result = await runCorpusRelationBatch(port, {
      newConcepts: [],
      allConcepts: [concept('Osmosis')],
      signals: [],
      passageText: () => 'unused',
    });

    expect(verdict).not.toHaveBeenCalled();
    expect(result.relations).toEqual([]);
    expect(result.candidatesNominated).toBe(0);
    expect(result.candidatesCappedOut).toBe(0);
  });

  it('hands the port both endpoints’ passage TEXT, not just names (clause-compliant by construction)', async () => {
    const passageText = vi.fn((c: CorpusConcept) => `text for ${c.name}`);
    const verdict = vi.fn().mockResolvedValue({ verdicts: [] });
    const port: CorpusRelationVerdictPort = { verdict };

    await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport')],
      signals: [{ kind: 'her-link', a: 'Osmosis', b: 'Membrane transport' }],
      passageText,
    });

    expect(verdict).toHaveBeenCalledTimes(1);
    const request = verdict.mock.calls[0]?.[0];
    expect(request.candidates[0].a.passageText).toBe('text for Osmosis');
    expect(request.candidates[0].b.passageText).toBe('text for Membrane transport');
  });

  it('a full drop-count record is always returned, even with zero drops', async () => {
    const port: CorpusRelationVerdictPort = {
      verdict: vi.fn().mockResolvedValue({ verdicts: [] }),
    };
    const result = await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport')],
      signals: [{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Membrane transport' }],
      passageText: () => 'x',
    });
    expect(Object.keys(result.dropped).sort()).toEqual([
      'missing-passage-provenance',
      'no-relation',
      'not-corpus-eligible-type',
      'unknown-concept',
    ]);
    expect(Object.values(result.dropped).every((n) => n === 0)).toBe(true);
  });

  it('holds no state between calls — two independent calls never see each other’s candidates', async () => {
    const seen: unknown[] = [];
    const port: CorpusRelationVerdictPort = {
      verdict: vi.fn(async (request) => {
        seen.push(request.candidates.length);
        return { verdicts: [] };
      }),
    };

    await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport')],
      signals: [{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Membrane transport' }],
      passageText: () => 'x',
    });
    await runCorpusRelationBatch(port, {
      newConcepts: [concept('Second concept')],
      allConcepts: [concept('Second concept'), concept('Third concept')],
      signals: [{ kind: 'embedding-proximity', a: 'Second concept', b: 'Third concept' }],
      passageText: () => 'x',
    });

    expect(seen).toEqual([1, 1]); // each call independently saw exactly its own one candidate
  });

  it('ONT-R2 [ol-2zfj.89]: a nomination past the declared cap is truncated, not sent whole, and the excess is counted rather than lost silently', async () => {
    const over = CORPUS_RELATIONS_CANDIDATE_CAP_PER_CALL_DECLARED_PENDING + 50;
    const hub = concept('Hub concept');
    const others = Array.from({ length: over }, (_, i) => concept(`Spoke concept ${i}`));
    const signals = others.map((o) => ({
      kind: 'embedding-proximity' as const,
      a: hub.name,
      b: o.name,
    }));

    const verdict = vi.fn().mockResolvedValue({ verdicts: [] });
    const port: CorpusRelationVerdictPort = { verdict };

    const result = await runCorpusRelationBatch(port, {
      newConcepts: [hub],
      allConcepts: [hub, ...others],
      signals,
      passageText: () => 'x',
    });

    expect(result.candidatesNominated).toBe(over);
    expect(result.candidatesCappedOut).toBe(50);
    expect(verdict).toHaveBeenCalledTimes(1);
    const request = verdict.mock.calls[0]?.[0];
    expect(request.candidates).toHaveLength(
      CORPUS_RELATIONS_CANDIDATE_CAP_PER_CALL_DECLARED_PENDING,
    );
  });

  it('stays uncapped, with zero capped-out, for a batch under the declared cap', async () => {
    const port: CorpusRelationVerdictPort = {
      verdict: vi.fn().mockResolvedValue({ verdicts: [] }),
    };
    const result = await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport')],
      signals: [{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Membrane transport' }],
      passageText: () => 'x',
    });
    expect(result.candidatesNominated).toBe(1);
    expect(result.candidatesCappedOut).toBe(0);
  });
});

// `ol-egov.141.89.4.23` (`[D-296]`, row 40 of the 2026-09-29 responses): `causes` is produced by the
// corpus stage behind the SAME judge port as the other two corpus types, and survives the fold into
// the served set — the two halves the explain-back partner reader needs before it can be handed one.
describe('runCorpusRelationBatch — causes (ol-egov.141.89.4.23)', () => {
  it('a causes verdict from the port becomes a causes edge that the fold serves with its direction intact', async () => {
    const port: CorpusRelationVerdictPort = {
      verdict: vi.fn().mockResolvedValue({
        verdicts: [
          {
            a: 'Membrane transport',
            b: 'Osmosis',
            type: 'causes',
            direction: 'b-to-a',
            confidence: 0.85,
          },
        ],
      }),
    };

    const result = await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport', 'Lecture 2.md')],
      signals: [{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Membrane transport' }],
      passageText: () => 'some passage text',
    });

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.type).toBe('causes');
    expect(result.dropped['not-corpus-eligible-type']).toBe(0);

    const set = deriveRelationSet([], result.relations);
    expect(set.droppedUnemittable).toBe(0);
    expect(servedRelations(set).map((e) => [e.type, e.from, e.to])).toEqual([
      ['causes', 'Osmosis', 'Membrane transport'],
    ]);
  });

  it('a causes verdict with no stated direction never reaches the fold — it is counted as no-relation', async () => {
    const port: CorpusRelationVerdictPort = {
      verdict: vi.fn().mockResolvedValue({
        verdicts: [{ a: 'Osmosis', b: 'Membrane transport', type: 'causes', confidence: 0.85 }],
      }),
    };

    const result = await runCorpusRelationBatch(port, {
      newConcepts: [concept('Osmosis')],
      allConcepts: [concept('Osmosis'), concept('Membrane transport', 'Lecture 2.md')],
      signals: [{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Membrane transport' }],
      passageText: () => 'some passage text',
    });

    expect(result.relations).toEqual([]);
    expect(result.dropped['no-relation']).toBe(1);
  });
});
