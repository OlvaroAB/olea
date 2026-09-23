import { describe, expect, it } from 'vitest';
import type { PaperDemand } from '../oracle/paper-types.js';
import { demandToJudgeOperation, judgeOperationToDemand } from './demand.js';
import type { IntendedOperation } from './groundedContext.js';

describe('judgeOperationToDemand', () => {
  it('maps define to recall-a-fact', () => {
    expect(judgeOperationToDemand('define')).toBe('recall-a-fact');
  });

  it('maps calculate to calculate', () => {
    expect(judgeOperationToDemand('calculate')).toBe('calculate');
  });

  it('maps compare to compare-or-choose', () => {
    expect(judgeOperationToDemand('compare')).toBe('compare-or-choose');
  });

  it('maps apply to apply-to-unfamiliar-case', () => {
    expect(judgeOperationToDemand('apply')).toBe('apply-to-unfamiliar-case');
  });

  it('maps explain to undefined — an explanation is not a demand a drafted instrument serves', () => {
    expect(judgeOperationToDemand('explain')).toBeUndefined();
  });
});

describe('demandToJudgeOperation', () => {
  it('maps recall-a-fact to define', () => {
    expect(demandToJudgeOperation('recall-a-fact')).toBe('define');
  });

  it('maps calculate to calculate', () => {
    expect(demandToJudgeOperation('calculate')).toBe('calculate');
  });

  it('maps compare-or-choose to compare', () => {
    expect(demandToJudgeOperation('compare-or-choose')).toBe('compare');
  });

  it('maps apply-to-unfamiliar-case to apply', () => {
    expect(demandToJudgeOperation('apply-to-unfamiliar-case')).toBe('apply');
  });

  it('maps interpret-printed-result to undefined — IntendedOperation has no counterpart for it', () => {
    expect(demandToJudgeOperation('interpret-printed-result')).toBeUndefined();
  });
});

describe('round-trip — every value with a counterpart maps back to itself', () => {
  const roundTrippable: readonly PaperDemand[] = [
    'recall-a-fact',
    'calculate',
    'compare-or-choose',
    'apply-to-unfamiliar-case',
  ];

  it.each(roundTrippable)('%s survives judge → demand → judge → demand', (demand) => {
    const operation = demandToJudgeOperation(demand) as IntendedOperation;
    expect(operation).toBeDefined();
    expect(judgeOperationToDemand(operation)).toBe(demand);
  });
});
