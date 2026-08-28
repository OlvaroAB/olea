/**
 * Scenarios: `features/F4-oracle.md`, "F4.6 / F4.7 / F4.8 — the session
 * builder", the three duration-model scenarios —
 * @auto:core/study-session/duration.spec
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  ASSUMED_INSTRUMENT_SECONDS,
  DEFAULT_MIN_MEASURED_REVIEWS,
  EXPLAIN_BACK_ASSUMED_SECONDS,
  estimateInstrumentDurations,
  MINIMUM_ESTIMATE_SECONDS,
  SESSION_INSTRUMENT_TYPES,
} from './duration.js';

let seq = 0;

function review(
  instrumentType: 'qa' | 'cloze' | 'mcq' | 'explain-back',
  durationMs: number | null,
): ReviewLogEntry {
  seq += 1;
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `e${seq}`,
    timestamp: '2026-09-14T09:00:00.000+00:00',
    instrumentId: `i${seq}`,
    instrumentType,
    conceptIds: ['Alpha'],
    rating: 'good',
    wasUnsure: false,
    durationMs,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
  };
}

function suspend(): ReviewLogEntry {
  seq += 1;
  return {
    schemaVersion: 5,
    kind: 'suspend',
    eventId: `s${seq}`,
    timestamp: '2026-09-14T09:00:00.000+00:00',
    instrumentId: `i${seq}`,
    conceptIds: ['Alpha'],
  };
}

/** `n` reviews of one type, each at the same duration. */
function reviews(
  type: 'qa' | 'cloze' | 'mcq',
  n: number,
  durationMs: number,
): readonly ReviewLogEntry[] {
  return Array.from({ length: n }, () => review(type, durationMs));
}

describe('estimateInstrumentDurations — the measured half', () => {
  it('prefers the median of her own logged durations once there are enough of them', () => {
    // Five samples: 10s, 20s, 30s, 40s, 50s. Median 30s, not the mean (30s
    // here too by construction — the mean/median distinction is asserted
    // separately below, where an outlier separates them).
    const history = [
      review('qa', 10_000),
      review('qa', 20_000),
      review('qa', 30_000),
      review('qa', 40_000),
      review('qa', 50_000),
    ];
    const model = estimateInstrumentDurations(history);
    const qa = model.estimates.find((e) => e.instrumentType === 'qa');

    expect(qa?.source).toBe('measured');
    expect(qa?.seconds).toBe(30);
    expect(qa?.sampleCount).toBe(5);
    expect(model.secondsFor('qa')).toBe(30);
    expect(model.sourceFor('qa')).toBe('measured');
  });

  it('is not dragged by a card left open — the median is the whole reason there is no outlier filter', () => {
    const history = [
      review('qa', 20_000),
      review('qa', 20_000),
      review('qa', 30_000),
      review('qa', 40_000),
      // Four hours: she went to make tea. A mean would report ~48 minutes per
      // card and build a "20-minute session" of half a card.
      review('qa', 14_400_000),
    ];
    const model = estimateInstrumentDurations(history);
    expect(model.secondsFor('qa')).toBe(30);
  });

  it('floors an estimate at MINIMUM_ESTIMATE_SECONDS so a zeroed log cannot make instruments free', () => {
    const model = estimateInstrumentDurations(reviews('mcq', 7, 0));
    expect(model.sourceFor('mcq')).toBe('measured');
    expect(model.secondsFor('mcq')).toBe(MINIMUM_ESTIMATE_SECONDS);
    expect(model.secondsFor('mcq')).toBeGreaterThan(0);
  });
});

