/**
 * `materializeAcceptedDraft` — the accept step's write-to-vault half (F3.4,
 * F2.15, INV-6, `ol-p3t07a`).
 *
 * No caller in `packages/plugin` composed `insertMcqBlock` + `stampMcqId`
 * before this file: `acceptGeneratedMcq` (`olea-core`) turns a generated
 * candidate into `McqFields`, but nothing wired that into an actual vault
 * write from the plugin (`mcq-generated.ts`'s own module doc names this as
 * "P3-T07b's accept step, still open" — this is that step, for the one
 * generative task, `quiz.generate.v1`, this bead's pipeline drafts). Reuses
 * every piece of the existing identity machinery unmodified — `insertMcqBlock`,
 * `stampMcqId`, `parseMcqBlocks`, `acceptGeneratedMcq` — and adds nothing new
 * to it.
 *
 * **Where it writes.** A draft's `sourcePath` is always the NOTE that
 * embedded the material it was drafted from (`pipeline.ts` only drafts for
 * units carrying `provenance.embeddedIn` — see that file's module doc for
 * why a bare, unembedded source drop is out of this round's scope), so this
 * always has a real markdown note to insert into. The block is inserted at
 * the top of that note's CONTENT — generated quiz items are not anchored to
 * one block the way an inline Q&A card is (C1.4 anchoring is a
 * hand-authoring concept; F3.4's generated items have no single sentence
 * they were "written beside").
 *
 * **"Top of the note" means after its frontmatter, not byte offset zero**
 * (`ol-p3t07b`). `insertMcqBlock`'s own `afterBlockIndex: -1` means "insert
 * at the literal start of the document" — it has no opinion about
 * frontmatter, because most of its callers never need one. Passing `-1`
 * unconditionally on a course note (which almost always opens with a
 * `topic:`/`course:` frontmatter block, per `enumerate.ts`'s binding rule)
 * pushes that frontmatter down past the freshly-inserted code fence, so the
 * note no longer *opens* with frontmatter and `enumerateVaultInstruments`
 * — which requires the frontmatter block to be first — silently stops
 * binding the note's concept at all. The freshly-materialized instrument
 * then enumerates as **unbound** and never reaches `composeQueue`: written
 * to the vault, invisible to the queue. Caught by `accept.spec.ts`'s
 * `buildReviewSession` round-trip test, which is exactly why that test
 * composes a real queue instead of only inspecting the write.
 *
 * The fix: insert after block 0 when it is a `frontmatter` block, and only
 * fall back to `-1` (literal top) when the note has none.
 *
 * **Locating the inserted block.** `insertMcqBlock` returns the char range it
 * inserted (`insertedSpan`, which includes the leading/trailing whitespace it
 * added), not the code block's own span. This re-parses the resulting
 * content and finds the one `McqInstrument` whose own span falls inside
 * `insertedSpan` — there is exactly one, since nothing else changed.
 */

import {
  acceptGeneratedMcq,
  insertMcqBlock,
  parseDocument,
  parseMcqBlocks,
  stampMcqId,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import type { DraftQuestion } from './types.js';

export interface MaterializeAcceptedDraftInput {
  readonly sourcePath: VaultPath;
  readonly question: DraftQuestion;
}

export interface MaterializeAcceptedDraftResult {
  readonly instrumentId: string;
}

export async function materializeAcceptedDraft(
  vault: VaultSource,
  input: MaterializeAcceptedDraftInput,
): Promise<MaterializeAcceptedDraftResult> {
  const source = await vault.read(input.sourcePath);

  const fields = acceptGeneratedMcq(
    {
      stem: input.question.stem,
      correctAnswer: input.question.correctAnswer,
      distractors: input.question.distractors,
      feedback: input.question.feedback,
    },
    null,
  );

  // "Top of the note" skips a leading frontmatter block rather than landing
  // above it — see the module doc's `ol-p3t07b` note for why inserting at
  // literal offset zero silently unbinds the note's concept.
  const firstBlock = parseDocument(source).blocks[0];
  const afterBlockIndex = firstBlock?.kind === 'frontmatter' ? 0 : -1;

  const { content, insertedSpan } = insertMcqBlock({
    source,
    afterBlockIndex,
    fields,
  });

  const { instruments } = parseMcqBlocks(content);
  const inserted = instruments.find(
    (instrument) =>
      instrument.span.start >= insertedSpan.start && instrument.span.end <= insertedSpan.end,
  );
  if (inserted === undefined) {
    throw new Error(
      'materializeAcceptedDraft: could not locate the freshly-inserted MCQ block after insertMcqBlock',
    );
  }

  const stamped = stampMcqId(content, inserted.span);
  await vault.write(input.sourcePath, stamped.content);

  return { instrumentId: stamped.id };
}
