// `ol-egov.141.89.104.56` (`[D-539]`): a current reading that would read evidence whose hold check
// could not be made is unavailable. It is not computed over the rest of the evidence as if that
// were complete, and it is told apart from evidence excluded on purpose, from need unknown (no
// eligible evidence yet, `[D-348]`) and from a low reading. Scenario: olea-service
// `features/F4-oracle.md`, "a reading that would read evidence whose hold check could not be made
// is unavailable, never weak and never a gap". Ids are structural placeholders, never fixture
// vocabulary (INV-3).
import type {
  ReviewLogEntry,
  ReviewLogRecord,
  SuccessionLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { RetrievabilityInput, Scheduler } from '../scheduler/types.js';
import {
  type ConceptReadinessReading,
  type CurrentReadingOrUnavailable,
  readAllConceptReadiness,
  readAllConceptReadinessOrUnavailable,
  readAllCurrentRecognition,
  readAllCurrentRecognitionOrUnavailable,
  readNeed,
  readNeedOrUnavailable,
} from './attainment.js';
import { projectInstrumentValidity } from './validity.js';

const DAY = 24 * 60 * 60 * 1000;
const T1 = '2026-01-10T09:00:00-04:00';
const T2 = '2026-01-12T09:00:00-04:00';
const T3 = '2026-01-15T09:00:00-04:00';
const NOW = new Date(Date.parse(T3) + 2 * DAY);

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'r-default',
    timestamp: T1,
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

/** An unaided recall success: evidence readiness reads. */
function recall(eventId: string, instrumentId: string, concept = 'concept-a'): ReviewLogRecord {
  return review({
    eventId,
    instrumentId,
    conceptIds: [concept],
    supportLevelShown: 'independent',
  });
}

/** A correct quiz answer: evidence the recognition credit reads. */
function quiz(eventId: string, instrumentId: string, concept = 'concept-a'): ReviewLogRecord {
  return review({ eventId, instrumentId, instrumentType: 'mcq', conceptIds: [concept] });
}

function rejected(instrumentId: string, eventId: string): VerdictLogRecord {
  return {
    schemaVersion: 6,
    kind: 'verdict',
    eventId,
    timestamp: T2,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict: 'rejected',
    artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
  };
}

function succession(predecessor: string, successor: string): SuccessionLogRecord {
  return {
    schemaVersion: 6,
    kind: 'succession',
    eventId: `s-${predecessor}`,
    timestamp: T2,
    predecessorInstrumentId: predecessor,
    successorInstrumentId: successor,
  };
}

/** FSRS for scheduling, and a fixed recall estimate per instrument, so each reading is legible. */
function recallScheduler(recallById: Readonly<Record<string, number>>): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability: (input: RetrievabilityInput) => ({
      instrumentId: input.instrumentId,
      recallProbability: recallById[input.instrumentId] ?? 0.5,
    }),
    ...(real.configuration !== undefined ? { configuration: real.configuration } : {}),
  };
}

const scheduler = recallScheduler({ 'qa:a:weak': 0.3, 'qa:a:strong': 0.95, 'mcq:a:1': 0.95 });

function readiness(
  entries: readonly ReviewLogEntry[],
  unknown: readonly string[],
  options: Parameters<typeof readAllConceptReadiness>[5] = {},
  concepts: readonly string[] = ['concept-a'],
) {
  return readAllConceptReadinessOrUnavailable(
    entries,
    concepts,
    scheduler,
    NOW,
    projectInstrumentValidity(entries),
    new Set(unknown),
    options,
  );
}

function plainReadiness(
  entries: readonly ReviewLogEntry[],
  options: Parameters<typeof readAllConceptReadiness>[5] = {},
  concepts: readonly string[] = ['concept-a'],
) {
  return readAllConceptReadiness(
    entries,
    concepts,
    scheduler,
    NOW,
    projectInstrumentValidity(entries),
    options,
  );
}

function available<T>(reading: CurrentReadingOrUnavailable<T> | undefined): T {
  if (reading?.status !== 'available') throw new Error('expected an available reading');
  return reading.reading;
}

