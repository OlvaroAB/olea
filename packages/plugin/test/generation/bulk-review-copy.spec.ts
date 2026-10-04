/**
 * `sourceMarkerText`/`sourceMarkerOrigin` tests (`[D-216]` / `ol-egov.105`;
 * authored-note branch `[D-214]` / `ol-egov.101` / `ol-ymew`). The ruling's
 * own wording constraints, made mechanical: a plain pointer, never citation
 * punctuation, and the origin is named — never claimed as support for the
 * draft — in whichever of the two registers actually applies.
 */
import { parseMadeBy } from 'olea-core';
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

  it('says "From your notes" for a kept note, never that she wrote it ([D-489])', () => {
    expect(sourceMarkerText('My Own Thoughts', 'kept-note')).toBe(
      'From your notes, My Own Thoughts.',
    );
    expect(sourceMarkerText('X', 'kept-note').toLowerCase()).not.toContain('wrote');
    expect(sourceMarkerText('X', 'kept-note').toLowerCase()).not.toContain('reading');
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

describe('sourceMarkerOrigin ([D-489])', () => {
  const md = '01 Courses/X/Note.md';
  it('declared me reads as authored-note', () => {
    expect(sourceMarkerOrigin(md, parseMadeBy('me'))).toBe('authored-note');
    expect(sourceMarkerOrigin('a/Note.MD', 'me')).toBe('authored-note');
  });
  it('declared assistant, declared mixed, an invalid value and no declaration read as kept-note', () => {
    expect(sourceMarkerOrigin(md, parseMadeBy('assistant'))).toBe('kept-note');
    expect(sourceMarkerOrigin(md, parseMadeBy('mixed'))).toBe('kept-note');
    expect(sourceMarkerOrigin(md, parseMadeBy('robot'))).toBe('kept-note');
    expect(sourceMarkerOrigin(md, parseMadeBy(42))).toBe('kept-note');
    expect(sourceMarkerOrigin(md)).toBe('kept-note');
  });
  it('a non-Markdown or absent citation reads as a reading whatever the declaration', () => {
    expect(sourceMarkerOrigin('a/Lecture.pdf', 'me')).toBe('reading');
    expect(sourceMarkerOrigin('a/Slides.pptx')).toBe('reading');
    expect(sourceMarkerOrigin(undefined, 'me')).toBe('reading');
    expect(sourceMarkerText('Lecture', sourceMarkerOrigin('a/Lecture.pdf', 'me'))).toBe(
      'From your reading on Lecture.',
    );
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
  it('reads a declared-me markdown citation path as an authored-note origin', () => {
    expect(sourceMarkerOrigin('01 Courses/COGS214/My Own Thoughts.md', 'me')).toBe('authored-note');
  });

  it('is case-insensitive on the extension', () => {
    expect(sourceMarkerOrigin('01 Courses/COGS214/My Own Thoughts.MD', 'me')).toBe('authored-note');
  });

  it('reads a non-markdown citation path (a PDF/PPTX/DOCX/image reading) as "reading"', () => {
    expect(sourceMarkerOrigin('01 Courses/COGS214/Lecture 4.pdf')).toBe('reading');
  });

  it('reads an absent citation as "reading" — absence is not evidence of authorship', () => {
    expect(sourceMarkerOrigin(undefined)).toBe('reading');
  });
});
