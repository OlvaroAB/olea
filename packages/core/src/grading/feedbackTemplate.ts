/**
 * The explain-back feedback template (`ol-egov.141.89.6.98`, `[D-318]`, F5.3).
 *
 * `[D-318]` option (a): pass one returns the verdict with cited findings and misconception
 * candidates, and CODE renders the feedback from them. This is that renderer: a pure function
 * of the verdict, `citedIssues` and `misconceptionCandidates`, exactly as
 * `gradingPipeline.ts` types them. The Worker's free-text `feedback` field is deliberately NOT
 * an input: where a model-written feedback writer is ever enabled it is an experiment behind
 * the same seam and never changes the verdict or invents a finding.
 *
 * Status: UNWIRED. Nothing calls this yet; `gradingPipeline.ts` still passes the Worker's
 * `feedback` through. Switching the caller changes what she reads and is held for review.
 *
 * Rules the function keeps (each pinned by `feedbackTemplate.spec.ts`):
 * - It adds no claim of its own. Every sentence is a fixed label, or text a
 *   finding or candidate carries.
 * - It renders no verdict and no word that grades the attempt as a whole (`[D-217]`): `verdict`
 *   is accepted for the caller's convenience and never rendered. No findings and no candidates
 *   gives an empty string.
 * - Her words are quoted only from a finding's `answerSpans`; the passage is never quoted
 *   beyond what a finding or candidate already says.
 * - Candidate `concept` / `confusedWith` are ids, not wording: never shown.
 * - Deterministic: same input, same text. No clock, no randomness, no locale.
 * - The words it adds itself (missing, mistaken, mixed up,
 *   you wrote, a belief to check, the passage says) are plain English and none is in the
 *   vocabulary registry's forbidden or retired lists.
 */

import type { CitedIssue, CitedIssueKind, MisconceptionCandidate } from './gradingPipeline.js';

export interface FeedbackTemplateInput {
  readonly verdict: 'correct' | 'partial' | 'incorrect';
  readonly citedIssues: readonly CitedIssue[];
  readonly misconceptionCandidates: readonly MisconceptionCandidate[];
}

const KIND_LABEL: Record<CitedIssueKind, string> = {
  omission: 'Missing',
  error: 'Mistaken',
  confusion: 'Mixed up',
};

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function quotedSpans(spans: readonly string[] | undefined): string {
  const kept = (spans ?? []).map(clean).filter((s) => s !== '');
  if (kept.length === 0) return '';
  return ` You wrote: ${kept.map((s) => `"${s}"`).join(', ')}.`;
}

function ensureStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Renders the feedback text. Findings first, in the order given, then candidates in the order given. */
export function renderExplainBackFeedback(input: FeedbackTemplateInput): string {
  const lines: string[] = [];

  for (const issue of input.citedIssues) {
    const description = clean(issue.description);
    if (description === '') continue;
    lines.push(
      `- ${KIND_LABEL[issue.kind]}: ${ensureStop(description)}${quotedSpans(issue.answerSpans)}`,
    );
  }

  for (const candidate of input.misconceptionCandidates) {
    const statement = clean(candidate.statement);
    const correction = clean(candidate.correction);
    if (statement === '' && correction === '') continue;
    const parts: string[] = [];
    if (statement !== '') parts.push(`A belief to check: ${ensureStop(statement)}`);
    if (correction !== '') parts.push(`The passage says: ${ensureStop(correction)}`);
    lines.push(`- ${parts.join(' ')}${quotedSpans(candidate.answerSpans)}`);
  }

  return lines.join('\n');
}
