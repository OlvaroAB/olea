/**
 * test/response-function.spec.ts — `ol-opmb.5` [TB-4]'s second, more valuable
 * half: RESPONSE-LOGIC claims, not semantic ones.
 *
 * David's scope correction on this bead draws the line precisely: "synthetic
 * data can test any claim whose truth is determined by our code given the
 * inputs; it cannot test any claim whose truth depends on what the words
 * mean." Every claim below is the first kind — mastery rollup, FSRS
 * scheduling, oracle ranking and the generator's own blackout handling are
 * all OUR code, exercised with hand-built or generator-produced inputs whose
 * shape is chosen to make the claim decidable. None of it is evidence about
 * how she actually studies (N-015); it is evidence about whether the pipeline
 * reacts to a history the way it is specified to.
 *
 * Each `it` names one claim from the bead's worked list and is written so it
 * CAN fail — see the bead's own N-013 instruction, exercised in the task
 * report rather than in this file's comments.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { computeAllConceptMastery, rankOracle } from '../src/oracle-bridge.js';
import { buildWorld, generateStream, type WorldSpec } from '../src/synthetic-bridge.js';

const CONCEPT_A = 'syn:concept:test-a';
const CONCEPT_B = 'syn:concept:test-b';

function reviewEntry(input: {
  readonly eventId: string;
  readonly conceptId: string;
  readonly day: string;
  readonly rating: 'again' | 'hard' | 'good' | 'easy';
  readonly instrumentType?: 'qa' | 'cloze' | 'mcq';
}): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: input.eventId,
    timestamp: `${input.day}T12:00:00.000Z`,
    instrumentId: `syn:inst:${input.conceptId}:${input.instrumentType ?? 'qa'}`,
    instrumentType: input.instrumentType ?? 'qa',
    conceptIds: [input.conceptId],
    rating: input.rating,
    wasUnsure: false,
    durationMs: 5_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [input.instrumentType ?? 'qa'],
      planVersion: null,
    },
  };
}

describe('claim REFUTED by the ratified model: the growth stage does not fall after a wrong', () => {
  it('one lapse, then a run of them, never lowers a stage already earned — the high-water mark (R3, MAT-6)', () => {
    // This suite's original claim was "mastery falls after a wrong and
    // recovers more slowly than it fell". It was true of the superseded
    // windowed-rate rollup and is FORBIDDEN of the ratified one: the growth
    // stage is a high-water mark, and the knowledge model's §8 test 4 says
    // plainly that a stage which has ever fallen means R3 was implemented
    // backwards. Decay is vitality's axis, not this one — so the claim is
    // kept, inverted, and still written so it CAN fail (a rollup that
    // regressed would turn every assertion below red).
    const days = [
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
      '2027-01-05', // the first lapse
      '2027-01-06',
      '2027-01-07',
      '2027-01-08',
      '2027-01-09',
    ];
    const entries: ReviewLogEntry[] = [];
    let eventCounter = 0;
    const nextId = () => {
      eventCounter += 1;
      return `evt-${eventCounter}`;
    };
    const stageOf = () =>
      computeAllConceptMastery(entries, [CONCEPT_A]).get(CONCEPT_A)?.state ?? 'seed';

    // Three spaced recall successes clear the declared spacing gate.
    for (let i = 0; i < 3; i += 1) {
      entries.push(
        reviewEntry({
          eventId: nextId(),
          conceptId: CONCEPT_A,
          day: days[i] as string,
          rating: 'good',
        }),
      );
    }
    expect(stageOf()).toBe('sapling');

    // Every subsequent event is a lapse, on a new day each time. Under the
    // superseded model this walked the stage back to `sprout`; under the
    // ratified one it cannot move at all.
    const stages: string[] = [];
    for (let i = 3; i < days.length; i += 1) {
      entries.push(
        reviewEntry({
          eventId: nextId(),
          conceptId: CONCEPT_A,
          day: days[i] as string,
          rating: 'again',
        }),
      );
      stages.push(stageOf());
    }
    expect(stages.every((stage) => stage === 'sapling')).toBe(true);

    // And the evidence beneath the stage still records what happened — the
    // reading did not become blind, it moved to the axis that carries it.
    const evidence = computeAllConceptMastery(entries, [CONCEPT_A]).get(CONCEPT_A)?.evidence;
    expect(evidence?.scoredEventCount).toBe(days.length);
    expect(evidence?.scoredSuccessCount).toBe(3);
  });
});

describe('claim: a concept failed three times outranks one passed three times (equal evidence otherwise)', () => {
  it('rankOracle ranks the failed concept above the passed one when everything else about their evidence is equal', () => {
    // Three events each, on three distinct days each — the minimum evidence
    // count that can even distinguish two growth stages under the ratified
    // four-stage vocabulary (D-049; `VOC-1`/`ol-7efk`): `sapling` requires
    // successes on `MIN_SPACED_RETRIEVAL_DAYS` (3) distinct days, so a
    // 2-event "equal evidence" construction (this test's pre-D-049 shape) can
    // no longer land on different stages — both would read `sprout`
    // regardless of outcome, because the retired `shaky`/`coming` split this
    // test originally exploited is exactly what D-049 merged into `sprout`'s
    // single bucket.
    const entriesA: ReviewLogEntry[] = [
      reviewEntry({ eventId: 'a1', conceptId: CONCEPT_A, day: '2027-01-01', rating: 'again' }),
      reviewEntry({ eventId: 'a2', conceptId: CONCEPT_A, day: '2027-01-02', rating: 'again' }),
      reviewEntry({ eventId: 'a3', conceptId: CONCEPT_A, day: '2027-01-03', rating: 'again' }),
    ];
    const entriesB: ReviewLogEntry[] = [
      reviewEntry({ eventId: 'b1', conceptId: CONCEPT_B, day: '2027-01-01', rating: 'good' }),
      reviewEntry({ eventId: 'b2', conceptId: CONCEPT_B, day: '2027-01-02', rating: 'good' }),
      reviewEntry({ eventId: 'b3', conceptId: CONCEPT_B, day: '2027-01-03', rating: 'good' }),
    ];
    const mastery = computeAllConceptMastery([...entriesA, ...entriesB], [CONCEPT_A, CONCEPT_B]);
    expect(mastery.get(CONCEPT_A)?.state).toBe('sprout'); // three failures: the floor once evidence exists
    // Three qa passes across three distinct days clear the declared spacing
    // gate, so this reads `sapling`. It cannot read `tree`: `tree` is behind
    // the depth gate and only a graded explain-back opens it (R7, MAT-6).
    expect(mastery.get(CONCEPT_B)?.state).toBe('sapling');

    const course = 'syn:course:test';
    const assessmentPath = 'syn:assessment:test:midterm';
    const edge = (conceptName: string) => ({
      conceptName,
      // `ol-63e1`: mirrors `conceptName` — this suite's concept "names" are
      // already opaque synthetic ids (`syn:concept:...`), the honest case
      // where the two coincide.
      conceptKey: conceptName,
      assessmentPath,
      course,
      yieldRank: 1,
      confidence: 0.8,
      citations: [],
    });
    const ranking = rankOracle({
      evidence: {
        edges: [edge(CONCEPT_A), edge(CONCEPT_B)],
        assessmentsRead: {
          records: [
            {
              path: assessmentPath,
              course,
              type: 'Test',
              weight: 50,
              weightRaw: '50',
              due: '2027-06-01',
              status: 'upcoming',
            },
          ],
          sourceFolders: [],
          notesScanned: [assessmentPath],
          notesWithoutFrontmatter: [],
          columns: [],
          unresolvedFields: [],
          unrecognizedColumns: [],
          configErrors: [],
        },
        assessmentsWithNoEvidence: [],
      },
      mastery,
      asOf: '2027-01-15',
    });

    const courseResult = ranking.courses.find((c) => c.course === course);
    if (courseResult?.status !== 'ranked') throw new Error('expected the course to rank');
    const priorityA = courseResult.ranked.find((p) => p.conceptName === CONCEPT_A);
    const priorityB = courseResult.ranked.find((p) => p.conceptName === CONCEPT_B);
    expect(priorityA).toBeDefined();
    expect(priorityB).toBeDefined();
    // The worked claim: worse mastery (three fails) outranks better mastery
    // (three passes) when every other evidence input is identical.
    expect(priorityA?.priorityScore ?? 0).toBeGreaterThan(priorityB?.priorityScore ?? 0);
  });
});

describe('claim: the interval shortens on a lapse and lengthens on a streak', () => {
  it('FSRS: a run of good ratings lengthens the interval; a subsequent lapse shortens the next one', () => {
    const scheduler = createFsrsScheduler();
    let state = null as ReturnType<typeof scheduler.schedule>['state'] | null;
    let now = Date.parse('2027-01-01T09:00:00.000Z');
    const intervalsDays: number[] = [];
    let previousDue = now;

    for (let i = 0; i < 5; i += 1) {
      const output = scheduler.schedule({
        instrumentId: 'syn:inst:test:qa',
        state,
        rating: 'good',
        now: new Date(now),
      });
      const due = Date.parse(output.state.due);
      intervalsDays.push((due - now) / 86_400_000);
      state = output.state;
      now = due; // review it exactly when it comes due, streak-style
      previousDue = due;
    }
    // Lengthens on a streak: each successive 'good' interval is at least as
    // long as the previous one, and strictly longer somewhere in the run.
    for (let i = 1; i < intervalsDays.length; i += 1) {
      expect(intervalsDays[i]).toBeGreaterThanOrEqual(intervalsDays[i - 1] as number);
    }
    expect(intervalsDays[intervalsDays.length - 1] ?? 0).toBeGreaterThan(intervalsDays[0] ?? 0);

    // Shortens on a lapse: the interval right after an 'again' is shorter
    // than the interval that was running immediately before it.
    const beforeLapseInterval = intervalsDays[intervalsDays.length - 1] as number;
    const lapseOutput = scheduler.schedule({
      instrumentId: 'syn:inst:test:qa',
      state,
      rating: 'again',
      now: new Date(previousDue),
    });
    const afterLapseIntervalDays = (Date.parse(lapseOutput.state.due) - previousDue) / 86_400_000;
    expect(afterLapseIntervalDays).toBeLessThan(beforeLapseInterval);
  });
});

describe('claim: exam proximity reweights as a date nears', () => {
  it("rankOracle's examProximityScore and priorityScore rise for melspar as asOf approaches the real assessment due date", () => {
    const world = buildWorld({
      persona: 'steady-reviewer',
      seed: 'proximity-spec',
      startDate: '2026-10-17',
      days: 90,
      deviceId: 'syn-laptop',
      utcOffset: '+00:00',
      assessmentDayOffsets: [42, 93],
    });
    // ASSESSMENT_VANTREL_MIDTERM's real due date (curriculum.ts) is
    // 2027-01-20 — never re-derived here, only asserted against with two
    // asOf values, one far from it and one close.
    const far = rankOracle({
      evidence: {
        edges: world.curriculum.edges,
        assessmentsRead: world.curriculum.assessmentsRead,
        assessmentsWithNoEvidence: world.curriculum.assessmentsWithNoEvidence,
      },
      mastery: new Map(),
      asOf: '2026-10-17',
    });
    const near = rankOracle({
      evidence: {
        edges: world.curriculum.edges,
        assessmentsRead: world.curriculum.assessmentsRead,
        assessmentsWithNoEvidence: world.curriculum.assessmentsWithNoEvidence,
      },
      mastery: new Map(),
      asOf: '2027-01-18',
    });

    const vantrelFar = far.courses.find((c) => c.course === 'syn:course:vantrel');
    const vantrelNear = near.courses.find((c) => c.course === 'syn:course:vantrel');
    if (vantrelFar?.status !== 'ranked' || vantrelNear?.status !== 'ranked') {
      throw new Error('expected vantrel to rank in both cases');
    }
    const melsparFar = vantrelFar.ranked.find((p) => p.conceptName === 'syn:concept:melspar');
    const melsparNear = vantrelNear.ranked.find((p) => p.conceptName === 'syn:concept:melspar');
    expect(melsparFar).toBeDefined();
    expect(melsparNear).toBeDefined();

    const midtermFar = melsparFar?.factors.contributions.find((c) =>
      c.assessmentPath.endsWith('midterm'),
    );
    const midtermNear = melsparNear?.factors.contributions.find((c) =>
      c.assessmentPath.endsWith('midterm'),
    );
    expect(midtermNear?.examProximityScore ?? 0).toBeGreaterThan(
      midtermFar?.examProximityScore ?? 1,
    );
    expect(melsparNear?.priorityScore ?? 0).toBeGreaterThan(melsparFar?.priorityScore ?? 0);
  });
});

describe('claim: a blackout date suppresses scheduling', () => {
  it("the generator emits zero events on every one of the lapsed-returner's declared blackout dates", () => {
    const spec: WorldSpec = {
      persona: 'lapsed-returner',
      seed: 'blackout-spec',
      startDate: '2027-02-01',
      days: 90,
      deviceId: 'syn-laptop',
      utcOffset: '+00:00',
      assessmentDayOffsets: [70],
    };
    const stream = generateStream(spec);
    expect(stream.groundTruth.blackoutDates.length).toBeGreaterThan(0);
    const eventDates = new Set(stream.entries.map((e) => e.timestamp.slice(0, 10)));
    for (const blackoutDay of stream.groundTruth.blackoutDates) {
      expect(eventDates.has(blackoutDay)).toBe(false);
    }
    // Negative control: an ORDINARY session date, just before the blackout,
    // DOES have events — proving the absence above is the blackout's doing,
    // not an empty stream generally.
    const beforeBlackout = stream.groundTruth.sessionDates.find(
      (d) => d < (stream.groundTruth.blackoutDates[0] as string),
    );
    expect(beforeBlackout).toBeDefined();
    expect(eventDates.has(beforeBlackout as string)).toBe(true);
  });
});

describe('claim: the gap view reports a concept uncovered when the fixture corpus genuinely does not cover it', () => {
  it('kelvane (assessment-cited, no note) reports material-gap; melspar (assessment-cited, note present) does not', async () => {
    const { deriveOracle } = await import('../src/oracle/derive.js');
    const world = buildWorld({
      persona: 'steady-reviewer',
      seed: 'coverage-spec',
      startDate: '2026-10-17',
      days: 90,
      deviceId: 'syn-laptop',
      utcOffset: '+00:00',
      assessmentDayOffsets: [42, 93],
    });
    const { result } = await deriveOracle({
      world,
      asOf: '2027-01-15',
      computedAt: '2027-01-15T09:15:00.000Z',
    });
    const vantrel = result.gap.courses.find((c) => c.course === 'syn:course:vantrel');
    if (vantrel?.status !== 'ranked') throw new Error('expected vantrel to rank');
    const byConcept = new Map(vantrel.rows.map((r) => [r.conceptName, r]));
    expect(byConcept.get('syn:concept:kelvane')?.gapClass).toBe('material-gap');
    expect(byConcept.get('syn:concept:melspar')?.gapClass).not.toBe('material-gap');
  });
});
