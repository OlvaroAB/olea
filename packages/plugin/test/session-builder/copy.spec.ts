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
  ReentryStudySessionView,
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
  COURSE_OR_TOPIC_ALL_LABEL,
  countdownLine,
  courseOrTopicNotFoundLine,
  daysOutLabel,
  durationBasisLine,
  emptySessionLines,
  focusLine,
  formatPreferenceLine,
  instrumentGroupHeading,
  instrumentTypeLabel,
  leftOutLines,
  minutesLabel,
  newMaterialLines,
  REENTRY_STILL_AVAILABLE_LINE,
  reentryEmptyLines,
  reentryScreenCopy,
  SESSION_ATTRIBUTION,
  SESSION_BUDGET_OPTIONS,
  SESSION_EYEBROW_LABEL,
  SESSION_NEXT_ASSESSMENT_LABEL,
  sessionFraming,
  sessionItemLine,
  sessionScreenCopy,
  sessionSummaryLine,
  sittingStaleReasonLine,
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
 * A `ReentryStudySessionView` fixture — `model()` minus the two fields F6.6
 * forbids, exactly the shape `composeReentrySession` hands a renderer.
 */
function reentryView(overrides: Partial<StudySessionModel> = {}): ReentryStudySessionView {
  const { leftOutInstrumentCount: _l, consideredRowCount: _c, ...view } = model(overrides);
  return view;
}

/**
 * Every sentence this module can produce, over models chosen to reach every
 * branch. The audits below run over THIS, not over the fixed inventory —
 * `ol-f49h`'s point, held here: an inventory is not an audit.
 */
