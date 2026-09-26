// Scenarios: ../../../../olea-service/features/F4-oracle.md, "C5.8 — one
// composed-session holder replaces the per-surface freeze" —
// @auto:plugin/session/holder.spec
import { STUDY_PLAN_BODY_VERSION, type StudyPlanEnvelope } from 'olea-contracts';
import type { ComposedStudySession, DurationModelBasis, StudySessionModel } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createStudySessionHolder } from '../../src/session/holder.js';

const NOW = new Date('2026-09-07T12:00:00Z');
const LATER = new Date('2026-09-07T12:30:00Z');

/**
 * A structurally valid but content-free `ComposedStudySession` — every field
 * a distinct sitting can be told apart by is an override, everything else is
 * the smallest legal value. The holder never inspects a session's contents
 * (it only ever holds it by reference), so these fixtures assert identity,
 * never shape.
 */
function fakeComposedStudySession(
  overrides: Partial<ComposedStudySession> = {},
): ComposedStudySession {
  const model: StudySessionModel = {
    asOf: '2026-09-07',
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
    ...overrides,
  };
}

function noTrigger(day = '2026-09-07') {
  return {
    lastRebuiltDay: day,
    today: day,
    materialLandedSinceLastRebuild: false,
    assessmentDatePassedSinceLastRebuild: false,
  } as const;
}

function noStaleness() {
  return {
    itemsDueInScope: false,
    materialArrivedInScope: false,
    assessmentProximityBandCrossedInScope: false,
  } as const;
}

describe('createStudySessionHolder', () => {
  it('starts idle, with no memory of a prior process', () => {
    const holder = createStudySessionHolder();
    expect(holder.getSitting()).toEqual({ status: 'idle' });
  });

  it('entering a sitting holds the exact session handed to it, by reference', () => {
    const holder = createStudySessionHolder();
    const session = fakeComposedStudySession();

    holder.enter(NOW, session);

    const sitting = holder.getSitting();
    expect(sitting.status).toBe('active');
    if (sitting.status !== 'active') throw new Error('unreachable');
    expect(sitting.items).toBe(session); // same reference, never a copy
    expect(sitting.enteredAt).toBe(NOW);
  });

  it('exiting releases the freeze', () => {
    const holder = createStudySessionHolder();
    holder.enter(NOW, fakeComposedStudySession());

    holder.exit();

    expect(holder.getSitting()).toEqual({ status: 'idle' });
  });

  it('re-entering mid-sitting replaces the held session — the caller chose to start a new one', () => {
    const holder = createStudySessionHolder();
    const first = fakeComposedStudySession({ forcedCourses: ['course-a'] });
    const second = fakeComposedStudySession({ forcedCourses: ['course-b'] });

    holder.enter(NOW, first);
    holder.enter(LATER, second);

    const sitting = holder.getSitting();
    expect(sitting.status).toBe('active');
    if (sitting.status !== 'active') throw new Error('unreachable');
    expect(sitting.items).toBe(second);
    expect(sitting.enteredAt).toBe(LATER);
  });

  it('deciding while idle answers from the between-sittings trigger set, and touches no state', () => {
    const holder = createStudySessionHolder();

    const decision = holder.decide({
      now: NOW,
      trigger: { ...noTrigger(), materialLandedSinceLastRebuild: true },
      staleness: noStaleness(),
    });

    expect(decision).toEqual({ action: 'rebuild', reasons: ['material-landed'] });
    // Deciding is not acting: the holder is still idle until the caller calls `enter`.
    expect(holder.getSitting()).toEqual({ status: 'idle' });
  });

  it('deciding while active and fresh holds, without recomposing', () => {
    const holder = createStudySessionHolder();
    const session = fakeComposedStudySession();
    holder.enter(NOW, session);

    const decision = holder.decide({
      now: NOW, // no time has passed — well inside the idle threshold
      trigger: noTrigger(),
      staleness: { ...noStaleness(), itemsDueInScope: true }, // would matter only once idle-threshold has passed
    });

    expect(decision).toEqual({ action: 'hold' });
    const sitting = holder.getSitting();
    expect(sitting.status).toBe('active');
    if (sitting.status !== 'active') throw new Error('unreachable');
    expect(sitting.items).toBe(session); // deciding never swaps the held session
  });

  it('deciding while active, past the idle threshold, with a material change reports sitting-stale but does not end the sitting itself', () => {
    const holder = createStudySessionHolder();
    const session = fakeComposedStudySession();
    holder.enter(NOW, session);

    const pastIdleThreshold = new Date(NOW.getTime() + 20 * 60_000); // > DEFAULT_SITTING_IDLE_THRESHOLD_MS (15 min)
    const decision = holder.decide({
      now: pastIdleThreshold,
      trigger: noTrigger(),
      staleness: { ...noStaleness(), itemsDueInScope: true },
    });

    expect(decision).toEqual({ action: 'sitting-stale', reasons: ['items-due-in-scope'] });
    // Acting on the decision — ending the sitting, composing a fresh one — stays the caller's job.
    const sitting = holder.getSitting();
    expect(sitting.status).toBe('active');
    if (sitting.status !== 'active') throw new Error('unreachable');
    expect(sitting.items).toBe(session);
  });
});

