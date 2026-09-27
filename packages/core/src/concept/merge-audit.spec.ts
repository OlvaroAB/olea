import { describe, expect, it } from 'vitest';
import type { ConceptKeyRecord, NoteAnchor, TopicAnchor } from './key-store.js';
import {
  confirmMergeAuditProposal,
  confirmMergeRepairProposal,
  declineMergeAuditProposal,
  declineMergeRepairProposal,
  findMergeAuditFindings,
  type MergeAuditFinding,
  type MergeAuditProposal,
  proposeMergeAudits,
  proposeMergeRepair,
} from './merge-audit.js';
import type { SameAsLinkRecord } from './same-as.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — `[D-402]` binding condition 3, audit of
// identities formed by the old cross-course name merge, tagged `@auto:core/concept/merge-audit.spec`.
//
// Synthetic fixtures only — no real vault content, no real course codes (INV-3). Course codes
// below ("COURSEA"/"COURSEB"/"COURSEC") match this package's own `course.spec.ts` convention.

function topicAnchor(overrides: Partial<TopicAnchor> = {}): TopicAnchor {
  return {
    kind: 'topic',
    course: 'COURSEA',
    name: 'shared wording',
    aliases: [],
    ...overrides,
  };
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

function sameAsLink(overrides: Partial<SameAsLinkRecord> = {}): SameAsLinkRecord {
  return {
    keyA: 'a',
    keyB: 'b',
    status: 'confirmed',
    reason: 'normalisation-collision',
    proposedAt: '2026-09-01T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('findMergeAuditFindings — the old cross-course merge, found by shape (`[D-402]` binding condition 3)', () => {
  it('finds a genuine recurrence and a homonym alike — code cannot tell them apart', () => {
    const recurrence = keyRecord({
      key: 'concept-key1:recurrence',
      anchor: topicAnchor({
        course: 'COURSEA',
        name: 'recurring topic',
        introducingPaths: [
          '01 Courses/COURSEA/Week 1/Lecture.md',
          '01 Courses/COURSEB/Week 3/Lecture.md',
        ],
      }),
    });
    const homonym = keyRecord({
      key: 'concept-key1:homonym',
      anchor: topicAnchor({
        course: 'COURSEA',
        name: 'ambiguous term',
        introducingPaths: [
          '01 Courses/COURSEA/Week 1/Lecture.md',
          '01 Courses/COURSEC/Week 2/Lecture.md',
        ],
      }),
    });

    const findings = findMergeAuditFindings([recurrence, homonym]);

    expect(findings.map((f) => f.key).sort()).toEqual([
      'concept-key1:homonym',
      'concept-key1:recurrence',
    ]);
    const found = new Map(findings.map((f) => [f.key, f]));
    expect(found.get('concept-key1:recurrence')?.misattributedCourses).toEqual([
      { course: 'COURSEB', paths: ['01 Courses/COURSEB/Week 3/Lecture.md'] },
    ]);
    expect(found.get('concept-key1:homonym')?.misattributedCourses).toEqual([
      { course: 'COURSEC', paths: ['01 Courses/COURSEC/Week 2/Lecture.md'] },
    ]);
  });

  it('never flags a record anchored to one course with no other course in its introducing paths', () => {
    const record = keyRecord({
      anchor: topicAnchor({
        course: 'COURSEA',
        introducingPaths: [
          '01 Courses/COURSEA/Week 1/Lecture.md',
          '01 Courses/COURSEA/Week 2/Lecture.md',
        ],
      }),
    });
    expect(findMergeAuditFindings([record])).toEqual([]);
  });

  it('never flags a note anchor — the cross-course topic merge has nothing to do with a bound note', () => {
    const noteAnchor: NoteAnchor = {
      kind: 'note',
      noteUid: 'uid-1',
      notePath: '05 Zettelkasten/Some Concept.md',
    };
    const record = keyRecord({ anchor: noteAnchor });
    expect(findMergeAuditFindings([record])).toEqual([]);
  });

  it('never flags a topic anchor with no introducingPaths at all (every record minted before `[D-180]`)', () => {
    const record = keyRecord({ anchor: topicAnchor() }); // topicAnchor() omits introducingPaths by default
    expect(findMergeAuditFindings([record])).toEqual([]);
  });

  it('ignores a path with no derivable course rather than treating it as evidence of another course', () => {
    const record = keyRecord({
      anchor: topicAnchor({
        course: 'COURSEA',
        introducingPaths: ['01 Courses/COURSEA/Week 1/Lecture.md', '03 Research/Loose paper.md'],
      }),
    });
    expect(findMergeAuditFindings([record])).toEqual([]);
  });

  it('groups several paths under the same misattributed course, sorted and de-duplicated', () => {
    const record = keyRecord({
      anchor: topicAnchor({
        course: 'COURSEA',
        introducingPaths: [
          '01 Courses/COURSEB/Week 5/B.md',
          '01 Courses/COURSEB/Week 1/A.md',
          '01 Courses/COURSEB/Week 1/A.md', // duplicate path, same as extract.ts could produce
        ],
      }),
    });
    const [finding] = findMergeAuditFindings([record]);
    expect(finding?.misattributedCourses).toEqual([
      {
        course: 'COURSEB',
        paths: ['01 Courses/COURSEB/Week 1/A.md', '01 Courses/COURSEB/Week 5/B.md'],
      },
    ]);
  });

  it('sorts several misattributed courses by course code', () => {
    const record = keyRecord({
      anchor: topicAnchor({
        course: 'COURSEA',
        introducingPaths: ['01 Courses/COURSEC/Week 1/C.md', '01 Courses/COURSEB/Week 1/B.md'],
      }),
    });
    const [finding] = findMergeAuditFindings([record]);
    expect(finding?.misattributedCourses.map((e) => e.course)).toEqual(['COURSEB', 'COURSEC']);
  });

  it('folds in confirmed same-as partners, and only confirmed ones', () => {
    const record = keyRecord({
      key: 'concept-key1:withSameAs',
      anchor: topicAnchor({
        course: 'COURSEA',
        introducingPaths: ['01 Courses/COURSEB/Week 1/B.md'],
      }),
    });
    const links: SameAsLinkRecord[] = [
      sameAsLink({
        keyA: 'concept-key1:withSameAs',
        keyB: 'concept-key1:other',
        status: 'confirmed',
      }),
      sameAsLink({
        keyA: 'concept-key1:withSameAs',
        keyB: 'concept-key1:proposedOnly',
        status: 'proposed',
      }),
      sameAsLink({
        keyA: 'concept-key1:withSameAs',
        keyB: 'concept-key1:declinedOnly',
        status: 'declined',
      }),
    ];
    const [finding] = findMergeAuditFindings([record], links);
    expect(finding?.confirmedSameAsPartners).toEqual(['concept-key1:other']);
  });

  it('conservation: mutates neither the input records nor the input same-as links', () => {
    const record = keyRecord({
      anchor: topicAnchor({
        course: 'COURSEA',
        introducingPaths: ['01 Courses/COURSEB/Week 1/B.md'],
      }),
    });
    const links = [sameAsLink({ keyA: record.key, keyB: 'other', status: 'confirmed' })];
    const recordSnapshot = JSON.parse(JSON.stringify(record));
    const linksSnapshot = JSON.parse(JSON.stringify(links));

    findMergeAuditFindings([record], links);

    expect(record).toEqual(recordSnapshot);
    expect(links).toEqual(linksSnapshot);
  });
});

describe('proposeMergeAudits / confirm / decline — exactly one proposal per finding, propose→confirm/decline only', () => {
  function finding(overrides: Partial<MergeAuditFinding> = {}): MergeAuditFinding {
    return {
      key: 'concept-key1:x',
      wording: 'shared wording',
      anchorCourse: 'COURSEA',
      misattributedCourses: [{ course: 'COURSEB', paths: ['01 Courses/COURSEB/Week 1/B.md'] }],
      confirmedSameAsPartners: [],
      ...overrides,
    };
  }

  it('produces exactly one proposed record per finding', () => {
    const findings = [finding({ key: 'a' }), finding({ key: 'b' })];
    const proposals = proposeMergeAudits(findings);
    expect(proposals).toHaveLength(2);
    expect(proposals.every((p) => p.status === 'proposed')).toBe(true);
    expect(proposals.map((p) => p.key)).toEqual(['a', 'b']);
    expect(proposals[0]?.misattributedCourseCodes).toEqual(['COURSEB']);
  });

  it('nothing is confirmed or declined automatically — proposeMergeAudits never writes a non-proposed status', () => {
    const [proposal] = proposeMergeAudits([finding()]);
    expect(proposal?.status).toBe('proposed');
  });

  it('confirm and decline are idempotent and each is reachable from the other', () => {
    const [proposal] = proposeMergeAudits([finding()]) as [MergeAuditProposal];
    const confirmed = confirmMergeAuditProposal(proposal);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmMergeAuditProposal(confirmed)).toEqual(confirmed); // idempotent

    const declinedFromConfirmed = declineMergeAuditProposal(confirmed);
    expect(declinedFromConfirmed.status).toBe('declined'); // a decline never blocks a later confirm, and vice versa

    const declined = declineMergeAuditProposal(proposal);
    expect(declined.status).toBe('declined');
    expect(declineMergeAuditProposal(declined)).toEqual(declined); // idempotent
    expect(confirmMergeAuditProposal(declined).status).toBe('confirmed');
  });

  it('confirm/decline never mutate the proposal passed in', () => {
    const [proposal] = proposeMergeAudits([finding()]) as [MergeAuditProposal];
    const snapshot = { ...proposal };
    confirmMergeAuditProposal(proposal);
    declineMergeAuditProposal(proposal);
    expect(proposal).toEqual(snapshot);
  });
});

