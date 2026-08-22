// test/display-names.spec.ts — `conceptDisplayName`/`courseDisplayName`
// (vocabulary.ts) and `sourceDisplayName` (corpus.ts), the fix for WBF-1
// (`ol-mxw3`): `GapView` rendered these ids verbatim as concept/course names
// and coverage-source lines on every synthetic-corpus surface. These three
// functions are the one place an id turns back into what a screen shows a
// person; every other consumer in this package still keys on the id
// unchanged (see `packages/workbench/src/oracle/display-names.ts`'s module
// doc for the full argument).

import { describe, expect, it } from 'vitest';
import { SOURCE_COVERAGE, sourceDisplayName } from '../src/corpus.js';
import {
  CONCEPTS,
  COURSE_QUORBIN,
  COURSE_VANTREL,
  COURSES,
  conceptDisplayName,
  courseDisplayName,
} from '../src/vocabulary.js';

describe('conceptDisplayName', () => {
  it('title-cases the coined token, never the raw id', () => {
    expect(conceptDisplayName('syn:concept:melspar')).toBe('Melspar');
    expect(conceptDisplayName('syn:concept:ilmenor')).toBe('Ilmenor');
  });

  it('works for every id CONCEPTS actually mints', () => {
    for (const concept of CONCEPTS) {
      const name = conceptDisplayName(concept.conceptId);
      expect(name).not.toContain('syn:');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('throws on an id this package did not mint, rather than handing back the raw string', () => {
    expect(() => conceptDisplayName('syn:concept:not-a-real-token')).toThrow();
    expect(() => conceptDisplayName('not-even-shaped-like-an-id')).toThrow();
  });
});

describe('courseDisplayName', () => {
  it('title-cases the coined token', () => {
    expect(courseDisplayName(COURSE_VANTREL)).toBe('Vantrel');
    expect(courseDisplayName(COURSE_QUORBIN)).toBe('Quorbin');
  });

  it('works for every id COURSES actually mints', () => {
    for (const course of COURSES) {
      const name = courseDisplayName(course.courseId);
      expect(name).not.toContain('syn:');
    }
  });

  it('throws on an unknown course id', () => {
    expect(() => courseDisplayName('syn:course:not-a-real-course')).toThrow();
  });
});

describe('sourceDisplayName', () => {
  it('works for every source SOURCE_COVERAGE actually carries, and never leaks the raw path', () => {
    for (const source of SOURCE_COVERAGE) {
      const name = sourceDisplayName(source.sourcePath);
      expect(name).not.toContain('syn:');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('throws on a path this package did not mint', () => {
    expect(() => sourceDisplayName('syn:source:not-a-real-source')).toThrow();
  });
});
