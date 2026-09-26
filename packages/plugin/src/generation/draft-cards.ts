/**
 * `draftCardsForConcept` — the card-drafting step that calls `cards.generate.v1`
 * (`ol-0r92.116`, `[D-353]`'s drafting half).
 *
 * **Mirrors `../retrieval/draft-quiz-cards.ts`'s `draftQuizCardsForConcept`
 * line for line on purpose.** Same grounding gate (`[D-089]`'s two-threshold
 * band at the `[D-112]` operating point, composed with `[D-192]`'s composite
 * lower-bar veto), same `WorkerGroundingJudge`, same F3.8 personalization
 * context, same F3.8/`[D-188]` purpose/register-hint pass-through, same
 * "refused retrieval never reaches the generative transport" load-bearing
 * control flow, same "raw response, never validated against the private
 * schema, never persisted" posture (D-005). Only the task id and the request
 * payload shape (no `questionCount`, cards have none in `cardsGenerateRequest`)
 * differ, plus the response's `cards[]` shape (`front`/`back`/`subject`) in
 * place of `questions[]`.
 *
 * **Why a new file in `generation/`, not a change to `draft-quiz-cards.ts`
 * itself.** This bead's `owns` is `packages/plugin/src/generation/`,
 * exactly; `retrieval/` belongs to a different lane's `owns` this round
 * (`ol-0r92.117`'s `draft-cards-controller.ts`/`draft-cards-copy.ts`). Rather
 * than fork the grounding logic into a duplicate copy that could drift from
 * `draft-quiz-cards.ts`'s, this file imports `WorkerGroundingJudge` and the
 * `GenerationPurpose`/`RegisterHint` types straight from that module (a
 * read, not an edit — importing across a package's own directories needs no
 * ownership change) and only restates what genuinely differs: the payload
 * shape and the task id.
 *
 * **What this file deliberately does NOT do**, same posture
 * `draft-quiz-cards.ts` states for itself: it does not decide whether a
 * generated card is the concept's primary kind (`primary-kind.ts`'s
 * `primaryKindFor`, `[D-238]`, is a caller's job — `pipeline.ts`'s, not
 * this file's), does not cache a `DraftRecord`, does not open a draft/accept
 * modal, and does not record an accept/edit/reject event. Those remain
 * `pipeline.ts`'s integration to make (out of this bead's `owns` — see this
 * package's own lane notes: `pipeline.ts`/`cache-store.ts` changed the same
 * day this bead was worked and are owned by a different lane this round) and
 * `response.ts`'s `extractDraftedCards`/`extractDraftedCardsProvenance`
 * (added by this bead, in this same directory) are what a future
 * `pipeline.ts` integration would call to shape this file's raw `response`
 * into a `DraftRecord.card`.
 */

import { CONTRACT_VERSION, TASK_IDS } from 'olea-contracts';
import type {
  ClassifiedPassage,
  PassageAuthorship,
  PassageCurationAuthority,
  VoiceExemplars,
  WorkerTaskTransport,
} from 'olea-core';
import {
  assembleVoiceExemplars,
  D112_GROUNDING_BAND,
  type GateStage,
  type GroundingRefusalReason,
  type JudgeRequestRecord,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
  type RetrieveDeps,
  retrieve,
} from 'olea-core';
import type { GenerationPurpose, RegisterHint } from '../retrieval/draft-quiz-cards.js';
import { WorkerGroundingJudge } from '../retrieval/workerGroundingJudge.js';

/**
 * `cards.generate.v1`'s request shape, restated locally rather than imported
 * from the private service repo — the same discipline
 * `draft-quiz-cards.ts`'s `QuizGenerateRequestPayload` states for itself:
 * this package has no dependency on `olea-service`'s prompt or schema
 * source, by construction. Field-for-field match with
 * `olea-service/src/tasks/cardsGenerate.ts`'s `cardsGenerateRequest` zod
 * schema (private; read for shape only, never quoted): `courseCode` and
 * `conceptName` are both required, `sourceChunks` is a plain string array.
 * No `questionCount` — `cardsGenerateRequest` has no such field; the prompt
 * decides how many cards a sweep of source material is worth.
 * `personalization`/`purpose`/`registerHint` mirror
 * `QuizGenerateRequestPayload`'s own fields one-for-one, same defaults, same
 * "absent means today's byte-identical behaviour" posture.
 */
export interface CardsGenerateRequestPayload {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly sourceChunks: readonly string[];
  readonly personalization?: {
    readonly voiceExemplars: VoiceExemplars;
  };
  readonly purpose?: GenerationPurpose;
  readonly registerHint?: RegisterHint;
}

