/**
 * `resolveCreateCardOutcome` — the "Olea: Create card" command's pure
 * decision step (F2.1, C1.4, `ol-0r92.76`, `[D-268]`/`ol-0r92.77`
 * [H-qa-card-modal]).
 *
 * **What this closes.** `olea-core`'s `createQaCard`/`createClozeCard`
 * (`packages/core/src/instrument/card-format.ts`) had no caller anywhere in
 * `packages/plugin/src` — the command `OLEA_COMMAND_CREATE_CARD` ("Olea:
 * Create card") has been registered since P2-T10 but pointed at the
 * now-deleted `commands/placeholders.ts`'s `createCardPlaceholder`, an
 * honest "isn't built yet" `Notice` (`docs/dev/surface-register.md`'s
 * `olea-create-card` row, olea-service, private). `ol-0r92.76` wired the
 * CLOZE half. The Q&A half needed typed front/back text a command-palette
 * callback has no surface to collect, and F2.1 named the feature without
 * defining an entry surface — `ol-0r92.77`'s own decision bead
 * (`[D-268]`/`ol-egov.141.66`) is the record of that gap and its ruling.
 * `[D-268]` amended F2.1 with the entry-mechanism sentence quoted in
 * `createQaCardFromEntry`'s doc below, and this module now wires BOTH
 * branches: `./qa-card-modal.ts`'s `QaCardModal` collects the text, `main.ts`
 * opens it on the `'no-selection'` outcome, and `createQaCardFromEntry` is
 * this module's pure counterpart to `resolveCreateCardOutcome` for that
 * confirmed text.
 *
 * **Not the F3 generation/accept pipeline.** `createQaCard`/`createClozeCard`
 * take a caller-supplied `front`/`back` string pair or an already-marked
 * span — the shape of something SHE selects or types, not
 * `generation/types.ts`'s `DraftQuestion` (stem/correctAnswer/distractors),
 * which is what `quiz.generate.v1` produces and `materialize-mcq.ts`
 * materializes. F2.1 ("Create cards inline from note lines") is a *hand-
 * authoring* affordance — she runs a command on her own prose and types both
 * sides of the card herself — and is unrelated to `[D-097]`'s passive-accept
 * landing for AI-generated instruments (INV-6 Part One's consent gate
 * governs writing INTO her authored notes without asking; here she is the
 * one invoking the write, the same as if she had typed the card syntax
 * herself, and the modal generates, grades and schedules nothing on her
 * behalf — the cognitive-offloading check does not fire). Component register
 * row 2.1's "cards have no accept path at all" is a *different*, still-open
 * gap: no generation task produces Q&A/cloze drafts client-side at all
 * (every generative task the plugin calls today is `quiz.generate.v1`,
 * MCQ-shaped — see `retrieval/draft-quiz-cards.ts`'s own "why
 * quiz.generate.v1, not cards.generate.v1" note). Closing that gap needs a
 * new generative task and draft shape, not this module.
 *
 * **Why this is a separate module from `main.ts`.** `main.ts` imports
 * `obsidian` as a runtime value, which has no resolvable entry point under
 * Vitest outside a real Obsidian host (the same point the now-deleted
 * `commands/placeholders.ts` used to make about its own `Notice` import).
 * The offset arithmetic and the branches over `createClozeCard`'s and
 * `createQaCard`'s outcomes are the part with logic worth testing in
 * isolation; the Obsidian editor/vault/modal glue that calls this from a
 * live command is exercised the way `main-wiring.spec.ts` already exercises
 * other command wiring — a source-level reachability assertion, never a
 * real Obsidian host.
 */

import type { ParsedDocument } from 'olea-core';
import { createClozeCard, createQaCard, parseDocument } from 'olea-core';

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
       * Nothing was selected. `cursorOffset` is where she ran the command
       * (`selection.start`, since a coincident or reversed range collapses
       * to a point) — the caller (`main.ts`) opens `QaCardModal` on this
       * outcome and, on confirm, hands `cursorOffset` straight to
       * `createQaCardFromEntry` as the block anchor to resolve against.
       */
      readonly kind: 'no-selection';
      readonly cursorOffset: number;
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
    return { kind: 'no-selection', cursorOffset: selection.start };
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

