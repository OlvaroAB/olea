import { describe, expect, it } from 'vitest';
import { contestClaim, contestStateForClaim } from '../review-log/contest.js';
import type { DisputeLogRecord } from '../review-log/contest-record.js';
import {
  claimHasConcepts,
  contestedClaimFor,
  enumerateTodayClaims,
  heldReadingBasis,
  type TodayClaim,
} from './contest.js';
import type { TodayViewModel } from './panel.js';

// Synthetic fixtures only (INV-3). Course codes and concept ids are invented.
const COURSE = 'COURSE-1';
const CONCEPTS = ['concept-a', 'concept-b'];

function viewModel(overrides: Partial<TodayViewModel> = {}): TodayViewModel {
  return {
    due: null,
    streak: { days: [], currentRun: 0, longestRun: 0, studyDayCount: 0 } as never,
    mastery: {
      courses: [
        {
          course: COURSE,
          distribution: {
            counts: { seed: 2, sprout: 1, sapling: 0, tree: 1 },
            total: 4,
          },
        },
      ],
      unassignedConceptCount: 0,
      conceptCount: 4,
    },
    insights: null,
    rhythm: null,
    windowDays: 30,
    ...overrides,
  } as TodayViewModel;
}

const conceptIdsByCourse = { [COURSE]: CONCEPTS };

