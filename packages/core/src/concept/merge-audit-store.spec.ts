import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import type { ConceptKeyRecord, TopicAnchor } from './key-store.js';
import {
  confirmMergeAuditProposalRecord,
  confirmMergeRepairProposalRecord,
  declineMergeAuditProposalRecord,
  declineMergeRepairProposalRecord,
  isMergeAuditProposalRecord,
  listMergeAuditProposalRecords,
  listMergeRepairProposalRecords,
  proposeAndPersistMergeAudits,
  proposeAndPersistMergeRepair,
} from './merge-audit-store.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "[D-402] binding condition 3, the
// old cross-course merge audit's wiring into F8.4a" (`ol-egov.141.89.3.19`), tagged
// `@auto:core/concept/merge-audit-store.spec`.
//
// Synthetic fixtures only — no real vault content, no real course codes (INV-3). Course codes
// below ("COURSEA"/"COURSEB") match `./merge-audit.spec.ts`'s own convention.

function topicAnchor(overrides: Partial<TopicAnchor> = {}): TopicAnchor {
  return { kind: 'topic', course: 'COURSEA', name: 'shared wording', aliases: [], ...overrides };
}

function keyRecord(overrides: Partial<ConceptKeyRecord> = {}): ConceptKeyRecord {
  return {
    key: 'concept-key1:aaaa',
    tier: 2,
    anchor: topicAnchor(),
    mintedAt: '2026-09-01',
    schemaVersion: 1,
    ...overrides,
  };
}

/** One old-merge-shaped record: a topic anchored to COURSEA whose introducing paths also carry
 * COURSEB evidence — the exact shape `./merge-audit.ts`'s `findMergeAuditFindings` looks for. */
function crossCourseRecord(overrides: Partial<ConceptKeyRecord> = {}): ConceptKeyRecord {
  return keyRecord({
    anchor: topicAnchor({
      introducingPaths: [
        '01 Courses/COURSEA/Week 1/Lecture.md',
        '01 Courses/COURSEB/Week 3/Lecture.md',
      ],
    }),
    ...overrides,
  });
}

describe('proposeAndPersistMergeAudits ([D-402] binding condition 3, ol-egov.141.89.3.19)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-merge-audit-store-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes exactly one proposed record per finding, surviving a fresh listing (persists and survives a restart)', async () => {
    const record = crossCourseRecord();
    const written = await proposeAndPersistMergeAudits(source, [{ record }], {
      now: () => '2026-09-27T00:00:00.000Z',
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      key: record.key,
      wording: 'shared wording',
      anchorCourse: 'COURSEA',
      status: 'proposed',
      anchorPaths: ['01 Courses/COURSEA/Week 1/Lecture.md'],
      misattributedCourses: [
        { course: 'COURSEB', paths: ['01 Courses/COURSEB/Week 3/Lecture.md'] },
      ],
    });

    // A fresh listing (simulating a restart) sees the same record.
    const listed = await listMergeAuditProposalRecords(source);
    expect(listed).toHaveLength(1);
    expect(isMergeAuditProposalRecord(listed[0]?.record)).toBe(true);
    expect(listed[0]?.record.status).toBe('proposed');
  });

  it('proposes nothing for a record with no cross-course evidence', async () => {
    const written = await proposeAndPersistMergeAudits(source, [{ record: keyRecord() }]);
    expect(written).toHaveLength(0);
    expect(await listMergeAuditProposalRecords(source)).toHaveLength(0);
  });

  it('never re-proposes or overwrites an existing decision — a second audit pass over the same vault writes nothing new', async () => {
    const record = crossCourseRecord();
    await proposeAndPersistMergeAudits(source, [{ record }], { now: () => '2026-09-27' });
    await confirmMergeAuditProposalRecord(source, record.key, { now: () => '2026-09-28' });

    const second = await proposeAndPersistMergeAudits(source, [{ record }], {
      now: () => '2026-09-29',
    });
    expect(second[0]?.status).toBe('confirmed');
    const listed = await listMergeAuditProposalRecords(source);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.record.status).toBe('confirmed');
    expect(listed[0]?.record.confirmedAt).toBe('2026-09-28');
  });
});

