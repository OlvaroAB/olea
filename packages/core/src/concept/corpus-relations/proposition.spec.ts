/**
 * `./proposition.ts` — rel.md §3 Default 1 (every corpus-eligible predicate judged independently)
 * and Default 5 (a keyless verdict is an operational failure, never resolved by name).
 *
 * INV-3: every key and name here is coined. No course code, note title or wording comes from any
 * real vault.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyPropositionVerdict,
  corpusEligiblePredicates,
  type PropositionEndpointRevisionStampingOptions,
  propositionsForCandidates,
} from './proposition.js';

const candidate = { pairId: 'RLP-1', aKey: 'ck-a', bKey: 'ck-b' };

describe('classifyPropositionVerdict', () => {
  it("classifies a well-formed related verdict, resolving direction through the candidate's own keys", () => {
    const outcome = classifyPropositionVerdict(candidate, {
      pairId: 'RLP-1',
      predicate: 'prerequisite',
      outcome: 'related',
      direction: 'a-to-b',
      confidence: 0.9,
      aKey: 'ck-a',
      bKey: 'ck-b',
    });
    expect(outcome).toEqual({ kind: 'related', fromKey: 'ck-a', toKey: 'ck-b', confidence: 0.9 });
  });

  it('reverses direction correctly for b-to-a', () => {
    const outcome = classifyPropositionVerdict(candidate, {
      pairId: 'RLP-1',
      predicate: 'prerequisite',
      outcome: 'related',
      direction: 'b-to-a',
      confidence: 0.7,
      aKey: 'ck-a',
      bKey: 'ck-b',
    });
    expect(outcome).toEqual({ kind: 'related', fromKey: 'ck-b', toKey: 'ck-a', confidence: 0.7 });
  });

  it('passes through none and insufficient-evidence directly, no key claim required', () => {
    expect(
      classifyPropositionVerdict(candidate, {
        pairId: 'RLP-1',
        predicate: 'prerequisite',
        outcome: 'none',
      }),
    ).toEqual({ kind: 'none' });
    expect(
      classifyPropositionVerdict(candidate, {
        pairId: 'RLP-1',
        predicate: 'prerequisite',
        outcome: 'insufficient-evidence',
      }),
    ).toEqual({ kind: 'insufficient-evidence' });
  });

  it('Default 5: a related verdict missing either key is a failure, never resolved by name', () => {
    const outcome = classifyPropositionVerdict(candidate, {
      pairId: 'RLP-1',
      predicate: 'prerequisite',
      outcome: 'related',
      direction: 'a-to-b',
      confidence: 0.9,
      aKey: 'ck-a',
      // bKey omitted — this module never receives a name to fall back to at all.
    });
    expect(outcome).toEqual({ kind: 'failed', reason: 'keyless-verdict' });
  });

  it('Default 5: a related verdict whose keys do not match the candidate is a failure', () => {
    const outcome = classifyPropositionVerdict(candidate, {
      pairId: 'RLP-1',
      predicate: 'prerequisite',
      outcome: 'related',
      direction: 'a-to-b',
      confidence: 0.9,
      aKey: 'ck-a',
      bKey: 'ck-wrong',
    });
    expect(outcome).toEqual({ kind: 'failed', reason: 'keyless-verdict' });
  });

  it('a verdict for a different pairId is unknown-pair, never matched by coincidence', () => {
    const outcome = classifyPropositionVerdict(candidate, {
      pairId: 'RLP-999',
      predicate: 'prerequisite',
      outcome: 'related',
      direction: 'a-to-b',
      confidence: 0.9,
      aKey: 'ck-a',
      bKey: 'ck-b',
    });
    expect(outcome).toEqual({ kind: 'failed', reason: 'unknown-pair' });
  });

  it('no response at all is an operational failure, requeue-shaped', () => {
    expect(classifyPropositionVerdict(candidate, undefined)).toEqual({
      kind: 'failed',
      reason: 'no-response',
    });
  });

  it('a directed predicate with no stated direction is malformed', () => {
    const outcome = classifyPropositionVerdict(candidate, {
      pairId: 'RLP-1',
      predicate: 'prerequisite',
      outcome: 'related',
      confidence: 0.9,
      aKey: 'ck-a',
      bKey: 'ck-b',
    });
    expect(outcome).toEqual({ kind: 'failed', reason: 'malformed' });
  });

  it('contrasts-with needs no direction', () => {
    const outcome = classifyPropositionVerdict(candidate, {
      pairId: 'RLP-1',
      predicate: 'contrasts-with',
      outcome: 'related',
      confidence: 0.5,
      aKey: 'ck-a',
      bKey: 'ck-b',
    });
    expect(outcome).toEqual({ kind: 'related', fromKey: 'ck-a', toKey: 'ck-b', confidence: 0.5 });
  });
});

describe('classifyPropositionVerdict — endpointRevisions stamping at judgment time (ol-egov.141.89.4.14)', () => {
  function stampingOver(
    pathsByKey: Record<string, readonly string[]>,
    revisionsByPath: Record<string, string>,
  ): PropositionEndpointRevisionStampingOptions {
    return {
      introducingPaths: (key) => pathsByKey[key] ?? [],
      pathRevision: (path) => revisionsByPath[path],
    };
  }

  const relatedVerdict = {
    pairId: 'RLP-1',
    predicate: 'prerequisite' as const,
    outcome: 'related' as const,
    direction: 'a-to-b' as const,
    confidence: 0.9,
    aKey: 'ck-a',
    bKey: 'ck-b',
  };

  it('stamps endpointRevisions when a stamping port is given and both endpoints resolve', () => {
    const stamping = stampingOver(
      { 'ck-a': ['notes/a.md'], 'ck-b': ['notes/b.md'] },
      { 'notes/a.md': 'rev-1', 'notes/b.md': 'rev-1' },
    );
    const outcome = classifyPropositionVerdict(candidate, relatedVerdict, stamping);
    expect(outcome.kind).toBe('related');
    expect(outcome.kind === 'related' ? outcome.endpointRevisions : undefined).toEqual({
      from: expect.any(String),
      to: expect.any(String),
    });
  });

  it('omits endpointRevisions when no stamping port is given — unchanged, existing behaviour', () => {
    const outcome = classifyPropositionVerdict(candidate, relatedVerdict);
    expect(outcome).toEqual({ kind: 'related', fromKey: 'ck-a', toKey: 'ck-b', confidence: 0.9 });
  });

  it('never a guess: omits endpointRevisions when one endpoint has no revision on record', () => {
    const stamping = stampingOver(
      { 'ck-a': ['notes/a.md'], 'ck-b': ['notes/b.md'] },
      { 'notes/a.md': 'rev-1' }, // notes/b.md: unknown
    );
    const outcome = classifyPropositionVerdict(candidate, relatedVerdict, stamping);
    expect(outcome.kind === 'related' ? outcome.endpointRevisions : 'not-related').toBeUndefined();
  });

  it('never stamps a non-related outcome (none/insufficient-evidence/failed carry no endpointRevisions field at all)', () => {
    const stamping = stampingOver({ 'ck-a': ['notes/a.md'] }, { 'notes/a.md': 'rev-1' });
    const outcome = classifyPropositionVerdict(
      candidate,
      { pairId: 'RLP-1', predicate: 'prerequisite', outcome: 'none' },
      stamping,
    );
    expect(outcome).toEqual({ kind: 'none' });
  });
});

describe('Default 1 — every corpus-eligible predicate, independently', () => {
  it('corpusEligiblePredicates names more than one predicate', () => {
    expect(corpusEligiblePredicates().length).toBeGreaterThan(1);
    expect(corpusEligiblePredicates()).toContain('prerequisite');
    expect(corpusEligiblePredicates()).toContain('contrasts-with');
  });

  it('propositionsForCandidates offers every eligible predicate per candidate, not one pick', () => {
    const propositions = propositionsForCandidates([candidate]);
    const predicates = propositions.map((p) => p.predicate).sort();
    expect(predicates).toEqual([...corpusEligiblePredicates()].sort());
  });

  it('two candidates each get every predicate, independently — no cross-contamination', () => {
    const other = { pairId: 'RLP-2', aKey: 'ck-c', bKey: 'ck-d' };
    const propositions = propositionsForCandidates([candidate, other]);
    expect(propositions).toHaveLength(2 * corpusEligiblePredicates().length);
    expect(propositions.filter((p) => p.candidate === candidate)).toHaveLength(
      corpusEligiblePredicates().length,
    );
  });
});
