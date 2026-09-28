// `ol-egov.141.89.9.4`: the one validity projection every attainment reading
// reads (the attainment chain spec's sections 2.1 and 8 in `olea-service`;
// failure classes E2, E3, E5, E9, E10, S3). Instrument and concept ids are
// structural placeholders, never fixture vocabulary (INV-3).
import type {
  DisputeLogRecord,
  ReviewLogEntry,
  ReviewLogRecord,
  SuccessionLogRecord,
  SuspendLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { correctedGradeInstrumentIds } from '../review-log/contest.js';
import { latestVerdictByInstrument } from '../review-log/verdicts.js';
import {
  projectInstrumentValidity,
  rejectedInstrumentIds,
  withoutCorrectedEvidence,
} from './validity.js';

function verdict(
  instrumentId: string,
  value: VerdictLogRecord['verdict'],
  timestamp: string,
  eventId: string,
): VerdictLogRecord {
  return {
    schemaVersion: 6,
    kind: 'verdict',
    eventId,
    timestamp,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict: value,
    artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
  };
}

/** `[D-396]`: a rejection of a withheld block may name no generating call. */
function rejectionWithoutProvenance(
  instrumentId: string,
  timestamp: string,
  eventId: string,
): VerdictLogRecord {
  const { artifactProvenance: _none, ...rest } = verdict(
    instrumentId,
    'rejected',
    timestamp,
    eventId,
  );
  return rest;
}

/** `[D-396]`: her deliberate restore, naming the rejection it lifts. */
function restore(
  instrumentId: string,
  restores: string,
  timestamp: string,
  eventId: string,
): VerdictLogRecord {
  return { ...verdict(instrumentId, 'accepted', timestamp, eventId), restores };
}

function suspension(
  kind: 'suspend' | 'unsuspend',
  instrumentId: string,
  timestamp: string,
  eventId: string,
  reason?: 'defect' | 'source-revision' | 'own-choice',
): SuspendLogRecord {
  return {
    schemaVersion: 6,
    kind,
    eventId,
    timestamp,
    instrumentId,
    conceptIds: ['concept-a'],
    ...(reason !== undefined ? { reason } : {}),
  } as SuspendLogRecord;
}

function reviewOf(
  instrumentId: string,
  eventId: string,
  timestamp: string,
  instrumentType: 'qa' | 'mcq' | 'explain-back' = 'qa',
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId,
    instrumentType,
    conceptIds: ['concept-a'],
    rating: instrumentType === 'explain-back' ? null : 'good',
    wasUnsure: false,
    durationMs: 1000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
    ...(instrumentType === 'explain-back'
      ? {
          explainBackCorrectness: {
            verdict: 'correct' as const,
            artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
          },
        }
      : {}),
    ...overrides,
  } as ReviewLogRecord;
}

function succession(
  predecessorInstrumentId: string,
  successorInstrumentId: string,
  timestamp: string,
): SuccessionLogRecord {
  return {
    schemaVersion: 6,
    kind: 'succession',
    eventId: `s-${predecessorInstrumentId}`,
    timestamp,
    predecessorInstrumentId,
    successorInstrumentId,
  };
}

function gradeDispute(
  instrumentId: string,
  eventId: string,
  timestamp: string,
  resolution?: { resolves: string; outcome: 'upheld' | 'corrected' },
): DisputeLogRecord {
  return {
    schemaVersion: 6,
    kind: 'dispute',
    eventId,
    timestamp,
    claimKind: 'grade',
    claimRendering: 'explain-back-grade',
    conceptIds: ['concept-a'],
    instrumentId,
    evidenceBasis: 'basis-1',
    effect: 'quarantined',
    ...(resolution ?? {}),
  } as DisputeLogRecord;
}

const T1 = '2026-01-10T09:00:00-04:00';
const T2 = '2026-01-12T09:00:00-04:00';
const T3 = '2026-01-15T09:00:00-04:00';
const at = (iso: string): number => Date.parse(iso);

