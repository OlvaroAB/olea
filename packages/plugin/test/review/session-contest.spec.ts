/**
 * The contest gesture where the review session asserts a grade (`ol-fgba`
 * [DISP-1]; `[D-046]` clause 4, mechanised by `[D-095]`).
 *
 * An MCQ result IS an instrument grade — `[D-095]`'s third kind names "an
 * explain-back verdict, an instrument grade" — so principle 12's fourth part
 * binds on it. These are the state-machine half; the rendered half is
 * `view.ts`, which has no Vitest runtime (its module doc).
 */
import type { DisputeLogRecord } from 'olea-core';
import {
  parseReviewLog,
  projectInstrumentValidity,
  quarantinedGradeInstrumentIds,
  reviewLogPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultGradeContestPort } from '../../src/review/contest.js';
import { CONTEST_GESTURE_LABEL, CONTEST_QUARANTINE_BADGE } from '../../src/review/copy.js';
import { createVaultReviewLogPort, type RecordReviewInput } from '../../src/review/ports.js';
import {
  type ContestRegradeEnqueuePort,
  ReviewSession,
  type ReviewSessionDeps,
} from '../../src/review/session.js';
import {
  fakeDraftAcceptPort,
  fakeEditPort,
  fakeNoteExists,
  fakeReviewLog,
  fakeScheduler,
  fakeSuspendPort,
  fixedClock,
  mcqFixture,
  qaFixture,
  queueItem,
} from './fixtures.js';
import { type MemoryVault, memoryVault } from './memory-vault.js';

function baseDeps(overrides: Partial<ReviewSessionDeps> = {}): ReviewSessionDeps {
  return {
    queue: [],
    scheduler: fakeScheduler(),
    reviewLog: fakeReviewLog(),
    suspendPort: fakeSuspendPort(),
    editPort: fakeEditPort(),
    noteExists: fakeNoteExists(),
    clock: fixedClock('2026-08-10T09:00:00Z'),
    draftAcceptPort: fakeDraftAcceptPort(),
    ...overrides,
  };
}

/** Records every dispute handed to `[D-360]`'s enqueue port — never rejects, matching the real contract (`ContestRegradeEnqueuePort`'s own doc). */
function fakeContestRegradeEnqueuer(): ContestRegradeEnqueuePort & {
  readonly calls: DisputeLogRecord[];
} {
  const calls: DisputeLogRecord[] = [];
  return {
    calls,
    async enqueueOnDispute(dispute) {
      calls.push(dispute);
    },
  };
}

describe('every claim contestable — including the grade the session just asserted', () => {
  it('offers the one ratified gesture beside the answered MCQ', async () => {
    const vault = memoryVault();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        gradeContestPort: createVaultGradeContestPort(
          vault,
          'device-1',
          () => '2026-08-21T09:00:00+02:00',
        ),
      }),
    );
    await session.start();
    await session.mcqAnswer(0);

    const vm = session.getViewModel();
    if (vm.phase !== 'mcq-answered') throw new Error('expected mcq-answered');
    expect(vm.contestGestureLabel).toBe(CONTEST_GESTURE_LABEL);
    expect(vm.contestBadge).toBeNull();
  });

  it('withholds the gesture entirely when no port can record the dispute', async () => {
    const session = new ReviewSession(baseDeps({ queue: [queueItem(mcqFixture())] }));
    await session.start();
    await session.mcqAnswer(0);

    const vm = session.getViewModel();
    if (vm.phase !== 'mcq-answered') throw new Error('expected mcq-answered');
    // Absent, never inert: an affordance that cannot record is exactly the
    // dismiss button [D-046] clause 4 rules out.
    expect(vm.contestGestureLabel).toBeNull();
  });

  it('records the dispute, quarantines the grade, and does not move her on', async () => {
    const vault = memoryVault();
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        reviewLog,
        gradeContestPort: createVaultGradeContestPort(
          vault,
          'device-1',
          () => '2026-08-21T09:00:00+02:00',
        ),
      }),
    );
    await session.start();
    await session.mcqAnswer(0);
    await session.contestGrade();

    const vm = session.getViewModel();
    // Contesting is not answering: the claim, its evidence and her contest
    // stay on screen together.
    if (vm.phase !== 'mcq-answered') throw new Error('expected mcq-answered');
    expect(vm.contestBadge).toBe(CONTEST_QUARANTINE_BADGE);
    // And nothing was logged as a review by the contest itself.
    expect(reviewLog.calls).toHaveLength(0);

    const log = parseReviewLog(vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '');
    expect(log.invalidLines).toEqual([]);
    expect(log.disputes).toHaveLength(1);
    expect(log.disputes[0]?.claimKind).toBe('grade');
    expect(quarantinedGradeInstrumentIds(log.disputes)).toHaveLength(1);
  });

  it('is one gesture and one event — a second tap writes nothing further', async () => {
    const vault = memoryVault();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        gradeContestPort: createVaultGradeContestPort(
          vault,
          'device-1',
          () => '2026-08-21T09:00:00+02:00',
        ),
      }),
    );
    await session.start();
    await session.mcqAnswer(0);
    await session.contestGrade();
    await session.contestGrade();

    const log = parseReviewLog(vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '');
    expect(log.disputes).toHaveLength(1);
  });

  it('does nothing outside the phase where a grade is on screen', async () => {
    const vault = memoryVault();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        gradeContestPort: createVaultGradeContestPort(
          vault,
          'device-1',
          () => '2026-08-21T09:00:00+02:00',
        ),
      }),
    );
    await session.start();
    await session.contestGrade();
    expect(vault.writes).toEqual([]);
  });
});

