// `[D-437]` demand carriage, B1b (`ol-egov.141.89.2.25`): the instrument target record store and the
// demand reading are reachable from the public entry point (`olea-core`), so plugin-side callers
// (B4 the materialisers, B5 the gap supplier) never deep-import `olea-core/src/...`. The same barrel
// carries the routing and mapping B3 (`ol-egov.141.89.2.20`) had to deep-import for want of it.
//
// This asserts that each name is the real thing, not merely present: `undefined` from a missing
// re-export is what the budget-exports precedent (`index.budget-exports.spec.ts`) was written for.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as oleaCore from './index.js';
import { PAPER_DEMANDS } from './oracle/paper-types.js';
import { FolderSource } from './vault/folder-source.js';

describe('olea-core barrel: the instrument target record and demand reading (B1b)', () => {
  let tempRoot: string;
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-demand-exports-'));
  });
  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('exports every name the bead lists as a function or constant', () => {
    const functions = {
      readInstrumentTarget: oleaCore.readInstrumentTarget,
      writeInstrumentTarget: oleaCore.writeInstrumentTarget,
      questionBindingOf: oleaCore.questionBindingOf,
      isInstrumentTargetRecord: oleaCore.isInstrumentTargetRecord,
      instrumentTargetStorePath: oleaCore.instrumentTargetStorePath,
      readInstrumentDemand: oleaCore.readInstrumentDemand,
      judgeDraftedDemand: oleaCore.judgeDraftedDemand,
      classifyInstrumentDemand: oleaCore.classifyInstrumentDemand,
      projectInstrumentDemands: oleaCore.projectInstrumentDemands,
      responseFormOf: oleaCore.responseFormOf,
    };
    for (const [name, value] of Object.entries(functions)) {
      expect(typeof value, name).toBe('function');
    }
    expect(oleaCore.INSTRUMENT_TARGET_STORE_FOLDER).toBe('.olea/instrument-targets');
    expect(oleaCore.INSTRUMENT_TARGET_SCHEMA_VERSION).toBe('instrument-target.v1');
    expect(oleaCore.INSTRUMENT_TARGET_DEMAND_BASIS).toBe('authoring-intent');
    expect([...oleaCore.INSTRUMENT_TARGET_ORIGINS]).toEqual([
      'heading-cue',
      'sweep',
      'planner-need',
      'revision',
      'paper-handoff',
    ]);
    expect(oleaCore.PAPER_DEMANDS).toBe(PAPER_DEMANDS);
  });

  it('the barrel writer and reader round-trip a record, and the reading says recognition for a multiple-choice block', async () => {
    const vault = new FolderSource(tempRoot);
    const block = { type: 'mcq', stem: 'Which one?', answer: 'This one' } as const;
    await oleaCore.writeInstrumentTarget(vault, {
      instrumentId: 'mcq-barrel-check',
      declaredDemand: 'recall-a-fact',
      origin: 'sweep',
      questionBinding: await oleaCore.questionBindingOf(block),
      authoredAt: '2026-09-29T10:00:00.000Z',
      generator: { taskId: 'quiz.generate.v1', promptVersion: '2.4.0' },
    });
    const reading = await oleaCore.readInstrumentDemand(vault, 'mcq-barrel-check', block);
    expect(reading).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'sweep',
      responseForm: 'recognition',
    });
    expect(oleaCore.projectInstrumentDemands(new Map([['mcq-barrel-check', reading]]))).toEqual(
      new Map([['mcq-barrel-check', ['recall-a-fact']]]),
    );
  });
});

describe('olea-core barrel: the ask, its routing and the word readings B3 deep-imported (B1b)', () => {
  it('exports the ask builders, the router, the counter and the two word-to-demand readings', () => {
    const functions = {
      askFromHeading: oleaCore.askFromHeading,
      askFromDemand: oleaCore.askFromDemand,
      askFromInstrumentReading: oleaCore.askFromInstrumentReading,
      questionWordOf: oleaCore.questionWordOf,
      routeDemandAsk: oleaCore.routeDemandAsk,
      unmetAskOf: oleaCore.unmetAskOf,
      authoringDemandFields: oleaCore.authoringDemandFields,
      demandRoutingReasonOf: oleaCore.demandRoutingReasonOf,
      demandForHeading: oleaCore.demandForHeading,
      demandCues: oleaCore.demandCues,
      demandToJudgeOperation: oleaCore.demandToJudgeOperation,
      judgeOperationToDemand: oleaCore.judgeOperationToDemand,
    };
    for (const [name, value] of Object.entries(functions)) {
      expect(typeof value, name).toBe('function');
    }
    expect(typeof oleaCore.DemandRoutingCounter).toBe('function');
    // The sweep's recall constant is the one name of the module deliberately left out (row 38): it
    // is pinned to its single caller by `routing/demand-ask-callers.spec.ts`, and reached by a
    // deliberate deep import, never through the public entry point.
    expect('SWEEP_RECALL_ASK' in oleaCore).toBe(false);
    expect(Object.isFrozen(oleaCore.NO_DEMAND_ASKED)).toBe(true);
    expect(oleaCore.DEMAND_ROUTING_REASONS).toContain('no-generator-serves');
  });

  it('routes through the barrel exactly as through the module: a recall ask is served by quiz.generate.v1 and a heading with no reading is not dropped', () => {
    const swept = oleaCore.routeDemandAsk(
      oleaCore.askFromDemand('recall-a-fact'),
      'quiz.generate.v1',
    );
    expect(swept).toMatchObject({ kind: 'served', demand: 'recall-a-fact' });
    expect(oleaCore.authoringDemandFields(swept)).toEqual({ intendedDemand: 'recall-a-fact' });

    const bare = oleaCore.routeDemandAsk(oleaCore.askFromHeading('How'), 'quiz.generate.v1');
    expect(bare.kind).toBe('unspecified');
    expect(bare.source?.heading).toBe('How');
  });
});
