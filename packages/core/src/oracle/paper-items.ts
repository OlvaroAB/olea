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
 *
 * **The demand gate runs one step earlier and this module never re-checks it (`[D-262]`).** A
 * slot whose intended demand no generator declares is already an `emptySlot` with reasonCode
 * `demand-unsupported` by the time `buildPaperBlueprint` hands its output here — `blueprint.slots`
 * never contains one. This module's only demand-related job is forwarding
 * `PaperBlueprintSlot.intendedDemand` onto the generated item (`PaperGeneratedItem.intendedDemand`)
 * as a record of intent, never a check: ruling 1 is explicit that no item-level judge runs against
 * what a generator actually produced.
 */

import type { GeneratedMcqCandidate } from '../instrument/mcq-generated.js';
import type {
  PaperBlueprint,
  PaperBlueprintSlot,
  PaperDemand,
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
  /**
   * `[D-437]` W1 — the slot's demand, present ONLY when the blueprint's demand was READ from her
   * papers (`intendedDemandBasis === 'read'`). Absent for the recall default and for a blueprint
   * with no basis: the request then carries no such key at all and is today's request.
   */
  readonly intendedDemand?: PaperDemand;
  /**
   * `[D-561]` (`ol-egov.141.89.7.93`): for a part that states a dependency, the earlier parts it
   * builds on, in paper order — each one's question and, when written, its answer, read off the
   * landed item (`paperItemEarlierPart`). Present ONLY for a part with a stated dependency whose
   * earlier parts landed; any other request carries no such key, and a dependent part is never
   * requested without it (the plugin's composition refuses the part instead). Olea's own questions
   * in transit (D-005), never logged. On the wire as the contract's `earlierParts`
   * (`olea-contracts`' `authoringEarlierPartsField`, `ol-egov.141.89.7.97`): the plugin's port
   * checks it against that schema and never sends one the Worker would refuse.
   */
  readonly earlierParts?: readonly PaperEarlierPart[];
  /**
   * `[D-562]` (`ol-egov.141.89.7.93`): for a part in a group that shares material, that group's one
   * passage from her held material, as text. Present ONLY when the composition's stimulus lookup
   * found one (a figure never travels: its content is not text). On the wire as the contract's
   * `sharedPassage` (`authoringSharedPassageField`), checked the same way. The passage's chunk is
   * also among the request's `sourceChunks`, so a question built on it is grounded in it.
   */
  readonly sharedPassage?: PaperSharedPassage;
}

/** One earlier part a dependent part builds on (`[D-561]`): the contract fragment's shape (`olea-contracts`' paper-context fragment, `ol-egov.141.89.7.97`), restated. */
export interface PaperEarlierPart {
  readonly question: string;
  readonly answer?: string;
}

/** A group's shared passage (`[D-562]`): its form, never a figure, and its text. */
export interface PaperSharedPassage {
  readonly form: 'scenario' | 'extract' | 'table' | 'data-set';
  readonly text: string;
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
  /** F4.11 ruling 1 (`[D-262]`) — the demand this item's own slot intended, carried forward from `PaperBlueprintSlot.intendedDemand` for the same reason `groundingLabel` rides along: a later reader of this item should not have to re-derive what the composition already decided. Never a checked/judged demand (ruling 1: "no item-level check runs against a generator's own declaration") — a record of intent only. */
  readonly intendedDemand: PaperDemand;
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
      ...(blueprint.intendedDemandBasis === 'read' ? { intendedDemand: slot.intendedDemand } : {}),
    });

    if (result.status === 'refused') {
      emptySlots.push({
        slotId: slot.slotId,
        conceptKey: slot.conceptKey,
        conceptName: slot.conceptName,
        reasonCode: 'generator-refused',
        reason: `generator refused: ${result.reason}`,
        intendedDemand: slot.intendedDemand,
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
      intendedDemand: slot.intendedDemand,
      groundingTier: slot.groundingTier,
      groundingLabel: slot.groundingLabel,
      heldSourceKind: slot.heldSourceKind,
      heldSourceId: slot.heldSourceId,
      response: result.response,
    });
  }

  return { course: blueprint.course, asOf: blueprint.asOf, items, emptySlots };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

const notBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * `[D-561]`: the question a landed paper item asks, and its answer, as an earlier part a dependent
 * part builds on — or `undefined` when the stored body carries no readable question. The item's
 * question is its FIRST artefact, the one a hand-off enters (`paperItemMcqCandidate`, index 0): a
 * `quiz.generate.v1` question's `stem` and `correctAnswer`, a `cards.generate.v1` card's `front`
 * and `back`. An answer that is not text is left out; a question that is blank is no question.
 * Pure; reads the body the port stored verbatim (`PaperGeneratedItem.response`).
 */
export function paperItemEarlierPart(item: PaperGeneratedItem): PaperEarlierPart | undefined {
  const body = item.response;
  const result =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).result
      : undefined;
  if (typeof result !== 'object' || result === null) return undefined;
  const list = (result as Record<string, unknown>)[
    item.taskId === 'quiz.generate.v1' ? 'questions' : 'cards'
  ];
  const first: unknown = Array.isArray(list) ? list[0] : undefined;
  if (typeof first !== 'object' || first === null) return undefined;
  const artefact = first as Record<string, unknown>;
  const [question, answer] =
    item.taskId === 'quiz.generate.v1'
      ? [artefact.stem, artefact.correctAnswer]
      : [artefact.front, artefact.back];
  if (!notBlank(question)) return undefined;
  return notBlank(answer) ? { question, answer } : { question };
}

/**
 * One question of a `quiz.generate.v1` paper item, read out of the Worker body the port stored
 * verbatim (`PaperGeneratedItem.response`: the success envelope, whose `result.questions` carries
 * `quizGenerateResponse`'s questions) — the item-to-instrument half of a hand-off
 * (`./paper-store.ts`'s `handOffPaperItem`, `[D-407]`).
 *
 * `questionIndex` is the caller's: the service returns several questions per slot unless told
 * otherwise, and which one the paper presents as the item is the paper view's to say, not this
 * module's (no attempt surface exists yet). Throws, rather than guessing, on a
 * `cards.generate.v1` item (a Q&A card has no field line to carry the paper origin — see the
 * hand-off's own doc), on a body that is not the expected shape, and on an index with no question.
 */
export function paperItemMcqCandidate(
  item: PaperGeneratedItem,
  questionIndex: number,
): GeneratedMcqCandidate {
  if (item.taskId !== 'quiz.generate.v1') {
    throw new Error(
      `paperItemMcqCandidate: slot "${item.slotId}" was generated by ${item.taskId}; only a quiz.generate.v1 item enters review as a quiz block`,
    );
  }
  const body = item.response;
  const result =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).result
      : undefined;
  const questions =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>).questions
      : undefined;
  if (!Array.isArray(questions)) {
    throw new Error(
      `paperItemMcqCandidate: slot "${item.slotId}" carries no quiz.generate.v1 questions to enter`,
    );
  }
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= questions.length) {
    throw new Error(
      `paperItemMcqCandidate: slot "${item.slotId}" has no question at index ${questionIndex} (it has ${questions.length})`,
    );
  }
  const q: unknown = questions[questionIndex];
  const v = typeof q === 'object' && q !== null ? (q as Record<string, unknown>) : {};
  if (
    typeof v.stem !== 'string' ||
    typeof v.correctAnswer !== 'string' ||
    !isStringArray(v.distractors) ||
    typeof v.feedback !== 'string'
  ) {
    throw new Error(
      `paperItemMcqCandidate: slot "${item.slotId}" question ${questionIndex} is not a well-formed quiz question`,
    );
  }
  return {
    stem: v.stem,
    correctAnswer: v.correctAnswer,
    distractors: v.distractors,
    feedback: v.feedback,
  };
}