describe('proposeMergeRepair — a repair only from a declined proposal, and only when it needs nothing more than propose/confirm/decline', () => {
  function finding(overrides: Partial<MergeAuditFinding> = {}): MergeAuditFinding {
    return {
      key: 'concept-key1:x',
      wording: 'shared wording',
      anchorCourse: 'COURSEA',
      misattributedCourses: [{ course: 'COURSEB', paths: ['01 Courses/COURSEB/Week 1/B.md'] }],
      confirmedSameAsPartners: [],
      ...overrides,
    };
  }

  it('refuses a still-proposed proposal — nothing was judged a mistake yet', () => {
    const f = finding();
    const [proposal] = proposeMergeAudits([f]) as [MergeAuditProposal];
    expect(() => proposeMergeRepair(f, proposal)).toThrow(/declined/);
  });

  it('refuses a confirmed proposal — a genuine recurrence has no repair to propose', () => {
    const f = finding();
    const [proposal] = proposeMergeAudits([f]) as [MergeAuditProposal];
    expect(() => proposeMergeRepair(f, confirmMergeAuditProposal(proposal))).toThrow(/declined/);
  });

  it('refuses a proposal for a different finding', () => {
    const f = finding({ key: 'concept-key1:x' });
    const other = finding({ key: 'concept-key1:y' });
    const [proposal] = proposeMergeAudits([other]) as [MergeAuditProposal];
    expect(() => proposeMergeRepair(f, declineMergeAuditProposal(proposal))).toThrow(
      /different keys/,
    );
  });

  it('on a declined proposal with exactly one misattributed course, proposes the repair — never applies it', () => {
    const f = finding();
    const [proposal] = proposeMergeAudits([f]) as [MergeAuditProposal];
    const outcome = proposeMergeRepair(f, declineMergeAuditProposal(proposal));
    expect(outcome.kind).toBe('repair-proposal');
    if (outcome.kind !== 'repair-proposal') throw new Error('unreachable');
    expect(outcome.proposal).toEqual({
      key: 'concept-key1:x',
      course: 'COURSEB',
      paths: ['01 Courses/COURSEB/Week 1/B.md'],
      status: 'proposed',
    });
  });

  it('stops and escalates instead of guessing when more than one course is entangled', () => {
    const f = finding({
      misattributedCourses: [
        { course: 'COURSEB', paths: ['01 Courses/COURSEB/Week 1/B.md'] },
        { course: 'COURSEC', paths: ['01 Courses/COURSEC/Week 1/C.md'] },
      ],
    });
    const [proposal] = proposeMergeAudits([f]) as [MergeAuditProposal];
    const outcome = proposeMergeRepair(f, declineMergeAuditProposal(proposal));
    expect(outcome.kind).toBe('needs-decision');
    if (outcome.kind !== 'needs-decision') throw new Error('unreachable');
    expect(outcome.escalation.key).toBe('concept-key1:x');
    expect(outcome.escalation.reason).toMatch(/decision bead/);
  });

  it('stops and escalates instead of guessing when the key already carries a confirmed same-as link', () => {
    const f = finding({ confirmedSameAsPartners: ['concept-key1:other'] });
    const [proposal] = proposeMergeAudits([f]) as [MergeAuditProposal];
    const outcome = proposeMergeRepair(f, declineMergeAuditProposal(proposal));
    expect(outcome.kind).toBe('needs-decision');
    if (outcome.kind !== 'needs-decision') throw new Error('unreachable');
    expect(outcome.escalation.reason).toMatch(/decision bead/);
  });

  it('repair proposal confirm/decline are idempotent and never mutate their input', () => {
    const f = finding();
    const [proposal] = proposeMergeAudits([f]) as [MergeAuditProposal];
    const outcome = proposeMergeRepair(f, declineMergeAuditProposal(proposal));
    if (outcome.kind !== 'repair-proposal') throw new Error('unreachable');
    const snapshot = { ...outcome.proposal };

    const confirmed = confirmMergeRepairProposal(outcome.proposal);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmMergeRepairProposal(confirmed)).toEqual(confirmed);
    expect(outcome.proposal).toEqual(snapshot); // never mutated

    const declined = declineMergeRepairProposal(outcome.proposal);
    expect(declined.status).toBe('declined');
    expect(declineMergeRepairProposal(declined)).toEqual(declined);
  });
});
