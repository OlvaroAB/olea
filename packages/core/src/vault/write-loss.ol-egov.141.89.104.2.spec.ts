/**
 * Local write loss inside one install (`ol-egov.141.89.104.2`): two overlapping whole-file
 * read-modify-writes on one path must both land, in the order they were issued.
 *
 * Every store under `.olea/` rewrites a whole file — a JSONL "append" reads the day's file and
 * writes it back with one more line. `OverlapVault` lets both writers read the old bytes before
 * either write lands, which is exactly the interleaving that discarded the first writer's change
 * before the per-path queue (`./path-queue.ts`). Each case below names the store and the
 * acceptance case it reproduces. Every id, course and concept here is invented.
 */

import { describe, expect, it } from 'vitest';
import { OverlapVault } from '../../test/support/overlap-vault.js';
import { appendEdgeDisposition, edgeDispositionLogPath } from '../concept/disposition.js';
import { buildConceptKeyCanonicalIndex } from '../concept/key-store.js';
import {
  confirmMergeAuditProposalRecord,
  declineMergeAuditProposalRecord,
  type MergeAuditProposalRecord,
  mergeAuditProposalRecordPath,
} from '../concept/merge-audit-store.js';
import {
  listRelationCacheRecords,
  propositionKey,
  writeRelationCache,
} from '../concept/relation-cache.js';
import {
  confirmSameAsLink,
  declineSameAsLink,
  proposeSameAsLink,
  type SameAsLinkRecord,
  sameAsLinkRecordPath,
} from '../concept/same-as.js';
import { unitRecord } from '../ingestion/unit-manifest/fixtures.js';
import { appendUnitManifestRecords, unitManifestLogPath } from '../ingestion/unit-manifest/log.js';
import { parseUnitManifestLog } from '../ingestion/unit-manifest/records.js';
import { attainmentArithmeticVersion } from '../mastery/attainment.js';
import { misconceptionLogPath } from '../misconception/path.js';
import type { MisconceptionEvent } from '../misconception/types.js';
import { appendMisconceptionEvent } from '../misconception/write.js';
import { discardPaperJournal, openPaperJournal } from '../oracle/paper-journal.js';
import { listPaperRecords, paperRecordPath, recordPaperResponse } from '../oracle/paper-store.js';
import {
  confirmOutcomeConceptNearMatch,
  declineOutcomeConceptNearMatch,
  outcomeConceptNearMatchRecordPath,
  proposeOutcomeConceptNearMatch,
} from '../outcome/near-match.js';
import {
  appendScopeReadingEvents,
  readScopeReadingLog,
  scopeReadingLogPath,
} from '../outcome/scope-reading-log.js';
import {
  attachConceptToOutcome,
  listOutcomeRecords,
  resolveOutcome,
  retireOutcome,
} from '../outcome/store.js';
import { parseReviewLog } from '../review-log/parse.js';
import { reviewLogPath } from '../review-log/path.js';
import { appendReviewLogRecord, type ReviewLogRecordInput } from '../review-log/write.js';
import { appendCompositionRecord, compositionLogPath } from '../study-session/composition-log.js';
import {
  type CompositionRecord,
  parseCompositionLog,
  parseCompositionRecord,
} from '../study-session/composition-record.js';
import { appendCourseCutoffRecord, courseCutoffLogPath } from '../today/course-cutoff-log.js';
import { buildCourseCutoffRecord, parseCourseCutoffLog } from '../today/course-cutoff-record.js';

const DEVICE = 'device-a';
const EMPTY_INDEX = buildConceptKeyCanonicalIndex([]);

