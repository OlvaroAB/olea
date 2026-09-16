/**
 * `fillPaperBlueprintSlots` — turns a blueprint's slots into generated items, through the
 * EXISTING `cards.generate.v1` / `quiz.generate.v1` generators, via an injected port.
 *
 * **This module writes no prompt and makes no network call.** `PaperItemGenerationPort` is the
 * seam — the same "the reasoning lives here, the transport is injected" shape
 * `../retrieval/workerProvider.ts`'s `WorkerTaskTransport` already holds for embeddings, and the
 * same "define the port at the point of use, let the composition root implement it" idiom
 * `../generation/pipeline.ts`'s `GenerationPipelineDeps.draftForConcept` already follows for
 * `quiz.generate.v1` card drafting. `packages/plugin/src/oracle/` composes the real
 * implementation over `WorkerTaskTransport`; this package never imports a transport, an HTTP
 * client, or a prompt string.
 *
 * **Why this is not simply `draftQuizCardsForConcept` (`../../plugin/src/retrieval/draft-quiz-
 * cards.ts`).** That function does its OWN retrieval — it calls `retrieve()` to find grounding
 * chunks for a concept fresh, from a query. A blueprint slot has already chosen its held source
 * (F4.11's composition: course scope, structure, coverage and mastery decided WHICH source grounds
 * this slot before generation is ever reached) — re-running retrieval here would silently
 * substitute the composition's own choice for a fresh nearest-neighbour search, which is exactly
 * the kind of "the mechanism decided something, then a shortcut re-decided it" bug this
 * pipeline's whole point is to avoid. So the port here takes explicit `sourceChunks` (the slot's
 * own `PaperBlueprintSlot.sourceChunks`) rather than a concept name to search from.
 *
 * **F4.10 at slot grain, applied here rather than assumed at blueprint time.** `buildPaperBlueprint`
 * already leaves a concept with no held source as an `emptySlot` (never invented); this module
 * adds the SECOND gate — a slot that reaches generation but comes back refused (the port's own
 * `'refused'` status, e.g. the service's own INV-5 `emptyContextGuard` judging the held chunks
 * ungroundable after all) is ALSO recorded as empty, never silently dropped and never retried with
 * something invented.
 *
 * **The T3-margin gap is real and not closed by this module.** `[D-250]`'s tier 6d permits one
 * labelled model-extended item at a slot no held source can fill; neither `cards.generate.v1` nor
 * `quiz.generate.v1` has such a mode (confirmed against `docs/dev/paper-blueprint-design.md`'s
 * "The T3-margin gap" section, private repo, `[NEW-E4]`). A blueprint's own `emptySlots` already
 * carry this reason from `buildPaperBlueprint`; this module does not attempt to synthesize a T3
 * item through either existing port, which would mean fabricating a mode neither generator has.
 */

import type {
  PaperBlueprint,
  PaperBlueprintSlot,
  PaperEmptySlot,
  PaperGeneratorTaskId,
  PaperGroundingTier,
} from './paper-types.js';

/** The request a `PaperItemGenerationPort` implementation sends — field-for-field the shape `cards.generate.v1`/`quiz.generate.v1` already expect (mirrors `../../plugin/src/retrieval/draft-quiz-cards.ts`'s `QuizGenerateRequestPayload`, restated here for the same "this package has no dependency on the private task schema" reason that file states for its own restatement). `purpose` is always `'readiness'` — F4.8's rule that an exercise-paper item is always format-matched. */
export interface PaperItemGenerationRequest {
  readonly taskId: PaperGeneratorTaskId;
  readonly courseCode: string;
  readonly conceptName: string;
  readonly sourceChunks: readonly string[];
  readonly purpose: 'readiness';
}

/** `'refused'` covers both a port that could not even attempt the call and a generator's own INV-5 refusal — this module treats both identically (F4.10: neither is filled with anything invented). `reason` is a short, structural string (D-005: no content). */
export type PaperItemGenerationResult =
  | { readonly status: 'refused'; readonly reason: string }
  | {
      readonly status: 'generated';
      readonly taskId: PaperGeneratorTaskId;
      readonly promptVersion: string;
      /** The Worker's raw response body — never validated or persisted here (D-005); a caller that wants typed, accepted fields narrows it itself, the same posture `draftQuizCardsForConcept`'s own doc states for its own `response` field. */
      readonly response: unknown;
    };

/** The generation port — implemented by `packages/plugin/src/oracle/` over a real `WorkerTaskTransport`, faked by a test or the harness's stub generator. No prompt, no HTTP client, no model-selection logic belongs on either side of this seam. */
export type PaperItemGenerationPort = (
  request: PaperItemGenerationRequest,
) => Promise<PaperItemGenerationResult>;

/** One generated item, carrying the labels the paper object (`./paper-store.ts`) needs to keep alongside her response. */
export interface PaperGeneratedItem {
  readonly slotId: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly outcomeId?: string;
  readonly taskId: PaperGeneratorTaskId;
  readonly promptVersion: string;
  readonly groundingTier: PaperGroundingTier;
  readonly groundingLabel: PaperBlueprintSlot['groundingLabel'];
  readonly heldSourceKind: PaperBlueprintSlot['heldSourceKind'];
  readonly heldSourceId: string | null;
  readonly response: unknown;
}

export interface FillPaperBlueprintResult {
  readonly course: string;
  readonly asOf: string;
  readonly items: readonly PaperGeneratedItem[];
  /** Every slot the blueprint could not fill — the blueprint's OWN `emptySlots` (no held source, F4.10) plus any slot the port refused at generation time. Never merged into `items`. */
  readonly emptySlots: readonly PaperEmptySlot[];
}

/**
 * Calls `port` once per filled slot, in slot order (sequential, not `Promise.all` — a caller
 * whose port is a real transport almost always wants requests spaced/rate-limited, and nothing in
 * this pipeline needs the items in any particular arrival order, only the deterministic one the
 * blueprint already fixed).
 */
export async function fillPaperBlueprintSlots(
  blueprint: PaperBlueprint,
  port: PaperItemGenerationPort,
): Promise<FillPaperBlueprintResult> {
  const items: PaperGeneratedItem[] = [];
  const emptySlots: PaperEmptySlot[] = [...blueprint.emptySlots];

  for (const slot of blueprint.slots) {
    const result = await port({
      taskId: slot.taskId,
      courseCode: blueprint.course,
      conceptName: slot.conceptName,
      sourceChunks: slot.sourceChunks,
      purpose: 'readiness',
    });

    if (result.status === 'refused') {
      emptySlots.push({
        slotId: slot.slotId,
        conceptKey: slot.conceptKey,
        conceptName: slot.conceptName,
        reason: `generator refused: ${result.reason}`,
      });
      continue;
    }

    items.push({
      slotId: slot.slotId,
      conceptKey: slot.conceptKey,
      conceptName: slot.conceptName,
      ...(slot.outcomeId !== undefined ? { outcomeId: slot.outcomeId } : {}),
      taskId: result.taskId,
      promptVersion: result.promptVersion,
      groundingTier: slot.groundingTier,
      groundingLabel: slot.groundingLabel,
      heldSourceKind: slot.heldSourceKind,
      heldSourceId: slot.heldSourceId,
      response: result.response,
    });
  }

  return { course: blueprint.course, asOf: blueprint.asOf, items, emptySlots };
}