describe('[D-360]: contestGrade enqueues the queued regrading workflow', () => {
  it('hands the just-written dispute record to contestRegradeEnqueuer.enqueueOnDispute', async () => {
    const vault = memoryVault();
    const enqueuer = fakeContestRegradeEnqueuer();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        gradeContestPort: createVaultGradeContestPort(
          vault,
          'device-1',
          () => '2026-08-21T09:00:00+02:00',
        ),
        contestRegradeEnqueuer: enqueuer,
      }),
    );
    await session.start();
    await session.mcqAnswer(0);
    await session.contestGrade();

    const log = parseReviewLog(vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '');
    expect(enqueuer.calls).toHaveLength(1);
    // The SAME record the log carries — not a re-derived or partial copy.
    expect(enqueuer.calls[0]).toEqual(log.disputes[0]);
  });

  it('never enqueues twice for one gesture-and-event — the second tap already returns before reaching the enqueuer', async () => {
    const vault = memoryVault();
    const enqueuer = fakeContestRegradeEnqueuer();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        gradeContestPort: createVaultGradeContestPort(
          vault,
          'device-1',
          () => '2026-08-21T09:00:00+02:00',
        ),
        contestRegradeEnqueuer: enqueuer,
      }),
    );
    await session.start();
    await session.mcqAnswer(0);
    await session.contestGrade();
    await session.contestGrade();

    expect(enqueuer.calls).toHaveLength(1);
  });

  it('records the dispute normally with no contestRegradeEnqueuer wired at all — the enqueuer is optional and absent is not an error', async () => {
    const vault = memoryVault();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        gradeContestPort: createVaultGradeContestPort(
          vault,
          'device-1',
          () => '2026-08-21T09:00:00+02:00',
        ),
        // contestRegradeEnqueuer intentionally omitted.
      }),
    );
    await session.start();
    await session.mcqAnswer(0);
    await session.contestGrade();

    const vm = session.getViewModel();
    if (vm.phase !== 'mcq-answered') throw new Error('expected mcq-answered');
    expect(vm.contestBadge).toBe(CONTEST_QUARANTINE_BADGE);
  });

  it('never calls the enqueuer outside mcq-answered (no dispute was ever recorded to hand it)', async () => {
    const vault = memoryVault();
    const enqueuer = fakeContestRegradeEnqueuer();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        gradeContestPort: createVaultGradeContestPort(
          vault,
          'device-1',
          () => '2026-08-21T09:00:00+02:00',
        ),
        contestRegradeEnqueuer: enqueuer,
      }),
    );
    await session.start();
    await session.contestGrade();

    expect(enqueuer.calls).toEqual([]);
  });
});

/**
 * Row 48 (`ol-egov.141.89.9.74`): a quiz answer's contest names the review the
 * same answer writes. Real writers throughout (`createVaultGradeContestPort` and
 * `createVaultReviewLogPort` over one in-memory vault), because the claim is
 * that the id on the dispute is the id on the record, which only the two real
 * writers can show. Synthetic fixtures only (INV-3).
 */
