/**
 * `classifyDeclaredConcept` / `isVolunteer` / `containerNamesToFold`
 * acceptance tests — F8.2's scenarios (`features/F8-concepts-scope.md`,
 * service repo) plus C7.9's part-of fold scenario
 * (`features/F1-sources.md`, "a broad area and its own part are never
 * counted as separate peers against the examiner's denominator",
 * `ol-5phn`), asserted directly against the pure classification/fold rather
 * than through a view.
 *
 * Every concept name below is invented, per INV-3.
 */
import { describe, expect, it } from 'vitest';
import type { ConceptRelation, RelationType } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import * as coverageModule from './coverage.js';
import {
  classifyDeclaredConcept,
  containerNamesToFold,
  describeCoverageConfidence,
  describeFourConfidences,
  describeTeachingArrivalConfidence,
  GROUND_STALL_STREAK_THRESHOLD,
  isVolunteer,
  resolveTeachingArrival,
  THIN_COVERAGE_SENTENCE,
} from './coverage.js';

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

// A part-of B: `from` is the finer/part side, `to` is the coarser/container
// side — the same convention `../session/containment.spec.ts`'s own `edge()`
// helper uses.
function partOf(from: string, to: string, type: RelationType = 'part-of'): ConceptRelation {
  return {
    type,
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
  };
}

describe('classifyDeclaredConcept — F8.2 ground', () => {
  it('reads `ground` for material present with nothing generated yet, and nothing else', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'ground',
      stall: false,
      groundStreak: 1,
      teachingArrivalProvenance: 'yes',
    });
  });

  it('never reads `ground` for a concept whose instruments exist and are simply unpractised — that is `seed`', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 1,
      masteryState: 'seed',
      priorGroundStreak: 0,
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'seed',
      stall: false,
      groundStreak: 0,
      teachingArrivalProvenance: 'yes',
    });
  });

  it('never reads `ground` where the material itself is absent — that is a material gap, not ground', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).toEqual({ kind: 'material-gap' });
  });

  it('week-one material gaps stay a material gap even with a nonzero prior ground streak', () => {
    // Guards against a caller accidentally carrying a streak across what is
    // actually a material gap this evaluation (e.g. her objectives doc named
    // lectures that have not happened yet).
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 3,
    });
    expect(result).toEqual({ kind: 'material-gap' });
  });
});

describe('classifyDeclaredConcept — F4.5 stall, under [D-063]', () => {
  it('a first-time `ground` reading is not yet a stall', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).toMatchObject({ state: 'ground', stall: false });
  });

  it('a `ground` cell that persists across desktop sessions is flagged a stall (F4.5), never a policy outcome', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: GROUND_STALL_STREAK_THRESHOLD - 1,
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'ground',
      stall: true,
      groundStreak: GROUND_STALL_STREAK_THRESHOLD,
      teachingArrivalProvenance: 'yes',
    });
  });

  it('the streak resets to zero the moment an instrument exists', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 1,
      masteryState: 'sprout',
      priorGroundStreak: 5,
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'sprout',
      stall: false,
      groundStreak: 0,
      teachingArrivalProvenance: 'yes',
    });
  });

  it('throws rather than guess a mastery state when an instrument exists but none was supplied', () => {
    expect(() =>
      classifyDeclaredConcept({ hasMaterial: true, instrumentCount: 1, priorGroundStreak: 0 }),
    ).toThrow(/requires a masteryState/);
  });
});

