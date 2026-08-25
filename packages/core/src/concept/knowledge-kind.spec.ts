/**
 * Knowledge-kind classification (component register row 1.5, `[KCT-1]`,
 * `ol-kxr6`, `./knowledge-kind.ts`).
 *
 * INV-3: every string here is coined. No course code, concept name or
 * wording comes from any real vault (N-015: synthetic never tunes a
 * threshold — these fixtures fix the derivation's *behaviour*, they never
 * fit a constant).
 */

import { describe, expect, it, vi } from 'vitest';
import type { Provenance } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';
import {
  assessKnowledgeKindDistribution,
  classifyKnowledgeKind,
  DOMINANT_KIND_SHARE_CEILING,
  gateKnowledgeKindConfidence,
  isKnowledgeKind,
  KNOWLEDGE_KINDS,
  type KnowledgeKindClassification,
  type KnowledgeKindClassifierPort,
  KnowledgeKindClassifierUnavailableError,
  MIN_SAMPLE_FOR_DISTRIBUTION_CHECK,
  summariseKnowledgeKindDistribution,
} from './knowledge-kind.js';

const SOURCE_PATH: VaultPath = 'course/note.md';

function anchor(start = 0, end = 10): Provenance {
  return { sourcePath: SOURCE_PATH, location: { page: 1, charRange: { start, end } } };
}

function passage(text: string): { text: string; anchor: Provenance } {
  return { text, anchor: anchor() };
}

describe('isKnowledgeKind', () => {
  it('accepts exactly the ratified candidate set', () => {
    for (const kind of KNOWLEDGE_KINDS) expect(isKnowledgeKind(kind)).toBe(true);
  });

  it('rejects unclassified and any other string', () => {
    expect(isKnowledgeKind('unclassified')).toBe(false);
    expect(isKnowledgeKind('mechanism')).toBe(false);
    expect(isKnowledgeKind('')).toBe(false);
  });
});

describe('gateKnowledgeKindConfidence', () => {
  it('commits when the response names a real label at or above the floor', () => {
    const result = gateKnowledgeKindConfidence(
      { kind: 'fact', confidence: 0.8 },
      { confidenceFloor: 0.8 },
    );
    expect(result).toEqual({
      status: 'classified',
      kind: 'fact',
      confidence: 0.8,
      method: 'model',
    });
  });

  it('declines when confidence is strictly below the floor, even for a real label', () => {
    const result = gateKnowledgeKindConfidence(
      { kind: 'principle', confidence: 0.79 },
      { confidenceFloor: 0.8 },
    );
    expect(result.status).toBe('unclassified');
    if (result.status === 'unclassified') expect(result.confidence).toBe(0.79);
  });

  it('passes through a model-declared unclassified regardless of confidence', () => {
    const result = gateKnowledgeKindConfidence(
      { kind: 'unclassified', confidence: 0.99 },
      { confidenceFloor: 0.1 },
    );
    expect(result.status).toBe('unclassified');
    if (result.status === 'unclassified') expect(result.confidence).toBe(0.99);
  });

  it('never adds a commitment the model did not make — the gate only ever adds declines', () => {
    // A model 'unclassified' at high confidence never becomes 'classified'
    // however low the floor is set.
    const result = gateKnowledgeKindConfidence(
      { kind: 'unclassified', confidence: 1 },
      { confidenceFloor: 0 },
    );
    expect(result.status).toBe('unclassified');
  });
});

