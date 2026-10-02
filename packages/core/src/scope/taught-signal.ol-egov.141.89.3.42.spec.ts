import { describe, expect, it } from 'vitest';
import { classifyDeclaredConcept, resolveTeachingArrival } from './coverage.js';

const none = {
  inWeekSlideDeck: false,
  calendarSessionWithSlideSequence: false,
  outcomesDocumentOrder: false,
  manualGroveConfirmation: false,
};

describe('a transcript is a taught signal at the deck step (ol-egov.141.89.3.42)', () => {
  it('counts like the week deck: direct, opens automatically', () => {
    const t = resolveTeachingArrival(false, { ...none, inWeekTranscript: true });
    const d = resolveTeachingArrival(false, { ...none, inWeekSlideDeck: true });
    expect(t).toEqual(d);
    expect(t).toEqual({ provenance: 'yes', opensAutomatically: true });
  });

  it('outranks the later steps and is absent-safe', () => {
    expect(
      resolveTeachingArrival(false, {
        ...none,
        inWeekTranscript: true,
        outcomesDocumentOrder: true,
      }).provenance,
    ).toBe('yes');
    expect(resolveTeachingArrival(false, none).provenance).toBeUndefined();
  });

  it('opens a cell with no note of hers on the concept', () => {
    const c = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      taughtSignal: { ...none, inWeekTranscript: true },
    });
    expect(c.kind).toBe('cell');
  });
});