describe('classifyDeclaredConcept — F4.5 stall counts processing passes, not grove reads (ol-egov.141.89.11.14, review 4.7)', () => {
  it("DEFECT (unfixed, pre-`processingPassId` shape): three repeated reads with no processing pass in between still advance the streak to a stall — today's only production caller (`../../../plugin/src/grove/provider.ts` via `./grove.ts`) calls exactly this way, unwired", () => {
    // This is the bug this bead exists to fix, still reachable today because
    // `processingPassId` is optional and the production caller omits it (see
    // module doc). Three grove reads, no generation activity between any of
    // them, each carrying forward the streak from the last — and the streak
    // climbs on every single one.
    let streak = 0;
    for (let read = 0; read < 3; read++) {
      const result = classifyDeclaredConcept({
        hasMaterial: true,
        instrumentCount: 0,
        priorGroundStreak: streak,
      });
      expect(result).toMatchObject({ state: 'ground' });
      streak = (result as { groundStreak: number }).groundStreak;
    }
    expect(streak).toBe(3); // one per read, not per processing pass
    expect(streak).toBeGreaterThanOrEqual(GROUND_STALL_STREAK_THRESHOLD); // a false stall from reads alone
  });

  it('FIX: repeated evaluations carrying the SAME processingPassId (repeated grove reads within one processing pass) do not advance the streak', () => {
    let streak = 0;
    let priorProcessingPassId: string | undefined;
    for (let read = 0; read < 3; read++) {
      const result = classifyDeclaredConcept({
        hasMaterial: true,
        instrumentCount: 0,
        priorGroundStreak: streak,
        processingPassId: 'sweep-1',
        priorProcessingPassId,
      });
      expect(result).toMatchObject({ state: 'ground', groundStreakProcessingPassId: 'sweep-1' });
      streak = (result as { groundStreak: number }).groundStreak;
      priorProcessingPassId = (result as { groundStreakProcessingPassId?: string })
        .groundStreakProcessingPassId;
    }
    // The first call under a never-before-seen pass id advances once (0 -> 1,
    // matching a genuinely first-sight `ground` reading); the second and
    // third calls carry the identical pass id and must NOT advance further —
    // three READS, one PASS.
    expect(streak).toBe(1);
    expect(streak).toBeLessThan(GROUND_STALL_STREAK_THRESHOLD);
  });

  it('FIX: a genuinely DISTINCT processing pass, still stuck at `ground`, does advance the streak — "two distinct processing passes that had it queued" (vew.md §2.2) still flags a stall', () => {
    const passOne = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
      processingPassId: 'sweep-1',
      priorProcessingPassId: undefined,
    });
    expect(passOne).toMatchObject({ groundStreak: 1, stall: false });

    // Re-read the SAME pass twice more first — must not move the streak.
    const rereadSamePass = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: (passOne as { groundStreak: number }).groundStreak,
      processingPassId: 'sweep-1',
      priorProcessingPassId: (passOne as { groundStreakProcessingPassId?: string })
        .groundStreakProcessingPassId,
    });
    expect(rereadSamePass).toMatchObject({ groundStreak: 1, stall: false });

    // A genuinely new pass, concept still stuck at `ground` — this is the
    // real "two distinct processing passes" case and DOES advance.
    const passTwo = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: (rereadSamePass as { groundStreak: number }).groundStreak,
      processingPassId: 'sweep-2',
      priorProcessingPassId: (rereadSamePass as { groundStreakProcessingPassId?: string })
        .groundStreakProcessingPassId,
    });
    expect(passTwo).toEqual({
      kind: 'cell',
      state: 'ground',
      stall: true,
      groundStreak: GROUND_STALL_STREAK_THRESHOLD,
      groundStreakProcessingPassId: 'sweep-2',
      teachingArrivalProvenance: 'yes',
    });
  });

  it('omitting `processingPassId` entirely carries no `groundStreakProcessingPassId` on the output — a caller that has not wired this yet sees exactly the pre-fix object shape', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).not.toHaveProperty('groundStreakProcessingPassId');
  });

  it('leaving `ground` (an instrument now exists) carries no processing-pass identity forward — the streak and its pass both reset', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 1,
      masteryState: 'seed',
      priorGroundStreak: 4,
      processingPassId: 'sweep-9',
      priorProcessingPassId: 'sweep-8',
    });
    expect(result).toMatchObject({ state: 'seed', groundStreak: 0 });
    expect(result).not.toHaveProperty('groundStreakProcessingPassId');
  });
});

