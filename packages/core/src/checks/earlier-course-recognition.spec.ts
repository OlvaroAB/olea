/**
 * Component register row 4.5's named self-test: the neutralised-twin method,
 * run over `buildEarlierCourseRecognitions` (`RECOG-1`). Fixture ids are
 * opaque (INV-3).
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptCourses } from '../insights/types.js';
import { buildEarlierCourseRecognitions } from '../today/earlier-course-recognition.js';
import {
  checkEarlierCourseRecognitionNeutralisedTwin,
  type RecognitionTwinCase,
} from './earlier-course-recognition.js';

function review(conceptId: string, day: string, eventId: string): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp: `${day}T20:00:00+00:00`,
    instrumentId: `qa:${conceptId}:1`,
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'good',
    wasUnsure: false,
    durationMs: 4_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

/**
 * The genuine case (register row 4.5): one concept id legitimately reappears
 * across two courses. The neutralised twin: the SAME setup with concept
 * identity neutralised — two different concept ids, one per course, standing
 * in for two concepts that merely share wording.
 */
function buildCase(id: string): RecognitionTwinCase {
  const realConcepts: readonly ConceptCourses[] = [
    { conceptId: `${id}-shared`, courses: ['NEW1', 'OLD1'] },
  ];
  const realEntries = [review(`${id}-shared`, '2026-01-10', `${id}-e1`)];
  const real = buildEarlierCourseRecognitions({
    newCourse: 'NEW1',
    entries: realEntries,
    concepts: realConcepts,
  });

  const twinConcepts: readonly ConceptCourses[] = [
    { conceptId: `${id}-new`, courses: ['NEW1'] },
    { conceptId: `${id}-old`, courses: ['OLD1'] },
  ];
  const twinEntries = [
    review(`${id}-new`, '2026-01-10', `${id}-e2`),
    review(`${id}-old`, '2025-01-10', `${id}-e3`),
  ];
  const twin = buildEarlierCourseRecognitions({
    newCourse: 'NEW1',
    entries: twinEntries,
    concepts: twinConcepts,
  });

  return { id, realRecognitionCount: real.length, neutralisedRecognitionCount: twin.length };
}

describe('checkEarlierCourseRecognitionNeutralisedTwin', () => {
  it('passes when the genuine case is recognised and the neutralised twin is not', () => {
    const verdict = checkEarlierCourseRecognitionNeutralisedTwin([
      buildCase('a'),
      buildCase('b'),
      buildCase('c'),
    ]);
    expect(verdict.measured.missedReal).toEqual([]);
    expect(verdict.measured.falsePositiveOnTwin).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('fails when a genuine case produced no recognition at all', () => {
    const verdict = checkEarlierCourseRecognitionNeutralisedTwin([
      { id: 'missed', realRecognitionCount: 0, neutralisedRecognitionCount: 0 },
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.missedReal).toEqual(['missed']);
  });

  it('fails when a neutralised twin (different concept ids) still produced a recognition — unlike row 4.2/4.4, this is gated, not merely reported', () => {
    const verdict = checkEarlierCourseRecognitionNeutralisedTwin([
      { id: 'false-positive', realRecognitionCount: 1, neutralisedRecognitionCount: 1 },
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.falsePositiveOnTwin).toEqual(['false-positive']);
  });

  it('fails on zero cases (N-013)', () => {
    const verdict = checkEarlierCourseRecognitionNeutralisedTwin([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
  });
});
