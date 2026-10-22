// `ol-egov.141.89.104.33` (the reader floor; `[D-500]`, `[D-539]`, `[D-347]`): evidence a readable
// hold withholds is left out of every current reading, exactly as a changed passage not yet
// revalidated is, and the displayed stage keeps it. With no held input every reading is exactly
// today's. Scenario: olea-service `features/F4-oracle.md`, "evidence a readable hold withholds is
// left out of current readings". Ids are structural placeholders, never fixture vocabulary (INV-3).
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { unmetDemandsByConcept } from '../gap/demand.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { RetrievabilityInput, Scheduler } from '../scheduler/types.js';
import {
  type AttainmentOptions,
  readAllConceptAttainment,
  readAllConceptReadiness,
  readAllConceptReadinessOrUnavailable,
  readAllCurrentRecognition,
  readAllEligibleConceptVitality,
  readNeed,
  unresolvedPassageInstrumentIds,
  unresolvedSupportInstrumentIds,
} from './attainment.js';
import { HOLDING_CUT } from './rollup.js';
import { projectInstrumentValidity } from './validity.js';

const DAY = 24 * 60 * 60 * 1000;
const T1 = '2026-01-10T09:00:00-04:00';
const T2 = '2026-01-12T09:00:00-04:00';
const NOW = new Date(Date.parse(T2) + 3 * DAY);

const WEAK = 'qa:a:weak';
const STRONG = 'qa:a:strong';
const QUIZ = 'mcq:a:1';
const CONCEPTS = ['concept-a', 'concept-b'] as const;

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'r-default',
    timestamp: T1,
    instrumentId: STRONG,
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

/** An unaided recall success: evidence readiness and vitality read. */
function recall(eventId: string, instrumentId: string, concept = 'concept-a'): ReviewLogRecord {
  return review({ eventId, instrumentId, conceptIds: [concept], supportLevelShown: 'independent' });
}

