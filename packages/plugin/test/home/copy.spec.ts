/**
 * `home/copy.ts` honesty tests (F8.3, F8.8, `ol-0r92.17`) — same pattern
 * `today/copy.spec.ts`/`gap/copy.spec.ts` already run over their own
 * `allXStrings()` sweep.
 */
import { describe, expect, it } from 'vitest';
import {
  allHomeStrings,
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
