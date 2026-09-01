/**
 * `plan-policy-fingerprint.ts` tests (`[D-167]` / `ol-v7r5.20` [RECOMP-1],
 * wired by `ol-v7r5.23`). Synthetic course ids only (INV-3).
 */
import { describe, expect, it } from 'vitest';
import {
  planPolicyFingerprint,
  planPolicyFingerprintChanged,
} from '../../src/plan/plan-policy-fingerprint.js';
import type { PlanPolicyRequest } from '../../src/plan/plan-policy-provider.js';

function request(overrides: Partial<PlanPolicyRequest> = {}): PlanPolicyRequest {
  return {
    asOf: '2026-09-01',
    courses: [
      {
        courseId: 'course-a',
        daysToNextAssessment: 9,
        assessmentWorth: 0.4,
        readiness: 0.2,
        evidenceVolume: 1,
      },
    ],
    ...overrides,
  };
}

describe('planPolicyFingerprint', () => {
  it('is stable across two calls with the identical request', async () => {
    const a = await planPolicyFingerprint(request());
    const b = await planPolicyFingerprint(request());
    expect(a).toBe(b);
  });

  it('is stable across key-reordering of the same course facts (canonical serialisation)', async () => {
    const reordered: PlanPolicyRequest = {
      courses: [
        {
          evidenceVolume: 1,
          readiness: 0.2,
          assessmentWorth: 0.4,
          daysToNextAssessment: 9,
          courseId: 'course-a',
        },
      ],
      asOf: '2026-09-01',
    };
    const a = await planPolicyFingerprint(request());
    const b = await planPolicyFingerprint(reordered);
    expect(a).toBe(b);
  });

  it('changes when a course fact changes (readiness moved)', async () => {
    const a = await planPolicyFingerprint(request());
    const b = await planPolicyFingerprint(
      request({
        courses: [
          {
            courseId: 'course-a',
            daysToNextAssessment: 9,
            assessmentWorth: 0.4,
            readiness: 0.5,
            evidenceVolume: 1,
          },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });

  it('changes when asOf moves (a day passing is a material change, D-167)', async () => {
    const a = await planPolicyFingerprint(request());
    const b = await planPolicyFingerprint(request({ asOf: '2026-09-02' }));
    expect(a).not.toBe(b);
  });

  it('changes when a course is added or removed', async () => {
    const a = await planPolicyFingerprint(request());
    const b = await planPolicyFingerprint(
      request({
        courses: [
          ...request().courses,
          {
            courseId: 'course-b',
            daysToNextAssessment: null,
            assessmentWorth: 0.1,
            readiness: 0.9,
            evidenceVolume: 0.1,
          },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });
});

describe('planPolicyFingerprintChanged', () => {
  it('always recomputes when there is no previous fingerprint (first run on this device)', () => {
    expect(planPolicyFingerprintChanged('abc', undefined)).toBe(true);
  });

  it('does not recompute when the fingerprint is unchanged — zero spend, zero churn', () => {
    expect(planPolicyFingerprintChanged('abc', 'abc')).toBe(false);
  });

  it('recomputes when the fingerprint moved', () => {
    expect(planPolicyFingerprintChanged('abc', 'def')).toBe(true);
  });
});
