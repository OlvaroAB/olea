// `ol-egov.141.89.9.4`: the one validity projection every attainment reading
// reads (the attainment chain spec's sections 2.1 and 8 in `olea-service`;
// failure classes E2, E3, E5, E9, E10, S3). Instrument and concept ids are
// structural placeholders, never fixture vocabulary (INV-3).
import type {
  DisputeLogRecord,
  ReviewLogEntry,
  SuccessionLogRecordV5,
  SuspendLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { correctedGradeInstrumentIds } from '../review-log/contest.js';
import { latestVerdictByInstrument } from '../review-log/verdicts.js';
import { projectInstrumentValidity } from './validity.js';

function verdict(
  instrumentId: string,
  value: VerdictLogRecord['verdict'],
  timestamp: string,
  eventId: string,
): VerdictLogRecord {
  return {
    schemaVersion: 5,
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

function suspension(
  kind: 'suspend' | 'unsuspend',
  instrumentId: string,
  timestamp: string,
  eventId: string,
): SuspendLogRecord {
  return {
    schemaVersion: 5,
    kind,
    eventId,
    timestamp,
    instrumentId,
    conceptIds: ['concept-a'],
  } as SuspendLogRecord;
}

function succession(
  predecessorInstrumentId: string,
  successorInstrumentId: string,
  timestamp: string,
): SuccessionLogRecordV5 {
  return {
    schemaVersion: 5,
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
    schemaVersion: 5,
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

  it('a later acceptance stands it again: the latest verdict wins, by instant then event id', () => {
    const v = projectInstrumentValidity([
      verdict('qa:1', 'accepted', T3, 'v3'),
      verdict('qa:1', 'rejected', T2, 'v2'),
    ]);
    expect(v.provenInvalid.has('qa:1')).toBe(false);
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

describe('proven invalid: a grade contest resolved corrected (E5)', () => {
  it('corrected proves the instrument invalid from the resolution instant', () => {
    const v = projectInstrumentValidity(
      [],
      [
        gradeDispute('eb:1', 'd1', T1),
        gradeDispute('eb:1', 'd2', T2, { resolves: 'd1', outcome: 'corrected' }),
      ],
    );
    expect(v.provenInvalid.get('eb:1')).toEqual({
      instrumentId: 'eb:1',
      reason: 'corrected-on-contest',
      eventId: 'd2',
      at: T2,
    });
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
    const v = projectInstrumentValidity([opening, resolution] as unknown as ReviewLogEntry[], [
      opening,
      resolution,
    ]);
    expect(v.provenInvalid.get('eb:1')?.eventId).toBe('d2');
    expect(v.changeInstants).toEqual([at(T2)]);
  });
});

describe('withheld, never proven invalid: her suspension, a successor (E3, E10)', () => {
  it('a suspension has no reason field, so it reads as her choice and proves no defect', () => {
    const v = projectInstrumentValidity([suspension('suspend', 'qa:1', T1, 's1')]);
    expect(v.provenInvalid.size).toBe(0);
    expect(v.withheld.get('qa:1')?.reasons).toEqual(['her-choice']);
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
    expect(v.withheld.get('qa:old')?.reasons).toEqual(['her-choice', 'succeeded']);
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
    expect([...v.provenInvalidAsOf(at(T3)).keys()].sort()).toEqual(['eb:1', 'qa:1', 'qa:2']);
    expect([...v.provenInvalid.keys()].sort()).toEqual(['eb:1', 'qa:1', 'qa:2']);
  });

  it('a rejection later reversed stands again as of the reversal', () => {
    const r = projectInstrumentValidity([
      verdict('qa:1', 'rejected', T1, 'v1'),
      verdict('qa:1', 'accepted', T3, 'v3'),
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
  it('provenInvalid is exactly latest-verdict-rejected union corrected-on-contest', () => {
    const entries: ReviewLogEntry[] = [
      verdict('qa:1', 'rejected', T1, 'v1'),
      verdict('qa:2', 'rejected', T1, 'v2'),
      verdict('qa:2', 'accepted', T2, 'v3'),
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
    for (const id of correctedGradeInstrumentIds(disputes)) today.add(id);

    const v = projectInstrumentValidity(entries, disputes);
    expect([...v.provenInvalid.keys()].sort()).toEqual([...today].sort());
  });
});
