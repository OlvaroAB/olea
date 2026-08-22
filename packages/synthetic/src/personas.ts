/**
 * The personas, and the patterns planted in each.
 *
 * ## Every planted pattern is one field of `Behaviour`
 *
 * That is a deliberate design constraint, not a coincidence of refactoring. The
 * SYN-1 acceptance clause that matters is *"each persona's planted pattern must
 * be asserted by a test that FAILS if the pattern is removed from the
 * generator"* — and the only way to make that claim checkable rather than
 * rhetorical is for "removing the pattern" to be a small, obvious, single-line
 * edit somebody can actually perform. Each persona therefore carries a
 * `planted.neutralise` override that does exactly that, and
 * `test/personas.spec.ts` requires every discriminating claim to hold on the
 * persona and **fail** on the neutralised variant. The hand-run mutation
 * experiments recorded in this bead's notes edit the `persona(...)` blocks below
 * and nothing else, and reproduce the same reds.
 *
 * It is also what makes SYN-2 cheap. A planted-effect pair is
 * `plantedPair(spec, { cardTakeRateWhenMcqAvailable: 1 })` — two streams from one
 * seed differing by exactly one knob — and a null pair is the same spec under
 * two seeds. See `./pairs.ts`.
 *
 * ## Nothing here is a threshold
 *
 * Every number below is a *generator input* — it describes the fiction being
 * fabricated. None of it is a detector threshold, and no detector may ever be
 * calibrated against a distribution these numbers produce (N-015, CLAUDE.md).
 * The one place this package derives a value *from* its own output is
 * `MASTERY_STABILITY_BANDS` in `./generate.ts`, and it is marked
 * `synthetic-provisional` there.
 */

import { COURSE_VANTREL } from './vocabulary.js';

export type PersonaId =
  | 'steady-reviewer'
  | 'crammer'
  | 'instrument-skipper'
  | 'lapsed-returner'
  | 'struggler'
  | 'lopsided-effort'
  | 'empty-history'
  | 'single-session';

/** A stretch of days on which no event of any kind is emitted. */
export interface Blackout {
  /** Day index from the stream's `startDate`, inclusive. */
  readonly startDayOffset: number;
  readonly lengthDays: number;
}

/**
 * The behavioural knobs. One persona = one set of values for these; one planted
 * pattern = one (occasionally two) of them moved off its neutral value.
 */
export interface Behaviour {
  /** Probability that an ordinary (non-cram) day is a study day. */
  readonly studyDayChance: number;
  /** New instruments introduced per study day — how the deck ramps up. */
  readonly newPerDay: number;
  /** Reviews per ordinary study day, at most. */
  readonly dailyCap: number;

  // --- crammer -----------------------------------------------------------
  /**
   * Days before an assessment inside which *every* day is a study day and
   * not-yet-due items may be pulled early. `0` disables cramming entirely and
   * is the neutral value.
   */
  readonly cramWindowDays: number;
  /** Reviews per cram day, at most. Only read when `cramWindowDays > 0`. */
  readonly cramDailyCap: number;
  /** Not-yet-due items pulled early per cram day. `0` = no early pulls. */
  readonly cramEarlyPull: number;

  // --- lapsed-returner ---------------------------------------------------
  /** A planned absence. `null` is the neutral value. */
  readonly blackout: Blackout | null;

  // --- instrument-skipper ------------------------------------------------
  /**
   * The probability she takes a card (qa/cloze) for a concept that also has a
   * **live MCQ in her deck**. `1` is the neutral value — she takes everything
   * offered. Below 1 she is avoiding cards, which is the spec amendment's
   * **second early-warning signal**: a standing skip of one instrument type
   * where both were available is evidence the instrument mix should answer to.
   *
   * The condition is "the concept has an MCQ she has met", not "an MCQ is due
   * today", and the difference matters. Avoidance is a standing preference: she
   * leaves the card because she would rather answer the MCQ for that concept,
   * on a day when the MCQ is due or on a day when it is not. Conditioning the
   * *generator* on same-day co-offering would have made cards get cleared on
   * every MCQ-free day and left the log with almost no co-offered reviews to
   * detect anything in — the pattern would exist in the persona and be
   * invisible in the data, which is the one outcome that makes a golden fixture
   * worthless.
   *
   * The *measurement* stays conditional on same-day co-offering, because that
   * is how the spec states the signal (`instrumentShareWhenBothOffered`).
   *
   * A skipped card is not deleted — it stays due, goes overdue, and is offered
   * again tomorrow. That is what makes the skip visible in the log at all:
   * `instrumentTypesOffered` keeps saying a card was available.
   */
  readonly cardTakeRateWhenMcqAvailable: number;