describe('projectInstrumentValidity — nothing yet (X2)', () => {
  it('an empty log proves nothing invalid, withholds nothing, contests nothing', () => {
    const v = projectInstrumentValidity([]);
    expect(v.provenInvalid.size).toBe(0);
    expect(v.withheld.size).toBe(0);
    expect(v.contested.size).toBe(0);
    expect(v.changeInstants).toEqual([]);
    expect(v.unreadableEventCount).toBe(0);
  });
});

describe('proven invalid: a rejected verdict (E2)', () => {
  it('an instrument whose latest verdict is rejected is proven invalid, with the fact that proves it', () => {
    const v = projectInstrumentValidity([
      verdict('qa:1', 'accepted', T1, 'v1'),
      verdict('qa:1', 'rejected', T2, 'v2'),
    ]);
    expect(v.provenInvalid.get('qa:1')).toEqual({
      instrumentId: 'qa:1',
      reason: 'rejected',
      eventId: 'v2',
      at: T2,
    });
  });

  it('a later rejection overrides an earlier acceptance, by instant then event id', () => {
    const v = projectInstrumentValidity([
      verdict('qa:1', 'rejected', T3, 'v3'),
      verdict('qa:1', 'accepted', T2, 'v2'),
    ]);
    expect(v.provenInvalid.get('qa:1')?.eventId).toBe('v3');
  });

  it('an edited or accepted verdict never proves anything invalid', () => {
    const v = projectInstrumentValidity([
      verdict('qa:1', 'edited', T1, 'v1'),
      verdict('qa:2', 'accepted', T1, 'v2'),
    ]);
    expect(v.provenInvalid.size).toBe(0);
  });

  it('equal instants break by event id (S3)', () => {
    const v = projectInstrumentValidity([
      verdict('qa:1', 'rejected', T1, 'b'),
      verdict('qa:1', 'accepted', T1, 'a'),
    ]);
    expect(v.provenInvalid.get('qa:1')?.eventId).toBe('b');
  });
});

describe('a grade contest resolved corrected proves ONE review wrong, never the instrument (E5; ruling 2026-09-28)', () => {
  it('corrected proves the contested review wrongly graded from the resolution instant; the instrument stands', () => {
    const v = projectInstrumentValidity(
      [reviewOf('eb:1', 'r1', T1, 'explain-back')],
      [
        gradeDispute('eb:1', 'd1', T1),
        gradeDispute('eb:1', 'd2', T2, { resolves: 'd1', outcome: 'corrected' }),
      ],
    );
    expect(v.provenInvalid.size).toBe(0);
    expect(v.correctedEvidence.get('r1')).toEqual({
      reviewEventId: 'r1',
      instrumentId: 'eb:1',
      resolutionEventId: 'd2',
      at: T2,
    });
    expect(v.correctedEvidenceAsOf(at(T1)).size).toBe(0);
    expect([...v.correctedEvidenceAsOf(at(T2)).keys()]).toEqual(['r1']);
    expect(v.contested.has('eb:1')).toBe(false);
  });

  it('upheld proves nothing; an open contest is thin, never absent and never invalid', () => {
    const upheld = projectInstrumentValidity(
      [],
      [
        gradeDispute('eb:1', 'd1', T1),
        gradeDispute('eb:1', 'd2', T2, { resolves: 'd1', outcome: 'upheld' }),
      ],
    );
    expect(upheld.provenInvalid.size).toBe(0);
    expect(upheld.contested.size).toBe(0);

    const open = projectInstrumentValidity([], [gradeDispute('eb:2', 'd3', T1)]);
    expect(open.provenInvalid.size).toBe(0);
    expect([...open.contested]).toEqual(['eb:2']);
  });

  it('a dispute read from the entries array and the same dispute read separately count once', () => {
    const opening = gradeDispute('eb:1', 'd1', T1);
    const resolution = gradeDispute('eb:1', 'd2', T2, { resolves: 'd1', outcome: 'corrected' });
    const v = projectInstrumentValidity(
      [
        reviewOf('eb:1', 'r1', T1, 'explain-back'),
        opening,
        resolution,
      ] as unknown as ReviewLogEntry[],
      [opening, resolution],
    );
    expect([...v.correctedEvidence.values()].map((fact) => fact.resolutionEventId)).toEqual(['d2']);
    expect(v.changeInstants).toEqual([at(T2)]);
  });
});

