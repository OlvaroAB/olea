/**
 * `home/avoidance.ts` tests (F4.6, `[D-265]`, `ol-egov.141.54` [INTERV-5]).
 *
 * Every course/topic name below is invented, per INV-3.
 *
 * Covers the trigger's two required gates and its determinism
 * (`findAvoidedCourse`), the grove→review-log join (`courseActivityFromGrove`)
 * and the store's "at most once" and merge-not-replace guarantees
 * (`ObsidianHomeAvoidanceStore`) — the pure logic `./provider.ts`'s own wiring
 * composes but does not itself re-decide.
 */

import type { GroveCourseModel } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { GroveCourseSection } from '../../src/grove/view.js';
import {
  allCourseAvoidanceStrings,
  COURSE_AVOIDANCE_LEAVE_ACTION,
  COURSE_AVOIDANCE_PRACTISE_ACTION,
  type CourseActivity,
  courseActivityFromGrove,
  findAvoidedCourse,
  ObsidianHomeAvoidanceStore,
} from '../../src/home/avoidance.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = new Date('2026-09-18T09:00:00Z').getTime();

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function activity(
  course: string,
  hasMaterial: boolean,
  lastReviewedAtMs: number | undefined,
): CourseActivity {
  return { course, hasMaterial, lastReviewedAtMs };
}

describe('findAvoidedCourse — F4.6 trigger', () => {
  it('never fires with only one course — "elsewhere" has nothing to point at', () => {
    const courses = [activity('ONLY101', true, undefined)];
    expect(findAvoidedCourse(courses, NOW_MS, new Set())).toBeUndefined();
  });

  it('fires for a never-reviewed course while another has been reviewed recently', () => {
    const courses = [
      activity('QUIET101', true, undefined),
      activity('ACTIVE101', true, NOW_MS - 2 * DAY_MS),
    ];
    expect(findAvoidedCourse(courses, NOW_MS, new Set())).toBe('QUIET101');
  });

  it('does not fire when the silent course was reviewed inside the silent window', () => {
    const courses = [
      activity('RECENT101', true, NOW_MS - 3 * DAY_MS), // inside the 21-day default
      activity('ACTIVE101', true, NOW_MS - 2 * DAY_MS),
    ];
    expect(findAvoidedCourse(courses, NOW_MS, new Set())).toBeUndefined();
  });

  it('does not fire when nothing else has been active recently — general absence, not avoidance', () => {
    const courses = [
      activity('QUIET101', true, undefined),
      activity('ALSOQUIET101', true, NOW_MS - 30 * DAY_MS), // outside the 14-day elsewhere window
    ];
    expect(findAvoidedCourse(courses, NOW_MS, new Set())).toBeUndefined();
  });

  it('never re-offers a course already in `alreadyAsked` — "at most once"', () => {
    const courses = [
      activity('QUIET101', true, undefined),
      activity('ACTIVE101', true, NOW_MS - 2 * DAY_MS),
    ];
    expect(findAvoidedCourse(courses, NOW_MS, new Set(['QUIET101']))).toBeUndefined();
  });

  it('excludes a course with no material — nothing to be silent about', () => {
    const courses = [
      activity('EMPTY101', false, undefined),
      activity('ACTIVE101', true, NOW_MS - 2 * DAY_MS),
    ];
    expect(findAvoidedCourse(courses, NOW_MS, new Set())).toBeUndefined();
  });

  it('picks the most-silent course deterministically when several qualify', () => {
    const courses = [
      activity('MEDIUM101', true, NOW_MS - 25 * DAY_MS),
      activity('OLDEST101', true, NOW_MS - 90 * DAY_MS),
      activity('ACTIVE101', true, NOW_MS - 1 * DAY_MS),
    ];
    expect(findAvoidedCourse(courses, NOW_MS, new Set())).toBe('OLDEST101');
  });

  it('breaks a genuine tie by course name', () => {
    const courses = [
      activity('BBB101', true, undefined),
      activity('AAA101', true, undefined),
      activity('ACTIVE101', true, NOW_MS - 1 * DAY_MS),
    ];
    expect(findAvoidedCourse(courses, NOW_MS, new Set())).toBe('AAA101');
  });

  it('respects overridden thresholds', () => {
    const courses = [
      activity('QUIET101', true, NOW_MS - 10 * DAY_MS),
      activity('ACTIVE101', true, NOW_MS - 2 * DAY_MS),
    ];
    expect(findAvoidedCourse(courses, NOW_MS, new Set(), { silentDays: 30 })).toBeUndefined();
    expect(findAvoidedCourse(courses, NOW_MS, new Set(), { silentDays: 5 })).toBe('QUIET101');
  });
});

function declaredModel(cells: readonly { conceptKey: string }[]): GroveCourseModel {
  return {
    status: 'declared',
    course: 'unused',
    cells: cells.map((c) => ({
      conceptKey: c.conceptKey,
      conceptName: c.conceptKey,
      state: 'sprout',
      stall: false,
      pastPaperCitationCount: 1,
    })),
    materialGaps: [],
    volunteers: [],
    summary: {
      builtCount: cells.length,
      denominatorCount: cells.length,
      denominatorSourcePaths: [],
      pastPaperSourcePaths: [],
      readCompleteness: 'unknown',
      pendingSections: [],
    },
  };
}

