/** `[D-633]`: a retrieved chunk's grain becomes the citation formatter's location. Invented paths. */
import { describe, expect, it } from 'vitest';
import { chunkSourceLocation, formatSourceCitation } from './citation.js';

const label = (chunk: Parameters<typeof chunkSourceLocation>[0]): string =>
  formatSourceCitation(chunkSourceLocation(chunk));

describe('chunkSourceLocation', () => {
  it('labels a transcript by part, or by time when a time is supplied, and never by page', () => {
    expect(label({ path: 'Course/Lecture 2.txt', part: 2 })).toBe('Lecture 2 (part 2)');
    expect(
      label({
        path: 'Course/Lecture 2.txt',
        part: 2,
        location: { page: 2, transcriptPart: { startSeconds: 724 } },
      }),
    ).toBe('Lecture 2 (at 12:04)');
    expect(label({ path: 'Course/Lecture 2.txt', part: 3 })).not.toMatch(/p\. /);
  });

  it('labels a deck page as a slide, a document page as a page, and a section by its text', () => {
    expect(label({ path: 'Course/Deck.pptx', location: { page: 5 } })).toBe('Deck (slide 5)');
    expect(label({ path: 'Course/Paper.pdf', location: { page: 3 } })).toBe('Paper (p. 3)');
    expect(label({ path: 'Course/Notes.docx', location: { page: 1, section: 'Habits' } })).toBe(
      'Notes (Habits)',
    );
  });

  it('is the bare name when the chunk has no grain', () => {
    expect(label({ path: 'Course/Plain note.md' })).toBe('Plain note');
  });
});
