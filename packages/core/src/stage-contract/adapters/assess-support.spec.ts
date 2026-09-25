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