  // --- lopsided-effort ---------------------------------------------------
  /**
   * Per course, the probability she takes an item of that course when the
   * queue offers it. A course absent from this map is taken every time, and
   * `{}` — every course absent — is the neutral value.
   *
   * This is F6.5(b)'s missing ground truth. The counting primitives for effort
   * imbalance (`./measures.js`'s `reviewCountByCourse`, `timeSpentMsByCourse`)
   * have existed since SYN-1, and until this knob there was **no persona in
   * which effort was actually imbalanced** — so a detector built on them could
   * be written and could not be falsified, which is the `ol-inv2vacuity` shape
   * in a new costume. One knob, one persona, one `neutralise` override, exactly
   * as `cardTakeRateWhenMcqAvailable` does for the instrument skipper.
   *
   * It is deliberately an *attention* knob rather than a time knob: making her
   * spend fewer milliseconds per item would plant the measurement directly and
   * prove only that the arithmetic sums. Leaving items untaken is a behaviour,
   * and the time difference is a consequence of it — which is what a detector
   * has to survive.
   *
   * A skipped item is not deleted. It stays due, goes overdue, and is offered
   * again tomorrow (the same mechanic the instrument skipper relies on), so the
   * neglect stays visible in the log rather than vanishing from it.
   */
  readonly courseTakeRate: Readonly<Record<string, number>>;

  // --- struggler ---------------------------------------------------------
  /** Probability of a successful recall, per course id. */
  readonly successByCourse: Readonly<Record<string, number>>;
  /** Probability of a successful recall on any course not named above. */
  readonly defaultSuccess: number;
  /** Probability she taps "wasn't sure / guessed" on a success (F2.16). */
  readonly unsureChance: number;
  /**
   * Consecutive `again` ratings on one concept that route her to explain-back
   * (F2.12). `0` disables routing and is the neutral value.
   */
  readonly explainBackAfterConsecutiveAgain: number;
  /** Total lapses on one instrument before she suspends it (F2.6). `0` disables. */
  readonly suspendAfterLapses: number;
  /** Days after a suspend that she unsuspends. `null` = never (D-020: unsuspend is a second event, not a retraction). */
  readonly unsuspendAfterDays: number | null;

  // --- session texture ---------------------------------------------------
  /** Local hour a session starts. */
  readonly sessionStartHour: number;
  /** Inclusive milliseconds range for one answer, before per-type scaling. */
  readonly answerMsRange: readonly [number, number];
  /** Inclusive milliseconds range for the pause between two items. */
  readonly betweenItemsMsRange: readonly [number, number];
}

/** The neutral behaviour: no planted pattern of any kind. `steady-reviewer` is this plus a name. */
const NEUTRAL: Behaviour = {
  studyDayChance: 1,
  newPerDay: 2,
  dailyCap: 24,
  cramWindowDays: 0,
  cramDailyCap: 24,
  cramEarlyPull: 0,
  blackout: null,
  cardTakeRateWhenMcqAvailable: 1,
  courseTakeRate: {},
  successByCourse: {},
  defaultSuccess: 0.86,
  unsureChance: 0.1,
  explainBackAfterConsecutiveAgain: 0,
  suspendAfterLapses: 0,
  unsuspendAfterDays: null,
  sessionStartHour: 19,
  answerMsRange: [4_000, 18_000],
  betweenItemsMsRange: [1_500, 6_000],
};

