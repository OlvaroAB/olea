/**
 * `computeSharedSittingStaleness` tests (`ol-egov.141.89.10.14`, C5.8,
 * `[D-162]`, `[D-193]`/`[D-241]`).
 *
 * `ol-egov.141.89.10.14` found `main.ts`'s `enterStudySessionHolderForStart`
 * passed the shared session holder a literal `{ itemsDueInScope: false,
 * materialArrivedInScope: false, assessmentProximityBandCrossedInScope:
 * false }` on every call — "honest zeros mean this can only ever decide
 * 'hold'." `main.ts` cannot be imported under Vitest at all (it imports
 * `obsidian`; see `test/main-wiring.spec.ts`'s own module doc), so the wiring
 * logic that replaces those literal `false`s — more than a plain call, per
 * that bead's own instruction — was pulled out into `session/shared-sitting-
 * staleness.ts`'s `computeSharedSittingStaleness`, which this suite drives
 * directly.
 *
 * This is the behavioural half `test/main-wiring.spec.ts`'s
 * `ol-egov.141.89.10.14` describe block names: what she experiences is a
 * Start-entered sitting now ending when one of the three ruled conditions
 * fires (`C5.8`), exactly as a session-builder sitting already does — this
 * is ruled behaviour, not new. Each scenario below drives the real
 * `StudySessionHolder` (`session/holder.ts`) end to end: `enter` a sitting,
 * compute staleness for a later re-entry via `computeSharedSittingStaleness`,
 * feed it to the holder's own `decide`, and confirm the production reaction
 * (`exit()` on `'sitting-stale'`, nothing on `'hold'`) actually ends or
 * holds the sitting.
 *
 * Every identifier below (course/concept/note names) is invented, per INV-3.
 */
import type { ComposedStudySession, DurationModelBasis, StudySessionModel } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { computeSharedSittingStaleness } from '../../src/session/shared-sitting-staleness.js';
import {
  buildScopeSnapshotAt,
  type FrozenScopeConcept,
  type FrozenSittingScope,
} from '../../src/session-builder/provider.js';

/** Matches `test/session/holder.spec.ts`'s own fixture — the holder never inspects a session's contents, only holds it by reference. */
function fakeComposedStudySession(): ComposedStudySession {
  const model: StudySessionModel = {
    asOf: '2026-08-03',
    budgetMinutes: 20,
    budgetSeconds: 1200,
    plannedSeconds: 0,
    items: [],
    leftOut: [],
    leftOutInstrumentCount: 0,
    consideredRowCount: 0,
    formatPreference: 'unknown',
    nextAssessment: null,
    durationBasis: 'assumed' as DurationModelBasis,
    focusConcept: null,
  };
  return {
    model,
    overflow: [],
    courseShares: new Map(),
    forcedCourses: [],
    obligationClasses: new Map(),
    citationRecheckQueued: new Set(),
    citationRevalidationPending: new Set(),
  };
}

function noTrigger(day: string) {
  return {
    lastRebuiltDay: day,
    today: day,
    materialLandedSinceLastRebuild: false,
    assessmentDatePassedSinceLastRebuild: false,
  } as const;
}

// The exact fixture `test/session-builder/scope-snapshot.spec.ts` (`ol-
// egov.141.89.10.46`) uses for its own "a real due-date crossing, not a
// fabricated one" concept: `sprout`'s baseline gap is 5 days
// (RETRIEVAL_BASELINE_STAGE_LADDER_DAYS), so a concept last retrieved
// 2026-08-01 comes due 2026-08-06 — after ENTERED_DAY below, on or before
// LATER_DAY.
const CONCEPTS: readonly FrozenScopeConcept[] = [
  {
    conceptKey: 'concept-a',
    notePaths: ['Course A/note-a.md'],
    masteryState: 'sprout',
    lastRetrievalDay: '2026-08-01',
    recallDueDay: null,
  },
];
const SCOPE: FrozenSittingScope = { concepts: CONCEPTS, assessments: [] };

