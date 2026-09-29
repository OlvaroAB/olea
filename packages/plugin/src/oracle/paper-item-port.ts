/**
 * `createWorkerPaperItemGenerationPort` — the composition-root implementation of
 * `PaperItemGenerationPort` (`olea-core`'s `oracle/paper-items.ts`), F4.11's practice-paper
 * pipeline (`[D-250]`/`[D-252]`, component register row 2.11, `[H-blueprint]` / `ol-0r92.75`).
 *
 * **Reachability, stated plainly (`[D-072]` clause 5), updated from this file's original note.**
 * `createWorkerPaperItemGenerationPort` (below) is reached in production: `./generation-port.ts`'s
 * `buildPracticePaperGenerationPort` (line 34) calls it directly; `./wiring.ts`'s
 * `buildPracticePaperProvider` composes that into `createLocalPracticePaperProvider`
 * (`./provider.ts`), whose `requestPaper` calls `olea-core`'s `fillPaperBlueprintSlots`
 * (`oracle/paper-items.ts`) once per filled slot — the actual call site of this port. The
 * course-scoped entry command (`OLEA_COMMAND_PRACTICE_PAPER_OPEN`, `./ids.ts`) and the
 * `PaperView` registration reach that provider from `main.ts` (`this.addCommand` around line
 * 1011, `this.registerView(VIEW_TYPE_OLEA_PAPER, ...)` around line 1197,
 * `revealPracticePaperView` around line 3916) — `[PAPER-10]` / `ol-0r92.75.1`'s wiring, landed
 * after this file's original "nothing calls it yet" note. A slot's own `taskId` (`'cards.generate.v1'`
 * for the `written`/`practical` route, `'quiz.generate.v1'` for `recall-style` —
 * `oracle/paper-blueprint.ts`'s `taskIdForFormatClass`) decides which generator this port's single
 * request shape reaches; both are exercised through this one port, not two.
 *
 * **Why this is a NEW file rather than a call to `draftQuizCardsForConcept`
 * (`../retrieval/draft-quiz-cards.ts`).** That function does its own retrieval — it turns a
 * concept NAME into grounding chunks via `retrieve()`. A blueprint slot has already chosen its
 * grounding (the composition, not a fresh nearest-neighbour search, decided which held source
 * fills a slot — see `olea-core`'s `oracle/paper-items.ts` module doc) and `cards.generate.v1`
 * (the `written`/`practical` route) has no client-side drafting call in this repo at all today
 * (confirmed by search before writing this file). So this port sends the ALREADY-CHOSEN
 * `sourceChunks` straight through `WorkerTaskTransport`, the same low-level seam
 * `WorkerEmbeddingProvider` (`olea-core`'s `retrieval/workerProvider.ts`) already uses — no
 * retrieval, no prompt, no model-selection logic on this side of the wire.
 *
 * **No prompt is written here.** `payload` is exactly the shape `cards.generate.v1` /
 * `quiz.generate.v1` already validate server-side (`olea-service/src/tasks/*.ts`, private) — this
 * file only assembles the envelope `WorkerTaskTransport.send` posts to `/v1/task`; the prompt text
 * lives entirely in the private repo's prompt files, never here.
 *
 * **The envelope this port reads, and the three outcomes it reports apart (`ol-egov.141.89.7.29`,
 * `[D-430]`, `[D-438]`).** `WorkerTaskTransport.send`'s own contract (`workerProvider.ts`) is "return
 * the parsed JSON body whatever the status code... throw only when there is genuinely no body." The
 * body is `olea-contracts`' `workerResponse`: `{ ok: true, stamp, result }` or
 * `{ ok: false, code, message }`. An earlier version of this file read `{ success, error }` and a
 * top-level `promptVersion`, a shape the Worker never sends (its specs agreed with it, so they stayed
 * green): a real error body fell through to `generated`, and every prompt version read `unknown`.
 * The envelope is now read by ONE classifier, `olea-core`'s `classifyPaperSlotWorkerResult`
 * (`oracle/paper-journal.ts`, deep-imported like the other `olea-core/src/...` reads in this
 * package because the barrel does not carry it yet); this file adds no second envelope reader.
 *
 * - `generated`: `ok: true` with a stamped prompt version (`stamp.promptVersion`, D7.3), carrying at
 *   least one artefact. The whole body is kept as the item's `response`.
 * - `refused` (source insufficiency: a fact about her material): the contract's `grounding-refused`
 *   code, and the service's real refusal for these two tasks, a STAMPED SUCCESS OF ZERO ARTEFACTS
 *   (`olea-service` `registry.ts`: "Zero is the refusal"; its `emptyContextGuard` answers an empty or
 *   stub source with `{ questions: [] }` / `{ cards: [] }` before any model call, and nothing in the
 *   service returns the `grounding-refused` code). Reason `'empty-result'`. Without this step the
 *   real refusal would still be stored as a generated item, now with nothing in it to ask.
 * - `unavailable` (service failure: work owed, never a verdict on her material): every other error
 *   code, a success with no stamp, a success whose result has no artefact list, a body that is not an
 *   envelope, and a transport that threw. The reason is structural (`'transport-failure'`, the error
 *   code, `'no-stamp'`, `'malformed-response'`, `'malformed-result'`), never a message or content.
 *
 * The other two outcomes `[D-438]` names are not this port's to report: an empty retrieval is the
 * blueprint's own `no-held-source` empty slot (before any call), and an uncertain support judgment is
 * the support check's (`ol-egov.141.89.2.23`, after the source is chosen). Neither is folded into the
 * words above.
 *
 * **Two ports, one reader.** `createWorkerPaperSlotOutcomePort` reports all three outcomes, for the
 * journal driver (`olea-core`'s `runPaperJournal`; the wire stage `ol-egov.141.89.7.5` builds its
 * generator from this port). `createWorkerPaperItemGenerationPort` is the flat path's adapter
 * (`PaperItemGenerationPort`, whose result type has two outcomes): `generated` and `refused` pass
 * through, and an outage is thrown as `PaperItemServiceUnavailableError`, so it fails the request
 * as a transport failure always has and is never recorded as an item or as an empty slot.
 */