/**
 * The `Notice` text for a given outcome, or `null` when there is nothing to
 * say beyond what is already visible. A successful cloze is visible in the
 * note immediately; `'no-selection'` gets no notice at all because `main.ts`
 * opens `QaCardModal` for that outcome instead of printing a message — the
 * modal itself is the feedback surface now that Q&A has one.
 */
export function createCardNoticeText(outcome: CreateCardOutcome): string | null {
  if (outcome.kind === 'clozed') return null;
  if (outcome.kind === 'no-selection') return null;
  return `Olea: couldn't create a card there — ${outcome.message}`;
}

/**
 * The block index `createQaCard` should anchor to for a cursor sitting at
 * `offset` with nothing selected — the first block whose `end` is past
 * `offset`, or the document's last block when `offset` sits at or past the
 * end of the source (cursor on the final line with no trailing block after
 * it). Blocks are contiguous and ordered (`isLossless`'s invariant in
 * `olea-core`'s block model), so this is well-defined for every offset
 * inside a non-empty document. An empty document (no blocks at all) returns
 * `-1`, which `createQaCard`'s own `assertAnchorable` turns into an honest
 * "no block at index -1" — caught by `createQaCardFromEntry` below and
 * surfaced as a rejection, the same posture `resolveCreateCardOutcome`
 * already takes toward a cloze span `createClozeCard` refuses.
 */
function blockIndexAtOffset(doc: ParsedDocument, offset: number): number {
  const found = doc.blocks.findIndex((block) => offset < block.end);
  return found !== -1 ? found : doc.blocks.length - 1;
}

/** What `QaCardModal` collects and hands to `createQaCardFromEntry`. */
export interface CreateQaCardFromEntryInput {
  readonly source: string;
  /** The cursor offset from the `'no-selection'` outcome that opened the modal. */
  readonly cursorOffset: number;
  readonly front: string;
  readonly back: string;
}

export type CreateQaCardEntryOutcome =
  | {
      /** The card was created; `content` is the note's new full text, ready to write back. */
      readonly kind: 'created';
      readonly content: string;
    }
  | {
      /**
       * `createQaCard` refused the anchor (a blank line, code fence, callout
       * or thematic break — cards come from her prose, headings and outline
       * items — or the anchored block already carries scheduling state
       * shaped oddly enough to reject) or the front/back text was blank.
       */
      readonly kind: 'rejected';
      readonly message: string;
    };

/**
 * `QaCardModal`'s confirm handler resolves through this — F2.1's Q&A
 * half, amended Sep 2026 by `[D-268]`:
 *
 * > "Q&A is entered through a modal with two plain-text fields, front and
 * > back, following the plugin's existing register-source and setup modal
 * > pattern; the existing create-card command opens it on the no-selection
 * > outcome in place of today's notice, confirms by creating the card at
 * > the block anchor, and cancels with no edit written."
 * > (`docs/Olea_alpha_functional_scope.md` F2.1, olea-service, private.)
 *
 * Resolves the confirmed cursor offset to a block index via
 * `blockIndexAtOffset` and calls `olea-core`'s `createQaCard` with it — the
 * "block anchor" the clause names is the block she ran the command on, the
 * same anchor `createClozeCard`'s span-based resolution already uses for the
 * cloze half. Pure — no vault or Obsidian dependency — for the same reason
 * `resolveCreateCardOutcome` is: `main.ts` calls this from the modal's
 * confirm callback and only then writes `content` back through the vault.
 */
export function createQaCardFromEntry(input: CreateQaCardFromEntryInput): CreateQaCardEntryOutcome {
  const { source, cursorOffset, front, back } = input;
  try {
    const doc = parseDocument(source);
    const anchorBlockIndex = blockIndexAtOffset(doc, cursorOffset);
    const result = createQaCard({ source, anchorBlockIndex, front, back });
    return { kind: 'created', content: result.content };
  } catch (error) {
    return {
      kind: 'rejected',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
