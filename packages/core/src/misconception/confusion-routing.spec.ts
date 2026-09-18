import { describe, expect, it } from 'vitest';
import {
  CONFUSION_ROUTING_LAPSE_THRESHOLD,
  confusionRoutingPromptLine,
  type DirectPrerequisiteEvidence,
  evaluateConfusionRouting,
  type PrerequisiteEvidenceReading,
  prerequisiteAlternativePromptLine,
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

describe('evaluateConfusionRouting — F2.12 prerequisite-aware offer [D-265]', () => {
  const AT_THRESHOLD = CONFUSION_ROUTING_LAPSE_THRESHOLD;
  const prerequisite = (reading: PrerequisiteEvidenceReading): DirectPrerequisiteEvidence => ({
    conceptId: 'concept-a',
    reading,
  });

  it('a weak prerequisite is named as the alternative to explaining the failing concept back', () => {
    const decision = evaluateConfusionRouting({
      rating: 'again',
      lapses: AT_THRESHOLD,
      directPrerequisite: prerequisite('weak'),
    });
    expect(decision.shouldOffer).toBe(true);
    if (decision.shouldOffer) {
      expect(decision.offerKind).toBe('prerequisite-alternative');
      expect(decision.prerequisiteConceptId).toBe('concept-a');
      expect(decision.promptText).toBe(prerequisiteAlternativePromptLine(AT_THRESHOLD));
    }
  });

  it('an unknown prerequisite is treated the same as a weak one', () => {
    const decision = evaluateConfusionRouting({
      rating: 'again',
      lapses: AT_THRESHOLD,
      directPrerequisite: prerequisite('unknown'),
    });
    expect(decision.shouldOffer).toBe(true);
    if (decision.shouldOffer) {
      expect(decision.offerKind).toBe('prerequisite-alternative');
      expect(decision.prerequisiteConceptId).toBe('concept-a');
    }
  });

  it('a strong prerequisite yields the ordinary offer, with no detour', () => {
    const decision = evaluateConfusionRouting({
      rating: 'again',
      lapses: AT_THRESHOLD,
      directPrerequisite: prerequisite('strong'),
    });
    expect(decision.shouldOffer).toBe(true);
    if (decision.shouldOffer) {
      expect(decision.offerKind).toBe('explain-back');
      expect(decision.prerequisiteConceptId).toBeUndefined();
      expect(decision.promptText).toBe(confusionRoutingPromptLine(AT_THRESHOLD));
    }
  });

  it.each<PrerequisiteEvidenceReading>(['defective', 'provisional', 'inherited'])(
    '%s prerequisite evidence counts as neither weak nor strong — the ordinary offer stands unchanged',
    (reading) => {
      const decision = evaluateConfusionRouting({
        rating: 'again',
        lapses: AT_THRESHOLD,
        directPrerequisite: prerequisite(reading),
      });
      expect(decision.shouldOffer).toBe(true);
      if (decision.shouldOffer) {
        expect(decision.offerKind).toBe('explain-back');
        expect(decision.prerequisiteConceptId).toBeUndefined();
        expect(decision.promptText).toBe(confusionRoutingPromptLine(AT_THRESHOLD));
      }
    },
  );

  it('no direct prerequisite recorded behaves exactly as before this ruling', () => {
    const decision = evaluateConfusionRouting({ rating: 'again', lapses: AT_THRESHOLD });
    expect(decision.shouldOffer).toBe(true);
    if (decision.shouldOffer) {
      expect(decision.offerKind).toBe('explain-back');
      expect(decision.prerequisiteConceptId).toBeUndefined();
    }
  });

  it('the prerequisite branch changes only WHAT the offer says, never WHETHER one fires: below-threshold and non-Again ratings still never offer, even with a weak prerequisite', () => {
    expect(
      evaluateConfusionRouting({
        rating: 'again',
        lapses: AT_THRESHOLD - 1,
        directPrerequisite: prerequisite('weak'),
      }).shouldOffer,
    ).toBe(false);
    expect(
      evaluateConfusionRouting({
        rating: 'good',
        lapses: 99,
        directPrerequisite: prerequisite('weak'),
      }).shouldOffer,
    ).toBe(false);
  });

  it('reads fresh each call — the same failing concept can flip between the ordinary and prerequisite-aware offer across two independent calls, nothing cached or stored', () => {
    const first = evaluateConfusionRouting({
      rating: 'again',
      lapses: AT_THRESHOLD,
      directPrerequisite: prerequisite('weak'),
    });
    const second = evaluateConfusionRouting({
      rating: 'again',
      lapses: AT_THRESHOLD + 1,
      directPrerequisite: prerequisite('strong'),
    });
    expect(first.shouldOffer && first.offerKind).toBe('prerequisite-alternative');
    expect(second.shouldOffer && second.offerKind).toBe('explain-back');
  });

  it('carries no field describing WHY the prerequisite was named — no diagnosis, only the offer and the concept it points at', () => {
    const decision = evaluateConfusionRouting({
      rating: 'again',
      lapses: AT_THRESHOLD,
      directPrerequisite: prerequisite('weak'),
    });
    expect(decision.shouldOffer).toBe(true);
    if (decision.shouldOffer) {
      // Exactly the fields the type declares — a future field creeping in
      // unnoticed (e.g. a persisted-looking "reason" or "cause") would flag
      // here rather than only in a type review.
      expect(Object.keys(decision).sort()).toEqual(
        ['lapses', 'offerKind', 'prerequisiteConceptId', 'promptText', 'shouldOffer'].sort(),
      );
    }
  });
});

describe('prerequisiteAlternativePromptLine — V3 fact / reinterpretation / one action, hedged as a proposal', () => {
  it('spells out small counts, matching confusionRoutingPromptLine’s own convention', () => {
    expect(prerequisiteAlternativePromptLine(4)).toContain('four times');
    expect(prerequisiteAlternativePromptLine(6)).toContain('six times');
  });

  it('falls back to a numeral past the spelled-out range', () => {
    expect(prerequisiteAlternativePromptLine(11)).toContain('11 times');
  });

  it('ends in one available action, phrased as a question she can decline', () => {
    for (const lapses of [4, 5, 6, 12]) {
      expect(prerequisiteAlternativePromptLine(lapses)).toMatch(
        /Want to explain that back instead\?$/,
      );
    }
  });

  it('is hedged — proposes, never decides ("may trace to", never "is caused by" or "because of")', () => {
    for (const lapses of [4, 5, 6, 12]) {
      const line = prerequisiteAlternativePromptLine(lapses).toLowerCase();
      expect(line).toContain('may trace to');
      expect(line).not.toMatch(/because of|caused by|is due to/);
    }
  });

  it('names no concept — content-free, same discipline confusionRoutingPromptLine keeps', () => {
    expect(prerequisiteAlternativePromptLine(4)).not.toMatch(/concept|concept-a/i);
  });

  it('is free of every forbidden verdict phrase — the same M3 mechanical floor', () => {
    for (const lapses of [4, 5, 6, 7, 8, 12]) {
      const line = prerequisiteAlternativePromptLine(lapses).toLowerCase();
      for (const phrase of FORBIDDEN_VERDICT_PHRASES) {
        expect(line).not.toContain(phrase);
      }
    }
  });

  it('never phrases the count as a verdict on effort ("always"/"never") even at high counts', () => {
    expect(prerequisiteAlternativePromptLine(20).toLowerCase()).not.toMatch(/\balways\b|\bnever\b/);
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
