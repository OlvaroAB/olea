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

describe('classifyAuthoringOutcome — the four refusal outcomes stay distinct (evd.md §3, D-289)', () => {
  it('maps no-hits (an empty package) to unavailable with cause retrieval-failure (D-289)', () => {
    expect(classifyAuthoringOutcome({ kind: 'refused', reason: 'no-hits' })).toEqual({
      status: 'unavailable',
      retryable: true,
      cause: 'retrieval-failure',
    });
  });

  // Classification of the below-* reasons is not ruled: previous status kept, own cause.
  for (const reason of [
    'below-relevance-threshold',
    'below-composite-threshold',
    'below-band',
  ] as const) {
    it(`keeps ${reason} as insufficient-evidence under its own below-threshold cause`, () => {
      expect(classifyAuthoringOutcome({ kind: 'refused', reason })).toEqual({
        status: 'insufficient-evidence',
        cause: 'below-threshold',
      });
    });
  }

  it('maps the judge rejecting the sources (judge-rejected) to insufficient-evidence, source-insufficient', () => {
    expect(classifyAuthoringOutcome({ kind: 'refused', reason: 'judge-rejected' })).toEqual({
      status: 'insufficient-evidence',
      cause: 'source-insufficient',
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
    it(`maps a "could not check" refusal (${reason}) to unavailable with cause service-failure`, () => {
      expect(classifyAuthoringOutcome({ kind: 'refused', reason })).toEqual({
        status: 'unavailable',
        retryable: true,
        cause: 'service-failure',
      });
    });
  }
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
