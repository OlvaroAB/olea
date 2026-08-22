// test/timeline.spec.ts — the day loop (`ol-opmb.5` [TB-4]) over a synthetic
// world, and the anti-degeneracy checks that would catch a flattened loop.

import { describe, expect, it } from 'vitest';
import { deriveClosedLoop } from '../src/oracle/derive.js';
import {
  addUtcDays,
  deriveOracleTimeline,
  masteryAdvancementOverTime,
  planVersionChangesOverTime,
  planVersionSeries,
  queueCompositionVaries,
  strugglingCourseReadsWorseByFinalDay,
  worldThroughDay,
} from '../src/oracle/timeline.js';
import { buildWorld, type WorldSpec } from '../src/synthetic-bridge.js';

function specFor(persona: WorldSpec['persona'], days = 90): WorldSpec {
  return {
    persona,
    seed: 'timeline-spec',
    startDate: '2026-10-17',
    days,
    deviceId: 'syn-laptop',
    utcOffset: '+00:00',
    assessmentDayOffsets: [42, 93],
  };
}

function computedAtFor(asOf: string): string {
  return `${asOf}T09:15:00.000Z`;
}

describe('addUtcDays', () => {
  it('advances the calendar day in UTC', () => {
    expect(addUtcDays('2026-10-17', 1)).toBe('2026-10-18');
    expect(addUtcDays('2026-10-17', 0)).toBe('2026-10-17');
    expect(addUtcDays('2026-10-17', -1)).toBe('2026-10-16');
    expect(addUtcDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('worldThroughDay', () => {
  it('truncates entries strictly, leaves curriculum, corpus and groundTruth untouched', () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const early = worldThroughDay(world, '2026-10-20');
    const late = worldThroughDay(world, '2027-05-01');

    expect(early.stream.entries.length).toBeLessThan(world.stream.entries.length);
    expect(late.stream.entries.length).toBe(world.stream.entries.length);
    expect(early.curriculum).toBe(world.curriculum);
    expect(early.corpus).toBe(world.corpus);
    expect(early.stream.groundTruth).toBe(world.stream.groundTruth);
    for (const entry of early.stream.entries) {
      expect(Date.parse(entry.timestamp)).toBeLessThanOrEqual(
        Date.parse('2026-10-20T23:59:59.999Z'),
      );
    }
  });

  it("INCLUDES throughDate's own events, not only events strictly before it (N-013: caught a real off-by-one — see the task report)", () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const someSessionDate = world.stream.groundTruth.sessionDates[5];
    if (someSessionDate === undefined) throw new Error('expected a session date');
    const truncated = worldThroughDay(world, someSessionDate);
    const onThatDay = truncated.stream.entries.filter(
      (e) => e.timestamp.slice(0, 10) === someSessionDate,
    );
    // A session date by definition has at least one entry; cutting at the
    // START of that day rather than its end would silently drop every one
    // of them, understating a full day's evidence at every step of the
    // timeline without any invariant elsewhere noticing (mastery still rises
    // in aggregate, the queue still varies, entries counted is still
    // monotonic — none of those coarse checks pin the exact boundary).
    expect(onThatDay.length).toBeGreaterThan(0);
  });
});

describe('deriveOracleTimeline', () => {
  it('produces one day per requested day, mastery growing monotonically in evidence count', async () => {
    const world = buildWorld(specFor('steady-reviewer', 30));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });

    expect(timeline.days).toHaveLength(30);
    expect(timeline.days[0]?.dayIndex).toBe(0);
    expect(timeline.days[0]?.entriesCounted).toBe(0);
    // Entries counted never goes down as the day index rises — a growing
    // prefix of a fixed, chronological stream.
    for (let i = 1; i < timeline.days.length; i += 1) {
      const prev = timeline.days[i - 1];
      const cur = timeline.days[i];
      expect(cur?.entriesCounted).toBeGreaterThanOrEqual(prev?.entriesCounted ?? 0);
    }
    // By the end of a 30-day steady-reviewer stream, SOME entries exist.
    expect(timeline.days[29]?.entriesCounted).toBeGreaterThan(0);
  });

  it('is deterministic: the same world and totalDays produce byte-identical plans and gaps', async () => {
    const world = buildWorld(specFor('steady-reviewer', 14));
    const a = await deriveOracleTimeline({ world, totalDays: 14, computedAtFor });
    const b = await deriveOracleTimeline({ world, totalDays: 14, computedAtFor });
    expect(JSON.stringify(a.days.map((d) => d.result.plan))).toBe(
      JSON.stringify(b.days.map((d) => d.result.plan)),
    );
    expect(JSON.stringify(a.days.map((d) => d.result.gap))).toBe(
      JSON.stringify(b.days.map((d) => d.result.gap)),
    );
  });

  it("nextDayEvents on day D are exactly the persona's real entries dated day D's asOf", async () => {
    const world = buildWorld(specFor('steady-reviewer', 10));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });
    for (const day of timeline.days) {
      for (const event of day.nextDayEvents) {
        const real = world.stream.entries.find((e) => e.eventId === event.eventId);
        expect(real).toBeDefined();
        expect(real?.timestamp.slice(0, 10)).toBe(day.asOf);
        // The real record's own planVersion stays null — this driver never
        // rewrites it (module doc). The association lives in the day result.
        if (real?.kind === 'review') {
          expect(real.selectionContext.planVersion).toBeNull();
        }
      }
    }
  });

  it("each day's queue composes at that day's own clock, not the workbench's fixed far-future now", async () => {
    const world = buildWorld(specFor('steady-reviewer', 5));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });
    // Day 0: nothing has ever been reviewed, so every world instrument is
    // either 'new' (not yet introduced -> absent) or unreachable — the
    // composed queue must not silently show items as 'overdue' relative to
    // some instant far in 2027; every queue candidate that IS offered on day
    // 0 must be dueState 'new'.
    const day0 = timeline.days[0];
    for (const item of day0?.result.queue.composed.items ?? []) {
      expect(item.selectionContext.dueState).toBe('new');
    }
  });

  it("queueNow is load-bearing on a MID-semester day, not only on day 0 (N-013: day 0's 'new'-only check above is vacuous for this specific mechanism, since a never-reviewed instrument is 'new' regardless of the clock)", async () => {
    const world = buildWorld(specFor('steady-reviewer', 60));
    const dayWorld = worldThroughDay(world, addUtcDays(world.spec.startDate, 49));
    const asOf = addUtcDays(world.spec.startDate, 50);
    const computedAt = computedAtFor(asOf);

    const atOwnClock = await deriveClosedLoop({
      world: dayWorld,
      asOf,
      computedAt,
      queueNow: `${asOf}T00:00:00.000Z`,
    });
    const atWorkbenchNow = await deriveClosedLoop({ world: dayWorld, asOf, computedAt }); // no override -> sessionInstant() -> WORKBENCH_NOW (2027-01-15), far past day 50

    const dueStatesAtOwnClock = atOwnClock.queue.composed.items.map(
      (i) => i.selectionContext.dueState,
    );
    const dueStatesAtWorkbenchNow = atWorkbenchNow.queue.composed.items.map(
      (i) => i.selectionContext.dueState,
    );
    // Composing at the day's own clock must not report the SAME due-state
    // multiset as composing at the workbench's fixed far-future instant —
    // if it does, `queueNow` has no effect and every earlier day would look
    // exactly as overdue as `WORKBENCH_NOW` makes it.
    expect(dueStatesAtOwnClock.sort()).not.toEqual(dueStatesAtWorkbenchNow.sort());
    // Concretely: composing at WORKBENCH_NOW (over ten weeks after day 50)
    // pushes reviewed instruments into 'overdue'; composing at day 50's own
    // clock should not show every offered item as overdue.
    expect(dueStatesAtOwnClock.every((s) => s === 'overdue')).toBe(false);
  });
});

