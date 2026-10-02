// Scenario: features/F1-sources.md "slides never automatically override speech"
// (ol-egov.141.89.1.64; D-465). Test id: @auto:core/transcript/slide-speech-precedence.ol-egov.141.89.1.64.spec

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reconcileSlideAndSpeech, slideCorrectionCues } from './transcript-flags.js';

const text = readFileSync(
  new URL('../../fixtures/transcripts/slide-correction.txt', import.meta.url),
  'utf8',
);

describe('a lecturer correcting a slide', () => {
  it('surfaces the correcting claim as a cue, not a verdict', () => {
    const cues = slideCorrectionCues(text);
    expect(cues.some((c) => c.text.includes('six neighbours'))).toBe(true);
    for (const c of cues) expect(text.slice(c.start, c.end)).toBe(c.text);
  });

  it('stays unresolved unless the correction is attributable and clear', () => {
    expect(reconcileSlideAndSpeech({ attributableToLecturer: false, clear: true })).toBe(
      'unresolved',
    );
    expect(reconcileSlideAndSpeech({ attributableToLecturer: true, clear: false })).toBe(
      'unresolved',
    );
    expect(reconcileSlideAndSpeech({ attributableToLecturer: true, clear: true })).toBe(
      'correction-may-support-grounding',
    );
  });
});
