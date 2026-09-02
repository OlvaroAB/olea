/**
 * The persona assertions — and the proof that they can fail.
 *
 * ## The shape of this file, and why it is this shape
 *
 * SYN-1's acceptance clause requires every persona's planted pattern to be
 * asserted by a test that fails once that pattern is removed from the
 * generator, on the grounds that a golden fixture nobody can falsify repeats
 * the `ol-inv2vacuity` defect under another name. This repo has now hit that
 * defect in four mechanisms, so the falsifiability is built into the structure
 * here rather than left to a promise:
 *
 * Every persona declares a list of **discriminating claims** — predicates over
 * (persona stream, control stream). Each claim is then run twice:
 *
 *  1. against the persona, where it must hold; and
 *  2. against a stream generated from the same seed with the persona's
 *     `planted.neutralise` override applied — the pattern removed from the
 *     generator and nothing else changed — where it must **fail**.
 *
 * A claim that passes step 1 and also passes step 2 is not asserting the
 * pattern; it is asserting something the persona happens to share with its own
 * neutralised twin, and the test says so by name. That second half is the whole
 * point of the file, and it runs on every CI push rather than living in a
 * report someone has to believe.
 *
 * Every claim runs across **four seeds**, so a claim that holds by luck on one
 * draw does not get to look like a property.
 *
 * ## On the numbers in these predicates
 *
 * They are assertions about a fixture we fabricated, not thresholds in a
 * detector. Nothing in the product may adopt one: N-015 bars any threshold
 * from being tuned on a synthetic distribution. Most are expressed as
 * a ratio against the `steady-reviewer` control precisely so that they describe
 * a *contrast* rather than a magnitude — a magnitude taken from this data would
 * be exactly the value N-015 forbids anyone to use.
 */

import { describe, expect, it } from 'vitest';
import type { PersonaId, SyntheticStream } from '../src/index.js';
import {
  COURSE_QUORBIN,
  COURSE_VANTREL,
  courseOfConcept,
  disputeEvents,
  dueStateCounts,
  earlyPullShare,
  eventDays,
  explainBackDeclineEvents,
  explainBackOfferEvents,
  explainBackRecords,
  generateStream,
  instrumentShareWhenBothOffered,
  lapseRateByCourse,
  maxGapDays,
  medianExamProximity,
  PERSONAS,
  recurringFailureConceptIds,
  reviewCountByCourse,
  reviewsOf,
  reviewsPerActiveDay,
  streamSpec,
  timeShareByCourse,
  topDayShare,
} from '../src/index.js';

const SEEDS = ['persona-a', 'persona-b', 'persona-c', 'persona-d'] as const;

interface Claim {
  readonly name: string;
  readonly holds: (stream: SyntheticStream, control: SyntheticStream) => boolean;
}

function control(seed: string): SyntheticStream {
  return generateStream(streamSpec('steady-reviewer', seed));
}

function asPersona(persona: PersonaId, seed: string): SyntheticStream {
  return generateStream(streamSpec(persona, seed));
}

/** The same persona, same seed, with `planted.neutralise` applied — the pattern removed. */
function neutralised(persona: PersonaId, seed: string): SyntheticStream {
  return generateStream(
    streamSpec(persona, seed, { behaviour: PERSONAS[persona].planted.neutralise }),
  );
}

/** Share of reviews falling on a day the generator declared a pre-assessment burst. */
function burstDayShare(stream: SyntheticStream): number {
  const reviews = reviewsOf(stream.entries);
  if (reviews.length === 0) return 0;
  const burst = new Set(stream.groundTruth.burstDates);
  return reviews.filter((r) => burst.has(r.timestamp.slice(0, 10))).length / reviews.length;
}

const CRAMMER_CLAIMS: readonly Claim[] = [
  {
    name: 'most reviews land on a declared pre-assessment burst day',
    holds: (s) => burstDayShare(s) > 0.5,
  },
  {
    name: 'a large share of reviews are pulled before their FSRS due date',
    holds: (s) => earlyPullShare(s.entries) > 0.3,
  },
  {
    name: 'reviews sit far closer to an assessment than the control’s do',
    holds: (s, c) => {
      const persona = medianExamProximity(s.entries);
      const steady = medianExamProximity(c.entries);
      return persona !== null && steady !== null && persona < steady / 3;
    },
  },
];

