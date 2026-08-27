/**
 * `copy.ts` (`ol-09kf`, Q6.5, F2.15, F2.16).
 *
 * These are the assertions that did not exist while this code lived in
 * `view.ts`. Two of them matter more than the rest:
 *
 *   - the session-complete clause is a **claim about scheduler state**, and
 *     its old form asserted a remainder that does not exist whenever every
 *     reviewed item is due soon;
 *   - the keycaps must agree with `resolveReviewKey`, which is the property
 *     `keymap.ts`'s doc claims for its hint rows and which the buttons were
 *     the one place not to have.
 */

import type { Rating } from 'olea-contracts';
import type { AcceptedExplainBackGrading } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  actionKeycap,
  CLOZE_BLANK,
  EXPLAIN_BACK_CHECK_FAILED_REFUSAL,
  EXPLAIN_WHY_REFUSAL,
  EXPLAIN_WHY_UNAVAILABLE,
  explainBackFullDepthEncouragement,
  explainBackInsufficientNotesRefusal,
  formatCourseList,
  mcqFeedbackSentence,
  mcqOptionKeycap,
  questionText,
  REVIEW_UNAVAILABLE_BODY,
  REVIEW_UNAVAILABLE_TITLE,
  ratingKeycap,
  ratingLabel,
  sessionCompleteSentence,
  verifiedKeycap,
} from '../../src/review/copy.js';
import { resolveReviewKey } from '../../src/review/keymap.js';
import type { ClozeCard, QaCard } from '../../src/review/types.js';

const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

