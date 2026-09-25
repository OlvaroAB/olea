import { describe, expect, it } from 'vitest';
import {
  decideResolutionEvidence,
  type ExplainBackResolutionCandidate,
  type RecallResolutionCandidate,
} from './resolution-evidence-decision.js';

// Synthetic study material only (INV-3) — invented concept ids throughout.

function explainBack(
  overrides: Partial<ExplainBackResolutionCandidate> = {},
): ExplainBackResolutionCandidate {
  return {
    source: 'explain-back',
    conceptId: 'concept-alpha',
    verdict: 'correct',
    hasOpenMisconceptionOnConcept: true,
    ...overrides,
  };
}

function recall(overrides: Partial<RecallResolutionCandidate> = {}): RecallResolutionCandidate {
  return {
    source: 'recall',
    conceptId: 'concept-alpha',
    instrumentType: 'qa',
    rating: 'good',
    hasOpenMisconceptionOnConcept: true,
    ...overrides,
  };
}

describe('decideResolutionEvidence — M2 (ol-egov.141.89.6.19)', () => {
  describe('explain-back source', () => {
    it('is "explanation" evidence on a correct verdict with an open misconception on the concept', () => {
      expect(decideResolutionEvidence(explainBack({ verdict: 'correct' }))).toBe('explanation');
    });

    it('is not evidence on a partial verdict', () => {
      expect(decideResolutionEvidence(explainBack({ verdict: 'partial' }))).toBeNull();
    });

    it('is not evidence on an incorrect verdict', () => {
      expect(decideResolutionEvidence(explainBack({ verdict: 'incorrect' }))).toBeNull();
    });

    it("is not evidence on unable-to-assess (pass one's not-yet-built outcome, ol-0r92.105)", () => {
      expect(decideResolutionEvidence(explainBack({ verdict: 'unable-to-assess' }))).toBeNull();
    });

    it('is not evidence when no open misconception is recorded on the concept, even on a correct verdict', () => {
      expect(
        decideResolutionEvidence(
          explainBack({ verdict: 'correct', hasOpenMisconceptionOnConcept: false }),
        ),
      ).toBeNull();
    });
  });

  describe('recall source (qa/cloze)', () => {
    it('is "recall" evidence on a Good rating with an open misconception on the concept', () => {
      expect(decideResolutionEvidence(recall({ rating: 'good' }))).toBe('recall');
    });

    it('is "recall" evidence on a Hard rating — she still produced the answer herself', () => {
      expect(decideResolutionEvidence(recall({ rating: 'hard' }))).toBe('recall');
    });

    it('is "recall" evidence on an Easy rating', () => {
      expect(decideResolutionEvidence(recall({ rating: 'easy' }))).toBe('recall');
    });

    it('is not evidence on an Again rating', () => {
      expect(decideResolutionEvidence(recall({ rating: 'again' }))).toBeNull();
    });

    it('is not evidence when no open misconception is recorded on the concept, even on a passing rating', () => {
      expect(
        decideResolutionEvidence(recall({ rating: 'good', hasOpenMisconceptionOnConcept: false })),
      ).toBeNull();
    });

    it('fails closed on an unrecognised rating string rather than treating it as a pass', () => {
      // Defensive: this module does not import `Rating` from
      // `olea-contracts` (mirrors confusion-routing.ts's own reasoning) and
      // checks membership in the three known passing literals
      // ('hard'/'good'/'easy') rather than excluding just 'again' — a
      // resolution claim is the higher-harm direction to get wrong (it
      // downgrades a real misconception record), so an unexpected value
      // must never silently read as evidence, unlike confusion-routing.ts's
      // own fail-closed-to-no-offer case where the harmless default is to
      // NOT offer.
      expect(decideResolutionEvidence(recall({ rating: 'not-a-real-rating' }))).toBeNull();
    });
  });

  it('recognition (mcq) is unrepresentable — RecallResolutionCandidate.instrumentType excludes it at the type level', () => {
    // No runtime assertion possible (that is the point): `instrumentType`
    // is typed `'qa' | 'cloze'`, so `{ ...recall(), instrumentType: 'mcq' }`
    // is a compile error, not a value this function has to reject at
    // runtime. See types.ts's `ResolutionEvidenceKind` doc and this file's
    // module doc for why recognition never counts (M2, R7).
    expect(true).toBe(true);
  });
});