const CRAMMER_SUPPORTING: readonly Claim[] = [
  {
    name: 'far more reviews per day she studies than the control',
    holds: (s, c) => reviewsPerActiveDay(s.entries) > 3 * reviewsPerActiveDay(c.entries),
  },
  {
    name: 'she studies on far fewer days than the control',
    holds: (s, c) => eventDays(s.entries).length < 0.6 * eventDays(c.entries).length,
  },
  {
    name: 'her busiest five days hold a bigger share of her work than the control’s',
    holds: (s, c) => topDayShare(s.entries, 5) > 1.3 * topDayShare(c.entries, 5),
  },
];

const SKIPPER_CLAIMS: readonly Claim[] = [
  {
    name: 'when a card and an MCQ were both offered, she overwhelmingly took the MCQ',
    holds: (s) => instrumentShareWhenBothOffered(s.entries).mcqShare > 0.75,
  },
  {
    name: 'her co-offered MCQ share is far above the control’s',
    holds: (s, c) =>
      instrumentShareWhenBothOffered(s.entries).mcqShare >
      1.5 * instrumentShareWhenBothOffered(c.entries).mcqShare,
  },
  {
    name: 'the cards she leaves pile up overdue, far beyond anything the control accumulates',
    holds: (s, c) => {
      const skipped = dueStateCounts(s.entries).overdue ?? 0;
      return skipped > 10 && skipped > 3 * ((dueStateCounts(c.entries).overdue ?? 0) + 1);
    },
  },
];

const RETURNER_CLAIMS: readonly Claim[] = [
  {
    name: 'the declared absence contains no events of any kind',
    holds: (s) => {
      const blackout = new Set(s.groundTruth.blackoutDates);
      return (
        blackout.size === 10 && s.entries.every((e) => !blackout.has(e.timestamp.slice(0, 10)))
      );
    },
  },
  {
    name: 'her longest silence spans the absence; the control never goes that quiet',
    holds: (s, c) => maxGapDays(s.entries) >= 11 && maxGapDays(c.entries) < 11,
  },
];

const STRUGGLER_CLAIMS: readonly Claim[] = [
  {
    name: 'one course carries a far higher `again` rate than the other',
    holds: (s) => {
      const rates = lapseRateByCourse(s.entries);
      const losing = rates.get(COURSE_VANTREL);
      const other = rates.get(COURSE_QUORBIN);
      return (
        losing !== undefined &&
        other !== undefined &&
        other.reviews > 20 &&
        losing.rate > 2.5 * other.rate
      );
    },
  },
  {
    name: 'repeated failure routed her to explain-back, overwhelmingly on the course she is losing',
    holds: (s) => {
      const explains = explainBackRecords(s.entries);
      if (explains.length === 0) return false;
      // Never rated: explain-back produces no rating at all (F2.16).
      if (!explains.every((r) => r.rating === null)) return false;
      const onLosingCourse = explains.filter((r) =>
        r.conceptIds.some((c) => courseOfConcept(c) === COURSE_VANTREL),
      ).length;
      return onLosingCourse / explains.length > 0.8;
    },
  },
  {
    name: 'she suspended instruments and later unsuspended them (F2.6 / D-020)',
    holds: (s) =>
      s.entries.some((e) => e.kind === 'suspend') && s.entries.some((e) => e.kind === 'unsuspend'),
  },
];

const STRUGGLER_SUPPORTING: readonly Claim[] = [
  {
    // Deliberately NOT a discriminating claim, and the reason is worth writing
    // down: any reviewer with a non-trivial `again` rate accumulates repeated
    // failures on the same concepts over ninety days, so this holds for the
    // neutralised twin too. It is here because M1–M4's recurrence signal needs
    // *something* to detect in this corpus; it is not evidence that the
    // struggler's pattern is being detected. Claim 1 is what carries that.
    name: 'the same concepts fail again and again — material for the recurrence signal',
    holds: (s) => recurringFailureConceptIds(s.entries).size >= 4,
  },
];

/**
 * These two are **within-stream** contrasts — one course against the other in
 * the same log — rather than contrasts against the `steady-reviewer` control,
 * which is the shape most claims in this file take. That is a measured
 * departure, not a lapse: the control's own vantrel time share ranges from
 * 0.42 to 0.67 across the four seeds, because the deck is introduced in
 * `vocabulary.js` order (vantrel first) and FSRS then pulls the two courses'
 * intervals apart by luck of the ratings. A ratio against a denominator that
 * noisy leaves a separating window ~0.03 wide between persona and neutralised
 * twin; the within-stream ratio leaves one ~0.35 wide. A claim that survives
 * only a knife-edge is not a claim (the run charter's plateau rule), so the
 * comparison that actually discriminates is the one used.
 */
