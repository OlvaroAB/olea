// Scenarios: features/F2-review.md (olea-service), "Feature: F2.24 — Offering
// an application probe" — @auto:core/study-session/application-probe-trigger.spec
//
// Every concept id here is a structural placeholder. Nothing in this file is
// real vault vocabulary (INV-3).
import { describe, expect, it } from 'vitest';
import { MIN_SPACED_RETRIEVAL_DAYS } from '../mastery/rollup.js';
import {
  APPLICATION_PROBE_OFFER_LIVE,
  APPLICATION_PROBE_TRIGGER,
  type ApplicationProbeTriggerInput,
  applicationProbeOfferLine,
  evaluateApplicationProbeTrigger,
  PROBE_OFFER_FORBIDDEN_PHRASES,
} from './application-probe-trigger.js';
import { STRONG_RECALL_MARGIN_DAYS } from './strong-recall-proposal.js';

const STRONG_DAYS = MIN_SPACED_RETRIEVAL_DAYS + STRONG_RECALL_MARGIN_DAYS;

function input(
  overrides: Partial<ApplicationProbeTriggerInput> = {},
): ApplicationProbeTriggerInput {
  return {
    conceptId: 'concept-a',
    state: 'tree',
    vitality: 'holding',
    competingExplainBackTriggerHolds: false,
    earnedTopStageThisSession: false,
    alreadyOfferedThisSessionForConcept: false,
    ...overrides,
  };
}

