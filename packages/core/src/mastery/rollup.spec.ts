// Scenario: features/F2-review.md — "F2.3 — Mastery sprig reflects real
// maturity" / "recognition alone caps the sprig, it doesn't max it",
// tagged `@auto:core/mastery/rollup.spec` (this file; the tag was corrected
// from `core/mastery-rollup.spec` to match this module's actual path — see
// this task's report).
//
// Vocabulary updated for D-049/`VOC-1` (`ol-7efk`): the retired five-state
// ordinal (`new`/`shaky`/`coming`/`solid`/`yours`) is now the ratified
// four-stage set (`seed`/`sprout`/`sapling`/`tree`). `shaky` and `coming`
// collapse onto one word, `sprout` — see `rollup.ts`'s module doc for why.
//
// Concept and instrument ids below are structural placeholders
// ("concept-a", "qa:concept-a:1"), never fixture vocabulary — INV-3.
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  computeAllConceptMastery,
  computeConceptMastery,
  conceptIdsInLog,
  evidenceTierOf,
  masteryAtTimeForConceptIds,
} from './rollup.js';

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

/** One event per day, starting `startDay`, `count` days apart by 1 day each. */
function onConsecutiveDays(
  startDay: string,
  count: number,
  build: (day: string, index: number) => Partial<ReviewLogRecord>,
): ReviewLogEntry[] {
  const start = new Date(`${startDay}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    return review({ eventId: `d${i}`, timestamp: `${day}T09:00:00-04:00`, ...build(day, i) });
  });
}

describe('evidenceTierOf — R7 tiers', () => {
  it('mcq is recognition, qa/cloze are recall, explain-back is explanation', () => {
    expect(evidenceTierOf('mcq')).toBe('recognition');
    expect(evidenceTierOf('qa')).toBe('recall');
    expect(evidenceTierOf('cloze')).toBe('recall');
    expect(evidenceTierOf('explain-back')).toBe('explanation');
  });
});

describe('computeConceptMastery — empty log and no-evidence concept', () => {
  it('an empty log is `seed`', () => {
    const result = computeConceptMastery([], 'concept-a');
    expect(result.state).toBe('seed');
    expect(result.evidence.scoredEventCount).toBe(0);
  });

  it('a concept the log never names is `seed`, even when the log has other evidence', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, () => ({ conceptIds: ['concept-b'] }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('seed');
  });
});

describe('computeConceptMastery — recognition-only concept caps at sapling (named test, R7)', () => {
  it('many correct MCQ reviews, spread over days, never exceed sapling', () => {
    const entries = onConsecutiveDays('2026-01-01', 20, () => ({
      instrumentType: 'mcq',
      instrumentId: 'mcq:concept-a:1',
      rating: 'good',
    }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('sapling');
    expect(result.evidence.recognitionOnly).toBe(true);
  });

  it('a single mixed-in recall success lifts the same concept past the cap', () => {
    const mcq = onConsecutiveDays('2026-01-01', 19, () => ({
      instrumentType: 'mcq',
      instrumentId: 'mcq:concept-a:1',
      rating: 'good',
    }));
    const recall = review({
      eventId: 'd-recall',
      timestamp: '2026-01-20T09:00:00-04:00',
      instrumentType: 'qa',
      instrumentId: 'qa:concept-a:1',
      rating: 'good',
    });
    const result = computeConceptMastery([...mcq, recall], 'concept-a');
    expect(result.evidence.recognitionOnly).toBe(false);
    expect(result.state).toBe('tree');
  });
});

describe('computeConceptMastery — explain-back is recorded, never scored (contract silence)', () => {
  it('explain-back attempts alone do not reach past seed — no success signal exists to act on', () => {
    const entries = [
      review({
        eventId: 'e1',
        instrumentType: 'explain-back',
        rating: null,
        instrumentId: 'explain-back:concept-a',
      }),
      review({
        eventId: 'e2',
        timestamp: '2026-01-11T09:00:00-04:00',
        instrumentType: 'explain-back',
        rating: null,
        instrumentId: 'explain-back:concept-a',
      }),
    ];
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('seed');
    expect(result.evidence.explainBackAttempts).toBe(2);
    expect(result.evidence.tiersPracticed.explanation).toBe(true);
  });

  it('explain-back attempts do not by themselves satisfy the `tree` gate even alongside solid recall evidence', () => {
    const recall = onConsecutiveDays('2026-01-01', 5, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    // Recall alone already reaches `tree` (see the dedicated test below); this
    // asserts explain-back's presence changes nothing about *how* that happens
    // — it is recorded, not counted, per this module's documented reading of
    // R7's "success", not "attempt".
    const withExplainBack = [
      ...recall,
      review({
        eventId: 'eb',
        timestamp: '2026-01-06T09:00:00-04:00',
        instrumentType: 'explain-back',
        rating: null,
        instrumentId: 'explain-back:concept-a',
      }),
    ];
    const withoutExplainBack = computeConceptMastery(recall, 'concept-a');
    const with_ = computeConceptMastery(withExplainBack, 'concept-a');
    expect(with_.state).toBe(withoutExplainBack.state);
    expect(with_.evidence.explainBackAttempts).toBe(1);
  });
});

describe('computeConceptMastery — recall success reaches `tree` (R7: recognition alone cannot)', () => {
  it('spaced, reliable Q&A recall reaches tree', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('tree');
    expect(result.evidence.recentRecallSuccess).toBe(true);
  });

  it('a high-success run crammed into one sitting is `sprout`, not `sapling` or `tree`', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      review({
        eventId: `c${i}`,
        timestamp: `2026-01-01T0${9 + i}:00:00-04:00`,
        instrumentType: 'qa',
        rating: 'good',
      }),
    );
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('sprout');
    expect(result.evidence.recentDistinctDays).toBe(1);
  });
});

describe('computeConceptMastery — a concept whose evidence disagrees sharply', () => {
  it('an even mix of hits and misses across several instruments reads as sprout', () => {
    // Exactly the default window size worth of evidence (4 <= 5), split
    // evenly, so the 50% boundary is unambiguous rather than an artefact of
    // which end of the window got trimmed.
    const entries = onConsecutiveDays('2026-01-01', 4, (_day, i) => ({
      instrumentType: i % 2 === 0 ? 'qa' : 'mcq',
      instrumentId: i % 2 === 0 ? 'qa:concept-a:1' : 'mcq:concept-a:1',
      rating: i % 2 === 0 ? 'good' : 'again',
    }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.evidence.recentSuccessRate).toBeCloseTo(0.5, 5);
    expect(result.state).toBe('sprout');
  });

  it('an all-failure history is still sprout, never a state below it — the vocabulary has no floor beneath sprout once evidence exists', () => {
    const entries = onConsecutiveDays('2026-01-01', 4, () => ({ rating: 'again' }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('sprout');
  });
});

describe('computeConceptMastery — options are honoured and validated', () => {
  it('a narrower recent window changes which events are read', () => {
    // Five fails then five successes, spread over ten days: a window of 5
    // sees only the recent successes; a window of 10 sees the mixed whole.
    const entries = onConsecutiveDays('2026-01-01', 10, (_day, i) => ({
      rating: i < 5 ? 'again' : 'good',
    }));
    const narrow = computeConceptMastery(entries, 'concept-a', { recentWindowSize: 5 });
    const wide = computeConceptMastery(entries, 'concept-a', { recentWindowSize: 10 });
    expect(narrow.evidence.recentSuccessRate).toBe(1);
    expect(wide.evidence.recentSuccessRate).toBe(0.5);
    expect(wide.state).toBe('sprout');
  });

  it('rejects a non-positive recentWindowSize', () => {
    expect(() => computeConceptMastery([], 'concept-a', { recentWindowSize: 0 })).toThrow();
  });

  it('rejects a highSuccessRate outside [0, 1]', () => {
    expect(() => computeConceptMastery([], 'concept-a', { highSuccessRate: 1.5 })).toThrow();
    expect(() => computeConceptMastery([], 'concept-a', { highSuccessRate: -0.1 })).toThrow();
  });

  it('rejects an empty conceptId', () => {
    expect(() => computeConceptMastery([], '')).toThrow();
  });
});

describe('rebuild-from-log equivalence and idempotent replay (this task N-013 requirement)', () => {
  it('projecting, discarding, and re-projecting the same log gives byte-identical results', () => {
    const entries = [
      ...onConsecutiveDays('2026-01-01', 4, (_d, i) => ({
        instrumentType: i % 2 === 0 ? 'qa' : 'mcq',
        rating: 'good',
      })),
      review({
        eventId: 'other-concept',
        timestamp: '2026-01-05T09:00:00-04:00',
        conceptIds: ['concept-b'],
      }),
    ];

    const first = computeAllConceptMastery(entries);
    // "Discard": nothing to tear down — the module holds no cache between
    // calls. Recompute from the same entries as a fresh call, proving that
    // fact rather than assuming it.
    const second = computeAllConceptMastery(entries);
    expect([...second]).toEqual([...first]);
  });

  it('is a pure function: the same call made twice returns equal, independently-built results', () => {
    const entries = onConsecutiveDays('2026-01-01', 6, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    const a = computeConceptMastery(entries, 'concept-a');
    const b = computeConceptMastery(entries, 'concept-a');
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // independently constructed, not memoised/shared
  });

  it('never mutates its input — replaying the identical entries array a second time changes nothing about it', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, (_d, i) => ({
      instrumentType: i % 2 === 0 ? 'qa' : 'mcq',
      rating: i % 2 === 0 ? 'good' : 'again',
    }));
    const before = JSON.parse(JSON.stringify(entries));
    computeConceptMastery(entries, 'concept-a');
    computeAllConceptMastery(entries);
    expect(entries).toEqual(before);
  });

  it('is indifferent to the order entries were supplied in — merge order never changes the result', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, (_d, i) => ({
      instrumentType: i % 2 === 0 ? 'qa' : 'mcq',
      rating: i % 2 === 0 ? 'good' : 'again',
    }));
    const forward = computeConceptMastery(entries, 'concept-a');
    const reversed = computeConceptMastery([...entries].reverse(), 'concept-a');
    expect(reversed).toEqual(forward);
  });
});

describe('conceptIdsInLog', () => {
  it('collects every concept named by a review event, sorted, ignoring suspend events', () => {
    const entries: ReviewLogEntry[] = [
      review({ eventId: 'a', conceptIds: ['concept-b', 'concept-a'] }),
      {
        schemaVersion: 4,
        kind: 'suspend',
        eventId: 's1',
        timestamp: '2026-01-02T09:00:00-04:00',
        instrumentId: 'qa:concept-c:1',
        conceptIds: ['concept-c'],
      },
    ];
    expect(conceptIdsInLog(entries)).toEqual(['concept-a', 'concept-b']);
  });
});

describe('computeAllConceptMastery', () => {
  it('rolls up every concept the log names, per concept — never an aggregate (D-031/ol-7328 ruling)', () => {
    const entries = [
      ...onConsecutiveDays('2026-01-01', 5, () => ({ conceptIds: ['concept-a'], rating: 'good' })),
      ...onConsecutiveDays('2026-01-01', 4, () => ({ conceptIds: ['concept-b'], rating: 'again' })),
    ];
    const all = computeAllConceptMastery(entries);
    expect(all.get('concept-a')?.state).toBe('tree');
    expect(all.get('concept-b')?.state).toBe('sprout');
  });

  it('a restricted conceptIds list rolls up only those concepts', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, (_d, i) => ({
      conceptIds: [i % 2 === 0 ? 'concept-a' : 'concept-b'],
    }));
    const all = computeAllConceptMastery(entries, ['concept-a']);
    expect([...all.keys()]).toEqual(['concept-a']);
  });
});

describe('masteryAtTimeForConceptIds — the value a future writer stamps (ol-g6zg v4 shape)', () => {
  it('builds a per-concept map agreeing with the given conceptIds', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    const value = masteryAtTimeForConceptIds(entries, ['concept-a']);
    expect(value).toEqual({ attribution: 'per-concept', byConcept: { 'concept-a': 'tree' } });
  });

  it('excludes the not-yet-appended event by construction — it only ever sees what the caller passes', () => {
    // Passing history that does *not* yet include "today's" event is the
    // caller's responsibility (module doc); this asserts the function reads
    // exactly what it is given and nothing more.
    const priorHistory = onConsecutiveDays('2026-01-01', 2, () => ({ rating: 'again' }));
    const value = masteryAtTimeForConceptIds(priorHistory, ['concept-a']);
    expect(value).toEqual({ attribution: 'per-concept', byConcept: { 'concept-a': 'sprout' } });
  });
});
