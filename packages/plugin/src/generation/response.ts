/**
 * Shapes `draftQuizCardsForConcept`'s raw `'drafted'` result into what the
 * cache stores (`ol-p3t07a`) — the generation-pipeline's own reading of the
 * public envelope, parallel to `retrieval/draft-cards-copy.ts`'s
 * `parseDraftedResponse` (reused here directly for the question list) plus
 * the D7.3 provenance triple that file never needed.
 *
 * Reads only the PUBLIC envelope shape (`olea-contracts`' `WorkerResponse`:
 * `ok`/`stamp`/`result`), never the private `quizGenerateResponse` schema —
 * same discipline `draft-quiz-cards.ts` and `draft-cards-copy.ts` both state
 * for the same reason: this package has no dependency on `olea-service`'s
 * schema source.
 */

import { TASK_IDS } from 'olea-contracts';
import { parseDraftedResponse } from '../retrieval/draft-cards-copy.js';
import type { DraftProvenance, DraftQuestion } from './types.js';

/** `null` when the response's `result.questions` cannot be read as `DraftQuestion[]` (a Worker error, or a shape this package does not recognise) — the caller's job is to skip caching, not to guess. */
export function extractDraftedQuestions(response: unknown): readonly DraftQuestion[] | null {
  const parsed = parseDraftedResponse(response);
  return parsed.kind === 'drafted' ? parsed.questions : null;
}

/**
 * D7.3's provenance triple: `taskId` is a local constant (this call is
 * always `quiz.generate.v1` — `draftQuizCardsForConcept`'s own module doc),
 * `promptVersion`/`modelId` come from the envelope's `stamp` (`worker.ts`'s
 * `responseStamp`, the same values `contracts/worker.ts`'s doc says the
 * client persists onto the artifact it produced). `null` when `stamp` is
 * missing or malformed — a caller that cannot prove provenance does not
 * cache the draft, matching D-005's "never guess" posture for the same
 * triple `verdictLogRecordV4` requires non-empty.
 */
export function extractDraftedProvenance(response: unknown): DraftProvenance | null {
  if (typeof response !== 'object' || response === null) return null;
  const envelope = response as Record<string, unknown>;
  if (envelope.ok !== true) return null;
  const stamp = envelope.stamp;
  if (typeof stamp !== 'object' || stamp === null) return null;
  const s = stamp as Record<string, unknown>;
  if (typeof s.promptVersion !== 'string' || s.promptVersion.length === 0) return null;
  if (typeof s.modelId !== 'string' || s.modelId.length === 0) return null;
  return {
    taskId: TASK_IDS.QUIZ_GENERATE,
    promptVersion: s.promptVersion,
    modelId: s.modelId,
  };
}