// Scenarios: ../../../../olea-service/docs/dev/intelligence-build/chg.md,
// "3.6 staleness" — @auto:plugin/session/holder.spec
describe("materialChangedInScopeSinceFreeze — [ILB-CHG-4]'s 3.6 staleness fact (ol-egov.141.89.5.4)", () => {
  it('answers false while idle — nothing frozen to compare against', () => {
    const holder = createStudySessionHolder();
    expect(holder.materialChangedInScopeSinceFreeze(new Set(['inst-1']))).toBe(false);
  });

  it('answers false when the current pending set matches what was frozen at enter() — nothing changed since', () => {
    const holder = createStudySessionHolder();
    holder.enter(
      NOW,
      fakeComposedStudySession({ citationRevalidationPending: new Set(['inst-1']) }),
    );

    expect(holder.materialChangedInScopeSinceFreeze(new Set(['inst-1']))).toBe(false);
  });

  it('answers true when an instrument is pending now but was not pending at freeze time', () => {
    const holder = createStudySessionHolder();
    holder.enter(
      NOW,
      fakeComposedStudySession({ citationRevalidationPending: new Set(['inst-1']) }),
    );

    expect(holder.materialChangedInScopeSinceFreeze(new Set(['inst-1', 'inst-2']))).toBe(true);
  });

  it('answers false when an instrument resolved out of pending since the freeze — losing a pending mark is not a staleness signal', () => {
    const holder = createStudySessionHolder();
    holder.enter(
      NOW,
      fakeComposedStudySession({ citationRevalidationPending: new Set(['inst-1', 'inst-2']) }),
    );

    expect(holder.materialChangedInScopeSinceFreeze(new Set(['inst-1']))).toBe(false);
  });

  it('a fresh enter() resets the frozen comparison point to the new sitting\'s own pending set', () => {
    const holder = createStudySessionHolder();
    holder.enter(
      NOW,
      fakeComposedStudySession({ citationRevalidationPending: new Set(['inst-1']) }),
    );
    holder.enter(
      LATER,
      fakeComposedStudySession({ citationRevalidationPending: new Set(['inst-9']) }),
    );

    // inst-1 was pending for the FIRST sitting only; the second sitting froze with inst-9 already pending.
    expect(holder.materialChangedInScopeSinceFreeze(new Set(['inst-9']))).toBe(false);
    expect(holder.materialChangedInScopeSinceFreeze(new Set(['inst-1', 'inst-9']))).toBe(true);
  });

  it('exit() clears the freeze, so the next check answers false until a fresh enter()', () => {
    const holder = createStudySessionHolder();
    holder.enter(
      NOW,
      fakeComposedStudySession({ citationRevalidationPending: new Set(['inst-1']) }),
    );
    holder.exit();

    expect(holder.materialChangedInScopeSinceFreeze(new Set(['inst-1', 'inst-2']))).toBe(false);
  });
});