function everyProducibleString(): readonly string[] {
  const strings: string[] = [...allSessionBuilderStrings(), ...sessionFraming()];

  // STEER-2 (`ol-ijms`): the not-found line's one derived sentence.
  const notFound = courseOrTopicNotFoundLine({ kind: 'course', label: 'CRS101' }, []);
  if (notFound !== null) strings.push(notFound);

  // STY-4 (`ol-l5og.18.13`): the card header's day count and the composition
  // table's group headings — both derived, over the value ranges that
  // exercise every branch (0/1/N days; each instrument kind, singular and
  // plural counts).
  strings.push(daysOutLabel(0), daysOutLabel(1), daysOutLabel(2), daysOutLabel(45));
  for (const instrumentType of ['qa', 'cloze', 'mcq'] as const) {
    strings.push(
      instrumentGroupHeading(instrumentType, 1),
      instrumentGroupHeading(instrumentType, 4),
    );
  }

  // `[D-162]`: one derived sentence per material-change reason, and one
  // combining all three, so the audit sees every clause
  // `sittingStaleReasonLine` can produce.
  strings.push(sittingStaleReasonLine(['items-due-in-scope']));
  strings.push(sittingStaleReasonLine(['material-arrived-in-scope']));
  strings.push(sittingStaleReasonLine(['assessment-proximity-band-crossed-in-scope']));
  strings.push(
    sittingStaleReasonLine([
      'items-due-in-scope',
      'material-arrived-in-scope',
      'assessment-proximity-band-crossed-in-scope',
    ]),
  );

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
    // F6.7 — a session with new (unmet) material from two sources, alongside
    // an item that is due but not new.
    model({
      items: [
        item({ obligationClass: 'unmet', noteTitle: 'Lecture notes' }),
        item({ position: 2, obligationClass: 'unmet', noteTitle: 'Seminar handout' }),
        item({ position: 3, obligationClass: 'recall-due', noteTitle: 'Old flashcard set' }),
      ],
    }),
  ];

  for (const m of models) {
    strings.push(...sessionScreenCopy(m));
    strings.push(...leftOutLines(m));
    strings.push(...emptySessionLines(m));
    strings.push(...newMaterialLines(m));
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

  // F6.6 — the re-entry screen's own composition, over the same kind of
  // variety (empty, with items, with new material, with a countdown).
  const reentryViews: ReentryStudySessionView[] = [
    reentryView(),
    reentryView({ items: [], plannedSeconds: 0, nextAssessment: null }),
    reentryView({
      items: [
        item({ obligationClass: 'unmet', noteTitle: 'Lecture notes' }),
        item({ position: 2, obligationClass: 'recall-due', noteTitle: 'Old flashcard set' }),
      ],
    }),
    reentryView({ focusConcept: 'Alpha' }),
  ];
  for (const v of reentryViews) {
    strings.push(...reentryScreenCopy(v));
    strings.push(...reentryEmptyLines(v));
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
      '1 has notes but no instruments yet, so there was nothing to practise.',
      '1 is already covered by an instrument in this session.',
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

// --------------------------------------------------------------------------
// STY-4 (`ol-l5og.18.13`) — the card header's day count and the composition
// table's group headings
// --------------------------------------------------------------------------

describe('the card header names the same day count the countdown does, worded for one line', () => {
  it('reads a passed-or-today assessment as due today, never a negative or zero count', () => {
    expect(daysOutLabel(0)).toBe('due today');
    expect(daysOutLabel(-1)).toBe('due today');
  });

  it('is singular for one day and plural otherwise', () => {
    expect(daysOutLabel(1)).toBe('1 day out');
    expect(daysOutLabel(2)).toBe('2 days out');
    expect(daysOutLabel(45)).toBe('45 days out');
  });

  it('is part of the corpus the F4.9/principle-12 audits above reach', () => {
    expect(allSessionBuilderStrings()).toContain(SESSION_EYEBROW_LABEL);
    expect(allSessionBuilderStrings()).toContain(SESSION_NEXT_ASSESSMENT_LABEL);
  });
});

describe('the composition table groups items by kind, count first', () => {
  it('names the count and the kind, in that order', () => {
    expect(instrumentGroupHeading('mcq', 4)).toBe('4 · multiple choice');
    expect(instrumentGroupHeading('qa', 1)).toBe('1 · question and answer');
    expect(instrumentGroupHeading('cloze', 2)).toBe('2 · fill in the blank');
  });
});

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
      '1 instrument, about 1 min of the 20 you asked for.',
    );
    expect(
      sessionSummaryLine(model({ items: [item(), item({ position: 2, estimatedSeconds: 45 })] })),
    ).toBe('2 instruments, about 2 min of the 20 you asked for.');
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

// --------------------------------------------------------------------------
// F4.6 / STEER-2 (`ol-ijms`) — the "course or topic" control
// --------------------------------------------------------------------------

describe('the course-or-topic control says when a choice could not be honoured, and is silent otherwise', () => {
  it('is silent when nothing was asked', () => {
    expect(courseOrTopicNotFoundLine(undefined, [])).toBeNull();
  });

  it('is silent when the choice is still among the options offered', () => {
    expect(
      courseOrTopicNotFoundLine({ kind: 'course', label: 'CRS101' }, [
        { kind: 'course', label: 'CRS101' },
        { kind: 'topic', label: 'Widget theory' },
      ]),
    ).toBeNull();
  });

  it('names the choice when it is no longer among the options offered', () => {
    expect(
      courseOrTopicNotFoundLine({ kind: 'topic', label: 'Missing concept' }, [
        { kind: 'course', label: 'CRS101' },
      ]),
    ).toBe(
      'Olea could not find "Missing concept" any more, so this session is built from everything.',
    );
  });

  it('a course and a topic sharing the same label are told apart by kind', () => {
    // The same string could name both a course and a topic; a match against
    // one must not silently satisfy a request for the other.
    expect(
      courseOrTopicNotFoundLine({ kind: 'topic', label: 'CRS101' }, [
        { kind: 'course', label: 'CRS101' },
      ]),
    ).toContain('could not find "CRS101"');
  });

  it('the fixed labels are part of the corpus the F4.9/principle-12 audits above reach', () => {
    expect(allSessionBuilderStrings()).toContain(COURSE_OR_TOPIC_ALL_LABEL);
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

// --------------------------------------------------------------------------
// F6.7 — new (unmet) material named by source, never by count ([D-060],
// ol-0r92.9). `SessionBuilderView.render` (`../../src/session-builder/
// view.ts`) draws `sessionScreenCopy`'s result on every path, so this is the
// production caller: `newMaterialLines` reaches the screen through
// `sessionScreenCopy` with no separate wiring in `view.ts`.
// --------------------------------------------------------------------------

describe('F6.7 reaches the screen through sessionScreenCopy — no separate view.ts wiring needed', () => {
  it('names each distinct new-material source once, and never the item due beside it', () => {
    const m = model({
      items: [
        item({ obligationClass: 'unmet', noteTitle: 'Lecture notes' }),
        item({ position: 2, obligationClass: 'unmet', noteTitle: 'Seminar handout' }),
        item({ position: 3, obligationClass: 'recall-due', noteTitle: 'Old flashcard set' }),
      ],
    });
    expect(newMaterialLines(m)).toEqual([
      'Includes new material from Lecture notes.',
      'Includes new material from Seminar handout.',
    ]);
    expect(newMaterialLines(m).join(' ')).not.toContain('Old flashcard set');
  });

  it('sessionScreenCopy carries the by-source lines — this is what view.ts actually renders', () => {
    const m = model({ items: [item({ obligationClass: 'unmet', noteTitle: 'Lecture notes' })] });
    expect(sessionScreenCopy(m)).toContain('Includes new material from Lecture notes.');
  });

  it('is silent — no lines at all — when nothing in the session is unmet', () => {
    expect(newMaterialLines(model())).toEqual([]);
    expect(sessionScreenCopy(model()).some((l) => l.includes('new material'))).toBe(false);
  });

  it('never carries a digit — a source is named, never a count of sources or items', () => {
    const m = model({
      items: [
        item({ obligationClass: 'unmet', noteTitle: 'Lecture notes' }),
        item({ position: 2, obligationClass: 'unmet', noteTitle: 'Seminar handout' }),
        item({ position: 3, obligationClass: 'unmet', noteTitle: 'Reading list' }),
      ],
    });
    for (const line of newMaterialLines(m)) {
      expect(line).not.toMatch(/\d/);
    }
  });
});

// ---------------------------------------------------------------------------
// F6.6 — re-entry composition after an absence (`ol-v7r5.18`, discovered from
// `ol-blwb` / `[BKLG-1]`). Scenarios: `features/F6-today.md`, "F6.6 — Coming
// back after time away gets a small session, not a backlog" — the two named
// here are the ones this bead adds coverage for: "no count of what
// accumulated appears anywhere on this screen, in any position" and "what
// accumulated remains available and is never described as lost or expired".
// `SessionBuilderView.render` (`../../src/session-builder/view.ts`) draws
// `reentryScreenCopy`'s result on every `'reentry'`-state path, so this is
// the production caller: no separate `view.ts` wiring is needed for either
// scenario, the same shape F6.7's own suite above already establishes.
// ---------------------------------------------------------------------------

describe('F6.6 — no count of what accumulated appears anywhere on this screen, in any position', () => {
  it('a re-entry view built from a substantial left-out backlog produces none of the counted left-out lines an ordinary session would render for the SAME leftOut data', () => {
    // The adversarial construction the scenario names: "a re-entry session
    // shown after a two-week absence with a substantial backlog behind it."
    // `leftOut` here is deliberately large and would, on the ordinary
    // surface, produce four separate counted lines (`leftOutLines`'s own
    // test above proves exactly that for this same omission set).
    const backlog = [
      omission({ reason: 'did-not-fit' }),
      omission({ reason: 'did-not-fit' }),
      omission({ reason: 'did-not-fit' }),
      omission({ reason: 'no-instruments', gapClass: 'coverage-gap' }),
      omission({ reason: 'no-instruments', gapClass: 'material-gap' }),
      omission({ reason: 'already-in-session' }),
    ];
    // Sanity check on the adversarial fixture itself: the ordinary path DOES
    // count this backlog, so the re-entry assertions below are a real
    // contrast, not a vacuous one.
    const ordinaryLines = leftOutLines(model({ leftOut: backlog }));
    expect(ordinaryLines.length).toBeGreaterThan(0);

    // `nextAssessment: null` isolates the property under test: the countdown
    // (F4.7) legitimately carries a digit of its own (days until an
    // assessment), which is a different, permitted kind of number from a
    // count of what accumulated — excluding it here keeps the "no digit
    // outside the session's own summary" check below from a false positive
    // on an unrelated line.
    const view = reentryView({ leftOut: backlog, nextAssessment: null });
    const screen = reentryScreenCopy(view);

    // None of the ordinary surface's counted lines for this exact backlog
    // leak into the re-entry screen.
    for (const line of ordinaryLines) {
      expect(
        screen,
        `"${line}" is a counted left-out line and must not appear on a re-entry screen`,
      ).not.toContain(line);
    }
    // And no line on the re-entry screen carries a digit that isn't the
    // session's OWN item count/time (sessionSummaryLine) — every other line
    // states a fact with no count of what was left behind.
    const withoutSummary = screen.filter((l) => l !== sessionSummaryLine(view));
    for (const line of withoutSummary) {
      expect(
        line,
        `"${line}" carries a digit — is it secretly a count of what accumulated?`,
      ).not.toMatch(/\d/);
    }
  });

  it('the two forbidden fields are structurally absent from the view reentryScreenCopy renders', () => {
    const view = reentryView({ leftOut: [omission()] });
    expect('leftOutInstrumentCount' in view).toBe(false);
    expect('consideredRowCount' in view).toBe(false);
  });

  it('reentryScreenCopy never calls leftOutLines — the empty-backlog case is not what makes this true', () => {
    // Regression guard for the specific defect: a re-entry screen that only
    // happens to look clean because its fixture has nothing left out. The
    // fixture above already has a non-empty `leftOut`; this asserts the same
    // property holds even when there is exactly one very countable omission.
    const view = reentryView({
      leftOut: [omission({ reason: 'did-not-fit' }), omission({ reason: 'did-not-fit' })],
    });
    expect(reentryScreenCopy(view).join(' ')).not.toContain('did not fit');
  });
});

describe('F6.6 — what accumulated remains available and is never described as lost or expired', () => {
  it('REENTRY_STILL_AVAILABLE_LINE states the fact plainly, with no word for loss', () => {
    for (const word of ['lost', 'expired', 'discarded', 'gone', 'deleted', 'backlog']) {
      expect(REENTRY_STILL_AVAILABLE_LINE.toLowerCase()).not.toContain(word);
    }
    expect(REENTRY_STILL_AVAILABLE_LINE.toLowerCase()).toContain('still');
  });

  it('the line is present on every re-entry screen, with or without items', () => {
    expect(reentryScreenCopy(reentryView())).toContain(REENTRY_STILL_AVAILABLE_LINE);
    expect(reentryScreenCopy(reentryView({ items: [], plannedSeconds: 0 }))).toContain(
      REENTRY_STILL_AVAILABLE_LINE,
    );
  });

  it('is part of the corpus the module-wide inventory carries, for the F4.9/principle-12 audits above to reach it', () => {
    expect(allSessionBuilderStrings()).toContain(REENTRY_STILL_AVAILABLE_LINE);
  });
});

describe('F6.6 — the re-entry empty state names no count either', () => {
  it('is silent when the view has items', () => {
    expect(reentryEmptyLines(reentryView())).toEqual([]);
  });

  it('states what could be read, not a claim about what she has left to study, when there is nothing to build from', () => {
    const lines = reentryEmptyLines(reentryView({ items: [], plannedSeconds: 0 }));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toContain('not about what you have left to study');
    for (const line of lines) expect(line).not.toMatch(/\d/);
  });
});

describe('F6.6 — reentryScreenCopy still carries the rest of the surface’s honesty', () => {
  it('always carries the F4.9 framing, same as the ordinary screen', () => {
    expect(reentryScreenCopy(reentryView())).toContain(SESSION_ATTRIBUTION);
    expect(reentryScreenCopy(reentryView())).toContain(FULL_SYLLABUS_ADVICE);
  });

  it('carries F6.7’s by-source material lines when the session includes unmet material', () => {
    const view = reentryView({
      items: [item({ obligationClass: 'unmet', noteTitle: 'Lecture notes' })],
    });
    expect(reentryScreenCopy(view)).toContain('Includes new material from Lecture notes.');
  });

  it('carries the duration basis line only when there are items to time', () => {
    expect(reentryScreenCopy(reentryView())).toContain(durationBasisLine(reentryView()));
    expect(reentryScreenCopy(reentryView({ items: [], plannedSeconds: 0 }))).not.toContain(
      durationBasisLine(reentryView()),
    );
  });
});
