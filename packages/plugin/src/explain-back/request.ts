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
 * - **Relation-context retrieval is wired end to end; this file still
 *   cannot see the role split it produces (`ol-egov.141.89.6.48`).**
 *   `resolveExplainBackRelationEdge` below resolves the subject's live
 *   "causes" partner (rel.md section 1's "Explain-back partner (causes)"
 *   row) from the SAME gated graph read every other reader uses
 *   (`servedRelations`, rel.md section 3 Default 4). `ol-egov.141.89.6.31`
 *   barrel-exported `mastery/gradingInputContract.ts`'s
 *   `resolveGradingRelationContext`/`buildGradingSourceMaterial`
 *   (`GradingSourceMaterial` is now importable from `olea-core` directly),
 *   and `ol-egov.141.89.6.33` wired `main.ts`/`modal.ts` to call both in
 *   production (`main.ts:3787` supplies `resolveCausesPartner`;
 *   `modal.ts`'s `resolveGradingSourceBlocks` calls
 *   `buildGradingSourceMaterial`). **But `resolveGradingSourceBlocks`
 *   flattens `GradingSourceMaterial.sourceBlocks` into one undifferentiated
 *   `ExplainBackSourceBlock[]` and discards `.omissionDenominator`
 *   entirely** before that array becomes `ExplainBackPromptContext
 *   .sourceBlocks` — the one field this file ever receives. Neither
 *   `ExplainBackSourceBlock` nor the `SourceBlockRef` inside it carries a
 *   role or provenance tag (subject vs. edge-provenance vs. neighbour):
 *   every block, whichever it came from, is minted through the identical
 *   `${path}#${blockIndex}#${index}` convention
 *   (`retrieveExplainBackSourceBlocks` below, and `modal.ts`'s
 *   `resolveEdgeIntroducingPassages`). `GradeSoloInput`'s own doc
 *   (`olea-core`'s `grading/explainBackSolo.ts`) says the identical thing
 *   from the producing side: "there is nothing in `GradingSourceMaterial`
 *   itself that distinguishes the two cases once the source blocks are
 *   flattened." So this file cannot recompute F5.3's narrower omission
 *   denominator (subject material plus the edge's own provenance,
 *   **never** the neighbour's full defining passages) from
 *   `context.sourceBlocks` alone — see `buildGradeSoloInputFromTypedAnswer`
 *   below for the accepted fix (an optional pass-through parameter) and
 *   this bead's report for the exact `modal.ts`/`solo-review.ts` follow-up
 *   that would start supplying it. The whole causes-edge path stays
 *   observably dormant regardless: `concept/relation.ts`'s
 *   `RELATION_EMISSION_STATUS.causes` is still `'blocked-on-deferred-reader'`
 *   — no production reader ever emits a causes edge, so `resolveCausesPartner`
 *   is live and called but never resolves one today.
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
  type GradingSourceMaterial,
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
 * `[D-322]`: one course-scoped candidate concept a freeform topic prompt can be matched against —
 * the caller's own local projection, never fetched or embedded here (this module never reads the
 * vault; see the module doc's own "pure, no I/O" posture, applied to matching the way it already
 * applies to retrieval assembly). `conceptId` is the permanent key (`[D-322]`'s binding
 * clarification: "must store the concept's permanent id … as the subject" — never a display name
 * or alias string); `names` is every string a caller's own typed topic could honestly be compared
 * against — display name, prior names, aliases — never re-derived here from a wider registry
 * shape this module has no reason to know about.
 */
export interface FreeformTopicConceptCandidate {
  readonly conceptId: string;
  readonly names: readonly string[];
  /** Course codes this concept belongs to (C7.2, M:N) — verbatim, never nested under one course. */
  readonly courses: readonly string[];
}

/**
 * `[D-322]`'s three outcomes for resolving a freeform topic to one subject concept, at
 * composition time, before she answers:
 * - `unique`: exactly one candidate's name matched (after course scoping, when a course is
 *   known) — the permanent id to fix as the subject.
 * - `ambiguous`: more than one candidate matched — the ruling's own "an ambiguous match gets the
 *   practice-only designation," never a guess at which one she meant.
 * - `no-match`: nothing matched — today's behaviour (`subjectConceptId: null`), now ALSO carrying
 *   the practice-only designation per this same ruling, rather than a silent, undesignated
 *   freeform attempt.
 */
export type FreeformTopicConceptMatch =
  | { readonly kind: 'unique'; readonly conceptId: string }
  | { readonly kind: 'ambiguous'; readonly conceptIds: readonly string[] }
  | { readonly kind: 'no-match' };

/**
 * `[D-322]`'s matching rule, applied here rather than left to `modal.ts`'s `resolveTopicPrompt` —
 * pure and synchronous, the same "logic here, DOM/state glue at the call site" split this file's
 * other builders keep. **Exact, case- and whitespace-insensitive name matching only** — never a
 * fuzzy or partial match: the ruling requires the match be UNIQUE, and a partial-match rule would
 * manufacture false uniqueness (a topic that is a strict substring of exactly one candidate's name
 * today might match a second candidate added tomorrow, silently changing which concept a past
 * phrasing resolves to). **Course-aware, per the ruling's own word**: when `courseCode` is known,
 * a candidate not teaching that course is not a candidate at all for this call — matching among
 * the narrower, in-course set first is what lets an ordinary same-named-elsewhere concept resolve
 * uniquely; when `courseCode` is `null` (no current-course context available), every candidate is
 * in scope, and a same-named concept in two different courses is correctly `ambiguous`.
 */
export function matchFreeformTopicToConcept(
  topic: string,
  candidates: readonly FreeformTopicConceptCandidate[],
  courseCode: string | null,
): FreeformTopicConceptMatch {
  const normalizedTopic = topic.trim().toLowerCase();
  const inScope =
    courseCode === null
      ? candidates
      : candidates.filter((candidate) => candidate.courses.includes(courseCode));
  const matches = inScope.filter((candidate) =>
    candidate.names.some((name) => name.trim().toLowerCase() === normalizedTopic),
  );
  if (matches.length === 0) return { kind: 'no-match' };
  // Two candidate rows naming the SAME concept id (a course-spanning concept whose `courses`
  // includes several codes, matched once per row by a caller that expanded rather than
  // deduplicated) is not ambiguity about WHICH concept — dedupe by id before counting.
  const uniqueIds = [...new Set(matches.map((candidate) => candidate.conceptId))];
  if (uniqueIds.length === 1) return { kind: 'unique', conceptId: uniqueIds[0] as string };
  return { kind: 'ambiguous', conceptIds: uniqueIds };
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
 * **`resolved` is the role-separated escape hatch this module doc's
 * "Relation-context retrieval is wired end to end" note names
 * (`ol-egov.141.89.6.48`).** `context.sourceBlocks` alone cannot tell
 * subject, edge-provenance and neighbour blocks apart (see that note for
 * why — no role tag survives `modal.ts`'s flattening), so this function
 * cannot derive F5.3's omission denominator from `context` by itself.
 * `resolved.sourceMaterial`, when a caller has one, is threaded straight
 * through: it is `GradingSourceMaterial` itself (`mastery
 * /gradingInputContract.ts`'s `buildGradingSourceMaterial`, now
 * barrel-exported), and `omissionDenominator` on it already implements
 * F5.3 exactly — subject material plus the edge's own provenance passages,
 * **never** the neighbour's own defining passages, and `null` (not `[]`)
 * under F5.3's named degradation (no textual provenance at all). Likewise
 * `resolved.relationExpected`: `GradeSoloInput`'s own doc says this is
 * "decided by whatever built `sourceMaterial`" (true exactly when a real
 * relation context — not concept-only — was resolved), a fact this file
 * cannot re-derive either.
 *
 * **Omitted, both fall back to the EXACT pre-existing behaviour** — every
 * production call today, since supplying a real `GradingSourceMaterial`
 * here is composition-root work in `modal.ts`/`solo-review.ts`
 * (`resolveGradingSourceBlocks` already builds one, in a local it discards;
 * `recordSoloGradeAndReview`, `./solo-review.ts:370`, is the one caller of
 * this function and would need to carry it from there) — both outside this
 * bead's `owns`; named as a follow-up rather than guessed. The
 * concept-only default (the whole retrieved source doubling as the
 * denominator, `relationExpected: false`) is not a guess for that case: F5.3
 * only narrows the denominator for a RELATION prompt, and
 * `buildGradingSourceMaterial`'s own `'concept-only'` branch sets
 * `omissionDenominator: passages`, the identical list `sourceBlocks` gets —
 * this default is what that branch would return. `relationExpected: false`
 * still means `groundSoloResponse` (`olea-core`) drops
 * `neighbourUseDemonstrated` entirely, so `schedulingObservation` never
 * gets fabricated from a concept-only prompt.
 */
export function buildGradeSoloInputFromTypedAnswer(
  studentAnswer: string,
  context: ExplainBackPromptContext,
  resolved?: {
    /**
     * A caller-supplied `GradingSourceMaterial` — e.g. the value
     * `modal.ts`'s `resolveGradingSourceBlocks` already computes and
     * currently discards — used verbatim in place of the concept-only
     * default below. See this function's own doc for why this file cannot
     * build one itself from `context` alone.
     */
    readonly sourceMaterial?: GradingSourceMaterial;
    /**
     * True exactly when `sourceMaterial` was built from a relation context
     * (`GradingRelationContext.kind === 'relation'`), per `GradeSoloInput
     * .relationExpected`'s own doc. See this function's own doc for why
     * this file cannot decide that itself.
     */
    readonly relationExpected?: boolean;
  },
): GradeSoloInput {
  return {
    question: context.question,
    studentAnswer,
    sourceMaterial: resolved?.sourceMaterial ?? {
      sourceBlocks: context.sourceBlocks,
      omissionDenominator: context.sourceBlocks,
      candidateEdgeNomination: null,
    },
    relationExpected: resolved?.relationExpected ?? false,
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
