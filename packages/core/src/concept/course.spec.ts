import { describe, expect, it } from 'vitest';
import { courseFromPath, DEFAULT_COURSES_FOLDER, notePathCourses } from './course.js';

describe('courseFromPath — F1.3, course association from folder structure (ol-jbnu)', () => {
  it('reads the segment directly under the course folder', () => {
    expect(courseFromPath('01 Courses/COURSEA/WEEK 2/Lecture.md')).toBe('COURSEA');
  });

  it('tolerates inconsistent structures — week-numbered and name-organised courses read alike', () => {
    expect(courseFromPath('01 Courses/COURSEA/WEEK 2/Lecture.md')).toBe('COURSEA');
    expect(courseFromPath('01 Courses/COURSEB/Some Set Text/Reading.md')).toBe('COURSEB');
    expect(courseFromPath('01 Courses/COURSEB/A/B/C/D/Deep.md')).toBe('COURSEB');
  });

  it('a file is not a course code — a note loose in the course folder derives nothing', () => {
    expect(courseFromPath('01 Courses/Loose note.md')).toBeUndefined();
  });

  it('derives nothing outside the course folder, rather than guessing', () => {
    expect(courseFromPath('03 Research/Paper.md')).toBeUndefined();
    expect(courseFromPath('05 Zettelkasten/Concept.md')).toBeUndefined();
    expect(courseFromPath('00 Daily notes/2026-08-14.md')).toBeUndefined();
    // Not a prefix match on a folder that merely starts the same way.
    expect(courseFromPath('01 Coursework/COURSEA/Lecture.md')).toBeUndefined();
  });

  it('returns the segment verbatim — no case folding, no normalisation (R1/R2)', () => {
    expect(courseFromPath('01 Courses/coursea/WEEK 1/L.md')).toBe('coursea');
    expect(courseFromPath('01 Courses/Course A (2026)/WEEK 1/L.md')).toBe('Course A (2026)');
  });

  it('honours a non-default course folder', () => {
    expect(courseFromPath('Papers/COURSEA/WEEK 1/L.md', 'Papers')).toBe('COURSEA');
    expect(courseFromPath('01 Courses/COURSEA/WEEK 1/L.md', 'Papers')).toBeUndefined();
  });

  it('names the vault-shape default rather than hiding it in a literal', () => {
    expect(DEFAULT_COURSES_FOLDER).toBe('01 Courses');
  });
});

describe('notePathCourses — the frontmatter key is an override, never the only path', () => {
  it('believes the note about itself when it says anything', () => {
    expect(notePathCourses('01 Courses/COURSEA/WEEK 1/L.md', ['COURSEB'])).toEqual(['COURSEB']);
    expect(notePathCourses('01 Courses/COURSEA/WEEK 1/L.md', ['COURSEB', 'COURSEC'])).toEqual([
      'COURSEB',
      'COURSEC',
    ]);
  });

  it('falls back to the folder only when the note says nothing', () => {
    expect(notePathCourses('01 Courses/COURSEA/WEEK 1/L.md', [])).toEqual(['COURSEA']);
  });

  it('is empty, not guessed, when neither source has an answer', () => {
    expect(notePathCourses('03 Research/Paper.md', [])).toEqual([]);
  });
});
