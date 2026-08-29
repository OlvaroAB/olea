/**
 * The contest gesture where the review session asserts a grade (`ol-fgba`
 * [DISP-1]; `[D-046]` clause 4, mechanised by `[D-095]`).
 *
 * An MCQ result IS an instrument grade — `[D-095]`'s third kind names "an
 * explain-back verdict, an instrument grade" — so principle 12's fourth part
 * binds on it. These are the state-machine half; the rendered half is
 * `view.ts`, which has no Vitest runtime (its module doc).
 */
import { parseReviewLog, quarantinedGradeInstrumentIds, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultGradeContestPort } from '../../src/review/contest.js';
import { CONTEST_GESTURE_LABEL, CONTEST_QUARANTINE_BADGE } from '../../src/review/copy.js';
import { ReviewSession, type ReviewSessionDeps } from '../../src/review/session.js';
import {
  fakeDraftAcceptPort,
  fakeEditPort,
  fakeNoteExists,
  fakeReviewLog,
  fakeScheduler,
  fakeSuspendPort,
  fixedClock,
  mcqFixture,
  queueItem,
} from './fixtures.js';
import { memoryVault } from './memory-vault.js';

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
