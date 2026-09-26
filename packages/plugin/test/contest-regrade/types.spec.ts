import { describe, expect, it } from 'vitest';
import {
  CONTEST_REGRADE_JOB_KIND,
  type ContestRegradeJobPayload,
  isContestRegradeJobPayload,
} from '../../src/contest-regrade/types.js';

// Synthetic fixtures only (INV-3).
function payload(overrides: Partial<ContestRegradeJobPayload> = {}): ContestRegradeJobPayload {
  return {
    kind: CONTEST_REGRADE_JOB_KIND,
    disputeEventId: 'dispute-1',
    instrumentId: 'instrument-1',
    originalGradeEventId: 'eb-1',
    conceptIds: ['concept-a'],
    ...overrides,
  };
}

describe('isContestRegradeJobPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(isContestRegradeJobPayload(payload())).toBe(true);
  });

  it('rejects a different job kind sharing the same engine (e.g. a generation or extraction payload)', () => {
    expect(isContestRegradeJobPayload({ ...payload(), kind: 'generation' })).toBe(false);
  });

  it('rejects a payload missing disputeEventId', () => {
    const { disputeEventId: _omit, ...rest } = payload();
    expect(isContestRegradeJobPayload(rest)).toBe(false);
  });

  it('rejects a payload with an empty instrumentId', () => {
    expect(isContestRegradeJobPayload(payload({ instrumentId: '' }))).toBe(false);
  });

  it('rejects a payload whose conceptIds is not an array of strings', () => {
    expect(isContestRegradeJobPayload({ ...payload(), conceptIds: ['ok', 42] })).toBe(false);
  });

  it('rejects null, a primitive, and an unrelated object', () => {
    expect(isContestRegradeJobPayload(null)).toBe(false);
    expect(isContestRegradeJobPayload('contest-regrade')).toBe(false);
    expect(isContestRegradeJobPayload({})).toBe(false);
  });
});
