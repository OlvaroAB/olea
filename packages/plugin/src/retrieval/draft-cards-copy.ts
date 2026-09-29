/**
 * `draft-cards-copy.ts` — the strings and the response-shaping logic for a
 * card-drafting outcome, kept obsidian-free (same split `settings-tab.ts`'s
 * module doc documents for `degradation-statement.ts` and the
 * `*-field-copy.ts` files) so the part that could actually be wrong — the
 * copy, and how a raw Worker envelope turns into something a caller can
 * render — is unit-testable under plain Vitest.
 *
 * `runDraftCards` (`draft-cards-controller.ts`), the withdrawn modal's
 * controller, was removed as dead code (`ol-0r92.117`; no production caller
 * ever existed for it — the modal it served was withdrawn under F4.5). This
 * module's own exports outlived it: `describeRefusal` is production-live via
 * `generation/pipeline.ts`'s automatic sweep and `review/heading-offer.ts`,
 * and `parseDraftedResponse` is exercised by its own tests. A future
 * card-drafting step (`ol-0r92.116`) drafts a different, front/back card
 * shape and would not reuse `DraftedQuestionView`/`ParsedDraftResponse`
 * as-is, but may still want `describeRefusal`'s refusal-copy mapping.
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
 * broken" way `commands/create-card.ts`'s `CREATE_CARD_NO_SELECTION_NOTICE`
 * is.
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

/**
 * The four refusal outcomes `evd.md` §3 and `[D-289]` keep apart
 * (`ol-egov.141.89.1.44`). Only `source-insufficient` is a checked verdict
 * about her material; the other three are operational.
 */
export type RefusalOutcome =
  | 'retrieval-failure'
  | 'source-insufficient'
  | 'judgment-uncertain'
  | 'service-failure'
  /**
   * `below-relevance-threshold`, `below-composite-threshold`, `below-band`.
   * Unclassified: whether these are retrieval failures or checked
   * insufficiency is not ruled, so they keep their previous words and
   * non-transient flag under their own value, pending a decision.
   */
  | 'below-threshold';

export interface RefusalCopy {
  readonly headline: string;
  /** Which of the four outcomes this is; stays distinct even where two share words. */
  readonly outcome: RefusalOutcome;
  /**
   * `true` for every operational outcome (all but `source-insufficient`) —
   * the caller can offer a retry rather than treating the refusal as a
   * verdict about her material, without re-deriving it from the reason.
   */
  readonly transient: boolean;
}

const NOT_ENOUGH_GROUNDING_HEADLINE =
  "Olea didn't find enough grounding in your notes for this yet.";
const COULD_NOT_CHECK_HEADLINE = 'Olea couldn’t check your notes just now — try again in a moment.';

/*
 * The vocabulary registry has no wording of its own for the three operational
 * outcomes; `evd.md` §3 names "Olea could not check right now" as the
 * operational sentence, so all three reuse today's approved could-not-check
 * string. The `outcome` value keeps them distinct underneath.
 */
const SOURCE_INSUFFICIENT: RefusalCopy = {
  headline: NOT_ENOUGH_GROUNDING_HEADLINE,
  outcome: 'source-insufficient',
  transient: false,
};
const BELOW_THRESHOLD: RefusalCopy = {
  headline: NOT_ENOUGH_GROUNDING_HEADLINE,
  outcome: 'below-threshold',
  transient: false,
};
const RETRIEVAL_FAILURE: RefusalCopy = {
  headline: COULD_NOT_CHECK_HEADLINE,
  outcome: 'retrieval-failure',
  transient: true,
};
const JUDGMENT_UNCERTAIN: RefusalCopy = {
  headline: COULD_NOT_CHECK_HEADLINE,
  outcome: 'judgment-uncertain',
  transient: true,
};
const SERVICE_FAILURE: RefusalCopy = {
  headline: COULD_NOT_CHECK_HEADLINE,
  outcome: 'service-failure',
  transient: true,
};

/** An empty package: retrieval gave the judge nothing (`[D-289]` point 2). */
const RETRIEVAL_FAILURE_REASONS: ReadonlySet<string> = new Set(['no-hits']);

/** Classification waits on a decision; see `BELOW_THRESHOLD`. */
const BELOW_THRESHOLD_REASONS: ReadonlySet<string> = new Set([
  'below-relevance-threshold',
  'below-composite-threshold',
  'below-band',
]);

/** The check itself could not run (`ol-riwn`, `[D-089]` §5). */
const SERVICE_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'composite-check-unavailable',
  'judge-unavailable',
]);

/**
 * Maps a `GroundingRefusalReason` (`olea-core`'s `groundedContext.ts`), or
 * the judge's `could-not-decide`, to copy for the modal. Only the judge's own
 * rejection (`judge-rejected`) is "checked, and there isn't enough here"; an
 * empty or irrelevant retrieval is operational (`[D-289]` point 2), never a
 * verdict about her notes. A reason this file has never seen defaults to
 * `source-insufficient`, the family that claims no failure it cannot name.
 */
export function describeRefusal(reason: string): RefusalCopy {
  if (RETRIEVAL_FAILURE_REASONS.has(reason)) return RETRIEVAL_FAILURE;
  if (BELOW_THRESHOLD_REASONS.has(reason)) return BELOW_THRESHOLD;
  if (SERVICE_FAILURE_REASONS.has(reason)) return SERVICE_FAILURE;
  if (reason === 'could-not-decide') return JUDGMENT_UNCERTAIN;
  return SOURCE_INSUFFICIENT;
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