describe('row 48: a contested quiz answer names the review it later writes', () => {
  const CONTESTED_AT = '2026-08-21T09:00:00+02:00';
  const REVIEWED_AT = new Date('2026-08-21T09:05:00+02:00');

  /** Every review-log record the vault holds, whichever day file it landed in. */
  function readLog(vault: MemoryVault) {
    const files = [...new Set(vault.writes)].map((path) =>
      parseReviewLog(vault.contentOf(path) ?? ''),
    );
    for (const file of files) expect(file.invalidLines).toEqual([]);
    return {
      records: files.flatMap((file) => file.records),
      disputes: files.flatMap((file) => file.disputes),
      reviews: files.flatMap((file) => file.records).filter((record) => record.kind === 'review'),
    };
  }

  function sessionOver(vault: MemoryVault, overrides: Partial<ReviewSessionDeps> = {}) {
    return new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        reviewLog: createVaultReviewLogPort(vault, 'device-1', () => REVIEWED_AT),
        gradeContestPort: createVaultGradeContestPort(vault, 'device-1', () => CONTESTED_AT),
        ...overrides,
      }),
    );
  }

  it('writes the dispute with the id of the review the same answer writes when she moves on', async () => {
    const vault = memoryVault();
    const enqueuer = fakeContestRegradeEnqueuer();
    const session = sessionOver(vault, { contestRegradeEnqueuer: enqueuer });
    await session.start();
    await session.mcqAnswer(1);
    await session.contestGrade();

    // At the moment of the contest the review does not exist, and the contest
    // did not write it: the id is named, the record is not written earlier.
    const atContest = readLog(vault);
    expect(atContest.reviews).toEqual([]);
    expect(atContest.disputes).toHaveLength(1);
    const namedId = atContest.disputes[0]?.reviewId;
    expect(namedId).toEqual(expect.any(String));
    expect(namedId).not.toBe('');

    await session.mcqNext();

    const afterNext = readLog(vault);
    expect(afterNext.reviews).toHaveLength(1);
    expect(afterNext.disputes).toHaveLength(1);
    const review = afterNext.reviews[0];
    if (review?.kind !== 'review') throw new Error('expected one review record');
    // The stable reference: the id the dispute named is the id the review carries.
    expect(review.eventId).toBe(namedId);
    expect(review.instrumentId).toBe(afterNext.disputes[0]?.instrumentId);
    // The regrade enqueue was handed the same dispute, naming the same review.
    expect(enqueuer.calls[0]?.reviewId).toBe(namedId);
  });

  it('writes the review with the content it would have had uncontested: only its id is decided sooner', async () => {
    const contestedVault = memoryVault();
    const contested = sessionOver(contestedVault);
    await contested.start();
    await contested.mcqAnswer(1);
    await contested.contestGrade();
    await contested.mcqNext();

    const plainVault = memoryVault();
    const plain = sessionOver(plainVault);
    await plain.start();
    await plain.mcqAnswer(1);
    await plain.mcqNext();

    const withContest = readLog(contestedVault).reviews[0];
    const without = readLog(plainVault).reviews[0];
    if (withContest?.kind !== 'review' || without?.kind !== 'review') {
      throw new Error('expected a review record in each vault');
    }
    const { eventId: contestedId, ...contestedRest } = withContest;
    const { eventId: plainId, ...plainRest } = without;
    expect(contestedRest).toEqual(plainRest);
    expect(contestedId).not.toBe(plainId);
  });

  it('keeps the same id when she toggles guessed after contesting: it is the one review of the one answer', async () => {
    const vault = memoryVault();
    const session = sessionOver(vault);
    await session.start();
    await session.mcqAnswer(1);
    await session.contestGrade();
    session.mcqToggleGuessed();
    await session.mcqNext();

    const log = readLog(vault);
    expect(log.reviews).toHaveLength(1);
    expect(log.reviews[0]?.eventId).toBe(log.disputes[0]?.reviewId);
  });

  it('names no review that was never written: a contest on an item she suspends stays unconfirmed, and is never re-pointed at a later review', async () => {
    const vault = memoryVault();
    const first = sessionOver(vault);
    await first.start();
    await first.mcqAnswer(1);
    await first.contestGrade();
    // She leaves the item without advancing past it: no review is written.
    await first.suspend();

    const abandoned = readLog(vault);
    expect(abandoned.reviews).toEqual([]);
    const namedId = abandoned.disputes[0]?.reviewId;
    expect(namedId).toEqual(expect.any(String));

    // A later sitting reviews the same instrument. That review is a different
    // record: the named id is not handed to it.
    const later = sessionOver(vault);
    await later.start();
    await later.mcqAnswer(0);
    await later.mcqNext();
    const laterLog = readLog(vault);
    expect(laterLog.reviews).toHaveLength(1);
    expect(laterLog.reviews[0]?.eventId).not.toBe(namedId);

    // A correction resolved for that dispute reads as unattributed: it excludes
    // no review, and is counted rather than guessed at.
    const opening = laterLog.disputes[0] as DisputeLogRecord;
    await createVaultGradeContestPort(
      vault,
      'device-1',
      () => '2026-08-22T09:00:00+02:00',
    ).resolveContestedGrade({ dispute: opening, outcome: 'corrected' });
    const after = readLog(vault);
    const validity = projectInstrumentValidity(after.records, after.disputes);
    expect(validity.correctedEvidence.size).toBe(0);
    expect(validity.unattributedCorrectionCount).toBe(1);
  });

  it('a correction on a confirmed name is tied to exactly the review that answer wrote', async () => {
    const vault = memoryVault();
    const session = sessionOver(vault);
    await session.start();
    await session.mcqAnswer(1);
    await session.contestGrade();
    await session.mcqNext();

    const log = readLog(vault);
    const opening = log.disputes[0] as DisputeLogRecord;
    await createVaultGradeContestPort(
      vault,
      'device-1',
      () => '2026-08-22T09:00:00+02:00',
    ).resolveContestedGrade({ dispute: opening, outcome: 'corrected' });
    const after = readLog(vault);
    const validity = projectInstrumentValidity(after.records, after.disputes);
    expect([...validity.correctedEvidence.keys()]).toEqual([opening.reviewId]);
    expect(validity.unattributedCorrectionCount).toBe(0);
  });

  it('retries a failed review write under the same id, so the dispute still names the record that lands', async () => {
    const calls: RecordReviewInput[] = [];
    let failNext = true;
    const reviewLog = {
      async recordReview(input: RecordReviewInput) {
        calls.push(input);
        if (failNext) {
          failNext = false;
          throw new Error('vault write failed');
        }
      },
    };
    const vault = memoryVault();
    const session = sessionOver(vault, { reviewLog });
    await session.start();
    await session.mcqAnswer(1);
    await session.contestGrade();
    await expect(session.mcqNext()).rejects.toThrow('vault write failed');
    await session.mcqNext();

    expect(calls).toHaveLength(2);
    const namedId = readLog(vault).disputes[0]?.reviewId;
    expect(calls[0]?.reviewEventId).toBe(namedId);
    expect(calls[1]?.reviewEventId).toBe(namedId);
  });

  it('hands the id to the item it was minted for only: the next item, contested or not, gets its own', async () => {
    const reviewLog = fakeReviewLog();
    const vault = memoryVault();
    const session = new ReviewSession(
      baseDeps({
        queue: [
          queueItem(mcqFixture({ instrumentId: 'inst-mcq-1' })),
          queueItem(mcqFixture({ instrumentId: 'inst-mcq-2' })),
          queueItem(mcqFixture({ instrumentId: 'inst-mcq-3' })),
        ],
        reviewLog,
        gradeContestPort: createVaultGradeContestPort(vault, 'device-1', () => CONTESTED_AT),
      }),
    );
    await session.start();
    // Item 1: contested, then advanced past.
    await session.mcqAnswer(1);
    await session.contestGrade();
    await session.mcqNext();
    // Item 2: contested, then suspended (never reviewed).
    await session.mcqAnswer(1);
    await session.contestGrade();
    await session.suspend();
    // Item 3: never contested.
    await session.mcqAnswer(1);
    await session.mcqNext();

    const disputes = readLog(vault).disputes;
    expect(disputes.map((dispute) => dispute.instrumentId)).toEqual(['inst-mcq-1', 'inst-mcq-2']);
    expect(reviewLog.calls).toHaveLength(2);
    expect(reviewLog.calls[0]?.instrument.instrumentId).toBe('inst-mcq-1');
    expect(reviewLog.calls[0]?.reviewEventId).toBe(disputes[0]?.reviewId);
    // The suspended item's id was not carried onto the uncontested item.
    expect(reviewLog.calls[1]?.instrument.instrumentId).toBe('inst-mcq-3');
    expect(Object.hasOwn(reviewLog.calls[1] as object, 'reviewEventId')).toBe(false);
    expect(disputes[0]?.reviewId).not.toBe(disputes[1]?.reviewId);
  });

  it('writes a review nobody contested exactly as before: no id named, for a quiz item and for a recall card', async () => {
    const reviewLog = fakeReviewLog();
    const vault = memoryVault();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture()), queueItem(qaFixture())],
        reviewLog,
        gradeContestPort: createVaultGradeContestPort(vault, 'device-1', () => CONTESTED_AT),
      }),
    );
    await session.start();
    await session.mcqAnswer(0);
    await session.mcqNext();
    session.reveal();
    await session.rate('good');

    expect(reviewLog.calls).toHaveLength(2);
    for (const call of reviewLog.calls) {
      expect(Object.hasOwn(call, 'reviewEventId')).toBe(false);
    }
    expect(readLog(vault).disputes).toEqual([]);
  });

  it('names the review it writes even when first-sight stamping gives the instrument a new id at the write', async () => {
    const reviewLog = fakeReviewLog();
    const vault = memoryVault();
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(mcqFixture())],
        reviewLog,
        gradeContestPort: createVaultGradeContestPort(vault, 'device-1', () => CONTESTED_AT),
        stampOnFirstSight: async () => ({ instrumentId: 'mcq-stamped-1' }),
      }),
    );
    await session.start();
    await session.mcqAnswer(1);
    await session.contestGrade();
    await session.mcqNext();

    expect(reviewLog.calls[0]?.instrument.instrumentId).toBe('mcq-stamped-1');
    expect(reviewLog.calls[0]?.reviewEventId).toBe(readLog(vault).disputes[0]?.reviewId);
  });
});
