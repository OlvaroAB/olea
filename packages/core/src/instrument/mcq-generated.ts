/**
 * The seam a generated MCQ crosses on its way into the vault (F3.4, INV-6, ol-4lme).
 *
 * `quiz.generate.v1` (`olea-service/src/tasks/quizGenerate.ts`) now requires
 * `feedback` on every question it returns — a `.min(1)` in the response
 * schema, enforced with the model's one retry, the same pattern F2.15's
 * distractor floor already uses. That guarantees the field exists on the
 * *generation* side of the wire. It does nothing on its own for the *accept*
 * side: `McqFields.feedback` (`mcq-format.ts`) is `string | null | undefined`
 * because a hand-authored MCQ legitimately has no feedback field at all —
 * F2.15 never required one for that path, only F3.4 does, and only for
 * generated items.
 *
 * `acceptGeneratedMcq` is that boundary made real. It is the one function
 * P3-T07b's accept step (ol-p3t07b, still open) is expected to call between
 * "she accepted this generated candidate" and `insertMcqBlock` — never
 * `insertMcqBlock` directly with a hand-assembled `McqFields`, because that
 * path can pass `feedback: null` and nothing stops it. Feeding a generated
 * candidate through here instead means a blank feedback string cannot reach
 * the vault silently: it throws, the same way `serializeMcq` already throws
 * rather than emit a block its own parser would reject.
 *
 * Deliberately **not** a change to `McqFields` or `McqInstrument` itself —
 * that would make feedback mandatory for hand-authored items too, which
 * nothing in F2.15 or F3.4 asks for and which INV-2's round-trip has no
 * reason to break. The mandatoriness belongs to the generation provenance,
 * not to the format.
 */

import type { McqFields } from './mcq-format.js';

/** One MCQ question exactly as `quiz.generate.v1`'s response schema shapes it. */
export interface GeneratedMcqCandidate {
  readonly stem: string;
  readonly correctAnswer: string;
  /** At least `MIN_DISTRACTOR_POOL` of them — the service schema already enforces this. */
  readonly distractors: readonly string[];
  /** F3.4's "with explanations". Required here for the same reason it is required on the wire. */
  readonly feedback: string;
}

/**
 * Turns an accepted generation candidate into the fields `insertMcqBlock`
 * writes to the vault. Throws if `feedback` is blank — a defensive check, not
 * a redundant one: the service's `.min(1)` guarantees the model's *response*
 * was non-blank, but says nothing about a client-side accept step that edits
 * the candidate before calling this (she can edit a generated draft before
 * accepting it, and an edit down to nothing is exactly the gap this closes).
 */
export function acceptGeneratedMcq(
  candidate: GeneratedMcqCandidate,
  id?: string | null,
): McqFields {
  const feedback = candidate.feedback.trim();
  if (feedback === '') {
    throw new Error(
      'acceptGeneratedMcq: generated MCQ carries no feedback; F3.4 requires an explanation for every generated question',
    );
  }
  return {
    stem: candidate.stem,
    answer: candidate.correctAnswer,
    distractors: candidate.distractors,
    feedback,
    id: id ?? null,
  };
}