const ENTERED_AT = new Date('2026-08-03T12:00:00Z');
const ENTERED_DAY = '2026-08-03';
// Past both DEFAULT_SITTING_IDLE_THRESHOLD_MS (15 min) and concept-a's due day.
const LATER_NOW = new Date('2026-08-15T12:00:00Z');
const LATER_DAY = '2026-08-15';

describe('computeSharedSittingStaleness — the shared holder’s own real staleness facts', () => {
  it('a material change (a concept coming due in the sitting’s own scope) ends the held sitting at the next entry', async () => {
    const holder = createStudySessionHolder();
    holder.enter(ENTERED_AT, fakeComposedStudySession());
    const initialSnapshot = await buildScopeSnapshotAt(SCOPE, ENTERED_DAY);

    const staleness = await computeSharedSittingStaleness(
      { frozenScope: SCOPE, frozenSnapshot: initialSnapshot },
      ENTERED_AT,
      LATER_NOW,
    );
    expect(staleness).toEqual({
      itemsDueInScope: true,
      materialArrivedInScope: false,
      assessmentProximityBandCrossedInScope: false,
    });

    const decision = holder.decide({
      now: LATER_NOW,
      trigger: noTrigger(LATER_DAY),
      staleness,
    });
    expect(decision).toEqual({ action: 'sitting-stale', reasons: ['items-due-in-scope'] });

    // `main.ts`'s `enterStudySessionHolderForStart`: `'sitting-stale'` exits
    // the holder ([D-162] — the sitting ENDS, never a recompose in place).
    // Mirrored here so this test proves the sitting actually ends, not just
    // that `decide` reported it should.
    holder.exit();
    expect(holder.getSitting()).toEqual({ status: 'idle' });
  });

  it('no material change holds the sitting at the next entry', async () => {
    const holder = createStudySessionHolder();
    const session = fakeComposedStudySession();
    holder.enter(ENTERED_AT, session);
    const initialSnapshot = await buildScopeSnapshotAt(SCOPE, ENTERED_DAY);

    // Re-checked well past the idle threshold, but nothing in scope has
    // moved (same day, same frozen scope, no firstSeen reads answering).
    const stillEnteredDay = new Date(ENTERED_AT.getTime() + 20 * 60_000);
    const staleness = await computeSharedSittingStaleness(
      { frozenScope: SCOPE, frozenSnapshot: initialSnapshot },
      ENTERED_AT,
      stillEnteredDay,
    );
    expect(staleness).toEqual({
      itemsDueInScope: false,
      materialArrivedInScope: false,
      assessmentProximityBandCrossedInScope: false,
    });

    const decision = holder.decide({
      now: stillEnteredDay,
      trigger: noTrigger(ENTERED_DAY),
      staleness,
    });
    expect(decision).toEqual({ action: 'hold' });

    const sitting = holder.getSitting();
    expect(sitting.status).toBe('active');
    if (sitting.status !== 'active') throw new Error('unreachable');
    expect(sitting.items).toBe(session); // still the same held sitting — never swapped
  });

  it('stays honest zeros before the idle threshold, regardless of scope', async () => {
    const initialSnapshot = await buildScopeSnapshotAt(SCOPE, ENTERED_DAY);
    const justEntered = new Date(ENTERED_AT.getTime() + 60_000); // 1 minute — well under 15

    const staleness = await computeSharedSittingStaleness(
      { frozenScope: SCOPE, frozenSnapshot: initialSnapshot },
      ENTERED_AT,
      justEntered,
    );
    expect(staleness).toEqual({
      itemsDueInScope: false,
      materialArrivedInScope: false,
      assessmentProximityBandCrossedInScope: false,
    });
  });

  it('reports honest zeros when nothing has been frozen yet, even past the threshold', async () => {
    const staleness = await computeSharedSittingStaleness(
      { frozenScope: undefined, frozenSnapshot: undefined },
      ENTERED_AT,
      LATER_NOW,
    );
    expect(staleness).toEqual({
      itemsDueInScope: false,
      materialArrivedInScope: false,
      assessmentProximityBandCrossedInScope: false,
    });
  });
});
