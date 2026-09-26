/**
 * `./remember.ts` — rel.md §3 Default 3: a remembered negative or undecided result is re-opened
 * for judgment the instant either its evidence digest or its judge policy changes, never before.
 *
 * INV-3: every string here is coined. No course code, note title or wording comes from any real
 * vault.
 */

import { describe, expect, it } from 'vitest';
import {
  indexRememberedRecords,
  recordNegativeResult,
  rememberedPropositionIdentity,
  shouldReaskProposition,
} from './remember.js';

const evidence = { from: 'digest-a-1', to: 'digest-b-1' };
const policy = { task: 'concepts.relations.v1', promptVersion: '1.2.0', modelIdentity: 'gemma-4-26b' };

describe('shouldReaskProposition', () => {
  it('re-asks when nothing was ever remembered', () => {
    expect(shouldReaskProposition(undefined, evidence, policy)).toBe(true);
  });

  it('does not re-ask when evidence and judge policy both still match', () => {
    const record = recordNegativeResult({
      type: 'prerequisite',
      fromKey: 'ck-a',
      toKey: 'ck-b',
      outcome: 'none',
      evidenceDigest: evidence,
      judgePolicy: policy,
      now: () => '2026-01-01T00:00:00.000Z',
    });
    expect(shouldReaskProposition(record, evidence, policy)).toBe(false);
  });

  it('re-asks the instant the evidence digest changes on either endpoint', () => {
    const record = recordNegativeResult({
      type: 'prerequisite',
      fromKey: 'ck-a',
      toKey: 'ck-b',
      outcome: 'none',
      evidenceDigest: evidence,
      judgePolicy: policy,
    });
    expect(shouldReaskProposition(record, { from: 'digest-a-2', to: 'digest-b-1' }, policy)).toBe(true);
    expect(shouldReaskProposition(record, { from: 'digest-a-1', to: 'digest-b-2' }, policy)).toBe(true);
  });

  it('re-asks the instant the judge policy changes — a different model, or a revised prompt version', () => {
    const record = recordNegativeResult({
      type: 'prerequisite',
      fromKey: 'ck-a',
      toKey: 'ck-b',
      outcome: 'insufficient-evidence',
      evidenceDigest: evidence,
      judgePolicy: policy,
    });
    expect(
      shouldReaskProposition(record, evidence, { ...policy, modelIdentity: 'a-benchmarked-candidate' }),
    ).toBe(true);
    expect(shouldReaskProposition(record, evidence, { ...policy, promptVersion: '1.3.0' })).toBe(true);
  });
});

describe('indexRememberedRecords / rememberedPropositionIdentity', () => {
  it('looks records up by their exact proposition identity', () => {
    const record = recordNegativeResult({
      type: 'contrasts-with',
      fromKey: 'ck-a',
      toKey: 'ck-b',
      outcome: 'none',
      evidenceDigest: evidence,
      judgePolicy: policy,
    });
    const index = indexRememberedRecords([record]);
    expect(index.get(rememberedPropositionIdentity('contrasts-with', 'ck-a', 'ck-b'))).toBe(record);
    expect(index.get(rememberedPropositionIdentity('prerequisite', 'ck-a', 'ck-b'))).toBeUndefined();
  });
});
