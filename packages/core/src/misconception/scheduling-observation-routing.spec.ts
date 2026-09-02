// Scenarios: features/F2-review.md, "F5.3a / R7 — the scheduling observation's
// third trigger" — @auto:core/misconception/scheduling-observation-routing.spec
import { describe, expect, it } from 'vitest';
import type { UnconsumedSchedulingObservation } from '../session/replay.js';
import { FORBIDDEN_VERDICT_PHRASES } from './framing.js';
import {
  evaluateSchedulingObservationRouting,
  schedulingObservationPromptLine,
} from './scheduling-observation-routing.js';

function observation(
  neighbourConceptId: string,
  subjectConceptIds: readonly string[] = ['concept-x'],
): UnconsumedSchedulingObservation {
  return {
    neighbourConceptId,
    subjectConceptIds,
    sourceEventId: 'e1',
    observedAt: '2026-08-10T09:00:00+00:00',
  };
}

describe('evaluateSchedulingObservationRouting — F5.3a / R7', () => {
  it('offers when the just-graded instrument evidences the neighbour concept of a live observation', () => {
    const live = new Map([['concept-y', observation('concept-y')]]);
    const decision = evaluateSchedulingObservationRouting({
      conceptIds: ['concept-y'],
      liveObservations: live,
    });
    expect(decision.shouldOffer).toBe(true);
    if (decision.shouldOffer) {
      expect(decision.neighbourConceptId).toBe('concept-y');
      expect(decision.promptText).toBe(schedulingObservationPromptLine());
    }
  });

  it('never offers when no live observation names any of the instrument’s concepts', () => {
    const live = new Map([['concept-z', observation('concept-z')]]);
    const decision = evaluateSchedulingObservationRouting({
      conceptIds: ['concept-y'],
      liveObservations: live,
    });
    expect(decision.shouldOffer).toBe(false);
  });

  it('honest empty case: an empty live-observations map never offers, regardless of concepts', () => {
    const decision = evaluateSchedulingObservationRouting({
      conceptIds: ['concept-a', 'concept-b'],
      liveObservations: new Map(),
    });
    expect(decision.shouldOffer).toBe(false);
  });

  it('an instrument with no concepts at all never offers', () => {
    const live = new Map([['concept-y', observation('concept-y')]]);
    const decision = evaluateSchedulingObservationRouting({
      conceptIds: [],
      liveObservations: live,
    });
    expect(decision.shouldOffer).toBe(false);
  });

  it('matches the FIRST of the instrument’s concepts with a live observation, in authored order', () => {
    const live = new Map([['concept-b', observation('concept-b')]]);
    const decision = evaluateSchedulingObservationRouting({
      conceptIds: ['concept-a', 'concept-b'],
      liveObservations: live,
    });
    expect(decision.shouldOffer).toBe(true);
    if (decision.shouldOffer) expect(decision.neighbourConceptId).toBe('concept-b');
  });

  // `[D-185]` / `ol-0r92.34`: the just-graded instrument that matches a live
  // observation is no longer necessarily an explain-back — this input shape
  // (`conceptIds` alone, no `instrumentType`) already had no way to tell the
  // difference, which is exactly what makes the widening a no-op here. These
  // four cases are the same assertion as the first test above, run once per
  // kind named in `[D-185]`'s ruling, to make "this function does not care"
  // an explicit, per-kind fact rather than an inference from one MCQ-shaped
  // example.
  it.each(['mcq', 'qa', 'cloze', 'explain-back'] as const)(
    'offers identically when the just-graded instrument is a %s (the observation itself carries no instrumentType)',
    (_kind) => {
      const live = new Map([['concept-y', observation('concept-y')]]);
      const decision = evaluateSchedulingObservationRouting({
        conceptIds: ['concept-y'],
        liveObservations: live,
      });
      expect(decision.shouldOffer).toBe(true);
      if (decision.shouldOffer) expect(decision.neighbourConceptId).toBe('concept-y');
    },
  );
});

describe('schedulingObservationPromptLine — V3 fact / reinterpretation / one action, its own reason line', () => {
  it('always ends in the one available action, as a question she can decline', () => {
    expect(schedulingObservationPromptLine()).toMatch(/want to explain it back\?$/);
  });

  it('is distinct from F2.12’s lapse framing — no lapse count, no "missed" wording', () => {
    expect(schedulingObservationPromptLine().toLowerCase()).not.toContain('missed');
  });

  it('is free of every forbidden verdict phrase — the same M3 mechanical floor confusion-routing.spec.ts applies', () => {
    const line = schedulingObservationPromptLine().toLowerCase();
    for (const phrase of FORBIDDEN_VERDICT_PHRASES) {
      expect(line).not.toContain(phrase);
    }
  });

  it('names no concept — ReviewInstrumentCommon carries no display name to interpolate, so this stays generic', () => {
    // Regression guard against a future edit reaching for a name that does
    // not exist on the input this module is handed (see this module's own
    // doc). Deliberately weak (a length check, not a content assertion)
    // because the point is "stays short and generic", not a fixed string.
    expect(schedulingObservationPromptLine().length).toBeLessThan(160);
  });

  it('never claims she was "explaining" — [D-185] widened the source to any instrument kind, so that framing would be false on an MCQ/Q&A/cloze source review', () => {
    const line = schedulingObservationPromptLine().toLowerCase();
    expect(line).not.toContain('explaining');
  });
});