/**
 * What the generator *claims* it planted, per persona, in the vocabulary the
 * tests assert in. Held separately from `Behaviour` because a test that
 * compares a measurement of the stream against the behaviour knob that produced
 * it is circular; a test that compares a measurement against an independently
 * stated claim is not.
 */
export interface PlantedPattern {
  /** One line, for a report or a failure message. */
  readonly description: string;
  /** The `Behaviour` field(s) that carry it — where a reader goes to find it. */
  readonly carriedBy: readonly (keyof Behaviour)[];
  /**
   * The override that **removes the pattern from the generator** and changes
   * nothing else.
   *
   * This is the load-bearing field of this whole file. `test/personas.spec.ts`
   * generates each persona twice — once as itself and once under this override
   * — and requires every discriminating claim to hold on the first and *fail*
   * on the second. That is what stops the persona suite becoming
   * `ol-inv2vacuity` in a new costume: a claim that cannot distinguish the
   * persona from the persona-with-its-pattern-removed is not asserting the
   * pattern, whatever its name says.
   */
  readonly neutralise: Partial<Behaviour>;
}

export interface Persona {
  readonly id: PersonaId;
  readonly behaviour: Behaviour;
  readonly planted: PlantedPattern;
}

function persona(
  id: PersonaId,
  overrides: Partial<Behaviour>,
  planted: PlantedPattern,
): [PersonaId, Persona] {
  return [id, { id, behaviour: { ...NEUTRAL, ...overrides }, planted }];
}