describe('resolveTeachingArrival / classifyDeclaredConcept — the taught-signal chain, F8.2 [D-247]', () => {
  it('her own note opens automatically, provenance `yes` — step one, unchanged from before this chain existed', () => {
    expect(resolveTeachingArrival(true)).toEqual({ provenance: 'yes', opensAutomatically: true });

    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'ground',
      stall: false,
      groundStreak: 1,
      teachingArrivalProvenance: 'yes',
    });
  });

  it("the week's slide deck opens a material gap automatically, provenance `yes`, with no note at all", () => {
    expect(
      resolveTeachingArrival(false, {
        inWeekSlideDeck: true,
        calendarSessionWithSlideSequence: false,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: false,
      }),
    ).toEqual({ provenance: 'yes', opensAutomatically: true });

    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      taughtSignal: {
        inWeekSlideDeck: true,
        calendarSessionWithSlideSequence: false,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: false,
      },
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'ground',
      stall: false,
      groundStreak: 1,
      teachingArrivalProvenance: 'yes',
    });
  });

  it('a calendar session plus slide sequence lowers provenance to `probable` but never opens the concept', () => {
    expect(
      resolveTeachingArrival(false, {
        inWeekSlideDeck: false,
        calendarSessionWithSlideSequence: true,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: false,
      }),
    ).toEqual({ provenance: 'probable', opensAutomatically: false });

    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      taughtSignal: {
        inWeekSlideDeck: false,
        calendarSessionWithSlideSequence: true,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: false,
      },
    });
    expect(result).toEqual({ kind: 'material-gap', teachingArrivalProvenance: 'probable' });
  });

  it("the outcomes document's own order lowers provenance to `possible` but never opens the concept", () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      taughtSignal: {
        inWeekSlideDeck: false,
        calendarSessionWithSlideSequence: false,
        outcomesDocumentOrder: true,
        manualGroveConfirmation: false,
      },
    });
    expect(result).toEqual({ kind: 'material-gap', teachingArrivalProvenance: 'possible' });
  });

  it('manual confirmation in the grove lowers provenance but never opens the concept — the step of last resort', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      taughtSignal: {
        inWeekSlideDeck: false,
        calendarSessionWithSlideSequence: false,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: true,
      },
    });
    expect(result).toEqual({ kind: 'material-gap', teachingArrivalProvenance: 'possible' });
  });

  it('earlier steps win over later ones when more than one is present', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      taughtSignal: {
        inWeekSlideDeck: true,
        calendarSessionWithSlideSequence: false,
        outcomesDocumentOrder: true,
        manualGroveConfirmation: false,
      },
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'ground',
      stall: false,
      groundStreak: 1,
      teachingArrivalProvenance: 'yes',
    });
  });

  it('the calendar alone, with no slide sequence, is not a signal at all', () => {
    // F8.2: "The calendar is optional, never a dependency" — and never sufficient by itself
    // either. There is deliberately no separate calendar-only field on `TaughtSignalEvidence`;
    // `calendarSessionWithSlideSequence` is the joint step, so a caller cannot even construct a
    // calendar-only signal that fires.
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      taughtSignal: {
        inWeekSlideDeck: false,
        calendarSessionWithSlideSequence: false,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: false,
      },
    });
    expect(result).toEqual({ kind: 'material-gap' });
  });

  it('an examiner-attested concept with no taught signal at all stays a material gap — a past assessment never opens a concept', () => {
    // The concept reaches `classifyDeclaredConcept` at all only because some registered source
    // (an objectives document, a past paper) declared it in scope (`./grove.ts`'s denominator) —
    // that is the ONLY reason a caller would ever ask this function about it. This test asserts
    // that scope attestation alone, with every taught-signal field false, still yields no
    // provenance and no auto-open: being in scope is never itself read as evidence of teaching,
    // and `ClassifyDeclaredConceptInput` has no field through which a past-paper or
    // objectives-citation count could enter this computation at all.
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      taughtSignal: {
        inWeekSlideDeck: false,
        calendarSessionWithSlideSequence: false,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: false,
      },
    });
    expect(result).toEqual({ kind: 'material-gap' });
    expect(result).not.toHaveProperty('teachingArrivalProvenance');
  });

  it('omitting `taughtSignal` entirely behaves exactly as omitting every one of its fields', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).toEqual({ kind: 'material-gap' });
  });

  it('a nonzero prior ground streak does not survive into a material gap even under a lower-tier taught signal', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 3,
      taughtSignal: {
        inWeekSlideDeck: false,
        calendarSessionWithSlideSequence: true,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: false,
      },
    });
    expect(result).toEqual({ kind: 'material-gap', teachingArrivalProvenance: 'probable' });
  });
});

