/**
 * The sufficiency seam through the Decision contract (`ol-egov.141.89.20`).
 * Seam values come from the seam itself where it produces them
 * (`IncumbentAssessSupport` over a stub `GroundingJudgePort`), and from the
 * seam's own union for the arms no wired provider produces yet. The proof of
 * no behaviour change: every seam value survives the round trip unchanged,
 * and drafting eligibility, the seam's consumer, reads the same through it.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import { draftingEligibility } from '../../retrieval/draftingEligibility.js';
import {
  type AssessSupportOutcome,
  type AssessSupportPort,
  type GroundingJudgePort,
  IncumbentAssessSupport,
} from '../../retrieval/groundedContext.js';
import { cascadeDecisionSeats, decisionEnvelopeProblems } from '../decision.js';
import type { StageSeamContext } from '../provenance.js';
import {
  ASSESS_SUPPORT_VOCABULARY,
  assessSupportFromDecision,
  assessSupportSeat,
  decisionFromAssessSupport,
  EMPTY_EVIDENCE_PACKAGE_RULE,
  sufficiencyAnswerFromDecision,
} from './assess-support.js';

const context: StageSeamContext = {
  seat: 'candidate',
  taskId: 'grounding.judge.v1',
  stamp: null,
  evidenceDigests: ['package-digest-1'],
};

const request = { query: 'define term A', context: 'passage about term A' };

function judge(verdict: unknown): GroundingJudgePort {
  return { judge: async () => verdict as never };
}

async function seamOutcomes(): Promise<AssessSupportOutcome[]> {
  const throwing: GroundingJudgePort = {
    judge: async () => {
      throw new Error('transport down');
    },
  };
  return [
    await new IncumbentAssessSupport(judge({ supported: true, reason: 'covers it' })).assessSupport(
      request,
    ),
    await new IncumbentAssessSupport(judge({ supported: false, reason: 'thin' })).assessSupport(
      request,
    ),
    await new IncumbentAssessSupport(judge({ nonsense: 1 })).assessSupport(request),
    await new IncumbentAssessSupport(throwing).assessSupport(request),
    // Arms no wired provider produces yet: the seam's own union.
    {
      status: 'assessed',
      supported: false,
      reason: 'a step is missing',
      verdict: 'partial',
      missing: ['a condition'],
    },
    { status: 'assessed', supported: false, reason: 'passages disagree', verdict: 'conflicting' },
    { status: 'could-not-decide' },
    { status: 'insufficient-evidence' },
  ];
}

describe('decisionFromAssessSupport', () => {
  it('maps each seam arm to its contract kind', async () => {
    const [yes, no, malformed, thrown, partial, conflicting, unsure, empty] = await seamOutcomes();
    const read = (outcome: AssessSupportOutcome | undefined) =>
      decisionFromAssessSupport(outcome as AssessSupportOutcome, context);

    expect(read(yes)).toMatchObject({ kind: 'verdict', verdict: 'sufficient' });
    expect(read(no)).toMatchObject({ kind: 'verdict', verdict: 'insufficient' });
    expect(read(partial)).toMatchObject({
      kind: 'verdict',
      verdict: 'partial',
      payload: { missing: ['a condition'] },
    });
    expect(read(conflicting)).toMatchObject({ kind: 'verdict', verdict: 'conflicting' });
    expect(read(unsure)).toMatchObject({ kind: 'undecided', basis: 'abstained' });
    expect(read(empty)).toMatchObject({ kind: 'undecided', basis: 'nothing-to-decide-from' });
    expect(read(malformed)).toMatchObject({ kind: 'unavailable', cause: 'call-failed' });
    expect(read(thrown)).toMatchObject({ kind: 'unavailable', cause: 'call-failed' });
  });

  it('reads an empty evidence package as undecided by code, never as a verdict ([D-289])', async () => {
    const empty = (await seamOutcomes()).at(-1) as AssessSupportOutcome;
    const decision = decisionFromAssessSupport(empty, context);
    expect(decision).toEqual({
      kind: 'undecided',
      basis: 'nothing-to-decide-from',
      provenance: {
        producer: { kind: 'code', rule: EMPTY_EVIDENCE_PACKAGE_RULE },
        evidenceDigests: ['package-digest-1'],
      },
    });
  });

  it('produces a well-formed envelope for every seam value, before and after JSON', async () => {
    for (const outcome of await seamOutcomes()) {
      const decision = decisionFromAssessSupport(outcome, context);
      expect(decisionEnvelopeProblems(decision, ASSESS_SUPPORT_VOCABULARY)).toEqual([]);
      expect(
        decisionEnvelopeProblems(JSON.parse(JSON.stringify(decision)), ASSESS_SUPPORT_VOCABULARY),
      ).toEqual([]);
    }
  });

  it('round-trips every seam value unchanged: no behaviour change for a consumer reading through it', async () => {
    for (const outcome of await seamOutcomes()) {
      const back = assessSupportFromDecision(decisionFromAssessSupport(outcome, context));
      expect(back).toEqual(outcome);
      expect(draftingEligibility(back)).toEqual(draftingEligibility(outcome));
    }
  });
});

describe('assessSupportSeat: the candidate and fallback behind one interface', () => {
  it('lets the fallback settle what the candidate could not, and records the hand-off', async () => {
    const unsure: AssessSupportPort = {
      assessSupport: async () => ({ status: 'could-not-decide' }),
    };
    const strong = new IncumbentAssessSupport(judge({ supported: true, reason: 'covers it' }));
    const seat = cascadeDecisionSeats({
      taskId: 'grounding.judge.v1',
      candidate: assessSupportSeat(unsure, context),
      fallback: assessSupportSeat(strong, { ...context, seat: 'fallback' }),
    });
    const decision = await seat.decide(request);
    expect(decision).toMatchObject({ kind: 'verdict', verdict: 'sufficient' });
    expect(decision.provenance.producer).toMatchObject({ kind: 'model', seat: 'fallback' });
    expect(decision.provenance.escalation).toEqual({
      from: { kind: 'model', seat: 'candidate', taskId: 'grounding.judge.v1', stamp: null },
      because: 'undecided',
    });
    expect(decisionEnvelopeProblems(decision, ASSESS_SUPPORT_VOCABULARY)).toEqual([]);
  });

  it('turns a throwing port into unavailable', async () => {
    const throwing: AssessSupportPort = {
      assessSupport: async () => {
        throw new Error('boom');
      },
    };
    const decision = await assessSupportSeat(throwing, context).decide(request);
    expect(decision).toMatchObject({ kind: 'unavailable', cause: 'call-failed' });
  });
});

describe('sufficiencyAnswerFromDecision: the four-verdict seam as the re-ask reads it (`ol-egov.141.89.5.26`, [D-414])', () => {
  const read = (outcome: AssessSupportOutcome) =>
    sufficiencyAnswerFromDecision(decisionFromAssessSupport(outcome, context), 'fp-1');

  it.each(['sufficient', 'partial', 'insufficient', 'conflicting'] as const)(
    'a %s verdict is that verdict, carrying the fingerprint it was asked over',
    (verdict) => {
      expect(
        read({ status: 'assessed', supported: verdict === 'sufficient', reason: 'r', verdict }),
      ).toEqual({ kind: 'verdict', verdict, evidenceFingerprint: 'fp-1' });
    },
  );

  it('the judge naming what is missing never reaches the answer (registry section 25)', () => {
    const answer = read({
      status: 'assessed',
      supported: false,
      reason: 'a step is missing',
      verdict: 'partial',
      missing: ['a condition', 'a value'],
    });
    expect(answer).toEqual({ kind: 'verdict', verdict: 'partial', evidenceFingerprint: 'fp-1' });
    expect(JSON.stringify(answer)).not.toContain('condition');
    expect(JSON.stringify(answer)).not.toContain('a step is missing');
  });

  it('an abstention is could-not-decide, never a verdict', () => {
    expect(read({ status: 'could-not-decide' })).toEqual({
      kind: 'not-run',
      reason: 'could-not-decide',
    });
  });

  it('an empty evidence package is a retrieval failure, never an insufficiency ([D-289], [D-441])', () => {
    expect(read({ status: 'insufficient-evidence' })).toEqual({
      kind: 'not-run',
      reason: 'retrieval-failed',
    });
  });

  it('an outage is an outage, never an insufficiency', () => {
    expect(read({ status: 'unavailable' })).toEqual({
      kind: 'not-run',
      reason: 'check-unavailable',
    });
  });

  it('every undecided basis the contract defines maps to a not-run reason, and none to a verdict', () => {
    for (const basis of [
      'abstained',
      'below-confidence-bar',
      'voided-by-check',
      'nothing-to-decide-from',
    ] as const) {
      const answer = sufficiencyAnswerFromDecision(
        {
          kind: 'undecided',
          basis,
          provenance: decisionFromAssessSupport({ status: 'could-not-decide' }, context).provenance,
        },
        'fp-1',
      );
      expect(answer.kind).toBe('not-run');
    }
  });
});
