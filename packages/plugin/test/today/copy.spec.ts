/**
 * The Today panel's copy, tested against the rules the §8.2 record produced
 * (`../../../../olea-service/docs/design/RECHECK-8.2-passes-3-4.md`).
 *
 * Three of these assertions exist because the Pass 1 kit's own body copy
 * asserts behaviour the contract does not have. A rejection recorded only in
 * prose is a rejection that gets re-added by the next person who reads the
 * mock and not the record; a rejection recorded as a failing test is not.
 */

import type { CourseFreshnessReading } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  allTodayStrings,
  conceptCountLabel,
  courseCountLabel,
  DUE_UNAVAILABLE,
  dueTodaySentence,
  earlyPullSentence,
  effortInsightLine,
  effortShareClause,
  INSIGHTS_TOO_EARLY,
  insightsScopeSentence,
  masteryCountLabel,
  NOTHING_DUE,
  newCountSentence,
  pickRhythmYardstickReading,
  rhythmQuietClause,
  rhythmQuietLine,
  rhythmYardstickClause,
  rhythmYardstickLine,
  showsStartReviewAction,
  showsTermDatesPointer,
  spacingRateSentence,
  TERM_DATES_POINTER_BUTTON_LABEL,
  TERM_DATES_POINTER_TEXT,
} from '../../src/today/copy.js';

const strings = allTodayStrings();
const corpus = strings.join(' \n ').toLowerCase();

describe('no forward scheduling promise', () => {
  // The Pass 1 kit's subhead (TodayPane.jsx) names a weekday by which nothing
  // further falls due — rejected. Same class as ol-2x4, where a surface
  // announced when items would next be shown: a scheduler's decision, taken by
  // a screen, with no F-number behind it and no way to stay true as FSRS moves
  // due dates.
  it('names no future day, weekday or relative time', () => {
    const forbidden = [
      'tomorrow',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
      'next week',
      'this week',
      'until',
      'scheduled',
      'comes up',
      'come up',
    ];
    for (const word of forbidden) {
      expect(corpus, `"${word}" is a claim about a day that has not happened`).not.toContain(word);
    }
  });
});

