/**
 * Request composition for the "Explain it back" view (`ol-12gs`, the
 * `[D-163]` destination surface). Pure functions only — no Obsidian, no I/O
 * beyond the injected `retrieve()` port — mirroring
 * `../review/explainWhy.ts`'s split between composition (this file) and the
 * view (`./modal.ts`), and reusing `olea-core`'s own
 * `ExplainBackPromptContext` (`transcription/transcribe.ts`) as the shared
 * shape voice input already targets: "voice is an input method, not a new
 * grading path" (F5.1) is true of the code, not just of the prose, exactly
 * because a typed answer and a transcript both resolve to the SAME
 * `GradeExplainBackInput` via this context.
 *
 * ===========================================================================
 * WHAT THIS DELIBERATELY DOES NOT DO (disclosed, not hidden — DF-20)
 * ===========================================================================
 * - **No relation-context retrieval.** `mastery/gradingInputContract.ts`'s
 *   `buildGradingSourceMaterial` (F5.2a) assembles subject + edge + neighbour
 *   passages for a relation-shaped prompt, from ALREADY-RESOLVED
 *   `ConceptDefiningPassages` a caller this bead does not own would have to
 *   supply. This file only ever grades a single concept ("concept-only"),
 *   using a plain `retrieve()` call over her indexed notes — the same
 *   simplification `review/explainWhy.ts`'s F2.7 grounding half already
 *   uses. Wiring the full relation-aware path is separate, larger work.
 * - **No synthesized reference answer.** `explainBackJudgeRequest`'s
 *   `referenceAnswer` is documented service-side as "synthesized ground
 *   truth", distinct from `sourceBlocks`. No generation task exists to
 *   produce one. Where a real correct-answer text already exists (a QA
 *   card's `answer`, a cloze's `clozeText`, an MCQ's correct option label)
 *   this file uses it verbatim; where none exists (the free-form on-demand
 *   entry point), it honestly reuses the concatenated retrieved source text
 *   — the same material serving both citation grounding and comparison,
 *   never a second, invented text.
 */

import {
  type ExplainBackPromptContext,
  type GradeExplainBackInput,
  retrieve,
  type RetrieveDeps,
  type SourceBlockRef,
} from 'olea-core';
import type { ClozeCard, McqItem, QaCard, ReviewInstrument } from '../review/types.js';

/** One retrieved passage, kept alongside the `{path, blockIndex}` it was minted from — needed later to resolve a graded citation back to a real `SourceCitation` (`./observation.ts`). */
export interface ExplainBackSourceBlock {
  readonly block: SourceBlockRef;
  readonly path: string;
  readonly blockIndex: number;
}

export interface ExplainBackRetrievalDeps {
  readonly retrieve: RetrieveDeps;
}

/**
 * F5.2's grounding half for this view: a plain, no-band `retrieve()` call —
 * see the module doc for why this is concept-only, not relation-aware.
 * Never throws; an empty result (nothing indexed, no hit, an unreachable
 * embedding provider) is `[]`, the same "we found nothing" collapse
 * `retrieveExplainWhySourceChunks` already uses, honest either way because
 * `gradeExplainBack` and this view both handle an empty `sourceBlocks` list
 * without treating it as an error.
 */
export async function retrieveExplainBackSourceBlocks(
  deps: ExplainBackRetrievalDeps,
  query: string,
): Promise<readonly ExplainBackSourceBlock[]> {
  const result = await retrieve(deps.retrieve, query);
  if (result.status !== 'grounded') return [];
  return result.chunks.map((chunk, index) => ({
    block: { blockId: `${chunk.path}#${chunk.blockIndex}#${index}`, text: chunk.text },
    path: chunk.path,
    blockIndex: chunk.blockIndex,
  }));
}

function joinSourceText(blocks: readonly ExplainBackSourceBlock[]): string {
  return blocks.map((entry) => entry.block.text).join('\n\n');
}

/**
 * Composes the prompt context for a review instrument's failing card (F2.12
 * confusion routing, and any other entry point that already has a real
 * `ReviewInstrument` in hand). `referenceAnswer` is the instrument's own
 * already-known correct answer — real material, never source text doing
 * double duty — mirroring `review/explainWhy.ts`'s private
 * `questionAndCorrectAnswer` (not exported there, so re-derived here rather
 * than reaching into that module for a one-off private helper).
 */
export function buildExplainBackPromptContextFromInstrument(
  instrument: ReviewInstrument,
  sourceBlocks: readonly ExplainBackSourceBlock[],
  misconceptionDigest: GradeExplainBackInput['misconceptionDigest'] = [],
): ExplainBackPromptContext {
  const { question, referenceAnswer } = questionAndReferenceAnswer(instrument);
  return {
    question,
    referenceAnswer,
    sourceBlocks: sourceBlocks.map((entry) => entry.block),
    misconceptionDigest,
  };
}

/**
 * Composes the prompt context for the free-form, on-demand entry point (F5
 * command palette), where she names the topic herself rather than a failing
 * instrument supplying one. See the module doc's "no synthesized reference
 * answer" note: `referenceAnswer` here is the retrieved material itself,
 * joined — the honest fallback when no separate ground-truth text exists.
 */
export function buildExplainBackPromptContextFromTopic(
  topic: string,
  sourceBlocks: readonly ExplainBackSourceBlock[],
  misconceptionDigest: GradeExplainBackInput['misconceptionDigest'] = [],
): ExplainBackPromptContext {
  return {
    question: `In your own words: explain ${topic}.`,
    referenceAnswer: joinSourceText(sourceBlocks),
    sourceBlocks: sourceBlocks.map((entry) => entry.block),
    misconceptionDigest,
  };
}

/**
 * Turns a typed answer into the exact input `gradeExplainBack` accepts —
 * typed input's counterpart to `transcription/transcribe.ts`'s
 * `buildGradeExplainBackInputFromTranscript`, named and shaped identically
 * on purpose (F5.1: typed is the ship floor, voice a second input method on
 * the SAME view — the two functions being near-mirrors is what makes that
 * true of the code).
 */
export function buildGradeExplainBackInputFromTypedAnswer(
  studentAnswer: string,
  context: ExplainBackPromptContext,
): GradeExplainBackInput {
  return {
    question: context.question,
    studentAnswer,
    referenceAnswer: context.referenceAnswer,
    sourceBlocks: context.sourceBlocks,
    misconceptionDigest: context.misconceptionDigest,
  };
}

function questionAndReferenceAnswer(instrument: ReviewInstrument): {
  question: string;
  referenceAnswer: string;
} {
  switch (instrument.type) {
    case 'qa':
      return questionAndReferenceAnswerForQa(instrument);
    case 'cloze':
      return questionAndReferenceAnswerForCloze(instrument);
    case 'mcq':
      return questionAndReferenceAnswerForMcq(instrument);
  }
}

function questionAndReferenceAnswerForQa(instrument: QaCard) {
  return { question: instrument.question, referenceAnswer: instrument.answer };
}

function questionAndReferenceAnswerForCloze(instrument: ClozeCard) {
  return {
    question: `${instrument.before}____${instrument.after}`,
    referenceAnswer: instrument.clozeText,
  };
}

function questionAndReferenceAnswerForMcq(instrument: McqItem) {
  const correct = instrument.options.find((option) => option.correct);
  return {
    question: instrument.stem,
    referenceAnswer: correct?.label ?? '(no correct option recorded)',
  };
}
