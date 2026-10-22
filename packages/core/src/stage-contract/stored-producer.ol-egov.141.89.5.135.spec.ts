/**
 * `[D-598]` (`ol-egov.141.89.5.135`): the stored producer of a source-change verdict, and the
 * judge's stamp on the cited-passage path.
 *
 * Scenarios: olea-service `features/C3-ingestion.md`, "Feature: 1.4 / [D-598] — Each
 * source-change verdict keeps who decided it", the two scenarios tagged
 * `@auto:core/stage-contract/stored-producer.ol-egov.141.89.5.135.spec`.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import { evaluateCitedPassageRevision } from '../concept/revision/material-change.js';
import type {
  CitedPassageInput,
  CitedPassageRevisionOutcome,
  RevisionJudgePort,
} from '../concept/revision/types.js';
import { hashText } from '../ingestion/hash.js';
import { decisionFromCitedPassageRevision } from './adapters/revision-judge.js';
import {
  type ModelStamp,
  type PersistedStageProducer,
  persistedModelProducer,
  readModelStamp,
  readStoredProducer,
  type StageSeamContext,
} from './provenance.js';

const STAMP: ModelStamp = { promptVersion: 'p-9.9.9', modelId: 'model-coined-1' };

describe('a stored producer reads back as model, code, unknown or unrecognised', () => {
  it('a model stage reads with its seat, task and stamp exactly as stored', () => {
    const stored = { kind: 'model', seat: 'candidate', taskId: 'task.coined.v1', stamp: STAMP };
    expect(readStoredProducer(stored)).toEqual({
      state: 'known',
      producer: { kind: 'model', seat: 'candidate', taskId: 'task.coined.v1', stamp: STAMP },
    });
  });

  it('a model stage whose response carried no stamp reads with a null stamp, never a filled one', () => {
    const stored = { kind: 'model', seat: 'fallback', taskId: 'task.coined.v1', stamp: null };
    expect(readStoredProducer(stored)).toEqual({
      state: 'known',
      producer: { kind: 'model', seat: 'fallback', taskId: 'task.coined.v1', stamp: null },
    });
  });

  it('a code rule reads with its id and version', () => {
    expect(readStoredProducer({ kind: 'code', rule: 'coined-rule', ruleVersion: 1 })).toEqual({
      state: 'known',
      producer: { kind: 'code', rule: 'coined-rule', ruleVersion: 1 },
    });
    expect(readStoredProducer({ kind: 'code', rule: 'coined-rule', ruleVersion: 7 })).toEqual({
      state: 'known',
      producer: { kind: 'code', rule: 'coined-rule', ruleVersion: 7 },
    });
  });

  it('an absent value reads unknown', () => {
    expect(readStoredProducer(undefined)).toEqual({ state: 'unknown' });
  });

  it.each([
    ['null', null],
    ['a string', 'formatting-only'],
    ['a number', 1],
    ['an array', [{ kind: 'code', rule: 'coined-rule', ruleVersion: 1 }]],
    ['an unknown kind', { kind: 'person', rule: 'coined-rule', ruleVersion: 1 }],
    ['a code rule with no version', { kind: 'code', rule: 'coined-rule' }],
    ['a code rule at version 0', { kind: 'code', rule: 'coined-rule', ruleVersion: 0 }],
    [
      'a code rule at a fractional version',
      { kind: 'code', rule: 'coined-rule', ruleVersion: 1.5 },
    ],
    ['a code rule with a string version', { kind: 'code', rule: 'coined-rule', ruleVersion: '1' }],
    [
      'a code rule whose id is not kebab-case',
      { kind: 'code', rule: 'Coined Rule', ruleVersion: 1 },
    ],
    ['a code rule with an empty id', { kind: 'code', rule: '', ruleVersion: 1 }],
    ['a model with an unknown seat', { kind: 'model', seat: 'third', taskId: 't.v1', stamp: null }],
    ['a model with no task', { kind: 'model', seat: 'candidate', taskId: '', stamp: null }],
    ['a model with no stamp key', { kind: 'model', seat: 'candidate', taskId: 't.v1' }],
    [
      'a model with an unreadable stamp',
      { kind: 'model', seat: 'candidate', taskId: 't.v1', stamp: { promptVersion: '' } },
    ],
  ])('a present but unreadable value (%s) reads unrecognised', (_label, value) => {
    expect(readStoredProducer(value)).toEqual({ state: 'unrecognised' });
  });

  it('reading never changes the stored value, so a carry can keep it as it was', () => {
    const unreadable = { kind: 'code', rule: 'Coined Rule', ruleVersion: 1, extra: [1, 2] };
    const before = JSON.stringify(unreadable);
    readStoredProducer(unreadable);
    expect(JSON.stringify(unreadable)).toBe(before);
  });

  it('keys this build does not know are ignored, and the producer holds the known fields only', () => {
    expect(
      readStoredProducer({ kind: 'code', rule: 'coined-rule', ruleVersion: 2, note: 'newer' }),
    ).toEqual({ state: 'known', producer: { kind: 'code', rule: 'coined-rule', ruleVersion: 2 } });
  });

  it('readModelStamp reads a usable stamp and returns null for anything else', () => {
    expect(readModelStamp(STAMP)).toEqual(STAMP);
    expect(readModelStamp({ ...STAMP, extra: 'x' })).toEqual(STAMP);
    expect(readModelStamp(undefined)).toBeNull();
    expect(readModelStamp(null)).toBeNull();
    expect(readModelStamp('p-1')).toBeNull();
    expect(readModelStamp({ promptVersion: 'p-1' })).toBeNull();
    expect(readModelStamp({ promptVersion: 'p-1', modelId: '' })).toBeNull();
    expect(readModelStamp({ promptVersion: 3, modelId: 'm' })).toBeNull();
  });

  it('a model producer persists as its model arm; a code producer, which has no version, does not', () => {
    expect(
      persistedModelProducer({
        kind: 'model',
        seat: 'candidate',
        taskId: 'task.coined.v1',
        stamp: STAMP,
      }),
    ).toEqual({ kind: 'model', seat: 'candidate', taskId: 'task.coined.v1', stamp: STAMP });
    expect(persistedModelProducer({ kind: 'code', rule: 'coined-rule' })).toBeNull();
  });

  it('every producer a writer persists reads back as itself', () => {
    const producers: PersistedStageProducer[] = [
      { kind: 'model', seat: 'candidate', taskId: 'task.coined.v1', stamp: STAMP },
      { kind: 'model', seat: 'fallback', taskId: 'task.coined.v1', stamp: null },
      { kind: 'code', rule: 'coined-rule', ruleVersion: 1 },
    ];
    for (const producer of producers) {
      expect(readStoredProducer(JSON.parse(JSON.stringify(producer)))).toEqual({
        state: 'known',
        producer,
      });
    }
  });
});

describe("the judge's stamp reaches the cited-passage verdict", () => {
  const clock = { now: () => 7_000 };

  async function judged(
    material: boolean,
    stamp: unknown,
    omitStamp = false,
  ): Promise<CitedPassageRevisionOutcome> {
    const oldText = 'coined passage, first wording';
    const newText = 'coined passage, second wording';
    const input: CitedPassageInput = {
      instrumentId: 'inst-coined',
      previousText: oldText,
      previousContentHash: await hashText(oldText),
      current: { kind: 'found-at-anchor', text: newText },
    };
    const verdict = omitStamp
      ? { material, reason: 'coined reason' }
      : { material, reason: 'coined reason', stamp };
    const judge = { judge: async () => verdict } as unknown as RevisionJudgePort;
    return evaluateCitedPassageRevision(input, judge, clock);
  }

  it('a stamped answer: the refreshed and revised outcomes carry that stamp', async () => {
    const refreshed = await judged(false, STAMP);
    const revised = await judged(true, STAMP);
    expect(refreshed.kind).toBe('refreshed');
    expect(revised.kind).toBe('revised');
    if (refreshed.kind !== 'refreshed' || revised.kind !== 'revised') return;
    expect(refreshed.judgeStamp).toEqual(STAMP);
    expect(revised.judgeStamp).toEqual(STAMP);
  });

  it('an unstamped answer carries none (null), never an invented stamp', async () => {
    for (const material of [false, true]) {
      const outcome = await judged(material, undefined, true);
      if (outcome.kind !== 'refreshed' && outcome.kind !== 'revised') {
        throw new Error(`expected a judged outcome, got ${outcome.kind}`);
      }
      expect(outcome.judgeStamp).toBeNull();
    }
  });

  it('a malformed stamp on the answer carries none (null)', async () => {
    for (const stamp of [
      { promptVersion: 'p-1' },
      'p-1',
      null,
      { modelId: 'm', promptVersion: '' },
    ]) {
      const outcome = await judged(true, stamp);
      if (outcome.kind !== 'revised') throw new Error(`expected revised, got ${outcome.kind}`);
      expect(outcome.judgeStamp).toBeNull();
    }
  });

  it("the outcome's stamp becomes the decision's model producer, which persists as stored", async () => {
    const revised = await judged(true, STAMP);
    if (revised.kind !== 'revised') throw new Error('expected revised');
    const context: StageSeamContext = {
      seat: 'candidate',
      taskId: 'materiality.judge.v1',
      stamp: revised.judgeStamp,
      evidenceDigests: [],
    };
    const decision = decisionFromCitedPassageRevision(revised, context);
    if (decision === null) throw new Error('expected a decision');
    expect(persistedModelProducer(decision.provenance.producer)).toEqual({
      kind: 'model',
      seat: 'candidate',
      taskId: 'materiality.judge.v1',
      stamp: STAMP,
    });
  });
});