describe('every reading the panel asserts carries the same contest gesture', () => {
  it('enumerates the mastery reading as a contestable claim', () => {
    const claims = enumerateTodayClaims({
      viewModel: viewModel(),
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.rendering).toBe('mastery-reading');
    expect(claims[0]?.contestable).toBe(true);
  });

  it('enumerates the trend and freshness readings too, ruled kind not yet named', () => {
    const claims = enumerateTodayClaims({
      viewModel: viewModel({
        insights: { spacing: null, earlyPull: null, effort: null } as never,
        rhythm: { id: 'rhythm', status: 'not-observed', measured: null, reason: '' },
      }),
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    const renderings = claims.map((claim) => claim.rendering);
    expect(renderings).toContain('trend-sentence');
    expect(renderings).toContain('vault-freshness-line');
    for (const claim of claims.filter((c) => c.rendering !== 'mastery-reading')) {
      expect(claim.contestable).toBe(false);
      // `[D-215]` (`ol-egov.103`): the mechanism no longer refuses these — a
      // tap records claimKind `unsorted` and routingStatus `open` instead of
      // throwing. `contestable: false` still names that no RULED kind exists
      // yet, not that the tap is refused.
      const outcome = contestClaim({
        claim: contestedClaimFor(claim),
        timestamp: '2026-08-21T09:00:00+02:00',
      });
      expect(outcome.kind).toBe('unsorted');
      expect(outcome.effect).toBe('held');
      expect(outcome.record.routingStatus).toBe('open');
    }
  });

  it('asserts nothing where nothing was computed — a null section produces no claim', () => {
    const claims = enumerateTodayClaims({
      viewModel: viewModel({ mastery: null }),
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    expect(claims).toEqual([]);
  });
});

describe('contesting a reading changes no number on the panel', () => {
  it('leaves the view model byte-identical', () => {
    const vm = viewModel();
    const before = JSON.stringify(vm);
    const [claim] = enumerateTodayClaims({
      viewModel: vm,
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    if (claim === undefined) throw new Error('expected a claim');
    const outcome = contestClaim({
      claim: contestedClaimFor(claim),
      timestamp: '2026-08-21T09:00:00+02:00',
    });
    expect(outcome.effect).toBe('held');
    expect(JSON.stringify(vm)).toBe(before);

    // And rebuilding from the same inputs produces the same reading.
    const after = enumerateTodayClaims({
      viewModel: viewModel(),
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    expect(after[0]?.evidenceBasis).toBe(claim.evidenceBasis);
  });
});

describe('the contest opens the evidence rather than an argument', () => {
  it('names which reviews the reading was folded from, and when', () => {
    const [claim] = enumerateTodayClaims({
      viewModel: viewModel(),
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    if (claim === undefined) throw new Error('expected a claim');

    const basis = heldReadingBasis({
      entries: [
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
        // A suspend event is not evidence for a reading.
        { eventId: 's1', timestamp: '2026-08-19T10:00:00+02:00', kind: 'suspend' },
      ],
      claim,
    });

    expect(basis.reviewCount).toBe(2);
    // Newest first — "you explained it back three weeks ago" is the newest one.
    expect(basis.reviews[0]?.eventId).toBe('r2');
    // The sheet can state its own scope rather than implying it read everything.
    expect(basis.since).toBe('2026-07-22');
  });

  it('resolves entirely on device — the evidence is a selector, never a fetched copy', () => {
    const [claim] = enumerateTodayClaims({
      viewModel: viewModel(),
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    expect(claim?.evidence.kind).toBe('events');
    expect(claim?.evidence.conceptIds).toEqual(CONCEPTS);
  });
});

describe('a held reading is acknowledged once and then left alone', () => {
  function claimOf(): TodayClaim {
    const [claim] = enumerateTodayClaims({
      viewModel: viewModel(),
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    if (claim === undefined) throw new Error('expected a claim');
    return claim;
  }

  it('shows the acknowledgment on the render after the resolution, and never again', () => {
    const claim = claimOf();
    const opening: DisputeLogRecord = {
      schemaVersion: 5,
      kind: 'dispute',
      eventId: 'd1',
      timestamp: '2026-08-21T09:00:00+02:00',
      claimKind: 'reading',
      claimRendering: 'mastery-reading',
      conceptIds: [...claim.conceptIds],
      evidenceBasis: claim.evidenceBasis,
      effect: 'held',
    };
    const resolution: DisputeLogRecord = {
      ...opening,
      eventId: 'd2',
      resolves: 'd1',
      outcome: 'upheld',
    };

    expect(contestStateForClaim({ records: [opening, resolution], claim }).acknowledgementDue).toBe(
      true,
    );
    expect(
      contestStateForClaim({
        records: [opening, resolution],
        claim,
        acknowledgedDisputeIds: ['d1'],
      }).acknowledgementDue,
    ).toBe(false);
  });
});

describe('claimHasConcepts — the gesture-render precondition, mirroring contestClaim without relaxing it (ol-3ux7.64.20)', () => {
  it('is true for a mastery claim whose course has a concept layer', () => {
    const [claim] = enumerateTodayClaims({
      viewModel: viewModel(),
      conceptIdsByCourse,
      today: '2026-08-21',
    });
    if (claim === undefined) throw new Error('expected a claim');
    expect(claimHasConcepts(claim)).toBe(true);
  });

  it('is false for a mastery claim whose course has no concept layer yet — conceptIdsByCourse has no entry for it', () => {
    const [claim] = enumerateTodayClaims({
      viewModel: viewModel(),
      conceptIdsByCourse: {}, // no entry for COURSE-1 at all
      today: '2026-08-21',
    });
    if (claim === undefined) throw new Error('expected a claim');
    expect(claim.conceptIds).toEqual([]);
    expect(claimHasConcepts(claim)).toBe(false);
  });

  it('a concept-less claim is exactly the shape contestClaim refuses — claimHasConcepts predicts the throw without calling it', () => {
    const [claim] = enumerateTodayClaims({
      viewModel: viewModel(),
      conceptIdsByCourse: {},
      today: '2026-08-21',
    });
    if (claim === undefined) throw new Error('expected a claim');
    expect(claimHasConcepts(claim)).toBe(false);
    expect(() =>
      contestClaim({ claim: contestedClaimFor(claim), timestamp: '2026-08-21T09:00:00+02:00' }),
    ).toThrow('contestClaim: a contested claim must name at least one concept');
  });

  it('is false for the trend/rhythm renderings too, when no concept exists anywhere in the vault', () => {
    const claims = enumerateTodayClaims({
      viewModel: viewModel({
        insights: { spacing: null, earlyPull: null, effort: null } as never,
        rhythm: { id: 'rhythm', status: 'not-observed', measured: null, reason: '' },
      }),
      conceptIdsByCourse: {},
      today: '2026-08-21',
    });
    for (const claim of claims) {
      expect(claimHasConcepts(claim)).toBe(false);
    }
  });
});
