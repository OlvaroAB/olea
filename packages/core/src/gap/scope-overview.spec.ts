/**
 * `buildCrossCourseScopeOverview` acceptance tests — F6.2's cross-course
 * scenarios (`features/F6-today.md`, "F6.2 — The cross-course reading is the
 * default", service repo), asserted directly against the pure computation.
 * `../scope/grove.spec.ts` is the per-course model's own suite; this file is
 * only about assembling several already-built models side by side.
 *
 * Every course code and path below is invented, per INV-3.
 */
import { describe, expect, it } from 'vitest';
import type { GroveCourseModel } from '../scope/grove.js';
import type { VaultPath } from '../vault/types.js';
import { buildCrossCourseScopeOverview } from './scope-overview.js';

function declared(
  course: string,
  denominatorCount: number,
  builtCount: number,
  denominatorSourcePaths: readonly VaultPath[],
): GroveCourseModel {
  return {
    status: 'declared',
    course,
    cells: [],
    materialGaps: [],
    volunteers: [],
    summary: { builtCount, denominatorCount, denominatorSourcePaths },
  };
}

function noRegisteredSource(course: string): GroveCourseModel {
  return { status: 'no-registered-source', course };
}

function inferred(course: string): GroveCourseModel {
  return { status: 'inferred', course, concepts: [] };
}

describe('buildCrossCourseScopeOverview', () => {
  it('places courses beside one another, never scored against one another (C5.7)', () => {
    // No field on the shape could carry a rank even if a caller tried — the
    // structural check the type-level tripwire above the function backs up.
    const overview = buildCrossCourseScopeOverview(
      [
        declared('AAA111', 10, 2, ['Sources/aaa-objectives.pdf' as VaultPath]),
        declared('ZZZ999', 10, 9, ['Sources/zzz-objectives.pdf' as VaultPath]),
      ],
      '2026-08-29T00:00:00Z',
    );
    for (const course of overview.courses) {
      expect(Object.keys(course).sort()).toEqual(
        course.status === 'declared'
          ? ['builtCount', 'course', 'denominatorCount', 'denominatorSourcePaths', 'status']
          : ['course', 'status'],
      );
    }
    expect(Object.keys(overview).sort()).toEqual(['asOf', 'courses']);
  });

  it("each course's count names its own denominator source, never a shared or borrowed one", () => {
    const overview = buildCrossCourseScopeOverview(
      [
        declared('AAA111', 12, 3, ['Sources/aaa-objectives.pdf' as VaultPath]),
        declared('BBB222', 8, 8, [
          'Sources/bbb-past-paper-1.pdf' as VaultPath,
          'Sources/bbb-past-paper-2.pdf' as VaultPath,
        ]),
      ],
      '2026-08-29T00:00:00Z',
    );
    const aaa = overview.courses.find((c) => c.course === 'AAA111');
    const bbb = overview.courses.find((c) => c.course === 'BBB222');
    expect(aaa?.status).toBe('declared');
    expect(bbb?.status).toBe('declared');
    if (aaa?.status === 'declared') {
      expect(aaa.denominatorSourcePaths).toEqual(['Sources/aaa-objectives.pdf']);
    }
    if (bbb?.status === 'declared') {
      expect(bbb.denominatorSourcePaths).toEqual([
        'Sources/bbb-past-paper-1.pdf',
        'Sources/bbb-past-paper-2.pdf',
      ]);
    }
  });

  it('echoes the reading\'s own "as of" timestamp rather than inventing a per-source registration date', () => {
    const overview = buildCrossCourseScopeOverview(
      [declared('AAA111', 5, 1, ['Sources/aaa-objectives.pdf' as VaultPath])],
      '2026-08-29T12:00:00Z',
    );
    expect(overview.asOf).toBe('2026-08-29T12:00:00Z');
  });

  it('a course with no registered source states it has no denominator yet, never a borrowed one', () => {
    const overview = buildCrossCourseScopeOverview(
      [
        declared('AAA111', 10, 2, ['Sources/aaa-objectives.pdf' as VaultPath]),
        noRegisteredSource('BBB222'),
      ],
      '2026-08-29T00:00:00Z',
    );
    const bbb = overview.courses.find((c) => c.course === 'BBB222');
    expect(bbb).toEqual({ course: 'BBB222', status: 'no-denominator-yet' });
  });

  it("a course read as 'inferred' also states no denominator yet — the grove screen's guess label is not this reading's job", () => {
    const overview = buildCrossCourseScopeOverview([inferred('CCC333')], '2026-08-29T00:00:00Z');
    expect(overview.courses[0]).toEqual({ course: 'CCC333', status: 'no-denominator-yet' });
  });

  it('never sums the denominators, and no total field exists anywhere on the shape', () => {
    const overview = buildCrossCourseScopeOverview(
      [
        declared('AAA111', 10, 2, ['Sources/a.pdf' as VaultPath]),
        declared('BBB222', 20, 5, ['Sources/b.pdf' as VaultPath]),
        declared('CCC333', 30, 1, ['Sources/c.pdf' as VaultPath]),
      ],
      '2026-08-29T00:00:00Z',
    );
    expect(overview).not.toHaveProperty('total');
    expect(overview).not.toHaveProperty('denominatorTotal');
    expect(overview).not.toHaveProperty('builtTotal');
    // Every declared row's own count/denominator stay separate too (F8.3).
    for (const course of overview.courses) {
      expect(course).not.toHaveProperty('ratio');
      expect(course).not.toHaveProperty('percent');
    }
  });

  it('orders by course code, never by how well a course is going (principle 12)', () => {
    const overview = buildCrossCourseScopeOverview(
      [
        declared('ZZZ999', 10, 9, ['Sources/zzz.pdf' as VaultPath]), // nearly built
        declared('AAA111', 10, 1, ['Sources/aaa.pdf' as VaultPath]), // barely started
      ],
      '2026-08-29T00:00:00Z',
    );
    expect(overview.courses.map((c) => c.course)).toEqual(['AAA111', 'ZZZ999']);
  });

  it('is pure: same input, same output, and the input is untouched', () => {
    const models: readonly GroveCourseModel[] = [
      declared('AAA111', 10, 2, ['Sources/aaa.pdf' as VaultPath]),
      noRegisteredSource('BBB222'),
    ];
    const snapshot = JSON.stringify(models);
    const first = buildCrossCourseScopeOverview(models, '2026-08-29T00:00:00Z');
    const second = buildCrossCourseScopeOverview(models, '2026-08-29T00:00:00Z');
    expect(second).toEqual(first);
    expect(JSON.stringify(models)).toBe(snapshot);
  });

  it('handles an empty course list honestly rather than inventing a row', () => {
    const overview = buildCrossCourseScopeOverview([], '2026-08-29T00:00:00Z');
    expect(overview.courses).toEqual([]);
  });
});
