/**
 * `draft-cards-copy.ts` — the strings and the response-shaping logic for
 * `draft-cards-modal.ts`, kept obsidian-free (same split
 * `settings-tab.ts`'s module doc documents for `degradation-statement.ts`
 * and the `*-field-copy.ts` files) so the part that could actually be wrong
 * — the copy, and how a raw Worker envelope turns into something a modal can
 * render — is unit-testable under plain Vitest.
 *
 * **The refusal copy is the load-bearing part of this file.** `ol-riwn` /
 * `[D-089]` rule that an "I could not check" refusal must never read as "your
 * notes don't cover this" — the two are different facts and conflating them
 * is the exact failure `ol-riwn` diagnosed and `groundedContext.ts` now fixes
 * at the type level with `'composite-check-unavailable'` as its own
 * `GroundingRefusalReason`. `describeRefusal` below is where that
 * distinction either survives into what she reads, or gets flattened back
 * into one generic "no" — so its test asserts the transient reason's copy
 * and the other three reasons' copy are never textually identical.
 *
 * **Voice charter (`[D-096]`).** Every string below names Olea or no actor,
 * never "the system"; none apologises; none states a verdict on her or her
 * notes ("you didn't take enough notes" is exactly the wrong reading — the
 * limit is Olea's reach into the material, never her effort).
 *
 * **Reads `GroundingRefusalReason` as a family, not a fixed list of five.**
 * `[D-089]`'s band posture (landed in `olea-core` concurrently with this
 * bead) added `'below-band'`, `'judge-rejected'` and `'judge-unavailable'`
 * to the four `draftQuizCardsForConcept` could already produce, and this
 * package does not own that file. `describeRefusal` below classifies by a
 * `TRANSIENT_REASONS` set rather than an exhaustive switch, so a reason this
 * file has never seen defaults to the *safer* family — "not enough
 * grounding" — rather than silently claiming a transient failure that was
 * never named as one.
 */

export const DRAFT_CARDS_MODAL_TITLE = 'Draft quiz cards';

export const COURSE_CODE_FIELD_NAME = 'Course';
export const COURSE_CODE_FIELD_PLACEHOLDER = 'Course code, as it appears in your vault';

export const CONCEPT_FIELD_NAME = 'Concept';
export const CONCEPT_FIELD_PLACEHOLDER = 'What is this about?';

export const SUBMIT_BUTTON_LABEL = 'Draft cards';
export const LOADING_MESSAGE = 'Checking your notes…';

/**
 * F7.8's degradation statement, restated for this entry point: shown instead
 * of opening the modal at all when no Worker connection is configured, the
 * same "AI is optional, and honestly absent rather than broken-looking"
 * posture `degradation-statement.ts` states for the settings pane.
 */
export const AI_NOT_CONFIGURED_NOTICE =
  'Olea: drafting cards needs an AI connection — add one in Settings → Olea first.';

/**
 * Shown on an accept press. Nothing downstream of this modal writes to her
 * vault yet or records an accept/edit/reject event (`ol-548w`,
 * `ol-p3t07a`'s full scope) — this is the disclosed seam, not a bug: the
 * ask this bead was built against is a reachable, honest ask-and-show
 * surface, not the full triage flow. Phrased the same "isn't built yet, not
 * broken" way `commands/placeholders.ts`'s `NOT_YET_BUILT_SUFFIX` is.
 */
export const ACCEPT_NOT_WIRED_NOTICE =
  "Olea: saving accepted cards to your notes isn't built yet — it's coming in a later update. This card stays here, and rejecting or leaving it does nothing to your vault either way.";

/** One drafted question, shaped for rendering — mirrors `QuizGenerateResponsePayload['questions'][number]`. */
export interface DraftedQuestionView {
  readonly stem: string;
  readonly correctAnswer: string;
  readonly distractors: readonly string[];
  readonly feedback: string;
}

export interface RefusalCopy {
  readonly headline: string;
  /**
   * `true` for `'composite-check-unavailable'` only — the caller can use
   * this to offer a retry affordance rather than treating the refusal as a
   * verdict about her material, without needing to re-derive the mapping
   * from the reason string itself.
   */
  readonly transient: boolean;
}

