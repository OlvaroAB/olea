/**
 * F2.16 — rating mapping per instrument type (P2-T06).
 *
 * Three of the four things this bead promises are properties of *types*, not
 * of runtime values, so three of the four blocks below are type-level
 * assertions with runtime companions:
 *
 *   1. Easy is **absent** for MCQ — unconstructible, not clamped.
 *   2. Explain-back has **no mapper** — an absent function, not a neutral value.
 *   3. The mapping is **pure** — asserted against the module's source text and
 *      its signatures, because "reads no clock" is not observable from a return
 *      value.
 *
 * The fourth (wrong→Again, correct+tap→Hard, correct→Good) is ordinary
 * behaviour and is asserted exhaustively over the whole 2×2 input space rather
 * than on three examples, so there is no unasserted corner.
 *
 * Type-level assertions here fail `pnpm -r typecheck`, the same fitness-function
 * technique `scheduler/surface.spec.ts` uses for R3.
 */

import { readFileSync } from 'node:fs';
import type { InstrumentType, Rating } from 'olea-contracts';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CardReviewOutcome,
  McqRating,
  McqReviewOutcome,
  RatingMapping,
  ReviewOutcome,
  SchedulableInstrumentType,
} from './rating.js';
import {
  loggedRating,
  mapCardRating,
  mapMcqRating,
  mapReviewOutcome,
  RATING_MAPPERS,
} from './rating.js';

const SOURCE = readFileSync(new URL('./rating.ts', import.meta.url), 'utf8');

/** Source with block and line comments removed, so prose about `null` isn't mistaken for code. */
const CODE_ONLY = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ALL_RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

describe('F2.16 — Q&A and cloze keep the native four-way rating', () => {
  it('carries every one of the four ratings through unchanged', () => {
    for (const type of ['qa', 'cloze'] as const) {
      for (const rating of ALL_RATINGS) {
        expect(mapCardRating({ type, rating })).toBe(rating);
      }
    }
  });

  it('offers Easy to recall instruments — the value MCQ does not have', () => {
    expect(mapCardRating({ type: 'qa', rating: 'easy' })).toBe('easy');
    expectTypeOf<ReturnType<typeof mapCardRating>>().toEqualTypeOf<Rating>();
    // The contrast is the requirement, so it is asserted as a contrast: the two
    // families' return types are deliberately NOT the same type.
    expectTypeOf<ReturnType<typeof mapCardRating>>().not.toEqualTypeOf<McqRating>();
  });
});

describe('F2.16 — MCQ mapping', () => {
  // The complete input space: {correct, wrong} × {tapped, not tapped}. Written
  // as a table so a future reader can see that nothing is unasserted.
  const cases: readonly [correct: boolean, wasUnsure: boolean, expected: McqRating][] = [
    [false, false, 'again'],
    [false, true, 'again'],
    [true, true, 'hard'],
    [true, false, 'good'],
  ];

  for (const [correct, wasUnsure, expected] of cases) {
    it(`correct=${correct}, wasUnsure=${wasUnsure} → ${expected}`, () => {
      expect(mapMcqRating({ type: 'mcq', correct, wasUnsure })).toBe(expected);
    });
  }

  it('a wrong answer is Again whether or not she tapped "wasn\'t sure / guessed"', () => {
    expect(mapMcqRating({ type: 'mcq', correct: false, wasUnsure: false })).toBe(
      mapMcqRating({ type: 'mcq', correct: false, wasUnsure: true }),
    );
  });

  it('a guessed correct answer is not the same evidence as a known one', () => {
    // The whole reason the amendment exists: these two must not collapse.
    expect(mapMcqRating({ type: 'mcq', correct: true, wasUnsure: true })).not.toBe(
      mapMcqRating({ type: 'mcq', correct: true, wasUnsure: false }),
    );
  });
});

describe('F2.16 — Easy is absent from MCQ, not filtered out at runtime', () => {
  it('type-level: `easy` is not a member of McqRating', () => {
    expectTypeOf<Extract<McqRating, 'easy'>>().toEqualTypeOf<never>();
    expectTypeOf<McqRating>().toEqualTypeOf<'again' | 'hard' | 'good'>();
  });

  it("type-level: the MCQ mapper's declared return type cannot widen to Rating", () => {
    expectTypeOf<ReturnType<typeof mapMcqRating>>().toEqualTypeOf<McqRating>();
    expectTypeOf<ReturnType<typeof mapMcqRating>>().not.toEqualTypeOf<Rating>();
  });

  it('type-level: MCQ takes facts, not a rating — there is no `easy` to hand in either', () => {
    // The clamp implementation this bead rejects would need a `rating` input to
    // clamp. `McqReviewOutcome` has none, so the invalid state has no way in.
    expectTypeOf<Extract<keyof McqReviewOutcome, 'rating'>>().toEqualTypeOf<never>();
  });

  it('runtime companion: no MCQ input in the whole space yields easy', () => {
    for (const correct of [true, false]) {
      for (const wasUnsure of [true, false]) {
        expect(mapMcqRating({ type: 'mcq', correct, wasUnsure })).not.toBe('easy');
      }
    }
  });

  it("the source contains no runtime clamp — 'easy' is nowhere in MCQ's function body", () => {
    // A clamp ("if the caller asked for easy, return good") would have to name
    // `easy` in executable code to compare against it. The only permitted
    // mention in the whole module is the type-level `Exclude<Rating, 'easy'>`,
    // so this asserts on the mapper's body rather than the file: if it fires,
    // someone replaced the type-level absence with a runtime branch, which is
    // precisely the implementation F2.16 is a warning about.
    const start = CODE_ONLY.indexOf('export function mapMcqRating');
    expect(start).toBeGreaterThan(-1);
    const body = CODE_ONLY.slice(start, CODE_ONLY.indexOf('\n}', start));
    expect(body).toContain('again');
    expect(body).not.toContain('easy');
  });
});

