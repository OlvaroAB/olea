// Scenarios: ../../../../olea-service/features/F4-oracle.md, "C5.8 — one
// composed-session holder replaces the per-surface freeze" —
// @auto:plugin/session/holder.spec
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