/**
 * `cards.generate.v1`'s response shape, restated for the same reason —
 * mirrors `cardsGenerateResponse` in the private service repo. `subject`
 * (`[D-185]`/C5.11) is the one scoring concept the card counts as evidence
 * for; this module never validates a real response against the schema (see
 * the module doc), so a caller of `DraftedCards` has something more specific
 * than `unknown` to narrow into.
 */
export interface CardsGenerateResponsePayload {
  readonly cards: readonly {
    readonly front: string;
    readonly back: string;
    readonly subject: string;
  }[];
}

export interface DraftCardsRequest {
  readonly courseCode: string;
  readonly conceptName: string;
  /** `[D-188]` / `ol-0r92.35` — see `DraftQuizCardsRequest`'s own doc for the identical field. */
  readonly purpose?: GenerationPurpose;
  /** `[D-188]`'s register hint — see `DraftQuizCardsRequest`'s own doc for the identical field. */
  readonly registerHint?: RegisterHint;
}

export type DraftCardsResult =
  | {
      readonly status: 'refused';
      /** Same `GroundingRefusalReason` union `draftQuizCardsForConcept` returns — see that type's own doc. */
      readonly reason: GroundingRefusalReason;
    }
  | {
      readonly status: 'drafted';
      readonly request: CardsGenerateRequestPayload;
      /** The Worker's raw `/v1/task` response body. Never persisted here (D-005); see the module doc. */
      readonly response: unknown;
    };

export interface DraftCardsDeps {
  /** Everything `retrieve()` needs — see `DraftQuizCardsDeps.retrieve`'s own doc. */
  readonly retrieve: RetrieveDeps;
  /** Sends the `cards.generate.v1` envelope. See `DraftQuizCardsDeps.transport`'s own doc. */
  readonly transport: WorkerTaskTransport;
  /** `[D-101]`'s passage classification — see `DraftQuizCardsDeps.classifyPassage`'s own doc. */
  readonly classifyPassage?: (chunk: { readonly path: string; readonly text: string }) =>
    | {
        readonly authorship: PassageAuthorship;
        readonly curationAuthority: PassageCurationAuthority;
      }
    | undefined;
  /** `[JEV-11]` — see `DraftQuizCardsDeps.onStage`'s own doc. */
  readonly onStage?: (stage: GateStage) => void;
  /** `[JEV-6]` — see `DraftQuizCardsDeps.onJudgeRequest`'s own doc. */
  readonly onJudgeRequest?: (record: JudgeRequestRecord) => void;
}

/**
 * Drafts `cards.generate.v1` cards for one concept — the card-shaped sibling
 * of `draftQuizCardsForConcept` (`../retrieval/draft-quiz-cards.js`). See
 * that function's own doc for the grounding-gate argument (band + composite
 * veto, explicit on every call, never a default); it is reproduced here
 * verbatim rather than factored into a shared helper, matching this
 * package's existing convention of one small, independently-readable
 * function per generative task (`draft-quiz-cards.ts` does not import from
 * this file either).
 */
export async function draftCardsForConcept(
  deps: DraftCardsDeps,
  request: DraftCardsRequest,
): Promise<DraftCardsResult> {
  const grounding = await retrieve(deps.retrieve, request.conceptName, {
    band: D112_GROUNDING_BAND,
    requireComposite: true,
    compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
    judge: new WorkerGroundingJudge({ transport: deps.transport }),
    ...(deps.onStage !== undefined ? { onStage: deps.onStage } : {}),
    ...(deps.onJudgeRequest !== undefined ? { onJudgeRequest: deps.onJudgeRequest } : {}),
  });

  if (grounding.status === 'refused') {
    // THE load-bearing line — see `draftQuizCardsForConcept`'s own doc: the
    // generative `transport.send` call never happens once we are here.
    return { status: 'refused', reason: grounding.reason };
  }

  const classifiedPassages: ClassifiedPassage[] = grounding.chunks.map((chunk) => {
    const classified = deps.classifyPassage?.(chunk);
    return {
      text: chunk.text,
      authorship: classified?.authorship ?? 'unknown',
      curationAuthority: classified?.curationAuthority ?? 'unknown',
    };
  });
  const voiceExemplars = assembleVoiceExemplars(classifiedPassages);

  const payload: CardsGenerateRequestPayload = {
    courseCode: request.courseCode,
    conceptName: request.conceptName,
    sourceChunks: grounding.chunks.map((chunk) => chunk.text),
    personalization: { voiceExemplars },
    ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
    ...(request.registerHint === undefined ? {} : { registerHint: request.registerHint }),
  };

  const response = await deps.transport.send({
    contractVersion: CONTRACT_VERSION,
    taskId: TASK_IDS.CARDS_GENERATE,
    payload,
  });

  return { status: 'drafted', request: payload, response };
}