/** A correct quiz answer: evidence the recognition credit reads. */
function quiz(eventId: string, instrumentId: string, concept = 'concept-a'): ReviewLogRecord {
  return review({ eventId, instrumentId, instrumentType: 'mcq', conceptIds: [concept] });
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

const scheduler = recallScheduler({ [WEAK]: 0.3, [STRONG]: 0.95, [QUIZ]: 0.95, 'qa:b:1': 0.6 });

/** Two instruments on concept A (one weak, one strong), a quiz item on A, and a card on B. */
const entries: readonly ReviewLogEntry[] = [
  recall('r1', WEAK),
  recall('r2', STRONG),
  quiz('q1', QUIZ),
  recall('r3', 'qa:b:1', 'concept-b'),
];

const validity = projectInstrumentValidity(entries);

const readiness = (log: readonly ReviewLogEntry[], options: AttainmentOptions = {}) =>
  readAllConceptReadiness(log, CONCEPTS, scheduler, NOW, projectInstrumentValidity(log), options);

const recognition = (log: readonly ReviewLogEntry[], options: AttainmentOptions = {}) =>
  readAllCurrentRecognition(log, CONCEPTS, scheduler, NOW, projectInstrumentValidity(log), options);

const vitality = (log: readonly ReviewLogEntry[], options: AttainmentOptions = {}) =>
  readAllEligibleConceptVitality(
    log,
    CONCEPTS,
    scheduler,
    NOW,
    HOLDING_CUT,
    projectInstrumentValidity(log),
    options,
  );

const held = (...ids: string[]): AttainmentOptions => ({ heldEvidence: new Set(ids) });

describe('with no held input, every reading is exactly as before (ol-egov.141.89.104.33)', () => {
  it('absent, or an empty set, leaves readiness, the credit, eligible vitality and the stage unchanged', () => {
    for (const options of [{}, held()]) {
      expect(readiness(entries, options)).toEqual(readiness(entries));
      expect(recognition(entries, options)).toEqual(recognition(entries));
      expect(vitality(entries, options)).toEqual(vitality(entries));
      expect(readAllConceptAttainment(entries, CONCEPTS, validity, options)).toEqual(
        readAllConceptAttainment(entries, CONCEPTS, validity),
      );
    }
  });

  it('the union helper is exactly the unrevalidated-passage set when nothing is held', () => {
    const passageChanges = [{ instrumentIds: [WEAK], changedAt: T2, revalidation: [] }];
    expect(unresolvedSupportInstrumentIds({ passageChanges }, NOW)).toEqual(
      unresolvedPassageInstrumentIds(passageChanges, NOW),
    );
    expect(
      unresolvedSupportInstrumentIds({ passageChanges, heldEvidence: new Set() }, NOW),
    ).toEqual(unresolvedPassageInstrumentIds(passageChanges, NOW));
    expect(
      [
        ...unresolvedSupportInstrumentIds({ passageChanges, heldEvidence: new Set([QUIZ]) }, NOW),
      ].sort(),
    ).toEqual([QUIZ, WEAK].sort());
  });
});

describe('evidence a readable hold withholds is left out of every current reading ([D-500], [D-347])', () => {
  it('readiness: the held weak instrument is not read, so the weakest is the strong one; the other concept is untouched', () => {
    const before = readiness(entries);
    expect(before.get('concept-a')?.weakest?.instrumentId).toBe(WEAK);
    const after = readiness(entries, held(WEAK));
    expect(after.get('concept-a')?.weakest?.instrumentId).toBe(STRONG);
    expect(after.get('concept-b')).toEqual(before.get('concept-b'));
  });

  it('need: a concept resting on held evidence alone reads need unknown, never a low reading ([D-348])', () => {
    const after = readiness(entries, held(WEAK, STRONG)).get('concept-a');
    if (after === undefined) throw new Error('expected a reading');
    expect(after.weakest).toBeNull();
    expect(readNeed(after).basis).toBe('unknown');
  });

  it('held reads exactly as a changed passage not yet revalidated, in readiness, the credit and vitality', () => {
    const passage: AttainmentOptions = {
      passageChanges: [{ instrumentIds: [WEAK, QUIZ], changedAt: T2, revalidation: [] }],
    };
    // The readings carry the arithmetic version; a passage input names its split there, a held
    // input names nothing new. Compare the readings with the version set aside.
    const strip = <T extends { arithmeticVersion: string }>(
      map: ReadonlyMap<string, T>,
    ): Map<string, Omit<T, 'arithmeticVersion'>> =>
      new Map([...map].map(([key, { arithmeticVersion: _version, ...rest }]) => [key, rest]));
    expect(strip(readiness(entries, held(WEAK, QUIZ)))).toEqual(strip(readiness(entries, passage)));
    expect(recognition(entries, held(WEAK, QUIZ))).toEqual(recognition(entries, passage));
    expect(strip(vitality(entries, held(WEAK, QUIZ)))).toEqual(strip(vitality(entries, passage)));
  });

  it('the recognition credit: a correct, current answer on a held quiz item earns no credit', () => {
    expect(recognition(entries).get('concept-a')).toBe(true);
    expect(recognition(entries, held(QUIZ)).get('concept-a')).toBe(false);
  });

  it('eligible vitality: the held instrument is left out and named as excluded', () => {
    const after = vitality(entries, held(WEAK)).get('concept-a');
    expect(after?.excludedInstrumentIds).toEqual([WEAK]);
    expect(vitality(entries).get('concept-a')?.excludedInstrumentIds).toEqual([]);
  });

  it('a demand met now: a review on a held instrument shows no demand', () => {
    const read = ({ heldEvidence }: AttainmentOptions) =>
      unmetDemandsByConcept({
        declaredDemands: new Map([['concept-a', ['recall-a-fact' as const]]]),
        instrumentDemands: new Map([[STRONG, ['recall-a-fact' as const]]]),
        entries,
        validity,
        scheduler,
        now: NOW,
        ...(heldEvidence !== undefined ? { heldEvidence } : {}),
      });
    expect(read({}).get('concept-a')).toEqual([]);
    expect(read(held(STRONG)).get('concept-a')).toEqual(['recall-a-fact']);
    expect(read(held())).toEqual(read({}));
  });

  it('the displayed stage keeps held evidence ([D-338]: a hold on the floor proves nothing invalid)', () => {
    const all = held(WEAK, STRONG, QUIZ, 'qa:b:1');
    expect(readAllConceptAttainment(entries, CONCEPTS, validity, all)).toEqual(
      readAllConceptAttainment(entries, CONCEPTS, validity),
    );
  });

  it('the arithmetic version names nothing new for a held input', () => {
    expect(readiness(entries, held(WEAK)).get('concept-a')?.arithmeticVersion).toBe(
      readiness(entries).get('concept-a')?.arithmeticVersion,
    );
  });
});

describe('held evidence never makes a reading unavailable ([D-539])', () => {
  it('held alone: the reading is made, over the rest', () => {
    const reading = readAllConceptReadinessOrUnavailable(
      entries,
      CONCEPTS,
      scheduler,
      NOW,
      validity,
      new Set(),
      held(WEAK),
    ).get('concept-a');
    expect(reading?.status).toBe('available');
    if (reading?.status === 'available') {
      expect(reading.reading.weakest?.instrumentId).toBe(STRONG);
    }
  });

  it('held evidence is excluded on purpose, so its hold check result makes nothing unavailable', () => {
    const reading = readAllConceptReadinessOrUnavailable(
      entries,
      CONCEPTS,
      scheduler,
      NOW,
      validity,
      new Set([WEAK]),
      held(WEAK),
    ).get('concept-a');
    expect(reading?.status).toBe('available');
  });
});