describe('withheld, never proven invalid: her suspension, a successor (E3, E10)', () => {
  it('a suspension that records no reason reads as unknown — never as her choice — and proves no defect ([D-345])', () => {
    const v = projectInstrumentValidity([suspension('suspend', 'qa:1', T1, 's1')]);
    expect(v.provenInvalid.size).toBe(0);
    expect(v.withheld.get('qa:1')?.reasons).toEqual(['reason-unknown']);
  });

  it('her own choice and a revision are withheld with their reason, never proven invalid', () => {
    const v = projectInstrumentValidity([
      suspension('suspend', 'qa:1', T1, 's1', 'own-choice'),
      suspension('suspend', 'qa:2', T1, 's2', 'source-revision'),
    ]);
    expect(v.provenInvalid.size).toBe(0);
    expect(v.withheld.get('qa:1')?.reasons).toEqual(['own-choice']);
    expect(v.withheld.get('qa:2')?.reasons).toEqual(['source-revision']);
    expect(v.changeInstants).toEqual([]);
  });

  it('her restore ends the withholding', () => {
    const v = projectInstrumentValidity([
      suspension('suspend', 'qa:1', T1, 's1'),
      suspension('unsuspend', 'qa:1', T2, 's2'),
    ]);
    expect(v.withheld.has('qa:1')).toBe(false);
  });

  it('a predecessor replaced by a successor is withheld, not invalid; the successor stands', () => {
    const v = projectInstrumentValidity([succession('qa:old', 'qa:new', T1)]);
    expect(v.withheld.get('qa:old')?.reasons).toEqual(['succeeded']);
    expect(v.withheld.has('qa:new')).toBe(false);
    expect(v.provenInvalid.size).toBe(0);
  });

  it('suspended and succeeded both show, in a stable order', () => {
    const v = projectInstrumentValidity([
      succession('qa:old', 'qa:new', T2),
      suspension('suspend', 'qa:old', T1, 's1'),
    ]);
    expect(v.withheld.get('qa:old')?.reasons).toEqual(['reason-unknown', 'succeeded']);
  });
});

describe('as of an instant: judged only on what was logged by then', () => {
  const entries = [verdict('qa:1', 'rejected', T2, 'v2'), verdict('qa:2', 'rejected', T3, 'v3')];
  const disputes = [
    gradeDispute('eb:1', 'd1', T1),
    gradeDispute('eb:1', 'd2', T3, { resolves: 'd1', outcome: 'corrected' }),
  ];
  const v = projectInstrumentValidity(entries, disputes);

  it('before any fact, nothing is invalid', () => {
    expect(v.provenInvalidAsOf(at(T1)).size).toBe(0);
  });

  it('at a fact instant the fact already holds (inclusive)', () => {
    expect([...v.provenInvalidAsOf(at(T2)).keys()]).toEqual(['qa:1']);
  });

  it('now equals as-of the last change', () => {
    expect([...v.provenInvalidAsOf(at(T3)).keys()].sort()).toEqual(['qa:1', 'qa:2']);
    expect([...v.provenInvalid.keys()].sort()).toEqual(['qa:1', 'qa:2']);
  });

  it('a corrected contest the log cannot tie to any review excludes nothing, and is counted', () => {
    expect(v.correctedEvidence.size).toBe(0);
    expect(v.unattributedCorrectionCount).toBe(1);
  });

  it('a rejection later restored stands again as of the restore ([D-396])', () => {
    const r = projectInstrumentValidity([
      verdict('qa:1', 'rejected', T1, 'v1'),
      restore('qa:1', 'v1', T3, 'v3'),
    ]);
    expect(r.provenInvalidAsOf(at(T2)).has('qa:1')).toBe(true);
    expect(r.provenInvalidAsOf(at(T3)).has('qa:1')).toBe(false);
  });

  it('lists every instant a standing can change, ascending and distinct', () => {
    expect(v.changeInstants).toEqual([at(T2), at(T3)]);
  });
});

