import { describe, expect, it } from 'vitest';
import { formatSourceCitation } from './citation.js';
import type { RegistrySourceLocation } from './types.js';

function loc(overrides: Partial<RegistrySourceLocation>): RegistrySourceLocation {
  return { sourcePath: 'Courses/BIO101/Notes/Cell membranes.md', ...overrides };
}

describe('formatSourceCitation', () => {
  it('renders the bare note name when nothing is known', () => {
    expect(formatSourceCitation(loc({}))).toBe('Cell membranes');
  });

  it('prefers section over page when both are present', () => {
    expect(
      formatSourceCitation(loc({ section: 'Membrane transport', page: 4, heading: 'Intro' })),
    ).toBe('Cell membranes (Membrane transport)');
  });

  it('renders "p. N" for a page-bearing PDF-like source with no section', () => {
    expect(
      formatSourceCitation(loc({ sourcePath: 'Courses/BIO101/Readings/textbook.pdf', page: 42 })),
    ).toBe('textbook (p. 42)');
  });

  it('renders "slide N" for a .pptx source path, case-insensitively', () => {
    expect(
      formatSourceCitation(loc({ sourcePath: 'Courses/BIO101/Slides/Lecture3.PPTX', page: 7 })),
    ).toBe('Lecture3 (slide 7)');
  });

  it('falls back to heading when neither section nor page is known', () => {
    expect(formatSourceCitation(loc({ heading: 'Cell walls' }))).toBe(
      'Cell membranes (Cell walls)',
    );
  });

  it('never fabricates a page/slide/section it does not have', () => {
    const result = formatSourceCitation(loc({ sourcePath: 'Notes/Loose thoughts.md' }));
    expect(result).toBe('Loose thoughts');
    expect(result).not.toMatch(/p\.|slide/);
  });

  it('treats a .pptx source with no page as having no passage grain, not slide-less zero', () => {
    expect(formatSourceCitation(loc({ sourcePath: 'Slides/Overview.pptx' }))).toBe('Overview');
  });

  it('grainOnly returns just the fragment, empty string when none is known', () => {
    expect(
      formatSourceCitation(loc({ page: 3, sourcePath: 'Readings/x.pdf' }), { grainOnly: true }),
    ).toBe('p. 3');
    expect(formatSourceCitation(loc({}), { grainOnly: true })).toBe('');
  });
});
