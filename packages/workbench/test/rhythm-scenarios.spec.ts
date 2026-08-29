// test/rhythm-scenarios.spec.ts — RHY-3's multicourse composition (`ol-i0zw`),
// asserted against the REAL fixture vault plus the one synthetic calendar
// note this surface overlays on top of it (`../src/vault/single-file-
// overlay.ts`). Same split every other real-vault scenario builder in this
// package takes (`session-scenarios.spec.ts`, `fixture-oracle.spec.ts`): a
// `FolderSource` over `packages/core/fixtures/vault`, the identical bytes
// `loadFixtureVault()` fetches in the browser.
//
// What is worth asserting without a DOM: that `discoverScheduleEvents` finds
// the overlaid note and nothing else, that `computeScheduleFreshness` reaches
// the exact per-course status this file's own module doc claims for each
// variant (checked once, live, against `computeCourseFreshness` before this
// suite was written — see the bead's report), and that `composeRhythmPanel`
// applies RHY-3-multicourse-composition.md §4's collapse rule correctly at
// 0/1/2+ flagged courses. Rendering itself is checked by e2e.

import { fileURLToPath } from 'node:url';
import { FolderSource } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildRhythmScenario,
  composeRhythmPanel,
  findRhythmState,
  RHYTHM_STATES,
} from '../src/rhythm-scenarios.js';

const vault = new FolderSource(
  fileURLToPath(new URL('../../core/fixtures/vault', import.meta.url)),
);

describe('RHYTHM_STATES', () => {
  it('every advertised state builds against the real fixture vault without throwing', async () => {
    for (const state of RHYTHM_STATES) {
      const scenario = await buildRhythmScenario(state.id, vault);
      expect(scenario.state).toBe(state);
      // The overlay adds exactly one note, and it is the only candidate note
      // this vault produces — the base fixture vault has no calendar-events
      // note of its own (the module doc's whole reason for the overlay).
      expect(scenario.discovery.candidateNotes).toHaveLength(1);
      expect(scenario.discovery.candidateNotes[0]?.path).toBe('06 Calendar/Calendar events.md');
      // Both course labels associate against the real `01 Courses/` roster —
      // no unmatched events, since GEOL204/MUSTH104 are the vault's own codes.
      expect(scenario.association.unmatched).toHaveLength(0);
    }
  });

  it('rhythm-two-flagged reaches state D — GEOL204 with a yardstick, MUSTH104 without one', async () => {
    const scenario = await buildRhythmScenario('rhythm-two-flagged', vault);
    const byCourse = new Map(scenario.readings.map((r) => [r.courseCode, r]));

    const geol204 = byCourse.get('GEOL204');
    expect(geol204?.status).toBe('not-arrived-with-yardstick');
    expect(geol204?.basis).toBe('observed');
    expect(geol204?.expectedSessionDate).toBe('2027-01-11');

    const musth104 = byCourse.get('MUSTH104');
    expect(musth104?.status).toBe('not-arrived-no-yardstick');
    expect(musth104?.expectedSessionDate).toBeUndefined();

    // Two flagged courses is exactly where §4.3's collapse fires.
    expect(scenario.panel.kind).toBe('composed');
    expect(scenario.panel.rows.map((row) => row.courseCode)).toEqual(['GEOL204', 'MUSTH104']);
    expect(scenario.panel.factLine).toBe(
      "This week's material hasn't landed yet for GEOL204 or MUSTH104.",
    );
    expect(scenario.panel.consequenceLine).not.toBeNull();
    expect(scenario.panel.mitigationLine).not.toBeNull();
    expect(scenario.panel.footerLine).not.toBeNull();
  });

  it('rhythm-one-flagged degrades to a single row — MUSTH104 reads arrived and drops out (§4.2)', async () => {
    const scenario = await buildRhythmScenario('rhythm-one-flagged', vault);
    const byCourse = new Map(scenario.readings.map((r) => [r.courseCode, r]));

    expect(byCourse.get('GEOL204')?.status).toBe('not-arrived-with-yardstick');
    expect(byCourse.get('MUSTH104')?.status).toBe('arrived');

    expect(scenario.panel.kind).toBe('single');
    expect(scenario.panel.rows.map((row) => row.courseCode)).toEqual(['GEOL204']);
    // §4.2 — no composition question at 1 flagged course: no consequence or
    // mitigation sentence, only the fact and the (still reused) footer.
    expect(scenario.panel.consequenceLine).toBeNull();
    expect(scenario.panel.mitigationLine).toBeNull();
    expect(scenario.panel.footerLine).not.toBeNull();
  });

  it('unknown state id throws, same discipline as every other scenario builder', async () => {
    await expect(buildRhythmScenario('not-a-real-state', vault)).rejects.toThrow(
      /unknown rhythm state/,
    );
    expect(findRhythmState('not-a-real-state')).toBeUndefined();
  });
});

describe('composeRhythmPanel', () => {
  it('§4.5 — zero flagged courses stays silent, not a positive "all clear"', () => {
    const panel = composeRhythmPanel(
      [
        {
          courseCode: 'GEOL204',
          status: 'arrived',
          expectedSessionDate: undefined,
          basis: undefined,
          reason: 'r',
        },
      ],
      new Map(),
    );
    expect(panel.kind).toBe('nothing-to-report');
    expect(panel.rows).toHaveLength(0);
    expect(panel.factLine).toBeNull();
  });

  it('names three or more flagged courses with a comma list and a trailing "or" (V6 — no bare count)', () => {
    const reading = (course: string) =>
      ({
        courseCode: course,
        status: 'not-arrived-no-yardstick' as const,
        expectedSessionDate: undefined,
        basis: undefined,
        reason: 'r',
      }) as const;
    const panel = composeRhythmPanel(
      [reading('MUSTH104'), reading('GEOL204'), reading('ZOOL101')],
      new Map(),
    );
    expect(panel.kind).toBe('composed');
    // Alphabetical fallback ordering (§4.4) — see rhythm-scenarios.ts's module
    // doc for why this vault's real assessment dates are not used instead.
    expect(panel.rows.map((row) => row.courseCode)).toEqual(['GEOL204', 'MUSTH104', 'ZOOL101']);
    expect(panel.factLine).toBe(
      "This week's material hasn't landed yet for GEOL204, MUSTH104 or ZOOL101.",
    );
  });
});
