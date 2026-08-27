import { describe, expect, it } from 'vitest';
import { buildCourseMapping, pathInCourseMapping, recomputeCourseRoot } from './mapping.js';

// features/F1-sources.md, C7.8 / `[D-098]` — @auto:core/course/mapping.spec

describe('the mapping is root paths with per-document exceptions', () => {
  it('holds the root and her attached documents as explicit exceptions', () => {
    const mapping = buildCourseMapping('01 Courses/COURSEA', [
      '03 Research/Related paper.md',
      '00 Daily notes/2026-08-14.md',
    ]);
    expect(mapping.root).toBe('01 Courses/COURSEA');
    expect(mapping.exceptions).toEqual([
      '03 Research/Related paper.md',
      '00 Daily notes/2026-08-14.md',
    ]);
  });

  it('a path under the root belongs, without needing to be listed', () => {
    const mapping = buildCourseMapping('01 Courses/COURSEA');
    expect(pathInCourseMapping(mapping, '01 Courses/COURSEA/WEEK 2/Lecture.md')).toBe(true);
  });

  it('an attached exception belongs even though it sits nowhere near the root', () => {
    const mapping = buildCourseMapping('01 Courses/COURSEA', ['03 Research/Related paper.md']);
    expect(pathInCourseMapping(mapping, '03 Research/Related paper.md')).toBe(true);
  });

  it('nothing else is asked to move so the mapping can stay simple — an unrelated path just does not belong', () => {
    const mapping = buildCourseMapping('01 Courses/COURSEA', ['03 Research/Related paper.md']);
    expect(pathInCourseMapping(mapping, '03 Research/Unrelated paper.md')).toBe(false);
    expect(pathInCourseMapping(mapping, '01 Courses/COURSEB/Lecture.md')).toBe(false);
  });
});

describe('a coherent folder move re-maps silently', () => {
  it('computes the new root from where the uid set went, with nothing surfaced', () => {
    const snapshot = {
      root: '01 Courses/COURSEA',
      relativePaths: new Map([
        ['uid-1', 'WEEK 2/Lecture.md'],
        ['uid-2', 'WEEK 3/Notes.md'],
      ]),
    };
    const currentLocations = new Map([
      ['uid-1', '02 Archive/COURSEA 2026/WEEK 2/Lecture.md'],
      ['uid-2', '02 Archive/COURSEA 2026/WEEK 3/Notes.md'],
    ]);

    const result = recomputeCourseRoot(snapshot, currentLocations);
    expect(result).toEqual({ kind: 'silent', newRoot: '02 Archive/COURSEA 2026' });
  });

  it('reports unchanged when nothing has moved', () => {
    const snapshot = {
      root: '01 Courses/COURSEA',
      relativePaths: new Map([['uid-1', 'WEEK 2/Lecture.md']]),
    };
    const currentLocations = new Map([['uid-1', '01 Courses/COURSEA/WEEK 2/Lecture.md']]);

    expect(recomputeCourseRoot(snapshot, currentLocations)).toEqual({ kind: 'unchanged' });
  });

  it('a uid absent from the live table is skipped, never treated as evidence of a move', () => {
    const snapshot = {
      root: '01 Courses/COURSEA',
      relativePaths: new Map([
        ['uid-1', 'WEEK 2/Lecture.md'],
        ['uid-deleted', 'WEEK 4/Gone.md'],
      ]),
    };
    const currentLocations = new Map([['uid-1', '01 Courses/COURSEA/WEEK 2/Lecture.md']]);

    expect(recomputeCourseRoot(snapshot, currentLocations)).toEqual({ kind: 'unchanged' });
  });
});

describe('genuine scatter surfaces a question, with candidates pre-filled', () => {
  it('asks, with every implicated root as a candidate, when no single new root explains the uid set', () => {
    const snapshot = {
      root: '01 Courses/COURSEA',
      relativePaths: new Map([
        ['uid-1', 'WEEK 2/Lecture.md'],
        ['uid-2', 'WEEK 3/Notes.md'],
        ['uid-3', 'WEEK 4/Readings.md'],
      ]),
    };
    const currentLocations = new Map([
      ['uid-1', '02 Archive/COURSEA 2026/WEEK 2/Lecture.md'],
      ['uid-2', '05 Zettelkasten/COURSEA/WEEK 3/Notes.md'],
      ['uid-3', '01 Courses/COURSEA/WEEK 4/Readings.md'],
    ]);

    const result = recomputeCourseRoot(snapshot, currentLocations);
    expect(result).toEqual({
      kind: 'scatter',
      candidates: ['01 Courses/COURSEA', '02 Archive/COURSEA 2026', '05 Zettelkasten/COURSEA'],
    });
  });

  it('the question is never blank — candidates always name real current locations', () => {
    const snapshot = {
      root: '01 Courses/COURSEA',
      relativePaths: new Map([
        ['uid-1', 'Lecture.md'],
        ['uid-2', 'Notes.md'],
      ]),
    };
    const currentLocations = new Map([
      ['uid-1', 'Somewhere Else/Lecture.md'],
      ['uid-2', 'Somewhere Different/Notes.md'],
    ]);

    const result = recomputeCourseRoot(snapshot, currentLocations);
    expect(result.kind).toBe('scatter');
    if (result.kind === 'scatter') {
      expect(result.candidates.length).toBeGreaterThan(0);
      for (const candidate of result.candidates) {
        expect([...currentLocations.values()].some((path) => path.startsWith(candidate))).toBe(
          true,
        );
      }
    }
  });
});
