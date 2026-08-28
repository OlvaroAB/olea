import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENQUEUE_DEBOUNCE_POLICY,
  ENQUEUE_DEBOUNCE_MS,
  type EnqueueDebouncePolicy,
  evaluateEnqueueDebounce,
} from './enqueue-debounce.js';

const policy: EnqueueDebouncePolicy = { debounceMs: 1000 };

describe('evaluateEnqueueDebounce', () => {
  it('settles immediately on a first sighting (lastChangedAt: null) regardless of policy', () => {
    const result = evaluateEnqueueDebounce({ lastChangedAt: null, now: 0, policy });
    expect(result).toEqual({ kind: 'settled' });
  });

  it('debounces a change observed inside the quiet window', () => {
    const result = evaluateEnqueueDebounce({ lastChangedAt: 1_000, now: 1_500, policy });
    expect(result).toEqual({ kind: 'debounced', resumeNotBefore: 2_000 });
  });

  it('is still debounced at the instant just before the window closes', () => {
    const result = evaluateEnqueueDebounce({ lastChangedAt: 1_000, now: 1_999, policy });
    expect(result.kind).toBe('debounced');
  });

  it('settles exactly at the boundary — quietFor === debounceMs counts as settled', () => {
    const result = evaluateEnqueueDebounce({ lastChangedAt: 1_000, now: 2_000, policy });
    expect(result).toEqual({ kind: 'settled' });
  });

  it('settles once comfortably past the quiet window', () => {
    const result = evaluateEnqueueDebounce({ lastChangedAt: 1_000, now: 10_000, policy });
    expect(result).toEqual({ kind: 'settled' });
  });

  it('a repeated intermediate save resets the clock — debounced again relative to the newest change', () => {
    // First save at t=1000, re-saved at t=1500 (still inside the original window).
    // A caller re-evaluating with the NEW lastChangedAt (1500) sees a fresh window.
    const first = evaluateEnqueueDebounce({ lastChangedAt: 1_000, now: 1_500, policy });
    expect(first).toEqual({ kind: 'debounced', resumeNotBefore: 2_000 });
    const second = evaluateEnqueueDebounce({ lastChangedAt: 1_500, now: 1_600, policy });
    expect(second).toEqual({ kind: 'debounced', resumeNotBefore: 2_500 });
  });

  it('the declared default policy is three minutes', () => {
    expect(DEFAULT_ENQUEUE_DEBOUNCE_POLICY.debounceMs).toBe(ENQUEUE_DEBOUNCE_MS);
    expect(ENQUEUE_DEBOUNCE_MS).toBe(3 * 60 * 1000);
  });
});
