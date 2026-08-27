/**
 * `checkConfusionPairingResolution` (`ol-2zfj.20`) — pins the one failure
 * mode this check names: every evidence-bearing record failing name/alias
 * resolution, which is the identity-space mismatch `./types.ts`'s top doc
 * warns a future misconception-store caller about. See that doc for why no
 * ratio threshold is invented instead.
 */

import { describe, expect, it } from 'vitest';
import { checkConfusionPairingResolution } from './health.js';
import type { ConfusionPairingResult } from './types.js';

function result(overrides: Partial<ConfusionPairingResult> = {}): ConfusionPairingResult {
  return {
    entries: [],
    unmatchedMisconceptionPairs: 0,
    unresolvedRecords: 0,
    evidenceBearingRecords: 0,
    ...overrides,
  };
}

describe('checkConfusionPairingResolution', () => {
  it('passes when there was no evidence to resolve this run', () => {
    const verdict = checkConfusionPairingResolution(result());
    expect(verdict.ok).toBe(true);
    expect(verdict.measured).toEqual({ evidenceBearingRecords: 0, unresolvedRecords: 0 });
  });

  it('passes when at least one evidence-bearing record resolved', () => {
    const verdict = checkConfusionPairingResolution(
      result({ evidenceBearingRecords: 3, unresolvedRecords: 2 }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('fails when every evidence-bearing record failed resolution', () => {
    const verdict = checkConfusionPairingResolution(
      result({ evidenceBearingRecords: 4, unresolvedRecords: 4 }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('4');
  });

  it('always reports measured counts, even when ok is true', () => {
    const verdict = checkConfusionPairingResolution(
      result({ evidenceBearingRecords: 5, unresolvedRecords: 1 }),
    );
    expect(verdict.measured).toEqual({ evidenceBearingRecords: 5, unresolvedRecords: 1 });
  });
});