describe('merges and order (S3, E9)', () => {
  it('shuffled input gives the identical projection', () => {
    const entries: ReviewLogEntry[] = [
      verdict('qa:1', 'accepted', T1, 'v1'),
      verdict('qa:1', 'rejected', T2, 'v2'),
      suspension('suspend', 'qa:2', T1, 's1'),
      succession('qa:3', 'qa:4', T2),
    ];
    const a = projectInstrumentValidity(entries);
    const b = projectInstrumentValidity([...entries].reverse());
    expect([...b.provenInvalid.entries()]).toEqual([...a.provenInvalid.entries()]);
    expect([...b.withheld.entries()].sort()).toEqual([...a.withheld.entries()].sort());
  });

  it('a duplicated event (the same line read from two device files) counts once', () => {
    const line = verdict('qa:1', 'rejected', T2, 'v2');
    const v = projectInstrumentValidity([line, line]);
    expect(v.provenInvalid.size).toBe(1);
    expect(v.changeInstants).toEqual([at(T2)]);
  });

  it('an event whose timestamp cannot be read is left out and counted, never guessed at', () => {
    const v = projectInstrumentValidity([verdict('qa:1', 'rejected', 'not-a-time', 'v1')]);
    expect(v.provenInvalid.size).toBe(0);
    expect(v.unreadableEventCount).toBe(1);
  });
});

describe('parity with the proven-invalid set the readers build today (8a017c4, f61cd18)', () => {
  it('provenInvalid is exactly latest-verdict-rejected; a corrected contest is no longer instrument-wide', () => {
    const entries: ReviewLogEntry[] = [
      verdict('qa:1', 'rejected', T1, 'v1'),
      verdict('qa:2', 'rejected', T1, 'v2'),
      restore('qa:2', 'v2', T2, 'v3'),
      suspension('suspend', 'qa:3', T1, 's1'),
      succession('qa:4', 'qa:5', T1),
    ];
    const disputes = [
      gradeDispute('eb:1', 'd1', T1),
      gradeDispute('eb:1', 'd2', T2, { resolves: 'd1', outcome: 'corrected' }),
      gradeDispute('eb:2', 'd3', T1),
      gradeDispute('eb:2', 'd4', T2, { resolves: 'd3', outcome: 'upheld' }),
    ];
    const today = new Set<string>();
    for (const [id, record] of latestVerdictByInstrument(entries)) {
      if (record.verdict === 'rejected') today.add(id);
    }
    const v = projectInstrumentValidity(entries, disputes);
    expect([...v.provenInvalid.keys()].sort()).toEqual([...today].sort());
    // The instrument a contest was resolved `corrected` on is named by the
    // contest, but its evidence as a whole is not proven invalid.
    expect(correctedGradeInstrumentIds(disputes)).toEqual(['eb:1']);
    expect(v.provenInvalid.has('eb:1')).toBe(false);
  });
});

