import { describe, expect, it } from 'vitest';
import {
  CONFUSION_ROUTING_LAPSE_THRESHOLD,
  confusionRoutingPromptLine,
  evaluateConfusionRouting,
} from './confusion-routing.js';
import { FORBIDDEN_VERDICT_PHRASES } from './framing.js';

describe('evaluateConfusionRouting — F2.12', () => {
  it('does not offer below the lapse threshold, even on a fresh Again', () => {
    const decision = evaluateConfusionRouting({
      rating: 'again',
      lapses: CONFUSION_ROUTING_LAPSE_THRESHOLD - 1,
    });
    expect(decision.shouldOffer).toBe(false);
  });

  it('offers exactly at the threshold, with the clause’s own worked example verbatim', () => {
    const decision = evaluateConfusionRouting({
      rating: 'again',
      lapses: CONFUSION_ROUTING_LAPSE_THRESHOLD,
    });
    expect(decision.shouldOffer).toBe(true);
    if (decision.shouldOffer) {
      expect(decision.lapses).toBe(CONFUSION_ROUTING_LAPSE_THRESHOLD);
      expect(decision.promptText).toBe(
        "You've missed this four times. That's usually not forgetting — want to explain it back?",
      );
    }
  });

  it('keeps offering past the threshold — repeated failure, not a one-shot notice', () => {
    const decision = evaluateConfusionRouting({ rating: 'again', lapses: 7 });
    expect(decision.shouldOffer).toBe(true);
  });

  it('never offers on a non-Again rating, no matter how high the lapse count', () => {
    for (const rating of ['hard', 'good', 'easy']) {
      const decision = evaluateConfusionRouting({ rating, lapses: 99 });
      expect(decision.shouldOffer).toBe(false);
    }
  });

  it('a rating just short of Again-as-failure semantics (an unrecognised string) never offers', () => {
    // Defensive: this function does not import `Rating` from `olea-contracts`
    // (see module doc) and compares the literal string — an unexpected value
    // must fail closed (no offer) rather than throw or default to offering.
    const decision = evaluateConfusionRouting({ rating: 'Again', lapses: 10 });
    expect(decision.shouldOffer).toBe(false);
  });
});

describe('confusionRoutingPromptLine — V3 fact / reinterpretation / one action', () => {
  it('spells out small counts, matching the clause’s own wording', () => {
    expect(confusionRoutingPromptLine(4)).toBe(
      "You've missed this four times. That's usually not forgetting — want to explain it back?",
    );
    expect(confusionRoutingPromptLine(6)).toContain('six times');
  });

  it('falls back to a numeral past the spelled-out range, rather than inventing more words', () => {
    expect(confusionRoutingPromptLine(11)).toContain('11 times');
  });

  it('always ends in the one available action, as a question she can decline', () => {
    for (const lapses of [4, 5, 6, 12]) {
      expect(confusionRoutingPromptLine(lapses)).toMatch(/want to explain it back\?$/);
    }
  });

  it('is free of every forbidden verdict phrase — the same M3 mechanical floor framing.spec.ts applies', () => {
    for (const lapses of [4, 5, 6, 7, 8, 12]) {
      const line = confusionRoutingPromptLine(lapses).toLowerCase();
      for (const phrase of FORBIDDEN_VERDICT_PHRASES) {
        expect(line).not.toContain(phrase);
      }
    }
  });

  it('never phrases the count as a verdict on effort ("always"/"never") even at high counts', () => {
    expect(confusionRoutingPromptLine(20).toLowerCase()).not.toMatch(/\balways\b|\bnever\b/);
  });
});
