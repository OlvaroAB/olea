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

describe('classifyAuthoringOutcome — refusal, checked-and-found-nothing vs could-not-check', () => {
  const CHECKED_REASONS: readonly GroundingRefusalReason[] = [
    'below-relevance-threshold',
    'below-composite-threshold',
    'below-band',
    'judge-rejected',
  ];

  for (const reason of CHECKED_REASONS) {
    it(`maps a checked refusal (${reason}) to insufficient-evidence`, () => {
      expect(classifyAuthoringOutcome({ kind: 'refused', reason })).toEqual({
        status: 'insufficient-evidence',
      });
    });
  }

  const OPERATIONAL_REASONS: readonly GroundingRefusalReason[] = [
    'judge-unavailable',
    'composite-check-unavailable',
  ];

  for (const reason of OPERATIONAL_REASONS) {
    it(`maps a transient "could not check" refusal (${reason}) to unavailable/retryable`, () => {
      expect(classifyAuthoringOutcome({ kind: 'refused', reason })).toEqual({
        status: 'unavailable',
        retryable: true,
      });
    });
  }

  // [D-289] point 2 (`ol-egov.141.89.1.6`) and pra.json's evidence step: an
  // empty evidence package is an operational outcome, never a verdict about
  // her notes, even though `no-hits` is not "transient" in the same sense as
  // a judge or composite-check outage — there was nothing to decide from, so
  // no model was ever asked. `ol-egov.141.89.2.12` is the bug this regression
  // test guards: `no-hits` used to land in the checked-verdict bucket above.
  it('maps no-hits (an empty package) to unavailable/retryable, never a checked verdict (D-289)', () => {
    expect(classifyAuthoringOutcome({ kind: 'refused', reason: 'no-hits' })).toEqual({
      status: 'unavailable',
      retryable: true,
    });
  });
});

describe('classifyAuthoringOutcome — transient generation failure', () => {
  it('maps draft-error (transport threw) to unavailable/retryable', () => {
    expect(classifyAuthoringOutcome({ kind: 'draft-error' })).toEqual({
      status: 'unavailable',
      retryable: true,
    });
  });

  it('maps unparseable (response parsed to null) to unavailable/retryable', () => {
    expect(classifyAuthoringOutcome({ kind: 'unparseable' })).toEqual({
      status: 'unavailable',
      retryable: true,
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