describe('estimateInstrumentDurations — the assumed half', () => {
  it('falls back to the documented assumption with no history at all, and says so in a field', () => {
    const model = estimateInstrumentDurations([]);
    expect(model.basis).toBe('assumed');
    expect(model.totalSampleCount).toBe(0);
    for (const type of SESSION_INSTRUMENT_TYPES) {
      expect(model.sourceFor(type)).toBe('assumed');
      expect(model.secondsFor(type)).toBe(ASSUMED_INSTRUMENT_SECONDS[type]);
    }
  });

  it('holds the assumption while the samples are below the stated minimum, and carries the count anyway', () => {
    const history = reviews('cloze', DEFAULT_MIN_MEASURED_REVIEWS - 1, 5_000);
    const model = estimateInstrumentDurations(history);
    const cloze = model.estimates.find((e) => e.instrumentType === 'cloze');

    expect(cloze?.source).toBe('assumed');
    expect(cloze?.seconds).toBe(ASSUMED_INSTRUMENT_SECONDS.cloze);
    // The samples are still visible: "some history, not enough yet" is a
    // different state from "no history", and both read 'assumed'.
    expect(cloze?.sampleCount).toBe(DEFAULT_MIN_MEASURED_REVIEWS - 1);
  });

  it('reports mixed when her history covers one type and not the others', () => {
    const model = estimateInstrumentDurations(reviews('mcq', 6, 12_000));
    expect(model.basis).toBe('mixed');
    expect(model.sourceFor('mcq')).toBe('measured');
    expect(model.sourceFor('qa')).toBe('assumed');
    expect(model.sourceFor('cloze')).toBe('assumed');
  });

  it('reports measured only when every type is', () => {
    const model = estimateInstrumentDurations([
      ...reviews('qa', 5, 40_000),
      ...reviews('cloze', 5, 20_000),
      ...reviews('mcq', 5, 30_000),
    ]);
    expect(model.basis).toBe('measured');
    expect(model.totalSampleCount).toBe(15);
  });

  it('the minimum is an argument, not a constant baked into the model', () => {
    const history = reviews('qa', 2, 8_000);
    expect(estimateInstrumentDurations(history).sourceFor('qa')).toBe('assumed');
    expect(estimateInstrumentDurations(history, { minMeasuredReviews: 2 }).sourceFor('qa')).toBe(
      'measured',
    );
  });

  it('refuses a minimum that is not a positive integer rather than silently substituting one', () => {
    expect(() => estimateInstrumentDurations([], { minMeasuredReviews: 0 })).toThrow(
      /positive integer/,
    );
    expect(() => estimateInstrumentDurations([], { minMeasuredReviews: 1.5 })).toThrow(
      /positive integer/,
    );
  });
});

describe('estimateInstrumentDurations — what does not count', () => {
  it('ignores suspend and unsuspend records: a suspend is not a zero-second review', () => {
    const history = [...reviews('qa', 5, 30_000), suspend(), suspend(), suspend()];
    const model = estimateInstrumentDurations(history);
    const qa = model.estimates.find((e) => e.instrumentType === 'qa');
    expect(qa?.sampleCount).toBe(5);
    expect(qa?.seconds).toBe(30);
  });

  it('ignores a review whose durationMs was never measured, rather than reading null as zero', () => {
    const history = [
      ...reviews('qa', 5, 30_000),
      review('qa', null),
      review('qa', null),
      review('qa', null),
    ];
    const model = estimateInstrumentDurations(history);
    expect(model.estimates.find((e) => e.instrumentType === 'qa')?.sampleCount).toBe(5);
    expect(model.secondsFor('qa')).toBe(30);
  });

  it("explain-back's samples never leak into the candidate types' buckets, and vice versa (F2.14a, `[D-126]`)", () => {
    const history = Array.from({ length: 20 }, () => review('explain-back', 300_000));
    const model = estimateInstrumentDurations(history);
    // `basis`/`totalSampleCount`/`estimates` describe the FSRS-schedulable
    // candidates only (`SESSION_INSTRUMENT_TYPES`) — explain-back is priced
    // through a separate field, not folded into these (see duration.ts's
    // `DurationModel` doc), so 20 explain-back samples move neither.
    expect(model.basis).toBe('assumed');
    expect(model.totalSampleCount).toBe(0);
    for (const type of SESSION_INSTRUMENT_TYPES) {
      expect(model.sourceFor(type)).toBe('assumed');
    }
  });
});