describe('a reading that would read evidence whose hold check could not be made is unavailable ([D-539])', () => {
  it('readiness is unavailable, names the unknown evidence, and carries no number', () => {
    const entries = [recall('r1', 'qa:a:weak'), recall('r2', 'qa:a:strong')];
    const reading = readiness(entries, ['qa:a:weak']).get('concept-a');
    expect(reading).toEqual({
      status: 'unavailable',
      evidenceUnknownInstrumentIds: ['qa:a:weak'],
      arithmeticVersion: plainReadiness(entries).get('concept-a')?.arithmeticVersion,
    });
    expect(reading).not.toHaveProperty('reading');
    expect(reading).not.toHaveProperty('weakest');
  });

  it('it is never computed over the rest as if that were complete: excluding the same evidence would credit her', () => {
    const entries = [recall('r1', 'qa:a:weak'), recall('r2', 'qa:a:strong')];
    // Removing the weak card on purpose (a changed passage not yet revalidated) reads the strong
    // one alone: a higher readiness than her evidence shows. The unknown input never does that.
    const excluded = plainReadiness(entries, {
      passageChanges: [{ instrumentIds: ['qa:a:weak'], changedAt: T2, revalidation: [] }],
    }).get('concept-a');
    expect(excluded?.weakest).toEqual({ instrumentId: 'qa:a:strong', recallProbability: 0.95 });
    expect(readiness(entries, ['qa:a:weak']).get('concept-a')?.status).toBe('unavailable');
  });

  it('need from an unavailable readiness is unavailable, never need unknown ("no recall evidence yet")', () => {
    const entries = [recall('r1', 'qa:a:weak')];
    const need = readNeedOrUnavailable(
      readiness(entries, ['qa:a:weak']).get(
        'concept-a',
      ) as CurrentReadingOrUnavailable<ConceptReadinessReading>,
    );
    expect(need.status).toBe('unavailable');
    expect(need).not.toHaveProperty('reading');
    // Excluding the same card leaves no eligible evidence: that is need unknown, a different fact.
    const excluded = plainReadiness(entries, {
      passageChanges: [{ instrumentIds: ['qa:a:weak'], changedAt: T2, revalidation: [] }],
    }).get('concept-a');
    if (excluded === undefined) throw new Error('expected a reading');
    expect(readNeed(excluded).basis).toBe('unknown');
    // An available readiness gives exactly readNeed's reading.
    const clear = plainReadiness(entries).get('concept-a');
    if (clear === undefined) throw new Error('expected a reading');
    expect(readNeedOrUnavailable({ status: 'available', reading: clear })).toEqual({
      status: 'available',
      reading: readNeed(clear),
    });
    expect(() =>
      readNeedOrUnavailable(
        { status: 'unavailable', evidenceUnknownInstrumentIds: ['x'], arithmeticVersion: 'v' },
        { unknownNeedValue: 2 },
      ),
    ).toThrow(RangeError);
  });

  it('the recognition credit is unavailable, never "no current answer", when a quiz item it reads is unknown', () => {
    const entries = [quiz('m1', 'mcq:a:1')];
    const validity = projectInstrumentValidity(entries);
    const soon = new Date(Date.parse(T1) + DAY);
    expect(
      readAllCurrentRecognition(entries, ['concept-a'], scheduler, soon, validity).get('concept-a'),
    ).toBe(true);
    const credit = readAllCurrentRecognitionOrUnavailable(
      entries,
      ['concept-a'],
      scheduler,
      soon,
      validity,
      new Set(['mcq:a:1']),
    ).get('concept-a');
    expect(credit?.status).toBe('unavailable');
    expect(credit).not.toHaveProperty('reading');
  });
});