describe('confirmMergeAuditProposalRecord / declineMergeAuditProposalRecord', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-merge-audit-store-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('confirm reuses the F8.4a accept action, idempotently, and reachable from declined', async () => {
    const record = crossCourseRecord();
    await proposeAndPersistMergeAudits(source, [{ record }]);

    const confirmed = await confirmMergeAuditProposalRecord(source, record.key, {
      now: () => '2026-09-27T01:00:00.000Z',
    });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedAt).toBe('2026-09-27T01:00:00.000Z');

    // Idempotent: confirming an already-confirmed record writes nothing new.
    const again = await confirmMergeAuditProposalRecord(source, record.key, {
      now: () => '2026-09-27T02:00:00.000Z',
    });
    expect(again).toEqual(confirmed);
  });

  it('decline reuses the F8.4a decline action — a hard labelled negative, not an executed repair', async () => {
    const record = crossCourseRecord();
    await proposeAndPersistMergeAudits(source, [{ record }]);

    const declined = await declineMergeAuditProposalRecord(source, record.key, {
      now: () => '2026-09-27T03:00:00.000Z',
    });
    expect(declined.status).toBe('declined');
    expect(declined.declinedAt).toBe('2026-09-27T03:00:00.000Z');

    const again = await declineMergeAuditProposalRecord(source, record.key);
    expect(again).toEqual(declined);
  });

  it('throws on a key with no persisted proposal — never mints one on its own', async () => {
    await expect(confirmMergeAuditProposalRecord(source, 'no-such-key')).rejects.toThrow();
    await expect(declineMergeAuditProposalRecord(source, 'no-such-key')).rejects.toThrow();
  });
});

describe('proposeAndPersistMergeRepair ([D-402] binding condition 3 — "no repair is applied without her confirmation")', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-merge-audit-store-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses a repair proposal before the audit proposal is declined', async () => {
    const record = crossCourseRecord();
    await proposeAndPersistMergeAudits(source, [{ record }]);

    const outcome = await proposeAndPersistMergeRepair(source, record.key);
    expect(outcome.kind).toBe('not-declined');
    expect(await listMergeRepairProposalRecords(source)).toHaveLength(0);
  });

  it('produces exactly one repair proposal after a known-mistake decline, and never applies it', async () => {
    const record = crossCourseRecord();
    await proposeAndPersistMergeAudits(source, [{ record }], { now: () => '2026-09-27' });
    await declineMergeAuditProposalRecord(source, record.key, { now: () => '2026-09-28' });

    const outcome = await proposeAndPersistMergeRepair(source, record.key, {
      records: [{ record }],
      sameAsLinks: [],
      now: () => '2026-09-29T00:00:00.000Z',
    });
    expect(outcome.kind).toBe('repair-proposal');
    if (outcome.kind !== 'repair-proposal') throw new Error('unreachable');
    expect(outcome.proposal).toMatchObject({
      key: record.key,
      course: 'COURSEB',
      paths: ['01 Courses/COURSEB/Week 3/Lecture.md'],
      status: 'proposed',
    });

    // Nothing is ever applied by confirming it — only a status and a timestamp change.
    const confirmed = await confirmMergeRepairProposalRecord(source, record.key, {
      now: () => '2026-09-30T00:00:00.000Z',
    });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.paths).toEqual(['01 Courses/COURSEB/Week 3/Lecture.md']);
    // The vault's own course notes are untouched — this module moves nothing.
    expect(await source.exists('01 Courses/COURSEB/Week 3/Lecture.md')).toBe(false);
  });

  it('is idempotent — calling twice after a decline writes only one repair record', async () => {
    const record = crossCourseRecord();
    await proposeAndPersistMergeAudits(source, [{ record }]);
    await declineMergeAuditProposalRecord(source, record.key);

    await proposeAndPersistMergeRepair(source, record.key, { records: [{ record }] });
    await proposeAndPersistMergeRepair(source, record.key, { records: [{ record }] });

    expect(await listMergeRepairProposalRecords(source)).toHaveLength(1);
  });

  it('escalates to needs-decision, and writes nothing, when more than one course is entangled', async () => {
    const record = keyRecord({
      anchor: topicAnchor({
        introducingPaths: [
          '01 Courses/COURSEA/Week 1/Lecture.md',
          '01 Courses/COURSEB/Week 3/Lecture.md',
          '01 Courses/COURSEC/Week 2/Lecture.md',
        ],
      }),
    });
    await proposeAndPersistMergeAudits(source, [{ record }]);
    await declineMergeAuditProposalRecord(source, record.key);

    const outcome = await proposeAndPersistMergeRepair(source, record.key, {
      records: [{ record }],
    });
    expect(outcome.kind).toBe('needs-decision');
    expect(await listMergeRepairProposalRecords(source)).toHaveLength(0);
  });

  it('decline reuses the F8.4a decline action for the repair proposal too', async () => {
    const record = crossCourseRecord();
    await proposeAndPersistMergeAudits(source, [{ record }]);
    await declineMergeAuditProposalRecord(source, record.key);
    await proposeAndPersistMergeRepair(source, record.key, { records: [{ record }] });

    const declined = await declineMergeRepairProposalRecord(source, record.key, {
      now: () => '2026-10-01T00:00:00.000Z',
    });
    expect(declined.status).toBe('declined');
    expect(declined.declinedAt).toBe('2026-10-01T00:00:00.000Z');
  });
});