function reviewInput(overrides: Partial<ReviewLogRecordInput> = {}): ReviewLogRecordInput {
  return {
    timestamp: '2026-08-10T09:05:00-04:00',
    instrumentId: 'qa:widget:1',
    instrumentType: 'qa',
    conceptIds: ['widget'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 4200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

function misconceptionEvent(eventId: string): MisconceptionEvent {
  return {
    schemaVersion: 1,
    kind: 'observed',
    eventId,
    timestamp: '2026-08-16T09:00:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: null,
    misconceptionId: `m-${eventId}`,
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes the widget always spins.',
    correction: 'The widget spins only when wound.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
  } as MisconceptionEvent;
}

function compositionRecord(compositionId: string): CompositionRecord {
  const parsed = parseCompositionRecord({
    schemaVersion: 1,
    kind: 'compose',
    compositionId,
    sessionId: compositionId,
    parentCompositionId: null,
    composedAt: '2026-09-27T09:00:00+02:00',
    asOf: '2026-09-27',
    reentry: false,
    focusPolicy: 'single',
    course: 'course-a',
    branch: 'deficit',
    groupingSignal: 'none',
    steering: { courses: null, conceptIds: null },
    budgetMinutes: 20,
    planVersion: null,
    policyVersions: {},
    planAllocation: [],
    declaredConstants: {
      urgencyOverrideThreshold: 0.07,
      withinBlockProximityHalfLifeDays: 7,
      materialArrivalCohortHalfLifeDays: 7,
    },
    chosen: [
      {
        instrumentId: 'i-1',
        conceptKey: 'k-1',
        obligationClass: null,
        formatMatch: 'no-preference',
        dedupeReason: null,
        rankedReason: null,
      },
    ],
    setAside: { courses: [], concepts: [], instruments: [] },
  });
  if (parsed === null) throw new Error('fixture is not a valid composition record');
  return parsed;
}

const PROVENANCE = { promptVersion: 'v1', modelVersion: 'model-a' };

describe('T10a: two overlapping appends to one day log, one install, one device id', () => {
  it('review log: both lines are kept, in issue order', async () => {
    const vault = new OverlapVault();
    const [first, second] = await Promise.all([
      appendReviewLogRecord(vault, reviewInput({ instrumentId: 'qa:widget:1' }), {
        deviceId: DEVICE,
      }),
      appendReviewLogRecord(vault, reviewInput({ instrumentId: 'qa:widget:2' }), {
        deviceId: DEVICE,
      }),
    ]);

    const path = reviewLogPath('2026-08-10', DEVICE);
    expect(first.path).toBe(path);
    expect(second.path).toBe(path);
    const { records, invalidLines } = parseReviewLog(vault.raw(path) ?? '');
    expect(invalidLines).toEqual([]);
    expect(records.map((record) => record.eventId)).toEqual([
      first.record.eventId,
      second.record.eventId,
    ]);
  });

  it('misconception log: both lines are kept', async () => {
    const vault = new OverlapVault();
    await Promise.all([
      appendMisconceptionEvent(vault, misconceptionEvent('e1'), DEVICE),
      appendMisconceptionEvent(vault, misconceptionEvent('e2'), DEVICE),
    ]);
    const lines = (vault.raw(misconceptionLogPath('2026-08-16', DEVICE)) ?? '')
      .split('\n')
      .filter((line) => line !== '');
    expect(lines.map((line) => (JSON.parse(line) as { eventId: string }).eventId)).toEqual([
      'e1',
      'e2',
    ]);
  });

  it('composition log: both lines are kept', async () => {
    const vault = new OverlapVault();
    await Promise.all([
      appendCompositionRecord(vault, compositionRecord('composition-key1:a'), DEVICE),
      appendCompositionRecord(vault, compositionRecord('composition-key1:b'), DEVICE),
    ]);
    const parsed = parseCompositionLog(vault.raw(compositionLogPath('2026-09-27', DEVICE)) ?? '');
    expect(parsed.records.map((record) => record.compositionId)).toEqual([
      'composition-key1:a',
      'composition-key1:b',
    ]);
  });

  it('course cutoff log: both lines are kept', async () => {
    const vault = new OverlapVault();
    const arithmeticVersion = attainmentArithmeticVersion({
      saplingRule: 'any-scored-success',
      withheldEvidence: 'count',
    });
    const cutoff = (courseId: string) =>
      buildCourseCutoffRecord({
        courseId,
        cutoff: { cutoffDay: '2026-06-12', source: 'provisional-last-passed-assessment' },
        arithmeticVersion,
        conceptIds: ['c1'],
      });
    await Promise.all([
      appendCourseCutoffRecord(vault, cutoff('OLDA'), DEVICE, '2026-09-27'),
      appendCourseCutoffRecord(vault, cutoff('OLDB'), DEVICE, '2026-09-27'),
    ]);
    const parsed = parseCourseCutoffLog(vault.raw(courseCutoffLogPath('2026-09-27', DEVICE)) ?? '');
    expect(parsed.records.map((record) => record.courseId)).toEqual(['OLDA', 'OLDB']);
  });

  it('unit manifest log: both lines are kept', async () => {
    const vault = new OverlapVault();
    await Promise.all([
      appendUnitManifestRecords(vault, [unitRecord({ clock: 1, page: 1 })]),
      appendUnitManifestRecords(vault, [unitRecord({ clock: 2, page: 2 })]),
    ]);
    const parsed = parseUnitManifestLog(
      vault.raw(unitManifestLogPath('2026-09-29', 'device-a')) ?? '',
    );
    expect(parsed.records.map((record) => record.clock)).toEqual([1, 2]);
  });

  it('scope-reading log: both events are kept, each with its own clock', async () => {
    const vault = new OverlapVault();
    await Promise.all([
      appendScopeReadingEvents(vault, 'document-state', DEVICE, [
        { kind: 'k', key: 'doc-1', payload: { n: 1 } },
      ]),
      appendScopeReadingEvents(vault, 'document-state', DEVICE, [
        { kind: 'k', key: 'doc-2', payload: { n: 2 } },
      ]),
    ]);
    const entries = await readScopeReadingLog(vault, 'document-state', { deviceId: DEVICE });
    expect(entries.map((entry) => [entry.key, entry.clock])).toEqual([
      ['doc-1', 1],
      ['doc-2', 2],
    ]);
    expect(vault.raw(scopeReadingLogPath('document-state', DEVICE))?.split('\n')).toHaveLength(3);
  });
});

describe('T10b: two overlapping disposition writes on one proposition, one install', () => {
  it('both events are kept, in issue order', async () => {
    const vault = new OverlapVault();
    const key = propositionKey('prerequisite', 'concept-key1:a', 'concept-key1:b');
    let tick = 0;
    const now = () => `2026-10-01T00:00:0${tick++}.000Z`;
    await Promise.all([
      appendEdgeDisposition(vault, key, 'accepted', { now }),
      appendEdgeDisposition(vault, key, 'declined', { now }),
    ]);
    const log = JSON.parse(vault.raw(edgeDispositionLogPath(key)) ?? '{}') as {
      events: { kind: string }[];
    };
    expect(log.events.map((event) => event.kind)).toEqual(['accepted', 'declined']);
  });
});

describe('T10c: a confirm and a decline on one same-as record, overlapping on one install', () => {
  async function proposed(vault: OverlapVault): Promise<void> {
    await proposeSameAsLink(vault, 'concept-key1:a', 'concept-key1:b', {
      canonicalKeys: EMPTY_INDEX,
      now: () => '2026-10-01T00:00:00.000Z',
    });
  }

  function stored(vault: OverlapVault): SameAsLinkRecord {
    return JSON.parse(
      vault.raw(sameAsLinkRecordPath('concept-key1:a', 'concept-key1:b')) ?? '{}',
    ) as SameAsLinkRecord;
  }

  it('decline then confirm: applied in issue order, and the confirm reads the declined copy', async () => {
    const vault = new OverlapVault();
    await proposed(vault);
    await Promise.all([
      declineSameAsLink(vault, 'concept-key1:a', 'concept-key1:b', {
        now: () => '2026-10-01T00:00:01.000Z',
      }),
      confirmSameAsLink(vault, 'concept-key1:a', 'concept-key1:b', {
        canonicalKeys: EMPTY_INDEX,
        now: () => '2026-10-01T00:00:02.000Z',
      }),
    ]);
    const record = stored(vault);
    expect(record.status).toBe('confirmed');
    // The decline's own fact survives: the confirm was computed from the declined record.
    expect(record.declinedAt).toBe('2026-10-01T00:00:01.000Z');
    expect(record.confirmedAt).toBe('2026-10-01T00:00:02.000Z');
  });

  it('confirm then decline: the decline meets the confirmed record and is refused, as it would be one after the other', async () => {
    const vault = new OverlapVault();
    await proposed(vault);
    const [confirm, decline] = await Promise.allSettled([
      confirmSameAsLink(vault, 'concept-key1:a', 'concept-key1:b', {
        canonicalKeys: EMPTY_INDEX,
        now: () => '2026-10-01T00:00:01.000Z',
      }),
      declineSameAsLink(vault, 'concept-key1:a', 'concept-key1:b', {
        now: () => '2026-10-01T00:00:02.000Z',
      }),
    ]);
    expect(confirm.status).toBe('fulfilled');
    expect(decline.status).toBe('rejected');
    const record = stored(vault);
    expect(record.status).toBe('confirmed');
    expect(record.declinedAt).toBeUndefined();
  });
});

describe('the other whole-file stores (H4, H5): overlapping writes on one record keep both', () => {
  it('outcome store: two concept attachments to one outcome both land', async () => {
    const vault = new OverlapVault();
    const outcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: { path: '02 Assignments/Objectives.md', blockIndex: 3 },
      label: 'Explain the widget',
      provenance: PROVENANCE,
    });
    await Promise.all([
      attachConceptToOutcome(vault, outcome.id, 'concept-key1:a', { canonicalKeys: EMPTY_INDEX }),
      attachConceptToOutcome(vault, outcome.id, 'concept-key1:b', { canonicalKeys: EMPTY_INDEX }),
    ]);
    const [stored] = await listOutcomeRecords(vault, { canonicalKeys: EMPTY_INDEX });
    expect(stored?.record.conceptKeys).toEqual(['concept-key1:a', 'concept-key1:b']);
  });

  it('outcome store: an attachment and a retirement overlapping both land', async () => {
    const vault = new OverlapVault();
    const outcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: { path: '02 Assignments/Objectives.md', blockIndex: 4 },
      label: 'Describe the gadget',
      provenance: PROVENANCE,
    });
    await Promise.all([
      attachConceptToOutcome(vault, outcome.id, 'concept-key1:a', { canonicalKeys: EMPTY_INDEX }),
      retireOutcome(vault, outcome.id),
    ]);
    const [stored] = await listOutcomeRecords(vault, { canonicalKeys: EMPTY_INDEX });
    expect(stored?.record.conceptKeys).toEqual(['concept-key1:a']);
    expect(stored?.record.status).toBe('retired');
  });

  it('near-match store: a confirm then a decline — the decline meets the confirmed record and is refused', async () => {
    const vault = new OverlapVault();
    await proposeOutcomeConceptNearMatch(vault, 'outcome-1', 'concept-key1:a', {
      canonicalKeys: EMPTY_INDEX,
    });
    const [confirm, decline] = await Promise.allSettled([
      confirmOutcomeConceptNearMatch(vault, 'outcome-1', 'concept-key1:a'),
      declineOutcomeConceptNearMatch(vault, 'outcome-1', 'concept-key1:a'),
    ]);
    expect(confirm.status).toBe('fulfilled');
    expect(decline.status).toBe('rejected');
    const record = JSON.parse(
      vault.raw(outcomeConceptNearMatchRecordPath('outcome-1', 'concept-key1:a')) ?? '{}',
    ) as { status: string };
    expect(record.status).toBe('confirmed');
  });

  it('merge-audit store: a confirm then a decline both apply, the decline on the confirmed copy', async () => {
    const record: MergeAuditProposalRecord = {
      key: 'concept-key1:a',
      wording: 'widget',
      anchorCourse: 'COURSEA',
      anchorPaths: [],
      misattributedCourses: [],
      status: 'proposed',
      proposedAt: '2026-10-01T00:00:00.000Z',
      schemaVersion: 1,
    };
    const vault = new OverlapVault({
      [mergeAuditProposalRecordPath('concept-key1:a')]: `${JSON.stringify(record, null, 2)}\n`,
    });
    await Promise.all([
      confirmMergeAuditProposalRecord(vault, 'concept-key1:a', {
        now: () => '2026-10-01T00:00:01.000Z',
      }),
      declineMergeAuditProposalRecord(vault, 'concept-key1:a', {
        now: () => '2026-10-01T00:00:02.000Z',
      }),
    ]);
    const stored = JSON.parse(
      vault.raw(mergeAuditProposalRecordPath('concept-key1:a')) ?? '{}',
    ) as MergeAuditProposalRecord;
    expect(stored.status).toBe('declined');
    expect(stored.confirmedAt).toBe('2026-10-01T00:00:01.000Z');
  });

  it('paper store: two responses to one paper both land', async () => {
    const paper = {
      id: 'paper1:a',
      course: 'COURSEA',
      generatedAt: '2026-10-01T00:00:00.000Z',
      asOf: '2026-10-01',
      compositionAccount: {},
      items: [{ slotId: 'slot-0' }, { slotId: 'slot-1' }],
      emptySlots: [],
      responses: [],
      handoffs: [],
      explanationResults: [],
      status: 'active',
      schemaVersion: 1,
    };
    const vault = new OverlapVault({
      [paperRecordPath(paper.id)]: `${JSON.stringify(paper, null, 2)}\n`,
    });
    await Promise.all([
      recordPaperResponse(vault, paper.id, 'slot-0', 'first answer'),
      recordPaperResponse(vault, paper.id, 'slot-1', 'second answer'),
    ]);
    const [stored] = await listPaperRecords(vault);
    expect(stored?.record.responses.map((response) => response.slotId)).toEqual([
      'slot-0',
      'slot-1',
    ]);
  });

  it('paper journal: a second discard folds onto the discarded copy, never over it', async () => {
    const vault = new OverlapVault();
    const opened = await openPaperJournal(vault, {
      course: 'COURSEA',
      fingerprint: {
        sourceVersions: 'src-1',
        scope: 'scope-1',
        structure: 'struct-1',
        authoringSpec: 'spec-1',
      },
      plan: [
        {
          slotId: 'slot-0',
          conceptKey: 'k0',
          conceptName: 'c0',
          taskId: 'quiz.generate.v1',
          dependsOnSlotIds: [],
        },
      ],
    });
    await Promise.all([
      discardPaperJournal(vault, opened.journal.id, { reason: 'abandoned' }),
      discardPaperJournal(vault, opened.journal.id, {
        reason: 'reuse-incompatible',
        changed: ['scope'],
      }),
    ]);
    const landed = vault.landed.filter((write) => write.path.includes('journals/'));
    // One open, one discard: the second discard met a journal already discarded and wrote nothing.
    expect(landed).toHaveLength(2);
  });

  it('relation cache: two overlapping patch writes of one proposition keep both attestations', async () => {
    const vault = new OverlapVault();
    const edge = (confidence: number, sourcePath: string) => ({
      from: 'Widget',
      to: 'Gadget',
      type: 'prerequisite' as const,
      provenance: 'model-proposed' as const,
      confidence,
      introducingPassages: {
        from: { sourcePath, location: { blockIndex: 0 } },
        to: { sourcePath, location: { blockIndex: 1 } },
      },
      fromKey: 'concept-key1:a',
      toKey: 'concept-key1:b',
    });
    await Promise.all([
      writeRelationCache(vault, [edge(0.9, 'Notes/one.md')] as never, {
        canonicalKeys: EMPTY_INDEX,
      }),
      writeRelationCache(vault, [edge(0.8, 'Notes/two.md')] as never, {
        canonicalKeys: EMPTY_INDEX,
      }),
    ]);
    const [record] = await listRelationCacheRecords(vault);
    expect(record?.record.attestations.map((a) => a.introducingPassages.from.sourcePath)).toEqual([
      'Notes/one.md',
      'Notes/two.md',
    ]);
  });
});