describe('F2.16 — explain-back produces no FSRS rating at all', () => {
  it('type-level: the mapper table has no explain-back entry', () => {
    expectTypeOf<Extract<keyof typeof RATING_MAPPERS, 'explain-back'>>().toEqualTypeOf<never>();
    expectTypeOf<keyof typeof RATING_MAPPERS>().toEqualTypeOf<SchedulableInstrumentType>();
  });

  it('type-level: SchedulableInstrumentType is the log enum minus explain-back', () => {
    expectTypeOf<SchedulableInstrumentType>().toEqualTypeOf<'qa' | 'cloze' | 'mcq'>();
    expectTypeOf<
      Exclude<InstrumentType, SchedulableInstrumentType>
    >().toEqualTypeOf<'explain-back'>();
  });

  it('type-level: the unrated branch has no `rating` property to read', () => {
    type Unrated = Extract<RatingMapping, { fsrsScheduled: false }>;
    expectTypeOf<keyof Unrated>().toEqualTypeOf<'fsrsScheduled'>();
    expectTypeOf<Extract<keyof Unrated, 'rating'>>().toEqualTypeOf<never>();
  });

  it('runtime companion: no explain-back key exists on the mapper table', () => {
    expect(Object.keys(RATING_MAPPERS).sort()).toEqual(['cloze', 'mcq', 'qa']);
    expect(RATING_MAPPERS).not.toHaveProperty('explain-back');
  });

  it('the mapping object itself has no rating property — an absence, not a null', () => {
    const mapping = mapReviewOutcome({ type: 'explain-back' });
    expect(mapping.fsrsScheduled).toBe(false);
    // Not `rating === null`: the property must not be there at all, or a
    // consumer doing `'rating' in mapping` gets the wrong answer.
    expect(Object.hasOwn(mapping, 'rating')).toBe(false);
    expect(Object.keys(mapping)).toEqual(['fsrsScheduled']);
  });

  it('dispatch is total over InstrumentType, and exactly one type is unrated', () => {
    const outcomes: Record<InstrumentType, ReviewOutcome> = {
      qa: { type: 'qa', rating: 'good' },
      cloze: { type: 'cloze', rating: 'again' },
      mcq: { type: 'mcq', correct: true, wasUnsure: false },
      'explain-back': { type: 'explain-back' },
    };
    const unrated = Object.entries(outcomes)
      .filter(([, outcome]) => !mapReviewOutcome(outcome).fsrsScheduled)
      .map(([type]) => type);
    expect(unrated).toEqual(['explain-back']);
  });
});

describe('F2.16 — the absence becomes null at exactly one site', () => {
  it('loggedRating is the only place a null can come from', () => {
    // Comment-stripped source: nothing before `loggedRating`'s declaration may
    // mention `null` at all. If a mapper ever starts returning one, this fires.
    const [beforeBoundary, ...rest] = CODE_ONLY.split('export function loggedRating');
    expect(rest.length).toBe(1);
    expect(beforeBoundary).not.toContain('null');
  });

  it('type-level: no per-type mapper can produce a null', () => {
    expectTypeOf<Extract<ReturnType<typeof mapCardRating>, null>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<ReturnType<typeof mapMcqRating>, null>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<ReturnType<typeof loggedRating>, null>>().toEqualTypeOf<null>();
  });

  it("converts explain-back to the log record's null, and nothing else to null", () => {
    expect(loggedRating(mapReviewOutcome({ type: 'explain-back' }))).toBeNull();
    const scheduled: readonly ReviewOutcome[] = [
      { type: 'qa', rating: 'easy' },
      { type: 'cloze', rating: 'hard' },
      { type: 'mcq', correct: false, wasUnsure: false },
      { type: 'mcq', correct: true, wasUnsure: true },
      { type: 'mcq', correct: true, wasUnsure: false },
    ];
    for (const outcome of scheduled) {
      expect(loggedRating(mapReviewOutcome(outcome))).not.toBeNull();
    }
  });
});

describe('F2.16 — the mapping is a pure function per instrument type', () => {
  it('reads no clock, no randomness and no I/O', () => {
    // "Pure" is not observable from a return value, so it is asserted against
    // the source, the same way check-inv1.mjs asserts an absent import.
    for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'require(', "'node:"]) {
      expect(CODE_ONLY).not.toContain(forbidden);
    }
  });

  it('imports nothing but types, and nothing from the scheduler', () => {
    const imports = SOURCE.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(["import type { InstrumentType, Rating } from 'olea-contracts';"]);
    expect(CODE_ONLY).not.toContain('Scheduler');
    expect(CODE_ONLY).not.toContain('SchedulerState');
  });

  it('the same outcome maps identically however many times it is asked', () => {
    const outcome: McqReviewOutcome = { type: 'mcq', correct: true, wasUnsure: true };
    const first = mapReviewOutcome(outcome);
    const second = mapReviewOutcome(outcome);
    const third = mapReviewOutcome({ ...outcome });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('does not mutate the outcome it was handed', () => {
    const card: CardReviewOutcome = { type: 'qa', rating: 'good' };
    const mcq: McqReviewOutcome = { type: 'mcq', correct: true, wasUnsure: false };
    mapReviewOutcome(card);
    mapReviewOutcome(mcq);
    expect(card).toEqual({ type: 'qa', rating: 'good' });
    expect(mcq).toEqual({ type: 'mcq', correct: true, wasUnsure: false });
  });
});
