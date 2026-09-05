/**
 * Fixture builders for the History ledger folds' tests.
 *
 * Hand-built entries at the current schema version, deliberately not routed
 * through `parseReviewLog` — these folds take already-parsed entries, and a
 * test that re-parses would be testing the parser. Every value here is
 * synthetic: no real vault path, note title or course code appears (INV-3).
 */

import type {
  DisputeLogRecord,
  MisconceptionObservedLogRecordV5,
  ReviewLogRecord,
  SuccessionLogRecordV5,
  SuspendLogRecordV5,
  VerdictLogRecord,
} from 'olea-contracts';

const selectionContext = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
} as const;

export function reviewAt(
  eventId: string,
  timestamp: string,
  instrumentId: string,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 4_000,
    selectionContext,
    ...overrides,
  } as ReviewLogRecord;
}

export function verdictAt(
  eventId: string,
  timestamp: string,
  instrumentId: string,
  verdict: VerdictLogRecord['verdict'],
): VerdictLogRecord {
  return {
    schemaVersion: 5,
    kind: 'verdict',
    eventId,
    timestamp,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict,
    artifactProvenance: { taskId: 'task-x', promptVersion: 'v1', modelId: 'model-x' },
  };
}

export function successionAt(
  eventId: string,
  timestamp: string,
  predecessorInstrumentId: string,
  successorInstrumentId: string,
): SuccessionLogRecordV5 {
  return {
    schemaVersion: 5,
    kind: 'succession',
    eventId,
    timestamp,
    predecessorInstrumentId,
    successorInstrumentId,
  };
}

export function suspendAt(
  eventId: string,
  timestamp: string,
  instrumentId: string,
): SuspendLogRecordV5 {
  return {
    schemaVersion: 5,
    kind: 'suspend',
    eventId,
    timestamp,
    instrumentId,
    conceptIds: ['concept-a'],
  };
}

export function disputeAt(
  eventId: string,
  timestamp: string,
  instrumentId: string,
): DisputeLogRecord {
  return {
    schemaVersion: 5,
    kind: 'dispute',
    eventId,
    timestamp,
    claimKind: 'reading',
    claimRendering: 'generated-explanation',
    conceptIds: ['concept-a'],
    instrumentId,
    evidenceBasis: 'synthetic-basis',
    effect: 'held',
  } as DisputeLogRecord;
}

export function misconceptionAt(
  eventId: string,
  timestamp: string,
  instrumentId: string,
  reviewEventId: string,
): MisconceptionObservedLogRecordV5 {
  return {
    schemaVersion: 5,
    kind: 'misconception-observed',
    eventId,
    timestamp,
    instrumentId,
    conceptIds: ['concept-a'],
    reviewEventId,
    misconceptionId: 'misconception-1',
    distractor: {
      text: 'synthetic-option',
      believes: 'synthetic-belief',
      source_says: 'synthetic-source',
    },
  } as MisconceptionObservedLogRecordV5;
}
