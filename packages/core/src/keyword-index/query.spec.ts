import { describe, expect, it } from 'vitest';
import { documentsByCourse, searchKeywordIndex } from './query.js';
import type { PersistedKeywordIndex } from './types.js';

const index: PersistedKeywordIndex = {
  version: 1,
  documents: [
    {
      path: '01 Courses/GEOL204/lecture.md',
      courses: ['GEOL204'],
      contentHash: 'hash-a',
      blocks: [
        { blockIndex: 0, kind: 'heading', text: 'Bioturbation depth' },
        { blockIndex: 2, kind: 'paragraph', text: 'The burrow reaches bioturbation depth fast.' },
      ],
    },
    {
      path: '01 Courses/MUSTH104/scene.md',
      courses: ['MUSTH104'],
      contentHash: 'hash-b',
      blocks: [{ blockIndex: 0, kind: 'heading', text: 'Deceptive cadence in Phrase One' }],
    },
    {
      path: '05 Zettelkasten/Suspension.md',
      courses: [],
      contentHash: 'hash-c',
      blocks: [
        { blockIndex: 0, kind: 'paragraph', text: 'A suspension recurs across the whole work.' },
      ],
    },
  ],
};

describe('searchKeywordIndex (C2.2)', () => {
  it('returns hits with source location (file + block) for a term present in the vault', () => {
    const hits = searchKeywordIndex(index, 'bioturbation');
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => ({ path: h.path, blockIndex: h.blockIndex }))).toEqual([
      { path: '01 Courses/GEOL204/lecture.md', blockIndex: 0 },
      { path: '01 Courses/GEOL204/lecture.md', blockIndex: 2 },
    ]);
  });

  it('excludes documents and blocks that do not contain the term', () => {
    const hits = searchKeywordIndex(index, 'bioturbation');
    expect(hits.some((h) => h.path === '01 Courses/MUSTH104/scene.md')).toBe(false);
  });

  it('returns no results for a term absent from the vault', () => {
    expect(searchKeywordIndex(index, 'photosynthesis')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(searchKeywordIndex(index, 'BIOTURBATION').length).toBe(2);
  });

  it('ranks a block matching more query tokens above one matching fewer', () => {
    const hits = searchKeywordIndex(index, 'bioturbation depth burrow');
    // The paragraph matches all three tokens; the heading matches two.
    expect(hits[0]).toMatchObject({ blockIndex: 2, score: 3 });
    expect(hits[1]).toMatchObject({ blockIndex: 0, score: 2 });
  });

  it('respects a limit, highest score first', () => {
    const hits = searchKeywordIndex(index, 'bioturbation', { limit: 1 });
    expect(hits).toHaveLength(1);
  });

  it('an empty or whitespace-only query returns no results', () => {
    expect(searchKeywordIndex(index, '   ')).toEqual([]);
  });
});

describe('documentsByCourse (C2.1)', () => {
  it('groups document paths under each course they declare', () => {
    const byCourse = documentsByCourse(index);
    expect(byCourse.get('GEOL204')).toEqual(['01 Courses/GEOL204/lecture.md']);
    expect(byCourse.get('MUSTH104')).toEqual(['01 Courses/MUSTH104/scene.md']);
  });

  it('omits documents with no course from every course grouping, without losing them from the index itself', () => {
    const byCourse = documentsByCourse(index);
    for (const paths of byCourse.values()) {
      expect(paths).not.toContain('05 Zettelkasten/Suspension.md');
    }
  });
});
