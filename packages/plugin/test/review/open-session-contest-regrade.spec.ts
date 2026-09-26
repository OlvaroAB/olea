/**
 * `[D-360]` (`ol-egov.141.89.9.34`): `ReviewSessionPorts.contestRegradeEnqueuer` reaches the
 * session `openReviewSession` builds. `session-contest.spec.ts` already proves the session calls
 * the port the instant a grade dispute is durably recorded; this proves the open path threads it
 * through, so `main.ts` supplying the port is the only step left. Real vault, real contest port,
 * real walk: only the enqueuer is a recorder, because what it would enqueue is not this file's.
 */

import type { DisputeLogRecord } from 'olea-core';
import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
  parseReviewLog,
  reviewLogPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultGradeContestPort } from '../../src/review/contest.js';
import { openReviewSession, type ReviewSessionPorts } from '../../src/review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import type { ContestRegradeEnqueuePort } from '../../src/review/session.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const CONTESTED_AT = '2026-08-21T09:00:00+02:00';

function mcqVault() {
  return memoryVault({
    'Concepts/Alpha.md': [
      '---',
      'title: Alpha',
      'course: TEST101',
      '---',
      '',
      'A concept.',
      '',
    ].join('\n'),
    'Courses/TEST101/Week one.md': [
      '---',
      'topic: [Alpha]',
      'course: TEST101',
      '---',
      '## A question?',
      '',
      '```olea-mcq',
      'id: mcq-contest-1',
      'stem: Which structure is it?',
      'answer: The right one',
      'distractor: d1',
      'distractor: d2',
      'distractor: d3',
      'distractor: d4',
      'feedback: Because of the thing.',
      '```',
      '',
    ].join('\n'),
  });
}

function recordingEnqueuer(): ContestRegradeEnqueuePort & { readonly calls: DisputeLogRecord[] } {
  const calls: DisputeLogRecord[] = [];
  return {
    calls,
    async enqueueOnDispute(dispute) {
      calls.push(dispute);
    },
  };
}

async function openWith(
  vault: ReturnType<typeof mcqVault>,
  extra: Partial<ReviewSessionPorts>,
): ReturnType<typeof openReviewSession> {
  const enumeration = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const mcq = enumeration.records.find((record) => record.instrumentId === 'mcq-contest-1');
  if (mcq === undefined) throw new Error('expected the fixture to enumerate its MCQ');
  const holder = createStudySessionHolder();
  holder.enter(NOW, {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: 60,
      items: [
        {
          position: 1,
          instrumentId: mcq.instrumentId,
          instrumentType: mcq.instrumentType,
          notePath: mcq.notePath,
          noteTitle: mcq.noteTitle,
          conceptName: 'Alpha',
          course: 'TEST101',
          gapClass: 'coverage-gap',
          gapRank: 1,
          gapScore: 1,
          estimatedSeconds: 60,
          durationSource: 'assumed',
          formatMatch: 'no-preference',
        },
      ],
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: 1,
      formatPreference: 'unknown',
      nextAssessment: null,
      durationBasis: 'assumed',
      focusConcept: null,
    },
    overflow: [],
    courseShares: new Map(),
    forcedCourses: [],
    obligationClasses: new Map(),
    citationRecheckQueued: new Set(),
    citationRevalidationPending: new Set(),
  });
  return openReviewSession({
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: () => {
      throw new Error('the holder is pre-seeded active; the composer should not be reached');
    },
    ports: {
      reviewLog: createVaultReviewLogPort(vault, DEVICE),
      suspendPort: createVaultSuspendPort(vault, DEVICE),
      editPort: { async edit() {} },
      noteExists: createVaultNoteExistsPort(vault),
      clock: { now: () => NOW },
      draftAcceptPort: {
        accept() {
          throw new Error('no draft item in this suite');
        },
        reject() {
          throw new Error('no draft item in this suite');
        },
      },
      gradeContestPort: createVaultGradeContestPort(vault, DEVICE, () => CONTESTED_AT),
      ...extra,
    },
  });
}

describe('openReviewSession threads contestRegradeEnqueuer into the session it opens', () => {
  it('a contested MCQ grade in the opened session reaches the supplied enqueuer, with the logged dispute', async () => {
    const vault = mcqVault();
    const enqueuer = recordingEnqueuer();
    const outcome = await openWith(vault, { contestRegradeEnqueuer: enqueuer });
    if (!outcome.ok) throw new Error('expected a composed session');

    await outcome.session.start();
    await outcome.session.mcqAnswer(0);
    await outcome.session.contestGrade();

    const log = parseReviewLog(vault.contentOf(reviewLogPath('2026-08-21', DEVICE)) ?? '');
    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]).toEqual(log.disputes[0]);
  });
});
