// test/timeline-scenarios.spec.ts — the timeline surface's state builder
// (`ol-opmb.5` [TB-4]). Same scope note as `test/oracle.spec.ts`: rendering
// itself is checked by e2e; what is worth asserting without a DOM is that
// every advertised state builds, at more than one day, without throwing, and
// that the day-scrubber machinery (clamping, cache reuse, changed-stage
// detection) does what it claims.

import { describe, expect, it } from 'vitest';
import {
  buildTimelineScenario,
  DEFAULT_TIMELINE_DAY,
  findTimelineState,
  TIMELINE_STATES,
} from '../src/timeline-scenarios.js';

describe('TIMELINE_STATES', () => {
  it('every advertised state builds at the default day without throwing', async () => {
    for (const state of TIMELINE_STATES) {
      const scenario = await buildTimelineScenario(state.id, DEFAULT_TIMELINE_DAY);
      expect(scenario.dayIndex).toBe(DEFAULT_TIMELINE_DAY);
      expect(scenario.persona).toBe(state.persona);
      expect(scenario.totalDays).toBeGreaterThan(DEFAULT_TIMELINE_DAY);
    }
  });

  it('findTimelineState resolves every id TIMELINE_STATES advertises, and nothing else', () => {
    for (const state of TIMELINE_STATES) {
      expect(findTimelineState(state.id)).toBe(state);
    }
    expect(findTimelineState('not-a-real-id')).toBeUndefined();
  });
});

describe('buildTimelineScenario — the day scrubber', () => {
  it('clamps an out-of-range day into [0, totalDays - 1] rather than throwing', async () => {
    const tooHigh = await buildTimelineScenario('timeline-steady', 10_000);
    expect(tooHigh.dayIndex).toBe(tooHigh.totalDays - 1);
    const negative = await buildTimelineScenario('timeline-steady', -5);
    expect(negative.dayIndex).toBe(0);
  });

  it('day 0 reports no changed stages; a later day reports at least one', async () => {
    const day0 = await buildTimelineScenario('timeline-steady', 0);
    expect(day0.changedStages).toEqual([]);
    const later = await buildTimelineScenario('timeline-steady', 45);
    expect(later.changedStages.length).toBeGreaterThan(0);
  });

  it('reuses the cached timeline: two calls for the same persona return the SAME plan-version series', async () => {
    const a = await buildTimelineScenario('timeline-steady', 10);
    const b = await buildTimelineScenario('timeline-steady', 70);
    expect(a.planVersionSeries).toEqual(b.planVersionSeries);
  });

  it('reports the anti-degeneracy read directly, matching oracle/timeline.js for the same persona', async () => {
    const steady = await buildTimelineScenario('timeline-steady', DEFAULT_TIMELINE_DAY);
    expect(steady.antiDegeneracy.queueVaries).toBe(true);
    expect(steady.antiDegeneracy.masteryRose).toBe(true);
  });

  it('throws on an unknown state id, same discipline as oracle-scenarios.ts', async () => {
    await expect(buildTimelineScenario('not-a-real-id', 0)).rejects.toThrow();
  });
});
