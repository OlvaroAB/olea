// `ol-egov.141.89.9.70` item 1 ([D-414], `ol-egov.141.89.48`): the vocabulary registry's section 25
// forbidden uses on the demand-grain gap sentence, as a check that can fail. Every string here is
// invented (INV-3); the "shape probe" sentence is a test probe for the checker and is not product
// copy: the registry ratifies the sentence's shape and leaves its copy to a design pass.
//
// The registry's forbidden list, one test group each:
//  - naming the missing content itself (the sufficiency judgment's own statement of what is
//    missing never reaches the sentence);
//  - printing a verdict word, or the word "demand" as a label;
//  - any weakness or deficit word (section 22): a source gap is not a reading of what she knows;
//  - placing the sentence inside an ordinary session: it belongs to the gap view and the grove only.

import { describe, expect, it } from 'vitest';
import {
  DEMAND_GAP_SURFACES,
  type DemandGapSentenceViolation,
  demandGapSentenceViolations,
} from './demand-gap-sentence-check.js';

/**
 * A sentence in the ruled shape (what was found, which demand the assessment asks for, where to
 * look) in plain words, used only to prove the checker accepts what the registry allows. Not copy.
 */
const SHAPE_PROBE =
  'Your notes cover recalling this; the assessment asks you to calculate with it; a worked example in your lecture slides is the place to look.';

const kinds = (violations: readonly DemandGapSentenceViolation[]) =>
  violations.map((violation) => violation.rule);

describe('the checker accepts the ruled shape, so a pass means something', () => {
  it('a sentence naming what was found, the demand in its plain words and where to look has no violation', () => {
    expect(demandGapSentenceViolations(SHAPE_PROBE, { surface: 'gap-view' })).toEqual([]);
  });

  it.each([
    'recall a fact',
    'calculate',
    'compare or choose between',
    'apply to an unfamiliar case',
    'read a printed result and reason from it',
  ])(
    'the demand vocabulary word "%s" is allowed: the sentence speaks in the demand words',
    (words) => {
      const sentence = `Your notes cover another kind of question; the assessment asks you to ${words}; the lecture slides are where to look.`;
      expect(demandGapSentenceViolations(sentence, { surface: 'grove' })).toEqual([]);
    },
  );
});

describe('registry section 25: naming the missing content is forbidden', () => {
  const judge = {
    reason: 'the passages never state the boiling point value used in the worked step',
    missing: ['the boiling point value', 'the rounding step'],
  };

  it('flags a sentence that repeats an item the judge said was missing', () => {
    const violations = demandGapSentenceViolations(
      'The assessment asks you to calculate with it, and the boiling point value is where to look.',
      { surface: 'gap-view', judgeStatements: [...judge.missing, judge.reason] },
    );
    expect(kinds(violations)).toContain('names-missing-content');
  });

  it('flags a sentence that repeats a run of the judge reason, whatever its case', () => {
    const violations = demandGapSentenceViolations(
      'Look for where THE PASSAGES NEVER STATE the value.',
      { surface: 'gap-view', judgeStatements: [judge.reason] },
    );
    expect(kinds(violations)).toContain('names-missing-content');
  });

  it.each([
    'The value is missing from your notes.',
    'Your notes lack the rounding step.',
    'Your notes do not contain the units.',
    "Your notes don't include the formula.",
    'There is no mention of the condition.',
    'You are lacking the definition.',
  ])('flags a sentence that says specific content is absent: %s', (sentence) => {
    expect(kinds(demandGapSentenceViolations(sentence, { surface: 'gap-view' }))).toContain(
      'names-missing-content',
    );
  });

  it('does not flag a sentence merely because the judge stated something else', () => {
    expect(
      demandGapSentenceViolations(SHAPE_PROBE, {
        surface: 'gap-view',
        judgeStatements: [judge.reason, ...judge.missing],
      }),
    ).toEqual([]);
  });

  it('ignores a judge statement too short to identify anything', () => {
    expect(
      demandGapSentenceViolations(SHAPE_PROBE, { surface: 'gap-view', judgeStatements: ['a', ''] }),
    ).toEqual([]);
  });
});

