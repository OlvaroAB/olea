// Scenarios: features/F2-review.md, "F2.21 — Opening the depth gate for a
// concept that is going well" — @auto:core/study-session/strong-recall-proposal.spec
//
// Every concept id here is a structural placeholder. Nothing in this file is
// real vault vocabulary (INV-3).
import { describe, expect, it } from 'vitest';
import { type ConceptMasteryEvidence, MIN_SPACED_RETRIEVAL_DAYS } from '../mastery/rollup.js';
import { FORBIDDEN_VERDICT_PHRASES } from '../misconception/framing.js';
import {
  evaluateStrongRecallProposal,
  STRONG_RECALL_MARGIN_DAYS,
  STRONG_RECALL_PROPOSAL_TRIGGER,
  type StrongRecallProposalInput,
  strongRecallPromptLine,
} from './strong-recall-proposal.js';

const STRONG_DAYS = MIN_SPACED_RETRIEVAL_DAYS + STRONG_RECALL_MARGIN_DAYS;

function evidence(overrides: Partial<ConceptMasteryEvidence> = {}): ConceptMasteryEvidence {
  return {
    scoredEventCount: 8,
    scoredSuccessCount: 8,
    explainBackAttempts: 0,
    gradedExplainBackCount: 0,
    tiersPracticed: { recognition: true, recall: true, explanation: false },
    recognitionOnly: false,
    successfulScoredDays: STRONG_DAYS,
    deepestSoloLevel: null,
    depthGateCleared: false,
    ...overrides,
  };
}

function input(overrides: Partial<StrongRecallProposalInput> = {}): StrongRecallProposalInput {
  return {
    conceptId: 'concept-a',
    state: 'sapling',
    vitality: 'holding',
    evidence: evidence(),
    ...overrides,
  };
}

describe('evaluateStrongRecallProposal — F2.21', () => {
  it('proposes when recall is strong and depth evidence is absent, and says why', () => {
    const decision = evaluateStrongRecallProposal(input());
    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) throw new Error('unreachable');
    expect(decision.conceptId).toBe('concept-a');
    expect(decision.trigger).toBe(STRONG_RECALL_PROPOSAL_TRIGGER);
    expect(decision.reason.kind).toBe('strong-recall');
    expect(decision.reason.successfulScoredDays).toBe(STRONG_DAYS);
    expect(decision.reason.strongRecallDays).toBe(STRONG_DAYS);
    // "says why it is asking" — the line names the evidence, not a verdict.
    expect(decision.promptText).toContain('four different days');
    expect(decision.promptText).toContain('explain it back?');
  });

  it('is silent below sapling — seed and sprout have not recalled across spaced attempts', () => {
    for (const state of ['seed', 'sprout'] as const) {
      const decision = evaluateStrongRecallProposal(input({ state }));
      expect(decision).toEqual({ shouldPropose: false, because: 'stage-below-sapling' });
    }
  });

  it('is silent when recall is not holding — needing tending is F2.12 territory', () => {
    for (const vitality of ['tending', 'early'] as const) {
      const decision = evaluateStrongRecallProposal(input({ vitality }));
      expect(decision).toEqual({ shouldPropose: false, because: 'recall-not-holding' });
    }
  });

  it('is silent on recognition-only evidence — F2.21 says RECALL evidence (R7 tiering)', () => {
    const decision = evaluateStrongRecallProposal(
      input({ evidence: evidence({ recognitionOnly: true }) }),
    );
    expect(decision).toEqual({ shouldPropose: false, because: 'recognition-only' });
  });

  it('requires the declared margin beyond the spacing gate, not the bare sapling line', () => {
    // Exactly on the sapling line: qualified as a stage, not yet strong.
    const atTheLine = evaluateStrongRecallProposal(
      input({ evidence: evidence({ successfulScoredDays: MIN_SPACED_RETRIEVAL_DAYS }) }),
    );
    expect(atTheLine).toEqual({ shouldPropose: false, because: 'recall-not-yet-strong' });
    // One distinct day later.
    const withMargin = evaluateStrongRecallProposal(
      input({ evidence: evidence({ successfulScoredDays: STRONG_DAYS }) }),
    );
    expect(withMargin.shouldPropose).toBe(true);
  });

  it('adds the margin to a caller-supplied spacing gate, so the two cannot drift apart', () => {
    const decision = evaluateStrongRecallProposal(
      input({ minSpacedRetrievalDays: 5, evidence: evidence({ successfulScoredDays: 5 }) }),
    );
    expect(decision).toEqual({ shouldPropose: false, because: 'recall-not-yet-strong' });
    const cleared = evaluateStrongRecallProposal(
      input({ minSpacedRetrievalDays: 5, evidence: evidence({ successfulScoredDays: 6 }) }),
    );
    expect(cleared.shouldPropose).toBe(true);
    if (!cleared.shouldPropose) throw new Error('unreachable');
    expect(cleared.reason.strongRecallDays).toBe(6);
  });

  it('is silent when depth evidence is present — a graded explain-back that fell short still counts', () => {
    const shortOfTheGate = evaluateStrongRecallProposal(
      input({
        evidence: evidence({
          gradedExplainBackCount: 1,
          deepestSoloLevel: 'multistructural',
          depthGateCleared: false,
        }),
      }),
    );
    expect(shortOfTheGate).toEqual({ shouldPropose: false, because: 'depth-evidence-present' });
    const cleared = evaluateStrongRecallProposal(
      input({ state: 'tree', evidence: evidence({ depthGateCleared: true }) }),
    );
    expect(cleared).toEqual({ shouldPropose: false, because: 'depth-evidence-present' });
  });

  it('reopens eligibility when a fresh misconception surfaces on a top-stage concept', () => {
    const decision = evaluateStrongRecallProposal(
      input({
        state: 'tree',
        evidence: evidence({
          gradedExplainBackCount: 1,
          deepestSoloLevel: 'relational',
          depthGateCleared: true,
        }),
        misconceptionSinceLastGradedExplainBack: true,
      }),
    );
    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) throw new Error('unreachable');
    expect(decision.reason.kind).toBe('reopened-by-misconception');
    // The stage is a high-water mark and nothing here writes: F2.11 is untouched.
    expect(decision.promptText).toContain('explain it back?');
  });

  it('declining changes nothing: the same input evaluates the same way afterwards', () => {
    // A decline is an append-only log record, never a state; this module reads
    // no such state and has nowhere for one to be passed in, so re-evaluating
    // an unchanged concept re-proposes rather than staying silent (F2.14a).
    const first = evaluateStrongRecallProposal(input());
    const second = evaluateStrongRecallProposal(input());
    expect(second).toEqual(first);
    const keys = Object.keys(input()).sort();
    expect(keys).not.toContain('declined');
    expect(keys).not.toContain('offerHistory');
  });

  it('a definition-only concept gets no special case — concept size is not an input', () => {
    // Structural: there is nowhere on the input to pass a size, so C7.9's
    // sizing cannot reach this decision even by accident ([D-080]).
    const keys = Object.keys(input());
    expect(keys).not.toContain('conceptSize');
    expect(keys).not.toContain('extent');
  });

  it('rejects an empty concept id rather than proposing about nothing', () => {
    expect(() => evaluateStrongRecallProposal(input({ conceptId: '' }))).toThrow(
      /conceptId must be non-empty/,
    );
  });
});

