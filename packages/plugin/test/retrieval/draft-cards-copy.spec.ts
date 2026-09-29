/**
 * `draft-cards-copy.ts` tests. Obsidian-free, plain Vitest — no `Modal`,
 * no DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCEPT_NOT_WIRED_NOTICE,
  AI_NOT_CONFIGURED_NOTICE,
  describeRefusal,
  parseDraftedResponse,
  refusalStateModifier,
} from '../../src/retrieval/draft-cards-copy.js';

describe('describeRefusal — the four outcomes stay distinct (D-289, ol-riwn)', () => {
  it('judge-rejected is the only source-insufficient refusal: "not enough grounding", not transient', () => {
    const copy = describeRefusal('judge-rejected');
    expect(copy.outcome).toBe('source-insufficient');
    expect(copy.transient).toBe(false);
    expect(copy.headline.toLowerCase()).toContain('grounding');
  });

  it('no-hits and below-relevance-threshold are retrieval-failure: operational, never a verdict about her notes (D-289, D-441)', () => {
    for (const reason of ['no-hits', 'below-relevance-threshold']) {
      const copy = describeRefusal(reason);
      expect(copy.outcome).toBe('retrieval-failure');
      expect(copy.transient).toBe(true);
      expect(copy.headline.toLowerCase()).not.toContain('enough');
      expect(copy.headline.toLowerCase()).not.toContain('grounding in your notes');
    }
  });

  it('below-composite-threshold and below-band are threshold-blocked: not assessed, never a claim that her notes lack the material (D-441)', () => {
    for (const reason of ['below-composite-threshold', 'below-band']) {
      const copy = describeRefusal(reason);
      expect(copy.outcome).toBe('threshold-blocked');
      expect(copy.transient).toBe(true);
      expect(copy.headline).toBe(describeRefusal('no-hits').headline);
      expect(copy.headline.toLowerCase()).not.toContain('enough');
      expect(copy.headline.toLowerCase()).not.toContain('grounding');
      expect(copy.headline).not.toBe(describeRefusal('judge-rejected').headline);
    }
  });

  it('only the judge rejecting the sources makes an insufficiency claim: every other reason in the union avoids it', () => {
    const reasons = [
      'no-hits',
      'below-relevance-threshold',
      'below-composite-threshold',
      'composite-check-unavailable',
      'below-band',
      'judge-rejected',
      'judge-unavailable',
      'could-not-decide',
    ];
    const insufficient = reasons.filter(
      (reason) => describeRefusal(reason).outcome === 'source-insufficient',
    );
    expect(insufficient).toEqual(['judge-rejected']);
    for (const reason of reasons.filter((r) => r !== 'judge-rejected')) {
      const headline = describeRefusal(reason).headline.toLowerCase();
      expect(headline).not.toContain('enough');
      expect(headline).not.toContain('grounding');
      expect(describeRefusal(reason).transient).toBe(true);
    }
  });

  it('could-not-decide is judgment-uncertain, operational', () => {
    const copy = describeRefusal('could-not-decide');
    expect(copy.outcome).toBe('judgment-uncertain');
    expect(copy.transient).toBe(true);
  });

  it('composite-check-unavailable and judge-unavailable are service-failure, operational', () => {
    for (const reason of ['composite-check-unavailable', 'judge-unavailable']) {
      const copy = describeRefusal(reason);
      expect(copy.outcome).toBe('service-failure');
      expect(copy.transient).toBe(true);
    }
  });

  it('the outcome values are pairwise distinct even where the words are shared', () => {
    const outcomes = [
      'judge-rejected',
      'no-hits',
      'could-not-decide',
      'judge-unavailable',
      'below-band',
    ].map((r) => describeRefusal(r).outcome);
    expect(new Set(outcomes).size).toBe(5);
    // the operational three deliberately share one approved sentence
    expect(describeRefusal('no-hits').headline).toBe(describeRefusal('judge-unavailable').headline);
    expect(describeRefusal('judge-rejected').headline).not.toBe(
      describeRefusal('judge-unavailable').headline,
    );
  });

  it('an unrecognised reason defaults to source-insufficient, never claiming a named failure', () => {
    expect(describeRefusal('some-future-reason').outcome).toBe('source-insufficient');
  });

  it('every refusal headline names Olea as the actor, never "the system" ([D-096] V1)', () => {
    for (const reason of [
      'no-hits',
      'below-relevance-threshold',
      'below-composite-threshold',
      'below-band',
      'judge-rejected',
      'could-not-decide',
      'judge-unavailable',
    ]) {
      const headline = describeRefusal(reason).headline;
      expect(headline).toContain('Olea');
      expect(headline.toLowerCase()).not.toContain('the system');
      expect(headline.toLowerCase()).not.toContain('sorry');
    }
  });
});

describe('refusalStateModifier — which row state a classified refusal renders as (D-441)', () => {
  it('only the judge rejecting the sources renders as insufficient', () => {
    expect(refusalStateModifier(describeRefusal('judge-rejected'))).toBe('insufficient');
  });

  it('a threshold-blocked refusal renders as not-assessed, never as insufficient', () => {
    for (const reason of ['below-composite-threshold', 'below-band']) {
      expect(refusalStateModifier(describeRefusal(reason))).toBe('not-assessed');
    }
  });

  it('retrieval, judgment and service failures render as transient', () => {
    for (const reason of [
      'no-hits',
      'below-relevance-threshold',
      'could-not-decide',
      'judge-unavailable',
      'composite-check-unavailable',
    ]) {
      expect(refusalStateModifier(describeRefusal(reason))).toBe('transient');
    }
  });
});

describe('static notice copy ([D-096]: names Olea or no actor, states the fact, no apology)', () => {
  it('AI_NOT_CONFIGURED_NOTICE and ACCEPT_NOT_WIRED_NOTICE do not apologise or blame her', () => {
    for (const notice of [AI_NOT_CONFIGURED_NOTICE, ACCEPT_NOT_WIRED_NOTICE]) {
      expect(notice.toLowerCase()).not.toContain('sorry');
      expect(notice.toLowerCase()).not.toContain('unfortunately');
      expect(notice.toLowerCase()).not.toContain('the system');
    }
  });
});

describe('parseDraftedResponse', () => {
  function successEnvelope(questions: unknown): unknown {
    return {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
      result: { questions },
    };
  }

  it('parses a well-formed success envelope into drafted questions', () => {
    const response = successEnvelope([
      { stem: 'stem', correctAnswer: 'a', distractors: ['b', 'c', 'd'], feedback: 'why' },
    ]);
    const parsed = parseDraftedResponse(response);
    expect(parsed).toEqual({
      kind: 'drafted',
      questions: [
        { stem: 'stem', correctAnswer: 'a', distractors: ['b', 'c', 'd'], feedback: 'why' },
      ],
    });
  });

  it('parses a legitimately-zero-questions success envelope as drafted with an empty list, not as unparseable', () => {
    const parsed = parseDraftedResponse(successEnvelope([]));
    expect(parsed).toEqual({ kind: 'drafted', questions: [] });
  });

  it("a well-formed error envelope becomes a worker-error carrying the Worker's own message", () => {
    const response = { ok: false, code: 'upstream-error', message: 'The model did not answer.' };
    expect(parseDraftedResponse(response)).toEqual({
      kind: 'worker-error',
      message: 'The model did not answer.',
    });
  });

  it('an error envelope with a blank message falls back to a generic one rather than showing nothing', () => {
    const response = { ok: false, code: 'internal-error', message: '' };
    const parsed = parseDraftedResponse(response);
    expect(parsed.kind).toBe('worker-error');
    if (parsed.kind === 'worker-error') expect(parsed.message.length).toBeGreaterThan(0);
  });

  it('a question missing a required field makes the whole response unparseable, never a partial list', () => {
    const response = successEnvelope([{ stem: 'stem', correctAnswer: 'a', distractors: ['b'] }]);
    expect(parseDraftedResponse(response)).toEqual({ kind: 'unparseable' });
  });

  it('a completely unrelated shape is unparseable', () => {
    expect(parseDraftedResponse('not an object')).toEqual({ kind: 'unparseable' });
    expect(parseDraftedResponse(null)).toEqual({ kind: 'unparseable' });
    expect(parseDraftedResponse({ surprising: true })).toEqual({ kind: 'unparseable' });
  });
});