describe('estimateInstrumentDurations — accepted explain-back (F2.14a, `[D-126]`)', () => {
  it('prices an accepted explain-back at the declared 90s assumption with no history', () => {
    const model = estimateInstrumentDurations([]);
    expect(EXPLAIN_BACK_ASSUMED_SECONDS).toBe(90);
    expect(model.secondsFor('explain-back')).toBe(EXPLAIN_BACK_ASSUMED_SECONDS);
    expect(model.sourceFor('explain-back')).toBe('assumed');
    expect(model.explainBack?.instrumentType).toBe('explain-back');
    expect(model.explainBack?.sampleCount).toBe(0);
  });

  it('holds the assumption while explain-back samples are below the stated minimum', () => {
    const history = Array.from({ length: DEFAULT_MIN_MEASURED_REVIEWS - 1 }, () =>
      review('explain-back', 40_000),
    );
    const model = estimateInstrumentDurations(history);
    expect(model.sourceFor('explain-back')).toBe('assumed');
    expect(model.secondsFor('explain-back')).toBe(EXPLAIN_BACK_ASSUMED_SECONDS);
    expect(model.explainBack?.sampleCount).toBe(DEFAULT_MIN_MEASURED_REVIEWS - 1);
  });

  it('the declared 90s is superseded by the median of her own measured explain-back durations, via the identical mechanism the other three types run', () => {
    const history = [
      review('explain-back', 100_000),
      review('explain-back', 110_000),
      review('explain-back', 120_000),
      review('explain-back', 130_000),
      review('explain-back', 140_000),
    ];
    const model = estimateInstrumentDurations(history);
    expect(model.sourceFor('explain-back')).toBe('measured');
    expect(model.secondsFor('explain-back')).toBe(120);
    expect(model.explainBack?.sampleCount).toBe(5);
    // Superseding explain-back's own estimate does not touch the candidate
    // types' estimates — the same per-type isolation `duration.ts` already
    // guarantees for qa/cloze/mcq.
    for (const type of SESSION_INSTRUMENT_TYPES) {
      expect(model.sourceFor(type)).toBe('assumed');
      expect(model.secondsFor(type)).toBe(ASSUMED_INSTRUMENT_SECONDS[type]);
    }
  });

  it('a review whose durationMs was never measured is ignored, not read as zero, for explain-back too', () => {
    const history = [
      ...Array.from({ length: 5 }, () => review('explain-back', 90_000)),
      review('explain-back', null),
      review('explain-back', null),
    ];
    const model = estimateInstrumentDurations(history);
    expect(model.explainBack?.sampleCount).toBe(5);
    expect(model.secondsFor('explain-back')).toBe(90);
  });

  it('explain-back is priced but never joins the FSRS-schedulable candidate set', () => {
    const model = estimateInstrumentDurations([]);
    expect(model.estimates.map((e) => e.instrumentType)).not.toContain('explain-back');
    expect(SESSION_INSTRUMENT_TYPES).not.toContain('explain-back');
  });
});

describe('the assumed values are labelled assumptions, and the module says what replaces them', () => {
  it('every assumed constant is superseded per type, independently, by her own history', () => {
    // The property that matters is not the numbers themselves — they are
    // guesses, stated as such in the module doc — but that a single type's
    // history is enough to replace that type's guess and nothing else's.
    const model = estimateInstrumentDurations(reviews('qa', 5, 60_000));
    expect(model.secondsFor('qa')).toBe(60);
    expect(model.secondsFor('cloze')).toBe(ASSUMED_INSTRUMENT_SECONDS.cloze);
    expect(model.secondsFor('mcq')).toBe(ASSUMED_INSTRUMENT_SECONDS.mcq);
  });

  it('covers every schedulable instrument type, so no session item can fall through to an invented number', () => {
    const model = estimateInstrumentDurations([]);
    expect(model.estimates.map((e) => e.instrumentType)).toEqual([...SESSION_INSTRUMENT_TYPES]);
  });
});
