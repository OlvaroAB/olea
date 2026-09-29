import { AUTHORING_SERVED_DEMANDS, authoringDemand, explainBackJudgeDemand } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { PAPER_GENERATOR_DECLARED_DEMANDS } from '../oracle/paper-blueprint.js';
import { PAPER_DEMANDS } from '../oracle/paper-types.js';
import { INSTRUMENT_TARGET_ORIGINS } from './target-store.js';

// `[D-437]` (`ol-egov.141.89.57`), design section 6, T1: one demand vocabulary. `PAPER_DEMANDS`
// (here) and `explainBackJudgeDemand` (`olea-contracts`) are two restatements of `[D-262]`'s five
// words; a sixth word is a Class C addition to both together, and this test is what makes an edit
// to one alone fail. The authoring wire's `authoringDemand` is the contract's enum itself, not a
// third copy, and its served-demand declaration is pinned to core's per-generator declaration.

const sorted = (words: readonly string[]) => [...words].sort();

describe('one demand vocabulary (T1)', () => {
  it('explainBackJudgeDemand and PAPER_DEMANDS are the same set of five words', () => {
    expect(sorted(explainBackJudgeDemand.options)).toEqual(sorted(PAPER_DEMANDS));
    expect(PAPER_DEMANDS).toHaveLength(5);
  });

  it('the authoring wire’s demand enum is the contract’s enum, so it cannot drift from PAPER_DEMANDS either', () => {
    expect(authoringDemand).toBe(explainBackJudgeDemand);
    expect(sorted(authoringDemand.options)).toEqual(sorted(PAPER_DEMANDS));
  });

  it('never contains explain: it is not a demand and is never coerced into one', () => {
    expect(PAPER_DEMANDS as readonly string[]).not.toContain('explain');
    expect(explainBackJudgeDemand.options as readonly string[]).not.toContain('explain');
  });
});

describe('the served-demand declaration is one fact on both sides', () => {
  it('core’s per-generator declared demands equal the contract’s served demands, task by task', () => {
    expect(Object.keys(PAPER_GENERATOR_DECLARED_DEMANDS).sort()).toEqual(
      Object.keys(AUTHORING_SERVED_DEMANDS).sort(),
    );
    for (const taskId of Object.keys(
      AUTHORING_SERVED_DEMANDS,
    ) as (keyof typeof AUTHORING_SERVED_DEMANDS)[]) {
      expect(sorted(PAPER_GENERATOR_DECLARED_DEMANDS[taskId])).toEqual(
        sorted(AUTHORING_SERVED_DEMANDS[taskId]),
      );
    }
  });
});

describe('the target record’s origins', () => {
  it('are the five the design names, and nothing has been added in passing', () => {
    expect(sorted(INSTRUMENT_TARGET_ORIGINS)).toEqual(
      sorted(['heading-cue', 'sweep', 'planner-need', 'revision', 'paper-handoff']),
    );
  });
});
