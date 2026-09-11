// C5.5's session clustering and the D-092 window history it feeds — @auto:core/session/cluster.spec
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { computeWindowDeficit } from '../study-session/window.js';
import {
  clusterReviewSessions,
  pastSessionsFromReviewLog,
  RECEIVED_SECONDS_PER_ITEM_CAP,
  SESSION_CLUSTERING_GAP_SECONDS,
} from './cluster.js';

let seq = 0;

function review(overrides: {
  timestamp: string;
  conceptIds?: readonly string[];
  durationMs?: number | null;
  planVersion?: string | null;
  eventId?: string;
}): ReviewLogRecord {
  seq += 1;
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: overrides.eventId ?? `evt-${String(seq).padStart(3, '0')}`,
    timestamp: overrides.timestamp,
    instrumentId: `inst-${seq}`,
    instrumentType: 'qa',
    conceptIds: [...(overrides.conceptIds ?? ['k-a1'])],
    rating: 'good',
    wasUnsure: false,
    durationMs: overrides.durationMs === undefined ? 30_000 : overrides.durationMs,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: overrides.planVersion === undefined ? null : overrides.planVersion,
    },
  };
}

function suspend(timestamp: string): ReviewLogEntry {
  seq += 1;
  return {
    schemaVersion: 5,
    kind: 'suspend',
    eventId: `sus-${seq}`,
    timestamp,
    instrumentId: `inst-${seq}`,
    conceptIds: ['k-a1'],
  } as ReviewLogEntry;
}

const COURSES = new Map<string, readonly string[]>([
  ['k-a1', ['course-a']],
  ['k-a2', ['course-a']],
  ['k-b1', ['course-b']],
  ['k-both', ['course-a', 'course-b']],
]);

describe('the declared constants', () => {
  it('pins the clustering gap at 45 minutes and the per-item cap at 5 minutes', () => {
    // Declared, never fitted ([D-091]); the sweep that checked them is on
    // `[SESS-13]` and found no discriminating evidence either way. Pinned here
    // so a silent drift is a red test rather than a quiet change to what a
    // session IS.
    expect(SESSION_CLUSTERING_GAP_SECONDS).toBe(2700);
    expect(RECEIVED_SECONDS_PER_ITEM_CAP).toBe(300);
  });
});

