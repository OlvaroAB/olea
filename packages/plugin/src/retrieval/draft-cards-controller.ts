/**
 * `runDraftCards` — obsidian-free orchestration, testable under plain Vitest
 * because it never touches the DOM or imports `obsidian`.
 *
 * Composes two things that already exist and are separately tested:
 * `draftQuizCardsForConcept` (`ol-odb0.2`/`ol-odb0.3`, the wired, refusing
 * production caller) and `parseDraftedResponse` (`draft-cards-copy.ts`, the
 * public-envelope-only response shaping). Neither is duplicated here.
 *
 * **Sanctioned callers, and only these (F4.5).** The student-invoked
 * "Olea: Draft cards for a concept" command and its `DraftCardsModal` DOM
 * layer were withdrawn (David, wave-2 round-2 correction) because F4.5 rules
 * out a student-invoked draft verb by name: there is no "Draft 6?" because
 * Olea is already drafting under unbounded automatic generation (`[D-063]`).
 * This module is contract-valid internal plumbing, not a UI entry point, and
 * is meant to be called only from: (1) the F3.3 automatic, ingestion-driven
 * generation pipeline, and (2) P3-T07a's accept/triage flow, where she
 * reviews material Olea already drafted rather than asking for a draft. Do
 * not wire a command, hotkey or palette entry to this module or to
 * `draftQuizCardsForConcept` beneath it — that is exactly the withdrawn
 * surface.
 */

import {
  type DraftedQuestionView,
  describeRefusal,
  parseDraftedResponse,
  type RefusalCopy,
} from './draft-cards-copy.js';
import {
  type DraftQuizCardsDeps,
  type DraftQuizCardsRequest,
  draftQuizCardsForConcept,
} from './draft-quiz-cards.js';

export type DraftCardsOutcome =
  | { readonly kind: 'refused'; readonly copy: RefusalCopy }
  | { readonly kind: 'drafted'; readonly questions: readonly DraftedQuestionView[] }
  | { readonly kind: 'worker-error'; readonly message: string }
  | { readonly kind: 'unparseable' };

/**
 * Runs one draft-cards attempt end to end and returns a shape the modal can
 * switch on directly. The composite-grounding refusal (zero transport
 * sends — `ol-odb0.3`'s own property) and a Worker-side failure on an
 * actually-sent request are kept as distinct outcome kinds rather than both
 * collapsing into one "no cards" — the same distinction
 * `draft-quiz-cards.spec.ts` proves by counting transport calls is worth
 * keeping visible one layer up, in what she is told.
 */
export async function runDraftCards(
  deps: DraftQuizCardsDeps,
  request: DraftQuizCardsRequest,
): Promise<DraftCardsOutcome> {
  const result = await draftQuizCardsForConcept(deps, request);

  if (result.status === 'refused') {
    return { kind: 'refused', copy: describeRefusal(result.reason) };
  }

  const parsed = parseDraftedResponse(result.response);
  if (parsed.kind === 'drafted') return { kind: 'drafted', questions: parsed.questions };
  if (parsed.kind === 'worker-error') return { kind: 'worker-error', message: parsed.message };
  return { kind: 'unparseable' };
}