describe('classifyKnowledgeKind', () => {
  it('INV-5: refuses before reaching the port when source material is empty, and the port is never called', async () => {
    const classify = vi.fn();
    const port: KnowledgeKindClassifierPort = { classify };
    const result = await classifyKnowledgeKind(
      port,
      { conceptName: 'gravity', sourceMaterial: [] },
      { confidenceFloor: 0.5 },
    );
    expect(result).toMatchObject({ outcome: 'not-run', reason: 'no-source-material' });
    expect(classify).not.toHaveBeenCalled();
  });

  it('calls the port with the offered material and gates the response', async () => {
    const classify = vi.fn().mockResolvedValue({ kind: 'category', confidence: 0.9 });
    const port: KnowledgeKindClassifierPort = { classify };
    const request = { conceptName: 'igneous rock', sourceMaterial: [passage('one passage')] };
    const result = await classifyKnowledgeKind(port, request, { confidenceFloor: 0.5 });

    expect(classify).toHaveBeenCalledWith(request);
    expect(result).toEqual({
      outcome: 'classified',
      classification: { status: 'classified', kind: 'category', confidence: 0.9, method: 'model' },
    });
  });

  it('reports a below-floor response as classified-but-unclassified, not as a failure to run', async () => {
    const port: KnowledgeKindClassifierPort = {
      classify: vi.fn().mockResolvedValue({ kind: 'fact', confidence: 0.2 }),
    };
    const result = await classifyKnowledgeKind(
      port,
      { conceptName: 'x', sourceMaterial: [passage('p')] },
      { confidenceFloor: 0.5 },
    );
    expect(result.outcome).toBe('classified');
    if (result.outcome === 'classified') expect(result.classification.status).toBe('unclassified');
  });

  it('turns KnowledgeKindClassifierUnavailableError into a not-run result carrying the reason', async () => {
    const port: KnowledgeKindClassifierPort = {
      classify: vi.fn().mockRejectedValue(new KnowledgeKindClassifierUnavailableError('offline')),
    };
    const result = await classifyKnowledgeKind(
      port,
      { conceptName: 'x', sourceMaterial: [passage('p')] },
      { confidenceFloor: 0.5 },
    );
    expect(result).toMatchObject({
      outcome: 'not-run',
      reason: 'classifier-unavailable',
      unavailableBecause: 'offline',
    });
  });

  it('turns any other port error into classifier-failed, distinct from unavailable', async () => {
    const port: KnowledgeKindClassifierPort = {
      classify: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const result = await classifyKnowledgeKind(
      port,
      { conceptName: 'x', sourceMaterial: [passage('p')] },
      { confidenceFloor: 0.5 },
    );
    expect(result).toMatchObject({ outcome: 'not-run', reason: 'classifier-failed' });
    expect((result as { detail: string }).detail).toContain('boom');
  });
});

describe('summariseKnowledgeKindDistribution', () => {
  function classified(
    kind: 'fact' | 'category' | 'principle',
    confidence = 0.9,
  ): KnowledgeKindClassification {
    return { status: 'classified', kind, confidence, method: 'model' };
  }
  const unclassified: KnowledgeKindClassification = {
    status: 'unclassified',
    confidence: 0.4,
    method: 'model',
  };

  it('tallies an empty sample to all zeros with no dominant kind', () => {
    const dist = summariseKnowledgeKindDistribution([]);
    expect(dist).toEqual({
      total: 0,
      unclassifiedCount: 0,
      countsByKind: { fact: 0, category: 0, principle: 0 },
      dominantKind: undefined,
      dominantShare: 0,
      unclassifiedShare: 0,
    });
  });

  it('counts each kind and unclassified separately, and computes shares over the total', () => {
    const sample = [classified('fact'), classified('fact'), classified('category'), unclassified];
    const dist = summariseKnowledgeKindDistribution(sample);
    expect(dist.total).toBe(4);
    expect(dist.countsByKind).toEqual({ fact: 2, category: 1, principle: 0 });
    expect(dist.unclassifiedCount).toBe(1);
    expect(dist.dominantKind).toBe('fact');
    expect(dist.dominantShare).toBe(0.5);
    expect(dist.unclassifiedShare).toBe(0.25);
  });

  it('reports no dominant kind when every classification is unclassified', () => {
    const dist = summariseKnowledgeKindDistribution([unclassified, unclassified]);
    expect(dist.dominantKind).toBeUndefined();
    expect(dist.dominantShare).toBe(0);
  });
});

describe('assessKnowledgeKindDistribution', () => {
  function classified(kind: 'fact' | 'category' | 'principle'): KnowledgeKindClassification {
    return { status: 'classified', kind, confidence: 0.9, method: 'model' };
  }
  const unclassified: KnowledgeKindClassification = {
    status: 'unclassified',
    confidence: 0.4,
    method: 'model',
  };

  it('below MIN_SAMPLE_FOR_DISTRIBUTION_CHECK, reports sampleTooSmall and never trips either flag', () => {
    const small = Array.from({ length: MIN_SAMPLE_FOR_DISTRIBUTION_CHECK - 1 }, () =>
      classified('fact'),
    );
    const check = assessKnowledgeKindDistribution(small);
    expect(check.sampleTooSmall).toBe(true);
    expect(check.dominantKindTooHigh).toBe(false);
    expect(check.zeroUnclassifiedSuspicious).toBe(false);
    expect(check.healthy).toBe(true);
  });

  it('CAN FAIL: a single label at or above the ceiling on a large enough sample trips dominantKindTooHigh', () => {
    const n = MIN_SAMPLE_FOR_DISTRIBUTION_CHECK;
    const dominantCount = Math.ceil(n * DOMINANT_KIND_SHARE_CEILING);
    const sample = [
      ...Array.from({ length: dominantCount }, () => classified('fact')),
      ...Array.from({ length: n - dominantCount }, () => classified('category')),
    ];
    const check = assessKnowledgeKindDistribution(sample);
    expect(check.dominantKindTooHigh).toBe(true);
    expect(check.healthy).toBe(false);
  });

  it('a sample strictly below the ceiling on the same size does not trip the flag', () => {
    const n = MIN_SAMPLE_FOR_DISTRIBUTION_CHECK * 2;
    const dominantCount = Math.floor(n * (DOMINANT_KIND_SHARE_CEILING - 0.2));
    const sample = [
      ...Array.from({ length: dominantCount }, () => classified('fact')),
      ...Array.from({ length: n - dominantCount }, (_, i) =>
        classified(i % 2 === 0 ? 'category' : 'principle'),
      ),
    ];
    const check = assessKnowledgeKindDistribution(sample);
    expect(check.dominantKindTooHigh).toBe(false);
  });

  it('CAN FAIL: zero unclassified across a large-enough sample trips zeroUnclassifiedSuspicious', () => {
    const n = MIN_SAMPLE_FOR_DISTRIBUTION_CHECK;
    const sample = Array.from({ length: n }, (_, i) =>
      classified(
        (['fact', 'category', 'principle'] as const)[i % 3] as 'fact' | 'category' | 'principle',
      ),
    );
    const check = assessKnowledgeKindDistribution(sample);
    expect(check.zeroUnclassifiedSuspicious).toBe(true);
    expect(check.healthy).toBe(false);
  });

  it('is healthy when the sample is large enough, has more than one dominant-share holder and includes at least one unclassified', () => {
    const n = MIN_SAMPLE_FOR_DISTRIBUTION_CHECK;
    const sample: KnowledgeKindClassification[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 4 === 0) sample.push(unclassified);
      else
        sample.push(
          classified(
            (['fact', 'category', 'principle'] as const)[i % 3] as
              | 'fact'
              | 'category'
              | 'principle',
          ),
        );
    }
    const check = assessKnowledgeKindDistribution(sample);
    expect(check.sampleTooSmall).toBe(false);
    expect(check.dominantKindTooHigh).toBe(false);
    expect(check.zeroUnclassifiedSuspicious).toBe(false);
    expect(check.healthy).toBe(true);
  });
});
