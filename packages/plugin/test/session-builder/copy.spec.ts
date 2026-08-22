/**
 * Scenarios: `features/F4-oracle.md`, "F4.6 / F4.7 / F4.8 — the session
 * builder", the four F4.9-and-principle-12 scenarios —
 * @auto:plugin/session-builder/copy.spec
 *
 * Same discipline as `test/gap/copy.spec.ts`: the fixed-string inventory is
 * where strings are RECORDED, and this file is where they are CHECKED —
 * including every derived sentence, exercised against representative models.
 */

import type {
  SessionAssessmentCountdown,
  StudySessionItem,
  StudySessionModel,
  StudySessionOmission,
  VaultPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { FULL_SYLLABUS_ADVICE } from '../../src/gap/copy.js';
import {
  allSessionBuilderStrings,
  assessmentName,
  budgetOptionLabel,
  countdownLine,
  durationBasisLine,
  emptySessionLines,
  focusLine,
  formatPreferenceLine,
  instrumentTypeLabel,
  leftOutLines,
  minutesLabel,
  SESSION_ATTRIBUTION,
  SESSION_BUDGET_OPTIONS,
  sessionFraming,
  sessionItemLine,
  sessionScreenCopy,
  sessionSummaryLine,
} from '../../src/session-builder/copy.js';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function item(overrides: Partial<StudySessionItem> = {}): StudySessionItem {
  return {
    position: 1,
    instrumentId: 'i1',
    instrumentType: 'qa',
    notePath: '05 Zettelkasten/Alpha.md' as VaultPath,
    noteTitle: 'Alpha',
    conceptName: 'Alpha',
    course: 'CRS101',
    gapClass: 'mastery-gap',
    gapRank: 1,
    gapScore: 9,
    estimatedSeconds: 45,
    durationSource: 'assumed',
    formatMatch: 'no-preference',
    ...overrides,
  };
}

function omission(overrides: Partial<StudySessionOmission> = {}): StudySessionOmission {
  return {
    conceptName: 'Beta',
    course: 'CRS101',
    gapClass: 'mastery-gap',
    gapRank: 2,
    reason: 'did-not-fit',
    ...overrides,
  };
}

function countdown(
  overrides: Partial<SessionAssessmentCountdown> = {},
): SessionAssessmentCountdown {
  return {
    assessmentPath: '02 Assignments/Quiz 2 - Bedform Stratification.md' as VaultPath,
    due: '2026-09-18',
    daysUntil: 4,
    type: 'Quiz',
    format: 'mcq',
    ...overrides,
  };
}

function model(overrides: Partial<StudySessionModel> = {}): StudySessionModel {
  const items = overrides.items ?? [item()];
  return {
    asOf: '2026-09-14',
    budgetMinutes: 20,
    budgetSeconds: 1200,
    plannedSeconds: items.reduce((total, i) => total + i.estimatedSeconds, 0),
    items,
    leftOut: [],
    leftOutInstrumentCount: 0,
    consideredRowCount: Math.max(items.length, 1),
    formatPreference: 'unknown',
    nextAssessment: countdown(),
    durationBasis: 'assumed',
    focusConcept: null,
    ...overrides,
  };
}

/**
 * Every sentence this module can produce, over models chosen to reach every
 * branch. The audits below run over THIS, not over the fixed inventory —
 * `ol-f49h`'s point, held here: an inventory is not an audit.
 */
function everyProducibleString(): readonly string[] {
  const strings: string[] = [...allSessionBuilderStrings(), ...sessionFraming()];

  const models: StudySessionModel[] = [
    model(),
    model({ formatPreference: 'mcq', items: [item({ formatMatch: 'preferred-format' })] }),
    model({ durationBasis: 'measured', items: [item({ durationSource: 'measured' })] }),
    model({ durationBasis: 'mixed' }),
    model({ items: [], consideredRowCount: 0, plannedSeconds: 0, nextAssessment: null }),
    model({ items: [], consideredRowCount: 5, plannedSeconds: 0 }),
    model({ focusConcept: 'Alpha' }),
    model({ focusConcept: 'Missing' }),
    model({
      nextAssessment: {
        assessmentPath: '02 Assignments/Essay 1.md' as VaultPath,
        due: null,
        daysUntil: null,
        type: null,
        format: 'unknown',
      },
    }),
    model({ nextAssessment: countdown({ daysUntil: 0 }) }),
    model({ nextAssessment: countdown({ daysUntil: 1 }) }),
    model({
      leftOut: [
        omission({ reason: 'did-not-fit' }),
        omission({ reason: 'no-instruments', gapClass: 'coverage-gap' }),
        omission({ reason: 'no-instruments', gapClass: 'material-gap' }),
        omission({ reason: 'no-instruments', gapClass: 'mastery-gap' }),
        omission({ reason: 'already-in-session' }),
      ],
      leftOutInstrumentCount: 3,
    }),
    model({ leftOut: [omission({ reason: 'did-not-fit' }), omission({ reason: 'did-not-fit' })] }),
  ];

  for (const m of models) {
    strings.push(...sessionScreenCopy(m));
    strings.push(...leftOutLines(m));
    strings.push(...emptySessionLines(m));
    const countdownText = countdownLine(m);
    if (countdownText !== null) strings.push(countdownText);
    const format = formatPreferenceLine(m);
    if (format !== null) strings.push(format);
    const focus = focusLine(m);
    if (focus !== null) strings.push(focus);
    strings.push(durationBasisLine(m));
    if (m.items.length > 0) strings.push(sessionSummaryLine(m));
    for (const i of m.items) strings.push(sessionItemLine(i));
  }

  return [...new Set(strings)];
}

// --------------------------------------------------------------------------
// F4.9
// --------------------------------------------------------------------------

describe('F4.9 — likelihood not prophecy, never implies knowledge of a real paper', () => {
  const FORBIDDEN = [
    'will ask',
    'will be asked',
    'will come up',
    'will contain',
    'is going to be on',
    'this paper has asked',
    'this paper has actually asked',
    'likely to be on',
    'expect to see',
    "what's on the exam",
    'guaranteed',
    'predict',
  ];

  it('produces no string implying the assessment ahead has asked, will ask, or will contain anything', () => {
    const strings = everyProducibleString();
    // Guard against the audit passing because the enumeration is empty — the
    // inventory-is-not-an-audit failure ol-f49h records.
    expect(strings.length).toBeGreaterThan(25);
    for (const phrase of FORBIDDEN) {
      const offenders = strings.filter((s) => s.toLowerCase().includes(phrase));
      expect(offenders, `forbidden phrase "${phrase}"`).toEqual([]);
    }
  });

  it('attributes the ordering to her past papers, in the past tense', () => {
    expect(SESSION_ATTRIBUTION).toContain('past papers have asked');
    expect(SESSION_ATTRIBUTION.toLowerCase()).not.toContain('will');
  });

  it('the full-syllabus counterweight is present wherever a session is shown, and is the gap view’s own string', () => {
    expect(sessionFraming()).toContain(FULL_SYLLABUS_ADVICE);
    // Structural, not a footer a caller may forget: it comes out of the screen
    // copy on every branch, including both empty ones.
    for (const m of [
      model(),
      model({ items: [], consideredRowCount: 0 }),
      model({ items: [], consideredRowCount: 4 }),
    ]) {
      expect(sessionScreenCopy(m)).toContain(FULL_SYLLABUS_ADVICE);
    }
  });
});

// --------------------------------------------------------------------------
// Principle 12
// --------------------------------------------------------------------------

describe('principle 12 — information and consequence, never verdict', () => {
  const SCOLDING = [
    'behind',
    'you should have',
    'you have not been',
    'falling',
    'poor',
    'not enough effort',
    'catch up',
    'too slow',
    'you are late',
  ];

  it('says nothing about her effort or her position, even when most of the ranking was left out', () => {
    const strings = everyProducibleString();
    for (const phrase of SCOLDING) {
      const offenders = strings.filter((s) => s.toLowerCase().includes(phrase));
      expect(offenders, `scolding phrase "${phrase}"`).toEqual([]);
    }
  });

  it('reports what was left out as counts and reasons, and stops there', () => {
    const lines = leftOutLines(
      model({
        leftOut: [
          omission({ reason: 'did-not-fit' }),
          omission({ reason: 'did-not-fit' }),
          omission({ reason: 'no-instruments', gapClass: 'coverage-gap' }),
          omission({ reason: 'already-in-session' }),
        ],
      }),
    );
    expect(lines).toEqual([
      '2 more ranked concepts did not fit in 20 minutes.',
      '1 has notes but no cards yet, so there was nothing to practise.',
      '1 is already covered by a card in this session.',
    ]);
  });

  it('says nothing at all when nothing was left out — an absence is not a line', () => {
    expect(leftOutLines(model())).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// F4.7 — the countdown
// --------------------------------------------------------------------------

describe('the countdown states a date and a number of days, and nothing more', () => {
  it('names the assessment by its own file name, without folder or extension', () => {
    expect(
      assessmentName({
        assessmentPath: '02 Assignments/Quiz 2 - Bedform Stratification.md' as VaultPath,
        due: '2026-09-18',
        daysUntil: 4,
        type: 'Quiz',
        format: 'mcq',
      }),
    ).toBe('Quiz 2 - Bedform Stratification');
  });

  it('counts whole days, and reads today and tomorrow as words', () => {
    expect(countdownLine(model({ nextAssessment: countdown({ daysUntil: 4 }) }))).toBe(
      'Quiz 2 - Bedform Stratification is dated 4 days from now.',
    );
    expect(countdownLine(model({ nextAssessment: countdown({ daysUntil: 1 }) }))).toBe(
      'Quiz 2 - Bedform Stratification is dated tomorrow.',
    );
    expect(countdownLine(model({ nextAssessment: countdown({ daysUntil: 0 }) }))).toBe(
      'Quiz 2 - Bedform Stratification is dated today.',
    );
  });

  it('an unreadable date says so, and never renders as "today"', () => {
    const line = countdownLine(
      model({ nextAssessment: countdown({ due: null, daysUntil: null, type: null }) }),
    );
    expect(line).toBe(
      'Next up: Quiz 2 - Bedform Stratification. Olea could not read a date on it, so there is no countdown here.',
    );
    expect(line).not.toContain('today');
  });

  it('is silent when there is no assessment to count to', () => {
    expect(countdownLine(model({ nextAssessment: null }))).toBeNull();
  });
});

// --------------------------------------------------------------------------
// F4.8 — format matching
// --------------------------------------------------------------------------

describe('the format line explains a preference only when one actually fired', () => {
  it('explains multiple-choice-first when the preference applied to a chosen item', () => {
    expect(
      formatPreferenceLine(
        model({ formatPreference: 'mcq', items: [item({ formatMatch: 'preferred-format' })] }),
      ),
    ).toBe('Multiple-choice questions come first here, because your next assessment is a quiz.');
  });

  it('is silent with no preference — a reason is never offered for something that did not happen', () => {
    expect(formatPreferenceLine(model({ formatPreference: 'unknown' }))).toBeNull();
    // Preference set, but nothing in the session actually matched it.
    expect(
      formatPreferenceLine(
        model({ formatPreference: 'mcq', items: [item({ formatMatch: 'other-format' })] }),
      ),
    ).toBeNull();
  });
});

// --------------------------------------------------------------------------
// The times, and whose estimate they are
// --------------------------------------------------------------------------

describe('the timing line says whose estimate it is', () => {
  it('the three bases produce three different sentences', () => {
    const measured = durationBasisLine(model({ durationBasis: 'measured' }));
    const mixed = durationBasisLine(model({ durationBasis: 'mixed' }));
    const assumed = durationBasisLine(model({ durationBasis: 'assumed' }));
    expect(new Set([measured, mixed, assumed]).size).toBe(3);
  });

  it('an assumed model never presents Olea’s guess as a measurement of her pace', () => {
    const assumed = durationBasisLine(model({ durationBasis: 'assumed' })).toLowerCase();
    expect(assumed).toContain('assumption');
    expect(assumed).not.toContain('from how long your own reviews');
  });

  it('a measured model says the estimate came from her own reviews', () => {
    expect(durationBasisLine(model({ durationBasis: 'measured' }))).toContain('your own reviews');
  });

  it('never rounds real work down to zero minutes', () => {
    expect(minutesLabel(1)).toBe('1 min');
    expect(minutesLabel(0)).toBe('1 min');
    expect(minutesLabel(45)).toBe('1 min');
    expect(minutesLabel(600)).toBe('10 min');
  });
});

// --------------------------------------------------------------------------
// The two emptinesses
// --------------------------------------------------------------------------

describe('the two empty sessions are two different sentences', () => {
  it('"nothing ranked" and "nothing fits" do not share a line', () => {
    const nothingRanked = emptySessionLines(model({ items: [], consideredRowCount: 0 }));
    const nothingFits = emptySessionLines(model({ items: [], consideredRowCount: 6 }));

    expect(nothingRanked).not.toEqual(nothingFits);
    expect(nothingRanked.join(' ')).toContain('nothing ranked');
    expect(nothingFits.join(' ')).toContain('20 minutes');
  });

  it('"nothing ranked" is explicitly not a claim about her materials', () => {
    expect(emptySessionLines(model({ items: [], consideredRowCount: 0 })).join(' ')).toContain(
      'not about what you have left to study',
    );
  });

  it('a session with items produces neither', () => {
    expect(emptySessionLines(model())).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// The rest of the surface
// --------------------------------------------------------------------------

describe('the summary and the item lines', () => {
  it('reports the count and the time against the budget she asked for', () => {
    expect(sessionSummaryLine(model({ items: [item()] }))).toBe(
      '1 card, about 1 min of the 20 you asked for.',
    );
    expect(
      sessionSummaryLine(model({ items: [item(), item({ position: 2, estimatedSeconds: 45 })] })),
    ).toBe('2 cards, about 2 min of the 20 you asked for.');
  });

  it('names the shape of each item in words she would use, not the internal type', () => {
    expect(instrumentTypeLabel('qa')).toBe('question and answer');
    expect(instrumentTypeLabel('cloze')).toBe('fill in the blank');
    expect(instrumentTypeLabel('mcq')).toBe('multiple choice');
    expect(sessionItemLine(item({ instrumentType: 'mcq', estimatedSeconds: 40 }))).toBe(
      'multiple choice · about 1 min',
    );
  });

  it('says when a request to start from one concept could not be honoured', () => {
    expect(focusLine(model({ focusConcept: null }))).toBeNull();
    expect(focusLine(model({ focusConcept: 'Alpha' }))).toBe('Started from Alpha.');
    expect(focusLine(model({ focusConcept: 'Missing' }))).toContain('could not find Missing');
  });

  it('offers the budgets F4.6 names, with the 20-minute one among them', () => {
    expect(SESSION_BUDGET_OPTIONS).toContain(20);
    expect(budgetOptionLabel(20)).toBe('20 min');
  });
});

describe('the screen copy is the only place sentences come from', () => {
  it('always carries the framing, and carries the timing line only when there is timing to explain', () => {
    const withItems = sessionScreenCopy(model());
    expect(withItems).toContain(SESSION_ATTRIBUTION);
    expect(withItems).toContain(durationBasisLine(model()));

    const empty = sessionScreenCopy(model({ items: [], consideredRowCount: 0 }));
    expect(empty).toContain(SESSION_ATTRIBUTION);
    // No items means no minutes were estimated, so there is nothing to
    // attribute — a provenance line for numbers that were never shown.
    expect(empty).not.toContain(durationBasisLine(model()));
  });
});
