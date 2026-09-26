/**
 * `./eligibility.ts` — rel.md §3 Default 4's per-endpoint freshness, computed for real. This is
 * `[ILB-REL-4]`'s (`ol-egov.141.89.4.4`) acceptance criterion added from `ol-egov.141.89.4.11`:
 * "applies rel.md's per-endpoint freshness rule (section 3, default 4) before using a relation,
 * with a test of one stale endpoint beside one current." See this file's "one stale beside one
 * current" describe block for that exact case.
 *
 * INV-3: every key and revision string here is coined. No course code, note title or wording comes
 * from any real vault.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateEligibility,
  evaluateEndpointFreshness,
  evaluatePropositionFreshness,
  evaluatePropositionFreshnessWithLookup,
  type JudgedEndpointRevision,
} from './eligibility.js';
import type { PrerequisiteCycleReport } from './graph-checks.js';
import { findPrerequisiteCycles } from './graph-checks.js';

describe('evaluateEndpointFreshness', () => {
  it('reads current when the revision matches', () => {
    expect(evaluateEndpointFreshness({ key: 'ck-a', revisionAtJudgment: 'rev-1' }, 'rev-1')).toBe(
      'current',
    );
  });

  it('reads stale when the revision has moved', () => {
    expect(evaluateEndpointFreshness({ key: 'ck-a', revisionAtJudgment: 'rev-1' }, 'rev-2')).toBe(
      'stale',
    );
  });

  it('reads unverified, never current, when no revision was recorded at judgment time', () => {
    expect(evaluateEndpointFreshness({ key: 'ck-a', revisionAtJudgment: undefined }, 'rev-1')).toBe(
      'unverified',
    );
  });

  it('reads unverified, never current, when no current revision exists to compare against', () => {
    expect(evaluateEndpointFreshness({ key: 'ck-a', revisionAtJudgment: 'rev-1' }, undefined)).toBe(
      'unverified',
    );
  });
});

describe('evaluatePropositionFreshness — one stale endpoint beside one current', () => {
  const currentEndpoint: JudgedEndpointRevision = { key: 'ck-from', revisionAtJudgment: 'rev-1' };
  const staleEndpoint: JudgedEndpointRevision = { key: 'ck-to', revisionAtJudgment: 'rev-1' };

  it('the overall result is stale, never hidden by the other endpoint being current', () => {
    const result = evaluatePropositionFreshness(currentEndpoint, 'rev-1', staleEndpoint, 'rev-2');
    expect(result.from).toBe('current');
    expect(result.to).toBe('stale');
    expect(result.overall).toBe('stale');
    expect(result.evidenceState).toBe('stale');
  });

  it('the same pair with both endpoints current reads current end to end', () => {
    const result = evaluatePropositionFreshness(currentEndpoint, 'rev-1', currentEndpoint, 'rev-1');
    expect(result.overall).toBe('current');
    expect(result.evidenceState).toBe('current');
  });

  it('an unverified endpoint abstains identically to a stale one at the serve decision, but is reported apart', () => {
    const unverified: JudgedEndpointRevision = { key: 'ck-unknown', revisionAtJudgment: undefined };
    const result = evaluatePropositionFreshness(currentEndpoint, 'rev-1', unverified, 'rev-9');
    expect(result.to).toBe('unverified');
    expect(result.evidenceState).toBe('stale'); // abstains the same as a true stale
    expect(result.overall).toBe('unverified'); // but the benchmark can tell the two apart
  });

  it('a stale endpoint outranks an unverified one when both are non-current, for reporting', () => {
    const unverified: JudgedEndpointRevision = { key: 'ck-unknown', revisionAtJudgment: undefined };
    const result = evaluatePropositionFreshness(unverified, undefined, staleEndpoint, 'rev-2');
    expect(result.overall).toBe('stale');
    expect(result.evidenceState).toBe('stale');
  });

  it('reads through an injected lookup identically to pre-resolved revisions', () => {
    const lookup = (key: string): string | undefined => (key === 'ck-from' ? 'rev-1' : 'rev-2');
    const result = evaluatePropositionFreshnessWithLookup(currentEndpoint, staleEndpoint, lookup);
    expect(result.overall).toBe('stale');
  });
});

describe('evaluateEligibility', () => {
  const currentFreshness = evaluatePropositionFreshness(
    { key: 'ck-a', revisionAtJudgment: 'rev-1' },
    'rev-1',
    { key: 'ck-b', revisionAtJudgment: 'rev-1' },
    'rev-1',
  );
  const staleFreshness = evaluatePropositionFreshness(
    { key: 'ck-a', revisionAtJudgment: 'rev-1' },
    'rev-1',
    { key: 'ck-b', revisionAtJudgment: 'rev-1' },
    'rev-2',
  );

  it('serves a current, non-cyclic edge', () => {
    const verdict = evaluateEligibility({ fromKey: 'ck-a', toKey: 'ck-b' }, currentFreshness);
    expect(verdict.servable).toBe(true);
    expect(verdict.blockedByCycle).toBe(false);
  });

  it('never serves a stale edge, even with no cycle report at all', () => {
    const verdict = evaluateEligibility({ fromKey: 'ck-a', toKey: 'ck-b' }, staleFreshness);
    expect(verdict.servable).toBe(false);
  });

  it('never serves an edge inside a reported prerequisite cycle, even when current', () => {
    const report: PrerequisiteCycleReport = findPrerequisiteCycles([
      { fromKey: 'ck-a', toKey: 'ck-b' },
      { fromKey: 'ck-b', toKey: 'ck-c' },
      { fromKey: 'ck-c', toKey: 'ck-a' },
    ]);
    const verdict = evaluateEligibility(
      { fromKey: 'ck-a', toKey: 'ck-b' },
      currentFreshness,
      report,
    );
    expect(verdict.blockedByCycle).toBe(true);
    expect(verdict.servable).toBe(false);
  });

  it("still serves a cycle member's edge to a dependent outside the cycle (Default 2)", () => {
    const report: PrerequisiteCycleReport = findPrerequisiteCycles([
      { fromKey: 'ck-a', toKey: 'ck-b' },
      { fromKey: 'ck-b', toKey: 'ck-c' },
      { fromKey: 'ck-c', toKey: 'ck-a' },
    ]);
    // ck-a is a cycle member; its edge to ck-dependent (outside the cycle) is unaffected.
    const verdict = evaluateEligibility(
      { fromKey: 'ck-a', toKey: 'ck-dependent' },
      currentFreshness,
      report,
    );
    expect(verdict.blockedByCycle).toBe(false);
    expect(verdict.servable).toBe(true);
  });
});
