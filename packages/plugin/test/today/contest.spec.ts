import { type DisputeLogRecord, parseReviewLog, reviewLogPath, type TodayClaim } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildDisputeSheet, createTodayContestSupport } from '../../src/today/contest.js';
import {
  allTodayStrings,
  CONTEST_DISSENT_MARK,
  CONTEST_GESTURE_LABEL,
  CONTEST_OPEN_ROUTING_KEPT,
  CONTEST_SHEET_OFFLINE_NOTE,
  CONTEST_UPHELD_ACKNOWLEDGEMENT,
} from '../../src/today/copy.js';
import { memoryVault } from '../review/memory-vault.js';

// Synthetic fixtures only (INV-3): invented course code, opaque concept ids.
const COURSE = 'COURSE-1';
const CONCEPTS = ['concept-a', 'concept-b'];

function claim(overrides: Partial<TodayClaim> = {}): TodayClaim {
  return {
    id: `mastery:${COURSE}`,
    rendering: 'mastery-reading',
    course: COURSE,
    conceptIds: CONCEPTS,
    evidenceBasis: 'mastery|COURSE-1|seed=1',
    evidence: { kind: 'events', conceptIds: CONCEPTS, since: '2026-07-22' },
    contestable: true,
    ...overrides,
  };
}

const entries = [
  {
    eventId: 'r1',
    timestamp: '2026-08-01T10:00:00+02:00',
    kind: 'review',
    conceptIds: ['concept-a'],
  },
  {
    eventId: 'r2',
    timestamp: '2026-08-18T10:00:00+02:00',
    kind: 'review',
    conceptIds: ['concept-b'],
  },
];