describe('no completeness claim', () => {
  // That same kit subhead also ranges over her whole deck. ol-1n1v's ruling:
  // a claim whose truth depends on having read everything is a bet.
  it('never says "nothing else", "everything" or "all"', () => {
    for (const word of ['nothing else', 'everything', 'all your', 'complete', 'the rest of']) {
      expect(corpus, `"${word}" claims a scope the panel did not read`).not.toContain(word);
    }
  });

  it('says what it cannot count, rather than counting it as zero', () => {
    expect(DUE_UNAVAILABLE).toMatch(/can't count|cannot count/);
    expect(DUE_UNAVAILABLE).not.toMatch(/\b0\b|zero/);
    expect(NOTHING_DUE).not.toBe(DUE_UNAVAILABLE);
  });

  it('does not tell her a shipped feature is unbuilt', () => {
    // This string outlived its own truth once: it said "the review queue isn't
    // built" for as long as that was true and for one run after it stopped
    // being, which would have sent her looking for a setup step that does not
    // exist. `review/copy.ts`'s sibling copy states the rule — the feature is
    // not missing, the read failed — and this is the guard that keeps the two
    // surfaces saying the same thing.
    for (const phrase of ["isn't built", 'is not built', 'not built yet', 'coming soon']) {
      expect(DUE_UNAVAILABLE.toLowerCase()).not.toContain(phrase);
    }
  });
});

describe('no gamification, pressure or compliance language anywhere (F6.1)', () => {
  it('no loss, warning or exhortation language anywhere', () => {
    const forbidden = [
      'lost',
      'lose',
      'broke',
      'broken',
      'missed',
      'miss',
      'don’t',
      'keep it up',
      'keep going',
      'back on track',
      'again today',
      'record',
      'best',
      'longest',
      'goal',
      'target',
      'score',
    ];
    for (const word of forbidden) {
      expect(corpus, `"${word}" turns a count into a verdict`).not.toContain(word);
    }
  });

  it('nothing is phrased as an instruction to her', () => {
    // No imperative second person. "Start review" is a button label naming
    // what the button does, and is checked separately below.
    for (const text of strings) {
      expect(text.toLowerCase()).not.toMatch(/\byou (should|need|must|have to)\b/);
    }
  });

  it('one primary action, named for what it does', () => {
    expect(strings.filter((s) => /^start /i.test(s))).toEqual(['Start review']);
  });
});

describe('dueTodaySentence and courseCountLabel', () => {
  it('read correctly at one and at zero', () => {
    expect(dueTodaySentence(1)).toBe('1 due today');
    expect(dueTodaySentence(23)).toBe('23 due today');
    expect(courseCountLabel(12)).toBe('12');
  });
});

describe('no real-vault or invented course strings (INV-3)', () => {
  it('the copy module hardcodes no course code or course name', () => {
    // Every course string on this panel comes from the vault at runtime.
    // TodayPane.jsx's course rows are populated from a real note's course code
    // and title (ol-p2t08); nothing in this module can carry them because
    // nothing in this module carries a course at all.
    for (const text of strings) {
      expect(text).not.toMatch(/[A-Z]{4,}\d{3}/);
    }
  });
});

describe('the new count qualifies the due count, and never becomes a debt', () => {
  // Scenario: features/F6-today.md, "F6.1 — New and due are different numbers".
  it('is absent at zero rather than rendered as "0 new"', () => {
    expect(newCountSentence(0)).toBeNull();
    expect(newCountSentence(-1)).toBeNull();
  });

  it('is singular at one', () => {
    expect(newCountSentence(1)).toBe('1 of them is new');
  });

  it('says "of them", so the two numbers cannot be read as a sum', () => {
    expect(newCountSentence(12)).toBe('12 of them are new');
    expect(newCountSentence(12)).toContain('of them');
  });

  it('frames nothing as a target, a backlog or a thing to get through', () => {
    for (const count of [1, 2, 40]) {
      const line = newCountSentence(count) ?? '';
      for (const word of ['backlog', 'behind', 'catch up', 'still', 'to go', 'left', 'goal']) {
        expect(line.toLowerCase(), `"${word}" turns a count into a target`).not.toContain(word);
      }
    }
  });

  it('is part of the corpus the panel-wide rules are checked against', () => {
    expect(allTodayStrings()).toContain('12 of them are new');
  });
});

describe('the trends half is information and consequence, never verdict (F6.2, F6.5)', () => {
  // Scenarios: features/F6-today.md, "F6.2 — Today mastery overview (panel)"
  // and "F6.5 — Observed-pattern insights".
  const trends = [
    masteryCountLabel('sapling', 7),
    conceptCountLabel(8),
    INSIGHTS_TOO_EARLY,
    spacingRateSentence(41.8, 2.9, 7),
    earlyPullSentence(0.38) ?? '',
    effortShareClause(0.57, 0.14),
    insightsScopeSentence(120),
  ];

  it('uses F2.11’s four words and coins no fifth', () => {
    // The vocabulary is imported from `MASTERY_DISPLAY`, so the only way to
    // fail this is to hardcode a synonym — which is exactly the drift F2.11's
    // single-site rule exists to stop.
    expect(masteryCountLabel('seed', 4)).toBe('4 seed');
    expect(masteryCountLabel('tree', 1)).toBe('1 tree');
    for (const word of ['mastered', 'weak', 'strong', 'developing', 'expert', 'beginner']) {
      expect(trends.join(' ').toLowerCase()).not.toContain(word);
    }
  });

  it('says nothing about the student, only about the material and the log', () => {
    for (const word of [
      'you should',
      'you need',
      'your weakest',
      'falling',
      'neglect',
      'ignoring',
      'avoid',
      'cramming',
      'crammed',
      'poorly',
      'badly',
      'well done',
    ]) {
      expect(
        trends.join(' ').toLowerCase(),
        `"${word}" is a verdict, not information`,
      ).not.toContain(word);
    }
  });

  it('the spacing line always carries both numbers, so neither implies a comparison', () => {
    const line = spacingRateSentence(41.8, 2.9, 7);
    expect(line).toContain('41.8');
    expect(line).toContain('2.9');
    expect(line).toContain('7 days');
  });

  it('the consequence it states is the definition of an early pull, not a retention claim', () => {
    const line = earlyPullSentence(0.38) ?? '';
    expect(line).toContain('38%');
    expect(line).toContain('before their due date');
    // The obvious, tempting, unmeasured claim. Nothing in a review log contains
    // a retest, so nothing here may talk about one.
    for (const word of ['remember', 'forget', 'retention', 'held up', 'stuck', 'learn']) {
      expect(line.toLowerCase()).not.toContain(word);
    }
  });

  it('is absent rather than zero when nothing was pulled forward', () => {
    expect(earlyPullSentence(0)).toBeNull();
    expect(earlyPullSentence(-1)).toBeNull();
  });

  it('the effort clause names no course — the code comes from her vault (ol-p2t08)', () => {
    const clause = effortShareClause(0.57, 0.14);
    expect(clause).toBe('carries 57% of the assessment weight and 14% of the time logged.');
    expect(clause).not.toMatch(/[A-Z]/);
  });

  it('states the window it read rather than implying it read everything (ol-1n1v)', () => {
    expect(insightsScopeSentence(120)).toBe('Counted over the last 120 days of review history.');
  });

  it('the too-early line is neither a negative result nor an instruction', () => {
    // "Not enough history" is the third status, not "no patterns found" — see
    // olea-core's insights/types.ts.
    expect(INSIGHTS_TOO_EARLY.toLowerCase()).not.toContain('no pattern');
    expect(INSIGHTS_TOO_EARLY.toLowerCase()).not.toContain('check back');
    expect(INSIGHTS_TOO_EARLY.toLowerCase()).not.toContain('come back');
  });

  it('every trends string is in the corpus the panel-wide rules run over', () => {
    const corpusStrings = allTodayStrings();
    for (const text of trends) {
      expect(corpusStrings, `"${text}" is rendered but not sampled`).toContain(text);
    }
  });
});

describe('effortInsightLine names the course it is about (ol-7j54 / ARC-1)', () => {
  // The three phases of a course are per-course, not per-student: the same
  // weight/time gap is ordinary early in a course and a real problem late in
  // it, and two of her courses can be in different phases at once. The copy
  // rule is that a claim like this must name the course rather than be
  // presented as an unscoped fact — see olea-core's insights/index.ts.
  const course = {
    course: 'FIXTURE101',
    timeMs: 1_000,
    timeShare: 0.14,
    weight: 50,
    weightShare: 0.57,
    gap: 0.43,
  };

  it('bundles the course from the record with the same text effortShareClause produces', () => {
    const line = effortInsightLine(course);
    expect(line.course).toBe('FIXTURE101');
    expect(line.text).toBe(effortShareClause(course.weightShare, course.timeShare));
  });

  it('takes the course identity from the record it was measured from, not by construction here', () => {
    const other = { ...course, course: 'OTHER202', weightShare: 0.4, timeShare: 0.1 };
    expect(effortInsightLine(other).course).toBe('OTHER202');
    expect(effortInsightLine(other).text).toBe(effortShareClause(0.4, 0.1));
  });

  it("the bundled text still names no course — only the record's own .course field does", () => {
    // Same INV-3 property as effortShareClause: the fixture course code above
    // must never leak into the sentence half of the pair.
    const line = effortInsightLine(course);
    expect(line.text).not.toContain('FIXTURE101');
    expect(line.text).not.toMatch(/[A-Z]/);
  });
});

describe('rhythmQuietClause / rhythmQuietLine — F6.9, the rhythm reading', () => {
  // Scenarios: features/F6-today.md, "F6.9 — the rhythm reading states a
  // fact, never a verdict".

  it("states F6.9's own worked example, day-granular", () => {
    expect(rhythmQuietClause(21)).toBe('nothing from this course has arrived in 21 days.');
    expect(rhythmQuietClause(30)).toContain('30 days');
  });

  it('names no streak, effort score, hours total, completion figure or compliance language', () => {
    const line = rhythmQuietClause(21).toLowerCase();
    for (const word of [
      'streak',
      'effort',
      'hours',
      'complete',
      'behind',
      'ahead',
      'catch up',
      'should',
    ]) {
      expect(line, `"${word}" is exactly what F6.9's forbidden list rules out`).not.toContain(word);
    }
  });

  it('rhythmQuietLine bundles the course with the same text rhythmQuietClause produces', () => {
    const line = rhythmQuietLine('FIXTURE101', 21);
    expect(line.course).toBe('FIXTURE101');
    expect(line.text).toBe(rhythmQuietClause(21));
  });

  it('the bundled text still names no course — only the .course field does (INV-3, ol-p2t08)', () => {
    const line = rhythmQuietLine('FIXTURE101', 21);
    expect(line.text).not.toContain('FIXTURE101');
    expect(line.text).not.toMatch(/[A-Z]/);
  });

  it('is part of the corpus the panel-wide rules are checked against', () => {
    expect(allTodayStrings()).toContain(rhythmQuietClause(21));
  });

  it("F6.9 scenario 'the reading states whether material has arrived, and nothing else' — given a course from which nothing has arrived in three weeks", () => {
    // features/F6-today.md's own wording: three weeks is QUIET_DAYS_THRESHOLD
    // (21 days, `olea-core`'s `rhythm.ts`).
    const clause = rhythmQuietClause(21);
    expect(clause).toContain('21 days');
    for (const word of ['streak', 'effort score', 'hours', 'completion']) {
      expect(clause.toLowerCase()).not.toContain(word);
    }
  });

  it("F6.9 scenario 'tempo is an internal yardstick and is never displayed as a figure' — no copy function in this module accepts one", () => {
    // Tempo (credit weight, expected weekly hours) has no extraction stage
    // anywhere in this codebase yet (`olea-core`'s `rhythm.ts` module doc),
    // so the strongest check available today is structural: nothing this
    // module can produce names or carries a tempo figure at all — not
    // 'tempo', not 'credit', not 'hours a week'. The day count these
    // functions DO carry (`quietDays`) is a fact about arrivals, not a
    // yardstick reading.
    for (const word of ['tempo', 'credit weight', 'hours a week', 'hours/week']) {
      expect(rhythmQuietClause(21).toLowerCase()).not.toContain(word);
      expect(corpus).not.toContain(word);
    }
  });
});

/** A minimal `CourseFreshnessReading`, only the fields these tests vary. */
function freshnessReading(
  courseCode: string,
  overrides: Partial<CourseFreshnessReading> = {},
): CourseFreshnessReading {
  return {
    courseCode,
    status: 'not-arrived-with-yardstick',
    expectedSessionDate: '2026-08-11',
    basis: 'observed',
    reason: 'test fixture',
    ...overrides,
  };
}

describe('rhythmYardstickClause / rhythmYardstickLine — RHY-3 (`ol-at1a`)', () => {
  // Scenario: features/F6-today.md's F6.9 scenarios extend to the
  // calendar-schedule signal the same way rhythmQuietClause's do — this is
  // the "with yardstick" branch RHY-3-schedule-extraction.md §4/§5 licenses.

  it('states an observed session date plainly, with confidence', () => {
    const clause = rhythmYardstickClause('2026-08-11', 'observed');
    expect(clause).toContain('2026-08-11');
    expect(clause).not.toMatch(/expected|usual pattern|based on/);
  });

  it('hedges an extrapolated session date rather than stating it as read (RHY-3 §4)', () => {
    const clause = rhythmYardstickClause('2026-08-18', 'extrapolated');
    expect(clause).toContain('2026-08-18');
    // The binding rule this bead must honour: never the same confidence as
    // an observed date.
    expect(clause).toMatch(/usual pattern/);
    expect(clause).toMatch(/expected/);
  });

  it('names no streak, effort score, hours total or compliance language', () => {
    for (const basis of ['observed', 'extrapolated'] as const) {
      const clause = rhythmYardstickClause('2026-08-11', basis).toLowerCase();
      for (const word of ['streak', 'effort', 'hours', 'complete', 'behind', 'ahead', 'should']) {
        expect(clause, `"${word}" is exactly what F6.9's forbidden list rules out`).not.toContain(
          word,
        );
      }
    }
  });

  it('never names a future day, weekday or relative time (same rule as the panel-wide corpus check)', () => {
    for (const basis of ['observed', 'extrapolated'] as const) {
      const clause = rhythmYardstickClause('2026-08-11', basis).toLowerCase();
      for (const word of ['tomorrow', 'scheduled', 'until', 'comes up', 'come up']) {
        expect(clause).not.toContain(word);
      }
    }
  });

  it('rhythmYardstickLine bundles the course with the same text rhythmYardstickClause produces', () => {
    const line = rhythmYardstickLine('FIXTURE101', '2026-08-11', 'observed');
    expect(line.course).toBe('FIXTURE101');
    expect(line.text).toBe(rhythmYardstickClause('2026-08-11', 'observed'));
  });

  it('the bundled text still names no course — only the .course field does (INV-3, ol-p2t08)', () => {
    const line = rhythmYardstickLine('FIXTURE101', '2026-08-11', 'observed');
    expect(line.text).not.toContain('FIXTURE101');
    expect(line.text).not.toMatch(/[A-Z]/);
  });

  it('is part of the corpus the panel-wide rules are checked against', () => {
    expect(allTodayStrings()).toContain(rhythmYardstickClause('2026-08-11', 'observed'));
    expect(allTodayStrings()).toContain(rhythmYardstickClause('2026-08-18', 'extrapolated'));
  });
});

/**
 * `[D-047]`'s forbidden-framing list, mirrored as a flat, lowercased
 * substring array in `review/contest.ts`'s own `FORBIDDEN_CONTEST_STRINGS`
 * shape — the same "so a copy test can assert against it rather than
 * against a reviewer's memory" reasoning. `[D-047]`'s close reason states
 * ground 1 as the one that binds: "streaks, effort scores, hours totals and
 * any compliance representation remain forbidden outright." F6.9's own
 * clause adds the comparative half — "nothing that reads as compliance"
 * and never a verdict framed as behind or ahead — which is the tension
 * `RHY-3-offloading-and-spacing-tension.md` §2 names and tests the drawn
 * copy against line by line ("does the sentence survive being read on a bad
 * week?"). This list is that same test, pinned against the SHIPPED
 * production strings rather than the design-time kit copy it was run
 * against there.
 */
const RHYTHM_BAD_WEEK_FORBIDDEN_FRAMINGS: readonly string[] = [
  // Streaks — any consecutive-days representation.
  'streak',
  'in a row',
  'consecutive',
  // Effort scores — any number standing for how hard she tried.
  'effort score',
  'effort level',
  // Hours-studied totals.
  'hours total',
  'hours studied',
  'hours logged',
  // Any compliance or discipline representation whatsoever.
  'compliance',
  'discipline',
  'keeping up',
  'catching up',
  'catch up',
  // The comparative behind/ahead framing F6.9's own tension paragraph names
  // as the thing forbidding streaks constrains the tone of without
  // dissolving — a verdict on how she has been doing, not a fact about the
  // vault.
  'behind schedule',
  'falling behind',
  "you're behind",
  'behind',
  'ahead',
  'should have',
  'you should',
];

describe("F6.9's bad-week test, mechanised: shipped strings pinned against a named forbidden-framing list (D-047, RHY-3-offloading-and-spacing-tension.md §2)", () => {
  // The design-time check (RHY-3-offloading-and-spacing-tension.md §2) ran
  // its "survives a bad week?" table against the Pass 5 kit's drawn copy,
  // line by line. These assertions run the same test against the actual
  // shipped functions, at the worst constructed magnitudes available to
  // each — a whole term of silence, and the most overdue calendar/
  // extrapolated readings — rather than trusting that a design-time pass
  // over kit copy still describes the strings that ship.

  it('a whole term of silence still names only a fact and a day count — no forbidden framing', () => {
    // 90 days: the same "a term of silence" magnitude
    // `rhythm-neutralised-twin.spec.ts`'s own corpus uses for its worst case.
    const clause = rhythmQuietClause(90).toLowerCase();
    for (const framing of RHYTHM_BAD_WEEK_FORBIDDEN_FRAMINGS) {
      expect(clause, `"${framing}" is exactly what F6.9's bad-week test rules out`).not.toContain(
        framing,
      );
    }
  });

  it('the most overdue observed calendar reading still names only the fact — no forbidden framing', () => {
    const clause = rhythmYardstickClause('2026-01-05', 'observed').toLowerCase();
    for (const framing of RHYTHM_BAD_WEEK_FORBIDDEN_FRAMINGS) {
      expect(clause, `"${framing}" is exactly what F6.9's bad-week test rules out`).not.toContain(
        framing,
      );
    }
  });

  it('the most overdue extrapolated reading still hedges on basis alone — no forbidden framing', () => {
    // Extrapolated readings carry their own hedge ("based on its usual
    // pattern", "expected around") — the bad-week test is that the hedge
    // never slides into a behind/ahead verdict even at the least confident,
    // most overdue construction.
    const clause = rhythmYardstickClause('2026-01-05', 'extrapolated').toLowerCase();
    for (const framing of RHYTHM_BAD_WEEK_FORBIDDEN_FRAMINGS) {
      expect(clause, `"${framing}" is exactly what F6.9's bad-week test rules out`).not.toContain(
        framing,
      );
    }
  });

  it('every rhythm string sampled in the panel-wide corpus clears the same named list', () => {
    // Redundant with the per-function checks above by construction, and
    // deliberately so: this is the one assertion that would catch a future
    // rhythm string added to `allTodayStrings()` without also being run
    // through the two focused checks above.
    const rhythmCorpus = [
      rhythmQuietClause(21),
      rhythmQuietClause(30),
      rhythmYardstickClause('2026-08-11', 'observed'),
      rhythmYardstickClause('2026-08-18', 'extrapolated'),
    ]
      .join(' \n ')
      .toLowerCase();
    for (const framing of RHYTHM_BAD_WEEK_FORBIDDEN_FRAMINGS) {
      expect(
        rhythmCorpus,
        `"${framing}" is exactly what F6.9's bad-week test rules out`,
      ).not.toContain(framing);
    }
  });
});

describe('pickRhythmYardstickReading — selects at most one course (`ol-at1a`)', () => {
  it('returns null when the signal could not be computed at all', () => {
    expect(pickRhythmYardstickReading(null)).toBeNull();
  });

  it('returns null when no course currently has a with-yardstick reading', () => {
    const readings = [
      freshnessReading('ARRIVED1', {
        status: 'arrived',
        expectedSessionDate: undefined,
        basis: undefined,
      }),
      freshnessReading('NOYARD02', {
        status: 'not-arrived-no-yardstick',
        expectedSessionDate: undefined,
        basis: undefined,
      }),
    ];
    expect(pickRhythmYardstickReading(readings)).toBeNull();
  });

  it('returns the one with-yardstick reading when exactly one course has one', () => {
    const readings = [
      freshnessReading('ARRIVED1', {
        status: 'arrived',
        expectedSessionDate: undefined,
        basis: undefined,
      }),
      freshnessReading('QUIETONE'),
    ];
    expect(pickRhythmYardstickReading(readings)?.courseCode).toBe('QUIETONE');
  });

  it('never composes more than one course — picks by a stable, arbitrary tie-break (course code) rather than any "how overdue" ranking', () => {
    const readings = [freshnessReading('ZCOURSE9'), freshnessReading('ACOURSE1')];
    // Alphabetical, not insertion order — the selection is deterministic
    // regardless of how the caller happened to list courses.
    expect(pickRhythmYardstickReading(readings)?.courseCode).toBe('ACOURSE1');
  });
});

describe('TERM_DATES_POINTER_TEXT / TERM_DATES_POINTER_BUTTON_LABEL — F7.2 ([D-147])', () => {
  // Scenario: features/F7-plugin-surface.md, "F7.2 — term dates ask-once-
  // or-dismissed ([D-147])".

  it('states what the fact is for, never a compliance verdict', () => {
    for (const word of ['falling behind', 'keep up', 'monitor', 'expected']) {
      expect(TERM_DATES_POINTER_TEXT.toLowerCase()).not.toContain(word);
    }
    expect(TERM_DATES_POINTER_TEXT.toLowerCase()).toContain('not to track how you');
  });

  it('names the rhythm reading as the consumer — arrival pace, the same fact rhythmQuietClause states', () => {
    expect(TERM_DATES_POINTER_TEXT.toLowerCase()).toMatch(/arriving/);
  });

  it('the button label is not phrased as a snooze — never "remind me later"', () => {
    expect(TERM_DATES_POINTER_BUTTON_LABEL.toLowerCase()).not.toContain('remind');
  });

  it('is part of the corpus the panel-wide rules are checked against', () => {
    expect(allTodayStrings()).toContain(TERM_DATES_POINTER_TEXT);
    expect(allTodayStrings()).toContain(TERM_DATES_POINTER_BUTTON_LABEL);
  });
});

describe('showsTermDatesPointer — the F7.2 quiet-pointer trigger ([D-147])', () => {
  // Scenario: features/F6-today.md, "F6.9 / F7.2 — The Today panel's quiet
  // pointer at the term-dates ask".

  it('shows when there is no resolved term window and the ask is unanswered', () => {
    expect(showsTermDatesPointer(false, 'unanswered')).toBe(true);
  });

  it('never shows once a term window is resolved, regardless of ask state', () => {
    expect(showsTermDatesPointer(true, 'unanswered')).toBe(false);
    expect(showsTermDatesPointer(true, null)).toBe(false);
  });

  it('never shows again once she has answered or explicitly skipped', () => {
    expect(showsTermDatesPointer(false, 'answered')).toBe(false);
    expect(showsTermDatesPointer(false, 'skipped')).toBe(false);
  });

  it('never shows when no ask support is wired (null — absent means inert)', () => {
    expect(showsTermDatesPointer(false, null)).toBe(false);
  });
});

describe('showsStartReviewAction — the front door does not disappear at zero (ol-h3wy)', () => {
  it('shows the action when there is a real, positive due count', () => {
    expect(showsStartReviewAction({ total: 3 })).toBe(true);
  });

  it('still shows the action at a real, computed zero — the regression this bead fixes', () => {
    // Before ol-h3wy, `view.ts` rendered `NOTHING_DUE` and returned without
    // ever building the action button when `due.total === 0`. That made the
    // Today panel's one entry point vanish at exactly the moment David's
    // ruling (`ol-f77commands`) made this panel Olea's front door.
    expect(showsStartReviewAction({ total: 0 })).toBe(true);
  });

  it('does not show the action when the due count could not be read at all', () => {
    // `due === null` is "cannot count", a different and harder claim than
    // "zero due" — this bead does not decide whether offering a session
    // against an unreadable vault is honest, so that state is left alone.
    expect(showsStartReviewAction(null)).toBe(false);
  });
});
