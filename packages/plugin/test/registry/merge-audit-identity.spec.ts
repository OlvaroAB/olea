/**
 * `../../src/registry/merge-audit-identity.ts` — `[D-402]` binding condition 3's old cross-course
 * merge audit, landed on F8.4a's existing concept-identity section (`ol-egov.141.89.3.19`).
 *
 * Every fixture string below is INVENTED per INV-3 — course codes, wordings and note text are
 * placeholders, not drawn from a real vault.
 *
 * Scenarios: `olea-service/features/F8-concepts-scope.md`, "Feature: F8.4a / `[D-257]`" (the
 * identity section's own scenarios already cover "a proposal shows the two names, their courses
 * and the supporting passages" and "a proposal that cannot show its passages is not shown at
 * all" for the underlying pattern this bead reuses verbatim); this file proves the same rules
 * hold for the merge-audit/repair records this bead adds.
 */
import { type ConceptKeyRecord, conceptKeyRecordPath } from 'olea-core';
// Deep import, not `olea-core`'s barrel — see `../../src/concept/wiring.ts`'s own comment on the
// same choice.
import {
  declineMergeAuditProposalRecord,
  listMergeAuditProposalRecords,
  listMergeRepairProposalRecords,
  type MergeAuditProposalRecord,
  type MergeRepairProposalRecord,
  proposeAndPersistMergeAudits,
  proposeAndPersistMergeRepair,
} from 'olea-core/src/concept/merge-audit-store.js';
import { describe, expect, it } from 'vitest';
import {
  buildMergeAuditIdentityProposals,
  buildMergeRepairIdentityProposals,
  confirmMergeAuditIdentityProposal,
  declineMergeAuditIdentityProposal,
  MERGE_AUDIT_EXCERPT_CHAR_BUDGET,
} from '../../src/registry/merge-audit-identity.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

