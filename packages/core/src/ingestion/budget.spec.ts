import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  classifyHeadroom,
  EXHAUSTED_HEADROOM_THRESHOLD,
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  MAX_PACING_DELAY_MS,
  MIN_BACKOFF_MS,
  MIN_PACING_DELAY_MS,
  nextUtcMidnightMs,
  PACING_HEADROOM_THRESHOLD,
  pacingDelayMs,
} from './budget.js';
import type { RandomSource } from './types.js';

const fixedRandom = (value: number): RandomSource => ({ next: () => value });

describe('MAX_ATTEMPTS — a declared attempt cap, not fitted', () => {
  it('is a positive integer, tied to the exponent cap backoffDelayMs already uses', () => {
    expect(Number.isInteger(MAX_ATTEMPTS)).toBe(true);
    expect(MAX_ATTEMPTS).toBeGreaterThan(0);
    // Declared to match backoffDelayMs's own exponent cap of 8 (see that
    // function's comment): past this attempt count, further backoff growth
    // is already flat, so parking here rather than retrying forever adds no
    // new free parameter.
    expect(MAX_ATTEMPTS).toBe(8);
  });

  it('is well past MIN_BACKOFF_MS territory once reached — a genuinely transient fault has had several geometrically-spaced chances to clear', () => {
    const random = fixedRandom(0.5); // no jitter
    let cumulativeMs = 0;
    for (let attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
      cumulativeMs += backoffDelayMs(attempts, random);
    }
    // Several minutes of cumulative backoff before the cap bites — not an
    // aggressive cap that punishes a single blip.
    expect(cumulativeMs).toBeGreaterThan(5 * 60_000);
  });
});

describe('classifyHeadroom', () => {
  it('treats null (nothing reported yet) as ample — optimistic by design', () => {
    expect(classifyHeadroom(null)).toBe('ample');
  });

  it('classifies at and below the exhausted threshold as exhausted', () => {
    expect(classifyHeadroom(EXHAUSTED_HEADROOM_THRESHOLD)).toBe('exhausted');
    expect(classifyHeadroom(0)).toBe('exhausted');
  });

  it('classifies between the two thresholds as low', () => {
    expect(classifyHeadroom(EXHAUSTED_HEADROOM_THRESHOLD + 0.001)).toBe('low');
    expect(classifyHeadroom(PACING_HEADROOM_THRESHOLD)).toBe('low');
  });

  it('classifies above the pacing threshold as ample', () => {
    expect(classifyHeadroom(PACING_HEADROOM_THRESHOLD + 0.001)).toBe('ample');
    expect(classifyHeadroom(1)).toBe('ample');
  });
});

describe('pacingDelayMs', () => {
  it('is near the floor just inside the pacing threshold, with no jitter', () => {
    const delay = pacingDelayMs(PACING_HEADROOM_THRESHOLD, fixedRandom(0.5));
    expect(delay).toBe(MIN_PACING_DELAY_MS);
  });

  it('is near the ceiling right at the exhaustion edge, with no jitter', () => {
    const delay = pacingDelayMs(EXHAUSTED_HEADROOM_THRESHOLD, fixedRandom(0.5));
    expect(delay).toBe(MAX_PACING_DELAY_MS);
  });

  it('grows monotonically as headroom shrinks toward exhaustion', () => {
    const mid = (PACING_HEADROOM_THRESHOLD + EXHAUSTED_HEADROOM_THRESHOLD) / 2;
    const nearFull = pacingDelayMs(PACING_HEADROOM_THRESHOLD, fixedRandom(0.5));
    const middle = pacingDelayMs(mid, fixedRandom(0.5));
    const nearEmpty = pacingDelayMs(EXHAUSTED_HEADROOM_THRESHOLD, fixedRandom(0.5));
    expect(nearFull).toBeLessThan(middle);
    expect(middle).toBeLessThan(nearEmpty);
  });

  it('applies up to +/-10% jitter', () => {
    const base = pacingDelayMs(PACING_HEADROOM_THRESHOLD, fixedRandom(0.5));
    const high = pacingDelayMs(PACING_HEADROOM_THRESHOLD, fixedRandom(1));
    const low = pacingDelayMs(PACING_HEADROOM_THRESHOLD, fixedRandom(0));
    expect(high).toBeGreaterThan(base);
    expect(low).toBeLessThan(base);
  });
});

describe('backoffDelayMs', () => {
  it('doubles per attempt up to the cap, with no jitter', () => {
    const noJitter = fixedRandom(0.5); // jitter formula: 0.5 + next() -> 1.0x at next()=0.5
    const attempt1 = backoffDelayMs(1, noJitter);
    const attempt2 = backoffDelayMs(2, noJitter);
    const attempt3 = backoffDelayMs(3, noJitter);
    expect(attempt1).toBe(MIN_BACKOFF_MS);
    expect(attempt2).toBe(MIN_BACKOFF_MS * 2);
    expect(attempt3).toBe(MIN_BACKOFF_MS * 4);
  });

  it('caps at MAX_BACKOFF_MS however many attempts have accrued', () => {
    const delay = backoffDelayMs(50, fixedRandom(0.5));
    expect(delay).toBe(MAX_BACKOFF_MS);
  });

  it('treats attempts < 1 the same as attempts === 1 (defensive floor)', () => {
    expect(backoffDelayMs(0, fixedRandom(0.5))).toBe(backoffDelayMs(1, fixedRandom(0.5)));
  });
});

describe('nextUtcMidnightMs', () => {
  it('returns the very next UTC midnight strictly after now', () => {
    const now = Date.UTC(2026, 7, 9, 15, 30, 0); // 2026-08-09T15:30:00Z
    expect(nextUtcMidnightMs(now)).toBe(Date.UTC(2026, 7, 10, 0, 0, 0, 0));
  });

  it('rolls to tomorrow even when called at exactly midnight', () => {
    const now = Date.UTC(2026, 7, 9, 0, 0, 0, 0);
    expect(nextUtcMidnightMs(now)).toBe(Date.UTC(2026, 7, 10, 0, 0, 0, 0));
  });

  it('rolls across a month/year boundary correctly', () => {
    const now = Date.UTC(2025, 11, 31, 23, 59, 59); // 2025-12-31T23:59:59Z
    expect(nextUtcMidnightMs(now)).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
  });
});
