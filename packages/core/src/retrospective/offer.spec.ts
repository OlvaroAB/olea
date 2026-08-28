import { describe, expect, it } from 'vitest';
import type { RetrospectiveOfferEvent } from './offer.js';
import { hasAssessmentPassed, resolveRetrospectiveOfferStatus } from './offer.js';

describe('hasAssessmentPassed', () => {
  it('is false for a due date in the future', () => {
    expect(hasAssessmentPassed('2026-09-10', new Date('2026-09-01T00:00:00.000Z'))).toBe(false);
  });

  it('is true the day after the due date', () => {
    expect(hasAssessmentPassed('2026-09-01', new Date('2026-09-02T00:00:00.000Z'))).toBe(true);
  });

  it('is false on the due date itself — the assessment has not yet passed', () => {
    expect(hasAssessmentPassed('2026-09-01', new Date('2026-09-01T23:00:00.000Z'))).toBe(false);
  });

  it('is false for an absent or unparseable due date — never treated as already passed', () => {
    expect(hasAssessmentPassed(undefined, new Date('2026-09-01T00:00:00.000Z'))).toBe(false);
    expect(hasAssessmentPassed('not-a-date', new Date('2026-09-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('resolveRetrospectiveOfferStatus', () => {
  const path = 'Courses/C1/Final.md';

  it('is not-yet-eligible before the assessment has passed, regardless of events', () => {
    expect(resolveRetrospectiveOfferStatus([], path, false)).toBe('not-yet-eligible');
  });

  it('is offered once passed, with no prior events — the standing card shows', () => {
    expect(resolveRetrospectiveOfferStatus([], path, true)).toBe('offered');
  });

  it('is opened once an opened event exists for this assessment, and stays opened', () => {
    const events: readonly RetrospectiveOfferEvent[] = [
      { kind: 'retrospective-opened', assessmentPath: path, timestamp: '2026-09-02T10:00:00Z' },
    ];
    expect(resolveRetrospectiveOfferStatus(events, path, true)).toBe('opened');
  });

  it('is dismissed once a dismissed event exists, with no opened event', () => {
    const events: readonly RetrospectiveOfferEvent[] = [
      {
        kind: 'retrospective-dismissed',
        assessmentPath: path,
        timestamp: '2026-09-02T10:00:00Z',
      },
    ];
    expect(resolveRetrospectiveOfferStatus(events, path, true)).toBe('dismissed');
  });

  it('never re-offers: an opened-then-dismissed pair for the same assessment stays opened, not offered', () => {
    const events: readonly RetrospectiveOfferEvent[] = [
      { kind: 'retrospective-opened', assessmentPath: path, timestamp: '2026-09-02T10:00:00Z' },
    ];
    expect(resolveRetrospectiveOfferStatus(events, path, true)).not.toBe('offered');
  });

  it("an event for a DIFFERENT assessment never affects this one's status", () => {
    const events: readonly RetrospectiveOfferEvent[] = [
      {
        kind: 'retrospective-opened',
        assessmentPath: 'Courses/C2/Midterm.md',
        timestamp: '2026-09-02T10:00:00Z',
      },
    ];
    expect(resolveRetrospectiveOfferStatus(events, path, true)).toBe('offered');
  });
});
