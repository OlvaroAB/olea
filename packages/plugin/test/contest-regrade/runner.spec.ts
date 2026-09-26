/**
 * `createContestRegradeJobRunner` — the drain half of `[D-360]`'s queued
 * regrading workflow. The load-bearing test in this file is the first one:
 * proof that no paid call is reachable while activation is off.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { DisputeLogRecord, JobRunnerView } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type ContestRegradeJudge,
  createContestRegradeJobRunner,
} from '../../src/contest-regrade/runner.js';
import {
  CONTEST_REGRADE_JOB_KIND,
  type ContestRegradeJobPayload,
} from '../../src/contest-regrade/types.js';
import type { GradeContestPort } from '../../src/review/contest.js';

// Synthetic fixtures only (INV-3).
const PAYLOAD: ContestRegradeJobPayload = {
  kind: CONTEST_REGRADE_JOB_KIND,
  disputeEventId: 'dispute-1',
  instrumentId: 'instrument-1',
  originalGradeEventId: 'eb-1',
  conceptIds: ['concept-a'],
};

const JOB: JobRunnerView = {
  contentHash: 'hash-1',
  label: 'Regrade dispute · instrument-1',
  payload: PAYLOAD,
  attempts: 0,
};

function fakePort(): GradeContestPort {
  return {
    contestGrade: vi.fn(),
    resolveContestedGrade: vi.fn(),
  };
}

describe('createContestRegradeJobRunner — activation OFF ([D-360]: paid activation stays off)', () => {
  it('returns a deferred, non-throwing outcome without calling the judge, the port, loadDispute or loadRecords', async () => {
    const judge: ContestRegradeJudge = { regrade: vi.fn() };
    const port = fakePort();
    const loadDispute = vi.fn();
    const loadRecords = vi.fn();
    const appendCorrectiveRegrade = vi.fn();

    const runner = createContestRegradeJobRunner({
      activation: { enabled: false },
      judge,
      port,
      loadDispute,
      loadRecords,
      appendCorrectiveRegrade,
    });

    const outcome = await runner(JOB);

    expect(outcome).toEqual({ ok: false, retryable: true });
    expect(judge.regrade).not.toHaveBeenCalled();
    expect(port.contestGrade).not.toHaveBeenCalled();
    expect(port.resolveContestedGrade).not.toHaveBeenCalled();
    expect(loadDispute).not.toHaveBeenCalled();
    expect(loadRecords).not.toHaveBeenCalled();
    expect(appendCorrectiveRegrade).not.toHaveBeenCalled();
  });

  it('makes zero network calls while off, even for a job payload the runner would otherwise reject as malformed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch must never be called while activation is off');
    });
    try {
      const runner = createContestRegradeJobRunner({
        activation: { enabled: false },
        port: fakePort(),
        loadDispute: vi.fn(),
        loadRecords: vi.fn(),
        appendCorrectiveRegrade: vi.fn(),
      });

      const malformedJob: JobRunnerView = { ...JOB, payload: { not: 'a contest-regrade payload' } };
      const outcome = await runner(malformedJob);

      expect(outcome).toEqual({ ok: false, retryable: true });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('still returns the same deferred outcome across repeated ticks — never escalates to failed on its own while off', async () => {
    const runner = createContestRegradeJobRunner({
      activation: { enabled: false },
      port: fakePort(),
      loadDispute: vi.fn(),
      loadRecords: vi.fn(),
      appendCorrectiveRegrade: vi.fn(),
    });

    for (let i = 0; i < 5; i++) {
      expect(await runner(JOB)).toEqual({ ok: false, retryable: true });
    }
  });
});

describe('createContestRegradeJobRunner — activation ON, no judge wired yet', () => {
  it('defers rather than throwing when activation is on but no real judge is supplied', async () => {
    const port = fakePort();
    const loadDispute = vi.fn();
    const runner = createContestRegradeJobRunner({
      activation: { enabled: true },
      port,
      loadDispute,
      loadRecords: vi.fn(),
      appendCorrectiveRegrade: vi.fn(),
    });

    const outcome = await runner(JOB);

    expect(outcome).toEqual({ ok: false, retryable: true });
    expect(loadDispute).not.toHaveBeenCalled();
    expect(port.resolveContestedGrade).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload as non-retryable, without calling the judge', async () => {
    const judge: ContestRegradeJudge = { regrade: vi.fn() };
    const runner = createContestRegradeJobRunner({
      activation: { enabled: true },
      judge,
      port: fakePort(),
      loadDispute: vi.fn(),
      loadRecords: vi.fn(),
      appendCorrectiveRegrade: vi.fn(),
    });

    const malformedJob: JobRunnerView = { ...JOB, payload: {} };
    const outcome = await runner(malformedJob);

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: 'contest-regrade job payload is malformed',
    });
    expect(judge.regrade).not.toHaveBeenCalled();
  });
});

describe('createContestRegradeJobRunner — activation ON, judge wired', () => {
  const DISPUTE: DisputeLogRecord = {
    schemaVersion: 5,
    kind: 'dispute',
    eventId: 'dispute-1',
    timestamp: '2026-08-21T09:00:00+02:00',
    claimKind: 'grade',
    claimRendering: 'explain-back-grade',
    conceptIds: ['concept-a'],
    instrumentId: 'instrument-1',
    evidenceBasis: 'mcq|instrument-1|2|false',
    effect: 'quarantined',
  };

  it('calls the judge with the frozen payload, then resolveContestedGradeAndRegrade via the injected port and appendCorrectiveRegrade, on a corrected outcome', async () => {
    const judge: ContestRegradeJudge = {
      regrade: vi.fn().mockResolvedValue({ outcome: 'corrected' }),
    };
    const resolution: DisputeLogRecord = {
      ...DISPUTE,
      resolves: DISPUTE.eventId,
      outcome: 'corrected',
    };
    const port: GradeContestPort = {
      contestGrade: vi.fn(),
      resolveContestedGrade: vi.fn().mockResolvedValue(resolution),
    };
    const records: readonly ReviewLogEntry[] = [];
    const loadDispute = vi.fn().mockResolvedValue(DISPUTE);
    const loadRecords = vi.fn().mockResolvedValue(records);
    const appendCorrectiveRegrade = vi.fn().mockResolvedValue(undefined);

    const runner = createContestRegradeJobRunner({
      activation: { enabled: true },
      judge,
      port,
      loadDispute,
      loadRecords,
      appendCorrectiveRegrade,
    });

    const outcome = await runner(JOB);

    expect(judge.regrade).toHaveBeenCalledWith(PAYLOAD);
    expect(loadDispute).toHaveBeenCalledWith('dispute-1');
    expect(port.resolveContestedGrade).toHaveBeenCalledWith({
      dispute: DISPUTE,
      outcome: 'corrected',
    });
    // No standing grade in `records` above — `originalGradeEventIdFor` finds
    // none, so `resolveContestedGradeAndRegrade` itself never calls
    // `appendCorrectiveRegrade` (see `../../src/review/contest.js`'s own
    // "no standing grade to revise" case). This is `resolveContestedGrade
    // AndRegrade`'s existing, already-tested behaviour — reused unchanged,
    // never re-implemented here.
    expect(appendCorrectiveRegrade).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true });
  });

  it('appends the corrective re-grade, naming the standing grade event as revisionOf, when one exists (D-360 criterion 5)', async () => {
    const judge: ContestRegradeJudge = {
      regrade: vi.fn().mockResolvedValue({ outcome: 'corrected' }),
    };
    const resolution: DisputeLogRecord = {
      ...DISPUTE,
      resolves: DISPUTE.eventId,
      outcome: 'corrected',
    };
    const port: GradeContestPort = {
      contestGrade: vi.fn(),
      resolveContestedGrade: vi.fn().mockResolvedValue(resolution),
    };
    const standingGrade = {
      schemaVersion: 5,
      kind: 'review',
      eventId: 'eb-1',
      timestamp: '2026-08-20T09:00:00+02:00',
      instrumentId: 'instrument-1',
      instrumentType: 'explain-back',
      conceptIds: ['concept-a'],
      rating: null,
      wasUnsure: false,
      durationMs: 4000,
      selectionContext: {
        dueState: 'new',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['explain-back'],
        planVersion: null,
      },
      explainBackGrade: {
        soloLevel: 'relational',
        correctness: 'incorrect',
        contentRef: 'content-ref-1',
        revisionOf: null,
        artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
      },
    } as unknown as ReviewLogEntry;
    const appendCorrectiveRegrade = vi.fn().mockResolvedValue(undefined);

    const runner = createContestRegradeJobRunner({
      activation: { enabled: true },
      judge,
      port,
      loadDispute: vi.fn().mockResolvedValue(DISPUTE),
      loadRecords: vi.fn().mockResolvedValue([standingGrade]),
      appendCorrectiveRegrade,
    });

    const outcome = await runner(JOB);

    expect(appendCorrectiveRegrade).toHaveBeenCalledWith('eb-1');
    expect(outcome).toEqual({ ok: true });
  });

  it('reports the dispute record missing as a non-retryable failure, without calling the judge', async () => {
    const judge: ContestRegradeJudge = { regrade: vi.fn() };
    const runner = createContestRegradeJobRunner({
      activation: { enabled: true },
      judge,
      port: fakePort(),
      loadDispute: vi.fn().mockResolvedValue(null),
      loadRecords: vi.fn(),
      appendCorrectiveRegrade: vi.fn(),
    });

    const outcome = await runner(JOB);

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: 'contest-regrade: dispute record not found',
    });
    expect(judge.regrade).not.toHaveBeenCalled();
  });
});
