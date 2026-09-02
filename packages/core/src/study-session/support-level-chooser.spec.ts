import { describe, expect, it } from 'vitest';
import type { SessionSupportOutcome } from '../support-level/types.js';
import { chooseSupportLevel, supportLevelStateFromHistory } from './support-level-chooser.js';

function outcome(overrides: Partial<SessionSupportOutcome> = {}): SessionSupportOutcome {
  return { failureShape: 'none', hintUptake: false, ...overrides };
}

describe('chooseSupportLevel — cold start (thin evidence)', () => {
  it("offers prompted, not independent, on no history at all — [D-094]'s cold start, errs toward offering", () => {
    expect(chooseSupportLevel([])).toEqual({ level: 'prompted', provenance: 'evidence-thin' });
  });
});

describe('chooseSupportLevel — recession is evidence-gated, never a timer', () => {
  it('recedes to independent only after two consecutive clean unhinted sessions', () => {
    expect(chooseSupportLevel([outcome()])).toEqual({
      level: 'prompted',
      provenance: 'evidence-thin',
    });
    expect(chooseSupportLevel([outcome(), outcome()])).toEqual({
      level: 'independent',
      provenance: 'not-offered',
    });
  });

  it('a hinted-but-clean session freezes the level rather than counting toward recession', () => {
    const history = [outcome({ hintUptake: true }), outcome({ hintUptake: true })];
    expect(chooseSupportLevel(history)).toEqual({ level: 'prompted', provenance: 'evidence-thin' });
  });
});

describe('chooseSupportLevel — escalation is fast (thinness)', () => {
  it('one blank or wrong-concept failure is enough to raise the level, even from a long clean run', () => {
    const longCleanRun = Array.from({ length: 10 }, () => outcome());
    const state = supportLevelStateFromHistory(longCleanRun);
    expect(state.level).toBe('independent');

    const withOneFailure = [...longCleanRun, outcome({ failureShape: 'wrong-concept' })];
    expect(chooseSupportLevel(withOneFailure)).toEqual({
      level: 'prompted',
      provenance: 'evidence-thin',
    });
  });

  it('a minor slip alone never escalates', () => {
    expect(chooseSupportLevel([outcome({ failureShape: 'minor-slip' })])).toEqual({
      level: 'prompted',
      provenance: 'evidence-thin',
    });
  });
});

describe('chooseSupportLevel — self-assessment: may only ever raise the offer, and touches no recorded state', () => {
  it('"unsure" raises the offered level above the evidence-derived one, for this call only', () => {
    expect(chooseSupportLevel([], 'unsure')).toEqual({
      level: 'guided',
      provenance: 'self-requested',
    });
  });

  it('"confident" never lowers the offer below what the evidence earned', () => {
    // One escalation-triggering failure from cold start ('prompted') jumps
    // straight to 'guided' — the ladder has only three tiers, so there is no
    // intermediate rung between them. The point under test is that
    // 'confident' does not pull it back down to 'prompted' or 'independent'.
    const withOneFailure = [outcome({ failureShape: 'wrong-concept' })];
    expect(supportLevelStateFromHistory(withOneFailure).level).toBe('guided');
    expect(chooseSupportLevel(withOneFailure, 'confident')).toEqual({
      level: 'guided',
      provenance: 'evidence-thin',
    });
  });

  it('null (no self-assessment given) leaves the evidence-derived level exactly as computed', () => {
    expect(chooseSupportLevel([outcome(), outcome()], null)).toEqual({
      level: 'independent',
      provenance: 'not-offered',
    });
  });

  it('a self-assessment on one call never changes what a later call with the same history returns', () => {
    const history = [outcome()];
    const withSelfAssessment = chooseSupportLevel(history, 'unsure');
    const withoutSelfAssessment = chooseSupportLevel(history, null);
    expect(withSelfAssessment).not.toEqual(withoutSelfAssessment);
    // The second call re-folds the SAME unmodified history — proof the first
    // call's self-assessment never touched the folded (recorded) state.
    expect(withoutSelfAssessment).toEqual({ level: 'prompted', provenance: 'evidence-thin' });
  });

  it('cannot be raised past the top of the ladder', () => {
    const alreadyGuided = [
      outcome({ failureShape: 'wrong-concept' }),
      outcome({ failureShape: 'wrong-concept' }),
    ];
    expect(supportLevelStateFromHistory(alreadyGuided).level).toBe('guided');
    expect(chooseSupportLevel(alreadyGuided, 'unsure')).toEqual({
      level: 'guided',
      provenance: 'evidence-thin',
    });
  });
});

describe('chooseSupportLevel — the ordering rule ([D-186]: fixed at composition, never inside a session)', () => {
  it("the decision for review N depends only on outcomes strictly before N, never on N's own outcome", () => {
    const historyBeforeReviewN: SessionSupportOutcome[] = [outcome(), outcome()];
    const decisionForReviewN = chooseSupportLevel(historyBeforeReviewN);

    // Review N then happens and produces an escalation-triggering outcome.
    // Appending it and recomputing must never retroactively change the
    // decision already made for review N — a caller that accidentally
    // included review N's own outcome in its input would get a different,
    // silently-wrong answer for the review that outcome belongs to.
    const historyIncludingReviewNsOwnOutcome = [
      ...historyBeforeReviewN,
      outcome({ failureShape: 'blank' }),
    ];
    const wronglyComputedDecisionForReviewN = chooseSupportLevel(
      historyIncludingReviewNsOwnOutcome,
    );

    expect(decisionForReviewN).toEqual({ level: 'independent', provenance: 'not-offered' });
    expect(wronglyComputedDecisionForReviewN).not.toEqual(decisionForReviewN);
  });

  it('reversal: the level cannot move mid-session — every review composed from the SAME frozen history agrees, even though a mid-session miss would have moved it', () => {
    // F2.20/[D-186]'s rule is coarser than "per review N": the whole SESSION
    // is fixed at composition, from sessions closed before it — never a
    // per-review re-read of a growing log. A session with several reviews on
    // the same concept × tier must therefore offer every one of them the
    // identical level, computed once, even though the FIRST review's own
    // (hypothetical, in-progress) outcome would — if it were wrongly folded
    // in before the second review was scored — move the level the second
    // review is shown at. That "read as of the instant before review N"
    // per-review framing is exactly what this test shows the freeze
    // forbids: reviews inside one session never read each other.
    const historyClosedBeforeThisSession: SessionSupportOutcome[] = [outcome(), outcome()];

    // Every item in the session being composed reads this SAME frozen
    // input — never a per-item advance of it.
    const firstReviewInSession = chooseSupportLevel(historyClosedBeforeThisSession);
    const secondReviewInSession = chooseSupportLevel(historyClosedBeforeThisSession);
    expect(firstReviewInSession).toEqual({ level: 'independent', provenance: 'not-offered' });
    expect(secondReviewInSession).toEqual(firstReviewInSession);

    // The counterfactual a per-review (mid-session) reading would produce:
    // the first review's own outcome, already known, folded in before the
    // second review is scored. It differs — proving the two readings are
    // not interchangeable, and that only the frozen one is what F2.20
    // permits.
    const wronglyAdvancedMidSession = chooseSupportLevel([
      ...historyClosedBeforeThisSession,
      outcome({ failureShape: 'blank' }),
    ]);
    expect(wronglyAdvancedMidSession).not.toEqual(secondReviewInSession);
  });
});
