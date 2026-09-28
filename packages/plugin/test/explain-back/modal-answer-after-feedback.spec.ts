/**
 * `[D-416]` (`ol-egov.141.89.6.63`), carrying `[D-318]`: an answer given after
 * she read a graded result is a separate attempt at the guided rung, and Try
 * again keeps the attempt before it instead of erasing it.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.9
 * (continued) / [D-416]". Same two instruments as
 * `modal-support-level.spec.ts`: `modal.ts` extends Obsidian's `Modal` and
 * cannot load under Vitest, so the rule lives in the pure
 * `attempt-sequence.ts` and is tested directly, and the view's wiring of it is
 * asserted against the view's source with comments stripped.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMITTED_SUPPORT_LEVELS } from '../../../core/src/mastery/rollup.js';
import {
  appendSetAsideAttempt,
  EMPTY_ATTEMPT_SEQUENCE,
  type ExplainBackAttemptSequence,
  feedbackShownBefore,
  sealAttemptSupport,
} from '../../src/explain-back/attempt-sequence.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

/** What the answering phase shows today: no hint, no source open beside her. */
const UNAIDED = { hintOffered: false, sourceShownWhileAnswering: false } as const;

function setAside(
  sequence: ExplainBackAttemptSequence,
  attemptId: string,
  outcome: 'correct' | 'partial' | 'incorrect' | 'unable-to-assess',
): ExplainBackAttemptSequence {
  return appendSetAsideAttempt(sequence, {
    attemptId,
    outcome:
      outcome === 'unable-to-assess'
        ? { kind: 'unable-to-assess' }
        : { kind: 'graded', verdict: outcome },
    support: sealAttemptSupport(sequence, UNAIDED),
  });
}

describe('an answer accepted after she read the feedback records the guided rung', () => {
  it('after one graded attempt set aside, the next attempt is sealed guided, whatever the answering phase shows', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    expect(sealAttemptSupport(sequence, UNAIDED).supportLevelShown).toBe('guided');
    expect(
      sealAttemptSupport(sequence, { hintOffered: true, sourceShownWhileAnswering: false })
        .supportLevelShown,
    ).toBe('guided');
    // Having read a graded result is known even when the answering phase's own presentation is not.
    expect(sealAttemptSupport(sequence, null).supportLevelShown).toBe('guided');
  });

  it('guided is not on the admitted list, so that attempt cannot reach the top growth stage', () => {
    expect(ADMITTED_SUPPORT_LEVELS).not.toContain('guided');
  });

  it('every later attempt in the same sequence stays guided', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    expect(sequence[1]?.supportLevelShown).toBe('guided');
    expect(sealAttemptSupport(sequence, UNAIDED).supportLevelShown).toBe('guided');
  });

  it('the view reads the sealed rung at accept and forwards it to the writer, never re-resolving it there', () => {
    expect(modal).toMatch(/const supportLevelShown = support\.supportLevelShown;/);
    expect(modal).not.toMatch(/supportLevelShownForExplainBack\(/);
  });
});

describe('the rung is sealed when she submits, not when she accepts', () => {
  it('a first answer, with an empty sequence, is sealed at the answering phase own reading', () => {
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED)).toEqual({
      supportLevelShown: 'independent',
      followsAttemptId: null,
    });
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, null).supportLevelShown).toBeUndefined();
  });

  it('the view seals the support in submitAnswer, before any grading is requested, and carries it on the grading and graded phases', () => {
    const submit = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private acceptGrading('),
    );
    expect(submit).toMatch(
      /const support = sealAttemptSupport\(this\.attemptSequence, EXPLAIN_BACK_ANSWERING_SUPPORT_SHOWN\);[\s\S]*?phase: 'grading'[\s\S]*?support \}[\s\S]*?this\.deps\.grade\(input\)/,
    );
    expect(submit).toMatch(/phase: 'graded',[\s\S]{0,200}?support,/);
  });

  it('the Accept button forwards the support sealed for THIS attempt', () => {
    expect(modal).toMatch(
      /this\.acceptGrading\(\s*prompt,\s*answer,\s*pending,\s*durationMs,\s*attemptId,\s*answerEdits,\s*support,?\s*\)/,
    );
  });
});

