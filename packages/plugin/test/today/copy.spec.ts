/**
 * The Today panel's copy, tested against the rules the §8.2 record produced
 * (`../../../../olea-service/docs/design/RECHECK-8.2-passes-3-4.md`).
 *
 * Three of these assertions exist because the Pass 1 kit's own body copy
 * asserts behaviour the contract does not have. A rejection recorded only in
 * prose is a rejection that gets re-added by the next person who reads the
 * mock and not the record; a rejection recorded as a failing test is not.
 */

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
  rhythmQuietClause,
  rhythmQuietLine,
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