/** A structurally valid, content-free `StudyPlanEnvelope` — the holder never reads inside it, only holds it by reference, so only `policyVersion` needs to differ between fixtures. */
function fakePlan(policyVersion: string): StudyPlanEnvelope {
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: STUDY_PLAN_BODY_VERSION,
    policyVersion,
    computedAt: '2026-09-07T09:00:00-04:00',
    freshForSeconds: 3600,
    governsForSeconds: 86_400,
    body: { asOf: '2026-09-07', courses: [] },
  };
}

// Scenarios: ../../../../olea-service/features/F2-review.md, "C5.8 — the
// session holds still" — @auto:plugin/session/holder.spec
describe("resolveCompositionPlan — C5.8/[D-193]'s freeze extended to the plan a sitting is joined against (ol-egov.141.89.10.45)", () => {
  it('enter with a plan captures it; later candidates are ignored for the rest of that sitting', () => {
    const holder = createStudySessionHolder();
    const captured = fakePlan('sp1-captured');
    holder.enter(NOW, fakeComposedStudySession(), captured);

    expect(holder.resolveCompositionPlan(fakePlan('sp1-live-later'))).toBe(captured);
    expect(holder.resolveCompositionPlan(null)).toBe(captured);
  });

  it('enter with plan omitted (e.g. a caller outside this package, like main.ts Start) leaves nothing captured; the first later call captures lazily and freezes', () => {
    const holder = createStudySessionHolder();
    holder.enter(NOW, fakeComposedStudySession());

    const firstRead = fakePlan('sp1-first-read');
    expect(holder.resolveCompositionPlan(firstRead)).toBe(firstRead);
    // A later candidate — the live plan having since refreshed — is ignored.
    expect(holder.resolveCompositionPlan(fakePlan('sp1-refreshed'))).toBe(firstRead);
  });

  it('enter with plan explicitly null captures the honest "no plan" reading, never falls back to a later candidate', () => {
    const holder = createStudySessionHolder();
    holder.enter(NOW, fakeComposedStudySession(), null);

    expect(holder.resolveCompositionPlan(fakePlan('sp1-live'))).toBeNull();
  });

  it('growActiveSitting (the [SESS-8.6] outrun path) leaves the captured plan untouched', () => {
    const holder = createStudySessionHolder();
    const captured = fakePlan('sp1-captured');
    holder.enter(NOW, fakeComposedStudySession(), captured);

    holder.growActiveSitting(NOW, fakeComposedStudySession({ forcedCourses: ['course-a'] }));

    expect(holder.resolveCompositionPlan(fakePlan('sp1-live'))).toBe(captured);
    const sitting = holder.getSitting();
    expect(sitting.status).toBe('active');
    if (sitting.status !== 'active') throw new Error('unreachable');
    expect(sitting.items.forcedCourses).toEqual(['course-a']);
  });

  it('a fresh enter() resets a previously captured plan — a new sitting captures its own', () => {
    const holder = createStudySessionHolder();
    holder.enter(NOW, fakeComposedStudySession(), fakePlan('sp1-first-sitting'));

    holder.enter(LATER, fakeComposedStudySession());

    const secondSitting = fakePlan('sp1-second-sitting');
    expect(holder.resolveCompositionPlan(secondSitting)).toBe(secondSitting);
  });

  it('exit() clears the captured plan, so the next sitting starts uncaptured', () => {
    const holder = createStudySessionHolder();
    holder.enter(NOW, fakeComposedStudySession(), fakePlan('sp1-first-sitting'));
    holder.exit();

    holder.enter(LATER, fakeComposedStudySession());
    const nextSitting = fakePlan('sp1-next-sitting');
    expect(holder.resolveCompositionPlan(nextSitting)).toBe(nextSitting);
  });
});
