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
 * the top of that note (`afterBlockIndex: -1`) — generated quiz items are not
 * anchored to one block the way an inline Q&A card is (C1.4 anchoring is a
 * hand-authoring concept; F3.4's generated items have no single sentence
 * they were "written beside").
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

  const { content, insertedSpan } = insertMcqBlock({
    source,
    afterBlockIndex: -1,
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
