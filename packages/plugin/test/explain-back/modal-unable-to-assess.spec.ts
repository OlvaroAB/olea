/**
 * `[D-321]` / `ol-0r92.130`: `ExplainBackModal` must handle the judge's
 * `unable-to-assess` outcome (`GroundedGrading`'s `outcome:
 * 'unable-to-assess'` branch, `olea-core`) — no grade shown, no verdict
 * badge, nothing written, misconception/mastery never run off it, and no
 * referral to item validation. Checked against the source text with
 * comments stripped, the same technique `skip-wiring.spec.ts` and
 * `modal-restatement-no-gate.spec.ts` already use for anything inside
 * `ExplainBackModal`, which cannot be imported under Vitest (`obsidian`'s
 * `package.json` `main` is `""`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — see this file's module doc. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

function bodyBetween(startMarker: string, endMarker: string): string {
  const start = modal.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = modal.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return modal.slice(start, end);
}

describe('renderGradedPhase — branches on the unable-to-assess outcome before touching any graded-only field', () => {
  it('checks grading.outcome and delegates to renderUnableToAssessPhase, returning before the feedback paragraph', () => {
    const body = bodyBetween('private renderGradedPhase(', 'private renderUnableToAssessPhase(');
    const guardIndex = body.search(/grading\.outcome\s*===\s*'unable-to-assess'/);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(body).toMatch(/this\.renderUnableToAssessPhase\(root, prompt, answer, pending\)/);
    // The guard's own `return;` must precede the feedback paragraph and the
    // Accept button — never fall through to render graded-only content.
    const returnIndex = body.indexOf('return;', guardIndex);
    const feedbackIndex = body.indexOf("cls: 'olea-explain-back-feedback'");
    const acceptButtonIndex = body.indexOf('EXPLAIN_BACK_ACCEPT_LABEL');
    expect(returnIndex).toBeGreaterThan(guardIndex);
    expect(returnIndex).toBeLessThan(feedbackIndex);
    expect(returnIndex).toBeLessThan(acceptButtonIndex);
  });
});

describe('renderUnableToAssessPhase — no grade, no verdict badge, no Accept button, nothing written', () => {
  const body = bodyBetween('private renderUnableToAssessPhase(', 'private renderGradedRegions(');

  it('renders the placeholder message and only the Try again (discard) action', () => {
    expect(body).toMatch(/EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE/);
    expect(body).toMatch(/EXPLAIN_BACK_DISCARD_LABEL/);
    expect(body).toMatch(/this\.discardGrading\(prompt, answer, pending\)/);
  });

  it('never renders an Accept button, a verdict, feedback text or any grading-content region', () => {
    expect(body).not.toMatch(/EXPLAIN_BACK_ACCEPT_LABEL/);
    expect(body).not.toMatch(/this\.acceptGrading\(/);
    expect(body).not.toMatch(/grading\.feedback/);
    expect(body).not.toMatch(/grading\.missedPoints/);
    expect(body).not.toMatch(/grading\.citedIssues/);
    expect(body).not.toMatch(/grading\.misconceptionCandidates/);
    expect(body).not.toMatch(/renderGradedRegions/);
  });

  it('calls nothing that could write to her log, run misconception matching, run mastery, or refer the instrument to validation', () => {
    expect(body).not.toMatch(/acceptWithObservation/);
    expect(body).not.toMatch(/recordSoloGradeAndReview/);
    expect(body).not.toMatch(/appendReviewLogRecord/);
    expect(body).not.toMatch(/validation/i);
    expect(body).not.toMatch(/referr?al/i);
  });
});

describe('acceptGrading / computeAcceptGrading — unreachable from the unable-to-assess branch', () => {
  it('the Accept button (the only caller of acceptGrading) is created exclusively inside the graded branch of renderGradedPhase, after the unable-to-assess early return', () => {
    const gradedPhaseBody = bodyBetween(
      'private renderGradedPhase(',
      'private renderUnableToAssessPhase(',
    );
    // Exactly one Accept-button wiring site in this whole file, and it lives
    // in renderGradedPhase's graded tail (which the unable-to-assess branch
    // above provably returns before reaching).
    const acceptCalls = modal.match(/void this\.acceptGrading\(/g) ?? [];
    expect(acceptCalls).toHaveLength(1);
    expect(gradedPhaseBody).toMatch(/void this\.acceptGrading\(/);
  });
});
