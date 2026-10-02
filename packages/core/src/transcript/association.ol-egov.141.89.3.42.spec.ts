import { describe, expect, it } from 'vitest';
import { associateLectures, type LinkedFile } from '../source/transcript-association.js';
import type { VaultPath } from '../vault/types.js';

const p = (s: string): VaultPath => s as VaultPath;

describe('lecture association (ol-egov.141.89.3.42)', () => {
  it('a note linking the transcript and the deck associates them', () => {
    const files: LinkedFile[] = [
      { path: p('T/lecture-4-transcript.md'), kind: 'transcript', links: [] },
      { path: p('S/lecture-4-deck.pdf'), kind: 'deck', links: [] },
      {
        path: p('notes/week-4.md'),
        kind: 'other',
        links: [p('T/lecture-4-transcript.md'), p('S/lecture-4-deck.pdf')],
      },
    ];
    const b = associateLectures(files);
    expect(b).toHaveLength(1);
    expect(b[0]?.members).toEqual([p('S/lecture-4-deck.pdf'), p('T/lecture-4-transcript.md')]);
    // Rebuilt, never stored: same input, same output, and the result is plain data.
    expect(associateLectures(files)).toEqual(b);
  });

  it("the transcript's own link to the deck associates them", () => {
    const b = associateLectures([
      { path: p('T/a.md'), kind: 'transcript', links: [p('S/a.pdf')] },
      { path: p('S/a.pdf'), kind: 'deck', links: [] },
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]?.via).toEqual([p('T/a.md')]);
  });

  it('similar names or folders establish nothing', () => {
    expect(
      associateLectures([
        { path: p('Week 4/lecture-4.txt'), kind: 'transcript', links: [] },
        { path: p('Week 4/lecture-4.pdf'), kind: 'deck', links: [] },
      ]),
    ).toEqual([]);
  });

  it('association is never replacement', () => {
    const b = associateLectures([
      { path: p('T/a.md'), kind: 'transcript', links: [] },
      { path: p('T/a-v2.md'), kind: 'transcript', links: [] },
      { path: p('n.md'), kind: 'other', links: [p('T/a.md'), p('T/a-v2.md')] },
    ]);
    expect(b[0]?.members).toHaveLength(2);
    expect(Object.keys(b[0] ?? {}).sort()).toEqual(['members', 'via']);
  });
});
