/**
 * Shapes `draftQuizCardsForConcept`'s raw `'drafted'` result into what the
 * cache stores (`ol-p3t07a`) — the generation-pipeline's own reading of the
 * public envelope.
 *
 * Reads only the PUBLIC envelope shape (`olea-contracts`' `WorkerResponse`:
 * `ok`/`stamp`/`result`), never the private `quizGenerateResponse` schema —
 * same discipline `draft-quiz-cards.ts` and `draft-cards-copy.ts` both state
 * for the same reason: this package has no dependency on `olea-service`'s
 * schema source.
 *
 * **No longer delegates to `retrieval/draft-cards-copy.ts`'s
 * `parseDraftedResponse`** (`[D-195]` / `ol-2zfj.57`). That function's
 * `distractors` check is `isStringArray` only — correct for the shape
 * `quiz.generate.v1` emitted before this bead, and still correct for
 * `draft-cards-controller.ts`'s withdrawn-modal caller, which this package
 * does not own and does not touch — but it would read `[D-195]`'s object
 * distractors (`{ text, believes, source_says }`) as an unrecognised shape
 * and report the whole response `unparseable`. `extractDraftedQuestions`
 * below restates the same envelope walk (`ok`/`result.questions`) with its
 * own distractor parsing that accepts EITHER shape, so this module keeps
 * working the day `quiz.generate.v1` bumps to 2.0.0 without needing the
 * shared copy module to grow a case it has no other caller for.
 */

import { TASK_IDS } from 'olea-contracts';
import type { DraftDistractorGrounding, DraftProvenance, DraftQuestion } from './types.js';

/**
 * A distractor as `quiz.generate.v1` v2.0.0 emits it (`[D-195]`) — `{ text,
 * believes, source_says }`, all non-empty (mirrors
 * `olea-service/src/tasks/quizGenerate.ts`'s private `distractorSchema`,
 * read for shape only, never imported).
 */
function isDistractorObjectShape(
  value: unknown,
): value is { text: string; believes: string; source_says: string } {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.text === 'string' &&
    typeof d.believes === 'string' &&
    typeof d.source_says === 'string'
  );
}

interface ParsedDistractor {
  readonly text: string;
  readonly grounding: DraftDistractorGrounding | null;
}

/**
 * One distractor entry, normalised out of EITHER shape `quiz.generate.v1`
 * has emitted across its lifetime: the pre-`[D-195]` bare string (`grounding:
 * null` — nothing to carry) or the `[D-195]` object (`text` kept for the
 * block, `believes`/`source_says` kept as grounding). `null` when the entry
 * matches neither — the caller treats the whole question as unparseable, the
 * same "do not guess" posture `parseDraftedResponse` takes for the envelope
 * as a whole.
 */
function parseDistractorEntry(value: unknown): ParsedDistractor | null {
  if (typeof value === 'string') return { text: value, grounding: null };
  if (isDistractorObjectShape(value)) {
    return {
      text: value.text,
      grounding: { believes: value.believes, source_says: value.source_says },
    };
  }
  return null;
}

function parseQuestion(value: unknown): DraftQuestion | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { stem, correctAnswer, distractors, feedback } = record;
  if (
    typeof stem !== 'string' ||
    typeof correctAnswer !== 'string' ||
    typeof feedback !== 'string' ||
    !Array.isArray(distractors)
  ) {
    return null;
  }

  const parsed: ParsedDistractor[] = [];
  for (const entry of distractors) {
    const one = parseDistractorEntry(entry);
    if (one === null) return null;
    parsed.push(one);
  }

  // `distractorGrounding` is omitted entirely (not an all-`null` array) when
  // nothing in the pool carried the `[D-195]` shape — the pre-`[D-195]`
  // bare-string response, and any older cached draft, has literally nothing
  // to report here, and `isDraftRecord`'s validator (`types.ts`) reads
  // `undefined` and an all-`null` array as the same "no grounding" fact, so
  // this is a size choice, not a correctness one.
  const grounding = parsed.map((d) => d.grounding);
  const hasGrounding = grounding.some((g) => g !== null);

  return {
    stem,
    correctAnswer,
    distractors: parsed.map((d) => d.text),
    feedback,
    ...(hasGrounding ? { distractorGrounding: grounding } : {}),
  };
}

/** `null` when the response's `result.questions` cannot be read as `DraftQuestion[]` (a Worker error, or a shape this package does not recognise) — the caller's job is to skip caching, not to guess. */
export function extractDraftedQuestions(response: unknown): readonly DraftQuestion[] | null {
  if (typeof response !== 'object' || response === null) return null;
  const envelope = response as Record<string, unknown>;
  if (envelope.ok !== true) return null;

  const result = envelope.result;
  if (typeof result !== 'object' || result === null) return null;
  const questionsRaw = (result as Record<string, unknown>).questions;
  if (!Array.isArray(questionsRaw)) return null;

  const questions: DraftQuestion[] = [];
  for (const raw of questionsRaw) {
    const question = parseQuestion(raw);
    if (question === null) return null;
    questions.push(question);
  }
  return questions;
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
