import { describe, expect, it } from 'vitest';
import { DEFAULT_M1_THRESHOLD, matchExistingMisconception } from './matcher.js';

// Synthetic vectors, invented for this test only (INV-3) — never real
// embeddings or real course content. Small, hand-constructed dimensions so
// the intended similarity is legible from the numbers themselves.

/** Two vectors pointing in exactly the same direction: cosine 1. */
const SAME_DIRECTION_A = [1, 0, 0, 0];
const SAME_DIRECTION_B = [2, 0, 0, 0]; // same direction, different magnitude — cosine ignores magnitude

/** A vector orthogonal to SAME_DIRECTION_A: cosine 0. */
const ORTHOGONAL = [0, 1, 0, 0];

/** A vector at a shallow angle to SAME_DIRECTION_A — well below M1's conservative default. */
const SHALLOW_ANGLE = [1, 1, 1, 1];

describe('matchExistingMisconception — M1 conservative embedding match', () => {
  it('matches a statement embedding that is (near-)identical in direction to an existing candidate', () => {
    const result = matchExistingMisconception(SAME_DIRECTION_A, [
      { id: 'm-1', embedding: SAME_DIRECTION_B },
    ]);
    expect(result).toBe('m-1');
  });

  it('does NOT merge two distinct wrong answers about the same concept — the load-bearing M1 property', () => {
    // Two candidate misconceptions already on file for one concept, plus a
    // brand-new statement whose embedding is only moderately similar to
    // either — the ordinary shape of "wrong in a different way," not a
    // paraphrase of an existing one.
    const candidates = [
      { id: 'm-existing-1', embedding: SAME_DIRECTION_A },
      { id: 'm-existing-2', embedding: ORTHOGONAL },
    ];
    const newStatementEmbedding = SHALLOW_ANGLE;

    const result = matchExistingMisconception(newStatementEmbedding, candidates);

    // Sanity: SHALLOW_ANGLE really is below the conservative default against
    // both candidates, so this test is exercising the threshold and not
    // accidentally passing for an unrelated reason.
    expect(result).toBeNull();
  });

  it('returns null against an empty candidate list (first occurrence for a concept)', () => {
    expect(matchExistingMisconception(SAME_DIRECTION_A, [])).toBeNull();
  });

  it('respects an explicitly looser threshold when a caller opts into one', () => {
    // Same shallow-angle case as above, but with the default overridden low
    // enough that the match now clears it — proves the threshold argument is
    // load-bearing, not decorative.
    const candidates = [{ id: 'm-existing-1', embedding: SAME_DIRECTION_A }];
    const result = matchExistingMisconception(SHALLOW_ANGLE, candidates, 0.1);
    expect(result).toBe('m-existing-1');
  });

  it('breaks a tied top score by the lexicographically smaller id, deterministically', () => {
    const candidates = [
      { id: 'm-zzz', embedding: SAME_DIRECTION_A },
      { id: 'm-aaa', embedding: SAME_DIRECTION_A },
    ];
    expect(matchExistingMisconception(SAME_DIRECTION_A, candidates)).toBe('m-aaa');
    // Order-independence: reversing the input array must not change the winner.
    expect(matchExistingMisconception(SAME_DIRECTION_A, [...candidates].reverse())).toBe('m-aaa');
  });

  it('the default threshold is genuinely conservative (>= 0.9)', () => {
    // A guard on the constant itself, not just its effect above — a future
    // edit that quietly lowers this to something merge-happy should fail a
    // test that reads as intentional, not just the behavioural ones.
    expect(DEFAULT_M1_THRESHOLD).toBeGreaterThanOrEqual(0.9);
  });
});