describe('registry section 25: no verdict word, and never the word demand as a label', () => {
  it.each(['partial', 'insufficient', 'conflicting', 'sufficient'])(
    'flags the verdict word "%s"',
    (word) => {
      const violations = demandGapSentenceViolations(
        `The assessment asks you to calculate, and your notes are ${word} for that; look at the lecture slides.`,
        { surface: 'gap-view' },
      );
      expect(kinds(violations)).toContain('verdict-word');
    },
  );

  it.each([
    'The demand here is to calculate.',
    'Unmet demands for this concept: calculate.',
    'Demand: calculate.',
  ])('flags the word demand: %s', (sentence) => {
    expect(kinds(demandGapSentenceViolations(sentence, { surface: 'gap-view' }))).toContain(
      'demand-word',
    );
  });

  it('matches whole words only: an ordinary word that contains a listed one is not a violation', () => {
    expect(
      demandGapSentenceViolations(
        'Your notes cover recalling this; the assessment asks you to calculate with it; a demanding worked example may be found in the lecture slides.',
        { surface: 'gap-view' },
      ).filter((violation) => violation.rule === 'demand-word'),
    ).toEqual([]);
  });
});

describe('registry section 25 (with section 22): no weakness or deficit word, and no reading of what she knows', () => {
  it.each([
    'weak',
    'weakness',
    'struggling',
    'behind',
    'catch up',
    "hasn't caught up",
    'deficit',
    'poor',
    'poorly',
    'badly',
  ])('flags "%s"', (word) => {
    expect(
      kinds(
        demandGapSentenceViolations(`You are ${word} on this; look at the lecture slides.`, {
          surface: 'gap-view',
        }),
      ),
    ).toContain('weakness-word');
  });

  it.each([
    "You don't know how to calculate with it.",
    'You have not learned this yet.',
    "You can't do the calculation.",
  ])('flags a reading of what she knows: %s', (sentence) => {
    expect(kinds(demandGapSentenceViolations(sentence, { surface: 'gap-view' }))).toContain(
      'weakness-word',
    );
  });
});

describe('registry section 25: the sentence belongs to the gap view and the grove only', () => {
  it('names exactly those two surfaces', () => {
    expect([...DEMAND_GAP_SURFACES].sort()).toEqual(['gap-view', 'grove']);
  });

  it.each(['session', 'today', 'home', 'refusal', 'practice-paper', 'review'])(
    'flags copy registered on the %s surface',
    (surface) => {
      expect(kinds(demandGapSentenceViolations(SHAPE_PROBE, { surface }))).toEqual([
        'placement-outside-gap-view-and-grove',
      ]);
    },
  );

  it.each(DEMAND_GAP_SURFACES)('accepts the shape probe on the %s', (surface) => {
    expect(demandGapSentenceViolations(SHAPE_PROBE, { surface })).toEqual([]);
  });
});

describe('every violation says which rule and what matched, never more', () => {
  it('reports the rule and the matched words in the sentence', () => {
    const violations = demandGapSentenceViolations('A partial answer.', { surface: 'gap-view' });
    expect(violations).toEqual([{ rule: 'verdict-word', matched: 'partial' }]);
  });

  it('reports each rule once per distinct match, and several rules for one sentence', () => {
    const violations = demandGapSentenceViolations('Partial and weak; the demand; partial again.', {
      surface: 'session',
    });
    expect(kinds(violations).sort()).toEqual(
      [
        'demand-word',
        'placement-outside-gap-view-and-grove',
        'verdict-word',
        'weakness-word',
      ].sort(),
    );
    expect(violations.filter((violation) => violation.rule === 'verdict-word')).toHaveLength(1);
  });
});