import { CONTRACT_VERSION } from 'olea-contracts';
import type {
  PaperGeneratorTaskId,
  PaperItemGenerationPort,
  PaperItemGenerationRequest,
  PaperItemGenerationResult,
  WorkerTaskTransport,
} from 'olea-core';
import { classifyPaperSlotWorkerResult } from 'olea-core/src/oracle/paper-journal.js';

export interface WorkerPaperItemGenerationPortDeps {
  readonly transport: WorkerTaskTransport;
}

/**
 * What one slot's call ended as, apart: `generated` and `refused` are `olea-core`'s existing
 * two-outcome result unchanged; `unavailable` is the third, the service could not answer usably.
 * `reason` is a short structural string (D-005: never content).
 */
export type PaperItemPortOutcome =
  | PaperItemGenerationResult
  | { readonly status: 'unavailable'; readonly reason: string };

/** The port `runPaperJournal`'s generator is built from: every outcome reported, none thrown. */
export type PaperSlotOutcomePort = (
  request: PaperItemGenerationRequest,
) => Promise<PaperItemPortOutcome>;

/**
 * Thrown by the flat path's port (`createWorkerPaperItemGenerationPort`) when the service could not
 * answer usably: the request fails, as a transport failure always has, and nothing is recorded as an
 * item or as an empty slot. `reason` is the same structural string `PaperItemPortOutcome` carries.
 */
export class PaperItemServiceUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(
      `The practice-paper service could not answer (${reason}); nothing was recorded for this slot.`,
    );
    this.name = 'PaperItemServiceUnavailableError';
    this.reason = reason;
  }
}

/**
 * The list a generator's `result` carries its artefacts in, by the slot's own task id
 * (`olea-service`'s `quizGenerateResponse` / `cardsGenerateResponse`).
 */
