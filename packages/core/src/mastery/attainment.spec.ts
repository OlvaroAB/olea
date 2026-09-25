// `ol-egov.141.89.9.4`: the attainment entry point — the displayed stage over
// evidence that stands now, the historical award as an in-memory as-of fold,
// the correction note, and the current readings (vitality, readiness, need,
// the recognition credit's recency and validity) with one eligibility rule.
// The attainment chain spec's sections 2.3 to 2.5, 4 and 5 in `olea-service`
// name the failure classes each block below pins (A6, A8, A9, A10, E2, E3,
// E4, E5, E6, H2, H4, H7, N1, N6, X1, X2, X4). Ids are structural
// placeholders, never fixture vocabulary (INV-3).
import type {
  DisputeLogRecord,
  ReviewLogEntry,
  ReviewLogRecord,
  SuccessionLogRecordV5,
  SupportLevel,
  SuspendLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  createFsrsScheduler,
  SCHEDULER_CONFIGURATION_VERSION,
} from '../scheduler/fsrs-scheduler.js';
import type { Scheduler } from '../scheduler/types.js';
import {
  ATTAINMENT_FOLD_VERSION,
  attainmentArithmeticVersion,
  DEFAULT_WITHHELD_EVIDENCE_POLICY,
  readAllConceptAttainment,
  readAllConceptReadiness,
  readAllCurrentRecognition,
  readAllEligibleConceptVitality,
  readConceptAttainment,
  readNeed,
  UNKNOWN_NEED_VALUE,
} from './attainment.js';
import { HOLDING_CUT } from './rollup.js';
import { projectInstrumentValidity } from './validity.js';

const DAY = 24 * 60 * 60 * 1000;

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'r-default',
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
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

function recall(
  eventId: string,
  timestamp: string,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return review({ eventId, timestamp, supportLevelShown: 'independent', ...overrides });
}

function explainBack(
  eventId: string,
  timestamp: string,
  overrides: {
    correctness?: 'correct' | 'partial' | 'incorrect';
    support?: SupportLevel;
    revisionOf?: string | null;
    instrumentId?: string;
    conceptIds?: string[];
  } = {},
): ReviewLogRecord {
  return review({
    eventId,
    timestamp,
    instrumentId: overrides.instrumentId ?? 'eb:a',
    instrumentType: 'explain-back',
    conceptIds: overrides.conceptIds ?? ['concept-a'],
    rating: null,
    supportLevelShown: overrides.support ?? 'independent',
    explainBackGrade: {
      soloLevel: 'relational',
      correctness: overrides.correctness ?? 'correct',
      contentRef: 'content-ref-placeholder',
      revisionOf: overrides.revisionOf ?? null,
      artifactProvenance: { taskId: 'explain-back-grade', promptVersion: 'v0', modelId: 'm' },
    },
  });
}

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

