// Scenarios: `features/F6-today.md`, "F6.9 — The processed-revision record" —
// @auto:plugin/ingestion/processed-revisions/store.spec (the record) and
// @auto:core/today/arrivals.spec (the reading). This suite is the seam between the two: the store's
// rows becoming the arrivals stage's per-course input. Every string here is invented (INV-3).

import { detectArrivals, toRhythmCourseInput } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { courseArrivalInputs } from '../../../src/ingestion/processed-revisions/facts.js';
import type {
  PersistedProcessedRevisions,
  ProcessedRevisionRow,
} from '../../../src/ingestion/processed-revisions/store.js';

function persisted(
  revisions: Record<string, ProcessedRevisionRow>,
  rebuiltOn: PersistedProcessedRevisions['rebuiltOn'] = '2026-11-02',
): PersistedProcessedRevisions {
  return { version: 2, rebuiltOn, revisions };
}

function known(
  courses: readonly string[],
  day: `${number}-${number}-${number}`,
  state: ProcessedRevisionRow['state'] = 'read',
): ProcessedRevisionRow {
  return { fingerprint: `fp-${day}-${courses.join('')}`, courses, state, firstProcessedDay: day };
}

function unknownDay(
  courses: readonly string[],
  noLaterThan: `${number}-${number}-${number}`,
  state: ProcessedRevisionRow['state'] = 'read',
): ProcessedRevisionRow {
  return {
    fingerprint: `fp-unknown-${courses.join('')}`,
    courses,
    state,
    firstProcessedDay: null,
    noLaterThan,
  };
}

describe('courseArrivalInputs — the store’s rows as the arrivals stage’s per-course input', () => {
  it('groups rows by course, in course order, one revision per file', () => {
    const inputs = courseArrivalInputs(
      persisted({
        'a.pdf': known(['CRS-B'], '2026-09-02'),
        'b.md': known(['CRS-A'], '2026-09-01'),
        'c.pdf': known(['CRS-A'], '2026-09-05', 'unreadable'),
      }),
    );
    expect(inputs.map((input) => input.course)).toEqual(['CRS-A', 'CRS-B']);
    expect(inputs[0]?.revisions).toHaveLength(2);
    expect(inputs[1]?.revisions).toHaveLength(1);
  });

  it('a file in two courses is one revision in each', () => {
    const inputs = courseArrivalInputs(
      persisted({ 'a.md': known(['CRS-A', 'CRS-B'], '2026-09-01') }),
    );
    expect(inputs.map((input) => input.revisions.length)).toEqual([1, 1]);
  });

  it('carries the first-processed day, its state and an unknown day’s bound, and nothing else', () => {
    const [input] = courseArrivalInputs(
      persisted({
        'a.pdf': known(['CRS-A'], '2026-09-01', 'pending'),
        'b.pdf': unknownDay(['CRS-A'], '2026-11-02', 'read'),
      }),
    );
    const revisions = [...(input?.revisions ?? [])].sort((x, y) =>
      String(x.firstProcessedDay).localeCompare(String(y.firstProcessedDay)),
    );
    // Sorted: the known day first, the unknown one (null) last is arbitrary; assert as a set.
    expect(revisions).toContainEqual({ firstProcessedDay: '2026-09-01', readState: 'pending' });
    expect(revisions).toContainEqual({
      firstProcessedDay: null,
      noLaterThan: '2026-11-02',
      readState: 'read',
    });
    // Neither a fingerprint, a path nor a course leaves the store through the reading's input.
    for (const revision of revisions) {
      expect(Object.keys(revision).sort()).not.toContain('fingerprint');
      expect(Object.keys(revision).sort()).not.toContain('path');
    }
  });

  it('a store with no rows gives no course: a course with nothing on record is simply not listed', () => {
    expect(courseArrivalInputs(persisted({}))).toEqual([]);
  });
});

describe('the rows through the arrivals stage into the rhythm reading’s input', () => {
  function rhythmInputsOf(state: PersistedProcessedRevisions) {
    return detectArrivals(courseArrivalInputs(state)).map((reading) =>
      toRhythmCourseInput(reading),
    );
  }

  it('a known, read day is the course’s last day', () => {
    expect(
      rhythmInputsOf(
        persisted({
          'a.pdf': known(['CRS-A'], '2026-09-01'),
          'b.md': known(['CRS-A'], '2026-09-20'),
        }),
      ),
    ).toEqual([{ course: 'CRS-A', lastMaterialArrivalDay: '2026-09-20', unreadable: false }]);
  });

  it('a pending version is arrived-but-unread with its day, which is not the same as a course with nothing', () => {
    expect(
      rhythmInputsOf(persisted({ 'a.pdf': known(['CRS-A'], '2026-09-20', 'pending') })),
    ).toEqual([{ course: 'CRS-A', lastMaterialArrivalDay: '2026-09-20', unreadable: true }]);
    // A course with nothing on record is not listed at all.
    expect(rhythmInputsOf(persisted({}))).toEqual([]);
  });

  it('after loss every version is unknown: no day, flagged, and neither quiet nor unreadable', () => {
    expect(
      rhythmInputsOf(
        persisted({
          'a.pdf': unknownDay(['CRS-A'], '2026-11-02'),
          'b.md': unknownDay(['CRS-A'], '2026-11-02'),
        }),
      ),
    ).toEqual([
      { course: 'CRS-A', lastMaterialArrivalDay: null, arrivalDayUnknown: true, unreadable: false },
    ]);
  });

  it('unknown versions found before a known day do not hide it; found after it, they make the day unknown', () => {
    expect(
      rhythmInputsOf(
        persisted({
          'a.pdf': unknownDay(['CRS-A'], '2026-09-20'),
          'b.md': known(['CRS-A'], '2026-09-20'),
        }),
      ),
    ).toEqual([{ course: 'CRS-A', lastMaterialArrivalDay: '2026-09-20', unreadable: false }]);
    expect(
      rhythmInputsOf(
        persisted({
          'a.pdf': unknownDay(['CRS-A'], '2026-11-02'),
          'b.md': known(['CRS-A'], '2026-09-20'),
        }),
      ),
    ).toEqual([
      { course: 'CRS-A', lastMaterialArrivalDay: null, arrivalDayUnknown: true, unreadable: false },
    ]);
  });
});
