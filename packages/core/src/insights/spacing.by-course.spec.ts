/**
 * The concentration reading per course (standing-views spec §2.3; failure
 * classes K3 and K6). Like `spacing.spec.ts`, this establishes the
 * arithmetic and the course association, not that the detector detects
 * cramming; that claim lives with the synthetic personas.
 *
 * Fixture ids are opaque (INV-3).
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { detectSpacing, detectSpacingByCourse } from './spacing.js';
import type { ConceptCourses } from './types.js';

const DAY_MS = 86_400_000;
const START = Date.parse('2026-01-01T18:00:00.000Z');

let counter = 0;
function review(
  conceptIds: readonly string[],
  dayOffset: number,
  examProximity: number | null,
): ReviewLogRecord {
  counter += 1;
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: `e-${counter}`,
    timestamp: new Date(START + dayOffset * DAY_MS).toISOString().replace('Z', '+00:00'),
    instrumentId: `qa:${conceptIds.join('+')}:1`,
    instrumentType: 'qa',
    conceptIds: [...conceptIds],
    rating: 'good',
    wasUnsure: false,
    durationMs: 5_000,
    selectionContext: {
      dueState: 'due',
      examProximity,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

/**
 * Course KA crams: sparse far practice and six reviews a day in the week
 * before its assessment on day 50. Course KB practises one review every day
 * over the same span, including every day of KA's week, with its own
 * assessments on days 30 and 75.
 */
function twoCourseLog(): ReviewLogRecord[] {
  const log: ReviewLogRecord[] = [];
  for (let d = 0; d <= 40; d += 4) log.push(review(['ka-1'], d, 50 - d));
  for (let d = 44; d <= 50; d += 1) {
    for (let i = 0; i < 6; i += 1) log.push(review(['ka-1'], d, 50 - d));
  }
  log.push(review(['ka-1'], 52, null), review(['ka-1'], 56, null));
  for (let d = 0; d <= 59; d += 1) log.push(review(['kb-1'], d, d <= 30 ? 30 - d : 75 - d));
  return log;
}

const JOIN: readonly ConceptCourses[] = [
  { conceptId: 'ka-1', courses: ['KA'] },
  { conceptId: 'kb-1', courses: ['KB'] },
];

describe('detectSpacingByCourse', () => {
  it('reads each course against its own assessments: the crammer is observed, the steady course is not (K3)', () => {
    const readings = detectSpacingByCourse(twoCourseLog(), JOIN);
    expect(readings.map((r) => r.course)).toEqual(['KA', 'KB']);
    const [ka, kb] = readings;
    expect(ka?.insight.status).toBe('observed');
    expect(kb?.insight.status).toBe('not-observed');
    // KB's reading knows only KB's assessment days, never KA's.
    expect(kb?.insight.measured?.assessmentDays).toEqual(['2026-01-31', '2026-03-17']);
    expect(ka?.insight.measured?.assessmentDays).toEqual(['2026-02-20']);
  });

  it('differs from the pooled reading, which lets one course’s steady attendance mask another’s pattern', () => {
    const pooled = detectSpacing(twoCourseLog());
    expect(pooled.status).toBe('not-observed');
    const ka = detectSpacingByCourse(twoCourseLog(), JOIN).find((r) => r.course === 'KA');
    expect(ka?.insight.status).toBe('observed');
  });

  it('states what it read: each course’s review count and span, even when it abstains', () => {
    const readings = detectSpacingByCourse(twoCourseLog(), [
      ...JOIN,
      { conceptId: 'kc-1', courses: ['KC'] },
    ]);
    const byCourse = new Map(readings.map((r) => [r.course, r]));
    expect(byCourse.get('KA')?.reviewCount).toBe(55);
    expect(byCourse.get('KA')?.span).toEqual({ from: '2026-01-01', to: '2026-02-26' });
    expect(byCourse.get('KB')?.reviewCount).toBe(60);
    const kc = byCourse.get('KC');
    expect(kc?.reviewCount).toBe(0);
    expect(kc?.span).toBeNull();
    expect(kc?.insight.status).toBe('not-enough-history');
  });

  it('a review whose concepts sit in two courses belongs to each course’s reading; one no course holds belongs to none', () => {
    const log = [review(['ka-1', 'kb-1'], 3, 10), review(['kz-unjoined'], 4, 10)];
    const readings = detectSpacingByCourse(log, JOIN);
    expect(readings.map((r) => [r.course, r.reviewCount])).toEqual([
      ['KA', 1],
      ['KB', 1],
    ]);
  });

  it('each review keeps its recorded proximity: a later-moved date does not re-date past reviews (K6)', () => {
    // Every review recorded KA's assessment at day 50; nothing here reads a calendar,
    // so moving the assessment afterwards cannot move the near window.
    const ka = detectSpacingByCourse(twoCourseLog(), JOIN).find((r) => r.course === 'KA');
    expect(ka?.insight.measured?.nearDayCount).toBe(7);
  });

  it('is deterministic under shuffled log and join order', () => {
    const log = twoCourseLog();
    expect(detectSpacingByCourse([...log].reverse(), [...JOIN].reverse())).toEqual(
      detectSpacingByCourse(log, JOIN),
    );
  });
});
