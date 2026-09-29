// `[D-437]` (`ol-egov.141.89.57`), design section 4.3 (W1), amended by the 2026-09-29 rulings on
// rows 35 to 38. What this file has to prove:
//
//   1. the fragment's request fields are optional: absent parses to exactly what it always did;
//   2. the vocabulary is the ruled five words and nothing else, and is the SAME enum as
//      `explainBackJudgeDemand` (one vocabulary, not a third copy);
//   3. the served-demand declaration covers exactly the two authoring task ids, and both serve
//      recall only (widening it is a decision bead, so this test is the tripwire);
//   4. the primary ask keeps the full heading untouched and refuses only a blank one;
//   5. the acknowledgement echoes a demand and carries nothing about delivery.
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_DEMAND_TASK_IDS,
  AUTHORING_SERVED_DEMANDS,
  authoringDeclaredDemandField,
  authoringDemand,
  authoringDemandAcknowledgement,
  authoringDemandServed,
  authoringIntendedDemandField,
  authoringRequestedAsk,
  authoringRequestedAskField,
} from './authoring-demand.js';
import { explainBackJudgeDemand } from './explain-back-judge-target.js';
import { TASK_IDS } from './tasks.js';

const FIVE = [
  'recall-a-fact',
  'calculate',
  'compare-or-choose',
  'apply-to-unfamiliar-case',
  'interpret-printed-result',
] as const;

describe('the request fields are optional — absent is the request every caller sends today', () => {
  it('each optional field accepts undefined and returns undefined', () => {
    expect(authoringIntendedDemandField.parse(undefined)).toBeUndefined();
    expect(authoringRequestedAskField.parse(undefined)).toBeUndefined();
    expect(authoringDeclaredDemandField.parse(undefined)).toBeUndefined();
  });
});

describe('the vocabulary', () => {
  it('is exactly the five ruled words', () => {
    expect([...authoringDemand.options].sort()).toEqual([...FIVE].sort());
    for (const word of FIVE) expect(authoringDemand.safeParse(word).success).toBe(true);
  });

  it('is the same enum object as explainBackJudgeDemand, not a copy that could drift', () => {
    expect(authoringDemand).toBe(explainBackJudgeDemand);
  });

  it('refuses a sixth word, including the explain operation it must never be coerced into', () => {
    expect(authoringDemand.safeParse('explain').success).toBe(false);
    expect(authoringDemand.safeParse('discuss').success).toBe(false);
    expect(authoringIntendedDemandField.safeParse('critically-analyse').success).toBe(false);
  });
});

describe('the served-demand declaration', () => {
  it('names exactly the two authoring tasks, and they are the catalogue ids', () => {
    expect([...AUTHORING_DEMAND_TASK_IDS].sort()).toEqual(
      [TASK_IDS.CARDS_GENERATE, TASK_IDS.QUIZ_GENERATE].sort(),
    );
    expect(Object.keys(AUTHORING_SERVED_DEMANDS).sort()).toEqual(
      [...AUTHORING_DEMAND_TASK_IDS].sort(),
    );
  });

  it('serves recall-a-fact and nothing else, on both tasks (widening is a decision bead)', () => {
    for (const taskId of AUTHORING_DEMAND_TASK_IDS) {
      expect(AUTHORING_SERVED_DEMANDS[taskId]).toEqual(['recall-a-fact']);
      expect(authoringDemandServed(taskId, 'recall-a-fact')).toBe(true);
      for (const word of FIVE.filter((w) => w !== 'recall-a-fact')) {
        expect(authoringDemandServed(taskId, word)).toBe(false);
      }
    }
  });

  it('is frozen, so a caller cannot widen it at run time', () => {
    expect(Object.isFrozen(AUTHORING_SERVED_DEMANDS)).toBe(true);
    expect(Object.isFrozen(AUTHORING_SERVED_DEMANDS['quiz.generate.v1'])).toBe(true);
  });
});

describe('the primary ask (row 35)', () => {
  it('keeps the full heading and the question word exactly as sent, untrimmed', () => {
    const heading = '  How does a synthetic mechanism produce a synthetic result?  ';
    const parsed = authoringRequestedAsk.parse({ heading, questionWord: 'how' });
    expect(parsed).toEqual({ heading, questionWord: 'how' });
  });

  it('accepts a heading with no question word — the word is optional, the heading is not', () => {
    expect(authoringRequestedAsk.parse({ heading: 'Synthetic topic' })).toEqual({
      heading: 'Synthetic topic',
    });
  });

  it('refuses a blank heading, and a question word sent without one', () => {
    expect(authoringRequestedAsk.safeParse({ heading: '' }).success).toBe(false);
    expect(authoringRequestedAsk.safeParse({ heading: '   ' }).success).toBe(false);
    expect(authoringRequestedAsk.safeParse({ questionWord: 'how' }).success).toBe(false);
  });

  it('refuses an empty question word rather than reading it as none', () => {
    expect(
      authoringRequestedAsk.safeParse({ heading: 'A heading', questionWord: '' }).success,
    ).toBe(false);
  });
});

describe('the acknowledgement', () => {
  it('echoes a demand, and nothing about whether the item delivers it', () => {
    expect(authoringDemandAcknowledgement.parse({ intendedDemand: 'recall-a-fact' })).toEqual({
      intendedDemand: 'recall-a-fact',
    });
    // A field claiming delivery is not part of the shape: zod strips it rather than carrying it.
    expect(
      authoringDemandAcknowledgement.parse({ intendedDemand: 'recall-a-fact', delivered: true }),
    ).toEqual({ intendedDemand: 'recall-a-fact' });
  });

  it('requires the demand it echoes', () => {
    expect(authoringDemandAcknowledgement.safeParse({}).success).toBe(false);
    expect(authoringDemandAcknowledgement.safeParse({ intendedDemand: 'explain' }).success).toBe(
      false,
    );
  });
});
