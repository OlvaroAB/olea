/**
 * `demandForHeading` — every fixture is an invented, subject-neutral
 * heading, so INV-3 does not apply to this file the way it does to a module
 * reading real material.
 */

import { describe, expect, it } from 'vitest';
import { demandCues, demandForHeading } from './operation.js';

describe('demandForHeading — recall-a-fact', () => {
  it('maps "What is X?"', () => {
    expect(demandForHeading('What is osmosis?')).toBe('recall-a-fact');
  });

  it('maps "What are X?"', () => {
    expect(demandForHeading('What are the reagents used here?')).toBe('recall-a-fact');
  });

  it('maps "Define X"', () => {
    expect(demandForHeading('Define entropy')).toBe('recall-a-fact');
  });

  it('maps "What does X mean?"', () => {
    expect(demandForHeading('What does convection mean?')).toBe('recall-a-fact');
  });
});

describe('demandForHeading — compare-or-choose', () => {
  it('maps "What is the difference between X and Y?" to compare-or-choose, not recall-a-fact', () => {
    expect(demandForHeading('What is the difference between mitosis and meiosis?')).toBe(
      'compare-or-choose',
    );
  });

  it('maps "How does X differ from Y?"', () => {
    expect(demandForHeading('How does osmosis differ from diffusion?')).toBe('compare-or-choose');
  });

  it('maps "Compare X and Y"', () => {
    expect(demandForHeading('Compare aerobic and anaerobic respiration')).toBe('compare-or-choose');
  });
});

describe('demandForHeading — calculate', () => {
  it('maps "Calculate X"', () => {
    expect(demandForHeading('Calculate the molarity of the solution')).toBe('calculate');
  });

  it('maps "How much...?" to calculate, not apply/interpret', () => {
    expect(demandForHeading('How much energy is released in the reaction?')).toBe('calculate');
  });

  it('maps "How many...?" to calculate', () => {
    expect(demandForHeading('How many electrons are in the outer shell?')).toBe('calculate');
  });

  it('maps "What is the value of X?" to calculate, not recall-a-fact (row order)', () => {
    expect(demandForHeading('What is the value of x in this equation?')).toBe('calculate');
  });
});

describe('demandForHeading — apply-to-unfamiliar-case', () => {
  it('maps "How do you use X?"', () => {
    expect(demandForHeading('How do you use this formula to solve for velocity?')).toBe(
      'apply-to-unfamiliar-case',
    );
  });

  it('maps "How would you apply X?"', () => {
    expect(demandForHeading("How would you apply Le Chatelier's principle here?")).toBe(
      'apply-to-unfamiliar-case',
    );
  });

  it('maps "How is X applied to Y?" to apply-to-unfamiliar-case, not the residual class (row order)', () => {
    expect(demandForHeading('How is the theorem applied to this proof?')).toBe(
      'apply-to-unfamiliar-case',
    );
  });

  it('maps a heading naming "in this case"', () => {
    expect(demandForHeading('In this case, what would you do first?')).toBe(
      'apply-to-unfamiliar-case',
    );
  });
});

describe('demandForHeading — interpret-printed-result', () => {
  it('maps "What does this graph show?"', () => {
    expect(demandForHeading('What does this graph show?')).toBe('interpret-printed-result');
  });

  it('maps "What does the table indicate?"', () => {
    expect(demandForHeading('What does the table indicate?')).toBe('interpret-printed-result');
  });

  it('maps "What does the result show?"', () => {
    expect(demandForHeading('What does the result show about reaction rate?')).toBe(
      'interpret-printed-result',
    );
  });

  it('maps "What do the figures tell you?"', () => {
    expect(demandForHeading('What do the figures tell you about the trend?')).toBe(
      'interpret-printed-result',
    );
  });
});

describe('demandForHeading — undefined when nothing is clearly asked', () => {
  it('returns undefined for a plain yes/no question', () => {
    expect(demandForHeading('Is photosynthesis reversible?')).toBeUndefined();
  });

  it('returns undefined for a declarative topic heading', () => {
    expect(demandForHeading('Overview of the cell cycle')).toBeUndefined();
  });

  it('returns undefined for an empty heading', () => {
    expect(demandForHeading('')).toBeUndefined();
  });

  it('returns undefined for a heading that is only emphasis markers', () => {
    expect(demandForHeading('****')).toBeUndefined();
  });
});

describe('demandForHeading — a bare "why" or "how does" heading is deliberately left unmapped', () => {
  it('returns undefined for a bare "Why...?" — no demand named in [D-262] fits an explanation', () => {
    expect(demandForHeading('Why does the reaction slow down over time?')).toBeUndefined();
  });

  it('returns undefined for "How does X work?" — no "applied"/"used"/"in this case" wording', () => {
    expect(demandForHeading('How does the enzyme catalyse the reaction?')).toBeUndefined();
  });

  it('returns undefined for "Explain X"', () => {
    expect(demandForHeading('Explain the process of mitosis')).toBeUndefined();
  });
});

describe('demandForHeading — markdown emphasis is stripped, same as ./detect.ts', () => {
  it('reads a bolded heading the same as its unbolded text', () => {
    expect(demandForHeading('**What is osmosis?**')).toBe('recall-a-fact');
  });
});

describe('demandCues — the declared table is exposed and non-empty', () => {
  it('names all five PaperDemand values across its rows', () => {
    const demands = new Set(demandCues().map((cue) => cue.demand));
    expect(demands).toEqual(
      new Set([
        'recall-a-fact',
        'calculate',
        'compare-or-choose',
        'apply-to-unfamiliar-case',
        'interpret-printed-result',
      ]),
    );
  });

  it('every row carries a non-empty reason', () => {
    for (const cue of demandCues()) {
      expect(cue.why.length).toBeGreaterThan(0);
    }
  });
});