export const PERSONAS: Readonly<Record<PersonaId, Persona>> = Object.fromEntries([
  persona(
    'steady-reviewer',
    {},
    {
      description:
        'The control. Studies every day, takes everything offered, no bursts, no gaps, no ' +
        'course she is losing. Exists so every other persona has something to be measured against ' +
        'that is not a hand-picked number.',
      carriedBy: [],
      neutralise: {},
    },
  ),

  persona(
    'crammer',
    {
      // The planted pattern. Ordinary days are mostly skipped; the days before
      // an assessment are all study days, with a much larger cap and a pile of
      // items pulled early. Reviews therefore cluster into a few dense days
      // immediately before each assessment.
      studyDayChance: 0.16,
      cramWindowDays: 5,
      cramDailyCap: 90,
      cramEarlyPull: 30,
      dailyCap: 14,
      sessionStartHour: 21,
      // Cramming is fast and sloppy: shorter answers, more guessing.
      answerMsRange: [2_000, 9_000],
      betweenItemsMsRange: [800, 2_500],
      unsureChance: 0.22,
      defaultSuccess: 0.78,
    },
    {
      description:
        'Bursty, pre-assessment clustering: a large majority of reviews fall inside the ' +
        'five days before an assessment, on a small number of very dense days, with many items ' +
        'pulled early rather than reviewed when due.',
      carriedBy: ['cramWindowDays', 'cramEarlyPull', 'cramDailyCap'],
      // Removing the clustering leaves an irregular reviewer who is not a
      // crammer: she still studies on few days (`studyDayChance` is untouched),
      // but nothing pulls her work towards an assessment. That is deliberately
      // the *hardest* neutral variant to tell apart from her, and it is what
      // the discriminating claims have to survive.
      neutralise: { cramWindowDays: 0, cramEarlyPull: 0, cramDailyCap: 14 },
    },
  ),

  persona(
    'instrument-skipper',
    {
      // The planted pattern, and the whole of it: when both a card and an MCQ
      // are on the table for a concept, she almost always leaves the card.
      cardTakeRateWhenMcqAvailable: 0.08,
      dailyCap: 20,
    },
    {
      description:
        'Avoids cards, takes MCQs. Among reviews where the queue offered both a card ' +
        'type and an MCQ for the concept, the overwhelming majority are the MCQ — the spec ' +
        "amendment's second early-warning signal, computed exactly the way it says: from " +
        "D7.1's instrument-type logging against `instrumentTypesOffered`.",
      carriedBy: ['cardTakeRateWhenMcqAvailable'],
      neutralise: { cardTakeRateWhenMcqAvailable: 1 },
    },
  ),

  persona(
    'lapsed-returner',
    {
      blackout: { startDayOffset: 30, lengthDays: 10 },
    },
    {
      description:
        'Ten consecutive days with no events at all, bracketed by ordinary study on ' +
        'both sides. Everything is overdue on the day she comes back.',
      carriedBy: ['blackout'],
      neutralise: { blackout: null },
    },
  ),

  persona(
    'struggler',
    {
      successByCourse: { [COURSE_VANTREL]: 0.34 },
      defaultSuccess: 0.88,
      unsureChance: 0.24,
      explainBackAfterConsecutiveAgain: 2,
      suspendAfterLapses: 5,
      unsuspendAfterDays: 12,
      dailyCap: 20,
    },
    {
      description:
        'One course she is losing: a far higher `again` rate on that course than the ' +
        'other, repeated failure on the same concepts (the misconception-recurrence signal), ' +
        'explain-back attempts routed off that repeated failure (F2.12), and instruments ' +
        'suspended and later unsuspended (F2.6 / D-020).',
      carriedBy: ['successByCourse', 'explainBackAfterConsecutiveAgain', 'suspendAfterLapses'],
      neutralise: {
        successByCourse: {},
        explainBackAfterConsecutiveAgain: 0,
        suspendAfterLapses: 0,
      },
    },
  ),

  persona(
    'lopsided-effort',
    {
      // The planted pattern, and the whole of it: when the queue offers her
      // something from `COURSE_VANTREL` she almost always leaves it, and takes
      // everything her other course offers. Nothing else is moved — she is not
      // failing vantrel (`successByCourse` is untouched), she is not cramming,
      // and she turns up every day. She simply is not spending the hours there.
      //
      // Vantrel rather than quorbin because `./curriculum.js` gives vantrel the
      // larger assessment weight (30 + 50 against 60), so the neglected course
      // is also the one carrying more of the grade. Neglecting the *lighter*
      // course would be a defensible study strategy and a detector that fired
      // on it would be wrong.
      // 0.02 rather than something milder, and the reason is a property of the
      // generator rather than a choice about how extreme she should be: an item
      // she leaves stays due and is offered again every day after, so the
      // *realised* neglect is far weaker than the per-offer rate. At 0.08 she
      // still logs roughly a third of her hours on the course she is neglecting.
      // The rate is a generator input, never a threshold (N-015) — nothing in
      // the detector was moved to meet it, and the margin it produces is
      // reported rather than assumed (see `test/personas.spec.ts`).
      courseTakeRate: { [COURSE_VANTREL]: 0.02 },
      dailyCap: 20,
    },
    {
      description:
        'Her review time is almost entirely on one of her two courses, and it is not the ' +
        'one carrying the larger assessment weight. F6.5(b)’s ground truth: effort that does ' +
        'not follow what the assessments are worth, planted as a behaviour (items left ' +
        'untaken) rather than as a measurement.',
      carriedBy: ['courseTakeRate'],
      neutralise: { courseTakeRate: {} },
    },
  ),

  persona(
    'empty-history',
    { studyDayChance: 0, newPerDay: 0, dailyCap: 0 },
    {
      description:
        'Edge case: a valid stream containing zero events. Every consumer that renders ' +
        'history has to survive this, and it is the one input a golden fixture never has.',
      carriedBy: [],
      neutralise: {},
    },
  ),

  persona(
    'single-session',
    { newPerDay: 6, dailyCap: 6 },
    {
      description:
        'Edge case: driven with `days: 1`, so the whole history is one session of ' +
        'first exposures — every record `dueState: "new"`, and no `masteryAtTime` recorded ' +
        'on any of them.',
      carriedBy: [],
      neutralise: {},
    },
  ),
]) as Readonly<Record<PersonaId, Persona>>;

export const PERSONA_IDS = Object.keys(PERSONAS) as readonly PersonaId[];
