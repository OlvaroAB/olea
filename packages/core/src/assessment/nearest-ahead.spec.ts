import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/types.js';
import { nearestAssessmentAhead } from './nearest-ahead.js';
import type { AssessmentRecord } from './types.js';

function rec(
  path: string,
  due: string | undefined,
  course = 'C1',
  type = 'Quiz',
): AssessmentRecord {
  return {
    path: path as VaultPath,
    course,
    type,
    weight: undefined,
    weightRaw: undefined,
    due,
    status: undefined,
  };
}

const TODAY = '2026-09-14';

describe('nearestAssessmentAhead: the one home of the assessment whose format applies', () => {
  it('counts an assessment due today as not yet passed (0 days)', () => {
    const got = nearestAssessmentAhead([rec('a.md', TODAY)], 'C1', TODAY);
    expect(got?.record.path).toBe('a.md');
    expect(got?.daysUntil).toBe(0);
  });

  it('ignores one passed yesterday', () => {
    expect(nearestAssessmentAhead([rec('a.md', '2026-09-13')], 'C1', TODAY)).toBeNull();
  });

  it('is null when none is ahead, or the date is absent or unreadable', () => {
    expect(nearestAssessmentAhead([], 'C1', TODAY)).toBeNull();
    expect(
      nearestAssessmentAhead([rec('a.md', undefined), rec('b.md', 'soon')], 'C1', TODAY),
    ).toBeNull();
  });

  it('picks the soonest of two ahead, whatever their classes or read order', () => {
    const quiz = rec('q.md', '2026-09-20', 'C1', 'Quiz');
    const essay = rec('e.md', '2026-09-30', 'C1', 'Essay');
    expect(nearestAssessmentAhead([essay, quiz], 'C1', TODAY)?.record.path).toBe('q.md');
    expect(nearestAssessmentAhead([quiz, essay], 'C1', TODAY)?.daysUntil).toBe(6);
  });

  it('breaks a same-day tie by the smaller path, in either read order', () => {
    const z = rec('z.md', '2026-09-20');
    const a = rec('a.md', '2026-09-20');
    expect(nearestAssessmentAhead([z, a], 'C1', TODAY)?.record.path).toBe('a.md');
    expect(nearestAssessmentAhead([a, z], 'C1', TODAY)?.record.path).toBe('a.md');
  });

  it('scopes to one course, or to a set of courses', () => {
    const other = rec('o.md', '2026-09-15', 'C2');
    const mine = rec('m.md', '2026-09-25', 'C1');
    expect(nearestAssessmentAhead([other, mine], 'C1', TODAY)?.record.path).toBe('m.md');
    expect(nearestAssessmentAhead([other, mine], new Set(['C1', 'C2']), TODAY)?.record.path).toBe(
      'o.md',
    );
    expect(nearestAssessmentAhead([{ ...mine, course: undefined }], 'C1', TODAY)).toBeNull();
  });
});
