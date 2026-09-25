/**
 * `types.ts` tests (F7.3, `ol-p6t06`, extended `ol-egov.141.89.10.50`).
 * Covers the `isUsageLogEntry` scenarios in `features/F7-plugin-surface.md`'s
 * F7.3 section (olea-service): a pre-`[D-123]` entry still validates, a full
 * `[D-123]` entry validates, and a corrupted figure does not — plus
 * `ol-egov.141.89.10.50`'s failed-call row: `buildFailedUsageLogEntry`'s
 * output validates, a failed row is never allowed to carry
 * `promptVersion`/`modelId`/a cost or token figure, and an old row (no
 * `outcome` field at all) keeps reading as a successful call.
 */
import { describe, expect, it } from 'vitest';
import { buildFailedUsageLogEntry, isUsageLogEntry } from '../../src/usage/types.js';

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

  describe('failed-call rows (ol-egov.141.89.10.50)', () => {
    it('validates a row built by buildFailedUsageLogEntry with an error code', () => {
      const entry = buildFailedUsageLogEntry(
        { taskId: 'quiz.generate.v1', errorCode: 'upstream_timeout' },
        '2026-09-25T00:00:00.000Z',
      );
      expect(isUsageLogEntry(entry)).toBe(true);
      expect(entry).toEqual({
        taskId: 'quiz.generate.v1',
        recordedAt: '2026-09-25T00:00:00.000Z',
        outcome: 'failed',
        errorCode: 'upstream_timeout',
      });
    });

    it('validates a failed row with no error code at all (a malformed response body)', () => {
      const entry = buildFailedUsageLogEntry(
        { taskId: 'quiz.generate.v1' },
        '2026-09-25T00:00:00.000Z',
      );
      expect(isUsageLogEntry(entry)).toBe(true);
      expect(entry.errorCode).toBeUndefined();
    });

    it('validates a failed row carrying a client-measured latency', () => {
      const entry = buildFailedUsageLogEntry(
        { taskId: 'quiz.generate.v1', errorCode: 'upstream_timeout', latencyMs: 4200 },
        '2026-09-25T00:00:00.000Z',
      );
      expect(isUsageLogEntry(entry)).toBe(true);
      expect(entry.latencyMs).toBe(4200);
    });

    it('never fabricates promptVersion or modelId on a failed row', () => {
      const entry = buildFailedUsageLogEntry(
        { taskId: 'quiz.generate.v1', errorCode: 'upstream_timeout' },
        '2026-09-25T00:00:00.000Z',
      );
      expect(entry.promptVersion).toBeUndefined();
      expect(entry.modelId).toBeUndefined();
    });

    it('rejects a failed row that smuggles in a promptVersion', () => {
      expect(
        isUsageLogEntry({
          taskId: 'quiz.generate.v1',
          recordedAt: '2026-09-25T00:00:00.000Z',
          outcome: 'failed',
          promptVersion: '1.0.0',
        }),
      ).toBe(false);
    });

    it('rejects a failed row that smuggles in a modelId', () => {
      expect(
        isUsageLogEntry({
          taskId: 'quiz.generate.v1',
          recordedAt: '2026-09-25T00:00:00.000Z',
          outcome: 'failed',
          modelId: 'model-a',
        }),
      ).toBe(false);
    });

    it('rejects a failed row that smuggles in a costUsd figure', () => {
      expect(
        isUsageLogEntry({
          taskId: 'quiz.generate.v1',
          recordedAt: '2026-09-25T00:00:00.000Z',
          outcome: 'failed',
          costUsd: 0.01,
        }),
      ).toBe(false);
    });

    it('rejects a failed row that smuggles in inputTokens', () => {
      expect(
        isUsageLogEntry({
          taskId: 'quiz.generate.v1',
          recordedAt: '2026-09-25T00:00:00.000Z',
          outcome: 'failed',
          inputTokens: 10,
        }),
      ).toBe(false);
    });

    it('rejects an outcome value outside the known two', () => {
      expect(
        isUsageLogEntry({
          taskId: 'quiz.generate.v1',
          recordedAt: '2026-09-25T00:00:00.000Z',
          outcome: 'errored',
        }),
      ).toBe(false);
    });

    it('rejects a non-string, non-empty errorCode', () => {
      expect(
        isUsageLogEntry({
          taskId: 'quiz.generate.v1',
          recordedAt: '2026-09-25T00:00:00.000Z',
          outcome: 'failed',
          errorCode: '',
        }),
      ).toBe(false);
    });

    it('still requires promptVersion/modelId for a row whose outcome is explicitly success', () => {
      expect(
        isUsageLogEntry({
          taskId: 'quiz.generate.v1',
          recordedAt: '2026-09-25T00:00:00.000Z',
          outcome: 'success',
        }),
      ).toBe(false);
    });

    it('an entry with no outcome field at all (every row persisted before this bead) still validates and still requires promptVersion/modelId', () => {
      expect(isUsageLogEntry(baseEntry())).toBe(true);
      const { promptVersion: _promptVersion, ...withoutPromptVersion } = baseEntry();
      expect(isUsageLogEntry(withoutPromptVersion)).toBe(false);
    });
  });
});