const LOPSIDED_CLAIMS: readonly Claim[] = [
  {
    // F6.5(b)'s ground truth, stated in the vocabulary a measurement can reach:
    // not "she has a low courseTakeRate" (that would be reading the knob back)
    // but "her hours did not land on that course".
    name: 'her review time on one course is a fraction of her time on the other',
    holds: (s) => {
      const shares = timeShareByCourse(s.entries);
      const neglected = shares.get(COURSE_VANTREL);
      const other = shares.get(COURSE_QUORBIN);
      return neglected !== undefined && other !== undefined && neglected < 0.6 * other;
    },
  },
  {
    name: 'the neglect is in the reviews taken, not only in the seconds spent',
    holds: (s) => {
      // Counted separately from time so the pattern cannot be an artefact of a
      // duration model: she is not answering vantrel items faster, she is not
      // answering them.
      const counts = reviewCountByCourse(s.entries);
      const neglected = counts.get(COURSE_VANTREL) ?? 0;
      const other = counts.get(COURSE_QUORBIN) ?? 0;
      return other > 20 && neglected < 0.6 * other;
    },
  },
];

const LOPSIDED_SUPPORTING: readonly Claim[] = [
  {
    // Deliberately NOT discriminating: it is here to record that the persona
    // is lopsided in EFFORT and in nothing else. She is not failing the course
    // she neglects, she is not cramming, and she does not vanish — so a
    // detector that fires on her must be reading the split, not a lapse rate,
    // a burst or a suspension. Holds on the neutralised twin too, by
    // construction.
    //
    // The gap bound is 11, not 3, and the measured reason is worth keeping:
    // she does accumulate quiet days (up to 9 across the four seeds) as a
    // *consequence* of the neglect — the deck is introduced in `vocabulary.js`
    // order, vantrel first, so on a day whose only offers are vantrel items she
    // leaves all of them and emits nothing. That is the pattern showing up in
    // an unplanned place rather than a second pattern, and it stays clear of
    // the lapsed-returner's own claim (>= 11 days), so the two personas remain
    // distinguishable.
    name: 'she is not also struggling, cramming or lapsing — one pattern, cleanly',
    holds: (s) =>
      earlyPullShare(s.entries) === 0 &&
      maxGapDays(s.entries) < 11 &&
      s.entries.every((e) => e.kind === 'review'),
  },
];

/**
 * `[D-178 / LOG-3]` item 2: the same routing setup as `struggler`, but every
 * offer is declined rather than attempted. The claims have to show both
 * halves — the offered/declined pair is written, AND the review-record path
 * struggler exercises is never taken — or a persona named "decliner" that
 * happened to also emit reviews would be exactly the `ol-inv2vacuity` shape
 * this file exists to catch.
 */
const EXPLAIN_BACK_DECLINER_CLAIMS: readonly Claim[] = [
  {
    name: 'she is routed to explain-back, and no explain-back review record is ever produced',
    holds: (s) =>
      explainBackOfferEvents(s.entries).length > 0 && explainBackRecords(s.entries).length === 0,
  },
  {
    name: 'every offer is answered by exactly one honest decline naming it',
    holds: (s) => {
      const offered = explainBackOfferEvents(s.entries);
      const declined = explainBackDeclineEvents(s.entries);
      if (offered.length === 0 || offered.length !== declined.length) return false;
      const offeredIds = new Set(offered.map((o) => o.eventId));
      return declined.every(
        (d) => d.answers !== undefined && offeredIds.has(d.answers) && d.manner === 'not-taken',
      );
    },
  },
];

/**
 * `[D-095]`'s reading case, planted by `contestChance`. The claims have to
 * show both halves — she disputes a meaningful share of the mastery readings
 * she is shown, AND every dispute this generator writes is an honest opening
 * `held` record referencing a real concept, never a resolution it has no
 * mechanism to produce — or a persona named "contest-heavy" that happened to
 * emit a handful of malformed records would be exactly the `ol-inv2vacuity`
 * shape this file exists to catch.
 */
const CONTEST_HEAVY_CLAIMS: readonly Claim[] = [
  {
    name: 'she disputes a large share of the mastery readings she is shown',
    holds: (s) => {
      const readings = reviewsOf(s.entries).filter((r) => r.masteryAtTime !== undefined).length;
      const disputes = disputeEvents(s.entries).length;
      return readings > 20 && disputes / readings > 0.15;
    },
  },
  {
    name: 'her dispute count is far above the control’s (which never contests at all)',
    holds: (s, c) => disputeEvents(s.entries).length > 5 * (disputeEvents(c.entries).length + 1),
  },
  {
    name: 'every dispute is an opening `claimKind: reading` record that HOLDS, never resolved',
    holds: (s) => {
      const disputes = disputeEvents(s.entries);
      if (disputes.length === 0) return false;
      return disputes.every(
        (d) =>
          d.claimKind === 'reading' &&
          d.claimRendering === 'mastery-reading' &&
          d.effect === 'held' &&
          d.instrumentId === undefined &&
          d.resolves === undefined &&
          d.outcome === undefined &&
          d.conceptIds.length > 0,
      );
    },
  },
];