describe('clusterReviewSessions', () => {
  it('reads two reviews closer together than the gap as one session', () => {
    const sessions = clusterReviewSessions([
      review({ timestamp: '2026-06-01T09:00:00.000+01:00' }),
      review({ timestamp: '2026-06-01T09:44:00.000+01:00' }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.reviews).toHaveLength(2);
    expect(sessions[0]?.day).toBe('2026-06-01');
    expect(sessions[0]?.startedAt).toBe('2026-06-01T09:00:00.000+01:00');
    expect(sessions[0]?.endedAt).toBe('2026-06-01T09:44:00.000+01:00');
  });

  it('cuts a seam where the silence exceeds the gap — her break, not a clock hour or a day', () => {
    const sessions = clusterReviewSessions([
      review({ timestamp: '2026-06-01T09:00:00.000+01:00' }),
      // 46 minutes: over the gap, inside the same hour-of-morning and the same day.
      review({ timestamp: '2026-06-01T09:46:00.000+01:00' }),
    ]);
    expect(sessions).toHaveLength(2);
  });

  it('treats exactly the gap as still one session — the cut is on a gap ABOVE the threshold', () => {
    const sessions = clusterReviewSessions([
      review({ timestamp: '2026-06-01T09:00:00.000+01:00' }),
      review({ timestamp: '2026-06-01T09:45:00.000+01:00' }),
    ]);
    expect(sessions).toHaveLength(1);
  });

  it('is a pure function of (timestamp, eventId), so a shuffled or interleaved read is identical', () => {
    const entries = [
      review({ timestamp: '2026-06-01T09:00:00.000+01:00', eventId: 'a' }),
      review({ timestamp: '2026-06-01T09:10:00.000+01:00', eventId: 'b' }),
      review({ timestamp: '2026-06-01T14:00:00.000+01:00', eventId: 'c' }),
      review({ timestamp: '2026-06-01T14:05:00.000+01:00', eventId: 'd' }),
    ];
    const ordered = clusterReviewSessions(entries);
    const shuffled = clusterReviewSessions(
      [entries[2], entries[0], entries[3], entries[1]].flatMap((e) => (e === undefined ? [] : [e])),
    );
    expect(ordered).toHaveLength(2);
    expect(shuffled).toEqual(ordered);
  });

  it('lets only reviews open or extend a session — an opened-but-unreviewed queue accrues nothing', () => {
    const sessions = clusterReviewSessions([
      suspend('2026-06-01T08:00:00.000+01:00'),
      review({ timestamp: '2026-06-01T09:00:00.000+01:00' }),
      suspend('2026-06-01T12:00:00.000+01:00'),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.startedAt).toBe('2026-06-01T09:00:00.000+01:00');
  });

  it('drops an unparseable timestamp rather than guessing at it', () => {
    const bad = {
      ...review({ timestamp: '2026-06-01T09:00:00.000+01:00' }),
      timestamp: 'nonsense',
    };
    const sessions = clusterReviewSessions([
      bad,
      review({ timestamp: '2026-06-01T09:05:00.000+01:00' }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.reviews).toHaveLength(1);
  });

  it('reads an empty log as no sessions at all', () => {
    expect(clusterReviewSessions([])).toEqual([]);
  });
});

describe('pastSessionsFromReviewLog', () => {
  const input = { coursesOfConcept: COURSES, runningCourses: ['course-a', 'course-b'] };

  it('sums measured active time per course, capped per item', () => {
    const [record] = pastSessionsFromReviewLog(
      [
        review({
          timestamp: '2026-06-01T09:00:00.000+01:00',
          conceptIds: ['k-a1'],
          durationMs: 30_000,
        }),
        // Left open while she walked away: capped at 300s, not 3600s.
        review({
          timestamp: '2026-06-01T09:05:00.000+01:00',
          conceptIds: ['k-a2'],
          durationMs: 3_600_000,
        }),
        review({
          timestamp: '2026-06-01T09:10:00.000+01:00',
          conceptIds: ['k-b1'],
          durationMs: 60_000,
        }),
      ],
      input,
    );
    expect(record?.received.get('course-a')).toBe(330);
    expect(record?.received.get('course-b')).toBe(60);
  });

  it('contributes nothing for an unmeasured review, never an assumed duration', () => {
    const [record] = pastSessionsFromReviewLog(
      [review({ timestamp: '2026-06-01T09:00:00.000+01:00', durationMs: null })],
      input,
    );
    expect(record?.received.get('course-a')).toBeUndefined();
    // It still counts as the course APPEARING — eligibility is about what was
    // running, not about what was measured.
    expect(record?.eligibleCourses).toEqual(['course-a']);
  });

  it('divides an item spanning two courses equally, so the session total is the time she spent', () => {
    const [record] = pastSessionsFromReviewLog(
      [
        review({
          timestamp: '2026-06-01T09:00:00.000+01:00',
          conceptIds: ['k-both'],
          durationMs: 60_000,
        }),
      ],
      input,
    );
    expect(record?.received.get('course-a')).toBe(30);
    expect(record?.received.get('course-b')).toBe(30);
  });

  it('reads entitlement as the PLAN share, never the share that was served', () => {
    const shares = new Map([
      [
        'plan:v1',
        new Map([
          ['course-a', 0.3],
          ['course-b', 0.7],
        ]),
      ],
    ]);
    const [record] = pastSessionsFromReviewLog(
      [
        // course-b was served nothing at all this session, yet the plan owed it 0.7.
        review({
          timestamp: '2026-06-01T09:00:00.000+01:00',
          conceptIds: ['k-a1'],
          planVersion: 'plan:v1',
        }),
        review({
          timestamp: '2026-06-01T09:05:00.000+01:00',
          conceptIds: ['k-b1'],
          planVersion: 'plan:v1',
          durationMs: null,
        }),
      ],
      { ...input, sharesByPlanVersion: shares },
    );
    expect(record?.entitlement?.get('course-b')).toBe(0.7);
    expect(record?.received.get('course-b')).toBeUndefined();
  });

  it('carries no entitlement when the plan version is unknown or the policy changed mid-session', () => {
    const shares = new Map([['plan:v1', new Map([['course-a', 0.5]])]]);
    const [unknown] = pastSessionsFromReviewLog(
      [review({ timestamp: '2026-06-01T09:00:00.000+01:00', planVersion: 'plan:v9' })],
      { ...input, sharesByPlanVersion: shares },
    );
    expect(unknown?.entitlement).toBeUndefined();

    const [mixed] = pastSessionsFromReviewLog(
      [
        review({ timestamp: '2026-06-01T09:00:00.000+01:00', planVersion: 'plan:v1' }),
        review({ timestamp: '2026-06-01T09:05:00.000+01:00', planVersion: 'plan:v2' }),
      ],
      { ...input, sharesByPlanVersion: shares },
    );
    expect(mixed?.entitlement).toBeUndefined();
  });

  it('makes a course eligible from its first appearance onward, so starvation accrues', () => {
    const records = pastSessionsFromReviewLog(
      [
        // Session 1: only course-a exists in the log at all.
        review({ timestamp: '2026-06-01T09:00:00.000+01:00', conceptIds: ['k-a1'] }),
        // Session 2: course-b appears for the first time.
        review({ timestamp: '2026-06-02T09:00:00.000+01:00', conceptIds: ['k-a1'] }),
        review({ timestamp: '2026-06-02T09:05:00.000+01:00', conceptIds: ['k-b1'] }),
        // Session 3: course-b gets nothing — but it is still eligible, which is
        // the whole point: a course served nothing must read as owed.
        review({ timestamp: '2026-06-03T09:00:00.000+01:00', conceptIds: ['k-a1'] }),
      ],
      input,
    );
    expect(records.map((r) => r.eligibleCourses)).toEqual([
      ['course-a'],
      ['course-a', 'course-b'],
      ['course-a', 'course-b'],
    ]);
    expect(records.map((r) => r.asOf)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  it('feeds computeWindowDeficit directly, and a starved course reads a real positive deficit', () => {
    const entries = [
      review({ timestamp: '2026-06-01T09:00:00.000+01:00', conceptIds: ['k-a1'] }),
      review({ timestamp: '2026-06-01T09:05:00.000+01:00', conceptIds: ['k-b1'] }),
      review({ timestamp: '2026-06-02T09:00:00.000+01:00', conceptIds: ['k-a1'] }),
      review({ timestamp: '2026-06-03T09:00:00.000+01:00', conceptIds: ['k-a1'] }),
    ];
    const history = pastSessionsFromReviewLog(entries, input);
    const deficit = computeWindowDeficit(
      history,
      ['course-a', 'course-b'],
      new Map([
        ['course-a', 0.5],
        ['course-b', 0.5],
      ]),
    );
    // course-b: eligible for all three sessions, served in one of them.
    expect(deficit.get('course-b')?.deficit).toBeGreaterThan(0);
    expect(deficit.get('course-b')?.sessionsSinceLastServed).toBe(2);
    // course-a ran ahead of its share, so its reading is negative — never clamped.
    expect(deficit.get('course-a')?.deficit).toBeLessThan(0);
    expect(deficit.get('course-a')?.sessionsSinceLastServed).toBe(0);
  });

  it('reads an empty log as no history at all, never a fabricated session', () => {
    expect(pastSessionsFromReviewLog([], input)).toEqual([]);
  });
});
