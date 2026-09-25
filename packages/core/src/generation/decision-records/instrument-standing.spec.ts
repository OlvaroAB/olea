import { describe, expect, it } from 'vitest';
import {
  CONFUSION_ROUTING_LAPSE_THRESHOLD,
  evaluateConfusionRouting,
} from '../../misconception/confusion-routing.js';
import {
  CLEAN_INSTRUMENT_STANDING,
  evaluateRepeatedFailureStandingCheck,
  INSTRUMENT_STANDING_CONCERNS,
  type InstrumentStanding,
  type InstrumentStandingConcern,
} from './instrument-standing.js';

describe('evaluateRepeatedFailureStandingCheck — [D-323]', () => {
  it('never even reads standing when repeated failure was not detected (no offer this time)', () => {
    const belowThreshold = evaluateConfusionRouting({
      rating: 'again',
      lapses: CONFUSION_ROUTING_LAPSE_THRESHOLD - 1,
    });
    expect(belowThreshold.shouldOffer).toBe(false);

    // A standing that WOULD be suspect, if it were ever consulted -- proving the short-circuit,
    // not just that a clean standing happens to agree.
    const suspectButUnconsulted: InstrumentStanding = { concerns: ['rejected'] };
    const outcome = evaluateRepeatedFailureStandingCheck({
      confusionRouting: belowThreshold,
      standing: suspectButUnconsulted,
    });
    expect(outcome.kind).toBe('not-repeated-failure');
  });

  it('DEMONSTRATES the bead-level requirement: a repeated-failure case, at the threshold, on a suspect card, routes to item repair rather than being read as a misconception', () => {
    // Failing-first shape of this assertion: before this module existed, the only input
    // `evaluateConfusionRouting` (row 3.11's flat lapse threshold) could act on was rating and
    // lapses -- a suspect card at the threshold had no route except the ordinary offer, i.e. would
    // have been treated as an occasion to suspect the LEARNER (misconception), never the item.
    const repeatedFailure = evaluateConfusionRouting({
      rating: 'again',
      lapses: CONFUSION_ROUTING_LAPSE_THRESHOLD,
    });
    expect(repeatedFailure.shouldOffer).toBe(true); // the ordinary F2.12 gate still fires

    const suspectStanding: InstrumentStanding = { concerns: ['changed-source-passage'] };
    const outcome = evaluateRepeatedFailureStandingCheck({
      confusionRouting: repeatedFailure,
      standing: suspectStanding,
    });

    expect(outcome.kind).toBe('route-to-item-repair');
    if (outcome.kind === 'route-to-item-repair') {
      expect(outcome.concerns).toEqual(['changed-source-passage']);
    }
  });

  it('routes to item repair on every one of the six named concerns, individually, including both clarification additions', () => {
    const repeatedFailure = evaluateConfusionRouting({
      rating: 'again',
      lapses: CONFUSION_ROUTING_LAPSE_THRESHOLD,
    });
    for (const concern of INSTRUMENT_STANDING_CONCERNS) {
      const outcome = evaluateRepeatedFailureStandingCheck({
        confusionRouting: repeatedFailure,
        standing: { concerns: [concern] },
      });
      expect(outcome.kind).toBe('route-to-item-repair');
    }
    // The clarification's two additions specifically -- named so a regression here is obvious.
    const clarificationAdditions: InstrumentStandingConcern[] = [
      'pending-revalidation',
      'safety-information-unavailable',
    ];
    for (const concern of clarificationAdditions) {
      expect(INSTRUMENT_STANDING_CONCERNS).toContain(concern);
    }
  });

  it('a clean-standing card past the threshold clears to the SAME already-built offer, verbatim -- never a new diagnosis of her', () => {
    const repeatedFailure = evaluateConfusionRouting({
      rating: 'again',
      lapses: 9, // well past threshold -- repeated difficulty, not a fresh crossing
    });
    expect(repeatedFailure.shouldOffer).toBe(true);

    const outcome = evaluateRepeatedFailureStandingCheck({
      confusionRouting: repeatedFailure,
      standing: CLEAN_INSTRUMENT_STANDING,
    });

    expect(outcome.kind).toBe('standing-clear');
    if (outcome.kind === 'standing-clear') {
      // Verbatim pass-through: this module writes no wording of its own.
      expect(outcome.offer).toBe(repeatedFailure);
    }
  });

  it('is synchronous -- no promise, no model call, ever', () => {
    const repeatedFailure = evaluateConfusionRouting({
      rating: 'again',
      lapses: CONFUSION_ROUTING_LAPSE_THRESHOLD,
    });
    const result = evaluateRepeatedFailureStandingCheck({
      confusionRouting: repeatedFailure,
      standing: CLEAN_INSTRUMENT_STANDING,
    });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('a non-Again rating never even reaches the standing question, at any lapse count', () => {
    const notFailed = evaluateConfusionRouting({ rating: 'good', lapses: 50 });
    expect(notFailed.shouldOffer).toBe(false);
    const outcome = evaluateRepeatedFailureStandingCheck({
      confusionRouting: notFailed,
      standing: { concerns: ['rejected'] },
    });
    expect(outcome.kind).toBe('not-repeated-failure');
  });
});