const ARTEFACT_LIST_KEY: Record<PaperGeneratorTaskId, 'questions' | 'cards'> = {
  'quiz.generate.v1': 'questions',
  'cards.generate.v1': 'cards',
};

/** How many artefacts a success carries, or `null` when its result has no such list. */
function artefactCount(body: unknown, taskId: PaperGeneratorTaskId): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const result = (body as Record<string, unknown>).result;
  if (typeof result !== 'object' || result === null) return null;
  const list = (result as Record<string, unknown>)[ARTEFACT_LIST_KEY[taskId]];
  return Array.isArray(list) ? list.length : null;
}

/**
 * Builds the `/v1/task` payload `cards.generate.v1`/`quiz.generate.v1` expect — field-for-field
 * the same shape `draft-quiz-cards.ts`'s `QuizGenerateRequestPayload` restates for its own call,
 * minus `personalization`/`registerHint` (F3.8/`[D-188]`'s per-concept context, out of scope for
 * this bead's own `owns` — a follow-on may thread it through once a caller has both this port and
 * that context in hand at the same call site).
 */
function toWorkerPayload(request: PaperItemGenerationRequest): unknown {
  return {
    courseCode: request.courseCode,
    conceptName: request.conceptName,
    sourceChunks: [...request.sourceChunks],
    purpose: request.purpose,
  };
}

function sendSlotRequest(
  deps: WorkerPaperItemGenerationPortDeps,
  request: PaperItemGenerationRequest,
): Promise<unknown> {
  return deps.transport.send({
    contractVersion: CONTRACT_VERSION,
    taskId: request.taskId,
    payload: toWorkerPayload(request),
  });
}

/** One Worker body into the three outcomes: the core classifier, then the artefact list the slot's task returns. */
function readSlotOutcome(body: unknown, request: PaperItemGenerationRequest): PaperItemPortOutcome {
  const classified = classifyPaperSlotWorkerResult(body);
  if (classified.status !== 'generated') return classified;
  const count = artefactCount(classified.response, request.taskId);
  if (count === null) return { status: 'unavailable', reason: 'malformed-result' };
  if (count === 0) return { status: 'refused', reason: 'empty-result' };
  return {
    status: 'generated',
    taskId: request.taskId,
    promptVersion: classified.promptVersion,
    response: classified.response,
  };
}

/** The three-outcome port: a slot's call ends `generated`, `refused` or `unavailable`, and never throws. */
export function createWorkerPaperSlotOutcomePort(
  deps: WorkerPaperItemGenerationPortDeps,
): PaperSlotOutcomePort {
  return async function workerPaperSlotOutcomePort(request) {
    let body: unknown;
    try {
      body = await sendSlotRequest(deps, request);
    } catch {
      // A transport that throws had no body to read: an outage. The error's own text is dropped
      // (D-005: a failure message can carry a URL or a body fragment).
      return { status: 'unavailable', reason: 'transport-failure' };
    }
    return readSlotOutcome(body, request);
  };
}

/**
 * The real `PaperItemGenerationPort` for the flat path — composed here, not exported through
 * `main.ts` (see the module doc's reachability note). `generated` and `refused` are returned as
 * `fillPaperBlueprintSlots` consumes them; an outage is thrown (`PaperItemServiceUnavailableError`),
 * and a transport that throws propagates as it always has: neither is swallowed into a false
 * refusal.
 */
export function createWorkerPaperItemGenerationPort(
  deps: WorkerPaperItemGenerationPortDeps,
): PaperItemGenerationPort {
  return async function workerPaperItemGenerationPort(
    request: PaperItemGenerationRequest,
  ): Promise<PaperItemGenerationResult> {
    const outcome = readSlotOutcome(await sendSlotRequest(deps, request), request);
    if (outcome.status === 'unavailable')
      throw new PaperItemServiceUnavailableError(outcome.reason);
    return outcome;
  };
}
