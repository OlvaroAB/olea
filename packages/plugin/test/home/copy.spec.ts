/**
 * `home/copy.ts` honesty tests (F8.3, F8.8, `ol-0r92.17`) — same pattern
 * `today/copy.spec.ts`/`gap/copy.spec.ts` already run over their own
 * `allXStrings()` sweep.
 */
import { describe, expect, it } from 'vitest';
import {
  allHomeStrings,
  emptyRankingQuietLine,
  HOME_EVERY_ASSESSMENT_PASSED_LINE,
  HOME_NEXT_SESSION_EYEBROW,
  HOME_NOTHING_TO_PRACTISE_LINE,
  HOME_OFFER_EYEBROW,
  HOME_VIEW_TITLE,
  sessionCompositionSentence,
} from '../../src/home/copy.js';

describe('home copy — F8.3 no scalar', () => {
  it('never contains a percentage, ratio or fraction', () => {
    for (const text of allHomeStrings()) {
      expect(text).not.toMatch(/%/);
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });

  it('exposes a real, non-empty title', () => {
    expect(HOME_VIEW_TITLE.length).toBeGreaterThan(0);
  });

  it('every string is non-empty', () => {
    for (const text of allHomeStrings()) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

/**
 * F2.22 / F6.4 (`ol-egov.141.89.10.19`) — `sessionCompositionSentence` is
 * the ONE function Home (`../src/home/view.ts`) and the review session
 * (`../src/review/view.ts`) both call to render this sentence, so "the same
 * sentence in both places" is a property of both call sites sharing this
 * one function, never something either surface re-derives. These tests pin
 * this function's own contract; `../review/composition-sentence.spec.ts`
 * pins that the review session calls this exact function, unchanged, on
 * whatever `home/view.ts`'s `renderOffer` also calls it with.
 */
describe('home copy — sessionCompositionSentence (F2.22, F6.4)', () => {
  it('renders the filter branch verbatim, capitalised, never re-adding "this course"', () => {
    expect(sessionCompositionSentence('this course because you asked for it')).toBe(
      'This course because you asked for it.',
    );
  });

  it('renders the urgency branch with the "this course" lead-in, matching the functional scope\'s own quoted example', () => {
    expect(
      sessionCompositionSentence(
        'because its assessment is close and the assessed material still needs work',
      ),
    ).toBe(
      'This course because its assessment is close and the assessed material still needs work.',
    );
  });

  it('renders the deficit branch with the same lead-in', () => {
    expect(
      sessionCompositionSentence('because it is behind its share from your recent sessions'),
    ).toBe('This course because it is behind its share from your recent sessions.');
  });

  it('F8.3: never a percentage, ratio or fraction', () => {
    for (const reason of [
      'this course because you asked for it',
      'because its assessment is close and the assessed material still needs work',
      'because it is behind its share from your recent sessions',
    ]) {
      const sentence = sessionCompositionSentence(reason);
      expect(sentence).not.toMatch(/%/);
      expect(sentence).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });
});

/**
 * `[D-382]`/`[D-331]` (`ol-egov.141.89.10.64`, F2.22) — the label that distinguishes the active
 * session's own frozen explanation (`HOME_OFFER_EYEBROW`, unchanged) from a live preview Home
 * still shows beside it (`HOME_NEXT_SESSION_EYEBROW`, new). Both are rendered through the same
 * `sessionCompositionSentence` pinned above; this module adds no second wording rule.
 */
describe('home copy — HOME_NEXT_SESSION_EYEBROW (D-382, D-331)', () => {
  it('is a distinct, non-empty label from the active-session eyebrow', () => {
    expect(HOME_NEXT_SESSION_EYEBROW.length).toBeGreaterThan(0);
    expect(HOME_NEXT_SESSION_EYEBROW).not.toBe(HOME_OFFER_EYEBROW);
  });

  it('names the session plainly — no percentage, ratio or fraction (F8.3)', () => {
    expect(HOME_NEXT_SESSION_EYEBROW).not.toMatch(/%/);
    expect(HOME_NEXT_SESSION_EYEBROW).not.toMatch(/\d+\s*\/\s*\d+/);
  });
});

/**
 * `[D-408]` (`ol-egov.141.89.10.85`, F6.10 §26 — David's 2026-09-27 sign-off): the two registered
 * lines for a `'ranked'` course with an empty concept list, and the one function
 * (`emptyRankingQuietLine`) that maps the contract's `EmptyRankingReason` enum onto them. Pinned
 * here as the exact ratified strings so a later edit has to argue with the sign-off.
 */
describe('home copy — emptyRankingQuietLine (D-408)', () => {
  it('every-assessment-passed reads the exact ratified line', () => {
    expect(emptyRankingQuietLine('every-assessment-passed')).toBe(
      HOME_EVERY_ASSESSMENT_PASSED_LINE,
    );
    expect(HOME_EVERY_ASSESSMENT_PASSED_LINE).toBe(
      "Every assessment for this course has passed — there's nothing to practise here right now.",
    );
  });

  it('nothing-to-practise reads the exact ratified line, and points at the registry rather than re-deriving the per-instrument cause', () => {
    expect(emptyRankingQuietLine('nothing-to-practise')).toBe(HOME_NOTHING_TO_PRACTISE_LINE);
    expect(HOME_NOTHING_TO_PRACTISE_LINE).toBe(
      'Nothing in this course is eligible to practise right now — check the registry to see why.',
    );
  });

  it('the two reasons never share a line — Home renders each honestly, not a single interchangeable sentence', () => {
    expect(emptyRankingQuietLine('every-assessment-passed')).not.toBe(
      emptyRankingQuietLine('nothing-to-practise'),
    );
  });
});