describe('isVolunteer — F8.2 self-sown concepts', () => {
  it('a concept the declared scope never names is a volunteer', () => {
    expect(isVolunteer('Invented Concept X', new Set(['Invented Concept Y']))).toBe(true);
  });

  it('a concept the declared scope does name is never a volunteer', () => {
    expect(isVolunteer('Invented Concept Y', new Set(['Invented Concept Y']))).toBe(false);
  });
});

describe('containerNamesToFold — C7.9, "a broad area and its own part are never counted as separate peers" (features/F1-sources.md)', () => {
  it('a broad concept and one of its own sized parts are never counted as separate peers against the denominator', () => {
    // Given a broad concept and one of its own sized parts, both in a
    // course's grove (both declared) — when the fold runs, the container
    // side (`to`) is the one dropped, never the part.
    const declaredNames = new Set(['Invented Part', 'Invented Broad Area']);
    const drop = containerNamesToFold(
      [partOf('Invented Part', 'Invented Broad Area')],
      declaredNames,
    );
    expect(drop).toEqual(new Set(['Invented Broad Area']));
  });

  it('drops nothing when only the container is declared and its part is not', () => {
    const declaredNames = new Set(['Invented Broad Area']);
    const drop = containerNamesToFold(
      [partOf('Invented Part', 'Invented Broad Area')],
      declaredNames,
    );
    expect(drop.size).toBe(0);
  });

  it('drops nothing when only the part is declared and its container is not', () => {
    const declaredNames = new Set(['Invented Part']);
    const drop = containerNamesToFold(
      [partOf('Invented Part', 'Invented Broad Area')],
      declaredNames,
    );
    expect(drop.size).toBe(0);
  });

  it('ignores relation types other than part-of, even when both endpoints are declared', () => {
    const declaredNames = new Set(['Invented Concept A', 'Invented Concept B']);
    const drop = containerNamesToFold(
      [partOf('Invented Concept A', 'Invented Concept B', 'prerequisite')],
      declaredNames,
    );
    expect(drop.size).toBe(0);
  });

  it('is a no-op over an empty edge set — the default for every caller that has not threaded relations through', () => {
    const declaredNames = new Set(['Invented Part', 'Invented Broad Area']);
    expect(containerNamesToFold([], declaredNames).size).toBe(0);
  });
});

describe('classifyDeclaredConcept — F8.2 thin coverage is a sentence, never a state ([D-247], CIM-6 / ol-2zfj.83)', () => {
  it('carries the thin-coverage sentence, verbatim, on a `ground` cell whose material the caller judged insufficient', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
      thinCoverageSignal: true,
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'ground',
      stall: false,
      groundStreak: 1,
      teachingArrivalProvenance: 'yes',
      thinCoverageSentence: THIN_COVERAGE_SENTENCE,
    });
    expect(result).toMatchObject({
      thinCoverageSentence:
        'your material mentions this but does not yet give enough to support the kind of question the course asks about it',
    });
  });

  it('carries the thin-coverage sentence on a growth-stage cell too — thinness is about material, not about whether an instrument has been built', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 1,
      masteryState: 'sprout',
      priorGroundStreak: 0,
      thinCoverageSignal: true,
    });
    expect(result).toEqual({
      kind: 'cell',
      state: 'sprout',
      stall: false,
      groundStreak: 0,
      teachingArrivalProvenance: 'yes',
      thinCoverageSentence: THIN_COVERAGE_SENTENCE,
    });
  });

  it('never introduces a new state or enum value alongside the sentence — the growth-stage/`ground` state is unaffected', () => {
    const thin = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
      thinCoverageSignal: true,
    });
    const notThin = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
      thinCoverageSignal: false,
    });
    expect(thin).toMatchObject({ state: 'ground' });
    expect(notThin).toMatchObject({ state: 'ground' });
    // The set of possible `state` values is unchanged by the signal — only
    // an additional, optional sentence field differs between them.
    expect('state' in thin ? thin.state : undefined).toBe(
      'state' in notThin ? notThin.state : undefined,
    );
  });

  it('carries no thin-coverage sentence absent a signal from the caller — this module never infers thinness from document length or any other structural fact', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    expect(result).not.toHaveProperty('thinCoverageSentence');
    expect((result as { thinCoverageSentence?: string }).thinCoverageSentence).toBeUndefined();
  });

  it('a thin-coverage signal never attaches to a material gap — thinness names material present but insufficient, never material absent', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      thinCoverageSignal: true,
    });
    expect(result).toEqual({ kind: 'material-gap' });
    expect(result).not.toHaveProperty('thinCoverageSentence');
  });

  it('a thin-coverage signal never attaches to a material gap carrying a lower-tier teaching-arrival provenance either', () => {
    const result = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
      thinCoverageSignal: true,
      taughtSignal: {
        inWeekSlideDeck: false,
        calendarSessionWithSlideSequence: true,
        outcomesDocumentOrder: false,
        manualGroveConfirmation: false,
      },
    });
    expect(result).toEqual({ kind: 'material-gap', teachingArrivalProvenance: 'probable' });
    expect(result).not.toHaveProperty('thinCoverageSentence');
  });
});