describe('[D-396]: a rejection without provenance, and only a deliberate restore lifts one (ol-v7r5.101)', () => {
  it('a rejection with no provenance excludes the instrument exactly as one with provenance does', () => {
    const withProvenance = projectInstrumentValidity([verdict('qa:1', 'rejected', T2, 'v2')]);
    const without = projectInstrumentValidity([rejectionWithoutProvenance('qa:1', T2, 'v2')]);
    expect([...without.provenInvalid.entries()]).toEqual([
      ...withProvenance.provenInvalid.entries(),
    ]);
    expect([...without.provenInvalidAsOf(at(T1)).keys()]).toEqual([]);
    expect(without.changeInstants).toEqual(withProvenance.changeInstants);
    expect(rejectedInstrumentIds([rejectionWithoutProvenance('qa:1', T2, 'v2')])).toEqual(
      new Set(['qa:1']),
    );
  });

  it('rejecting one instrument never excludes another in the same note', () => {
    const v = projectInstrumentValidity([
      verdict('qa:2', 'accepted', T1, 'v1'),
      rejectionWithoutProvenance('qa:1', T2, 'v2'),
    ]);
    expect([...v.provenInvalid.keys()]).toEqual(['qa:1']);
  });

  it('a later accepted or edited verdict without a restore lifts nothing', () => {
    for (const later of ['accepted', 'edited'] as const) {
      const v = projectInstrumentValidity([
        rejectionWithoutProvenance('qa:1', T1, 'v1'),
        verdict('qa:1', later, T3, 'v3'),
      ]);
      expect(v.provenInvalid.get('qa:1')?.eventId).toBe('v1');
    }
  });

  it('a review after the rejection (a passing re-parse, an answered item) lifts nothing', () => {
    const review = {
      schemaVersion: 6,
      kind: 'review',
      eventId: 'r1',
      timestamp: T3,
      instrumentId: 'qa:1',
      instrumentType: 'qa',
      conceptIds: ['concept-a'],
      rating: 'good',
      wasUnsure: false,
      durationMs: 1000,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
    } as unknown as ReviewLogEntry;
    const v = projectInstrumentValidity([rejectionWithoutProvenance('qa:1', T1, 'v1'), review]);
    expect(v.provenInvalid.has('qa:1')).toBe(true);
  });

  it('an id repair keeps the rejected id, so the repaired block stays rejected', () => {
    // A repair re-attaches the deleted id to the fixed block (C5.3, [D-090], [D-392]); the log
    // gains nothing, so the rejection keyed on that id stands on the repaired block.
    const v = projectInstrumentValidity([rejectionWithoutProvenance('qa:1', T1, 'v1')]);
    expect(v.provenInvalid.has('qa:1')).toBe(true);
  });

  it('her deliberate restore lifts the rejection, from the restore instant on, for that instrument only', () => {
    const v = projectInstrumentValidity([
      rejectionWithoutProvenance('qa:1', T1, 'v1'),
      rejectionWithoutProvenance('qa:2', T1, 'v2'),
      restore('qa:1', 'v1', T3, 'v3'),
    ]);
    expect([...v.provenInvalid.keys()]).toEqual(['qa:2']);
    expect(v.provenInvalidAsOf(at(T2)).has('qa:1')).toBe(true);
    expect(v.provenInvalidAsOf(at(T3)).has('qa:1')).toBe(false);
    expect(
      rejectedInstrumentIds([
        rejectionWithoutProvenance('qa:1', T1, 'v1'),
        restore('qa:1', 'v1', T3, 'v3'),
      ]),
    ).toEqual(new Set());
  });

  it("a restore naming another instrument's rejection lifts nothing on either", () => {
    const v = projectInstrumentValidity([
      rejectionWithoutProvenance('qa:1', T1, 'v1'),
      rejectionWithoutProvenance('qa:2', T1, 'v2'),
      restore('qa:1', 'v2', T3, 'v3'),
    ]);
    expect([...v.provenInvalid.keys()]).toEqual(['qa:1', 'qa:2']);
  });

  it('a restore lifts the rejection it names and every earlier one, never a later one', () => {
    const lifted = projectInstrumentValidity([
      verdict('qa:1', 'rejected', T1, 'v1'),
      verdict('qa:1', 'rejected', T2, 'v2'),
      restore('qa:1', 'v2', T3, 'v3'),
    ]);
    expect(lifted.provenInvalid.has('qa:1')).toBe(false);

    // A rejection she had not seen (another device's, merged in later) stays standing.
    const partly = projectInstrumentValidity([
      verdict('qa:1', 'rejected', T1, 'v1'),
      verdict('qa:1', 'rejected', T2, 'v2'),
      restore('qa:1', 'v1', T3, 'v3'),
    ]);
    expect(partly.provenInvalid.get('qa:1')?.eventId).toBe('v2');
  });

  it('a rejection after a restore stands until a restore names it', () => {
    const v = projectInstrumentValidity([
      verdict('qa:1', 'rejected', T1, 'v1'),
      restore('qa:1', 'v1', T2, 'v2'),
      rejectionWithoutProvenance('qa:1', T3, 'v3'),
    ]);
    expect(v.provenInvalid.get('qa:1')?.eventId).toBe('v3');
  });

  it('a restore naming no known rejection lifts nothing, and a merge in any order agrees', () => {
    const entries: ReviewLogEntry[] = [
      verdict('qa:1', 'rejected', T1, 'v1'),
      restore('qa:1', 'unknown-event', T2, 'v2'),
      verdict('qa:2', 'rejected', T1, 'v3'),
      restore('qa:2', 'v3', T2, 'v4'),
    ];
    const a = projectInstrumentValidity(entries);
    const b = projectInstrumentValidity([...entries].reverse());
    expect([...a.provenInvalid.keys()]).toEqual(['qa:1']);
    expect([...b.provenInvalid.entries()]).toEqual([...a.provenInvalid.entries()]);
  });
});