describe('anti-degeneracy across time (Trap 2, extended)', () => {
  it('planVersionChangesOverTime: the plan actually moves for a steady reviewer across a semester', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });
    expect(planVersionSeries(timeline).length).toBeGreaterThan(1);
    expect(planVersionChangesOverTime(timeline)).toBe(true);
  });

  it('queueCompositionVaries: the composed queue is not a frozen set of instrument ids', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });
    expect(queueCompositionVaries(timeline)).toBe(true);
  });

  it('masteryAdvancementOverTime: mastery rises for a steady reviewer who practises every day', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });
    const advancement = masteryAdvancementOverTime(timeline);
    expect(advancement.nonDecreasing).toBe(true);
    expect(advancement.rose).toBe(true);
    expect(advancement.lastFraction).toBeGreaterThan(advancement.firstFraction);
  });

  it('strugglingCourseReadsWorseByFinalDay: holds for the struggler by the end of her semester', async () => {
    const world = buildWorld(specFor('struggler'));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });
    expect(strugglingCourseReadsWorseByFinalDay(timeline)).toBe(true);
  });

  it('empty-history: the queue never varies with zero evidence — the control that proves queueCompositionVaries is not vacuously true', async () => {
    const world = buildWorld(specFor('empty-history', 10));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });
    // No entries ever, so nothing is ever due or overdue and the same
    // candidates compose every day. This is the CONTROL for
    // queueCompositionVaries: it proves the check is not vacuously true for
    // every world, only for one whose evidence actually accumulates.
    expect(queueCompositionVaries(timeline)).toBe(false);
    const advancement = masteryAdvancementOverTime(timeline);
    expect(advancement.rose).toBe(false);
  });

  it('FINDING: planVersion moves even with zero review evidence, purely from exam-proximity decay — so planVersionChangesOverTime alone does not distinguish a responsive loop from a merely-ticking clock', async () => {
    const world = buildWorld(specFor('empty-history', 30));
    const timeline = await deriveOracleTimeline({ world, computedAtFor });
    // rank.ts's examProximityScore = 1 / (1 + daysUntilDue / halfLife) is a
    // continuous function of `asOf` alone, and buildStudyPlan hashes the
    // ranking's own scores — so the plan's content hash drifts daily even
    // when NO instrument has ever been reviewed. planVersionChangesOverTime
    // is therefore a weak, confounded check on its own: queueCompositionVaries
    // and masteryAdvancementOverTime (both false/flat above, for the SAME
    // empty-history world) are the checks that actually distinguish a live
    // loop from a flattened one. Kept as a descriptive series (what a plan
    // version changing over time actually looks like — the parent bead's own
    // ask) rather than promoted to a load-bearing degeneracy gate by itself.
    expect(planVersionChangesOverTime(timeline)).toBe(true);
  });
});
