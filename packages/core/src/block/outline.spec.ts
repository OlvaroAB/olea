import { describe, expect, it } from 'vitest';
import { buildOutline } from './outline.js';
import { parseDocument } from './parse.js';

describe('buildOutline', () => {
  it('groups content under its nearest heading, excluding sub-headings', () => {
    const doc = parseDocument(
      [
        '# Title',
        '',
        'Intro paragraph.',
        '',
        '## First question',
        'Answer one.',
        '',
        '## Second question',
        'Answer two.',
        '',
      ].join('\n'),
    );
    const outline = buildOutline(doc);

    expect(outline).toHaveLength(1);
    const root = outline[0];
    expect(root?.heading.text).toBe('Title');
    // The root's own content is only the intro paragraph (and its
    // surrounding blank lines) — not the H2 children's content.
    const rootContentKinds = root?.contentIndices.map((i) => doc.blocks[i]?.kind);
    expect(rootContentKinds).toEqual(['blank', 'paragraph', 'blank']);

    expect(root?.children).toHaveLength(2);
    expect(root?.children[0]?.heading.text).toBe('First question');
    expect(root?.children[1]?.heading.text).toBe('Second question');

    const firstChildContent = root?.children[0]?.contentIndices.map((i) => doc.blocks[i]?.kind);
    expect(firstChildContent).toEqual(['paragraph', 'blank']);
  });

  it('nests three levels deep and closes children when a same-level heading appears', () => {
    const doc = parseDocument(
      ['# H1', '## H2a', '### H3', 'deep content', '## H2b', 'shallow content'].join('\n'),
    );
    const outline = buildOutline(doc);
    const h1 = outline[0];
    expect(h1?.children.map((c) => c.heading.text)).toEqual(['H2a', 'H2b']);
    const h2a = h1?.children[0];
    expect(h2a?.children).toHaveLength(1);
    expect(h2a?.children[0]?.heading.text).toBe('H3');
    // H2a itself owns no direct content — H3 owns "deep content".
    expect(h2a?.contentIndices).toEqual([]);
    const h3 = h2a?.children[0];
    const h3Content = h3?.contentIndices.map((i) => doc.blocks[i]?.kind);
    expect(h3Content).toEqual(['paragraph']);
  });

  it('drops content that appears before the first heading (not part of any node)', () => {
    const doc = parseDocument('---\nkey: value\n---\n\nOrphan paragraph.\n\n# Title\nBody.\n');
    const outline = buildOutline(doc);
    expect(outline).toHaveLength(1);
    const totalIndexed = outline[0]?.contentIndices.length;
    // Only "Body." belongs to the one heading; frontmatter/blank/orphan
    // paragraph before it are not referenced by any outline node.
    expect(totalIndexed).toBe(1);
    expect(doc.blocks[outline[0]?.contentIndices[0] ?? -1]?.kind).toBe('paragraph');
  });

  it('returns an empty outline for a document with no headings', () => {
    const doc = parseDocument('Just a paragraph, no headings at all.\n');
    expect(buildOutline(doc)).toEqual([]);
  });
});
