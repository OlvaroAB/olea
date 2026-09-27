import { describe, expect, it } from 'vitest';
import {
  deriveProbeOutcome,
  probeSucceeded,
  type QualifyingProbeReviewEvent,
} from './probe-outcome.js';

// Scenarios: features/F2-review.md (olea-service), "Feature: F2.24 — Offering
// an application probe" — @auto:core/instrument/probe-outcome.spec
//
// [D-394] acceptance: "The probe record stores no outcome; success is
// derived at read time from the qualifying review-log event of that
// presentation, and a skip, a defective-probe attempt or a missing event
// reads as not succeeded."

describe('deriveProbeOutcome — [D-394]', () => {
  it('reads not-succeeded when no qualifying event exists (never presented, or nothing recorded)', () => {
    expect(deriveProbeOutcome(undefined)).toBe('not-succeeded');
  });

  it('reads a skip as not-succeeded (F5.7)', () => {
    const event: QualifyingProbeReviewEvent = { kind: 'skipped' };
    expect(deriveProbeOutcome(event)).toBe('not-succeeded');
  });

  it('reads a defective-probe attempt as not-succeeded (C5.3, [D-097])', () => {
    const event: QualifyingProbeReviewEvent = { kind: 'defective' };
    expect(deriveProbeOutcome(event)).toBe('not-succeeded');
  });

  it('reads a graded incorrect verdict as not-succeeded', () => {
    const event: QualifyingProbeReviewEvent = { kind: 'graded', correct: false };
    expect(deriveProbeOutcome(event)).toBe('not-succeeded');
  });

  it('reads a graded correct verdict as succeeded — the only path to success', () => {
    const event: QualifyingProbeReviewEvent = { kind: 'graded', correct: true };
    expect(deriveProbeOutcome(event)).toBe('succeeded');
  });

  it('probeSucceeded is a boolean convenience over the same four readings', () => {
    expect(probeSucceeded(undefined)).toBe(false);
    expect(probeSucceeded({ kind: 'skipped' })).toBe(false);
    expect(probeSucceeded({ kind: 'defective' })).toBe(false);
    expect(probeSucceeded({ kind: 'graded', correct: false })).toBe(false);
    expect(probeSucceeded({ kind: 'graded', correct: true })).toBe(true);
  });
});