function suspend(instrumentId: string, timestamp: string, eventId: string): SuspendLogRecord {
  return {
    schemaVersion: 5,
    kind: 'suspend',
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
const T4 = '2026-01-20T09:00:00-04:00';

function attain(entries: readonly ReviewLogEntry[], disputes: readonly DisputeLogRecord[] = []) {
  return readConceptAttainment(entries, 'concept-a', projectInstrumentValidity(entries, disputes));
}

describe('nothing yet (X2)', () => {
  it('an empty log reads seed, no award, no correction, and says which arithmetic produced it', () => {
    const reading = attain([]);
    expect(reading.displayed.state).toBe('seed');
    expect(reading.award).toBeNull();
    expect(reading.correction).toBeNull();
    expect(reading.arithmeticVersion).toContain(ATTAINMENT_FOLD_VERSION);
    expect(reading.arithmeticVersion).toContain('scheduler=unknown');
  });
});

describe('[D-338]: the award stays; the displayed stage falls only on proven-invalid evidence (A6)', () => {
  const attempt = explainBack('eb-1', T1);

  it('a qualifying attempt: top stage displayed and awarded, on that attempt, at its instant', () => {
    const reading = attain([attempt]);
    expect(reading.displayed.state).toBe('tree');
    expect(reading.award).toEqual({
      stage: 'tree',
      attemptEventId: 'eb-1',
      instrumentId: 'eb:a',
      attemptAt: T1,
      standingFrom: T1,
    });
    expect(reading.correction).toBeNull();
  });

  it('her withdrawal or a changed passage (a reasonless suspension) takes back neither (E3, E4)', () => {
    const reading = attain([attempt, suspend('eb:a', T2, 's1')]);
    expect(reading.displayed.state).toBe('tree');
    expect(reading.award?.attemptEventId).toBe('eb-1');
    expect(reading.correction).toBeNull();
  });

  it('a successor replacing the instrument takes back neither', () => {
    const reading = attain([attempt, succession('eb:a', 'eb:a2', T2)]);
    expect(reading.displayed.state).toBe('tree');
    expect(reading.award).not.toBeNull();
  });

  it('a proven defect lowers the displayed stage with the note; the award keeps what stood before (E2)', () => {
    const reading = attain([attempt, verdict('eb:a', 'rejected', T3, 'v1')]);
    expect(reading.displayed.state).toBe('seed');
    expect(reading.award?.attemptEventId).toBe('eb-1');
    expect(reading.correction).toEqual({
      from: 'tree',
      to: 'seed',
      facts: [
        { kind: 'instrument', instrumentId: 'eb:a', reason: 'rejected', eventId: 'v1', at: T3 },
      ],
    });
  });

  it('a grade contest resolved corrected is a proven defect too (E5)', () => {
    const reading = attain(
      [attempt],
      [
        gradeDispute('eb:a', 'd1', T2),
        gradeDispute('eb:a', 'd2', T3, { resolves: 'd1', outcome: 'corrected' }),
      ],
    );
    expect(reading.displayed.state).toBe('seed');
    expect(reading.award?.attemptEventId).toBe('eb-1');
    expect(reading.correction?.facts[0]).toMatchObject({ reason: 'corrected-on-contest' });
  });

  it('an open contest keeps the evidence, marked thin, never absent (E5)', () => {
    const reading = attain([attempt], [gradeDispute('eb:a', 'd1', T2)]);
    expect(reading.displayed.state).toBe('tree');
    expect(reading.thinEvidenceInstrumentIds).toEqual(['eb:a']);
  });

  it('a later valid attempt restores the displayed stage and the note goes away', () => {
    const reading = attain([
      attempt,
      verdict('eb:a', 'rejected', T3, 'v1'),
      explainBack('eb-2', T4, { instrumentId: 'eb:b' }),
    ]);
    expect(reading.displayed.state).toBe('tree');
    expect(reading.correction).toBeNull();
    expect(reading.award?.attemptEventId).toBe('eb-1');
  });
});

describe('corrective re-grades (E6)', () => {
  it('a re-grade logged after the grade it corrects: displayed falls with the note, the award stays', () => {
    const reading = attain([
      explainBack('eb-1', T1),
      explainBack('eb-2', T2, { revisionOf: 'eb-1', correctness: 'incorrect' }),
    ]);
    expect(reading.displayed.state).toBe('sprout');
    expect(reading.award?.attemptEventId).toBe('eb-1');
    expect(reading.correction).toEqual({
      from: 'tree',
      to: 'sprout',
      facts: [
        {
          kind: 'regraded',
          instrumentId: 'eb:a',
          supersededEventId: 'eb-1',
          byEventId: 'eb-2',
          at: T2,
        },
      ],
    });
  });

  it('a re-grade logged BEFORE the grade it corrects: the superseded grade never stood, so no award', () => {
    const reading = attain([
      explainBack('eb-2', T1, { revisionOf: 'eb-1', correctness: 'incorrect' }),
      explainBack('eb-1', T2),
    ]);
    expect(reading.displayed.state).toBe('sprout');
    expect(reading.award).toBeNull();
    expect(reading.correction).toBeNull();
  });
});

describe('the award is judged against the validity known at the time', () => {
  it('an attempt on an instrument already rejected never stood', () => {
    const reading = attain([verdict('eb:a', 'rejected', T1, 'v1'), explainBack('eb-1', T2)]);
    expect(reading.award).toBeNull();
    expect(reading.displayed.state).toBe('seed');
  });

  it('an attempt that comes to stand when its instrument is accepted again is awarded from then', () => {
    const reading = attain([
      verdict('eb:a', 'rejected', T1, 'v1'),
      explainBack('eb-1', T2),
      verdict('eb:a', 'accepted', T3, 'v2'),
    ]);
    expect(reading.displayed.state).toBe('tree');
    expect(reading.award).toMatchObject({ attemptEventId: 'eb-1', attemptAt: T2 });
    expect(Date.parse(reading.award?.standingFrom ?? '')).toBe(Date.parse(T3));
  });
});

describe('proven-invalid evidence is removed at EVERY stage, not only the top one (E2, item 5)', () => {
  it('sapling earned partly on a rejected instrument falls to sprout with the note', () => {
    const entries = [
      recall('r1', T1),
      recall('r2', T2),
      recall('r3', T3, { instrumentId: 'qa:a:2' }),
      verdict('qa:a:2', 'rejected', T4, 'v1'),
    ];
    const reading = attain(entries);
    expect(reading.displayed.state).toBe('sprout');
    expect(reading.award).toBeNull();
    expect(reading.correction).toMatchObject({ from: 'sapling', to: 'sprout' });
    expect(reading.correction?.facts).toEqual([
      { kind: 'instrument', instrumentId: 'qa:a:2', reason: 'rejected', eventId: 'v1', at: T4 },
    ]);
  });

  it('a withheld but valid instrument keeps its evidence in the stage', () => {
    const entries = [
      recall('r1', T1),
      recall('r2', T2),
      recall('r3', T3, { instrumentId: 'qa:a:2' }),
      suspend('qa:a:2', T4, 's1'),
    ];
    expect(attain(entries).displayed.state).toBe('sapling');
  });
});

describe('prefix-by-prefix replay (A8): the award never falls; the displayed stage falls only at a proven-invalid event', () => {
  it('holds over every prefix of a mixed log', () => {
    const log: ReviewLogEntry[] = [
      recall('r1', T1),
      explainBack('eb-1', '2026-01-11T09:00:00-04:00'),
      suspend('eb:a', T2, 's1'),
      recall('r2', '2026-01-13T09:00:00-04:00'),
      verdict('eb:a', 'rejected', T3, 'v1'),
      recall('r3', '2026-01-17T09:00:00-04:00'),
      explainBack('eb-2', T4, { instrumentId: 'eb:b' }),
    ];
    const order = ['seed', 'sprout', 'sapling', 'tree'];
    let previousAward: string | null = null;
    let previousDisplayed = -1;
    for (let n = 1; n <= log.length; n += 1) {
      const prefix = log.slice(0, n);
      const reading = attain(prefix);
      if (previousAward !== null) expect(reading.award?.attemptEventId).toBe(previousAward);
      previousAward = reading.award?.attemptEventId ?? null;
      const displayed = order.indexOf(reading.displayed.state);
      const last = prefix[prefix.length - 1] as ReviewLogEntry;
      const provenInvalidEvent = last.kind === 'verdict' && last.verdict === 'rejected';
      if (displayed < previousDisplayed) expect(provenInvalidEvent).toBe(true);
      previousDisplayed = displayed;
    }
    expect(previousAward).toBe('eb-1');
  });
});

describe('every reader, same log (A9); no window (A10); stamps are never inputs (X1)', () => {
  const entries: ReviewLogEntry[] = [
    // A qualifying attempt 400 days before the rest of the log: no window drops it.
    explainBack('eb-old', '2024-12-01T09:00:00-04:00'),
    recall('r1', T1),
    recall('r2', T2, { conceptIds: ['concept-a', 'concept-b'] }),
    verdict('qa:a:1', 'rejected', T3, 'v1'),
  ];

  it('the batch reader and the one-concept reader agree for every concept', () => {
    const validity = projectInstrumentValidity(entries);
    const batch = readAllConceptAttainment(entries, ['concept-a', 'concept-b'], validity);
    for (const id of ['concept-a', 'concept-b']) {
      expect(batch.get(id)).toEqual(readConceptAttainment(entries, id, validity));
    }
    expect(batch.get('concept-a')?.displayed.state).toBe('tree');
  });

  it('a stage earned long ago still reads (A10)', () => {
    expect(attain(entries).award?.attemptEventId).toBe('eb-old');
  });

  it('stripping every stamp changes no reading (X1)', () => {
    const stamped = entries.map((entry) =>
      entry.kind === 'review'
        ? {
            ...entry,
            masteryAtTime: { attribution: 'per-concept', byConcept: { 'concept-a': 'sapling' } },
          }
        : entry,
    ) as ReviewLogEntry[];
    expect(attain(stamped)).toEqual(attain(entries));
  });
});

describe('[D-319] reaches the entry point', () => {
  it('a finding that the explanation is missing withholds the award as well as the displayed top stage', () => {
    const entries = [explainBack('eb-1', T1)];
    const reading = readConceptAttainment(
      entries,
      'concept-a',
      projectInstrumentValidity(entries),
      {
        explanationMissingEventIds: ['eb-1'],
      },
    );
    expect(reading.displayed.state).toBe('sprout');
    expect(reading.award).toBeNull();
    expect(reading.correction).toBeNull();
  });
});

describe('the arithmetic version (X4)', () => {
  it('names the fold, each open rule’s option, and the scheduler configuration', () => {
    expect(
      attainmentArithmeticVersion({
        saplingRule: 'any-scored-success',
        withheldEvidence: 'count',
        schedulerVersion: SCHEDULER_CONFIGURATION_VERSION,
      }),
    ).toBe(
      `${ATTAINMENT_FOLD_VERSION};sapling=any-scored-success;withheld=count;scheduler=${SCHEDULER_CONFIGURATION_VERSION}`,
    );
  });

  it('changes when an open rule’s option changes, so a reading never hides which rule made it', () => {
    const entries = [recall('r1', T1)];
    const validity = projectInstrumentValidity(entries);
    const a = readConceptAttainment(entries, 'concept-a', validity);
    const b = readConceptAttainment(entries, 'concept-a', validity, {
      saplingRule: 'unaided-recall',
    });
    expect(a.arithmeticVersion).not.toBe(b.arithmeticVersion);
  });
});

// ---------------------------------------------------------------------------
// Current readings
// ---------------------------------------------------------------------------

const scheduler: Scheduler = createFsrsScheduler();
const NOW = new Date(Date.parse(T3) + 2 * DAY);

describe('vitality: proven-invalid instruments never count; withheld ones per [D-347] (H4, H7)', () => {
  const entries: ReviewLogEntry[] = [
    recall('r1', T1, { instrumentId: 'qa:a:1' }),
    recall('r2', T1, { instrumentId: 'qa:a:2', rating: 'again' }),
    recall('r3', T1, { instrumentId: 'qa:a:3' }),
  ];

  it('the default is today’s: every valid instrument counts, the weakest named', () => {
    expect(DEFAULT_WITHHELD_EVIDENCE_POLICY).toBe('count');
    const validity = projectInstrumentValidity(entries);
    const reading = readAllEligibleConceptVitality(
      entries,
      ['concept-a'],
      scheduler,
      NOW,
      HOLDING_CUT,
      validity,
    ).get('concept-a');
    expect(reading?.weakest?.instrumentId).toBe('qa:a:2');
    expect(reading?.instrumentsRead).toBe(3);
    expect(reading?.arithmeticVersion).toContain(`scheduler=${SCHEDULER_CONFIGURATION_VERSION}`);
  });

  it('a rejected instrument is excluded whatever the policy (D-338 item 3)', () => {
    const withReject = [...entries, verdict('qa:a:2', 'rejected', T2, 'v1')];
    const validity = projectInstrumentValidity(withReject);
    for (const policy of [
      'count',
      'drop-from-readiness-and-need',
      'drop-from-every-current-reading',
    ] as const) {
      const reading = readAllEligibleConceptVitality(
        withReject,
        ['concept-a'],
        scheduler,
        NOW,
        HOLDING_CUT,
        validity,
        { withheldEvidence: policy },
      ).get('concept-a');
      expect(reading?.weakest?.instrumentId).not.toBe('qa:a:2');
      expect(reading?.excludedInstrumentIds).toEqual(['qa:a:2']);
    }
  });

  it('a suspended instrument counts under (a) and (b), and is dropped under (c)', () => {
    const withSuspend = [...entries, suspend('qa:a:2', T2, 's1')];
    const validity = projectInstrumentValidity(withSuspend);
    const read = (
      policy: 'count' | 'drop-from-readiness-and-need' | 'drop-from-every-current-reading',
    ) =>
      readAllEligibleConceptVitality(
        withSuspend,
        ['concept-a'],
        scheduler,
        NOW,
        HOLDING_CUT,
        validity,
        {
          withheldEvidence: policy,
        },
      ).get('concept-a');
    expect(read('count')?.weakest?.instrumentId).toBe('qa:a:2');
    expect(read('drop-from-readiness-and-need')?.weakest?.instrumentId).toBe('qa:a:2');
    expect(read('drop-from-every-current-reading')?.weakest?.instrumentId).not.toBe('qa:a:2');
  });

  it('a predecessor and its successor both count under (a); only the successor under (c) (H4)', () => {
    const chain = [
      recall('p1', T1, { instrumentId: 'qa:a:old', rating: 'again' }),
      recall('s1', T2, { instrumentId: 'qa:a:new' }),
      succession('qa:a:old', 'qa:a:new', T2),
    ];
    const validity = projectInstrumentValidity(chain);
    const count = readAllEligibleConceptVitality(
      chain,
      ['concept-a'],
      scheduler,
      NOW,
      HOLDING_CUT,
      validity,
    );
    const drop = readAllEligibleConceptVitality(
      chain,
      ['concept-a'],
      scheduler,
      NOW,
      HOLDING_CUT,
      validity,
      {
        withheldEvidence: 'drop-from-every-current-reading',
      },
    );
    expect(count.get('concept-a')?.instrumentsRead).toBe(2);
    expect(drop.get('concept-a')?.instrumentsRead).toBe(1);
    expect(drop.get('concept-a')?.weakest?.instrumentId).toBe('qa:a:new');
  });

  it('recognition only, or nothing reviewed, reads too early to say (H2)', () => {
    const quiz = [review({ eventId: 'm1', instrumentId: 'mcq:a:1', instrumentType: 'mcq' })];
    const reading = readAllEligibleConceptVitality(
      quiz,
      ['concept-a', 'concept-z'],
      scheduler,
      NOW,
      HOLDING_CUT,
      projectInstrumentValidity(quiz),
    );
    expect(reading.get('concept-a')?.value).toBe('early');
    expect(reading.get('concept-z')?.value).toBe('early');
  });
});

describe('readiness: unaided, standing recall only (H2, H7, [D-264], [D-338] item 3)', () => {
  it('supported-only recall gives a vitality reading and no readiness reading', () => {
    const prompted = [recall('r1', T1, { supportLevelShown: 'prompted' })];
    const validity = projectInstrumentValidity(prompted);
    const readiness = readAllConceptReadiness(prompted, ['concept-a'], scheduler, NOW, validity);
    expect(readiness.get('concept-a')?.weakest).toBeNull();
    const vitality = readAllEligibleConceptVitality(
      prompted,
      ['concept-a'],
      scheduler,
      NOW,
      HOLDING_CUT,
      validity,
    );
    expect(vitality.get('concept-a')?.value).not.toBe('early');
  });

  it('an independent success makes the instrument eligible', () => {
    const entries = [recall('r1', T1)];
    const reading = readAllConceptReadiness(
      entries,
      ['concept-a'],
      scheduler,
      NOW,
      projectInstrumentValidity(entries),
    ).get('concept-a');
    expect(reading?.weakest?.instrumentId).toBe('qa:a:1');
    expect(reading?.instrumentsRead).toBe(1);
  });

  it('a proven-invalid instrument never counts', () => {
    const entries = [recall('r1', T1), verdict('qa:a:1', 'rejected', T2, 'v1')];
    const reading = readAllConceptReadiness(
      entries,
      ['concept-a'],
      scheduler,
      NOW,
      projectInstrumentValidity(entries),
    ).get('concept-a');
    expect(reading?.weakest).toBeNull();
  });

  it('a withheld instrument counts under (a), and is dropped under (b) and (c)', () => {
    const entries = [recall('r1', T1), suspend('qa:a:1', T2, 's1')];
    const validity = projectInstrumentValidity(entries);
    const read = (
      policy: 'count' | 'drop-from-readiness-and-need' | 'drop-from-every-current-reading',
    ) =>
      readAllConceptReadiness(entries, ['concept-a'], scheduler, NOW, validity, {
        withheldEvidence: policy,
      }).get('concept-a')?.weakest?.instrumentId ?? null;
    expect(read('count')).toBe('qa:a:1');
    expect(read('drop-from-readiness-and-need')).toBeNull();
    expect(read('drop-from-every-current-reading')).toBeNull();
  });
});

describe('need carries a basis ([D-348] open: unknown enters at the declared value) (N6)', () => {
  it('no eligible evidence reads unknown at the declared value, never a measured zero', () => {
    const need = readNeed({ weakest: null, instrumentsRead: 0 });
    expect(need.basis).toBe('unknown');
    expect(need.value).toBe(UNKNOWN_NEED_VALUE);
    expect(UNKNOWN_NEED_VALUE).toBe(1);
  });

  it('eligible evidence reads estimated: one minus current unaided recall ([D-332])', () => {
    const need = readNeed({
      weakest: { instrumentId: 'qa:a:1', recallProbability: 0.8 },
      instrumentsRead: 1,
    });
    expect(need.basis).toBe('estimated');
    expect(need.value).toBeCloseTo(0.2, 12);
  });

  it('a declared middle value can be handed in (the ruling’s alternative)', () => {
    expect(readNeed({ weakest: null, instrumentsRead: 0 }, { unknownNeedValue: 0.5 }).value).toBe(
      0.5,
    );
    expect(() =>
      readNeed({ weakest: null, instrumentsRead: 0 }, { unknownNeedValue: 1.5 }),
    ).toThrow();
  });
});

describe('the recognition credit reads only a correct, current, standing quiz answer (N1, N2)', () => {
  const quiz = (eventId: string, timestamp: string, rating: ReviewLogRecord['rating']) =>
    review({ eventId, timestamp, instrumentId: 'mcq:a:1', instrumentType: 'mcq', rating });

  const soon = new Date(Date.parse(T1) + 1 * DAY);
  const muchLater = new Date(Date.parse(T1) + 200 * DAY);

  function current(entries: readonly ReviewLogEntry[], now: Date): boolean | undefined {
    return readAllCurrentRecognition(
      entries,
      ['concept-a'],
      scheduler,
      now,
      projectInstrumentValidity(entries),
    ).get('concept-a');
  }

  it('a correct answer not yet due again stands', () => {
    expect(current([quiz('m1', T1, 'good')], soon)).toBe(true);
  });

  it('a wrong latest answer never stands, even after an earlier right one', () => {
    expect(current([quiz('m1', T1, 'good'), quiz('m2', T2, 'again')], soon)).toBe(false);
  });

  it('a correct answer now past due (stale) does not stand', () => {
    expect(current([quiz('m1', T1, 'good')], muchLater)).toBe(false);
  });

  it('a correct answer on a rejected instrument does not stand', () => {
    expect(current([quiz('m1', T1, 'good'), verdict('mcq:a:1', 'rejected', T1, 'v1')], soon)).toBe(
      false,
    );
  });

  it('recall evidence is not recognition evidence', () => {
    expect(current([recall('r1', T1)], soon)).toBe(false);
  });
});