describe('T11: two legitimate identical actions stay two events (regression)', () => {
  it('two identical reviews appended one after the other are two events with distinct ids', async () => {
    const vault = new OverlapVault();
    const first = await appendReviewLogRecord(vault, reviewInput(), { deviceId: DEVICE });
    const second = await appendReviewLogRecord(vault, reviewInput(), { deviceId: DEVICE });
    expect(first.record.eventId).not.toBe(second.record.eventId);
    const { records } = parseReviewLog(vault.raw(first.path) ?? '');
    expect(records).toHaveLength(2);
  });

  it('two identical reviews appended together are also two events', async () => {
    const vault = new OverlapVault();
    const results = await Promise.all([
      appendReviewLogRecord(vault, reviewInput(), { deviceId: DEVICE }),
      appendReviewLogRecord(vault, reviewInput(), { deviceId: DEVICE }),
    ]);
    const { records } = parseReviewLog(vault.raw(results[0].path) ?? '');
    expect(new Set(records.map((record) => record.eventId)).size).toBe(2);
  });
});

describe('INV-2: an append on a path without a race keeps every earlier byte', () => {
  it('the review log keeps a torn trailing line and CRLF lines verbatim, then adds its own', async () => {
    const path = reviewLogPath('2026-08-10', DEVICE);
    const before = '{"not":"a record"}\r\n{"torn":';
    const vault = new OverlapVault({ [path]: before });
    await appendReviewLogRecord(vault, reviewInput(), { deviceId: DEVICE });
    const after = vault.raw(path) ?? '';
    expect(after.startsWith(`${before}\n`)).toBe(true);
    expect(after.split('\n')).toHaveLength(4);
  });

  it('a disposition that repeats the current kind writes nothing', async () => {
    const key = propositionKey('prerequisite', 'concept-key1:a', 'concept-key1:b');
    const vault = new OverlapVault();
    await appendEdgeDisposition(vault, key, 'declined', { now: () => '2026-10-01T00:00:00Z' });
    const bytes = vault.raw(edgeDispositionLogPath(key));
    await appendEdgeDisposition(vault, key, 'declined', { now: () => '2026-10-02T00:00:00Z' });
    expect(vault.raw(edgeDispositionLogPath(key))).toBe(bytes);
    expect(vault.landed).toHaveLength(1);
  });
});
