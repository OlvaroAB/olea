import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  isSupportedContractVersion,
  requestTelemetry,
  responseStamp,
  SUPPORTED_CONTRACT_VERSIONS,
  successResponse,
  usageBlock,
} from './worker.js';

const validUsage = {
  inputTokens: 1234,
  inputTokensSource: 'reported' as const,
  outputTokens: 56,
  costUsd: 0.000_123_45,
  latencyMs: 987,
};

describe('CONTRACT_VERSION (D-011)', () => {
  it('is 2 — bumped by [D-123] for the responseStamp usage block', () => {
    expect(CONTRACT_VERSION).toBe(2);
  });

  it('serves N and N−1: versions 1 and 2, nothing below or above', () => {
    expect(SUPPORTED_CONTRACT_VERSIONS).toEqual({ min: 1, current: 2 });
    expect(isSupportedContractVersion(1)).toBe(true);
    expect(isSupportedContractVersion(2)).toBe(true);
    expect(isSupportedContractVersion(0)).toBe(false);
    expect(isSupportedContractVersion(3)).toBe(false);
  });
});

describe('usageBlock ([D-123])', () => {
  it('accepts the figures a successful call already computes', () => {
    expect(usageBlock.parse(validUsage)).toEqual(validUsage);
  });

  it('accepts every inputTokensSource label', () => {
    for (const source of ['reported', 'derived', 'unreported'] as const) {
      expect(usageBlock.parse({ ...validUsage, inputTokensSource: source }).inputTokensSource).toBe(
        source,
      );
    }
    expect(() => usageBlock.parse({ ...validUsage, inputTokensSource: 'measured' })).toThrow();
  });

  it('cachedInputTokens is optional — no current pricing path measures it', () => {
    expect(usageBlock.parse(validUsage).cachedInputTokens).toBeUndefined();
    expect(usageBlock.parse({ ...validUsage, cachedInputTokens: 500 }).cachedInputTokens).toBe(500);
  });

  it('rejects a negative figure in any numeric field', () => {
    expect(() => usageBlock.parse({ ...validUsage, inputTokens: -1 })).toThrow();
    expect(() => usageBlock.parse({ ...validUsage, outputTokens: -1 })).toThrow();
    expect(() => usageBlock.parse({ ...validUsage, costUsd: -0.01 })).toThrow();
    expect(() => usageBlock.parse({ ...validUsage, latencyMs: -1 })).toThrow();
    expect(() => usageBlock.parse({ ...validUsage, cachedInputTokens: -1 })).toThrow();
  });
});

describe('responseStamp grows usage ([D-123])', () => {
  const validStamp = {
    contractVersion: CONTRACT_VERSION,
    promptVersion: '1.0.0',
    modelId: '@cf/google/gemma-4-26b-a4b-it',
    usage: validUsage,
  };

  it('requires usage on a valid stamp', () => {
    expect(responseStamp.parse(validStamp).usage).toEqual(validUsage);
    const { usage: _usage, ...withoutUsage } = validStamp;
    expect(() => responseStamp.parse(withoutUsage)).toThrow();
  });

  it('parses inside a full success envelope', () => {
    const parsed = successResponse.parse({
      ok: true,
      stamp: validStamp,
      result: { anything: 'per-task, unvalidated at this layer' },
    });
    expect(parsed.stamp.usage.costUsd).toBeCloseTo(0.000_123_45);
  });
});

describe('requestTelemetry is unchanged by D-123 (D-005/D-014)', () => {
  it('carries no cachedInputTokens or inputTokensSource field — those stay client-stamp-only', () => {
    const record = requestTelemetry.parse({
      userId: 'user-1',
      taskId: 'cards.generate.v1',
      modelId: '@cf/google/gemma-4-26b-a4b-it',
      promptVersion: '1.0.0',
      inputTokens: 100,
      outputTokens: 40,
      costUsd: 0.000_05,
      latencyMs: 500,
      timestamp: new Date().toISOString(),
      outcome: 'ok',
    });
    expect(record).not.toHaveProperty('cachedInputTokens');
    expect(record).not.toHaveProperty('inputTokensSource');
  });
});