/** Deep-freezes an object so any attempted mutation throws in strict mode (ESM modules are strict). */
function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    const record = value as unknown as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(record)) {
      deepFreeze(record[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('APPLICATION_PROBE_OFFER_LIVE — the spend/challenge-set gate', () => {
  it('is pinned false: this lane never enables live grading', () => {
    expect(APPLICATION_PROBE_OFFER_LIVE).toBe(false);
  });
});

describe('evaluateApplicationProbeTrigger — F2.24 [D-394]', () => {
  it('offers on first-offer: tree, holding, no competing trigger, not earned this session, never presented', () => {
    const decision = evaluateApplicationProbeTrigger(input());
    expect(decision.shouldOffer).toBe(true);
    if (!decision.shouldOffer) throw new Error('unreachable');
    expect(decision.conceptId).toBe('concept-a');
    expect(decision.trigger).toBe(APPLICATION_PROBE_TRIGGER);
    expect(decision.reason.kind).toBe('first-offer');
    expect(decision.promptText.length).toBeGreaterThan(0);
  });

  // [D-394]: "a test shows each part blocking the offer when false" — one
  // test per named gate, each starting from the otherwise-offering baseline.
  it('is silent below tree — F2.24 fires only at the top stage ([D-264] ruling 4)', () => {
    for (const state of ['seed', 'sprout', 'sapling'] as const) {
      const decision = evaluateApplicationProbeTrigger(input({ state }));
      expect(decision).toEqual({ shouldOffer: false, because: 'not-top-stage' });
    }
  });

  it('is silent when recall is not holding', () => {
    for (const vitality of ['tending', 'early'] as const) {
      const decision = evaluateApplicationProbeTrigger(input({ vitality }));
      expect(decision).toEqual({ shouldOffer: false, because: 'recall-not-holding' });
    }
  });

  it('is silent when a competing explain-back trigger holds (F2.12 / F2.21 reopening / F5.3a)', () => {
    const decision = evaluateApplicationProbeTrigger(
      input({ competingExplainBackTriggerHolds: true }),
    );
    expect(decision).toEqual({ shouldOffer: false, because: 'competing-trigger-active' });
  });

  it('is silent in the session that earned the top stage (brief 85, rejecting Choice 1 Option C)', () => {
    const decision = evaluateApplicationProbeTrigger(input({ earnedTopStageThisSession: true }));
    expect(decision).toEqual({ shouldOffer: false, because: 'earned-top-stage-this-session' });
  });

  it('is silent once already offered this session, taken or not — overrides every other gate', () => {
    const decision = evaluateApplicationProbeTrigger(
      input({
        alreadyOfferedThisSessionForConcept: true,
        // Otherwise a perfectly good repair case — proves the session gate is checked first.
        presentation: { succeeded: false, successfulScoredDaysSincePresentation: STRONG_DAYS },
      }),
    );
    expect(decision).toEqual({ shouldOffer: false, because: 'already-offered-this-session' });
  });

  it('recurs in a later session while the trigger holds — the flag is per-session, not permanent', () => {
    // "Later session" is modelled the only way a stateless caller can:
    // alreadyOfferedThisSessionForConcept reset to false. Nothing in this
    // module holds session identity, so there is no expiry to model beyond
    // that flag — the same reason it cannot "wear off" mid-session either
    // (see the next test).
    const decision = evaluateApplicationProbeTrigger(
      input({ alreadyOfferedThisSessionForConcept: false }),
    );
    expect(decision.shouldOffer).toBe(true);
  });

  it('an offered-but-untaken flag survives a session extension: nothing here resets it mid-session', () => {
    // A session "extension" has no field of its own in this input — by
    // construction, evaluateApplicationProbeTrigger reads
    // alreadyOfferedThisSessionForConcept exactly once and has no clock or
    // duration to react to, so the caller's own flag (unchanged across an
    // extension) is what keeps this silent for the rest of that session.
    const first = evaluateApplicationProbeTrigger(
      input({ alreadyOfferedThisSessionForConcept: true }),
    );
    const stillDuringExtendedSession = evaluateApplicationProbeTrigger(
      input({ alreadyOfferedThisSessionForConcept: true }),
    );
    expect(first).toEqual({ shouldOffer: false, because: 'already-offered-this-session' });
    expect(stillDuringExtendedSession).toEqual(first);
  });

  it('is silent when a probe was already presented and neither repair nor changed-claim conditions hold', () => {
    const decision = evaluateApplicationProbeTrigger(
      input({
        presentation: { succeeded: false, successfulScoredDaysSincePresentation: STRONG_DAYS - 1 },
      }),
    );
    expect(decision).toEqual({ shouldOffer: false, because: 'not-ready-to-rearm' });
  });

  it('is silent when the last presentation succeeded and nothing has changed since', () => {
    const decision = evaluateApplicationProbeTrigger(
      input({
        presentation: { succeeded: true, successfulScoredDaysSincePresentation: 0 },
      }),
    );
    expect(decision).toEqual({ shouldOffer: false, because: 'not-ready-to-rearm' });
  });

  it('re-arms on repair: the last presentation did not succeed and the strong-recall margin is re-met', () => {
    const decision = evaluateApplicationProbeTrigger(
      input({
        presentation: { succeeded: false, successfulScoredDaysSincePresentation: STRONG_DAYS },
      }),
    );
    expect(decision.shouldOffer).toBe(true);
    if (!decision.shouldOffer) throw new Error('unreachable');
    expect(decision.reason.kind).toBe('repair');
  });

  it("re-arms on [D-093]'s changed-claim event even without the margin re-met", () => {
    const decision = evaluateApplicationProbeTrigger(
      input({
        presentation: { succeeded: true, successfulScoredDaysSincePresentation: 0 },
        changedClaimEventSincePresentation: true,
      }),
    );
    expect(decision.shouldOffer).toBe(true);
    if (!decision.shouldOffer) throw new Error('unreachable');
    expect(decision.reason.kind).toBe('principle-changed');
  });

  it('reuses the strong-recall margin verbatim — no new constant', () => {
    const belowMargin = evaluateApplicationProbeTrigger(
      input({
        presentation: { succeeded: false, successfulScoredDaysSincePresentation: STRONG_DAYS - 1 },
      }),
    );
    const atMargin = evaluateApplicationProbeTrigger(
      input({
        presentation: { succeeded: false, successfulScoredDaysSincePresentation: STRONG_DAYS },
      }),
    );
    expect(belowMargin.shouldOffer).toBe(false);
    expect(atMargin.shouldOffer).toBe(true);
  });

  // [D-394] condition 2 / this module's doc: firing claims nothing and
  // writes nothing. Every input object is frozen; a function that ever
  // attempted to write back to state/vitality/evidence would throw here.
  it('claims no application ability and mutates nothing it was given', () => {
    const frozenInput = deepFreeze(
      input({
        presentation: deepFreeze({
          succeeded: false,
          successfulScoredDaysSincePresentation: STRONG_DAYS,
        }),
      }),
    );
    expect(() => evaluateApplicationProbeTrigger(frozenInput)).not.toThrow();
    const decision = evaluateApplicationProbeTrigger(frozenInput);
    expect(decision.shouldOffer).toBe(true);
    // The decision itself carries no stage/vitality/readiness field to write back.
    expect(decision).not.toHaveProperty('state');
    expect(decision).not.toHaveProperty('vitality');
    expect(decision).not.toHaveProperty('readiness');
  });

  it('throws on an empty conceptId, mirroring evaluateStrongRecallProposal', () => {
    expect(() => evaluateApplicationProbeTrigger(input({ conceptId: '' }))).toThrow();
  });
});

describe('applicationProbeOfferLine — vocabulary registry §14 offer-sentence guidance', () => {
  const reasons = [
    { kind: 'first-offer' as const },
    { kind: 'repair' as const },
    { kind: 'principle-changed' as const },
  ];

  it('never contains a forbidden phrase, for every reason kind', () => {
    for (const reason of reasons) {
      const line = applicationProbeOfferLine(reason).toLowerCase();
      for (const phrase of PROBE_OFFER_FORBIDDEN_PHRASES) {
        expect(line).not.toContain(phrase);
      }
    }
  });

  it("names the stage and vitality in the registry's own words", () => {
    const line = applicationProbeOfferLine({ kind: 'first-offer' });
    expect(line).toContain('tree');
    expect(line).toContain('holding');
  });

  it('asks whether she wants to try the idea, never previews or names a scenario', () => {
    for (const reason of reasons) {
      expect(applicationProbeOfferLine(reason)).toContain("situation your notes don't describe");
    }
  });

  it('a repair line follows an earlier attempt that missed, without naming that scenario ([D-217])', () => {
    const line = applicationProbeOfferLine({ kind: 'repair' });
    expect(line).toContain('follows one that missed');
  });
});
