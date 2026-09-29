/**
 * The demand-carriage wire fragment for `quiz.generate.v1` and `cards.generate.v1`
 * (`[D-437]`, `[D-438]`; the service-repo design is `docs/dev/intelligence-build/demand-carriage.md`,
 * cited by path — private repo).
 *
 * **Why this file exists, and what it deliberately does not hold.** Both authoring tasks' request
 * and response bodies are defined by the Worker (`olea-service/src/tasks/quizGenerate.ts`,
 * `cardsGenerate.ts`) and restated by each client caller rather than imported, for the reason
 * `packages/core/src/oracle/paper-items.ts` gives for its own restatement. That stays true: this
 * file does not restate those bodies. It fixes only the ONE additive wire fragment the demand
 * carriage adds, the way `./explain-back-judge-target.ts` fixes the one fragment
 * `explain-back.judge.v1` gained (`[D-277]` (g)) — so that the vocabulary, the served-demand
 * declaration and the acknowledgement have a single definition both sides parse with, and a
 * drift check (`contracts/` in the service is a vendored copy) can see them move.
 *
 * ===========================================================================
 * THE FRAGMENT (design section 4.3, W1; amended by the 2026-09-29 rulings on rows 35 to 38)
 * ===========================================================================
 * Request, all optional; absent means today's request, byte for byte:
 *
 *  - `requestedAsk` — the PRIMARY authoring request (row 35): the heading exactly as she wrote
 *    it, and the question word read from it. Preserved whole; never reduced to a mapped word.
 *    "How" alone is not a complete demand specification, so a question word never travels
 *    without the heading.
 *  - `intendedDemand` — the SECONDARY mapping onto the five-word vocabulary (`[D-262]`), sent only
 *    when the mapping exists and the task serves it. It is authoring intent and nothing more
 *    (`[D-277]` (h)): it never records that the produced item delivers the demand.
 *
 * Response, task data:
 *
 *  - `demandAcknowledgement` — present exactly when the Worker read `intendedDemand` and applied
 *    it. Absent from an older Worker's response, which strips the unknown request key and authors
 *    as before: a caller that sent a demand and got no acknowledgement must not record the item
 *    as authored for it (the same skew rule `explainBackJudgeSpecificationAcknowledgement`
 *    states for `[D-277]` (g)).
 *  - `declaredDemand` per question — the author's own proposal, required when `intendedDemand`
 *    was sent. Consumed only to REFUSE (a proposal declaring a different demand than asked is an
 *    invalid draft, checked by the caller); a matching declaration is not evidence of delivery.
 *
 * ===========================================================================
 * ONE VOCABULARY, ONE DECLARATION OF WHAT IS SERVED
 * ===========================================================================
 * `authoringDemand` IS `explainBackJudgeDemand` — the same enum object, not a third restatement of
 * `PAPER_DEMANDS` (`packages/core/src/oracle/paper-types.ts`). The set-equality test that pins the
 * two lives in core, beside the second restatement.
 *
 * `AUTHORING_SERVED_DEMANDS` declares which demands each authoring task serves. It is a
 * DECLARED constant (a plain reading of what each generator's request/response shape can
 * produce — never fitted, safe to be public), and it is the one source both sides read: the Worker
 * refuses a request whose `intendedDemand` its task does not serve, and core's
 * `PAPER_GENERATOR_DECLARED_DEMANDS` is pinned equal to it by test. A generator's served set
 * widens to another demand only by a decision bead on the practice-authoring benchmark's
 * evidence, which is a change to this constant and so a contract change.
 */

import { z } from 'zod';
import { explainBackJudgeDemand } from './explain-back-judge-target.js';

/**
 * `[D-262]`'s five-word vocabulary, as the authoring wire carries it. The same enum
 * `explainBackJudgeDemand` is (see the module doc); named separately only so an authoring call
 * site reads as what it is.
 */
export const authoringDemand = explainBackJudgeDemand;
export type AuthoringDemand = z.infer<typeof authoringDemand>;

/**
 * The tasks that accept the fragment. `PaperGeneratorTaskId`
 * (`packages/core/src/oracle/paper-types.ts`) is the same pair on the client side.
 */
export const AUTHORING_DEMAND_TASK_IDS = Object.freeze([
  'cards.generate.v1',
  'quiz.generate.v1',
] as const);
export type AuthoringDemandTaskId = (typeof AUTHORING_DEMAND_TASK_IDS)[number];

/**
 * What each authoring task serves. Both existing generators produce recall-style items only (a
 * flashcard, or a multiple-choice question); neither has any notion of calculation, comparison,
 * transfer to an unfamiliar case or a printed-result stimulus. Widening a set is a decision
 * bead, never an edit made in passing.
 *
 * @provenance declared
 */
export const AUTHORING_SERVED_DEMANDS: Readonly<
  Record<AuthoringDemandTaskId, readonly AuthoringDemand[]>
> = Object.freeze({
  'cards.generate.v1': Object.freeze(['recall-a-fact'] as const),
  'quiz.generate.v1': Object.freeze(['recall-a-fact'] as const),
});

/** `true` when `taskId` serves `demand` — the whole of the Worker's pre-call refusal. */
export function authoringDemandServed(
  taskId: AuthoringDemandTaskId,
  demand: AuthoringDemand,
): boolean {
  return AUTHORING_SERVED_DEMANDS[taskId].includes(demand);
}

/**
 * The primary authoring request (row 35): the heading as she wrote it and the question word read
 * from it. `heading` is content that travels transiently, like `sourceChunks` (D-005): the Worker
 * builds a prompt from it and forgets it. It is never trimmed or normalised here, because the
 * ruling is that the full heading survives; the only refusal is a blank one.
 */
export const authoringRequestedAsk = z.object({
  heading: z.string().refine((value) => value.trim() !== '', {
    message: 'heading must not be blank.',
  }),
  /** The question word as it was read (for example the interrogative opening the heading), or absent when the heading has none. Never a mapped word. */
  questionWord: z.string().min(1).optional(),
});
export type AuthoringRequestedAsk = z.infer<typeof authoringRequestedAsk>;

/** The request's secondary mapping, optional. */
export const authoringIntendedDemandField = authoringDemand.optional();

/** The request's primary ask, optional. */
export const authoringRequestedAskField = authoringRequestedAsk.optional();

/**
 * The response-level acknowledgement: what the Worker read and applied. It echoes the demand and
 * says nothing about delivery — `[D-277]` (h) and `[D-310]`: the author's reading of its own
 * output is not consumable evidence.
 */
export const authoringDemandAcknowledgement = z.object({
  intendedDemand: authoringDemand,
});
export type AuthoringDemandAcknowledgement = z.infer<typeof authoringDemandAcknowledgement>;

/**
 * The per-question proposal, optional in the schema because the absent path never carries it;
 * REQUIRED whenever the request carried `intendedDemand`, which a schema cannot say (it is
 * request-relative) and the Worker's grounding check enforces.
 */
export const authoringDeclaredDemandField = authoringDemand.optional();
