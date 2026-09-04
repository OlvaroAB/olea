/**
 * `sourceMarkerText`/`sourceMarkerOrigin` tests (`[D-216]` / `ol-egov.105`;
 * authored-note branch `[D-214]` / `ol-egov.101` / `ol-ymew`). The ruling's
 * own wording constraints, made mechanical: a plain pointer, never citation
 * punctuation, and the origin is named — never claimed as support for the
 * draft — in whichever of the two registers actually applies.
 */
import { describe, expect, it } from 'vitest';
import {
  bulkReviewCompletionTally,
  sourceMarkerOrigin,
  sourceMarkerText,
} from '../../src/generation/bulk-review-copy.js';

describe('sourceMarkerText', () => {
  it('names the note title as a plain "from your reading on X" pointer by default', () => {
    expect(sourceMarkerText('Week 2')).toBe('From your reading on Week 2.');
  });

  it('renders the same reading register when origin is explicitly "reading"', () => {
    expect(sourceMarkerText('Week 2', 'reading')).toBe('From your reading on Week 2.');
  });

  it('states authorship, not a reading, when origin is "authored-note" ([D-214] clause 3)', () => {
    expect(sourceMarkerText('My Own Thoughts', 'authored-note')).toBe(
      'From a note you wrote, My Own Thoughts.',
    );
  });

  it('never says "reading" for an authored-note origin', () => {
    expect(sourceMarkerText('My Own Thoughts', 'authored-note').toLowerCase()).not.toContain(
      'reading',
    );
  });

  it('carries no citation punctuation — no brackets, no footnote marks — in either register', () => {
    expect(sourceMarkerText('Week 2')).not.toMatch(/[[\]^*]/);
    expect(sourceMarkerText('My Own Thoughts', 'authored-note')).not.toMatch(/[[\]^*]/);
  });

  it('never claims the draft is supported by the source in either register — names it, does not vouch', () => {
    for (const text of [
      sourceMarkerText('Week 2').toLowerCase(),
      sourceMarkerText('My Own Thoughts', 'authored-note').toLowerCase(),
    ]) {
      for (const vouchingWord of ['support', 'accurate', 'verified', 'confirmed']) {
        expect(text).not.toContain(vouchingWord);
      }
    }
  });
});

describe('bulkReviewCompletionTally ([STY-0e], ol-l5og.18.5; ol-2x4)', () => {
  it('names only the outcomes that happened, in accepted/edited/rejected order', () => {
    expect(bulkReviewCompletionTally({ accepted: 12, edited: 3, rejected: 5 })).toBe(
      '12 accepted · 3 edited · 5 rejected.',
    );
  });

  it('omits a zero-count outcome rather than reporting "0 edited"', () => {
    expect(bulkReviewCompletionTally({ accepted: 4, edited: 0, rejected: 0 })).toBe('4 accepted.');
  });

  it("never mentions what remains, a due date, or a link to what she rejected (ol-2x4's rejections)", () => {
    const text = bulkReviewCompletionTally({ accepted: 1, edited: 1, rejected: 1 }).toLowerCase();
    for (const forbidden of ['remain', 'waiting', 'tomorrow', 'due', 'review the']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('sourceMarkerOrigin', () => {
  it('reads a markdown citation path as an authored-note origin', () => {
    expect(sourceMarkerOrigin('01 Courses/COGS214/My Own Thoughts.md')).toBe('authored-note');
  });

  it('is case-insensitive on the extension', () => {
    expect(sourceMarkerOrigin('01 Courses/COGS214/My Own Thoughts.MD')).toBe('authored-note');
  });

  it('reads a non-markdown citation path (a PDF/PPTX/DOCX/image reading) as "reading"', () => {
    expect(sourceMarkerOrigin('01 Courses/COGS214/Lecture 4.pdf')).toBe('reading');
  });

  it('reads an absent citation as "reading" — absence is not evidence of authorship', () => {
    expect(sourceMarkerOrigin(undefined)).toBe('reading');
  });
});