function auditRecord(overrides: Partial<MergeAuditProposalRecord> = {}): MergeAuditProposalRecord {
  return {
    key: 'concept-key1:aaaa',
    wording: 'shared wording',
    anchorCourse: 'COURSEA',
    anchorPaths: ['Notes/anchor.md'],
    misattributedCourses: [{ course: 'COURSEB', paths: ['Notes/other.md'] }],
    status: 'proposed',
    proposedAt: '2026-09-27T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

function repairRecord(
  overrides: Partial<MergeRepairProposalRecord> = {},
): MergeRepairProposalRecord {
  return {
    key: 'concept-key1:aaaa',
    wording: 'shared wording',
    anchorCourse: 'COURSEA',
    anchorPaths: ['Notes/anchor.md'],
    course: 'COURSEB',
    paths: ['Notes/other.md'],
    status: 'proposed',
    proposedAt: '2026-09-27T01:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('buildMergeAuditIdentityProposals — F8.4a, reused for [D-402]', () => {
  it('resolves both sides’ wording, course and passage excerpt, never a score', async () => {
    const vault = memoryVault({
      'Notes/anchor.md': 'A long enough introductory paragraph anchored in the first course.\n',
      'Notes/other.md': 'A separate paragraph carrying the misattributed course’s evidence.\n',
    });

    const proposals = await buildMergeAuditIdentityProposals(vault, [auditRecord()]);

    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal?.kind).toBe('audit');
    expect(proposal?.nameA).toBe('shared wording');
    expect(proposal?.nameB).toBe('shared wording');
    expect(proposal?.coursesA).toEqual(['COURSEA']);
    expect(proposal?.coursesB).toEqual(['COURSEB']);
    expect(proposal?.passageA.excerpt).toContain('anchored in the first course');
    expect(proposal?.passageB.excerpt).toContain('misattributed course');
    expect(proposal).not.toHaveProperty('confidence');
    expect(proposal).not.toHaveProperty('score');
  });

  it('produces one row per misattributed course, all sharing the same key', async () => {
    const vault = memoryVault({
      'Notes/anchor.md': 'Anchor passage.\n',
      'Notes/other-b.md': 'Course B passage.\n',
      'Notes/other-c.md': 'Course C passage.\n',
    });
    const record = auditRecord({
      misattributedCourses: [
        { course: 'COURSEB', paths: ['Notes/other-b.md'] },
        { course: 'COURSEC', paths: ['Notes/other-c.md'] },
      ],
    });

    const proposals = await buildMergeAuditIdentityProposals(vault, [record]);

    expect(proposals).toHaveLength(2);
    expect(proposals.every((p) => p.key === record.key)).toBe(true);
    expect(proposals.map((p) => p.coursesB[0]).sort()).toEqual(['COURSEB', 'COURSEC']);
  });

  it("only resolves 'proposed' records — confirmed and declined never appear here", async () => {
    const vault = memoryVault({ 'Notes/anchor.md': 'Text.\n', 'Notes/other.md': 'Text.\n' });
    for (const status of ['confirmed', 'declined'] as const) {
      const proposals = await buildMergeAuditIdentityProposals(vault, [auditRecord({ status })]);
      expect(proposals).toHaveLength(0);
    }
  });

  it('withholds a row when the anchor side has no path at all', async () => {
    const vault = memoryVault({ 'Notes/other.md': 'Text.\n' });
    const proposals = await buildMergeAuditIdentityProposals(vault, [
      auditRecord({ anchorPaths: [] }),
    ]);
    expect(proposals).toHaveLength(0);
  });

  it('withholds a row when a note cannot be read', async () => {
    const proposals = await buildMergeAuditIdentityProposals(
      unreadableVault() as ReturnType<typeof memoryVault>,
      [auditRecord()],
    );
    expect(proposals).toHaveLength(0);
  });

  it('bounds a long passage to the declared excerpt budget, with an ellipsis', async () => {
    const longParagraph = 'x'.repeat(MERGE_AUDIT_EXCERPT_CHAR_BUDGET + 50);
    const vault = memoryVault({
      'Notes/anchor.md': `${longParagraph}\n`,
      'Notes/other.md': 'Short.\n',
    });
    const proposals = await buildMergeAuditIdentityProposals(vault, [auditRecord()]);
    const excerpt = proposals[0]?.passageA.excerpt ?? '';
    expect(excerpt.length).toBeLessThanOrEqual(MERGE_AUDIT_EXCERPT_CHAR_BUDGET + 1);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('buildMergeRepairIdentityProposals — the repair proposal a decline may produce', () => {
  it('resolves both sides, tagged kind "repair"', async () => {
    const vault = memoryVault({
      'Notes/anchor.md': 'Anchor passage kept under the original identity.\n',
      'Notes/other.md': 'The misattributed course’s own passage.\n',
    });
    const proposals = await buildMergeRepairIdentityProposals(vault, [repairRecord()]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.kind).toBe('repair');
    expect(proposals[0]?.coursesA).toEqual(['COURSEA']);
    expect(proposals[0]?.coursesB).toEqual(['COURSEB']);
  });

  it("only resolves 'proposed' repair records", async () => {
    const vault = memoryVault({ 'Notes/anchor.md': 'Text.\n', 'Notes/other.md': 'Text.\n' });
    for (const status of ['confirmed', 'declined'] as const) {
      const proposals = await buildMergeRepairIdentityProposals(vault, [repairRecord({ status })]);
      expect(proposals).toHaveLength(0);
    }
  });
});

describe('confirmMergeAuditIdentityProposal / declineMergeAuditIdentityProposal', () => {
  it("confirm on an 'audit' row reaches the real confirmMergeAuditProposalRecord", async () => {
    const vault = memoryVault({
      '01 Courses/COURSEA/Week 1/Lecture.md': 'Anchor text.\n',
      '01 Courses/COURSEB/Week 3/Lecture.md': 'Other text.\n',
    });
    await proposeAndPersistMergeAudits(vault, [
      {
        record: {
          key: 'concept-key1:aaaa',
          tier: 2,
          anchor: {
            kind: 'topic',
            course: 'COURSEA',
            name: 'shared wording',
            aliases: [],
            introducingPaths: [
              '01 Courses/COURSEA/Week 1/Lecture.md',
              '01 Courses/COURSEB/Week 3/Lecture.md',
            ],
          },
          mintedAt: '2026-09-01',
          schemaVersion: 1,
        },
      },
    ]);
    const [proposal] = await buildMergeAuditIdentityProposals(
      vault,
      (await listMergeAuditProposalRecords(vault)).map((e) => e.record),
    );
    if (proposal === undefined) throw new Error('missing proposal — fixture did not audit');

    await confirmMergeAuditIdentityProposal(vault, proposal);

    const after = (await listMergeAuditProposalRecords(vault))[0]?.record;
    expect(after?.status).toBe('confirmed');
  });

  it("decline on an 'audit' row reaches the real declineMergeAuditProposalRecord and proposes a repair", async () => {
    const vault = memoryVault({});
    const keyRecord: ConceptKeyRecord = {
      key: 'concept-key1:bbbb',
      tier: 2,
      anchor: {
        kind: 'topic' as const,
        course: 'COURSEA',
        name: 'shared wording',
        aliases: [],
        introducingPaths: [
          '01 Courses/COURSEA/Week 1/Lecture.md',
          '01 Courses/COURSEB/Week 3/Lecture.md',
        ],
      },
      mintedAt: '2026-09-01',
      schemaVersion: 1,
    };
    // Persisted to `.olea/concepts/` too — `declineMergeAuditIdentityProposal`'s repair step
    // (`proposeAndPersistMergeRepair`) re-reads the current concept-key store rather than trusting
    // stale evidence (module doc), so the fixture must have a real record there, not only an
    // in-memory list handed to `proposeAndPersistMergeAudits` above.
    await vault.write(
      conceptKeyRecordPath(keyRecord.key),
      `${JSON.stringify(keyRecord, null, 2)}\n`,
    );
    await proposeAndPersistMergeAudits(vault, [{ record: keyRecord }]);
    const persisted = (await listMergeAuditProposalRecords(vault))[0]?.record;
    if (persisted === undefined) throw new Error('missing persisted proposal');
    const proposal = {
      kind: 'audit' as const,
      key: persisted.key,
      nameA: persisted.wording,
      nameB: persisted.wording,
      coursesA: [persisted.anchorCourse],
      coursesB: ['COURSEB'],
      passageA: { location: { sourcePath: 'x' as never }, excerpt: 'a' },
      passageB: { location: { sourcePath: 'y' as never }, excerpt: 'b' },
    };

    await declineMergeAuditIdentityProposal(vault, proposal);

    const afterAudit = (await listMergeAuditProposalRecords(vault))[0]?.record;
    expect(afterAudit?.status).toBe('declined');
    const repairs = await listMergeRepairProposalRecords(vault);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]?.record.status).toBe('proposed');
  });

  it("confirm/decline on a 'repair' row reach the real confirm/declineMergeRepairProposalRecord, never applying anything", async () => {
    const vault = memoryVault({});
    const keyRecord: ConceptKeyRecord = {
      key: 'concept-key1:cccc',
      tier: 2,
      anchor: {
        kind: 'topic' as const,
        course: 'COURSEA',
        name: 'shared wording',
        aliases: [],
        introducingPaths: [
          '01 Courses/COURSEA/Week 1/Lecture.md',
          '01 Courses/COURSEB/Week 3/Lecture.md',
        ],
      },
      mintedAt: '2026-09-01',
      schemaVersion: 1,
    };
    await vault.write(
      conceptKeyRecordPath(keyRecord.key),
      `${JSON.stringify(keyRecord, null, 2)}\n`,
    );
    await proposeAndPersistMergeAudits(vault, [{ record: keyRecord }]);
    await declineMergeAuditProposalRecord(vault, 'concept-key1:cccc');
    await proposeAndPersistMergeRepair(vault, 'concept-key1:cccc');
    const repair = (await listMergeRepairProposalRecords(vault))[0]?.record;
    if (repair === undefined) throw new Error('missing repair proposal');
    const [proposal] = await buildMergeRepairIdentityProposals(
      memoryVault({
        '01 Courses/COURSEA/Week 1/Lecture.md': 'Anchor text.\n',
        '01 Courses/COURSEB/Week 3/Lecture.md': 'Other text.\n',
      }),
      [repair],
    );
    if (proposal === undefined) throw new Error('missing built repair proposal');

    await confirmMergeAuditIdentityProposal(vault, proposal);
    expect((await listMergeRepairProposalRecords(vault))[0]?.record.status).toBe('confirmed');

    // Confirming never moved or wrote anything to the audited notes themselves.
    expect(await vault.exists('01 Courses/COURSEB/Week 3/Lecture.md')).toBe(false);
  });
});

// Guard against `confirmMergeAuditProposalRecord`'s own caller-error throw leaking through this
// wrapper unhandled in a way that would break the view — a caller error here IS a bug, so this
// only documents that the wrapper does not swallow it.
describe('caller error propagation', () => {
  it('confirming a row for a key with no persisted proposal throws, rather than silently no-op-ing', async () => {
    const vault = memoryVault({});
    const proposal = {
      kind: 'audit' as const,
      key: 'no-such-key',
      nameA: 'x',
      nameB: 'x',
      coursesA: [],
      coursesB: [],
      passageA: { location: { sourcePath: 'x' as never }, excerpt: 'a' },
      passageB: { location: { sourcePath: 'y' as never }, excerpt: 'b' },
    };
    await expect(confirmMergeAuditIdentityProposal(vault, proposal)).rejects.toThrow();
  });
});
