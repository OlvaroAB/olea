import { describe, expect, it } from 'vitest';
import type { RetrievalScope } from './request.js';
import { applyScope, type CourseOf } from './scopeFilter.js';

interface Candidate {
  readonly path: string;
  readonly label: string;
}

function candidate(path: string, label = path): Candidate {
  return { path, label };
}

function scope(overrides: Partial<RetrievalScope> = {}): RetrievalScope {
  return { courses: [], includeUncoursed: false, ...overrides };
}

describe('applyScope (`[ILB-EVD-4]`, evd.md §2)', () => {
  it('keeps everything when scope.courses is empty, regardless of includeUncoursed', () => {
    const candidates = [candidate('01 Courses/COURSEA/note.md'), candidate('03 Research/paper.md')];
    const courseOf: CourseOf = (path) => (path.startsWith('01 Courses/COURSEA') ? ['COURSEA'] : []);

    expect(applyScope(candidates, scope({ courses: [] }), courseOf)).toEqual(candidates);
    expect(
      applyScope(candidates, scope({ courses: [], includeUncoursed: false }), courseOf),
    ).toEqual(candidates);
  });

  it('keeps a candidate whose source belongs to one of the scope courses', () => {
    const candidates = [candidate('01 Courses/COURSEA/note.md')];
    const courseOf: CourseOf = () => ['COURSEA'];

    expect(applyScope(candidates, scope({ courses: ['COURSEA'] }), courseOf)).toEqual(candidates);
  });

  it('drops a candidate whose source belongs to a course outside the scope', () => {
    const candidates = [candidate('01 Courses/COURSEB/note.md')];
    const courseOf: CourseOf = () => ['COURSEB'];

    expect(applyScope(candidates, scope({ courses: ['COURSEA'] }), courseOf)).toEqual([]);
  });

  it('keeps an uncoursed candidate only when includeUncoursed is set', () => {
    const candidates = [candidate('03 Research/paper.md')];
    const courseOf: CourseOf = () => [];

    expect(
      applyScope(candidates, scope({ courses: ['COURSEA'], includeUncoursed: false }), courseOf),
    ).toEqual([]);
    expect(
      applyScope(candidates, scope({ courses: ['COURSEA'], includeUncoursed: true }), courseOf),
    ).toEqual(candidates);
  });

  it('keeps a candidate that belongs to any one of several scope courses, in a mixed set', () => {
    const inCourseA = candidate('01 Courses/COURSEA/note.md', 'a');
    const inCourseB = candidate('01 Courses/COURSEB/note.md', 'b');
    const inCourseC = candidate('01 Courses/COURSEC/note.md', 'c');
    const uncoursed = candidate('03 Research/paper.md', 'u');
    const candidates = [inCourseA, inCourseB, inCourseC, uncoursed];
    const courseOf: CourseOf = (path) => {
      if (path.includes('COURSEA')) return ['COURSEA'];
      if (path.includes('COURSEB')) return ['COURSEB'];
      if (path.includes('COURSEC')) return ['COURSEC'];
      return [];
    };

    const result = applyScope(
      candidates,
      scope({ courses: ['COURSEA', 'COURSEB'], includeUncoursed: true }),
      courseOf,
    );

    expect(result).toEqual([inCourseA, inCourseB, uncoursed]);
  });

  it('keeps a candidate that carries more than one course when any of them is in scope', () => {
    const candidates = [candidate('01 Courses/shared-note.md')];
    const courseOf: CourseOf = () => ['COURSEB', 'COURSEA'];

    expect(applyScope(candidates, scope({ courses: ['COURSEA'] }), courseOf)).toEqual(candidates);
  });

  it('is a pure function: calling it twice with the same inputs changes nothing and produces the same result', () => {
    const candidates = [candidate('01 Courses/COURSEA/note.md')];
    const courseOf: CourseOf = () => ['COURSEA'];
    const s = scope({ courses: ['COURSEA'] });

    const first = applyScope(candidates, s, courseOf);
    const second = applyScope(candidates, s, courseOf);

    expect(first).toEqual(second);
    expect(candidates).toHaveLength(1);
  });

  it('never mutates the input candidate array', () => {
    const candidates = [candidate('01 Courses/COURSEB/note.md')];
    const courseOf: CourseOf = () => ['COURSEB'];

    applyScope(candidates, scope({ courses: ['COURSEA'] }), courseOf);

    expect(candidates).toHaveLength(1);
  });
});
