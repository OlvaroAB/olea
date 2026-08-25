// CHK-1 (`ol-3ux7.1`). Every fixture below is inline and structural — no
// vault content, no concept names, no course codes (INV-3).
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013 — a check that cannot fail reports
// green forever). Three of the six cases below are constructed to make
// `checkKnowledgeKindDistribution` return `ok: false`: a collapsed
// distribution, a suspiciously-clean batch with zero `unclassified`, and a
// batch too small to say anything at all is asserted `ok: true` for the
// OPPOSITE reason (declining, not passing) — both directions of "not a real
// verdict" are exercised, not just the passing path.
import { describe, expect, it } from 'vitest';
import {
  checkKnowledgeKindDistribution,
  DOMINANT_KIND_SHARE_CEILING,
  type KnowledgeKindLabel,
  MIN_SAMPLE_FOR_DISTRIBUTION_CHECK,
} from './knowledge-kind-distribution.js';

function batch(fact: number, category: number, principle: number, unclassified: number) {
  const labels: KnowledgeKindLabel[] = [
    ...Array(fact).fill('fact' as const),
    ...Array(category).fill('category' as const),
    ...Array(principle).fill('principle' as const),
    ...Array(unclassified).fill('unclassified' as const),
  ];
  return labels;
}

describe('checkKnowledgeKindDistribution', () => {
  it('fails on a collapsed distribution — one label at or above the ceiling', () => {
    // 46 fact, 2 category, 2 principle, 0 unclassified — 92% fact, past the
    // 90% ceiling. A broken classifier that always returns the same label
    // looks exactly like this.
    const verdict = checkKnowledgeKindDistribution(batch(46, 2, 2, 0));
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.dominantKindTooHigh).toBe(true);
    expect(verdict.measured.dominantShare).toBeGreaterThanOrEqual(DOMINANT_KIND_SHARE_CEILING);
  });

  it('fails when zero classifications came back unclassified in a large-enough batch', () => {
    const verdict = checkKnowledgeKindDistribution(batch(15, 10, 10, 0));
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.zeroUnclassifiedSuspicious).toBe(true);
    expect(verdict.measured.dominantKindTooHigh).toBe(false);
  });

  it('passes a healthy batch: no dominant label, some unclassified', () => {
    const verdict = checkKnowledgeKindDistribution(batch(12, 10, 9, 5));
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.dominantKindTooHigh).toBe(false);
    expect(verdict.measured.zeroUnclassifiedSuspicious).toBe(false);
    expect(verdict.measured.total).toBe(36);
  });

  it('declines rather than guesses below the sample floor', () => {
    const verdict = checkKnowledgeKindDistribution(batch(5, 3, 2, 0));
    expect(verdict.measured.total).toBeLessThan(MIN_SAMPLE_FOR_DISTRIBUTION_CHECK);
    expect(verdict.measured.sampleTooSmall).toBe(true);
    // ok:true here means "declined", not "passed" — the same
    // not-enough-history discipline InsightResult uses.
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.dominantKindTooHigh).toBe(false);
    expect(verdict.measured.zeroUnclassifiedSuspicious).toBe(false);
  });

  it('is exactly at the ceiling boundary, inclusive', () => {
    // 90 of 100 is exactly the ceiling — ">=", not ">".
    const verdict = checkKnowledgeKindDistribution(batch(90, 5, 5, 0));
    expect(verdict.measured.dominantShare).toBeCloseTo(0.9, 10);
    expect(verdict.measured.dominantKindTooHigh).toBe(true);
    expect(verdict.ok).toBe(false);
  });

  it('reports an empty batch as too small rather than as a division error', () => {
    const verdict = checkKnowledgeKindDistribution([]);
    expect(verdict.measured.total).toBe(0);
    expect(verdict.measured.sampleTooSmall).toBe(true);
    expect(verdict.ok).toBe(true);
  });
});
