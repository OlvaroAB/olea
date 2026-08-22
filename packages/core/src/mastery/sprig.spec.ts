// Scenario: features/F2-review.md — "F2.3 — Mastery sprig reflects real
// maturity" and F6.2's Today mastery overview (features/F6-today.md:297,
// which names this rollup as its blocker). Concept ids are structural
// placeholders, never fixture vocabulary — INV-3.
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { MASTERY_DISPLAY, MASTERY_ORDER } from './display.js';
import { conceptSprig, masteryDistribution } from './sprig.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 4,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

describe('conceptSprig — the sprig-ready projection (BRIEF §3)', () => {
  it('a concept with no evidence sprigs at `new`, one leaf', () => {
    const sprig = conceptSprig([], 'concept-a');
    expect(sprig.state).toBe('new');
    expect(sprig.display).toBe(MASTERY_DISPLAY.new);
    expect(sprig.display.leaves).toBe(1);
  });

  it('resolves the rolled-up state through the single vocabulary site — never a second copy of the words', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      review({
        eventId: `d${i}`,
        timestamp: `2026-01-0${i + 1}T09:00:00-04:00`,
        rating: 'good',
      }),
    );
    const sprig = conceptSprig(entries, 'concept-a');
    expect(sprig.state).toBe('yours');
    expect(sprig.display).toBe(MASTERY_DISPLAY.yours);
    expect(sprig.display.label).toBe('yours');
    expect(sprig.display.leaves).toBe(5);
  });
});

describe('masteryDistribution — the Today mastery overview (F6.2)', () => {
  it('an empty set of concepts is an all-zero distribution', () => {
    const dist = masteryDistribution([], []);
    expect(dist.total).toBe(0);
    expect(Object.values(dist.counts).every((n) => n === 0)).toBe(true);
    expect(Object.keys(dist.counts)).toEqual([...MASTERY_ORDER]);
  });

  it('a concept named in the requested set but absent from the log counts as new, not omitted', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      review({
        eventId: `a${i}`,
        timestamp: `2026-01-0${i + 1}T09:00:00-04:00`,
        conceptIds: ['concept-a'],
        rating: 'good',
      }),
    );
    const dist = masteryDistribution(entries, ['concept-a', 'concept-never-studied']);
    expect(dist.total).toBe(2);
    expect(dist.counts.new).toBe(1);
    expect(dist.counts.yours).toBe(1);
  });

  it('buckets each concept independently — never an aggregate mastery number', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) =>
        review({
          eventId: `a${i}`,
          timestamp: `2026-01-0${i + 1}T09:00:00-04:00`,
          conceptIds: ['concept-a'],
          rating: 'good',
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        review({
          eventId: `b${i}`,
          timestamp: `2026-02-0${i + 1}T09:00:00-04:00`,
          conceptIds: ['concept-b'],
          rating: 'again',
        }),
      ),
      review({ eventId: 'c0', conceptIds: ['concept-c'], instrumentType: 'mcq', rating: 'good' }),
    ];
    const dist = masteryDistribution(entries, ['concept-a', 'concept-b', 'concept-c']);
    expect(dist.total).toBe(3);
    expect(dist.counts.yours).toBe(1); // concept-a: spaced recall success
    expect(dist.counts.shaky).toBe(1); // concept-b: all misses
    // concept-c: one successful MCQ — high recent rate, but only one
    // session, so the spacing gate holds it at `coming`, not `solid`.
    expect(dist.counts.coming).toBe(1);
  });

  it('defaults to every concept the log names when no set is given', () => {
    const entries = [
      review({ conceptIds: ['concept-a'] }),
      review({ eventId: 'x', conceptIds: ['concept-x'] }),
    ];
    const dist = masteryDistribution(entries);
    expect(dist.total).toBe(2);
  });
});
