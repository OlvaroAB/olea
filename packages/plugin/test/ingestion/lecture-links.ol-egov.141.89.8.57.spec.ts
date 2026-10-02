import { describe, expect, it } from 'vitest';
import { readLectureBundles } from '../../src/ingestion/lecture-links.js';
import {
  createObsidianResolvedLinksPort,
  type MetadataCacheLike,
} from '../../src/ingestion/obsidian-resolved-links.js';

function fakeCache(
  links: Record<string, string[]>,
  frontmatter: Record<string, Record<string, unknown>> = {},
): MetadataCacheLike {
  return {
    get resolvedLinks() {
      return Object.fromEntries(
        Object.entries(links).map(([s, ts]) => [s, Object.fromEntries(ts.map((t) => [t, 1]))]),
      );
    },
    getCache: (path) => (frontmatter[path] ? { frontmatter: frontmatter[path] } : null),
  };
}

const fm = { 'Week 4/talk.md': { role: 'transcript' } };

describe('lecture bundles from explicit links (ol-egov.141.89.8.57)', () => {
  it('a note linking both the transcript and the deck forms a bundle', () => {
    const port = createObsidianResolvedLinksPort(
      fakeCache({ 'notes/week-4.md': ['Week 4/talk.md', 'Week 4/slides.pptx'] }, fm),
    );
    const b = readLectureBundles(port);
    expect(b).toHaveLength(1);
    expect(b[0]?.members).toEqual(['Week 4/slides.pptx', 'Week 4/talk.md']);
    expect(b[0]?.via).toEqual(['notes/week-4.md']);
  });

  it("a transcript's own link to the deck forms a bundle", () => {
    const port = createObsidianResolvedLinksPort(
      fakeCache({ 'Week 4/talk.md': ['Week 4/slides.pptx'] }, fm),
    );
    expect(readLectureBundles(port)[0]?.via).toEqual(['Week 4/talk.md']);
  });

  it('similar filenames in the same folder with no link form none', () => {
    const port = createObsidianResolvedLinksPort(fakeCache({ 'notes/unrelated.md': [] }, {}));
    // lecture-4.txt and lecture-4.pptx exist in the vault but nothing links them.
    expect(readLectureBundles(port)).toEqual([]);
  });

  it('a note that links a deck but no transcript forms none', () => {
    const port = createObsidianResolvedLinksPort(
      fakeCache({ 'notes/a.md': ['Week 4/slides.pptx', 'Week 4/other.pdf'] }),
    );
    expect(readLectureBundles(port)).toEqual([]);
  });

  it('a removed link dissolves the bundle on the next read', () => {
    const links: Record<string, string[]> = {
      'notes/week-4.md': ['Week 4/lecture-4.txt', 'Week 4/lecture-4.pdf'],
    };
    const port = createObsidianResolvedLinksPort(fakeCache(links));
    expect(readLectureBundles(port)).toHaveLength(1);
    // Her edit: the note no longer links the deck. Same port object, nothing stored.
    links['notes/week-4.md'] = ['Week 4/lecture-4.txt'];
    expect(readLectureBundles(port)).toEqual([]);
  });

  it('an undeclared markdown note is never a transcript', () => {
    const port = createObsidianResolvedLinksPort(
      fakeCache({ 'notes/a.md': ['Week 4/talk.md', 'Week 4/slides.pptx'] }),
    );
    expect(readLectureBundles(port)).toEqual([]);
  });
});
