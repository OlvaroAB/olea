// Scenario: features/F1-sources.md "the slide-correction cue passes the phrasings a lecturer uses"
// (ol-zjke.1; D-625). Test id: @auto:core/transcript/slide-correction-cue-gate.ol-zjke.1.spec
// Every example is invented.

import { describe, expect, it } from 'vitest';
import { slideCorrectionCues } from './transcript-flags.js';

const passed = (text: string) => slideCorrectionCues(text).map((c) => c.text);

describe('the slide-correction cue gate', () => {
  it('passes a correction idiom with no medium named', () => {
    expect(passed('Ignore that last number. We carry on.')).toEqual(['Ignore that last number.']);
    expect(passed('That should be thirty, not twenty.')).toHaveLength(1);
  });

  it('passes a named medium with a mistake word, in either order', () => {
    expect(passed('There is a typo on the slide.')).toHaveLength(1);
    expect(passed('The handout has an error in the second table.')).toHaveLength(1);
  });

  it('passes the fix sentence of a two-sentence correction, in either order', () => {
    expect(passed('The slide says 24. Actually it is 27.')).toEqual(['Actually it is 27.']);
    expect(passed('It should be 27. The slide says 24.')).toHaveLength(2);
  });

  it('passes an unpunctuated caption as one whole sentence', () => {
    const text = 'so the slide says 24 but it is actually 27 and we move on';
    expect(slideCorrectionCues(text)).toEqual([{ start: 0, end: text.length, text }]);
  });

  it('passes Swedish phrasings', () => {
    expect(passed('Det ska vara tjugosju.')).toHaveLength(1);
    expect(passed('Jag skrev fel på bilden.')).toHaveLength(1);
  });

  it('skips ordinary teaching sentences and returns exact spans', () => {
    const text = 'Today we meet diffusion. Heat flows from warm to cold. Questions so far?';
    expect(slideCorrectionCues(text)).toEqual([]);
    const mixed = `${text} My mistake, ignore the previous example.`;
    for (const c of slideCorrectionCues(mixed)) expect(mixed.slice(c.start, c.end)).toBe(c.text);
    expect(slideCorrectionCues(mixed)).toHaveLength(1);
  });

  it('returns nothing for empty text', () => {
    expect(slideCorrectionCues('')).toEqual([]);
  });
});
