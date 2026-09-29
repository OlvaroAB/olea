/**
 * `classifyAuthoringOutcome` — every fixture below is invented, so INV-3
 * does not apply to this file the way it does to a module reading real
 * material.
 */

import { describe, expect, it } from 'vitest';
import { PAPER_DEMANDS, type PaperDemand } from '../oracle/paper-types.js';
import type { GroundingRefusalReason } from '../retrieval/groundedContext.js';
import {
  type AuthoringAttempt,
  classifyAuthoringOutcome,
  type DraftedDemandFacts,
  judgeDraftedDemand,
} from './authoring-outcome.js';
import type { McqDraftDefect } from './mcq-draft-checks.js';

describe('classifyAuthoringOutcome — routing and budget deferral', () => {
  it('maps routed-away to deferred/unmet-format', () => {
    expect(classifyAuthoringOutcome({ kind: 'routed-away' })).toEqual({
      status: 'deferred',
      reason: 'unmet-format',
    });
  });

  it('maps budget-exhausted to deferred/budget', () => {
    expect(classifyAuthoringOutcome({ kind: 'budget-exhausted' })).toEqual({
      status: 'deferred',
      reason: 'budget',
    });
  });
});

describe('classifyAuthoringOutcome — refusal outcomes stay distinct, each keeping its own reason (evd.md §3, D-289, D-441)', () => {
  // Retrieval failure (D-289 point 2, D-441 as ruled 2026-09-29): an empty
  // package, or one the relevance floor emptied. Operational, never a
  // verdict about her notes.
  for (const reason of ['no-hits', 'below-relevance-threshold'] as const) {
    it(`maps ${reason} to unavailable with cause retrieval-failure, carrying the reason`, () => {
      expect(classifyAuthoringOutcome({ kind: 'refused', reason })).toEqual({
        status: 'unavailable',
        retryable: true,
        cause: 'retrieval-failure',
        reason,
      });
    });
  }

  // Threshold-blocked (D-441 as ruled 2026-09-29): the composite veto and the
  // band's lower bar decided from numbers alone. Not assessed, and never
  // 'insufficient-evidence': no judgement about her notes was made.
  for (const reason of ['below-composite-threshold', 'below-band'] as const) {
    it(`maps ${reason} to not-assessed / threshold-blocked, never to insufficient-evidence`, () => {
      const outcome = classifyAuthoringOutcome({ kind: 'refused', reason });
      expect(outcome).toEqual({ status: 'not-assessed', cause: 'threshold-blocked', reason });
      expect(outcome.status).not.toBe('insufficient-evidence');
    });
  }

  it('maps the judge rejecting the sources (judge-rejected) to insufficient-evidence, the one checked verdict', () => {
    expect(classifyAuthoringOutcome({ kind: 'refused', reason: 'judge-rejected' })).toEqual({
      status: 'insufficient-evidence',
      cause: 'source-insufficient',
      reason: 'judge-rejected',
    });
  });

  it('maps a judge that ran and could not decide to unavailable with cause judgment-uncertain', () => {
    expect(classifyAuthoringOutcome({ kind: 'undecided' })).toEqual({
      status: 'unavailable',
      retryable: true,
      cause: 'judgment-uncertain',
    });
  });

  const SERVICE_REASONS: readonly GroundingRefusalReason[] = [
    'judge-unavailable',
    'composite-check-unavailable',
  ];
  for (const reason of SERVICE_REASONS) {
    it(`maps a "could not check" refusal (${reason}) to unavailable with cause service-failure, carrying the reason`, () => {
      expect(classifyAuthoringOutcome({ kind: 'refused', reason })).toEqual({
        status: 'unavailable',
        retryable: true,
        cause: 'service-failure',
        reason,
      });
    });
  }

  // One row per reason in the union: a new reason has to be classified here on
  // purpose (the switch is exhaustive), and no reason may share both its cause
  // and its reason value with another.
  const ALL_REASONS: readonly GroundingRefusalReason[] = [
    'no-hits',
    'below-relevance-threshold',
    'below-composite-threshold',
    'composite-check-unavailable',
    'below-band',
    'judge-rejected',
    'judge-unavailable',
  ];

  it('preserves the specific refusal reason on the outcome for every reason in the union', () => {
    for (const reason of ALL_REASONS) {
      const outcome = classifyAuthoringOutcome({ kind: 'refused', reason });
      expect('reason' in outcome && outcome.reason).toBe(reason);
    }
  });

  it('only a judge rejection is a checked insufficiency: every other refusal reason avoids insufficient-evidence', () => {
    const checked = ALL_REASONS.filter(
      (reason) =>
        classifyAuthoringOutcome({ kind: 'refused', reason }).status === 'insufficient-evidence',
    );
    expect(checked).toEqual(['judge-rejected']);
  });

  it('the three kinds of "nothing was decided about her notes" stay apart by status and cause', () => {
    const kinds = new Set(
      ALL_REASONS.map((reason) => {
        const outcome = classifyAuthoringOutcome({ kind: 'refused', reason });
        return `${outcome.status}/${'cause' in outcome ? outcome.cause : ''}`;
      }),
    );
    expect(kinds).toEqual(
      new Set([
        'unavailable/retrieval-failure',
        'not-assessed/threshold-blocked',
        'insufficient-evidence/source-insufficient',
        'unavailable/service-failure',
      ]),
    );
  });
});

