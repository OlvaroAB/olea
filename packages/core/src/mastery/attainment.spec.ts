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
  SuccessionLogRecord,
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
  DEFAULT_REPLACED_PREDECESSOR_POLICY,
  DEFAULT_WITHHELD_EVIDENCE_POLICY,
  type PassageChangeFact,
  predecessorsCarriedBySuccessor,
  readAllConceptAttainment,
  readAllConceptReadiness,
  readAllCurrentRecognition,
  readAllEligibleConceptVitality,
  readConceptAttainment,
  readNeed,
  UNKNOWN_NEED_VALUE,
  unresolvedPassageInstrumentIds,
  withKnownFalseJudgements,
} from './attainment.js';
import { HOLDING_CUT } from './rollup.js';
import { projectInstrumentValidity } from './validity.js';

const DAY = 24 * 60 * 60 * 1000;

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
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

function suspend(instrumentId: string, timestamp: string, eventId: string): SuspendLogRecord {
  return {
    schemaVersion: 6,
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

  it('a grade contest resolved corrected proves that attempt wrongly graded: practice only, with the note (E5; ruling 2026-09-28)', () => {
    const reading = attain(
      [attempt],
      [
        gradeDispute('eb:a', 'd1', T2),
        gradeDispute('eb:a', 'd2', T3, { resolves: 'd1', outcome: 'corrected' }),
      ],
    );
    // The attempt was genuine, so it stays practice (sprout), never a success.
    expect(reading.displayed.state).toBe('sprout');
    expect(reading.award?.attemptEventId).toBe('eb-1');
    expect(reading.correction).toEqual({
      from: 'tree',
      to: 'sprout',
      facts: [
        {
          kind: 'grade-corrected',
          instrumentId: 'eb:a',
          reviewEventId: 'eb-1',
          resolutionEventId: 'd2',
          at: T3,
        },
      ],
    });
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

  it('an attempt that comes to stand when her restore lifts its rejection is awarded from then', () => {
    // [D-396]: only a deliberate restore lifts a rejection (ol-v7r5.101).
    const reading = attain([
      verdict('eb:a', 'rejected', T1, 'v1'),
      explainBack('eb-1', T2),
      { ...verdict('eb:a', 'accepted', T3, 'v2'), restores: 'v1' },
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

// ---------------------------------------------------------------------------
// `ol-egov.141.89.9.66` — the rulings of 2026-09-28 at the entry point.
// ---------------------------------------------------------------------------

function suspendWith(
  instrumentId: string,
  timestamp: string,
  eventId: string,
  reason: 'defect' | 'source-revision' | 'own-choice',
): SuspendLogRecord {
  return { ...suspend(instrumentId, timestamp, eventId), reason } as SuspendLogRecord;
}

describe('rule 1: a personal withdrawal never invalidates sound earlier evidence', () => {
  const attempt = explainBack('eb-1', T1);

  it('her own choice or a revision: the stage and award stand, and current readings count it by default', () => {
    for (const reason of ['own-choice', 'source-revision'] as const) {
      const entries = [attempt, suspendWith('eb:a', T2, 's1', reason)];
      const reading = attain(entries);
      expect(reading.displayed.state).toBe('tree');
      expect(reading.correction).toBeNull();
      const validity = projectInstrumentValidity(entries);
      expect(validity.provenInvalid.size).toBe(0);
    }
    const quiz = review({
      eventId: 'm1',
      timestamp: T1,
      instrumentId: 'mcq:a:1',
      instrumentType: 'mcq',
    });
    const withdrawn = [quiz, suspendWith('mcq:a:1', T2, 's2', 'own-choice')];
    expect(
      readAllCurrentRecognition(
        withdrawn,
        ['concept-a'],
        scheduler,
        new Date(Date.parse(T1) + DAY),
        projectInstrumentValidity(withdrawn),
      ).get('concept-a'),
    ).toBe(true);
  });

  it('a suspension recorded as a defect is proven invalid: displayed falls with the note, the award stays', () => {
    const reading = attain([attempt, suspendWith('eb:a', T3, 's1', 'defect')]);
    expect(reading.displayed.state).toBe('seed');
    expect(reading.award?.attemptEventId).toBe('eb-1');
    expect(reading.correction?.facts).toEqual([
      { kind: 'instrument', instrumentId: 'eb:a', reason: 'defect', eventId: 's1', at: T3 },
    ]);
  });
});

describe('rule 2: a corrected grade uses the corrected verdict; unrelated reviews are never erased', () => {
  const corrected = [
    gradeDispute('eb:a', 'd1', T2),
    gradeDispute('eb:a', 'd2', T3, { resolves: 'd1', outcome: 'corrected' }),
  ];

  it('a corrected verdict that qualifies is read in place of the one it corrects', () => {
    const reading = attain(
      [
        explainBack('eb-1', T1, { correctness: 'incorrect' }),
        explainBack('eb-2', T4, { revisionOf: 'eb-1', correctness: 'correct' }),
      ],
      corrected,
    );
    expect(reading.displayed.state).toBe('tree');
    expect(reading.displayed.evidence.topStageAttempt?.eventId).toBe('eb-2');
    expect(reading.correction).toBeNull();
  });

  it('the instrument’s other attempts stand: an earlier sound attempt keeps the stage', () => {
    const reading = attain(
      [
        explainBack('eb-0', T1, { conceptIds: ['concept-a'] }),
        explainBack('eb-1', '2026-01-11T09:00:00-04:00'),
      ],
      corrected,
    );
    expect(reading.displayed.state).toBe('tree');
    expect(reading.displayed.evidence.topStageAttempt?.eventId).toBe('eb-0');
    expect(reading.correction).toBeNull();
  });

  it('readiness and the recognition credit never replay a corrected answer, and keep the rest', () => {
    const quiz = (eventId: string, timestamp: string, rating: ReviewLogRecord['rating']) =>
      review({ eventId, timestamp, instrumentId: 'mcq:a:1', instrumentType: 'mcq', rating });
    const entries = [quiz('m1', T1, 'good'), quiz('m2', T2, 'good')];
    const onM2 = [
      gradeDispute('mcq:a:1', 'q1', '2026-01-12T08:59:00-04:00'),
      gradeDispute('mcq:a:1', 'q2', T3, { resolves: 'q1', outcome: 'corrected' }),
    ];
    const validity = projectInstrumentValidity(entries, onM2);
    expect([...validity.correctedEvidence.keys()]).toEqual(['m2']);
    const soon = new Date(Date.parse(T1) + DAY);
    // m1 alone still stands as a correct, current answer.
    expect(
      readAllCurrentRecognition(entries, ['concept-a'], scheduler, soon, validity).get('concept-a'),
    ).toBe(true);
    const wrongOnly = [quiz('m1', T1, 'again'), quiz('m2', T2, 'good')];
    const validityWrong = projectInstrumentValidity(wrongOnly, onM2);
    // The corrected m2 no longer stands in for m1's miss.
    expect(
      readAllCurrentRecognition(wrongOnly, ['concept-a'], scheduler, soon, validityWrong).get(
        'concept-a',
      ),
    ).toBe(false);
  });
});

// `ol-egov.141.89.9.84` (`[D-347]`'s split): a changed cited passage not yet revalidated is excluded
// from every current reading under every policy; a sound withdrawal keeps counting under the ruled
// option; the displayed stage and the award keep both.
describe('the passage-validity input, split from a sound withdrawal ([D-347]; A6, A9, E4)', () => {
  const change = (
    states: readonly { at: string; state: PassageChangeFact['revalidation'][number]['state'] }[],
    instrumentIds: readonly string[] = ['qa:a:1'],
  ): PassageChangeFact => ({ instrumentIds, changedAt: T2, revalidation: states });
  const entries: ReviewLogEntry[] = [
    recall('r1', T1, { instrumentId: 'qa:a:1' }),
    recall('r2', T1, { instrumentId: 'qa:a:2', rating: 'again' }),
  ];
  const validity = projectInstrumentValidity(entries);
  const vitalityWeakest = (passageChanges?: readonly PassageChangeFact[]) =>
    readAllEligibleConceptVitality(
      entries,
      ['concept-a'],
      scheduler,
      NOW,
      HOLDING_CUT,
      validity,
      passageChanges === undefined ? {} : { passageChanges },
    ).get('concept-a');
  const readinessOf = (passageChanges?: readonly PassageChangeFact[]) =>
    readAllConceptReadiness(
      entries,
      ['concept-a'],
      scheduler,
      NOW,
      validity,
      passageChanges === undefined ? {} : { passageChanges },
    ).get('concept-a');

  it('a change with no outcome yet is pending: excluded from vitality, readiness, need and recognition', () => {
    const pending = [change([])];
    expect(vitalityWeakest(pending)?.excludedInstrumentIds).toEqual(['qa:a:1']);
    expect(readinessOf(pending)?.weakest).toBeNull();
    expect(readNeed(readinessOf(pending) as never).basis).toBe('unknown');
    const quiz = [
      review({ eventId: 'q1', timestamp: T1, instrumentId: 'mcq:a:1', instrumentType: 'mcq' }),
    ];
    const quizValidity = projectInstrumentValidity(quiz);
    const credit = (passageChanges?: readonly PassageChangeFact[]) =>
      readAllCurrentRecognition(quiz, ['concept-a'], scheduler, new Date(T1), quizValidity, {
        ...(passageChanges === undefined ? {} : { passageChanges }),
      }).get('concept-a');
    expect(credit()).toBe(true);
    expect(credit([{ ...change([], ['mcq:a:1']), changedAt: T1 }])).toBe(false);
  });

  it('material, uncertain and unavailable stay excluded until revalidated; immaterial counts again', () => {
    for (const state of ['material', 'uncertain', 'unavailable'] as const) {
      const unresolved = [change([{ at: T3, state }])];
      expect(vitalityWeakest(unresolved)?.excludedInstrumentIds).toEqual(['qa:a:1']);
      expect(readinessOf(unresolved)?.weakest).toBeNull();
    }
    const resolved = [
      change([
        { at: T2, state: 'pending-revalidation' },
        { at: T3, state: 'immaterial' },
      ]),
    ];
    expect(vitalityWeakest(resolved)?.excludedInstrumentIds).toEqual([]);
    expect(readinessOf(resolved)?.weakest?.instrumentId).toBe('qa:a:1');
  });

  it('is exclusion under every policy, where a sound withdrawal counts under the ruled one', () => {
    const withdrawn = [...entries, suspend('qa:a:1', T2, 's1')];
    const withdrawnValidity = projectInstrumentValidity(withdrawn);
    const readiness = (extra: object) =>
      readAllConceptReadiness(withdrawn, ['concept-a'], scheduler, NOW, withdrawnValidity, {
        withheldEvidence: 'count',
        ...extra,
      }).get('concept-a')?.weakest?.instrumentId ?? null;
    expect(readiness({})).toBe('qa:a:1');
    expect(readiness({ passageChanges: [change([], ['qa:a:2'])] })).toBe('qa:a:1');
    expect(readiness({ passageChanges: [change([], ['qa:a:1'])] })).toBeNull();
  });

  it('a change after the reading instant is not yet a fact; an unreadable instant reads as unresolved', () => {
    const later: PassageChangeFact = {
      instrumentIds: ['qa:a:1'],
      changedAt: '2999-01-01T00:00:00Z',
      revalidation: [],
    };
    expect(unresolvedPassageInstrumentIds([later], NOW).size).toBe(0);
    const unreadable: PassageChangeFact = {
      instrumentIds: ['qa:a:1'],
      changedAt: 'not a date',
      revalidation: [],
    };
    expect([...unresolvedPassageInstrumentIds([unreadable], NOW)]).toEqual(['qa:a:1']);
    expect(unresolvedPassageInstrumentIds(undefined, NOW).size).toBe(0);
  });

  it('the displayed stage and the award keep the changed card; the version says the split was computed', () => {
    const log = [explainBack('eb-1', T1)];
    const v = projectInstrumentValidity(log);
    const plain = readConceptAttainment(log, 'concept-a', v);
    const split = readConceptAttainment(log, 'concept-a', v, {
      passageChanges: [change([], ['eb:a'])],
    });
    expect(split.displayed.state).toBe(plain.displayed.state);
    expect(split.award).toEqual(plain.award);
    expect(split.correction).toBeNull();
    expect(plain.arithmeticVersion).not.toContain('passage=split');
    expect(split.arithmeticVersion).toContain('passage=split');
  });
});

// `ol-egov.141.89.9.85` (R10; the E6 case): a judgement known false from an instant is excluded
// from current readings and from the displayed stage, with a note; the award keeps what stood.
describe('a judgement known false (R10; E6)', () => {
  const log = [explainBack('eb-1', T1)];
  const known = (at: string) => [{ eventId: 'eb-1', knownAt: at }];

  it('the displayed stage falls with a known-false note; the historical award keeps what stood', () => {
    const v = withKnownFalseJudgements(projectInstrumentValidity(log), log, known(T3));
    const reading = readConceptAttainment(log, 'concept-a', v);
    expect(reading.displayed.state).toBe('sprout');
    expect(reading.award?.attemptEventId).toBe('eb-1');
    expect(reading.correction).toEqual({
      from: 'tree',
      to: 'sprout',
      facts: [{ kind: 'known-false', instrumentId: 'eb:a', reviewEventId: 'eb-1', at: T3 }],
    });
  });

  it("only the named review is excluded; the instrument's other reviews stand", () => {
    const two = [recall('r1', T1), recall('r2', T2)];
    const v = withKnownFalseJudgements(projectInstrumentValidity(two), two, [
      { eventId: 'r2', knownAt: T3 },
    ]);
    const reading = readAllEligibleConceptVitality(
      two,
      ['concept-a'],
      scheduler,
      NOW,
      HOLDING_CUT,
      v,
    );
    expect(reading.get('concept-a')?.instrumentsRead).toBe(1);
    const base = readAllEligibleConceptVitality(
      two,
      ['concept-a'],
      scheduler,
      NOW,
      HOLDING_CUT,
      projectInstrumentValidity(two),
    );
    expect(v.correctedEvidence.has('r2')).toBe(true);
    expect(v.correctedEvidence.has('r1')).toBe(false);
    expect(base.get('concept-a')?.instrumentsRead).toBe(1);
  });

  it('readiness no longer counts a known-false success, from the instant it became known', () => {
    const ready = (v: ReturnType<typeof projectInstrumentValidity>) =>
      readAllConceptReadiness([recall('r1', T1)], ['concept-a'], scheduler, NOW, v).get('concept-a')
        ?.weakest?.instrumentId ?? null;
    const base = projectInstrumentValidity([recall('r1', T1)]);
    expect(ready(base)).toBe('qa:a:1');
    expect(
      ready(withKnownFalseJudgements(base, [recall('r1', T1)], [{ eventId: 'r1', knownAt: T3 }])),
    ).toBeNull();
  });

  it('is not the award as of an instant before it was known; a corrective re-grade replaces it', () => {
    const regraded = [
      explainBack('eb-1', T1),
      explainBack('eb-2', T4, { revisionOf: 'eb-1', correctness: 'correct' }),
    ];
    const v = withKnownFalseJudgements(projectInstrumentValidity(regraded), regraded, known(T3));
    const reading = readConceptAttainment(regraded, 'concept-a', v);
    expect(reading.award?.attemptEventId).toBe('eb-1');
    expect(reading.displayed.state).toBe('tree');
  });

  it('names no review in the log, or an unreadable instant: excludes nothing', () => {
    const base = projectInstrumentValidity(log);
    expect(withKnownFalseJudgements(base, log, [{ eventId: 'absent', knownAt: T3 }])).toBe(base);
    expect(withKnownFalseJudgements(base, log, [{ eventId: 'eb-1', knownAt: 'nope' }])).toBe(base);
    expect(withKnownFalseJudgements(base, log, undefined)).toBe(base);
  });
});

// `ol-egov.141.89.9.87` (judgement J3; the ruling of 2026-09-30): a retired predecessor is no separate
// overdue obligation once an ACTIVE successor carries EQUIVALENT qualifying evidence. A recognition
// answer, a failed attempt, an assisted success or a success on a narrower demand does not refresh
// recall of the broader target. Sound historical reviews keep their stage and credit throughout.
describe('a replaced card carries freshness only on equivalent qualifying evidence (J3)', () => {
  const OLD = 'qa:a:old';
  const NEW = 'qa:a:new';
  const policy = { replacedPredecessor: 'successor-with-equivalent-evidence' as const };
  const base = [recall('p1', T1, { instrumentId: OLD }), succession(OLD, NEW, T2)];
  const carriedOf = (log: readonly ReviewLogEntry[], extra: object = {}) =>
    predecessorsCarriedBySuccessor(log, projectInstrumentValidity(log), extra);
  const vitality = (log: readonly ReviewLogEntry[], options: object = policy) =>
    readAllEligibleConceptVitality(
      log,
      ['concept-a'],
      scheduler,
      NOW,
      HOLDING_CUT,
      projectInstrumentValidity(log),
      options,
    ).get('concept-a');

  it("an active successor with an unaided recall success carries the predecessor; today's reading still counts both", () => {
    const log = [...base, recall('s1', T3, { instrumentId: NEW })];
    expect(carriedOf(log).get(OLD)).toBe(NEW);
    const ruled = vitality(log);
    expect(ruled?.excludedInstrumentIds).toEqual([OLD]);
    expect(ruled?.weakest?.instrumentId).toBe(NEW);
    expect(vitality(log, {})?.instrumentsRead).toBe(2);
    expect(DEFAULT_REPLACED_PREDECESSOR_POLICY).toBe('count');
  });

  it('a recognition answer on the successor never refreshes recall of the broader target', () => {
    const log = [
      ...base,
      review({
        eventId: 's1',
        timestamp: T3,
        instrumentId: NEW,
        instrumentType: 'mcq',
        supportLevelShown: undefined,
      }),
    ];
    expect(carriedOf(log).size).toBe(0);
    expect(vitality(log)?.excludedInstrumentIds).toEqual([]);
  });

  it('a failed attempt on the successor never refreshes it either', () => {
    const log = [...base, recall('s1', T3, { instrumentId: NEW, rating: 'again' })];
    expect(carriedOf(log).size).toBe(0);
    expect(vitality(log)?.instrumentsRead).toBe(2);
  });

  it('an assisted success, or one whose assistance the record cannot establish, never qualifies', () => {
    const guided = [...base, recall('s1', T3, { instrumentId: NEW, supportLevelShown: 'guided' })];
    expect(carriedOf(guided).size).toBe(0);
    const unknownHint = [
      ...base,
      recall('s1', T3, { instrumentId: NEW, supportLevelShown: 'prompted' }),
    ];
    expect(carriedOf(unknownHint).size).toBe(0);
    const notOpened = [
      ...base,
      recall('s1', T3, { instrumentId: NEW, supportLevelShown: 'prompted', hintOpened: false }),
    ];
    expect(carriedOf(notOpened).get(OLD)).toBe(NEW);
  });

  it('a success on a narrower demand never refreshes the broader one; one covering every demand does', () => {
    const log = [...base, recall('s1', T3, { instrumentId: NEW })];
    const demands = (successor: readonly string[]) =>
      new Map<string, readonly string[]>([
        [OLD, ['recall-a-fact', 'calculate']],
        [NEW, successor],
      ]);
    expect(carriedOf(log, { instrumentDemands: demands(['recall-a-fact']) }).size).toBe(0);
    expect(
      carriedOf(log, { instrumentDemands: demands(['calculate', 'recall-a-fact']) }).get(OLD),
    ).toBe(NEW);
    // Nothing declared on the predecessor constrains nothing (no demand is inferred).
    expect(
      carriedOf(log, { instrumentDemands: new Map([[NEW, ['recall-a-fact']]]) }).get(OLD),
    ).toBe(NEW);
  });

  it('a successor with no review, a withdrawn one, or one behind an unresolved passage carries nothing', () => {
    expect(carriedOf(base).size).toBe(0);
    const withdrawn = [
      ...base,
      recall('s1', T3, { instrumentId: NEW }),
      suspend(NEW, T4, 's-susp'),
    ];
    expect(carriedOf(withdrawn).size).toBe(0);
    const log = [...base, recall('s1', T3, { instrumentId: NEW })];
    const readiness = readAllConceptReadiness(
      log,
      ['concept-a'],
      scheduler,
      NOW,
      projectInstrumentValidity(log),
      {
        ...policy,
        passageChanges: [{ instrumentIds: [NEW], changedAt: T3, revalidation: [] }],
      },
    ).get('concept-a');
    // The successor is behind an unresolved change, so it is excluded and carries nothing: the predecessor stands.
    expect(readiness?.weakest?.instrumentId).toBe(OLD);
  });

  it('a chain of replacements is carried by the first active link with equivalent evidence', () => {
    const log = [
      recall('p1', T1, { instrumentId: OLD }),
      succession(OLD, NEW, T2),
      succession(NEW, 'qa:a:newer', T3),
      recall('s1', T4, { instrumentId: 'qa:a:newer' }),
    ];
    const carried = carriedOf(log);
    expect(carried.get(OLD)).toBe('qa:a:newer');
    expect(carried.has('qa:a:newer')).toBe(false);
  });

  it("keeps the predecessor's sound reviews for the displayed stage and credit", () => {
    const log = [
      explainBack('eb-1', T1, { instrumentId: 'eb:old' }),
      succession('eb:old', 'eb:new', T2),
      recall('r1', T3, { instrumentId: 'eb:new' }),
    ];
    const v = projectInstrumentValidity(log);
    const plain = readConceptAttainment(log, 'concept-a', v);
    const ruled = readConceptAttainment(log, 'concept-a', v, policy);
    expect(ruled.displayed.state).toBe(plain.displayed.state);
    expect(ruled.award).toEqual(plain.award);
    expect(ruled.arithmeticVersion).toContain('replaced=successor-with-equivalent-evidence');
    expect(plain.arithmeticVersion).not.toContain('replaced=');
  });

  it('readiness reads the successor once it carries the predecessor', () => {
    const log = [...base, recall('s1', T3, { instrumentId: NEW })];
    const readiness = readAllConceptReadiness(
      log,
      ['concept-a'],
      scheduler,
      NOW,
      projectInstrumentValidity(log),
      policy,
    ).get('concept-a');
    expect(readiness?.weakest?.instrumentId).toBe(NEW);
    expect(readiness?.instrumentsRead).toBe(1);
  });
});