describe('F8.2 four confidences — scope, assessment, coverage, teaching-arrival — never collapse to a scalar ([D-247], CIM-6 / ol-2zfj.83)', () => {
  it('describeFourConfidences returns exactly the four named sentence fields, unchanged, and nothing else', () => {
    const reading = describeFourConfidences({
      scopeConfidence: 'invented scope basis sentence',
      assessmentConfidence: 'invented assessment basis sentence',
      coverageConfidence: 'invented coverage basis sentence',
      teachingArrivalConfidence: 'invented teaching-arrival basis sentence',
    });

    expect(Object.keys(reading).sort()).toEqual([
      'assessmentConfidence',
      'coverageConfidence',
      'scopeConfidence',
      'teachingArrivalConfidence',
    ]);
    expect(reading).toEqual({
      scopeConfidence: 'invented scope basis sentence',
      assessmentConfidence: 'invented assessment basis sentence',
      coverageConfidence: 'invented coverage basis sentence',
      teachingArrivalConfidence: 'invented teaching-arrival basis sentence',
    });
  });

  it('every one of the four fields is a sentence (a string), never a number — the type this bead exists to pin down', () => {
    const reading = describeFourConfidences({
      scopeConfidence: 'a',
      assessmentConfidence: 'b',
      coverageConfidence: 'c',
      teachingArrivalConfidence: 'd',
    });
    for (const value of Object.values(reading)) {
      expect(typeof value).toBe('string');
    }
  });

  it('cannot collapse: no export of this module computes or exposes a combined, averaged or scored confidence value', () => {
    // A structural regression test, not a comment: if a future change adds a
    // `combinedConfidence` / `confidenceScore` / `overallConfidence` export —
    // the natural way F8.3's ban on a coverage scalar would get re-broken for
    // confidence — this test fails without anyone having to notice by eye.
    const scalarSuggestingName = /score|combined|overall|average|scalar|aggregate/i;
    const offendingExports = Object.keys(coverageModule).filter((name) =>
      scalarSuggestingName.test(name),
    );
    expect(offendingExports).toEqual([]);
  });

  it("describeCoverageConfidence and describeTeachingArrivalConfidence each produce this module's own two bases as sentences, not numbers", () => {
    const groundCell = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });
    const thinCell = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 0,
      priorGroundStreak: 0,
      thinCoverageSignal: true,
    });
    const builtCell = classifyDeclaredConcept({
      hasMaterial: true,
      instrumentCount: 1,
      masteryState: 'seed',
      priorGroundStreak: 0,
    });
    const gap = classifyDeclaredConcept({
      hasMaterial: false,
      instrumentCount: 0,
      priorGroundStreak: 0,
    });

    for (const classification of [groundCell, thinCell, builtCell, gap]) {
      expect(typeof describeCoverageConfidence(classification)).toBe('string');
    }
    // The thin-coverage sentence changes the coverage-confidence sentence —
    // it is not silently dropped once assembled into a confidence reading.
    expect(describeCoverageConfidence(thinCell)).not.toBe(describeCoverageConfidence(groundCell));

    for (const provenance of ['yes', 'probable', 'possible', undefined] as const) {
      expect(typeof describeTeachingArrivalConfidence(provenance)).toBe('string');
    }
  });
});
