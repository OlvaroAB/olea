/**
 * F8.5 / D-465: the guards hold with a transcript added to a course with history
 * (`ol-egov.141.89.3.43`). Synthetic data only (INV-3).
 */

import { describe, expect, it } from 'vitest';
import { CONCEPT_SIZE_SECONDS_MULTIPLIER } from '../study-session/build.js';
import { countPassagesByTeachingEvent, readConceptSize } from './size.js';
import {
  NOTE_PATH,
  partProvenance,
  SLIDES_PATH,
  slideProvenance,
  TRANSCRIPT_PATH,
} from './transcript-fixtures.ol-egov.141.89.3.43.js';

const bundle = (p: string) =>
  p === SLIDES_PATH || p === TRANSCRIPT_PATH || p === NOTE_PATH ? 'lecture-4' : undefined;

describe('F8.5: the guards', () => {
  it('adding a same-event transcript leaves size, allocation and extent exactly as they were', () => {
    const slides = [1, 2].map(slideProvenance);
    const before = readConceptSize({
      anchor: slides[0],
      alsoIn: slides.slice(1),
      sourcePaths: [NOTE_PATH],
    });
    const manyParts = Array.from({ length: 30 }, (_, i) =>
      partProvenance(TRANSCRIPT_PATH, i + 1, i * 90),
    );
    const after = readConceptSize({
      anchor: slides[0],
      alsoIn: [...slides.slice(1), ...manyParts],
      sourcePaths: [NOTE_PATH],
      teachingEventOf: bundle,
    });
    expect(after).toEqual(before);
    expect(CONCEPT_SIZE_SECONDS_MULTIPLIER[after.band]).toBe(
      CONCEPT_SIZE_SECONDS_MULTIPLIER[before.band],
    );
  });

  it('same-event passages are one signal, however many files the event has', () => {
    const passages = [
      slideProvenance(1),
      partProvenance(TRANSCRIPT_PATH, 1),
      partProvenance(TRANSCRIPT_PATH, 2),
    ];
    // Slides count as before (one); the same-event transcript adds none.
    expect(countPassagesByTeachingEvent(passages, bundle)).toBe(1);
    // With no bundles known, the transcript is its own event: one, not two.
    expect(countPassagesByTeachingEvent(passages)).toBe(2);
  });

  it('two transcripts of one bundle are one event', () => {
    const other = '01 Courses/COURSE-A/Lectures/week-4-talk-2.txt';
    const eventOf = (p: string) => (p === TRANSCRIPT_PATH || p === other ? 'lecture-4' : undefined);
    const passages = [partProvenance(TRANSCRIPT_PATH, 1), partProvenance(other as never, 1)];
    expect(countPassagesByTeachingEvent(passages, eventOf)).toBe(1);
  });
});
