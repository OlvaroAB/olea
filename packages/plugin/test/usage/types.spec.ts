/**
 * `types.ts` tests (F7.3, `ol-p6t06`). Covers the `isUsageLogEntry`
 * scenarios in `features/F7-plugin-surface.md`'s F7.3 section
 * (olea-service): a pre-`[D-123]` entry still validates, a full `[D-123]`
 * entry validates, and a corrupted figure does not.
 */
import { describe, expect, it } from 'vitest';
import { isUsageLogEntry } from '../../src/usage/types.js';

function baseEntry(): Record<string, unknown> {
  return {
    taskId: 'oracle.rank.v1',
    promptVersion: '1.0.0',
    modelId: 'model-a',
    recordedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('isUsageLogEntry', () => {
  it('validates an entry shaped exactly like ol-p3t09s original build — no D-123 fields at all', () => {
    expect(isUsageLogEntry(baseEntry())).toBe(true);
  });

  it('validates an entry carrying the full D-123 usage block', () => {
    expect(
      isUsageLogEntry({
        ...baseEntry(),
        inputTokens: 120,
        inputTokensSource: 'reported',
        outputTokens: 40,
        costUsd: 0.0021,
        latencyMs: 850,
        cachedInputTokens: 64,
      }),
    ).toBe(true);
  });

  it('validates an entry with only some D-123 fields present', () => {
    expect(isUsageLogEntry({ ...baseEntry(), inputTokens: 10, inputTokensSource: 'derived' })).toBe(
      true,
    );
  });

  it('rejects a negative costUsd rather than silently accepting a corrupted figure', () => {
    expect(isUsageLogEntry({ ...baseEntry(), costUsd: -1 })).toBe(false);
  });

  it('rejects a negative inputTokens', () => {
    expect(isUsageLogEntry({ ...baseEntry(), inputTokens: -5 })).toBe(false);
  });

  it('rejects a non-numeric latencyMs', () => {
    expect(isUsageLogEntry({ ...baseEntry(), latencyMs: 'fast' })).toBe(false);
  });

  it('rejects an inputTokensSource outside the known three values', () => {
    expect(isUsageLogEntry({ ...baseEntry(), inputTokensSource: 'guessed' })).toBe(false);
  });

  it('still rejects an entry missing a required base field', () => {
    const { taskId: _taskId, ...withoutTaskId } = baseEntry();
    expect(isUsageLogEntry(withoutTaskId)).toBe(false);
  });
});
