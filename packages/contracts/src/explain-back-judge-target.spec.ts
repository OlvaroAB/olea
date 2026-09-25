// `[D-277 / TARGET-1]` (`ol-egov.141.87`), landed by TARGET-2 (`ol-0r92.92`):
// `explain-back.judge.v1`'s optional learning-target bundle and the
// response-envelope acknowledgement. What this file has to prove:
//
//   1. absent bundle parses exactly as before (the previous grading path);
//   2. a full, well-formed bundle parses;
//   3. a malformed bundle is refused, never silently accepted or defaulted;
//   4. the acknowledgement ties `specificationDigest` to `specificationApplied`.
import { describe, expect, it } from 'vitest';
import {
  EXPLAIN_BACK_JUDGE_TARGET_SCHEMA_VERSION,
  explainBackJudgeAdequacyCriterion,
  explainBackJudgeDemand,
  explainBackJudgeDisqualifier,
  explainBackJudgeLearningTarget,
  explainBackJudgeLearningTargetField,
  explainBackJudgeSpecificationAcknowledgement,
} from './explain-back-judge-target.js';

function fullBundle(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: EXPLAIN_BACK_JUDGE_TARGET_SCHEMA_VERSION,
    declaredDemand: 'recall-a-fact',
    conditions: 'closed-book explain-back, no notes',
    permittedSupport: 'nothing beyond the question text',
    adequacyCriteria: [{ id: 'a1', text: 'names what a sampling distribution describes' }],
    disqualifiers: [{ id: 'd1', text: 'confuses it with a population distribution' }],
    sourceBasis: ['block-1', 'block-2'],
    questionBinding: 'recalls the definition of a sampling distribution',
    ...over,
  };
}

describe('explainBackJudgeLearningTargetField — absence means the previous grading path (D-277g)', () => {
  it('accepts undefined, unchanged from a request that never had this field', () => {
    expect(explainBackJudgeLearningTargetField.parse(undefined)).toBeUndefined();
  });

  it('the extension point is additive-only: a caller that never sets the key sends the same request it always did', () => {
    // Nothing about the rest of the correctness request's shape is asserted
    // or touched here — that full shape is not this bundle's job to define.
    const requestField = { learningTarget: explainBackJudgeLearningTargetField };
    expect(requestField.learningTarget.parse(undefined)).toBeUndefined();
  });
});

describe('explainBackJudgeLearningTarget — a full bundle parses', () => {
  it('accepts every field of a well-formed bundle', () => {
    const parsed = explainBackJudgeLearningTarget.parse(fullBundle());
    expect(parsed).toEqual(fullBundle());
  });

  it('accepts an empty disqualifiers array — not every item has one', () => {
    expect(() =>
      explainBackJudgeLearningTarget.parse(fullBundle({ disqualifiers: [] })),
    ).not.toThrow();
  });

  it('accepts every ruled demand word', () => {
    for (const demand of [
      'recall-a-fact',
      'calculate',
      'compare-or-choose',
      'apply-to-unfamiliar-case',
      'interpret-printed-result',
    ]) {
      expect(() =>
        explainBackJudgeLearningTarget.parse(fullBundle({ declaredDemand: demand })),
      ).not.toThrow();
    }
  });
});

describe('explainBackJudgeLearningTarget — malformed bundles are refused, never a silent fallback', () => {
  it('rejects the wrong schemaVersion literal', () => {
    expect(() =>
      explainBackJudgeLearningTarget.parse(fullBundle({ schemaVersion: 'e1-target.v1' })),
    ).toThrow();
  });

  it('rejects a declaredDemand outside the ruled vocabulary', () => {
    expect(() =>
      explainBackJudgeLearningTarget.parse(fullBundle({ declaredDemand: 'summarize' })),
    ).toThrow();
  });

  it('rejects zero adequacy criteria — a specification checking nothing', () => {
    expect(() =>
      explainBackJudgeLearningTarget.parse(fullBundle({ adequacyCriteria: [] })),
    ).toThrow();
  });

  it('rejects zero sourceBasis entries — a specification citing no source', () => {
    expect(() => explainBackJudgeLearningTarget.parse(fullBundle({ sourceBasis: [] }))).toThrow();
  });

  it('rejects a missing required field', () => {
    const { questionBinding: _drop, ...rest } = fullBundle();
    expect(() => explainBackJudgeLearningTarget.parse(rest)).toThrow();
  });

  it('rejects an adequacy criterion missing its text', () => {
    expect(() =>
      explainBackJudgeLearningTarget.parse(fullBundle({ adequacyCriteria: [{ id: 'a1' }] })),
    ).toThrow();
  });

  it('rejects the whole bundle when passed as the field and malformed, rather than defaulting to absent', () => {
    expect(() => explainBackJudgeLearningTargetField.parse({ schemaVersion: 'wrong' })).toThrow();
  });
});

describe('explainBackJudgeAdequacyCriterion / explainBackJudgeDisqualifier — local ids, never global identity', () => {
  it('both require a non-empty id and text', () => {
    expect(() => explainBackJudgeAdequacyCriterion.parse({ id: '', text: 'x' })).toThrow();
    expect(() => explainBackJudgeDisqualifier.parse({ id: 'd1', text: '' })).toThrow();
  });
});

describe('explainBackJudgeDemand — the ruled vocabulary is exactly these five words', () => {
  it('is exactly this list, spelled exactly this way', () => {
    expect(explainBackJudgeDemand.options).toEqual([
      'recall-a-fact',
      'calculate',
      'compare-or-choose',
      'apply-to-unfamiliar-case',
      'interpret-printed-result',
    ]);
  });
});

describe('explainBackJudgeSpecificationAcknowledgement — deployment skew is detectable (D-277g)', () => {
  it('accepts applied: true with a digest', () => {
    expect(() =>
      explainBackJudgeSpecificationAcknowledgement.parse({
        specificationApplied: true,
        specificationDigest: 'sha256:abc123',
      }),
    ).not.toThrow();
  });

  it('accepts applied: false with no digest — no bundle was sent to apply', () => {
    expect(() =>
      explainBackJudgeSpecificationAcknowledgement.parse({ specificationApplied: false }),
    ).not.toThrow();
  });

  it('rejects applied: true with no digest', () => {
    expect(() =>
      explainBackJudgeSpecificationAcknowledgement.parse({ specificationApplied: true }),
    ).toThrow();
  });

  it('rejects applied: false carrying a digest anyway', () => {
    expect(() =>
      explainBackJudgeSpecificationAcknowledgement.parse({
        specificationApplied: false,
        specificationDigest: 'sha256:abc123',
      }),
    ).toThrow();
  });
});