const NOT_ENOUGH_GROUNDING: RefusalCopy = {
  headline: "Olea didn't find enough grounding in your notes for this yet.",
  transient: false,
};

const COULD_NOT_CHECK: RefusalCopy = {
  headline: 'Olea couldn’t check your notes just now — try again in a moment.',
  transient: true,
};

/**
 * The `GroundingRefusalReason` members that mean "the check itself could not
 * run" (`ol-riwn`, `[D-089]` §5) rather than "checked, and it doesn't cover
 * this" — `composite-check-unavailable` (the single-gate mechanism) and its
 * band-path sibling `judge-unavailable`. Every other current and future
 * reason falls through to `NOT_ENOUGH_GROUNDING` by default — see the module
 * doc for why that default direction is the safe one.
 */
const TRANSIENT_REASONS: ReadonlySet<string> = new Set([
  'composite-check-unavailable',
  'judge-unavailable',
]);

/**
 * Maps a `GroundingRefusalReason` (`olea-core`'s `groundedContext.ts`) to
 * copy for the modal. Most reasons are "checked, and there isn't enough
 * here" in different ways — no hits at all, hits that don't clear the
 * per-hit relevance bar, hits that don't clear `[D-042]`'s composite, every
 * numeric signal below the band's lower bar, or the judge reading the
 * passages and finding they don't support the query. She does not need
 * those told apart, and collapsing them into one honest sentence is a
 * feature, not a corner cut. `TRANSIENT_REASONS` above is categorically
 * different — the check never ran at all — and `ol-riwn` is the whole reason
 * this function does not fold those into the rest.
 */
export function describeRefusal(reason: string): RefusalCopy {
  return TRANSIENT_REASONS.has(reason) ? COULD_NOT_CHECK : NOT_ENOUGH_GROUNDING;
}

export type ParsedDraftResponse =
  | { readonly kind: 'drafted'; readonly questions: readonly DraftedQuestionView[] }
  | { readonly kind: 'worker-error'; readonly message: string }
  | { readonly kind: 'unparseable' };

const GENERIC_WORKER_ERROR_MESSAGE = 'Olea could not draft cards right now.';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseQuestion(value: unknown): DraftedQuestionView | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { stem, correctAnswer, distractors, feedback } = record;
  if (
    typeof stem !== 'string' ||
    typeof correctAnswer !== 'string' ||
    !isStringArray(distractors) ||
    typeof feedback !== 'string'
  ) {
    return null;
  }
  return { stem, correctAnswer, distractors, feedback };
}

/**
 * Turns `draftQuizCardsForConcept`'s `'drafted'` result's raw `response`
 * (the Worker's `/v1/task` body, `unknown` by that module's own design — see
 * `draft-quiz-cards.ts`'s module doc) into something the modal can render.
 *
 * Deliberately does not import `quizGenerateResponse` — that schema is
 * private to `olea-service` (same discipline `draft-quiz-cards.ts` already
 * states for the request shape). This reads only the PUBLIC envelope shape
 * (`WorkerResponse`'s `ok`/`result`/`message` fields, `olea-contracts`) plus
 * a local, best-effort shape check on `result.questions` — a field this
 * package invented no schema for and does not own.
 */
export function parseDraftedResponse(response: unknown): ParsedDraftResponse {
  if (typeof response !== 'object' || response === null) return { kind: 'unparseable' };
  const envelope = response as Record<string, unknown>;

  if (envelope.ok === false) {
    const message =
      typeof envelope.message === 'string' && envelope.message.trim().length > 0
        ? envelope.message
        : GENERIC_WORKER_ERROR_MESSAGE;
    return { kind: 'worker-error', message };
  }

  if (envelope.ok !== true) return { kind: 'unparseable' };

  const result = envelope.result;
  if (typeof result !== 'object' || result === null) return { kind: 'unparseable' };
  const questionsRaw = (result as Record<string, unknown>).questions;
  if (!Array.isArray(questionsRaw)) return { kind: 'unparseable' };

  const questions: DraftedQuestionView[] = [];
  for (const raw of questionsRaw) {
    const question = parseQuestion(raw);
    if (question === null) return { kind: 'unparseable' };
    questions.push(question);
  }
  return { kind: 'drafted', questions };
}