describe('what stays exactly as before', () => {
  it('a concept whose readings read no unknown evidence reads what the plain readers read', () => {
    const entries = [
      recall('r1', 'qa:a:weak'),
      recall('r2', 'qa:b:1', 'concept-b'),
      quiz('m1', 'mcq:b:1', 'concept-b'),
    ];
    const concepts = ['concept-a', 'concept-b'];
    const unknown = readiness(entries, ['qa:a:weak'], {}, concepts);
    expect(unknown.get('concept-a')?.status).toBe('unavailable');
    expect(available(unknown.get('concept-b'))).toEqual(
      plainReadiness(entries, {}, concepts).get('concept-b'),
    );
    const validity = projectInstrumentValidity(entries);
    const credit = readAllCurrentRecognitionOrUnavailable(
      entries,
      concepts,
      scheduler,
      NOW,
      validity,
      new Set(['qa:a:weak']),
    );
    const plainCredit = readAllCurrentRecognition(entries, concepts, scheduler, NOW, validity);
    expect(available(credit.get('concept-a'))).toBe(plainCredit.get('concept-a'));
    expect(available(credit.get('concept-b'))).toBe(plainCredit.get('concept-b'));
  });

  it('with nothing unknown, every reading is available and equal to the plain reader', () => {
    const entries = [
      recall('r1', 'qa:a:weak'),
      recall('r2', 'qa:a:strong'),
      quiz('m1', 'mcq:a:1'),
      recall('r3', 'qa:b:1', 'concept-b'),
    ];
    const concepts = ['concept-a', 'concept-b', 'concept-never-named'];
    const plain = plainReadiness(entries, {}, concepts);
    for (const [id, reading] of readiness(entries, [], {}, concepts)) {
      expect(available(reading)).toEqual(plain.get(id));
    }
    const validity = projectInstrumentValidity(entries);
    const plainCredit = readAllCurrentRecognition(entries, concepts, scheduler, NOW, validity);
    for (const [id, credit] of readAllCurrentRecognitionOrUnavailable(
      entries,
      concepts,
      scheduler,
      NOW,
      validity,
      new Set(),
    )) {
      expect(available(credit)).toBe(plainCredit.get(id));
    }
  });

  it('evidence excluded on purpose stays excluded whatever its hold check says, and makes nothing unavailable', () => {
    const proven = [
      recall('r1', 'qa:a:weak'),
      rejected('qa:a:weak', 'v1'),
      recall('r2', 'qa:a:strong'),
    ];
    expect(available(readiness(proven, ['qa:a:weak']).get('concept-a'))).toEqual(
      plainReadiness(proven).get('concept-a'),
    );
    const changed = [recall('r1', 'qa:a:weak'), recall('r2', 'qa:a:strong')];
    const passageChanges = [{ instrumentIds: ['qa:a:weak'], changedAt: T2, revalidation: [] }];
    expect(
      available(readiness(changed, ['qa:a:weak'], { passageChanges }).get('concept-a')),
    ).toEqual(plainReadiness(changed, { passageChanges }).get('concept-a'));
  });

  it('unknown evidence a reading does not read leaves that reading available', () => {
    // A quiz item: readiness never reads recognition, so readiness stands; the credit does read it.
    const entries = [recall('r1', 'qa:a:strong'), quiz('m1', 'mcq:a:1')];
    expect(available(readiness(entries, ['mcq:a:1']).get('concept-a'))).toEqual(
      plainReadiness(entries).get('concept-a'),
    );
    // A recall card with only an assisted success: readiness does not read it either.
    const assisted = [
      recall('r1', 'qa:a:strong'),
      review({ eventId: 'r2', instrumentId: 'qa:a:assisted', supportLevelShown: 'prompted' }),
    ];
    expect(available(readiness(assisted, ['qa:a:assisted']).get('concept-a'))).toEqual(
      plainReadiness(assisted).get('concept-a'),
    );
  });
});

describe('a replaced card (J3): a predecessor left out only while an unknown successor stands', () => {
  const OLD = 'qa:a:old';
  const NEW = 'qa:a:new';
  // The successor's lightly assisted success carries the predecessor's freshness (J3), but it is not
  // an unaided success, so readiness never reads the successor itself.
  const log = [
    recall('p1', OLD),
    succession(OLD, NEW),
    review({
      eventId: 's1',
      timestamp: T3,
      instrumentId: NEW,
      supportLevelShown: 'prompted',
      hintOpened: false,
    }),
  ];

  it('an unknown successor that carries a predecessor readiness would read makes readiness unavailable, naming the successor', () => {
    // Plainly: the predecessor is carried, the successor is not read, so nothing is read.
    expect(plainReadiness(log).get('concept-a')?.weakest).toBeNull();
    expect(readiness(log, [NEW]).get('concept-a')).toMatchObject({
      status: 'unavailable',
      evidenceUnknownInstrumentIds: [NEW],
    });
  });

  it('an unknown predecessor carried by a standing successor is left out either way: readiness stands', () => {
    expect(available(readiness(log, [OLD]).get('concept-a'))).toEqual(
      plainReadiness(log).get('concept-a'),
    );
  });
});
