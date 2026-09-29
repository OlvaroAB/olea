/**
 * `classifyAuthoringOutcome` — every fixture below is invented, so INV-3
 * does not apply to this file the way it does to a module reading real
 * material.
 */

import { describe, expect, it } from 'vitest';
import type { GroundingRefusalReason } from '../retrieval/groundedContext.js';
import { type AuthoringAttempt, classifyAuthoringOutcome } from './authoring-outcome.js';
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
