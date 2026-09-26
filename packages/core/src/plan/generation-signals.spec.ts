// Signal source for D-238's top-band generation trigger — GEN-3.5 (`ol-2zfj.136`).
// `GENERATION_TOP_BAND_DIVISOR` is this module's own re-export of
// `concept/note-offer.ts`'s `TOP_BAND_DIVISOR` (see generation-signals.ts's
// module doc) — the identical value, never a second constant.

import type { PlannedConcept, StudyPlanCourse } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { conceptEnteredTopBand, GENERATION_TOP_BAND_DIVISOR } from './generation-signals.js';

/** A minimal, valid `PlannedConcept` — every field beyond `conceptId`/`rank` is filler this suite never inspects. */
function plannedConcept(conceptId: string, rank: number): PlannedConcept {
  return {
    conceptId,
    rank,
    weight: 1 / rank,
    examProximityDays: null,
    reasoning: `Ranked ${rank}.`,
    citations: [{ sourcePath: 'papers/p1.md', questionLabel: '1' }],
  };
}

/** Six-entry course ranking — divisor 3 puts ranks 1-2 in the top band, 3-6 outside it (mirrors note-offer.spec.ts's own fixture). */
function sixEntryCourse(): StudyPlanCourse {
  return {
    course: 'COURSE-A',
    status: 'ranked',
    concepts: [1, 2, 3, 4, 5, 6].map((rank) => plannedConcept(`concept-${rank}`, rank)),
  };
}

describe('conceptEnteredTopBand', () => {
  it('the divisor is 3, restated from note-offer.ts', () => {
    expect(GENERATION_TOP_BAND_DIVISOR).toBe(3);
  });

  it('rank 1 of 6 is in the top band', () => {
    expect(conceptEnteredTopBand(sixEntryCourse(), 'concept-1')).toBe(true);
  });

  it('rank 2 of 6 is in the top band (ceil(6/3) = 2)', () => {
    expect(conceptEnteredTopBand(sixEntryCourse(), 'concept-2')).toBe(true);
  });

  it('rank 3 of 6 is outside the top band', () => {
    expect(conceptEnteredTopBand(sixEntryCourse(), 'concept-3')).toBe(false);
  });

  it('rank 6 of 6 is outside the top band', () => {
    expect(conceptEnteredTopBand(sixEntryCourse(), 'concept-6')).toBe(false);
  });

  it('a single-entry course floors the cutoff at 1, so the sole concept is in the top band', () => {
    const course: StudyPlanCourse = {
      course: 'COURSE-A',
      status: 'ranked',
      concepts: [plannedConcept('only-concept', 1)],
    };
    expect(conceptEnteredTopBand(course, 'only-concept')).toBe(true);
  });

  it('a concept absent from the ranking is never in the top band', () => {
    expect(conceptEnteredTopBand(sixEntryCourse(), 'never-ranked')).toBe(false);
  });

  it('an abstained course has no ranking to sit in', () => {
    const course: StudyPlanCourse = {
      course: 'COURSE-A',
      status: 'abstained',
      reason: 'no-evidence',
      detail: 'No assessments yet.',
      assessmentPaths: ['papers/p1.md'],
    };
    expect(conceptEnteredTopBand(course, 'concept-1')).toBe(false);
  });
});