// ---------------------------------------------------------------------------
// `ol-egov.141.89.9.66` — the rulings of 2026-09-28 on invalidity scope.
// ---------------------------------------------------------------------------

const T0 = '2026-01-09T09:00:00-04:00';
const MINUTE = 60 * 1000;
const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

describe('rule 1: a personal withdrawal never invalidates sound evidence; a proven defect does', () => {
  it('her withdrawal, a revision and an unknown reason leave every review standing', () => {
    for (const reason of ['own-choice', 'source-revision', undefined] as const) {
      const v = projectInstrumentValidity([
        reviewOf('qa:1', 'r1', T0),
        suspension('suspend', 'qa:1', T1, 's1', reason),
      ]);
      expect(v.provenInvalid.size).toBe(0);
      expect(v.correctedEvidence.size).toBe(0);
      expect(v.withheld.has('qa:1')).toBe(true);
    }
  });

  it('a suspension recorded as a defect proves the instrument invalid from its instant ([D-345])', () => {
    const v = projectInstrumentValidity([
      reviewOf('qa:1', 'r1', T0),
      suspension('suspend', 'qa:1', T2, 's1', 'defect'),
    ]);
    expect(v.provenInvalid.get('qa:1')).toEqual({
      instrumentId: 'qa:1',
      reason: 'defect',
      eventId: 's1',
      at: T2,
    });
    expect(v.withheld.has('qa:1')).toBe(false);
    expect(v.provenInvalidAsOf(at(T1)).has('qa:1')).toBe(false);
    expect(v.changeInstants).toEqual([at(T2)]);
  });

  it('an unsuspend lifts a defect from its own instant on', () => {
    const v = projectInstrumentValidity([
      suspension('suspend', 'qa:1', T1, 's1', 'defect'),
      suspension('unsuspend', 'qa:1', T3, 's2'),
    ]);
    expect(v.provenInvalid.has('qa:1')).toBe(false);
    expect(v.provenInvalidAsOf(at(T2)).has('qa:1')).toBe(true);
    expect(v.changeInstants).toEqual([at(T1), at(T3)]);
  });
});