const CLAIMS: Readonly<Partial<Record<PersonaId, readonly Claim[]>>> = {
  crammer: CRAMMER_CLAIMS,
  'instrument-skipper': SKIPPER_CLAIMS,
  'lapsed-returner': RETURNER_CLAIMS,
  struggler: STRUGGLER_CLAIMS,
  'lopsided-effort': LOPSIDED_CLAIMS,
  'explain-back-decliner': EXPLAIN_BACK_DECLINER_CLAIMS,
  'contest-heavy': CONTEST_HEAVY_CLAIMS,
};

describe('planted patterns hold', () => {
  for (const [persona, claims] of Object.entries(CLAIMS) as [PersonaId, readonly Claim[]][]) {
    for (const claim of claims) {
      it(`${persona}: ${claim.name}`, () => {
        for (const seed of SEEDS) {
          const stream = asPersona(persona, seed);
          expect(
            claim.holds(stream, control(seed)),
            `${persona} / seed ${seed}: claim did not hold`,
          ).toBe(true);
        }
      });
    }
  }
});

describe('planted patterns can be falsified — removing the pattern turns the claim red', () => {
  for (const [persona, claims] of Object.entries(CLAIMS) as [PersonaId, readonly Claim[]][]) {
    for (const claim of claims) {
      it(`${persona}: "${claim.name}" FAILS once the pattern is removed`, () => {
        for (const seed of SEEDS) {
          const stripped = neutralised(persona, seed);
          expect(
            claim.holds(stripped, control(seed)),
            `${persona} / seed ${seed}: the claim still held after applying ` +
              `${JSON.stringify(PERSONAS[persona].planted.neutralise)} — so it is not asserting ` +
              'the planted pattern, it is asserting something the persona shares with its own ' +
              'neutralised twin.',
          ).toBe(false);
        }
      });
    }
  }
});

describe('supporting observations (not falsifiability claims)', () => {
  // These describe the crammer truthfully but are *not* required to break under
  // neutralisation: with the cram window removed she is still an irregular
  // reviewer, and irregularity alone produces dense sessions. Kept separate so
  // nobody mistakes them for evidence that the clustering is being detected.
  for (const [persona, claims] of [
    ['crammer', CRAMMER_SUPPORTING],
    ['struggler', STRUGGLER_SUPPORTING],
    ['lopsided-effort', LOPSIDED_SUPPORTING],
  ] as const) {
    for (const claim of claims) {
      it(`${persona}: ${claim.name}`, () => {
        for (const seed of SEEDS) {
          expect(claim.holds(asPersona(persona, seed), control(seed)), `seed ${seed}`).toBe(true);
        }
      });
    }
  }
});

describe('the control is genuinely neutral', () => {
  it('never crams, never vanishes, never suspends, never routes to explain-back, never contests', () => {
    for (const seed of SEEDS) {
      const steady = control(seed);
      expect(steady.groundTruth.burstDates).toEqual([]);
      expect(steady.groundTruth.blackoutDates).toEqual([]);
      expect(steady.groundTruth.suspendedInstrumentIds).toEqual([]);
      expect(steady.groundTruth.explainBackConceptIds).toEqual([]);
      expect(steady.groundTruth.explainBackDeclinedConceptIds).toEqual([]);
      expect(steady.groundTruth.disputedConceptIds).toEqual([]);
      expect(disputeEvents(steady.entries)).toEqual([]);
      expect(earlyPullShare(steady.entries)).toBe(0);
      expect(steady.entries.every((e) => e.kind === 'review')).toBe(true);
      // She turns up on most of the days in the window.
      expect(eventDays(steady.entries).length).toBeGreaterThan(steady.spec.days / 2);
    }
  });

  it('each persona’s ground truth matches the days it actually emitted events on', () => {
    for (const persona of Object.keys(CLAIMS) as PersonaId[]) {
      const stream = asPersona(persona, 'ground-truth');
      expect(eventDays(stream.entries)).toEqual([...stream.groundTruth.sessionDates].sort());
      for (const burstDate of stream.groundTruth.burstDates) {
        expect(stream.groundTruth.sessionDates).toContain(burstDate);
      }
    }
  });
});