describe('classifyAuthoringOutcome — transient generation failure', () => {
  it('maps draft-error (transport threw) to unavailable/retryable', () => {
    expect(classifyAuthoringOutcome({ kind: 'draft-error' })).toEqual({
      status: 'unavailable',
      retryable: true,
      cause: 'service-failure',
    });
  });

  it('maps unparseable (response parsed to null) to unavailable/retryable', () => {
    expect(classifyAuthoringOutcome({ kind: 'unparseable' })).toEqual({
      status: 'unavailable',
      retryable: true,
      cause: 'service-failure',
    });
  });
});

describe('classifyAuthoringOutcome — a drafted response, by its checkMcqDraft defects', () => {
  it('maps a drafted response with no defects to eligible', () => {
    const attempt: AuthoringAttempt = { kind: 'drafted', defects: [] };
    expect(classifyAuthoringOutcome(attempt)).toEqual({ status: 'eligible' });
  });

  it('maps a drafted response with defects to invalid-draft, carrying the defects', () => {
    const defects: readonly McqDraftDefect[] = [
      { kind: 'empty-stem', detail: 'stem is empty or whitespace-only' },
    ];
    const attempt: AuthoringAttempt = { kind: 'drafted', defects };
    expect(classifyAuthoringOutcome(attempt)).toEqual({ status: 'invalid-draft', defects });
  });
});

// ---------------------------------------------------------------------------
// `[D-437]` demand carriage, B4 (`ol-egov.141.89.2.26`), test T5: the demand is validated by code
// against what the request asked (`[D-310]`: no per-item demand judge), and the author's own
// declaration is used only to REFUSE, never to certify (design sections 2 and 4.4, row 36).
// ---------------------------------------------------------------------------

describe('judgeDraftedDemand — code checks only, refusing and never certifying (T5)', () => {
  const OTHERS = (demand: PaperDemand) => PAPER_DEMANDS.filter((word) => word !== demand);

  it('reads nothing asked when the request carried no demand, whatever the response says', () => {
    expect(judgeDraftedDemand({})).toEqual({ kind: 'unspecified', reason: 'none-asked' });
    // A model that wrote an acknowledgement and a declaration for a request that asked for nothing
    // has not been asked anything: the Worker strips both, and the client would ignore them anyway.
    expect(
      judgeDraftedDemand({ acknowledgedDemand: 'calculate', declaredDemand: 'calculate' }),
    ).toEqual({ kind: 'unspecified', reason: 'none-asked' });
  });

  it('a response with no acknowledgement is unspecified (skew), not a defect, even when a declaration came back', () => {
    // Deployment skew (design 4.3): an old Worker strips the unknown request keys and authors as
    // before, so the response has no acknowledgement. A new caller must never record as intended
    // what an old server ignored, and the draft is not thereby invalid.
    expect(judgeDraftedDemand({ intendedDemand: 'recall-a-fact' })).toEqual({
      kind: 'unspecified',
      reason: 'not-acknowledged',
    });
    expect(
      judgeDraftedDemand({ intendedDemand: 'recall-a-fact', declaredDemand: 'recall-a-fact' }),
    ).toEqual({ kind: 'unspecified', reason: 'not-acknowledged' });
  });

  it('an acknowledgement of a different demand than the one sent is no acknowledgement of it', () => {
    for (const other of OTHERS('recall-a-fact')) {
      expect(
        judgeDraftedDemand({
          intendedDemand: 'recall-a-fact',
          acknowledgedDemand: other,
          declaredDemand: 'recall-a-fact',
        }),
      ).toEqual({ kind: 'unspecified', reason: 'not-acknowledged' });
    }
  });

  it('a question declaring a different demand than asked is refused as demand-mismatch, for every pair of the five words', () => {
    for (const asked of PAPER_DEMANDS) {
      for (const declared of OTHERS(asked)) {
        const disposition = judgeDraftedDemand({
          intendedDemand: asked,
          acknowledgedDemand: asked,
          declaredDemand: declared,
        });
        expect(disposition.kind).toBe('refused');
        if (disposition.kind !== 'refused') throw new Error('unreachable');
        expect(disposition.defect.kind).toBe('demand-mismatch');
        expect(disposition.defect.detail).toContain(asked);
        expect(disposition.defect.detail).toContain(declared);
      }
    }
  });

  it('an acknowledged demand with no declaration on the question is a mismatch too: absence is not agreement', () => {
    const disposition = judgeDraftedDemand({
      intendedDemand: 'recall-a-fact',
      acknowledgedDemand: 'recall-a-fact',
    });
    expect(disposition).toMatchObject({ kind: 'refused', defect: { kind: 'demand-mismatch' } });
  });

  it('a matching declaration adds nothing: the result carries the demand that was asked and no basis but that (row 36)', () => {
    for (const asked of PAPER_DEMANDS) {
      const disposition = judgeDraftedDemand({
        intendedDemand: asked,
        acknowledgedDemand: asked,
        declaredDemand: asked,
      });
      // Exactly two keys: nothing says the item was checked to deliver the demand.
      expect(disposition).toEqual({ kind: 'declared', demand: asked });
      expect(Object.keys(disposition).sort()).toEqual(['demand', 'kind']);
    }
  });
});