describe('rule 2: a corrected contest is tied to the one review it was about', () => {
  const opened = T2;
  const resolved = T3;
  const corrected = (instrumentId: string) => [
    gradeDispute(instrumentId, 'd1', opened),
    gradeDispute(instrumentId, 'd2', resolved, { resolves: 'd1', outcome: 'corrected' }),
  ];

  it('an explanation: the grade standing when she contested, never an earlier or a later attempt', () => {
    const v = projectInstrumentValidity(
      [
        reviewOf('eb:1', 'earlier', T0, 'explain-back'),
        reviewOf('eb:1', 'contested', T1, 'explain-back'),
        reviewOf('eb:1', 'later', plus(opened, MINUTE), 'explain-back'),
      ],
      corrected('eb:1'),
    );
    expect([...v.correctedEvidence.keys()]).toEqual(['contested']);
  });

  it('a corrective re-grade names the review exactly, whatever the times say', () => {
    const v = projectInstrumentValidity(
      [
        reviewOf('eb:1', 'named', T0, 'explain-back'),
        reviewOf('eb:1', 'nearer', T1, 'explain-back'),
        reviewOf('eb:1', 'regrade', plus(resolved, MINUTE), 'explain-back', {
          explainBackGrade: {
            soloLevel: 'relational',
            contentRef: 'content-ref-placeholder',
            revisionOf: 'named',
            artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
          },
        }),
      ],
      corrected('eb:1'),
    );
    expect([...v.correctedEvidence.keys()]).toEqual(['named']);
  });

  it('a quiz answer contested before its review was written: the review nearest the contest', () => {
    const v = projectInstrumentValidity(
      [
        reviewOf('mcq:1', 'last-week', T0, 'mcq'),
        reviewOf('mcq:1', 'this-answer', plus(opened, MINUTE), 'mcq'),
      ],
      corrected('mcq:1'),
    );
    expect([...v.correctedEvidence.keys()]).toEqual(['this-answer']);
  });

  it('an explanation never graded is not what a grade contest was about', () => {
    const v = projectInstrumentValidity(
      [
        reviewOf('eb:1', 'graded', T0, 'explain-back'),
        reviewOf('eb:1', 'ungraded', T1, 'explain-back', { explainBackCorrectness: undefined }),
      ],
      corrected('eb:1'),
    );
    expect([...v.correctedEvidence.keys()]).toEqual(['graded']);
  });

  it('another instrument’s reviews are never touched', () => {
    const v = projectInstrumentValidity(
      [reviewOf('qa:1', 'mine', T1), reviewOf('qa:2', 'other', T1)],
      corrected('qa:1'),
    );
    expect([...v.correctedEvidence.keys()]).toEqual(['mine']);
  });

  it('withoutCorrectedEvidence drops exactly the corrected reviews, and returns the same array when there are none', () => {
    const entries: ReviewLogEntry[] = [reviewOf('qa:1', 'r1', T1), reviewOf('qa:1', 'r2', T0)];
    const v = projectInstrumentValidity(entries, corrected('qa:1'));
    expect(withoutCorrectedEvidence(entries, v.correctedEvidence).map((e) => e.eventId)).toEqual([
      'r2',
    ]);
    const none = projectInstrumentValidity(entries);
    expect(withoutCorrectedEvidence(entries, none.correctedEvidence)).toBe(entries);
  });

  it('upheld ties nothing to any review', () => {
    const v = projectInstrumentValidity(
      [reviewOf('qa:1', 'r1', T1)],
      [
        gradeDispute('qa:1', 'd1', opened),
        gradeDispute('qa:1', 'd2', resolved, { resolves: 'd1', outcome: 'upheld' }),
      ],
    );
    expect(v.correctedEvidence.size).toBe(0);
    expect(v.unattributedCorrectionCount).toBe(0);
  });
});