describe('Try again adds to the attempt sequence and never erases it', () => {
  it('each set-aside attempt keeps its own id, its verdict, and that she did not accept it, in order', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    expect(sequence).toEqual([
      {
        attemptId: 'at-1',
        outcome: { kind: 'graded', verdict: 'incorrect' },
        acceptance: 'not-accepted',
        supportLevelShown: 'independent',
        followsAttemptId: null,
      },
      {
        attemptId: 'at-2',
        outcome: { kind: 'graded', verdict: 'partial' },
        acceptance: 'not-accepted',
        supportLevelShown: 'guided',
        followsAttemptId: 'at-1',
      },
    ]);
  });

  it('the new attempt is linked to the one immediately before it', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    expect(sealAttemptSupport(sequence, UNAIDED).followsAttemptId).toBe('at-2');
  });

  it('appending never mutates the sequence it was given', () => {
    const first = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'correct');
    const snapshot = JSON.stringify(first);
    const second = setAside(first, 'at-2', 'correct');
    expect(JSON.stringify(first)).toBe(snapshot);
    expect(second).toHaveLength(2);
    expect(EMPTY_ATTEMPT_SEQUENCE).toHaveLength(0);
  });

  it('an entry holds ids, a verdict and a rung only, never answer text or feedback (D-005)', () => {
    const [entry] = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'acceptance',
      'attemptId',
      'followsAttemptId',
      'outcome',
      'supportLevelShown',
    ]);
    expect(Object.keys(entry?.outcome ?? {}).sort()).toEqual(['kind', 'verdict']);
  });

  it('the view appends the set-aside attempt before the pending grading goes through its discard boundary', () => {
    const discard = modal.slice(
      modal.indexOf('private discardGrading('),
      modal.indexOf('private skipPrompt('),
    );
    expect(discard).toMatch(
      /this\.attemptSequence = appendSetAsideAttempt\(this\.attemptSequence, \{[\s\S]*?attemptId,[\s\S]*?support,\s*\}\);[\s\S]*?discardExplainBackGrading\(pending\);/,
    );
  });

  it('only discardGrading grows the sequence, and only a new question resets it', () => {
    expect(modal.match(/appendSetAsideAttempt\(/g)).toHaveLength(1);
    const resets = modal.match(/this\.attemptSequence = EMPTY_ATTEMPT_SEQUENCE;/g) ?? [];
    expect(resets).toHaveLength(2);
    for (const site of [
      'private async resolveInstrumentPrompt(',
      'private async resolveTopicPrompt(',
    ]) {
      const start = modal.indexOf(site);
      const body = modal.slice(start, modal.indexOf('\n  }\n', start));
      expect(body).toContain('this.attemptSequence = EMPTY_ATTEMPT_SEQUENCE;');
    }
  });

  it('both Try again buttons, graded and could-not-assess, pass the attempt id, its duration and its sealed support', () => {
    expect(
      modal.match(
        /this\.discardGrading\(prompt, answer, pending, durationMs, attemptId, support\)/g,
      ),
    ).toHaveLength(2);
  });
});

describe('an answer the check could not assess is kept but gives no feedback', () => {
  it('is kept in the sequence with no verdict', () => {
    const [entry] = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'unable-to-assess');
    expect(entry?.outcome).toEqual({ kind: 'unable-to-assess' });
    expect(entry?.acceptance).toBe('not-accepted');
  });

  it('does not by itself make the next answer guided', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'unable-to-assess');
    expect(feedbackShownBefore(sequence)).toBe(false);
    expect(sealAttemptSupport(sequence, UNAIDED)).toEqual({
      supportLevelShown: 'independent',
      followsAttemptId: 'at-1',
    });
  });

  it('an earlier graded attempt in the same sequence still makes it guided', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    sequence = setAside(sequence, 'at-2', 'unable-to-assess');
    expect(sealAttemptSupport(sequence, UNAIDED).supportLevelShown).toBe('guided');
  });
});

describe('resubmitting after the check failed is the same attempt, not one after feedback', () => {
  it('the refusal retry resubmits through submitAnswer and never touches the sequence', () => {
    const refusal = modal.slice(
      modal.indexOf('private renderCouldNotCheckRefusal('),
      modal.indexOf('private renderAcceptedPhase('),
    );
    expect(refusal).toMatch(/this\.submitAnswer\(prompt, answer\)/);
    expect(refusal).not.toMatch(/attemptSequence|discardGrading/);
  });

  it('with the sequence unchanged, the resubmission seals the same rung the failed submission did', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    expect(sealAttemptSupport(sequence, UNAIDED)).toEqual(sealAttemptSupport(sequence, UNAIDED));
  });
});