describe('formatCourseList', () => {
  it('renders nothing for no courses', () => {
    expect(formatCourseList([])).toBe('');
  });

  it('renders one, two and three courses', () => {
    expect(formatCourseList(['MUSTH104'])).toBe('MUSTH104');
    expect(formatCourseList(['MUSTH104', 'GEOL204'])).toBe('MUSTH104 and GEOL204');
    expect(formatCourseList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(formatCourseList(['A', 'B', 'C', 'D'])).toBe('A, B, C and D');
  });
});

describe('sessionCompleteSentence', () => {
  const summary = (
    reviewedCount: number,
    dueSoonCount: number,
    courseCodes: readonly string[] = [],
  ) => ({ reviewedCount, dueSoonCount, courseCodes });

  it('says nothing was reviewed when nothing was', () => {
    expect(sessionCompleteSentence(summary(0, 0, []))).toBe('Nothing was reviewed this session.');
    // Course codes cannot be non-empty with a zero count, but the sentence
    // must not start inventing an "across" clause if that ever changes.
    expect(sessionCompleteSentence(summary(0, 0, ['MUSTH104']))).toBe(
      'Nothing was reviewed this session.',
    );
  });

  it('pluralises the item count', () => {
    expect(sessionCompleteSentence(summary(1, 0))).toMatch(/^1 item\./);
    expect(sessionCompleteSentence(summary(2, 0))).toMatch(/^2 items\./);
  });

  it('names the courses only when there are some', () => {
    expect(sessionCompleteSentence(summary(3, 0, ['MUSTH104', 'GEOL204']))).toMatch(
      /^3 items across MUSTH104 and GEOL204\./,
    );
    expect(sessionCompleteSentence(summary(3, 0, []))).toMatch(/^3 items\./);
  });

  // ---- the schedule-asserting clause ----

  it('never claims a remainder that does not exist (the bug this move fixes)', () => {
    // Every reviewed item due soon. The old copy said "1 of them come back
    // today or tomorrow; the rest are further out" — there is no rest.
    expect(sessionCompleteSentence(summary(1, 1))).toBe('1 item. It comes back today or tomorrow.');
    expect(sessionCompleteSentence(summary(4, 4))).toBe(
      '4 items. All of them come back today or tomorrow.',
    );
    for (let n = 1; n <= 12; n++) {
      expect(sessionCompleteSentence(summary(n, n))).not.toContain('the rest');
    }
  });

  it('claims a remainder exactly when there is one', () => {
    expect(sessionCompleteSentence(summary(4, 1))).toBe(
      '4 items. 1 of them come back today or tomorrow; the rest are further out.',
    );
    expect(sessionCompleteSentence(summary(4, 3))).toContain('the rest are further out');
  });

  it('says all are further out when none are due soon', () => {
    expect(sessionCompleteSentence(summary(1, 0))).toBe(
      '1 item. It comes back later than tomorrow.',
    );
    expect(sessionCompleteSentence(summary(5, 0))).toBe(
      '5 items. All of them are further out than tomorrow.',
    );
  });

  it('is a single well-formed sentence pair for every reachable count pairing', () => {
    for (let reviewed = 1; reviewed <= 8; reviewed++) {
      for (let soon = 0; soon <= reviewed; soon++) {
        const text = sessionCompleteSentence(summary(reviewed, soon, ['MUSTH104']));
        expect(text).not.toContain('  ');
        expect(text).not.toContain('undefined');
        expect(text.endsWith('.')).toBe(true);
        // The "some" wording is only ever used for a genuine partition.
        if (text.includes('the rest')) {
          expect(soon).toBeGreaterThan(0);
          expect(soon).toBeLessThan(reviewed);
        }
      }
    }
  });

  it('clamps a due-soon count that exceeds the reviewed count rather than asserting a remainder', () => {
    expect(sessionCompleteSentence(summary(2, 9))).not.toContain('the rest');
  });
});

describe('mcqFeedbackSentence', () => {
  it('joins the instrument feedback to the schedule claim with a single space', () => {
    expect(mcqFeedbackSentence('Not quite — the cement is what bridges.', 'in 6 days')).toBe(
      'Not quite — the cement is what bridges. This one comes back in 6 days.',
    );
  });

  it('omits the schedule claim entirely when no interval is in hand', () => {
    expect(mcqFeedbackSentence('Correct.', '')).toBe('Correct.');
    expect(mcqFeedbackSentence('Correct.', '   ')).toBe('Correct.');
  });

  it('produces the schedule claim alone when the instrument has no feedback', () => {
    expect(mcqFeedbackSentence('', 'tomorrow')).toBe('This one comes back tomorrow.');
  });

  it('never leaves a doubled space or a dangling interval', () => {
    for (const feedback of ['', ' ', 'A.', 'A. ']) {
      for (const label of ['', 'today', 'tomorrow', 'in 21 days']) {
        const text = mcqFeedbackSentence(feedback, label);
        expect(text).not.toContain('  ');
        expect(text).not.toMatch(/comes back\s*\./);
      }
    }
  });
});

describe('questionText', () => {
  const qa: QaCard = {
    type: 'qa',
    instrumentId: 'i1',
    conceptIds: ['c1'],
    courseCode: 'MUSTH104',
    noteTitle: 'Note',
    sourcePath: 'a.md',
    blockId: null,
    draftId: null,
    question: 'Who is telling us?',
    answer: 'No single narrator.',
  } as QaCard;

  const cloze: ClozeCard = {
    type: 'cloze',
    instrumentId: 'i2',
    conceptIds: ['c1'],
    courseCode: 'MUSTH104',
    noteTitle: 'Note',
    sourcePath: 'a.md',
    blockId: null,
    draftId: null,
    before: 'The play withholds ',
    clozeText: 'an outside perspective',
    after: ' entirely.',
    noteContext: null,
  } as ClozeCard;

  it('shows a Q&A question verbatim', () => {
    expect(questionText(qa)).toBe('Who is telling us?');
  });

  it('shows a cloze front with the blank in place of the deleted text', () => {
    expect(questionText(cloze)).toBe(`The play withholds ${CLOZE_BLANK} entirely.`);
    expect(questionText(cloze)).not.toContain(cloze.clozeText);
  });
});

describe('rating labels', () => {
  it('labels every rating', () => {
    expect(RATINGS.map(ratingLabel)).toEqual(['Again', 'Hard', 'Good', 'Easy']);
  });
});

describe('keycaps derive from the key resolver', () => {
  it('gives every rating a digit that the reveal screen really accepts', () => {
    for (const rating of RATINGS) {
      const key = ratingKeycap(rating);
      expect(key, `${rating} has a keycap`).not.toBeNull();
      expect(resolveReviewKey({ key: key as string }, { kind: 'card-reveal' })).toEqual({
        kind: 'rate',
        rating,
      });
    }
  });

  it('gives the four ratings four distinct digits', () => {
    const keys = RATINGS.map(ratingKeycap);
    expect(new Set(keys).size).toBe(RATINGS.length);
  });

  it('gives every MCQ option a letter that answers that option', () => {
    const optionCount = 4;
    for (let i = 0; i < optionCount; i++) {
      const glyph = mcqOptionKeycap(i, optionCount);
      expect(glyph, `option ${i} has a keycap`).not.toBeNull();
      expect(glyph).toBe((glyph as string).toUpperCase());
      expect(
        resolveReviewKey(
          { key: (glyph as string).toLowerCase() },
          {
            kind: 'mcq-unanswered',
            optionCount,
          },
        ),
      ).toEqual({ kind: 'mcq-answer', optionIndex: i });
    }
  });

  it('shows no MCQ keycap for an option index the resolver will not accept', () => {
    expect(mcqOptionKeycap(4, 4)).toBeNull();
  });

  it('derives the header and MCQ-footer letters on the screens that accept them', () => {
    expect(actionKeycap('edit', { kind: 'card-front' })).toBe('E');
    expect(actionKeycap('suspend', { kind: 'card-reveal' })).toBe('S');
    expect(actionKeycap('mcq-toggle-guessed', { kind: 'mcq-answered' })).toBe('G');
  });

  it('shows no header keycap on note-missing, where the resolver accepts neither E nor S', () => {
    // The header renders above this screen too, and used to advertise a
    // hand-typed 'E'/'S' that did nothing there (keymap.ts: nothing to edit
    // or suspend when the note is gone).
    expect(resolveReviewKey({ key: 'e' }, { kind: 'note-missing' })).toBeNull();
    expect(actionKeycap('edit', { kind: 'note-missing' })).toBeNull();
    expect(actionKeycap('suspend', { kind: 'note-missing' })).toBeNull();
  });

  it('verifies a named key before showing its glyph', () => {
    expect(verifiedKeycap({ kind: 'mcq-answered' }, ' ', 'Space', 'mcq-next')).toBe('Space');
    expect(verifiedKeycap({ kind: 'note-missing' }, 'Enter', '↵', 'skip-missing-note')).toBe('↵');
    expect(
      verifiedKeycap({ kind: 'note-missing' }, 'Delete', 'Delete', 'remove-missing-note'),
    ).toBe('Delete');
    expect(verifiedKeycap({ kind: 'session-complete' }, 'Escape', 'Esc', 'close-tab')).toBe('Esc');
    expect(verifiedKeycap({ kind: 'empty' }, 'Escape', 'Esc', 'close-tab')).toBe('Esc');
  });

  it('shows no glyph when the named key is not bound to that action on that screen', () => {
    // Space does nothing on the complete screen; a button that advertised it
    // would be promising a binding the resolver rejects (Q6.5).
    expect(verifiedKeycap({ kind: 'session-complete' }, ' ', 'Space', 'mcq-next')).toBeNull();
    expect(verifiedKeycap({ kind: 'card-front' }, 'Delete', 'Delete', 'remove-missing-note')).toBe(
      null,
    );
  });
});

/**
 * `ol-jlht`'s rule, applied to the review surface (`ol-09kf` fold, run 4).
 *
 * **The ruling.** The Pass 1 kit's completion line naming a specific future
 * weekday as the next scheduled point was rejected outright: a forward
 * scheduling promise ranging over her whole deck, traceable to no F-number, and
 * falsified by using the product. `today/copy.spec.ts` holds that rejection as
 * a red test rather than as prose.
 *
 * **Why the review surface needs its own version rather than inheriting that
 * one.** Review copy *does* legitimately name a schedule — but only ever as a
 * report of `Scheduler.schedule` output for the rating she just gave, which is
 * state in hand rather than a promise about the deck. Nothing in F2 or F6
 * requires that sentence to exist, so what keeps it honest is a property, not a
 * requirement: **a review string may name a schedule only when the schedule was
 * passed in.**
 *
 * That property was held by careful authorship and by nothing else, which is
 * the same footing the Today string was on before it was found. Here it is a
 * test: every exported copy function is called with no scheduler state, and
 * none of them may emit schedule vocabulary.
 */
describe('copy.ts — no review string invents a schedule (ol-jlht, ol-09kf)', () => {
  // Deliberately broader than the strings in use: it has to fail on a sentence
  // nobody has written yet. `today/copy.spec.ts` uses the same vocabulary.
  const SCHEDULE_WORDS = [
    'tomorrow',
    'today',
    'until',
    'scheduled',
    'nothing else',
    'further out',
    'comes back',
    'come back',
    'next review',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'day',
    'week',
  ];

  const offends = (text: string) => {
    const lower = text.toLowerCase();
    return SCHEDULE_WORDS.filter((w) => lower.includes(w));
  };

  it('emits no schedule vocabulary when no scheduler state is supplied', () => {
    const produced: string[] = [
      // The session-complete paragraph with nothing reviewed: there is no
      // scheduler output, so there is nothing it may say about later.
      sessionCompleteSentence({ reviewedCount: 0, courseCodes: [], dueSoonCount: 0 }),
      // MCQ feedback with no interval in hand. The schedule sentence must be
      // omitted entirely, not rendered with a gap where the interval goes.
      mcqFeedbackSentence('Not quite — the cement is what bridges.', ''),
      mcqFeedbackSentence('', ''),
      // Everything else in the module: none of it is schedule-shaped at all.
      formatCourseList([]),
      formatCourseList(['GEOL204', 'MUSTH104']),
      ratingLabel('again'),
      ratingLabel('good'),
      CLOZE_BLANK,
    ];

    for (const text of produced) {
      expect({ text, offending: offends(text) }).toEqual({ text, offending: [] });
    }
  });

  it('names a schedule only when one was passed in — and then only about the items in hand', () => {
    // The positive half. Without it this suite would pass by the copy saying
    // nothing at all, which is a different way of failing the same way.
    const withState = sessionCompleteSentence({
      reviewedCount: 3,
      courseCodes: ['GEOL204'],
      dueSoonCount: 3,
    });
    expect(offends(withState).length).toBeGreaterThan(0);
    // ...and what it names is the reviewed set, never the deck.
    expect(withState).toContain('3 items');
    expect(withState).not.toMatch(/nothing else|no other|everything else/i);

    const withInterval = mcqFeedbackSentence('Close.', 'in 6 days');
    expect(withInterval).toContain('in 6 days');
    expect(withInterval).not.toMatch(/nothing else|no other|everything else/i);
  });
});

describe('the unavailable screen states a failed read, not an empty deck', () => {
  // Scenario: features/F2-review.md, "F2.2 — a vault it cannot read says so,
  // and never claims she is caught up". The empty screen and this one are two
  // sentences about two different situations, and the whole value of having
  // both is that neither can be mistaken for the other.
  const unavailable = `${REVIEW_UNAVAILABLE_TITLE} ${REVIEW_UNAVAILABLE_BODY}`;

  it('makes no affirmative claim about what is due', () => {
    expect(REVIEW_UNAVAILABLE_TITLE).not.toMatch(/caught up|nothing is due|all done/i);
    // The body does contain the phrase "nothing is due", exactly once and
    // exactly negated. Asserting the negation rather than the absence is the
    // point: the sentence's job is to pre-empt the reading the empty screen
    // would have given her.
    expect(unavailable.match(/nothing is due/gi)).toHaveLength(1);
    expect(unavailable).toMatch(/not a claim that nothing is due/i);
  });

  it('blames the read, not her, and does not read as a crash', () => {
    expect(unavailable).toMatch(/could not read your vault/i);
    for (const word of ['error', 'failed', 'invalid', 'corrupt', 'crash', 'your fault']) {
      expect(unavailable.toLowerCase(), `"${word}" reads as a defect report`).not.toContain(word);
    }
  });

  it('does not say a feature is missing, because none is', () => {
    expect(unavailable).not.toMatch(/isn'?t built|not built|coming (in|soon)|later update/i);
  });
});

/**
 * Item 32, "What Olea is allowed to say" (`docs/foundation/plan.html` in
 * olea-service): "the refusal path for explanations has no shipped text at
 * all — it exists in the development harness only, so the branch would
 * render nothing." `ol-0r92.2` [COPY-1].
 *
 * `EXPLAIN_BACK_CHECK_FAILED_REFUSAL` and `explainBackInsufficientNotesRefusal`
 * are F5's own two-reason refusal (C4.7, `[D-089]`'s folded path) — distinct
 * from `EXPLAIN_WHY_REFUSAL` above, which is F2.7's simpler on-demand
 * channel. No production caller renders either yet (see `copy.ts`'s module
 * comment for why: `ol-tka5` is still open), so these are pure functions of
 * their own text and inputs, asserted directly rather than through a
 * rendered view.
 */
describe('F5 explain-back refusal copy (`[D-089]`, item 32)', () => {
  it('the transient-error refusal names the mechanical fact and a next step, never sympathy', () => {
    expect(EXPLAIN_BACK_CHECK_FAILED_REFUSAL).toMatch(/couldn'?t check/i);
    expect(EXPLAIN_BACK_CHECK_FAILED_REFUSAL).toMatch(/nothing was graded/i);
    expect(EXPLAIN_BACK_CHECK_FAILED_REFUSAL).toMatch(/try again/i);
    expect(EXPLAIN_BACK_CHECK_FAILED_REFUSAL.toLowerCase()).not.toContain('sorry');
  });

  it('the insufficient-notes refusal states what was found, scaled to the count', () => {
    expect(explainBackInsufficientNotesRefusal(0)).toMatch(/don'?t have anything on this yet/i);
    expect(explainBackInsufficientNotesRefusal(1)).toContain('1 passage');
    expect(explainBackInsufficientNotesRefusal(1)).not.toContain('1 passages');
    expect(explainBackInsufficientNotesRefusal(3)).toContain('3 passages');
    for (const count of [0, 1, 2, 5]) {
      const text = explainBackInsufficientNotesRefusal(count);
      expect(text).toMatch(/add more to your notes, then try again\.$/i);
    }
  });

  it('the two reasons are distinguishable in both directions (`[D-089]`)', () => {
    // An error-refusal never uses the insufficient-notes wording, and the
    // insufficient-notes refusal never claims a transient/mechanical check
    // failure — swapping one for the other is exactly the false claim C4.7
    // calls "a refusal's clothes."
    expect(EXPLAIN_BACK_CHECK_FAILED_REFUSAL.toLowerCase()).not.toMatch(
      /don'?t have anything|not enough|passages?/,
    );
    for (const count of [0, 1, 3]) {
      expect(explainBackInsufficientNotesRefusal(count).toLowerCase()).not.toMatch(
        /couldn'?t check|nothing was graded|try again in a moment/,
      );
    }
  });

  it('leads with her material, not with Olea (V1) — the diagnostic is about her notes', () => {
    // V1's own failing example is this shape written the other way round:
    // "Olea noticed Anatomy is behind" instead of leading with the material.
    for (const count of [0, 1, 4]) {
      expect(explainBackInsufficientNotesRefusal(count)).toMatch(/^Your notes /);
    }
  });
});

/**
 * `explainBackFullDepthEncouragement` — F6.8 / V5's "first-ever full-depth
 * explanation" moment, the one encouragement string this cluster can
 * honestly write from an `AcceptedExplainBackGrading` (item 32's second
 * Done-when clause: "encouragement copy names specific evidence").
 */
describe('explainBackFullDepthEncouragement (F6.8, V5, item 32)', () => {
  function grading(
    overrides: Partial<AcceptedExplainBackGrading> = {},
  ): AcceptedExplainBackGrading {
    return {
      status: 'accepted',
      verdict: 'correct',
      feedback: '',
      missedPoints: [],
      citedIssues: [],
      misconceptionCandidates: [],
      ...overrides,
    };
  }

  it('says nothing that could have been written before she did the work', () => {
    // A partial or incorrect verdict, or any flagged issue, is exactly the
    // case F6.8 bars — "a claim of progress Olea has not measured."
    expect(explainBackFullDepthEncouragement(grading({ verdict: 'partial' }))).toBeNull();
    expect(explainBackFullDepthEncouragement(grading({ verdict: 'incorrect' }))).toBeNull();
    expect(
      explainBackFullDepthEncouragement(grading({ missedPoints: ['the mechanism itself'] })),
    ).toBeNull();
    expect(
      explainBackFullDepthEncouragement(
        grading({
          citedIssues: [{ kind: 'omission', description: 'x', sourceBlockIds: ['b1'] }],
        }),
      ),
    ).toBeNull();
    expect(
      explainBackFullDepthEncouragement(
        grading({
          misconceptionCandidates: [
            {
              concept: 'c1',
              statement: 'x',
              correction: 'y',
              correctionSourceBlockIds: ['b1'],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('names the milestone as fact, matching the vocabulary registry’s own V5 example', () => {
    const text = explainBackFullDepthEncouragement(grading());
    expect(text).toBe("That's the first time this concept has been explained at full depth.");
  });

  it('appends the grader’s own feedback as the specific evidence, never inventing a second sentence', () => {
    const text = explainBackFullDepthEncouragement(
      grading({ feedback: 'Your explanation covered both the mechanism and its limits.' }),
    );
    expect(text).toBe(
      "That's the first time this concept has been explained at full depth. Your explanation covered both the mechanism and its limits.",
    );
  });

  it('never states a verdict word or effort/discipline language (V6)', () => {
    for (const feedback of ['', 'Solid coverage of the mechanism.']) {
      const text = explainBackFullDepthEncouragement(grading({ feedback })) ?? '';
      for (const word of ['correct', 'partial', 'incorrect', 'effort', 'discipline', 'late']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });
});

/**
 * The voice charter (`[D-096]`, vocabulary registry §9) sweep over every
 * static string this lane's slice of the explain-back/explain-why cluster
 * can render — `features/F5-explain-it-back.md`'s "`[D-096]` V1–V6" block,
 * scoped to `packages/plugin/src/review/copy.ts` (item 32's own `owns`
 * line). V1/V2/V4/V5/V6 are pass/fail per sentence and checked directly;
 * V3 is checked as "carries a fact and never substitutes sympathy for one"
 * rather than a mechanical three-clause parse, matching how
 * `REVIEW_UNAVAILABLE_BODY` (shipped, unchanged here) already satisfies it.
 */
describe('[D-096] V1–V6 — the voice charter over this cluster’s static strings', () => {
  const STRINGS: readonly string[] = [
    EXPLAIN_WHY_REFUSAL,
    EXPLAIN_WHY_UNAVAILABLE,
    EXPLAIN_BACK_CHECK_FAILED_REFUSAL,
    explainBackInsufficientNotesRefusal(0),
    explainBackInsufficientNotesRefusal(1),
    explainBackInsufficientNotesRefusal(4),
  ];

  it('V2 — names Olea, or names no actor at all, never "the system" or "I"', () => {
    for (const text of STRINGS) {
      expect(text).not.toMatch(/\bthe system\b/i);
      expect(text).not.toMatch(/\bI\b/);
      const oleaCount = (text.match(/\bOlea\b/g) ?? []).length;
      expect(oleaCount).toBeLessThanOrEqual(1);
    }
  });

  it('V4 — no apology; a self-failure states the defect and the next step', () => {
    for (const text of STRINGS) {
      expect(text.toLowerCase()).not.toContain('sorry');
      expect(text.toLowerCase()).not.toMatch(/something went wrong/);
    }
  });

  it('V3 — bad news carries a fact, never bare sympathy in its place', () => {
    const SYMPATHY_ONLY = /^(sorry|oops|we apologi[sz]e|something went wrong)[.!]?$/i;
    for (const text of STRINGS) {
      expect(SYMPATHY_ONLY.test(text.trim())).toBe(false);
    }
  });

  it('V5 — no refusal string carries affect; only the one closed-list moment does', () => {
    // None of these refusals is a celebration moment, so none may read as one.
    for (const text of STRINGS) {
      expect(text).not.toMatch(/great|nice|well done|congrat/i);
    }
    // The encouragement string, conversely, is the one licensed exception —
    // and only in its milestone clause, checked in its own describe block above.
  });

  it('V6 — no verdict, no effort talk, no bare quotient, in any refusal string', () => {
    for (const text of STRINGS) {
      for (const word of ['effort', 'discipline', 'lazy', 'behind schedule']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
      // "Not enough" is a fact about a count, not a quotient rendered as a
      // single number (there is no ratio here at all) — nothing in this set
      // renders a bare percentage or score.
      expect(text).not.toMatch(/\d+%/);
    }
  });
});
