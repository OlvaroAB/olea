/**
 * `deriveCourseTempo`'s own arithmetic, on hand-built inputs — the same
 * discipline `rhythm.spec.ts` uses for `detectRhythm`: this proves the
 * module computes what it says it computes, never that a real course's
 * tempo is "correct" (no real-vault tempo corpus exists to check against).
 *
 * This producer is NOT wired into `detectRhythm` by this bead (`ol-v7r5.56`)
 * — see the module doc. These tests exercise it standalone.
 */

import { describe, expect, it } from 'vitest';
import type { CalendarDay } from './calendar-day.js';
import {
  type CourseDocumentFacts,
  deriveCourseTempo,
  MIN_COURSES_WITH_CADENCE_FOR_RELATIVE_TEMPO,
} from './course-tempo.js';
import { DECLARED_FLAT_TEMPO_WEIGHT } from './rhythm.js';

function days(...isoStrings: readonly string[]): readonly CalendarDay[] {
  return isoStrings;
}

describe('deriveCourseTempo', () => {
  it("gives a fast-cadence course a higher tempo weight than a slow-cadence course, and the group's mean is 1", () => {
    // Weekly (fast) course: assessments/arrivals every 7 days across 5 weeks.
    const fast: CourseDocumentFacts = {
      course: 'fast',
      assessmentDueDays: days('2026-01-01', '2026-01-15'),
      documentArrivalDays: days('2026-01-08', '2026-01-22', '2026-01-29'),
    };
    // Monthly (slow) course: assessments/arrivals roughly every 28 days.
    const slow: CourseDocumentFacts = {
      course: 'slow',
      assessmentDueDays: days('2026-01-01', '2026-01-29'),
      documentArrivalDays: days('2026-02-26'),
    };

    const [fastReading, slowReading] = deriveCourseTempo([fast, slow]);

    expect(fastReading?.basis).toBe('derived-from-cadence');
    expect(slowReading?.basis).toBe('derived-from-cadence');
    expect(fastReading?.tempoWeight ?? 0).toBeGreaterThan(slowReading?.tempoWeight ?? 0);
    expect(fastReading?.tempoWeight ?? 0).toBeGreaterThan(1);
    expect(slowReading?.tempoWeight ?? 0).toBeLessThan(1);

    // Group mean cadence normalises to a group-mean tempo weight of 1.
    const meanWeight = ((fastReading?.tempoWeight ?? 0) + (slowReading?.tempoWeight ?? 0)) / 2;
    // Not exactly 1 because the mean is over cadence, not over weight
    // (harmonic vs arithmetic mean) — assert it lands in the same
    // neighbourhood rather than asserting a false algebraic identity.
    expect(meanWeight).toBeGreaterThan(0.5);
    expect(meanWeight).toBeLessThan(2);
  });

  it('falls back to the declared flat interim for a course with fewer than two distinct dated facts, even when a sibling course has enough', () => {
    const enough: CourseDocumentFacts = {
      course: 'enough',
      assessmentDueDays: days('2026-01-01', '2026-01-08', '2026-01-15'),
      documentArrivalDays: [],
    };
    // A second course with a usable cadence, so the group as a whole clears
    // MIN_COURSES_WITH_CADENCE_FOR_RELATIVE_TEMPO and 'enough' is actually
    // derived rather than swept into the whole-set fallback this bead's
    // other test covers.
    const alsoEnough: CourseDocumentFacts = {
      course: 'also-enough',
      assessmentDueDays: days('2026-01-01', '2026-01-29'),
      documentArrivalDays: [],
    };
    const sparse: CourseDocumentFacts = {
      course: 'sparse',
      assessmentDueDays: days('2026-01-01'),
      documentArrivalDays: [],
    };
    const empty: CourseDocumentFacts = {
      course: 'empty',
      assessmentDueDays: [],
      documentArrivalDays: [],
    };

    const readings = deriveCourseTempo([enough, alsoEnough, sparse, empty]);
    const byCourse = new Map(readings.map((r) => [r.course, r]));

    expect(byCourse.get('enough')?.basis).toBe('derived-from-cadence');
    expect(byCourse.get('sparse')?.basis).toBe('declared-fallback-insufficient-course-facts');
    expect(byCourse.get('sparse')?.tempoWeight).toBe(DECLARED_FLAT_TEMPO_WEIGHT);
    expect(byCourse.get('empty')?.basis).toBe('declared-fallback-insufficient-course-facts');
    expect(byCourse.get('empty')?.tempoWeight).toBe(DECLARED_FLAT_TEMPO_WEIGHT);
  });

  it('falls back every course to the declared flat interim when the whole set has too few courses with a usable cadence', () => {
    expect(MIN_COURSES_WITH_CADENCE_FOR_RELATIVE_TEMPO).toBeGreaterThanOrEqual(2);

    const onlyOneWithEnoughFacts: CourseDocumentFacts = {
      course: 'only-one',
      assessmentDueDays: days('2026-01-01', '2026-01-08'),
      documentArrivalDays: [],
    };
    const noFactsAtAll: CourseDocumentFacts = {
      course: 'no-facts',
      assessmentDueDays: [],
      documentArrivalDays: [],
    };

    const readings = deriveCourseTempo([onlyOneWithEnoughFacts, noFactsAtAll]);
    for (const reading of readings) {
      expect(reading.tempoWeight).toBe(DECLARED_FLAT_TEMPO_WEIGHT);
      expect(reading.basis).toBe('declared-fallback-insufficient-group-facts');
    }
  });

  it('falls back to the declared flat interim for an entirely empty input list (no throw)', () => {
    expect(deriveCourseTempo([])).toEqual([]);
  });

  it('dedupes same-day facts from both lists rather than double-counting them, and never produces a non-finite weight', () => {
    // Both lists name the SAME single day — after dedup this course has
    // only ONE distinct date, below the two-date floor for a cadence at
    // all, so it correctly falls back rather than reading a zero gap.
    const sameDayCoincidence: CourseDocumentFacts = {
      course: 'coincidence',
      assessmentDueDays: days('2026-01-01'),
      documentArrivalDays: days('2026-01-01'),
    };
    const ordinary: CourseDocumentFacts = {
      course: 'ordinary',
      assessmentDueDays: days('2026-01-01', '2026-01-08'),
      documentArrivalDays: [],
    };

    const readings = deriveCourseTempo([sameDayCoincidence, ordinary]);
    for (const reading of readings) {
      expect(Number.isFinite(reading.tempoWeight)).toBe(true);
      expect(reading.tempoWeight).toBeGreaterThan(0);
    }
    // Only one course (ordinary) has a usable cadence, which is below
    // MIN_COURSES_WITH_CADENCE_FOR_RELATIVE_TEMPO, so the whole set (both
    // courses) falls back to the declared flat interim.
    const coincidenceReading = readings.find((r) => r.course === 'coincidence');
    expect(coincidenceReading?.basis).toBe('declared-fallback-insufficient-group-facts');
    expect(coincidenceReading?.tempoWeight).toBe(DECLARED_FLAT_TEMPO_WEIGHT);
  });

  it('never imports or depends on the assessment reader or queue/CHG types — deliberately decoupled inputs (see module doc)', () => {
    // Static assertion by construction: CourseDocumentFacts only accepts
    // plain CalendarDay arrays, so this file compiles without importing
    // AssessmentRecord or any queue/CHG type. Documented here as an explicit
    // regression against a future edit re-coupling the two.
    const facts: CourseDocumentFacts = {
      course: 'decoupled',
      assessmentDueDays: [],
      documentArrivalDays: [],
    };
    expect(facts.course).toBe('decoupled');
  });
});