describe('the dispute sheet opens with the network down', () => {
  it('is built from the artifact already on the device, and says so', () => {
    const sheet = buildDisputeSheet({ claim: claim(), entries, disputes: [] });
    expect(sheet.offlineNote).toBe(CONTEST_SHEET_OFFLINE_NOTE);
    // Evidence is a place to look — a date and an event id, never a copy of
    // what is there.
    expect(sheet.evidence.map((line) => line.date)).toEqual(['2026-08-18', '2026-08-01']);
    expect(sheet.gestureLabel).toBe(CONTEST_GESTURE_LABEL);
  });

  it('does not withhold the gesture on a rendering DSN-1 left open, and shows the kept-and-counted note ([D-215])', () => {
    const sheet = buildDisputeSheet({
      claim: claim({ id: 'insights', rendering: 'trend-sentence', contestable: false }),
      entries,
      disputes: [],
    });
    // [D-215]: identical gesture everywhere — an open row no longer withholds it.
    expect(sheet.gestureLabel).toBe(CONTEST_GESTURE_LABEL);
    expect(sheet.openRoutingNote).toBe(CONTEST_OPEN_ROUTING_KEPT);
    // She still gets the reasoning, and the note is shown after it, never instead of it.
    expect(sheet.reasoning.length).toBeGreaterThan(0);
  });

  it('shows neither an open-routing note nor a withheld gesture for a routed rendering', () => {
    const sheet = buildDisputeSheet({ claim: claim(), entries, disputes: [] });
    expect(sheet.openRoutingNote).toBeNull();
    expect(sheet.gestureLabel).toBe(CONTEST_GESTURE_LABEL);
  });

  it('carries no confidence figure and no verdict on her', () => {
    const sheet = buildDisputeSheet({ claim: claim(), entries, disputes: [] });
    const text = [sheet.heading, sheet.reasoning, sheet.offlineNote].join(' ').toLowerCase();
    for (const forbidden of [
      'confiden',
      'probabil',
      '%',
      'you were wrong',
      'dismiss',
      'override',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('the gesture goes on the claim, and the dispute is recorded', () => {
  it('records the dispute in her vault and the reading does not move', async () => {
    const vault = memoryVault();
    const support = createTodayContestSupport({
      vault,
      deviceId: 'device-1',
      conceptIdsByCourse: async () => ({ [COURSE]: CONCEPTS }),
      today: () => '2026-08-21',
      now: () => '2026-08-21T09:00:00+02:00',
      readHistory: async () => ({ entries: [], disputes: [] }),
    });

    const result = await support.contest(claim());
    // A reading holds: nothing moved, and nothing is discounted.
    expect(result.effect).toBe('held');

    const written = vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '';
    const parsed = parseReviewLog(written);
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.disputes).toHaveLength(1);
    expect(parsed.disputes[0]?.claimRendering).toBe('mastery-reading');
    expect(parsed.disputes[0]?.effect).toBe('held');
  });

  it('records a tap on an open row too, instead of refusing it ([D-215])', async () => {
    const vault = memoryVault();
    const support = createTodayContestSupport({
      vault,
      deviceId: 'device-1',
      conceptIdsByCourse: async () => ({ [COURSE]: CONCEPTS }),
      today: () => '2026-08-21',
      now: () => '2026-08-21T09:00:00+02:00',
      readHistory: async () => ({ entries: [], disputes: [] }),
    });

    const result = await support.contest(
      claim({ id: 'insights', rendering: 'trend-sentence', contestable: false }),
    );
    expect(result.effect).toBe('held');
    expect(result.record.claimKind).toBe('unsorted');
    expect(result.record.routingStatus).toBe('open');
    expect(result.record.claimRendering).toBe('trend-sentence');

    const written = vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '';
    const parsed = parseReviewLog(written);
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.disputes).toHaveLength(1);
  });

  it('shows her dissent beside a standing reading', () => {
    const sheet = buildDisputeSheet({
      claim: claim(),
      entries,
      disputes: [
        {
          schemaVersion: 5,
          kind: 'dispute',
          eventId: 'd1',
          timestamp: '2026-08-21T09:00:00+02:00',
          claimKind: 'reading',
          claimRendering: 'mastery-reading',
          conceptIds: CONCEPTS,
          evidenceBasis: 'mastery|COURSE-1|seed=1',
          effect: 'held',
        },
      ],
    });
    expect(sheet.dissentMark).toBe(CONTEST_DISSENT_MARK);
  });

  // `ol-l5og.18.12` [STY-3]: pins the fix for the "no visible trace after
  // recording" bug (`[D-046]` clause 4, DSN-1 frame 03/04). The mark alone
  // is not enough evidence the recorded state is genuinely showing — a build
  // could render `dissentMark` right next to a live "Record this" button and
  // still read as pending, not recorded. This asserts the withheld half:
  // rebuilding the sheet against a log that now carries her dispute must
  // retire the record gesture, on both a routed AND a DSN-1-open rendering.
  it('withholds the record gesture once a dispute stands, on a routed reading', () => {
    const disputes: readonly DisputeLogRecord[] = [
      {
        schemaVersion: 5,
        kind: 'dispute',
        eventId: 'd1',
        timestamp: '2026-08-21T09:00:00+02:00',
        claimKind: 'reading',
        claimRendering: 'mastery-reading',
        conceptIds: CONCEPTS,
        evidenceBasis: 'mastery|COURSE-1|seed=1',
        effect: 'held',
      },
    ];
    const sheet = buildDisputeSheet({ claim: claim(), entries, disputes });
    expect(sheet.gestureLabel).toBeNull();
    expect(sheet.dissentMark).toBe(CONTEST_DISSENT_MARK);
  });

  it('withholds the record gesture once a dispute stands, on a DSN-1-open rendering ([D-215])', () => {
    const disputes: readonly DisputeLogRecord[] = [
      {
        schemaVersion: 5,
        kind: 'dispute',
        eventId: 'd1',
        timestamp: '2026-08-21T09:00:00+02:00',
        claimKind: 'unsorted',
        claimRendering: 'trend-sentence',
        conceptIds: CONCEPTS,
        evidenceBasis: 'mastery|COURSE-1|seed=1',
        effect: 'held',
        routingStatus: 'open',
      },
    ];
    const sheet = buildDisputeSheet({
      claim: claim({ id: 'insights', rendering: 'trend-sentence', contestable: false }),
      entries,
      disputes,
    });
    expect(sheet.gestureLabel).toBeNull();
    expect(sheet.dissentMark).toBe(CONTEST_DISSENT_MARK);
    // The open-routing disclosure is a fact about the mechanism, not about
    // whether she has disputed yet — it stays, beside the mark, not instead of it.
    expect(sheet.openRoutingNote).toBe(CONTEST_OPEN_ROUTING_KEPT);
  });

  it('acknowledges an upheld dispute exactly once', () => {
    const opening: DisputeLogRecord = {
      schemaVersion: 5,
      kind: 'dispute',
      eventId: 'd1',
      timestamp: '2026-08-21T09:00:00+02:00',
      claimKind: 'reading',
      claimRendering: 'mastery-reading',
      conceptIds: CONCEPTS,
      evidenceBasis: 'mastery|COURSE-1|seed=1',
      effect: 'held',
    };
    const disputes: readonly DisputeLogRecord[] = [
      opening,
      { ...opening, eventId: 'd2', resolves: 'd1', outcome: 'upheld' },
    ];

    expect(buildDisputeSheet({ claim: claim(), entries, disputes }).acknowledgement).toBe(
      CONTEST_UPHELD_ACKNOWLEDGEMENT,
    );
    expect(
      buildDisputeSheet({
        claim: claim(),
        entries,
        disputes,
        acknowledgedDisputeIds: ['d1'],
      }).acknowledgement,
    ).toBeNull();
  });
});

describe("the panel's contest copy states the evidence and never argues back", () => {
  it('uses none of the strings frame 09 rules out', () => {
    const corpus = allTodayStrings().join(' ').toLowerCase();
    for (const forbidden of [
      'dispute submitted',
      'snooze',
      'dismiss',
      'mute',
      'override',
      'confiden',
      'probabil',
      'got it, updated',
      'you were wrong',
    ]) {
      expect(corpus, `"${forbidden}" is ruled out on this surface`).not.toContain(forbidden);
    }
  });
});
