/**
 * `[D-437]` demand carriage, B4 (`ol-egov.141.89.2.26`), the draft-record half: what a drafted
 * question carries about the demand its request asked for, until it is accepted.
 *
 * The carriage is plugin-local and additive (`DraftRecord.demand`, optional): `packages/contracts`
 * is untouched, nothing here is a wire field, and a record cached before this field existed, or
 * for a need that asked for nothing, carries none and stays unspecified for ever (design section
 * 3.1). Every fixture below is invented, so INV-3 does not apply to this file.
 */
import { PAPER_DEMANDS } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  draftDemandCarriage,
  draftedDemandFactsOf,
  extractDraftedDemand,
} from '../../src/generation/draft-demand.js';
import { type DraftRecord, isDraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const HEADING = 'What is an invented term?';

function envelope(result: Record<string, unknown>): unknown {
  return {
    ok: true,
    stamp: { taskId: 'quiz.generate.v1', promptVersion: '2.4.0', modelId: 'test-model' },
    result,
  };
}

const QUESTIONS = [
  { stem: 'Q1', correctAnswer: 'A1', distractors: ['x', 'y', 'z'], feedback: 'f1' },
  { stem: 'Q2', correctAnswer: 'A2', distractors: ['x', 'y', 'z'], feedback: 'f2' },
];

describe('extractDraftedDemand: what the request carried and the response returned', () => {
  it('a request that carried no demand yields no carriage for any question, whatever the response says', () => {
    const carry = extractDraftedDemand(
      {},
      envelope({
        questions: QUESTIONS.map((q) => ({ ...q, declaredDemand: 'recall-a-fact' })),
        demandAcknowledgement: { intendedDemand: 'recall-a-fact' },
      }),
    );
    expect(carry.intendedDemand).toBeUndefined();
    expect(draftDemandCarriage(carry, 0, 'sweep')).toBeUndefined();
    expect(draftDemandCarriage(carry, 1, 'sweep')).toBeUndefined();
  });

  it('carries the intended demand, the acknowledgement and each question’s own declaration by position', () => {
    const carry = extractDraftedDemand(
      { intendedDemand: 'recall-a-fact' },
      envelope({
        questions: [
          { ...QUESTIONS[0], declaredDemand: 'recall-a-fact' },
          { ...QUESTIONS[1], declaredDemand: 'calculate' },
        ],
        demandAcknowledgement: { intendedDemand: 'recall-a-fact' },
      }),
    );
    expect(draftDemandCarriage(carry, 0, 'sweep')).toEqual({
      origin: 'sweep',
      intendedDemand: 'recall-a-fact',
      acknowledgedDemand: 'recall-a-fact',
      declaredDemand: 'recall-a-fact',
    });
    expect(draftDemandCarriage(carry, 1, 'sweep')).toEqual({
      origin: 'sweep',
      intendedDemand: 'recall-a-fact',
      acknowledgedDemand: 'recall-a-fact',
      declaredDemand: 'calculate',
    });
    // A position the response has no entry for carries the request's facts and no declaration,
    // which the check reads as no agreement, never as agreement.
    expect(draftDemandCarriage(carry, 2, 'sweep')?.declaredDemand).toBeUndefined();
  });

  it('keeps the heading and question word (row 35) exactly as the request carried them, for a heading-cue draft', () => {
    const carry = extractDraftedDemand(
      {
        intendedDemand: 'recall-a-fact',
        requestedAsk: { heading: HEADING, questionWord: 'What' },
      },
      envelope({
        questions: [{ ...QUESTIONS[0], declaredDemand: 'recall-a-fact' }],
        demandAcknowledgement: { intendedDemand: 'recall-a-fact' },
      }),
    );
    expect(draftDemandCarriage(carry, 0, 'heading-cue')?.requestedAsk).toEqual({
      heading: HEADING,
      questionWord: 'What',
    });
  });

  it('a response with no acknowledgement (an older Worker) still records the skew: the intended demand, and no acknowledgement', () => {
    const carry = extractDraftedDemand(
      { intendedDemand: 'recall-a-fact' },
      envelope({ questions: [QUESTIONS[0]] }),
    );
    const carriage = draftDemandCarriage(carry, 0, 'sweep');
    expect(carriage).toEqual({ origin: 'sweep', intendedDemand: 'recall-a-fact' });
    expect(carriage?.acknowledgedDemand).toBeUndefined();
  });

  it('a word outside the five is read as absent, never coerced: an out-of-vocabulary declaration is no agreement', () => {
    const carry = extractDraftedDemand(
      { intendedDemand: 'recall-a-fact' },
      envelope({
        questions: [{ ...QUESTIONS[0], declaredDemand: 'explain' }],
        demandAcknowledgement: { intendedDemand: 'explain' },
      }),
    );
    const carriage = draftDemandCarriage(carry, 0, 'sweep');
    expect(carriage?.declaredDemand).toBeUndefined();
    expect(carriage?.acknowledgedDemand).toBeUndefined();
  });

  it('a response that is not an ok envelope carries the intended demand and nothing returned', () => {
    for (const response of [null, 'nope', { ok: false }, { ok: true }, { ok: true, result: 3 }]) {
      const carry = extractDraftedDemand({ intendedDemand: 'recall-a-fact' }, response);
      expect(draftDemandCarriage(carry, 0, 'sweep')).toEqual({
        origin: 'sweep',
        intendedDemand: 'recall-a-fact',
      });
    }
  });

  it('the facts the materialiser judges are the carriage, member for member', () => {
    expect(
      draftedDemandFactsOf({
        origin: 'revision',
        intendedDemand: 'recall-a-fact',
        acknowledgedDemand: 'recall-a-fact',
        declaredDemand: 'calculate',
      }),
    ).toEqual({
      intendedDemand: 'recall-a-fact',
      acknowledgedDemand: 'recall-a-fact',
      declaredDemand: 'calculate',
    });
    expect(draftedDemandFactsOf({ origin: 'sweep', intendedDemand: 'recall-a-fact' })).toEqual({
      intendedDemand: 'recall-a-fact',
    });
  });
});

function baseRecord(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'draft-demand-1',
    status: 'pending',
    courseCode: 'COURSE-A',
    conceptName: 'An invented concept',
    conceptIds: ['concept-key-1'],
    sourcePath: '01 Courses/COURSE-A/Week 1.md',
    createdAt: '2026-09-29T09:00:00-07:00',
    question: { stem: 'Q1', correctAnswer: 'A1', distractors: ['x', 'y', 'z'], feedback: 'f1' },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '2.4.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

describe('DraftRecord.demand: additive, optional, plugin-local', () => {
  it('a record with no demand (every draft cached before this field, and every unspecified need) is still a draft record', () => {
    expect(isDraftRecord(baseRecord())).toBe(true);
  });

  it('accepts a well-formed carriage on an mcq-kind record and on a qa-kind record', () => {
    const demand = {
      origin: 'heading-cue',
      intendedDemand: 'recall-a-fact',
      requestedAsk: { heading: HEADING, questionWord: 'What' },
      acknowledgedDemand: 'recall-a-fact',
      declaredDemand: 'recall-a-fact',
    } as const;
    expect(isDraftRecord(baseRecord({ demand }))).toBe(true);
    const { question: _question, ...noQuestion } = baseRecord();
    expect(
      isDraftRecord({
        ...noQuestion,
        instrumentType: 'qa',
        card: { front: 'F', back: 'B' },
        demand,
      }),
    ).toBe(true);
  });

  it('accepts every demand word the vocabulary has, and every origin a draft can come from', () => {
    for (const word of PAPER_DEMANDS) {
      expect(isDraftRecord(baseRecord({ demand: { origin: 'sweep', intendedDemand: word } }))).toBe(
        true,
      );
    }
    for (const origin of ['sweep', 'heading-cue', 'revision', 'planner-need'] as const) {
      expect(
        isDraftRecord(baseRecord({ demand: { origin, intendedDemand: 'recall-a-fact' } })),
      ).toBe(true);
    }
  });

  it('rejects a malformed carriage rather than reading it as a demand', () => {
    const bad: readonly unknown[] = [
      null,
      'recall-a-fact',
      {},
      { origin: 'sweep' },
      { intendedDemand: 'recall-a-fact' },
      // An origin outside the closed list, and the one origin no draft comes from.
      { origin: 'somewhere', intendedDemand: 'recall-a-fact' },
      { origin: 'paper-handoff', intendedDemand: 'recall-a-fact' },
      // A word outside the five, in each of the three places a word sits.
      { origin: 'sweep', intendedDemand: 'explain' },
      { origin: 'sweep', intendedDemand: 'recall-a-fact', acknowledgedDemand: 'explain' },
      { origin: 'sweep', intendedDemand: 'recall-a-fact', declaredDemand: 42 },
      // A heading that is not a non-blank string.
      { origin: 'heading-cue', intendedDemand: 'recall-a-fact', requestedAsk: { heading: '  ' } },
      { origin: 'heading-cue', intendedDemand: 'recall-a-fact', requestedAsk: { heading: 3 } },
      {
        origin: 'heading-cue',
        intendedDemand: 'recall-a-fact',
        requestedAsk: { heading: HEADING, questionWord: '' },
      },
    ];
    for (const demand of bad) {
      expect(isDraftRecord({ ...baseRecord(), demand }), JSON.stringify(demand)).toBe(false);
    }
  });
});

describe('the draft cache carries the demand through every rewrite of the record', () => {
  it('round-trips the carriage, and keeps it when the record moves from pending to accepted', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const record = baseRecord({
      demand: {
        origin: 'heading-cue',
        intendedDemand: 'recall-a-fact',
        requestedAsk: { heading: HEADING, questionWord: 'What' },
        acknowledgedDemand: 'recall-a-fact',
        declaredDemand: 'recall-a-fact',
      },
    });
    await cache.put(record);
    expect(await cache.get(record.draftId)).toEqual(record);

    await cache.put({ ...record, status: 'accepted', instrumentId: 'mcq-1' });
    const accepted = await cache.get(record.draftId);
    expect(accepted?.demand).toEqual(record.demand);
    expect((await cache.list()).map((r) => r.demand)).toEqual([record.demand]);
  });

  it('a record with no carriage is stored byte for byte as before: no demand key at all', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(baseRecord());
    expect(vault.raw('.olea/drafts/draft-demand-1.json')).not.toContain('"demand"');
  });
});