describe('classifyAuthoringOutcome — a drafted response carrying demand facts (T5)', () => {
  const asked: DraftedDemandFacts = {
    intendedDemand: 'recall-a-fact',
    acknowledgedDemand: 'recall-a-fact',
    declaredDemand: 'recall-a-fact',
  };

  it('a drafted attempt with no demand facts classifies exactly as before this bead, with no demand member', () => {
    expect(classifyAuthoringOutcome({ kind: 'drafted', defects: [] })).toEqual({
      status: 'eligible',
    });
  });

  it('a proposal declaring a different demand is invalid-draft with the demand-mismatch defect', () => {
    const outcome = classifyAuthoringOutcome({
      kind: 'drafted',
      defects: [],
      demand: { ...asked, declaredDemand: 'calculate' },
    });
    expect(outcome.status).toBe('invalid-draft');
    if (outcome.status !== 'invalid-draft') throw new Error('unreachable');
    expect(outcome.defects.map((defect) => defect.kind)).toEqual(['demand-mismatch']);
  });

  it('the demand-mismatch defect follows the exact MCQ defects, so both are reported in one invalid-draft', () => {
    const mcq: readonly McqDraftDefect[] = [{ kind: 'empty-stem', detail: 'stem is empty' }];
    const outcome = classifyAuthoringOutcome({
      kind: 'drafted',
      defects: mcq,
      demand: { ...asked, declaredDemand: 'compare-or-choose' },
    });
    expect(outcome.status).toBe('invalid-draft');
    if (outcome.status !== 'invalid-draft') throw new Error('unreachable');
    expect(outcome.defects.map((defect) => defect.kind)).toEqual(['empty-stem', 'demand-mismatch']);
  });

  it('a response with no acknowledgement is eligible and unspecified, so the need stays open and the reason is counted as skew', () => {
    const outcome = classifyAuthoringOutcome({
      kind: 'drafted',
      defects: [],
      demand: { intendedDemand: 'recall-a-fact' },
    });
    expect(outcome).toEqual({
      status: 'eligible',
      demand: { kind: 'unspecified', reason: 'not-acknowledged' },
    });
  });

  it('an acknowledged, agreeing draft is eligible and its demand is the one asked', () => {
    expect(classifyAuthoringOutcome({ kind: 'drafted', defects: [], demand: asked })).toEqual({
      status: 'eligible',
      demand: { kind: 'declared', demand: 'recall-a-fact' },
    });
  });

  it('exact MCQ defects alone still make an invalid-draft, and an unspecified demand adds nothing to it', () => {
    const mcq: readonly McqDraftDefect[] = [
      { kind: 'empty-feedback', detail: 'feedback is empty' },
    ];
    expect(
      classifyAuthoringOutcome({
        kind: 'drafted',
        defects: mcq,
        demand: { intendedDemand: 'recall-a-fact' },
      }),
    ).toEqual({ status: 'invalid-draft', defects: mcq });
  });
});