describe('it proposes, it does not schedule — F2.14 / F2.21', () => {
  it('a proposal carries nothing a composer could rank or a scheduler could advance', () => {
    const decision = evaluateStrongRecallProposal(input());
    if (!decision.shouldPropose) throw new Error('unreachable');
    const keys = Object.keys(decision);
    expect(keys.sort()).toEqual(['conceptId', 'promptText', 'reason', 'shouldPropose', 'trigger']);
    for (const forbidden of [
      'gapScore',
      'gapRank',
      'gapClass',
      'instrumentId',
      'instrumentType',
      'due',
      'dueAt',
      'estimatedSeconds',
      'state',
      'scheduledFor',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('the session builder has no channel through which a proposal could reach the fill', async () => {
    // `buildStudySession` selects from `rows`/`instruments` only; the sole
    // explain-back-shaped input it accepts is `acceptedExplainBacks`, which is
    // F2.14a's ALREADY-ACCEPTED fact, priced and never ranked. A proposal is
    // not assignable to it: it has no instrumentId/notePath/course, so this
    // module's output cannot be laundered into the session by a caller.
    const build = await import('./build.js');
    expect(typeof build.buildStudySession).toBe('function');
    const decision = evaluateStrongRecallProposal(input());
    if (!decision.shouldPropose) throw new Error('unreachable');
    for (const required of ['instrumentId', 'notePath', 'course', 'noteTitle']) {
      expect(Object.keys(decision)).not.toContain(required);
    }
  });

  it('the module imports nothing that schedules', async () => {
    const module = await import('./strong-recall-proposal.js');
    expect(Object.keys(module).sort()).toEqual([
      'STRONG_RECALL_MARGIN_DAYS',
      'STRONG_RECALL_PROPOSAL_TRIGGER',
      'evaluateStrongRecallProposal',
      'strongRecallPromptLine',
    ]);
  });
});

describe('strongRecallPromptLine — F2.21 framing', () => {
  it('never renders a verdict on her, for either reason kind or any day count', () => {
    const lines = [
      strongRecallPromptLine({
        kind: 'reopened-by-misconception',
        successfulScoredDays: 9,
        strongRecallDays: STRONG_DAYS,
      }),
      ...Array.from({ length: 14 }, (_unused, days) =>
        strongRecallPromptLine({
          kind: 'strong-recall',
          successfulScoredDays: days,
          strongRecallDays: STRONG_DAYS,
        }),
      ),
    ];
    for (const line of lines) {
      const lowered = line.toLowerCase();
      for (const phrase of FORBIDDEN_VERDICT_PHRASES) {
        expect(lowered).not.toContain(phrase);
      }
      expect(line).toContain('want to explain it back?');
    }
  });

  it('spells small day counts and falls back to a numeral past ten', () => {
    const spelled = strongRecallPromptLine({
      kind: 'strong-recall',
      successfulScoredDays: 4,
      strongRecallDays: STRONG_DAYS,
    });
    expect(spelled).toContain('four different days');
    const numeral = strongRecallPromptLine({
      kind: 'strong-recall',
      successfulScoredDays: 12,
      strongRecallDays: STRONG_DAYS,
    });
    expect(numeral).toContain('12 different days');
  });

  it('names no concept — this module never receives a display name', () => {
    const line = strongRecallPromptLine({
      kind: 'strong-recall',
      successfulScoredDays: 4,
      strongRecallDays: STRONG_DAYS,
    });
    expect(line).not.toContain('concept-a');
  });
});
