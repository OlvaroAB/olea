// `ol-egov.141.89.9.4`: when a declared demand counts as met now — `[D-349]`,
// OPEN (the attainment chain spec's proposal 5 in `olea-service`; failure
// classes N4 and N5). Built as a pure function over demands passed in, with
// the rule a REQUIRED argument so no reader adopts an unruled rule by default.
// Ids are structural placeholders, never fixture vocabulary (INV-3).
import type { ReviewLogEntry, ReviewLogRecord, VerdictLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { projectInstrumentValidity } from '../mastery/validity.js';
import type { PaperDemand } from '../oracle/paper-types.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import { type DemandRule, demandsMetNow } from './demand.js';

const DAY = 24 * 60 * 60 * 1000;
const T1 = '2026-03-01T09:00:00-04:00';
const SOON = new Date(Date.parse(T1) + DAY);
const MUCH_LATER = new Date(Date.parse(T1) + 200 * DAY);
const scheduler = createFsrsScheduler();

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'r1',
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
    supportLevelShown: 'independent',
    ...overrides,
  };
}

function rejected(instrumentId: string): VerdictLogRecord {
  return {
    schemaVersion: 5,
    kind: 'verdict',
    eventId: `v-${instrumentId}`,
    timestamp: T1,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict: 'rejected',
    artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
  };
}

function met(
  rule: DemandRule,
  entries: readonly ReviewLogEntry[],
  declared: readonly PaperDemand[],
  instrumentDemands: ReadonlyMap<string, readonly PaperDemand[]>,
  now: Date = SOON,
) {
  return demandsMetNow(
    {
      conceptId: 'concept-a',
      declaredDemands: declared,
      instrumentDemands,
      entries,
      validity: projectInstrumentValidity(entries),
      scheduler,
      now,
    },
    rule,
  );
}

const RECALL_FACT = new Map<string, readonly PaperDemand[]>([['qa:a:1', ['recall-a-fact']]]);

describe('(a) qualifying-review: the proposed conservative rule', () => {
  it('an independent, current, standing recall success from an instrument declaring the demand meets it', () => {
    const result = met('qualifying-review', [review()], ['recall-a-fact'], RECALL_FACT);
    expect([...result.met]).toEqual(['recall-a-fact']);
    expect(result.unmet).toEqual([]);
  });

  it('evidence of another demand never meets this one (N4)', () => {
    const result = met('qualifying-review', [review()], ['apply-to-unfamiliar-case'], RECALL_FACT);
    expect(result.unmet).toEqual(['apply-to-unfamiliar-case']);
  });

  it('a demand label on an assisted success does not meet it (N4)', () => {
    const result = met(
      'qualifying-review',
      [review({ supportLevelShown: 'prompted' })],
      ['recall-a-fact'],
      RECALL_FACT,
    );
    expect(result.unmet).toEqual(['recall-a-fact']);
  });

  it('a quiz answer never shows unaided recall of a fact, whatever its label (N4)', () => {
    const quiz = review({ instrumentId: 'mcq:a:1', instrumentType: 'mcq' });
    const result = met(
      'qualifying-review',
      [quiz],
      ['recall-a-fact'],
      new Map([['mcq:a:1', ['recall-a-fact'] as const]]),
    );
    expect(result.unmet).toEqual(['recall-a-fact']);
  });

  it('a quiz answer can meet a demand other than recall-a-fact (recognition has no ladder)', () => {
    const quiz = review({ instrumentId: 'mcq:a:1', instrumentType: 'mcq' });
    delete (quiz as { supportLevelShown?: unknown }).supportLevelShown;
    const result = met(
      'qualifying-review',
      [quiz],
      ['compare-or-choose'],
      new Map([['mcq:a:1', ['compare-or-choose'] as const]]),
    );
    expect([...result.met]).toEqual(['compare-or-choose']);
  });

  it('a stale success (past due now) does not meet it', () => {
    const result = met('qualifying-review', [review()], ['recall-a-fact'], RECALL_FACT, MUCH_LATER);
    expect(result.unmet).toEqual(['recall-a-fact']);
  });

  it('a failed review does not meet it', () => {
    const result = met(
      'qualifying-review',
      [review({ rating: 'again' })],
      ['recall-a-fact'],
      RECALL_FACT,
    );
    expect(result.unmet).toEqual(['recall-a-fact']);
  });
});

describe('(b) any-past-success: the alternative', () => {
  it('an assisted or stale success meets it', () => {
    const assisted = met(
      'any-past-success',
      [review({ supportLevelShown: 'guided' })],
      ['recall-a-fact'],
      RECALL_FACT,
      MUCH_LATER,
    );
    expect([...assisted.met]).toEqual(['recall-a-fact']);
  });

  it('evidence of another demand still never meets this one', () => {
    const result = met('any-past-success', [review()], ['calculate'], RECALL_FACT);
    expect(result.unmet).toEqual(['calculate']);
  });
});

describe('under every rule, proven-invalid evidence never meets a demand ([D-338] item 3)', () => {
  it('a rejected instrument meets nothing', () => {
    for (const rule of ['qualifying-review', 'any-past-success'] as const) {
      const result = met(rule, [review(), rejected('qa:a:1')], ['recall-a-fact'], RECALL_FACT);
      expect(result.unmet).toEqual(['recall-a-fact']);
    }
  });
});

describe('the declared demands are the question; nothing is inferred (R7, N5)', () => {
  it('no declared demands means nothing unmet and nothing met — never a demand inferred from tier', () => {
    const result = met('qualifying-review', [review()], [], RECALL_FACT);
    expect(result.met.size).toBe(0);
    expect(result.unmet).toEqual([]);
  });

  it('an instrument that declares nothing meets nothing', () => {
    const result = met('qualifying-review', [review()], ['recall-a-fact'], new Map());
    expect(result.unmet).toEqual(['recall-a-fact']);
  });

  it('unmet keeps the declared order and has no duplicates', () => {
    const result = met(
      'qualifying-review',
      [],
      ['calculate', 'recall-a-fact', 'calculate'],
      RECALL_FACT,
    );
    expect(result.unmet).toEqual(['calculate', 'recall-a-fact']);
  });

  it('an unknown rule is a programmer error, loudly', () => {
    expect(() => met('bogus' as DemandRule, [review()], ['recall-a-fact'], RECALL_FACT)).toThrow(
      /rule/,
    );
  });
});