function section(course: string, model: GroveCourseModel): GroveCourseSection {
  // `registerCandidates` ([D-226] ruling 1, S1) is irrelevant to this join
  // test — always empty, matching every other fixture field here.
  return { course, model, offerCards: [], unreadableFiles: [], registerCandidates: [] };
}

describe('courseActivityFromGrove — the grove/review-log join', () => {
  it('a declared course with a reviewed concept reads its latest timestamp', () => {
    const sections = [section('C101', declaredModel([{ conceptKey: 'k1' }, { conceptKey: 'k2' }]))];
    const reviewed = new Map([
      ['k1', NOW_MS - 10 * DAY_MS],
      ['k2', NOW_MS - 2 * DAY_MS],
    ]);
    const [result] = courseActivityFromGrove(sections, reviewed);
    expect(result).toEqual({
      course: 'C101',
      hasMaterial: true,
      lastReviewedAtMs: NOW_MS - 2 * DAY_MS,
    });
  });

  it('a declared course with no matching review reads undefined, not zero', () => {
    const sections = [section('C101', declaredModel([{ conceptKey: 'k1' }]))];
    const [result] = courseActivityFromGrove(sections, new Map());
    expect(result?.lastReviewedAtMs).toBeUndefined();
    expect(result?.hasMaterial).toBe(true);
  });

  it('a declared course with zero cells never reads hasMaterial: true', () => {
    const sections = [section('C101', declaredModel([]))];
    const [result] = courseActivityFromGrove(sections, new Map());
    expect(result?.hasMaterial).toBe(false);
  });

  it('an inferred or no-registered-source course always reads hasMaterial: false', () => {
    const sections = [
      section('C101', { status: 'inferred', course: 'C101', concepts: [] }),
      section('C202', { status: 'no-registered-source', course: 'C202' }),
    ];
    const [a, b] = courseActivityFromGrove(sections, new Map([['whatever', NOW_MS]]));
    expect(a?.hasMaterial).toBe(false);
    expect(a?.lastReviewedAtMs).toBeUndefined();
    expect(b?.hasMaterial).toBe(false);
  });
});

describe('home avoidance copy — honesty', () => {
  it('every string is non-empty, and no percentage or fraction (F8.3)', () => {
    for (const text of allCourseAvoidanceStrings()) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/%/);
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });

  it('the two option labels are the registry §16 words, verbatim', () => {
    expect(COURSE_AVOIDANCE_LEAVE_ACTION.toLowerCase()).toContain('leave the course for now');
    expect(COURSE_AVOIDANCE_PRACTISE_ACTION.toLowerCase()).toContain('practise it differently');
  });

  it('no wording asserts a cause — [D-265]’s forbidden framing', () => {
    for (const text of allCourseAvoidanceStrings()) {
      expect(text.toLowerCase()).not.toMatch(/struggl|ahead|behind|avoid/);
    }
  });
});

describe('ObsidianHomeAvoidanceStore', () => {
  it('load() returns empty when nothing is stored', async () => {
    const store = new ObsidianHomeAvoidanceStore(new FakeDataHost());
    expect((await store.load()).size).toBe(0);
  });

  it('markAsked records the course; a second markAsked is a no-op (idempotent)', async () => {
    const store = new ObsidianHomeAvoidanceStore(new FakeDataHost());
    await store.markAsked('C101', '2026-09-18T09:00:00Z');
    const first = (await store.load()).get('C101');
    expect(first?.askedAt).toBe('2026-09-18T09:00:00Z');

    await store.markAsked('C101', '2026-09-25T09:00:00Z');
    const second = (await store.load()).get('C101');
    expect(second?.askedAt).toBe('2026-09-18T09:00:00Z'); // unchanged
  });

  it('recordAnswer holds the literal option and a date, never a diagnosis', async () => {
    const store = new ObsidianHomeAvoidanceStore(new FakeDataHost());
    await store.markAsked('C101', '2026-09-18T09:00:00Z');
    await store.recordAnswer('C101', {
      value: 'leave-for-now',
      text: COURSE_AVOIDANCE_LEAVE_ACTION,
      recordedAt: '2026-09-18T09:05:00Z',
    });
    const record = (await store.load()).get('C101');
    expect(record?.answer).toEqual({
      value: 'leave-for-now',
      text: COURSE_AVOIDANCE_LEAVE_ACTION,
      recordedAt: '2026-09-18T09:05:00Z',
    });
    // Never anything beyond the two fields plus a date — no third key sneaks in.
    expect(Object.keys(record?.answer ?? {}).sort()).toEqual(['recordedAt', 'text', 'value']);
  });

  it('a save for one course never drops another course’s own row (merge, not replace)', async () => {
    const store = new ObsidianHomeAvoidanceStore(new FakeDataHost());
    await store.markAsked('C101', '2026-09-01T00:00:00Z');
    await store.markAsked('C202', '2026-09-10T00:00:00Z');
    const map = await store.load();
    expect(map.get('C101')?.askedAt).toBe('2026-09-01T00:00:00Z');
    expect(map.get('C202')?.askedAt).toBe('2026-09-10T00:00:00Z');
  });
});
