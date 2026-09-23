/**
 * `intendedOperationForHeading` — every fixture is an invented, subject-
 * neutral heading, so INV-3 does not apply to this file the way it does to a
 * module reading real material.
 */

import { describe, expect, it } from 'vitest';
import { intendedOperationForHeading, operationCues } from './operation.js';

describe('intendedOperationForHeading — define', () => {
  it('maps "What is X?"', () => {
    expect(intendedOperationForHeading('What is osmosis?')).toBe('define');
  });

  it('maps "What are X?"', () => {
    expect(intendedOperationForHeading('What are the reagents used here?')).toBe('define');
  });

  it('maps "Define X"', () => {
    expect(intendedOperationForHeading('Define entropy')).toBe('define');
  });

  it('maps "What does X mean?"', () => {
    expect(intendedOperationForHeading('What does convection mean?')).toBe('define');
  });
});

describe('intendedOperationForHeading — compare', () => {
  it('maps "What is the difference between X and Y?" to compare, not define', () => {
    expect(intendedOperationForHeading('What is the difference between mitosis and meiosis?')).toBe(
      'compare',
    );
  });

  it('maps "How does X differ from Y?"', () => {
    expect(intendedOperationForHeading('How does osmosis differ from diffusion?')).toBe('compare');
  });

  it('maps "Compare X and Y"', () => {
    expect(intendedOperationForHeading('Compare aerobic and anaerobic respiration')).toBe(
      'compare',
    );
  });
});

describe('intendedOperationForHeading — calculate', () => {
  it('maps "Calculate X"', () => {
    expect(intendedOperationForHeading('Calculate the molarity of the solution')).toBe('calculate');
  });

  it('maps "How much...?" to calculate, not apply/explain', () => {
    expect(intendedOperationForHeading('How much energy is released in the reaction?')).toBe(
      'calculate',
    );
  });

  it('maps "How many...?" to calculate', () => {
    expect(intendedOperationForHeading('How many electrons are in the outer shell?')).toBe(
      'calculate',
    );
  });

  it('maps "What is the value of X?" to calculate, not define (row order)', () => {
    expect(intendedOperationForHeading('What is the value of x in this equation?')).toBe(
      'calculate',
    );
  });
});

describe('intendedOperationForHeading — apply', () => {
  it('maps "How do you use X?"', () => {
    expect(intendedOperationForHeading('How do you use this formula to solve for velocity?')).toBe(
      'apply',
    );
  });

  it('maps "How would you apply X?"', () => {
    expect(intendedOperationForHeading("How would you apply Le Chatelier's principle here?")).toBe(
      'apply',
    );
  });

  it('maps "How is X applied to Y?" to apply, not explain (row order)', () => {
    expect(intendedOperationForHeading('How is the theorem applied to this proof?')).toBe('apply');
  });
});

describe('intendedOperationForHeading — explain (the residual class)', () => {
  it('maps a bare "Why...?"', () => {
    expect(intendedOperationForHeading('Why does the reaction slow down over time?')).toBe(
      'explain',
    );
  });

  it('maps "How does X work?" to explain, not apply — no "applied"/"used" wording', () => {
    expect(intendedOperationForHeading('How does the enzyme catalyse the reaction?')).toBe(
      'explain',
    );
  });

  it('maps "Explain X"', () => {
    expect(intendedOperationForHeading('Explain the process of mitosis')).toBe('explain');
  });
});

describe('intendedOperationForHeading — undefined when nothing is clearly asked', () => {
  it('returns undefined for a plain yes/no question', () => {
    expect(intendedOperationForHeading('Is photosynthesis reversible?')).toBeUndefined();
  });

  it('returns undefined for a declarative topic heading', () => {
    expect(intendedOperationForHeading('Overview of the cell cycle')).toBeUndefined();
  });

  it('returns undefined for an empty heading', () => {
    expect(intendedOperationForHeading('')).toBeUndefined();
  });

  it('returns undefined for a heading that is only emphasis markers', () => {
    expect(intendedOperationForHeading('****')).toBeUndefined();
  });
});

describe('intendedOperationForHeading — markdown emphasis is stripped, same as ./detect.ts', () => {
  it('reads a bolded heading the same as its unbolded text', () => {
    expect(intendedOperationForHeading('**What is osmosis?**')).toBe('define');
  });
});

describe('operationCues — the declared table is exposed and non-empty', () => {
  it('names all five IntendedOperation values across its rows', () => {
    const operations = new Set(operationCues().map((cue) => cue.operation));
    expect(operations).toEqual(new Set(['define', 'explain', 'calculate', 'apply', 'compare']));
  });

  it('every row carries a non-empty reason', () => {
    for (const cue of operationCues()) {
      expect(cue.why.length).toBeGreaterThan(0);
    }
  });
});
