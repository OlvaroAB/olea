/**
 * `runDraftCards` — the obsidian-free orchestration `draft-cards-modal.ts`
 * calls into, kept separate from the `Modal` subclass for the same reason
 * `open-session.ts` sits beside `review/view.ts`: this is the part with
 * actual branching to get right (refusal vs. drafted vs. a Worker-level
 * error vs. an unparseable body), and it is testable under plain Vitest
 * because it never touches the DOM or imports `obsidian`.
 *
 * Composes two things that already exist and are separately tested:
 * `draftQuizCardsForConcept` (`ol-odb0.2`/`ol-odb0.3`, the wired, refusing
 * production caller) and `parseDraftedResponse` (`draft-cards-copy.ts`, the
 * public-envelope-only response shaping). Neither is duplicated here.
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
