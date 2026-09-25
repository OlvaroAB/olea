import { describe, expect, it } from 'vitest';
import {
  classifyStageFailure,
  STAGE_FAILURE_KINDS,
  type StageFailureAction,
  type StageFailureKind,
} from './taxonomy.js';

describe('classifyStageFailure — [IL-D4] the five-way internal-outcome taxonomy', () => {
  const EXPECTED_ACTIONS: Record<StageFailureKind, StageFailureAction> = {
    'missing-evidence': 'defer-insufficient',
    'conflicting-evidence': 'escalate-for-review',
    'provider-failure': 'retry-later',
    'stale-inputs': 'surface-for-recheck',
    'privacy-refusal': 'refuse-silently',
  };

  it('maps every one of the five outcomes to its own named action', () => {
    for (const outcome of STAGE_FAILURE_KINDS) {
      const record = classifyStageFailure('some-stage', outcome, 1000);
      expect(record.action).toBe(EXPECTED_ACTIONS[outcome]);
    }
  });

  it('is total over the five kinds — every kind in the exported list actually classifies', () => {
    expect(STAGE_FAILURE_KINDS).toHaveLength(5);
    for (const outcome of STAGE_FAILURE_KINDS) {
      expect(() => classifyStageFailure('s', outcome, 0)).not.toThrow();
    }
  });

  it('carries the caller-supplied stage label and clock reading through unchanged, distinguishable in the record', () => {
    const record = classifyStageFailure('explain-back.judge.v1', 'provider-failure', 424242);
    expect(record.stage).toBe('explain-back.judge.v1');
    expect(record.outcome).toBe('provider-failure');
    expect(record.at).toBe(424242);
    expect(record.action).toBe('retry-later');
  });

  it('two different outcomes on the same stage produce two distinguishable records, never conflated', () => {
    const missing = classifyStageFailure('stage-x', 'missing-evidence', 1);
    const conflicting = classifyStageFailure('stage-x', 'conflicting-evidence', 1);
    expect(missing.outcome).not.toBe(conflicting.outcome);
    expect(missing.action).not.toBe(conflicting.action);
  });
});
