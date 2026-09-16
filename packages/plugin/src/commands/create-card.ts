/**
 * `resolveCreateCardOutcome` — the "Olea: Create card" command's pure
 * decision step (F2.1, C1.4, `ol-0r92.76`).
 *
 * **What this closes.** `olea-core`'s `createQaCard`/`createClozeCard`
 * (`packages/core/src/instrument/card-format.ts`) had no caller anywhere in
 * `packages/plugin/src` — the command `OLEA_COMMAND_CREATE_CARD` ("Olea:
 * Create card") has been registered since P2-T10 but pointed at the
 * now-deleted `commands/placeholders.ts`'s `createCardPlaceholder`, an
 * honest "isn't built yet" `Notice` (`docs/dev/surface-register.md`'s
 * `olea-create-card` row, olea-service, private). This module is that command's real
 * destination for the CLOZE half of F2.1 — see "What this does not do"
 * below for why the Q&A half stays a placeholder.
 *
 * **Not the F3 generation/accept pipeline.** `createQaCard`/`createClozeCard`
 * take a caller-supplied `front`/`back` string pair or an already-marked
 * span — the shape of something SHE selects or types, not
 * `generation/types.ts`'s `DraftQuestion` (stem/correctAnswer/distractors),
 * which is what `quiz.generate.v1` produces and `materialize-mcq.ts`
 * materializes. F2.1 ("Create cards inline from note lines") is a *hand-
 * authoring* affordance — she runs a command on her own prose — and is
 * unrelated to `[D-097]`'s passive-accept landing for AI-generated
 * instruments (INV-6 Part One's consent gate governs writing INTO her
 * authored notes without asking; here she is the one invoking the write, the
 * same as if she had typed the card syntax herself). Component register row
 * 2.1's "cards have no accept path at all" is a *different*, still-open gap:
 * no generation task produces Q&A/cloze drafts client-side at all (every
 * generative task the plugin calls today is `quiz.generate.v1`, MCQ-shaped —
 * see `retrieval/draft-quiz-cards.ts`'s own "why quiz.generate.v1, not
 * cards.generate.v1" note). Closing that gap needs a new generative task and
 * draft shape, not a caller for these two functions.
 *
 * **What this does NOT do.** `createQaCard` needs a `front` and a `back` —
 * text she would have to type into some UI, since a command-palette callback
 * carries no text entry of its own. No such surface (a modal collecting
 * front/back text) exists anywhere in `packages/plugin/src`, and
 * `docs/dev/surface-register.md` has no row for one; F2.1 authorises the
 * *feature*, not a specific unbuilt UI, and inventing one is outside this
 * bead's own instruction to wire only an EXISTING registered surface/flow.
 * So this module only ever resolves the CLOZE branch, which needs nothing
 * beyond an editor selection the "Create card" command already has by
 * construction: she marks a span and runs the command. A call with no
 * selection resolves to `{ kind: 'no-selection' }`, which the caller (`main.ts`)
 * turns into the same kind of honest "not yet" notice the deleted
 * `createCardPlaceholder` used to give unconditionally — never a silent
 * no-op and never a guessed Q&A card.
 *
 * **Why this is a separate module from `main.ts`.** `main.ts` imports
 * `obsidian` as a runtime value, which has no resolvable entry point under
 * Vitest outside a real Obsidian host (the same point the now-deleted
 * `commands/placeholders.ts` used to make about its own `Notice` import).
 * The offset arithmetic and the
 * branch over `createClozeCard`'s outcomes are the part with logic worth
 * testing in isolation; the Obsidian editor/vault glue that calls this from
 * a live command is exercised the way `main-wiring.spec.ts` already
 * exercises other command wiring — a source-level reachability assertion,
 * never a real Obsidian host.
 */

import { createClozeCard } from 'olea-core';

/** A caller-resolved editor selection, as absolute offsets into `source` — the same addressing `createClozeCard` itself takes. */
export interface CreateCardSelection {
  readonly start: number;
  readonly end: number;
}

export type CreateCardOutcome =
  | {
      /** A cloze card was created; `content` is the note's new full text, ready to write back. */
      readonly kind: 'clozed';
      readonly content: string;
      /** The marked text, unchanged — for a caller that wants to say what was clozed. */
      readonly clozeText: string;
    }
  | {
      /**
       * Nothing was selected. Q&A card creation needs typed front/back text
       * this command has no surface to collect (see the module doc) — this
       * is that honest "not yet," not an error.
       */
      readonly kind: 'no-selection';
    }
  | {
      /** `createClozeCard` refused the selection (spans a block boundary, crosses lines, already contains a delimiter, or is anchored somewhere other than a paragraph/list item). */
      readonly kind: 'rejected';
      readonly message: string;
    };

/**
 * Resolves what running "Olea: Create card" against the given note text and
 * editor selection should do. Pure — no vault or Obsidian dependency — so it
 * is fully covered by ordinary Vitest, unlike the command's own glue.
 */
export function resolveCreateCardOutcome(
  source: string,
  selection: CreateCardSelection,
): CreateCardOutcome {
  if (selection.end <= selection.start) {
    return { kind: 'no-selection' };
  }

  try {
    const result = createClozeCard({
      source,
      spanStart: selection.start,
      spanEnd: selection.end,
    });
    return { kind: 'clozed', content: result.content, clozeText: result.clozeText };
  } catch (error) {
    return {
      kind: 'rejected',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The wording shown when nothing was selected — named so `main.ts` and this module's own spec share one string rather than two that can drift apart. */
export const CREATE_CARD_NO_SELECTION_NOTICE =
  "Olea: select some text to turn it into a cloze card. Q&A card creation isn't built yet — it's coming in a later update.";

/**
 * The `Notice` text for a given outcome, or `null` when the edit itself is
 * the only feedback needed (a successful cloze is visible in the note
 * immediately). Kept here, beside the outcome it describes, rather than
 * inlined in `main.ts` — the same "logic worth testing lives outside the
 * Obsidian glue" split the module doc states.
 */
export function createCardNoticeText(outcome: CreateCardOutcome): string | null {
  if (outcome.kind === 'clozed') return null;
  if (outcome.kind === 'no-selection') return CREATE_CARD_NO_SELECTION_NOTICE;
  return `Olea: couldn't create a card there — ${outcome.message}`;
}
