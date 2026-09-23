/**
 * `checkMcqDraft` — every fixture below is invented (subject-neutral,
 * fictional course code), so INV-3 does not apply to this file the way it
 * does to a module reading real material.
 */

import { describe, expect, it } from 'vitest';
import type { GeneratedMcqCandidate } from '../instrument/mcq-generated.js';
import { MIN_DISTRACTOR_POOL } from '../instrument/types.js';
import { checkMcqDraft } from './mcq-draft-checks.js';

function draft(overrides: Partial<GeneratedMcqCandidate> = {}): GeneratedMcqCandidate {
  return {
    stem: 'Which reagent turns the indicator blue in the demonstration?',
    correctAnswer: 'Reagent Q',
    distractors: ['Reagent R', 'Reagent S'],
    feedback: 'Reagent Q is the only one that shifts the indicator at this pH.',
    ...overrides,
  };
}

describe('checkMcqDraft — clean drafts', () => {
  it('returns no defects for a clean draft at exactly the floor', () => {
    expect(checkMcqDraft(draft())).toEqual([]);
  });

  it('a draft with fewer sound distractors than the floor allows is still clean, as long as the floor holds (pra.md §2)', () => {
    // Two distinct, sound distractors — the floor, not a shortfall.
    expect(checkMcqDraft(draft({ distractors: ['Reagent R', 'Reagent S'] }))).toEqual([]);
  });

  it('a larger, clean pool is also clean', () => {
    expect(
      checkMcqDraft(draft({ distractors: ['Reagent R', 'Reagent S', 'Reagent T', 'Reagent U'] })),
    ).toEqual([]);
  });
});

describe('checkMcqDraft — duplicate-distractors', () => {
  it('flags two distractors that are exactly equal', () => {
    const defects = checkMcqDraft(draft({ distractors: ['Reagent R', 'Reagent R'] }));
    expect(defects.map((d) => d.kind)).toContain('duplicate-distractors');
  });

  it('flags two distractors that are equal only after normalisation (case and whitespace)', () => {
    const defects = checkMcqDraft(draft({ distractors: ['  Reagent   R', 'reagent r'] }));
    expect(defects.map((d) => d.kind)).toContain('duplicate-distractors');
  });

  it('does not flag two genuinely distinct distractors', () => {
    const defects = checkMcqDraft(draft({ distractors: ['Reagent R', 'Reagent T'] }));
    expect(defects.map((d) => d.kind)).not.toContain('duplicate-distractors');
  });
});

describe('checkMcqDraft — key-among-distractors', () => {
  it('flags the keyed answer appearing among the distractors, exact match', () => {
    const defects = checkMcqDraft(
      draft({ correctAnswer: 'Reagent Q', distractors: ['Reagent Q', 'Reagent S'] }),
    );
    expect(defects.map((d) => d.kind)).toContain('key-among-distractors');
  });

  it('flags the keyed answer matching a distractor only after normalisation', () => {
    const defects = checkMcqDraft(
      draft({ correctAnswer: 'Reagent Q', distractors: ['reagent   q', 'Reagent S'] }),
    );
    expect(defects.map((d) => d.kind)).toContain('key-among-distractors');
  });

  it('does not flag a key that is genuinely distinct from every distractor', () => {
    const defects = checkMcqDraft(draft());
    expect(defects.map((d) => d.kind)).not.toContain('key-among-distractors');
  });
});

describe('checkMcqDraft — below-distractor-floor ([D-195])', () => {
  it(`flags a pool below MIN_DISTRACTOR_POOL (${MIN_DISTRACTOR_POOL})`, () => {
    const defects = checkMcqDraft(draft({ distractors: ['Reagent R'] }));
    expect(defects.map((d) => d.kind)).toContain('below-distractor-floor');
  });

  it('flags an empty distractor pool', () => {
    const defects = checkMcqDraft(draft({ distractors: [] }));
    expect(defects.map((d) => d.kind)).toContain('below-distractor-floor');
  });

  it('does not flag a pool exactly at the floor', () => {
    const defects = checkMcqDraft(draft({ distractors: ['Reagent R', 'Reagent S'] }));
    expect(defects.map((d) => d.kind)).not.toContain('below-distractor-floor');
  });
});

describe('checkMcqDraft — above-style-option (declared list, exact-normalised match)', () => {
  it('flags "all of the above" as a distractor', () => {
    const defects = checkMcqDraft(draft({ distractors: ['All of the Above', 'Reagent S'] }));
    expect(defects.map((d) => d.kind)).toContain('above-style-option');
  });

  it('flags "none of the above" as the keyed answer', () => {
    const defects = checkMcqDraft(draft({ correctAnswer: 'None of the above' }));
    expect(defects.map((d) => d.kind)).toContain('above-style-option');
  });

  it('does not flag an option that merely mentions "above" in a real sentence (conservative bias — exact match only)', () => {
    const defects = checkMcqDraft(
      draft({
        distractors: ['The reaction described above never reaches equilibrium', 'Reagent S'],
      }),
    );
    expect(defects.map((d) => d.kind)).not.toContain('above-style-option');
  });
});

describe('checkMcqDraft — empty stem / feedback', () => {
  it('flags an empty stem', () => {
    const defects = checkMcqDraft(draft({ stem: '' }));
    expect(defects.map((d) => d.kind)).toContain('empty-stem');
  });

  it('flags a whitespace-only stem', () => {
    const defects = checkMcqDraft(draft({ stem: '   ' }));
    expect(defects.map((d) => d.kind)).toContain('empty-stem');
  });

  it('flags an empty feedback', () => {
    const defects = checkMcqDraft(draft({ feedback: '' }));
    expect(defects.map((d) => d.kind)).toContain('empty-feedback');
  });

  it('does not flag a non-empty stem and feedback', () => {
    const defects = checkMcqDraft(draft());
    expect(defects.map((d) => d.kind)).not.toContain('empty-stem');
    expect(defects.map((d) => d.kind)).not.toContain('empty-feedback');
  });
});

describe('checkMcqDraft — presentation-incompatible (reuses presentMcq, never duplicates its rule)', () => {
  it('flags a draft below the floor, the same condition presentMcq itself throws on', () => {
    const defects = checkMcqDraft(draft({ distractors: ['Reagent R'] }));
    const kinds = defects.map((d) => d.kind);
    // Both fire together for this one input — see the module doc for why
    // that overlap is deliberate rather than a duplicate check.
    expect(kinds).toContain('below-distractor-floor');
    expect(kinds).toContain('presentation-incompatible');
  });

  it('a draft at or above the floor never trips the presenter', () => {
    const defects = checkMcqDraft(draft());
    expect(defects.map((d) => d.kind)).not.toContain('presentation-incompatible');
  });
});

describe('checkMcqDraft — a draft can carry more than one defect at once', () => {
  it('reports every defect it finds, not just the first', () => {
    const defects = checkMcqDraft(
      draft({ stem: '', feedback: '', correctAnswer: 'Reagent Q', distractors: ['Reagent Q'] }),
    );
    const kinds = defects.map((d) => d.kind);
    expect(kinds).toContain('empty-stem');
    expect(kinds).toContain('empty-feedback');
    expect(kinds).toContain('key-among-distractors');
    expect(kinds).toContain('below-distractor-floor');
    expect(kinds).toContain('presentation-incompatible');
  });
});
