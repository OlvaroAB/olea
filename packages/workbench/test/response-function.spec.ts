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
    schemaVersion: 4,
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

describe('claim: mastery falls after a wrong and recovers more slowly than it fell', () => {
  it('one lapse demotes the state in a single event; regaining it needs more events than that', () => {
    // recentWindowSize=4 (below default 5) makes the arithmetic exact and
    // legible: reach 'yours' with 4 correct qa reviews on 4 distinct days,
    // demote it with exactly ONE wrong review, then count how many
    // subsequent correct reviews (on new distinct days) it takes to regain
    // 'yours'. See the module doc's worked derivation in the task report.
    const options = { recentWindowSize: 4 };
    const days = [
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
      '2027-01-05', // the lapse
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

    for (let i = 0; i < 4; i += 1) {
      entries.push(
        reviewEntry({
          eventId: nextId(),
          conceptId: CONCEPT_A,
          day: days[i] as string,
          rating: 'good',
        }),
      );
    }
    let mastery = computeAllConceptMastery(entries, [CONCEPT_A], options);
    expect(mastery.get(CONCEPT_A)?.state).toBe('yours');

    // The fall: one wrong review, one event.
    entries.push(
      reviewEntry({
        eventId: nextId(),
        conceptId: CONCEPT_A,
        day: days[4] as string,
        rating: 'again',
      }),
    );
    mastery = computeAllConceptMastery(entries, [CONCEPT_A], options);
    expect(mastery.get(CONCEPT_A)?.state).not.toBe('yours');
    expect(mastery.get(CONCEPT_A)?.state).toBe('coming');

    // The recovery: keep adding correct reviews on new days until 'yours'
    // returns, and assert that took MORE than the one event the fall took.
    let recoveredAfter = 0;
    for (let i = 5; i < days.length; i += 1) {
      entries.push(
        reviewEntry({
          eventId: nextId(),
          conceptId: CONCEPT_A,
          day: days[i] as string,
          rating: 'good',
        }),
      );
      recoveredAfter += 1;
      mastery = computeAllConceptMastery(entries, [CONCEPT_A], options);
      if (mastery.get(CONCEPT_A)?.state === 'yours') break;
    }
    expect(mastery.get(CONCEPT_A)?.state).toBe('yours');
    expect(recoveredAfter).toBeGreaterThan(1); // recovery took more events than the one-event fall
    expect(recoveredAfter).toBe(4); // exactly the window size, on this construction
  });
});

describe('claim: a concept failed twice outranks one passed twice (equal evidence otherwise)', () => {
  it('rankOracle ranks the failed concept above the passed one when everything else about their evidence is equal', () => {
    const entriesA: ReviewLogEntry[] = [
      reviewEntry({ eventId: 'a1', conceptId: CONCEPT_A, day: '2027-01-01', rating: 'again' }),
      reviewEntry({ eventId: 'a2', conceptId: CONCEPT_A, day: '2027-01-02', rating: 'again' }),
    ];
    const entriesB: ReviewLogEntry[] = [
      reviewEntry({ eventId: 'b1', conceptId: CONCEPT_B, day: '2027-01-01', rating: 'good' }),
      reviewEntry({ eventId: 'b2', conceptId: CONCEPT_B, day: '2027-01-02', rating: 'good' }),
    ];
    const mastery = computeAllConceptMastery([...entriesA, ...entriesB], [CONCEPT_A, CONCEPT_B]);
    expect(mastery.get(CONCEPT_A)?.state).toBe('shaky'); // twice failed: the floor once evidence exists
    // Twice passed on only 2 distinct days (< minSpacedDays 3) caps below 'solid'.
    expect(['coming', 'shaky']).toContain(mastery.get(CONCEPT_B)?.state);

    const course = 'syn:course:test';
    const assessmentPath = 'syn:assessment:test:midterm';
    const edge = (conceptName: string) => ({
      conceptName,
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
    // The worked claim: worse mastery (two fails) outranks better mastery
    // (two passes) when every other evidence input is identical.
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
