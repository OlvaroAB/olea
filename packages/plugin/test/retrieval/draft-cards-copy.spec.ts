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
} from '../../src/retrieval/draft-cards-copy.js';

describe('describeRefusal — ol-riwn / [D-089]: a transient "could not check" is never the same fact as "not enough material"', () => {
  it('the three checked-and-found-nothing reasons all read as "not enough grounding" and are not marked transient', () => {
    const reasons = ['no-hits', 'below-relevance-threshold', 'below-composite-threshold'] as const;
    for (const reason of reasons) {
      const copy = describeRefusal(reason);
      expect(copy.transient).toBe(false);
      expect(copy.headline.toLowerCase()).toContain('grounding');
    }
  });

  it('composite-check-unavailable is marked transient and its headline is textually distinct from the other three', () => {
    const transientCopy = describeRefusal('composite-check-unavailable');
    expect(transientCopy.transient).toBe(true);

    const groundingCopy = describeRefusal('no-hits');
    expect(transientCopy.headline).not.toBe(groundingCopy.headline);
    // The specific failure ol-riwn diagnosed: a could-not-check reason must
    // never be told to her as a fact about her material.
    expect(transientCopy.headline.toLowerCase()).not.toContain('enough');
    expect(transientCopy.headline.toLowerCase()).not.toContain('grounding in your notes');
  });

  it('every refusal headline names Olea as the actor, never "the system" ([D-096] V1)', () => {
    const reasons = [
      'no-hits',
      'below-relevance-threshold',
      'below-composite-threshold',
      'composite-check-unavailable',
    ] as const;
    for (const reason of reasons) {
      const headline = describeRefusal(reason).headline;
      expect(headline).toContain('Olea');
      expect(headline.toLowerCase()).not.toContain('the system');
      expect(headline.toLowerCase()).not.toContain('sorry');
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
