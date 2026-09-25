/**
 * The question-writing seams through the Writing contract
 * (`ol-egov.141.89.20`): `checkMcqDraft`'s defects become a receipt of
 * seven code checks, and every `AuthoringAttempt` arm is read through the
 * seam's own `classifyAuthoringOutcome`, so the two cannot disagree.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import {
  type AuthoringAttempt,
  classifyAuthoringOutcome,
} from '../../generation/authoring-outcome.js';
import { checkMcqDraft } from '../../generation/mcq-draft-checks.js';
import type { GeneratedMcqCandidate } from '../../instrument/mcq-generated.js';
import type { StageSeamContext } from '../provenance.js';
import { passedItsChecks, writingEnvelopeProblems } from '../writing.js';
import {
  type AuthoringAttemptWithDraft,
  MCQ_EXACT_CHECKS,
  mcqExactCheckResults,
  writingFromAuthoringAttempt,
  writingFromMcqDraft,
} from './authoring.js';

const context: StageSeamContext = {
  seat: 'candidate',
  taskId: 'quiz.generate.v1',
  stamp: { promptVersion: 'quiz-prompt-1', modelId: 'writer-model' },
  evidenceDigests: ['package-digest-1'],
};

const clean: GeneratedMcqCandidate = {
  stem: 'Which coined option is keyed?',
  correctAnswer: 'Option Keyed',
  distractors: ['Option Two', 'Option Three', 'Option Four'],
  feedback: 'Coined feedback.',
};

const broken: GeneratedMcqCandidate = {
  stem: ' ',
  correctAnswer: 'Option Keyed',
  distractors: ['Option Keyed', 'All of the above', 'all of the above'],
  feedback: 'Coined feedback.',
};

describe('mcqExactCheckResults and writingFromMcqDraft', () => {
  it('lists all seven checks as passed for a clean draft, at code-checks-only assurance', () => {
    const defects = checkMcqDraft(clean);
    expect(defects).toEqual([]);
    const outcome = writingFromMcqDraft(clean, defects, context);
    expect(outcome.kind).toBe('written');
    expect(outcome.receipt.passed.map((entry) => entry.check)).toEqual(
      Object.values(MCQ_EXACT_CHECKS),
    );
    expect(outcome.receipt.disposition).toBe('checks-passed');
    expect(outcome.receipt.assurance).toBe('code-checks-only');
    expect(passedItsChecks(outcome.receipt)).toBe(true);
  });

  it('refuses a draft with defects, naming each failed check, and never carries the draft', () => {
    const defects = checkMcqDraft(broken);
    expect(defects.length).toBeGreaterThan(0);
    const outcome = writingFromMcqDraft(broken, defects, context);
    expect(outcome.kind).toBe('refused');
    expect('draft' in outcome).toBe(false);
    const failed = outcome.receipt.failed.map((entry) => entry.check);
    for (const kind of new Set(defects.map((defect) => defect.kind))) {
      expect(failed).toContain(MCQ_EXACT_CHECKS[kind]);
    }
    expect(outcome.receipt.passed.length + outcome.receipt.failed.length).toBe(7);
  });

  it('keeps the receipt content-free: no draft text, only counts', () => {
    const results = mcqExactCheckResults(checkMcqDraft(broken));
    const serialised = JSON.stringify(results);
    for (const text of [broken.correctAnswer, ...broken.distractors]) {
      expect(serialised).not.toContain(text);
    }
    expect(results.find((r) => r.check === 'no-above-style-option')?.note).toBe('2 defects');
  });
});

describe('writingFromAuthoringAttempt', () => {
  const attempts: AuthoringAttemptWithDraft<GeneratedMcqCandidate>[] = [
    { kind: 'drafted', defects: [], draft: clean },
    { kind: 'drafted', defects: checkMcqDraft(broken), draft: broken },
    { kind: 'refused', reason: 'below-band' },
    { kind: 'refused', reason: 'no-hits' },
    { kind: 'refused', reason: 'judge-rejected' },
    { kind: 'refused', reason: 'judge-unavailable' },
    { kind: 'refused', reason: 'composite-check-unavailable' },
    { kind: 'draft-error' },
    { kind: 'unparseable' },
    { kind: 'routed-away' },
    { kind: 'budget-exhausted' },
  ];

  it("agrees with the seam's own classification on every attempt", () => {
    const expectedKind = {
      eligible: 'written',
      'invalid-draft': 'refused',
      'insufficient-evidence': 'declined',
      unavailable: 'unavailable',
      deferred: null,
    } as const;
    for (const attempt of attempts) {
      const seam = classifyAuthoringOutcome(attempt as AuthoringAttempt);
      const outcome = writingFromAuthoringAttempt(attempt, context);
      expect(outcome === null ? null : outcome.kind).toBe(expectedKind[seam.status]);
      if (outcome !== null) expect(writingEnvelopeProblems(outcome)).toEqual([]);
    }
  });

  it('names why an attempt was unavailable: the evidence check, the call, or the parse', () => {
    const cause = (attempt: AuthoringAttemptWithDraft<GeneratedMcqCandidate>) => {
      const outcome = writingFromAuthoringAttempt(attempt, context);
      return outcome?.kind === 'unavailable' ? outcome.cause : null;
    };
    expect(cause({ kind: 'refused', reason: 'judge-unavailable' })).toBe('upstream-unavailable');
    expect(cause({ kind: 'draft-error' })).toBe('call-failed');
    expect(cause({ kind: 'unparseable' })).toBe('malformed');
  });

  it('reads an evidence refusal as declined, upstream-refused, and a deferral as no writing outcome', () => {
    expect(
      writingFromAuthoringAttempt({ kind: 'refused', reason: 'below-band' }, context),
    ).toMatchObject({ kind: 'declined', basis: 'upstream-refused' });
    expect(writingFromAuthoringAttempt({ kind: 'routed-away' }, context)).toBeNull();
    expect(writingFromAuthoringAttempt({ kind: 'budget-exhausted' }, context)).toBeNull();
  });

  it('carries the drafted draft on the written outcome', () => {
    const outcome = writingFromAuthoringAttempt(
      { kind: 'drafted', defects: [], draft: clean },
      context,
    );
    expect(outcome?.kind === 'written' && outcome.draft).toBe(clean);
  });
});
