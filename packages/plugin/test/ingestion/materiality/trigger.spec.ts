import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import { evaluateMaterialityGate } from '../../../src/ingestion/materiality/trigger.js';
import type { MaterialityHashes } from '../../../src/ingestion/materiality/types.js';

const CONSTANTS = DEFAULT_MATERIALITY_CONSTANTS;
const NOW = 1_000_000;

const HASH_A: MaterialityHashes = { rawHash: 'raw-a', canonicalHash: 'canon-a' };
const HASH_A_REFORMATTED: MaterialityHashes = {
  rawHash: 'raw-a-reformatted',
  canonicalHash: 'canon-a',
};
const HASH_B: MaterialityHashes = { rawHash: 'raw-b', canonicalHash: 'canon-b' };

describe('evaluateMaterialityGate — the free stage of register row 1.4', () => {
  it("'unchanged' when the raw hash matches — never reaches formatting/debounce/floor checks", () => {
    const outcome = evaluateMaterialityGate({
      previous: HASH_A,
      current: HASH_A,
      canonicalCharDelta: 0,
      lastChangedAt: NOW - 10,
      now: NOW,
      constants: CONSTANTS,
    });
    expect(outcome).toEqual({ kind: 'unchanged' });
  });

  it("'formatting-only' when the raw hash changed but the canonical hash did not — row 1.4's own health check, met structurally", () => {
    const outcome = evaluateMaterialityGate({
      previous: HASH_A,
      current: HASH_A_REFORMATTED,
      canonicalCharDelta: 0,
      lastChangedAt: NOW - CONSTANTS.debounceMs - 1,
      now: NOW,
      constants: CONSTANTS,
    });
    expect(outcome).toEqual({ kind: 'formatting-only' });
  });

  it("'debounced' when the path changed too recently, with a resumeNotBefore at the debounce boundary", () => {
    const lastChangedAt = NOW - 1;
    const outcome = evaluateMaterialityGate({
      previous: HASH_A,
      current: HASH_B,
      canonicalCharDelta: 1000,
      lastChangedAt,
      now: NOW,
      constants: CONSTANTS,
    });
    expect(outcome).toEqual({
      kind: 'debounced',
      resumeNotBefore: lastChangedAt + CONSTANTS.debounceMs,
    });
  });

  it("'below-floor' when the debounce has cleared but the canonical delta is under the floor", () => {
    const outcome = evaluateMaterialityGate({
      previous: HASH_A,
      current: HASH_B,
      canonicalCharDelta: CONSTANTS.minEditChars - 1,
      lastChangedAt: NOW - CONSTANTS.debounceMs - 1,
      now: NOW,
      constants: CONSTANTS,
    });
    expect(outcome).toEqual({ kind: 'below-floor' });
  });

  it("'call-judge' once debounce and the floor both clear", () => {
    const outcome = evaluateMaterialityGate({
      previous: HASH_A,
      current: HASH_B,
      canonicalCharDelta: CONSTANTS.minEditChars,
      lastChangedAt: NOW - CONSTANTS.debounceMs - 1,
      now: NOW,
      constants: CONSTANTS,
    });
    expect(outcome).toEqual({ kind: 'call-judge' });
  });

  it('a below-floor edit does not exempt the file from a later, larger change (D-093: never exempt, only skip the one sub-floor edit)', () => {
    // First evaluation: a tiny edit, below the floor.
    const first = evaluateMaterialityGate({
      previous: HASH_A,
      current: HASH_B,
      canonicalCharDelta: 1,
      lastChangedAt: NOW - CONSTANTS.debounceMs - 1,
      now: NOW,
      constants: CONSTANTS,
    });
    expect(first).toEqual({ kind: 'below-floor' });

    // A later, larger edit against the same previous record clears the floor.
    const second = evaluateMaterialityGate({
      previous: HASH_A,
      current: HASH_B,
      canonicalCharDelta: CONSTANTS.minEditChars * 5,
      lastChangedAt: NOW - CONSTANTS.debounceMs - 1,
      now: NOW + 10,
      constants: CONSTANTS,
    });
    expect(second).toEqual({ kind: 'call-judge' });
  });

  it('a first sighting (no previous record) always clears debounce and the floor — first sighting is always material to notice', () => {
    const outcome = evaluateMaterialityGate({
      previous: null,
      current: HASH_A,
      canonicalCharDelta: 0,
      lastChangedAt: null,
      now: NOW,
      constants: CONSTANTS,
    });
    expect(outcome).toEqual({ kind: 'call-judge' });
  });

  it('debounce is evaluated before the floor — a large but too-recent edit is debounced, not floored', () => {
    const outcome = evaluateMaterialityGate({
      previous: HASH_A,
      current: HASH_B,
      canonicalCharDelta: CONSTANTS.minEditChars * 100,
      lastChangedAt: NOW - 1,
      now: NOW,
      constants: CONSTANTS,
    });
    expect(outcome.kind).toBe('debounced');
  });

  describe('defect 4 (ol-egov.141.89.5.7): an empty new note does not count as new material', () => {
    it("'no-groundable-content' for a first sighting whose canonicalised text is empty", () => {
      const outcome = evaluateMaterialityGate({
        previous: null,
        current: HASH_A,
        canonicalCharDelta: Number.POSITIVE_INFINITY,
        lastChangedAt: null,
        now: NOW,
        constants: CONSTANTS,
        currentCanonicalLength: 0,
      });
      expect(outcome).toEqual({ kind: 'no-groundable-content' });
    });

    it("still 'call-judge' for a first sighting with real content — only emptiness changes the route", () => {
      const outcome = evaluateMaterialityGate({
        previous: null,
        current: HASH_A,
        canonicalCharDelta: Number.POSITIVE_INFINITY,
        lastChangedAt: null,
        now: NOW,
        constants: CONSTANTS,
        currentCanonicalLength: 12,
      });
      expect(outcome).toEqual({ kind: 'call-judge' });
    });

    it('omitting currentCanonicalLength never triggers the empty-note exit — existing callers keep their behaviour', () => {
      const outcome = evaluateMaterialityGate({
        previous: null,
        current: HASH_A,
        canonicalCharDelta: Number.POSITIVE_INFINITY,
        lastChangedAt: null,
        now: NOW,
        constants: CONSTANTS,
      });
      expect(outcome).toEqual({ kind: 'call-judge' });
    });

    it('an EXISTING note edited down to empty is an ordinary change, not the empty-new-note exit (previous !== null)', () => {
      const outcome = evaluateMaterialityGate({
        previous: HASH_A,
        current: HASH_B,
        canonicalCharDelta: CONSTANTS.minEditChars * 5,
        lastChangedAt: NOW - CONSTANTS.debounceMs - 1,
        now: NOW,
        constants: CONSTANTS,
        currentCanonicalLength: 0,
      });
      expect(outcome).toEqual({ kind: 'call-judge' });
    });
  });
});
