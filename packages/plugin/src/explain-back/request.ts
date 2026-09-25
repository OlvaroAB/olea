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
 * - **Relation-context retrieval is half-built, and the other half is
 *   blocked outside this file's ownership (`ol-egov.141.89.6.30`).**
 *   `resolveExplainBackRelationEdge` below resolves the subject's live
 *   "causes" partner (rel.md section 1's "Explain-back partner (causes)"
 *   row) from the SAME gated graph read every other reader uses
 *   (`servedRelations`, rel.md section 3 Default 4) — a stale endpoint is
 *   excluded there, not reimplemented here. What still cannot be built here:
 *   `mastery/gradingInputContract.ts`'s `resolveGradingRelationContext` and
 *   `buildGradingSourceMaterial` (F5.2a) — the functions that would turn a
 *   resolved edge into `GradingSourceMaterial`'s subject+edge+neighbour
 *   passages — are not exported from `packages/core/src/index.ts` (only
 *   that module's `SchedulingObservation`/`buildSchedulingObservationField`
 *   are). `packages/plugin` imports `olea-core` only through that barrel
 *   (no subpath `exports`, `package.json`'s `main`/`types` name the barrel
 *   only), and `index.ts` sits outside this bead's `owns`. Until that export
 *   lands, this file only ever grades a single concept ("concept-only"),
 *   using a plain `retrieve()` call over her indexed notes — the same
 *   simplification `review/explainWhy.ts`'s F2.7 grounding half already
 *   uses. Even once it lands, wiring a real neighbour concept id and its
 *   defining passages into `buildExplainBackPromptContextFromInstrument`/
 *   `FromTopic` below is composition-root work in `main.ts`/`modal.ts`,
 *   also outside this bead's `owns` — see `resolveExplainBackRelationEdge`'s
 *   own doc and this lane's report for the exact file:line gaps.
 *   `ol-cqz8`'s `buildGradeSoloInputFromTypedAnswer` below inherits the same
 *   concept-only simplification for the SOLO depth pipeline, for the
 *   identical reason: `relationExpected` is always `false`.
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
  type ConceptRelation,
  type ExplainBackPromptContext,
  type GradeExplainBackInput,
  type GradeSoloInput,
  type RelationSet,
  type RetrieveDeps,
  retrieve,
  type SourceBlockRef,
  servedRelations,
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
  /**
   * The live relation graph the plugin already holds in memory (main.ts's
   * `this.relations: RelationSet | null`, folded by `deriveRelationSet` on
   * every closing ingestion tick) — a lookup, never a fresh read.
   *
   * **Optional and absent by default, on purpose.** No production composer
   * supplies this yet — the same "simply cannot offer it" posture
   * `review/session.ts`'s `resolvePrerequisiteEvidence` documents for an
   * analogous not-yet-wired port, and for the identical reason: wiring a
   * real thunk here is `main.ts`/`modal.ts` composition work outside this
   * bead's `owns` (see the module doc's "Relation-context retrieval is
   * half-built" note and `resolveExplainBackRelationEdge` below). An absent
   * `relations` reads as "no graph available," the ordinary concept-only
   * path, unchanged from before this field existed.
   */
  readonly relations?: () => RelationSet | null;
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

/**
 * Resolves the subject concept's "causes" partner edge from the live graph
 * (rel.md section 1's "Explain-back partner (causes)" row) — a lookup over
 * an already-folded `RelationSet`, never a fresh read (see
 * `ExplainBackRetrievalDeps.relations`'s own doc).
 *
 * **Gated through the real, exported `servedRelations`, never a second,
 * hand-rolled filter.** rel.md section 3 Default 4 ("None of the three may
 * read prerequisite/causes edges by a path that bypasses the gated read")
 * names exactly this call site; `servedRelations` already withholds a
 * `stale` edge (`concept/relation.ts:567-568`), so a stale endpoint and no
 * edge at all both collapse to `undefined` here — the identical
 * "abstention is automatic" result `mastery/gradingInputContract.ts`'s
 * `resolveRelationProvenance` documents for its own `ResolvedRelationEdge`
 * input, which this function cannot call directly (see the module doc).
 *
 * `neighbourConceptId` is handed in, never chosen here: F5.2a says which
 * neighbour a prompt names is decided upstream of retrieval, the same
 * constraint `GradingRelationContext`'s own doc states on the core side.
 */
export function resolveExplainBackRelationEdge(
  deps: Pick<ExplainBackRetrievalDeps, 'relations'>,
  subjectConceptId: string,
  neighbourConceptId: string,
): ConceptRelation | undefined {
  const relationSet = deps.relations?.() ?? null;
  if (relationSet === null) return undefined;
  return servedRelations(relationSet).find(
    (edge) =>
      edge.type === 'causes' &&
      ((edge.from === subjectConceptId && edge.to === neighbourConceptId) ||
        (edge.from === neighbourConceptId && edge.to === subjectConceptId)),
  );
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

/**
 * Turns a typed answer into `gradeSolo`'s input (`ol-cqz8`) — the SOLO
 * pipeline's counterpart to `buildGradeExplainBackInputFromTypedAnswer`
 * above, reusing the SAME `ExplainBackPromptContext` this view already
 * resolved for the correctness pipeline rather than a second retrieval.
 *
 * **Concept-only, same simplification as this module's own module doc
 * states for the correctness pipeline**: `mastery/gradingInputContract.ts`'s
 * `buildGradingSourceMaterial` assembles subject+edge+neighbour passages for
 * a RELATION-shaped prompt from already-resolved `ConceptDefiningPassages` —
 * this view never builds those, so `sourceMaterial` is constructed directly
 * here rather than through that function (whose concept-only branch needs
 * nothing `context.sourceBlocks` doesn't already give: the subject's
 * passages ARE the omission denominator, and there is no edge to nominate).
 * `relationExpected: false` follows from the same fact — `groundSoloResponse`
 * (`olea-core`) drops `neighbourUseDemonstrated` entirely whenever this is
 * false, so `schedulingObservation` never gets fabricated from a
 * concept-only prompt.
 */
export function buildGradeSoloInputFromTypedAnswer(
  studentAnswer: string,
  context: ExplainBackPromptContext,
): GradeSoloInput {
  return {
    question: context.question,
    studentAnswer,
    sourceMaterial: {
      sourceBlocks: context.sourceBlocks,
      omissionDenominator: context.sourceBlocks,
      candidateEdgeNomination: null,
    },
    relationExpected: false,
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
