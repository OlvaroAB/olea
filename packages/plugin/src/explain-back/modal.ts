/**
 * `ExplainBackModal` — the ONE dedicated "Explain it back" view (F5.1,
 * `[D-163]`, `ol-12gs`). Single rendering implementation: every one of the
 * four ruled entry points (on-demand F5, confusion routing F2.12, session
 * assembly F4.6, Today's suggestion F6.4) constructs and opens exactly this
 * class — there is no second inline copy of this exchange anywhere in the
 * plugin. Typed input is the ship floor (F5.1); voice is a later, second
 * input method on this SAME view, not built here.
 *
 * ===========================================================================
 * IN v0.9 THIS VIEW IS UNGRADED PRACTICE (`[D-603]`, words `[D-611]`)
 * ===========================================================================
 * `ol-egov.141.89.6.129`. She writes her explanation with nothing open beside
 * her. When she chooses "Show the passages" the view shows her explanation
 * and, under "From your notes", the supporting passages the prompt already
 * carries (F5.2a's lookup for a concept or a relation prompt, done when the
 * question was resolved, never a fresh search), then the fixed reflection
 * prompts for the prompt's shape, with no answer field, and the end controls
 * "Done" and "Try again" (F5.2, F5.4, vocabulary registry §39).
 *
 * **Nothing is sent anywhere after she submits.** No correctness judge, no
 * depth pass, no misconception resolution: this view no longer calls the
 * dependencies that reach them (`grade`, `acceptWithObservation`,
 * `buildObservationContext`, `recordSoloGradeAndReview`,
 * `loadMisconceptionDigest`), which stay on {@link ExplainBackModalDeps} only
 * so the composition root and the workbench keep compiling while grading is
 * dormant. That code (the judge and grading pipeline, `./solo-review.ts`'s
 * depth pass, `../grading/wiring.ts`'s observation routing) stays in the
 * codebase with its own tests; it returns only as the F5 heading note says.
 * Nothing on the view says whether, or how far, her explanation matches the
 * passages: no depth heading, no omission, error or confusion region, no
 * misconception region, no follow-up question and no first-full-depth
 * sentence, on any path (F5.3 as amended).
 *
 * **What it writes.** The `[D-460]` exposure marker, before the passages
 * appear (F5.4); and, when she leaves an answer by "Done" or "Try again",
 * one practice explanation (D7.1, `[D-614]`) through
 * `deps.recordPracticeExplanation` (`./practice-record.ts`, over
 * `olea-core`'s `recordPracticeExplanation`). No review event, no grade, no
 * correctness verdict, no misconception observation and no scheduling
 * observation. A skip, or a prompt closed without an answer, is the
 * non-attempt it always was (F5.7) and shows nothing.
 *
 * ===========================================================================
 * HAND-OFF + RESUME, NEVER A SECOND INLINE COPY
 * ===========================================================================
 * This is a `Modal`, not an `ItemView`: whatever screen was open underneath
 * it (a review session, the session builder, Today) is untouched while this
 * is open and simply still there — unfocused, not torn down — the moment it
 * closes. That IS the hand-off-and-resume `[D-163]` asks for: there is
 * nothing to "return to" because nothing else was ever replaced. `onClose`
 * calls `deps.onClosed?.()` purely so a caller can clear its own transient
 * banner/offer state (F2.12's confusion banner, specifically) — never to
 * rebuild or re-render the surface underneath, which needed no rebuilding.
 */

import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import type {
  ExplainBackGradingProvenance,
  ExplainBackPromptShape,
  MasteryState,
  SoloLevel,
  SupportLevel,
} from 'olea-contracts';
import {
  buildGradingSourceMaterial,
  type ConceptDefiningPassages,
  type ConceptRelation,
  type ExplainBackFeedbackShownLogRecordInput,
  type ExplainBackPromptContext,
  type ExplainBackSetAsideLogRecordInput,
  formatSourceCitation,
  type GradeExplainBackInput,
  type GradingRelationContext,
  type GradingSourceMaterial,
  type PendingExplainBackGrading,
  type Provenance,
  type ResolvedRelationEdge,
  resolveGradingRelationContext,
} from 'olea-core';
import type {
  AcceptExplainBackGradingWithObservationContext,
  AcceptExplainBackGradingWithObservationResult,
} from '../grading/wiring.js';
import { explainBackInsufficientNotesRefusal } from '../review/copy.js';
import type { ReviewInstrument } from '../review/types.js';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  EXPLAIN_BACK_ANSWER_PLACEHOLDER,
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_FOUND_LIST_CAPTION,
  EXPLAIN_BACK_MODAL_TITLE,
  EXPLAIN_BACK_NOTHING_MATCHED_EYEBROW,
  EXPLAIN_BACK_PASSAGES_HEADING,
  EXPLAIN_BACK_PRACTICE_NOTICE,
  EXPLAIN_BACK_QUESTION_LABEL,
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_TOPIC_CONTINUE_LABEL,
  EXPLAIN_BACK_TOPIC_PROMPT,
  type ExplainBackReflectionShape,
  explainBackReflectionPrompts,
} from './copy.js';
import {
  type FeedbackExposureLedger,
  feedbackShownRecordInput,
  type ReadLoggedAttemptState,
  type RecordFeedbackShown,
  sessionFeedbackExposureLedger,
  writeFeedbackShown,
} from './feedback-exposure.js';
import { practiceExplanationInput, type RecordViewPracticeExplanation } from './practice-record.js';
import {
  buildExplainBackPromptContextFromInstrument,
  buildExplainBackPromptContextFromTopic,
  type ExplainBackRelationPartner,
  type ExplainBackSourceBlock,
  type FreeformTopicConceptMatch,
} from './request.js';
import { canRecordNonAttempt, EXPLAIN_BACK_SKIP_LABEL } from './skip.js';

/**
 * `ol-0r92.98`: an empty or whitespace-only typed answer, exported so the
 * guard on the submit button (`renderAnsweringPhase`) can be asserted
 * directly rather than only by matching source text — the same emptiness
 * rule `renderTopicPhase`'s own continue button already applies inline.
 * Deliberately NOT a "skip": it only says whether a submit is a no-op, and
 * carries no meaning about an explicit skip action (`[DOS-I9]`, SKIP-2/3/4).
 */
export function isBlankExplainBackAnswer(answer: string): boolean {
  return answer.trim().length === 0;
}

/** What opened this view, and therefore whether the question is already known. */
export type ExplainBackSeed =
  | { readonly kind: 'instrument'; readonly instrument: ReviewInstrument }
  | { readonly kind: 'freeform' };

export interface ExplainBackModalDeps {
  /**
   * **Dormant in v0.9** (`[D-603]`): the correctness judge (`main.ts`'s
   * `gradeExplainBackAttempt`). The practice view never calls it; it stays
   * declared, optional, so the composition root's wiring of the graded path
   * is unchanged until grading returns (F5 heading note).
   */
  readonly grade?: (input: GradeExplainBackInput) => Promise<PendingExplainBackGrading | null>;
  /** **Dormant in v0.9** (`[D-603]`): the accept-and-observe step. Never called by the practice view. */
  readonly acceptWithObservation?: (
    pending: PendingExplainBackGrading,
    context: AcceptExplainBackGradingWithObservationContext,
  ) => Promise<AcceptExplainBackGradingWithObservationResult | null>;
  /**
   * The retrieval behind the passages (F5.2, F5.2a): called when the question
   * is resolved, never after she submits, so the passages she reads are the
   * ones the prompt already carries.
   */
  readonly retrieveSourceBlocks: (query: string) => Promise<readonly ExplainBackSourceBlock[]>;
  /**
   * `[D-322]` (`ol-egov.141.89.6.4`): resolves a freeform topic prompt (command palette or Home,
   * naming no subject) to one concept at composition time, BEFORE she answers. Delegates entirely
   * to `./request.ts`'s pure `matchFreeformTopicToConcept`. A unique match names the concept the
   * practice explanation records; an ambiguous or absent one leaves the prompt with no concept.
   * Optional: an absent resolver, or one that returns `undefined`, reads as `{ kind: 'no-match' }`.
   */
  readonly matchFreeformTopicConcept?: (topic: string) => FreeformTopicConceptMatch | undefined;
  /**
   * `ol-egov.141.89.6.33`: resolves the subject concept's live "causes"
   * partner (rel.md section 1's "Explain-back partner (causes)" row) from
   * the plugin's in-memory relation graph — `main.ts`'s wrapper around
   * `explain-back/request.ts`'s `resolveExplainBackCausesPartner`, already
   * gated on rel.md section 3 Default 4 freshness (a stale or absent edge
   * resolves `undefined`, never served). `subjectConceptId` is the subject's
   * concept KEY (`instrument.conceptIds[0]`), never a wording
   * (`ol-egov.141.89.6.74`); the partner comes back naming the OTHER end both
   * ways, key and wording, so this view never has to work out which end of
   * the edge the subject is. `resolveGradingSourceBlocks` below is the one
   * caller: a resolved partner makes the prompt a relation prompt, whose
   * passages are F5.2a's for a relation and whose reflection prompts name
   * both ends (registry §39). Optional and absent by default: an omitted dep
   * keeps every prompt a concept prompt.
   */
  readonly resolveCausesPartner?: (
    subjectConceptId: string,
  ) => ExplainBackRelationPartner | undefined;
  /**
   * `ol-egov.141.89.6.36`: the targeted vault-read port behind a live causes
   * edge's own `introducingPassages` (a `Provenance`: a source path plus a
   * `SourceLocation`, never text), turned into an `ExplainBackSourceBlock`,
   * the SAME shape and citation-id convention `deps.retrieveSourceBlocks`
   * already produces. Resolves `null` — never throws — when the passage
   * cannot be read as it stood at fold time; `resolveGradingSourceBlocks`
   * below reads a `null` result as "this endpoint contributes nothing".
   * Optional and absent by default.
   */
  readonly resolveIntroducingPassage?: (
    provenance: Provenance,
  ) => Promise<ExplainBackSourceBlock | null>;
  /** **Dormant in v0.9** (`[D-603]`): the accept-time observation context. Never called by the practice view. */
  readonly buildObservationContext?: (params: {
    readonly subjectConceptId: string | null;
    readonly permittedConceptIds?: readonly string[];
    readonly originInstrumentId: string;
    readonly sourceBlocks: readonly ExplainBackSourceBlock[];
    readonly query: string;
  }) => Promise<AcceptExplainBackGradingWithObservationContext>;
  /**
   * **Dormant in v0.9** (`[D-603]`): the depth pass and the graded review
   * write (`./solo-review.ts`'s `recordSoloGradeAndReview`). The practice view
   * never calls it, so a practice attempt writes no review event, no
   * `explainBackGrade`, no `explainBackCorrectness` and no scheduling
   * observation. The params keep the shape the graded path used, so
   * `main.ts`'s wrapper is unchanged.
   */
  readonly recordSoloGradeAndReview?: (params: {
    readonly instrumentId: string;
    readonly attemptId: string;
    readonly subjectConceptId: string | null;
    readonly context: ExplainBackPromptContext;
    readonly answer: string;
    readonly durationMs: number | null;
    readonly supportLevelShown?: SupportLevel;
    readonly answerEdits: {
      readonly firstEditMs: number | null;
      readonly editBursts: number;
    };
    readonly sourceMaterial?: GradingSourceMaterial;
    readonly relationExpected?: boolean;
    readonly neighbourConceptId?: string;
    readonly depthPass?: 'run' | 'skipped';
    readonly followsAttemptId?: string;
    readonly gradingProvenance?: ExplainBackGradingProvenance;
  }) => Promise<SoloLevel | undefined>;
  /** A stable id for this attempt (`../grading/wiring.ts`'s "distinct from any card/MCQ id space"). Injected so this view never mints its own id-generation policy. */
  readonly generateInstrumentId: () => string;
  /**
   * `ol-0r92.104` [DOS-I9] (`[D-273]`, `[D-306]`): writes one non-attempt
   * review-log event — core's `appendNonAttemptRecord`, wrapped with a vault
   * and the offer `trigger` this modal instance was opened under (the view
   * has no way to know it; `main.ts`'s `openExplainBackModal` closes over it).
   *
   * Optional and best-effort: unwired, a skip or a close-without-answering
   * writes nothing, never throws, and never blocks the UI transition it
   * accompanies (`recordNonAttemptIfPossible` below catches and logs,
   * content-free per D-005).
   *
   * **Never called for an answer she submitted** (`[D-304]`): its only two
   * callers are `skipPrompt` and `onClose`'s guard on the `'answering'` phase.
   */
  readonly recordNonAttempt?: (params: {
    /** Every concept the prompt concerned (D7.1's non-empty `conceptIds`). Never called when this would be `[]` — see `./skip.ts`'s `canRecordNonAttempt`. */
    readonly conceptIds: readonly string[];
    /** ISO-8601 with offset, the moment she left the prompt (the skip taken, or the close handled) — this view's own clock (`this.now`). */
    readonly timestamp: string;
  }) => Promise<void>;
  /**
   * D7.1, `[D-614]` (`ol-egov.141.89.6.129`): writes the practice explanation
   * for one answer she leaves by "Done" or "Try again" —
   * `./practice-record.ts`'s `createRecordPracticeExplanation` over
   * `olea-core`'s `recordPracticeExplanation`, with the offer's trigger and
   * event id closed over by the composition root (the same reason
   * `recordNonAttempt` takes no trigger). Idempotent on the attempt id.
   *
   * Optional and best-effort, the same posture as `recordNonAttempt`:
   * unwired, nothing is written; a rejection (validation or vault failure) is
   * caught and logged content-free (D-005), never thrown at her, and never
   * delays leaving the answer.
   */
  readonly recordPracticeExplanation?: RecordViewPracticeExplanation;
  /** **Dormant in v0.9** (`[D-603]`, `[D-416]`): the graded path's set-aside record. Never called by the practice view. */
  readonly recordSetAsideAttempt?: (input: ExplainBackSetAsideLogRecordInput) => Promise<void>;
  /**
   * **Dormant in v0.9** (`[D-603]`): the graded path's read of earlier
   * attempts, for sealing a graded attempt's rung. The practice view does not
   * read it: the practice explanation's writer reads her log itself, at write
   * time, for the support shown before each answer (D7.1).
   */
  readonly readLoggedAttemptState?: ReadLoggedAttemptState;
  /**
   * `[D-460]` (`ol-egov.141.89.6.86`): writes the exposure marker — the
   * question, the attempt and the time — to her log BEFORE the passages
   * render, so a reload after she read them cannot make a later answer look
   * unassisted (F5.4 as amended). `./feedback-exposure.ts`'s
   * `createRecordFeedbackShown`. Awaited in `submitAnswer`; see
   * `recordFeedbackShownBeforeDisplay` for what a failed write does.
   *
   * Optional: unwired, nothing is written and the passages render as soon as
   * she submits.
   */
  readonly recordFeedbackShown?: RecordFeedbackShown;
  /**
   * Row 50: the session note of exposures already shown (see
   * `./feedback-exposure.ts`'s `FeedbackExposureLedger`), injectable for a
   * test. Defaults to the one every view in this plugin session shares.
   */
  readonly feedbackExposureLedger?: FeedbackExposureLedger;
  /** Fires once, on close, however the modal was resolved — see the module doc's "hand-off" section. */
  readonly onClosed?: () => void;
  /**
   * `ol-yj0k`: the clock this view times an attempt's `durationMs` against —
   * never `Date.now()`/`new Date()` called inline at a measurement site.
   * Optional; the constructor falls back to the real wall clock.
   */
  readonly now?: () => Date;
  /**
   * `[STY-0d]`, `ol-l5og.18.4`: the mastery tag (sprig + word) the design kit
   * places on every explain-back screen — see `renderMasteryTag` below.
   * Optional and best-effort: absent, the tag renders nothing rather than a
   * fabricated stage.
   */
  readonly getMasteryState?: (conceptId: string) => MasteryState | null;
  /**
   * **Dormant in v0.9** (`[D-603]`): the misconception digest, which this view
   * loaded only to send to the correctness judge (`ol-2zfj.75`, C7.9/F5.6).
   * The practice view sends nothing, so it no longer loads one; the digest
   * function (`olea-core`'s `buildMisconceptionDigest`) keeps its own tests.
   */
  readonly loadMisconceptionDigest?: (
    conceptIds: readonly string[],
  ) => Promise<GradeExplainBackInput['misconceptionDigest']>;
}

/**
 * `ol-egov.141.89.6.33`: widens a subject's retrieved source blocks into the
 * real grading source material, threading a live 'causes' partner through
 * the two core functions `explain-back/request.ts`'s own module doc names
 * as the missing half (`olea-core`'s `resolveGradingRelationContext`/
 * `buildGradingSourceMaterial`) — never reimplemented here. Exported and
 * pure (no `Modal`, no `App`) so it is directly unit-testable, unlike the
 * class below (`obsidian`'s `package.json` `main` is `""`, so `Modal`
 * cannot be instantiated under Vitest — see this file's sibling specs).
 *
 * **In v0.9 this is F5.2a's lookup for the supporting passages** (`[D-603]`,
 * `ol-egov.141.89.6.129`): the flattened `sourceBlocks` it returns are the
 * passages the practice view shows after an answer — for a concept prompt the
 * subject's defining passages, for a relation prompt also the edge's own
 * provenance passages and the neighbour's defining passages — and nothing is
 * sent to a grader. The material, `relationExpected` and the neighbour key are
 * still returned unchanged for the graded path when it returns (F5.5).
 *
 * **Always runs through both core functions, concept-only or not.** The
 * concept-only branch is `buildGradingSourceMaterial`'s identity case
 * (`sourceBlocks` returned unchanged) — so a call that finds no resolvable
 * neighbour changes nothing observable. That is what keeps the judge's wire
 * shape unchanged for a vault with no served `causes` edge (none is offered
 * until the service prompt that offers `causes` is deployed,
 * `ol-egov.141.89.4.26`): a real `no-op` outcome, not a bypass that skips
 * calling either function.
 *
 * **A `null` subjectConceptId (the free-form topic entry point) never
 * builds a `GradingSourceMaterial`.** `buildGradingSourceMaterial` requires
 * `GradingSubject.subjectConceptId`, and a topic she typed herself
 * genuinely has none (`resolveTopicPrompt`'s own `subjectConceptId: null`).
 * `resolveGradingRelationContext(undefined)` still runs, so both entry
 * points share one code path through it; its `{kind: 'concept-only'}`
 * result is simply not acted on further, and `sourceBlocks` returns
 * unchanged — this path's exact pre-existing behaviour.
 *
 * **The neighbour's defining passages are retrieved through
 * `deps.retrieveSourceBlocks`, by the neighbour's WORDING, and the neighbour
 * is named everywhere else by its KEY (`ol-egov.141.89.6.74`).** The same
 * retrieval port every entry point already uses for an arbitrary
 * natural-language string (`resolveTopicPrompt` already retrieves against a
 * topic she typed) — no second reader is invented — takes the partner's
 * `neighbourName`, a query. Everything that is an identity takes its
 * `neighbourConceptId`, the concept key: the defining-passages record and the
 * relation context here, and the F5.3a scheduling observation once the key is
 * threaded to the review-log write (not yet: `ol-egov.141.89.6.75`), which
 * `review/view.ts` compares with an instrument's `conceptIds`. That is the same
 * vocabulary `subjectConceptId` carries everywhere else in this file — since
 * the `ol-63e1` flip it is `instrument.conceptIds[0]`, a `ConceptRecord.key`,
 * never a name (the mastery tag, the misconception digest and the accept-time
 * observation context all key on it the same way). Which end of the edge the
 * subject is on is settled in `resolveExplainBackCausesPartner`, not here.
 *
 * **The edge's own introducing passages, resolved the same way the
 * neighbour's are (`ol-egov.141.89.6.36`).** `ConceptRelation
 * .introducingPassages` names a `Provenance` (a source path plus a
 * location, never text) per endpoint — `resolveEdgeIntroducingPassages`
 * below turns each into a citable `ExplainBackSourceBlock` through
 * `deps.resolveIntroducingPassage`, the targeted vault-read port this
 * file's earlier revision had no port for. `evidence: 'current'` is still
 * asserted directly rather than left for `resolveRelationProvenance` to
 * re-derive, because `deps.resolveCausesPartner` (main.ts's wrapper around
 * `resolveExplainBackCausesPartner`, which re-confirms through
 * `resolveExplainBackRelationEdge`) already applies rel.md Default 4's
 * freshness gate before ever returning an edge — one reaching this function
 * is, by construction, already current. **No SEPARATE freshness check runs
 * on the passage text itself**: `deps.resolveIntroducingPassage` is the one
 * place that can discover the passage no longer reads as it did at fold
 * time (the note or block moved or was deleted since), and it signals that
 * by resolving `null` for that endpoint — see its own doc. A `null` or
 * absent port, or a `Provenance` neither endpoint can resolve, degrades
 * exactly as before this bead: `resolveRelationProvenance` sees an empty
 * `introducingPassages` array and falls through to `{kind: 'no-edge'}`
 * (F5.2a's own third, "written nowhere" case), which still includes the
 * neighbour's defining passages in `sourceBlocks`
 * (`buildGradingSourceMaterial`'s `'no-edge'` branch) — the no-port
 * behaviour this function already had.
 *
 * **Deduplicated against blocks already present, and bounded only by the
 * edge's own shape.** `ConceptRelation.introducingPassages` carries exactly
 * two `Provenance` values (`from`, `to`) — never a retrieved list — so
 * `resolveEdgeIntroducingPassages` naturally resolves at most two blocks
 * per call; no size cap exists anywhere in this pipeline for the assembled
 * `sourceBlocks`/`omissionDenominator` to apply on top of that (checked:
 * `explainBackJudge.ts`'s `z.array(sourceBlockRef)` request schema has no
 * `.max()`; `gradingPipeline.ts` and `mastery/gradingInputContract.ts`
 * apply none either; the nearest relative, retrieval's own
 * `DEFAULT_TOP_K = 8` in `packages/core/src/retrieval/groundedContext.ts:275`,
 * bounds each `retrieveSourceBlocks` CALL's hit count, not the composed
 * result this function assembles from already-resolved passages — a
 * different budget for a different step). A candidate already present in
 * `sourceBlocks` or `neighbourBlocks` (by `blockId`) is skipped, so a
 * passage that happens to be the same block already retrieved for the
 * subject or neighbour is never sent twice.
 */
async function resolveEdgeIntroducingPassages(
  deps: Pick<ExplainBackModalDeps, 'resolveIntroducingPassage'>,
  edge: ConceptRelation,
  alreadyPresentBlockIds: ReadonlySet<string>,
): Promise<readonly ExplainBackSourceBlock[]> {
  if (!deps.resolveIntroducingPassage) return [];
  const seen = new Set(alreadyPresentBlockIds);
  const resolved: ExplainBackSourceBlock[] = [];
  for (const provenance of [edge.introducingPassages.from, edge.introducingPassages.to]) {
    // Stale or missing — the port itself decided this passage no longer
    // reads as it did at fold time; adds nothing (see the dep's own doc).
    const block = await deps.resolveIntroducingPassage(provenance);
    if (block === null) continue;
    if (seen.has(block.block.blockId)) continue;
    seen.add(block.block.blockId);
    resolved.push(block);
  }
  return resolved;
}

/**
 * `ol-egov.141.89.6.50`: what `resolveGradingSourceBlocks` hands back — the
 * flattened blocks every existing caller already reads, PLUS the
 * `GradingSourceMaterial` that produced them and whether a relation context
 * was actually resolved, both previously computed here and then discarded
 * (`ol-egov.141.89.6.48`'s report named this exact loss: "modal.ts already
 * calls `buildGradingSourceMaterial`, gets a correct `GradingSourceMaterial`,
 * then flattens `.sourceBlocks` and DISCARDS `.omissionDenominator`"). A
 * caller that only reads `sourceBlocks` gets the pre-existing behaviour,
 * byte-identical.
 */
export interface ResolvedGradingSourceBlocks {
  readonly sourceBlocks: readonly ExplainBackSourceBlock[];
  /**
   * The material `buildGradingSourceMaterial` assembled for this call, kept
   * rather than flattened away — F5.3's omission denominator (subject
   * material plus the edge's own provenance, never the neighbour's own
   * defining passages) only survives the round trip if this is carried
   * forward to `recordSoloGradeAndReview`'s `resolved.sourceMaterial`
   * (`./request.ts`'s `buildGradeSoloInputFromTypedAnswer`). `undefined`
   * exactly when `subjectConceptId` is `null` — the free-form topic entry
   * point never builds one (see this function's own doc below).
   */
  readonly sourceMaterial: GradingSourceMaterial | undefined;
  /**
   * True exactly when `sourceMaterial` was built from a relation context
   * (`GradingRelationContext.kind === 'relation'`) — i.e. a live causes
   * partner actually resolved for this subject (F5.2a, `[D-083]`). Always
   * `false` when `sourceMaterial` is `undefined`.
   */
  readonly relationExpected: boolean;
  /**
   * `ol-egov.141.89.6.75` (F5.3a, C5.11): the resolved causes partner's concept KEY — the identity
   * `named.neighbourConceptId` the relation was composed from, never the partner's wording (which
   * is a retrieval query and nothing else). Carried forward so the write can name the neighbour in
   * the scheduling observation. `undefined` exactly when `relationExpected` is `false`: no partner
   * resolved, or the free-form topic entry point (`subjectConceptId === null`).
   */
  readonly neighbourConceptId: string | undefined;
  /**
   * `ol-egov.141.89.6.129` (`[D-611]`): the subject's and the neighbour's current wordings, for a
   * relation prompt's third reflection prompt (vocabulary registry §39). Wordings only, never an
   * identity. `undefined` exactly when `relationExpected` is `false`.
   */
  readonly relationNames: { readonly concept: string; readonly neighbour: string } | undefined;
}

export async function resolveGradingSourceBlocks(
  deps: Pick<
    ExplainBackModalDeps,
    'retrieveSourceBlocks' | 'resolveCausesPartner' | 'resolveIntroducingPassage'
  >,
  subjectConceptId: string | null,
  sourceBlocks: readonly ExplainBackSourceBlock[],
): Promise<ResolvedGradingSourceBlocks> {
  const partner =
    subjectConceptId !== null ? deps.resolveCausesPartner?.(subjectConceptId) : undefined;

  let named:
    | { readonly neighbourConceptId: string; readonly edge: ResolvedRelationEdge }
    | undefined;
  let neighbourBlocks: readonly ExplainBackSourceBlock[] = [];
  let introducingBlocks: readonly ExplainBackSourceBlock[] = [];
  let relationNames: ResolvedGradingSourceBlocks['relationNames'];
  if (partner !== undefined && subjectConceptId !== null) {
    // The partner is the OTHER end of the edge from the subject, named by key (an identity) and by
    // wording (a query): retrieval takes the wording, everything that identifies takes the key.
    const { edge, neighbourConceptId, neighbourName } = partner;
    neighbourBlocks = await deps.retrieveSourceBlocks(neighbourName);
    relationNames = { concept: partner.subjectName, neighbour: neighbourName };
    const alreadyPresentBlockIds = new Set(
      [...sourceBlocks, ...neighbourBlocks].map((entry) => entry.block.blockId),
    );
    introducingBlocks = await resolveEdgeIntroducingPassages(deps, edge, alreadyPresentBlockIds);
    named = {
      neighbourConceptId,
      edge: {
        evidence: 'current',
        provenance: edge.provenance,
        introducingPassages: introducingBlocks.map((entry) => entry.block),
      },
    };
  }

  const relation: GradingRelationContext = resolveGradingRelationContext(named);
  if (subjectConceptId === null) {
    return {
      sourceBlocks,
      sourceMaterial: undefined,
      relationExpected: false,
      neighbourConceptId: undefined,
      relationNames: undefined,
    };
  }

  const subjectDefiningPassages: ConceptDefiningPassages = {
    conceptId: subjectConceptId,
    passages: sourceBlocks.map((entry) => entry.block),
  };
  const material = buildGradingSourceMaterial({
    subject: { subjectConceptId },
    subjectDefiningPassages,
    relation,
    ...(named
      ? {
          neighbourDefiningPassages: {
            conceptId: named.neighbourConceptId,
            passages: neighbourBlocks.map((entry) => entry.block),
          },
        }
      : {}),
  });

  const lookup = new Map<string, ExplainBackSourceBlock>();
  for (const entry of [...sourceBlocks, ...neighbourBlocks, ...introducingBlocks]) {
    lookup.set(entry.block.blockId, entry);
  }
  const flattenedSourceBlocks = material.sourceBlocks.flatMap((block) => {
    const entry = lookup.get(block.blockId);
    return entry ? [entry] : [];
  });
  return {
    sourceBlocks: flattenedSourceBlocks,
    sourceMaterial: material,
    relationExpected: relation.kind === 'relation',
    neighbourConceptId: named?.neighbourConceptId,
    relationNames: relation.kind === 'relation' ? relationNames : undefined,
  };
}

interface ResolvedPrompt {
  /** The question as she reads it (`./request.ts`'s prompt-context builders own its wording). */
  readonly question: string;
  readonly subjectConceptId: string | null;
  /**
   * The question's id: the instrument's own id, or a fresh one for a free-form topic. The
   * `[D-460]` marker and the practice explanation both carry it, so the writer can read an
   * earlier attempt's exposure back from her log.
   */
  readonly originInstrumentId: string;
  /**
   * The supporting passages (F5.2, F5.2a): `resolveGradingSourceBlocks`'s lookup when the
   * question was resolved, shown after an answer, never searched for again. For a free-form topic
   * they are also the found list on the insufficient-notes refusal.
   */
  readonly passages: readonly ExplainBackSourceBlock[];
  /** The prompt's shape and, for a relation, the two wordings its reflection prompt names (registry §39). */
  readonly shape: ExplainBackReflectionShape;
  /**
   * `ol-0r92.104` [DOS-I9]: every concept this prompt concerned — the full
   * `instrument.conceptIds` for an instrument-seeded prompt; for a free-form
   * topic, the one concept it matched uniquely (`[D-322]`) or `[]`. Named by
   * a non-attempt record and by the practice explanation (D7.1, `[0]` the
   * concept explained); neither is written when it is empty.
   */
  readonly conceptIds: readonly string[];
  /**
   * `[STY-9]` (`ol-l5og.18.19`): the seeding instrument's own `courseCode` — real data, never
   * fabricated. `null` for a free-form topic entry: there is no instrument. `renderIdentityStrip`
   * reads this to decide whether to render anything at all.
   */
  readonly courseCode: string | null;
  /** `[STY-9]`: the seeding instrument's own `noteTitle`, carried alongside `courseCode`, same posture. */
  readonly noteTitle: string | null;
}

/** D7.1's `promptShape` for a prompt. */
function promptShapeOf(prompt: ResolvedPrompt): ExplainBackPromptShape {
  return prompt.shape.kind;
}

type ModalState =
  | { readonly phase: 'topic'; readonly topic: string }
  | { readonly phase: 'loading' }
  | { readonly phase: 'answering'; readonly prompt: ResolvedPrompt; readonly answer: string }
  | {
      /**
       * Between "Show the passages" and the passages appearing: the `[D-460]` marker is being
       * written. Her question and her explanation stay on screen; no wait line (registry §39).
       */
      readonly phase: 'revealing';
      readonly prompt: ResolvedPrompt;
      readonly answer: string;
      /** `ol-0r92.94` [DOS-C1]: minted once per answer at submit — see `submitAnswer`'s doc. */
      readonly attemptId: string;
      /** `ol-yj0k`: computed once at submit — see `submitAnswer`'s doc. */
      readonly durationMs: number | null;
    }
  | {
      /** Her explanation, the passages, the reflection prompts, "Done" and "Try again" (F5.2, F5.4). */
      readonly phase: 'passages';
      readonly prompt: ResolvedPrompt;
      readonly answer: string;
      readonly attemptId: string;
      readonly durationMs: number | null;
    }
  | {
      /**
       * A free-form topic whose lookup found nothing to explain against (an empty reference): the
       * insufficient-notes refusal, before any answer, exactly as before `[D-603]`.
       */
      readonly phase: 'refused';
      readonly prompt: ResolvedPrompt;
    }
  | {
      /**
       * `ol-0r92.104` [DOS-I9] (`[D-273]`, `[D-305]`): reached only from the
       * named skip action (`skipPrompt`) — never from `onClose`, which closes
       * the whole `Modal`. Nothing is shown: no passage, no reflection prompt,
       * no line about the prompt (F5.2, F5.7).
       */
      readonly phase: 'skipped';
    };

export class ExplainBackModal extends Modal {
  private readonly deps: ExplainBackModalDeps;
  private readonly seed: ExplainBackSeed;
  private state: ModalState;
  private readonly now: () => Date;
  /**
   * `ol-yj0k`: the moment the current prompt became visible to her — set
   * whenever a prompt enters the `'answering'` phase (first resolution, or
   * re-entry after "Try again"), and read once, at the top of `submitAnswer`,
   * to produce `durationMs`.
   */
  private presentedAtMs: number | null = null;

  /**
   * D7.1, `[D-614]`: the attempts at the current question she left by "Try
   * again", oldest first. Each later answer's practice explanation names the
   * passages shown after them (`passagesShownInView`), so "Try again" never
   * erases that exposure. Reset only when a new question is resolved.
   */
  private attemptsLeftByTryAgain: readonly string[] = [];

  /**
   * The attempts whose practice explanation this view has already asked the
   * writer for, so a second click on "Done" or "Try again" for the same
   * answer is not a second write. The writer is idempotent on the attempt id
   * as well, which is what covers a reopen or a reload.
   */
  private readonly practiceRecorded = new Set<string>();

  /** Row 50: `deps.feedbackExposureLedger`, or the session-wide one. */
  private readonly feedbackExposureLedger: FeedbackExposureLedger;

  /**
   * `[D-460]`: set once Obsidian closes this view. Passages that would appear
   * after that are never displayed.
   */
  private closed = false;

  /**
   * `[D-460]`: the marker for the passages on screen, held only while its
   * write before display has failed, so it can be written once more when she
   * leaves the passages. `null` otherwise.
   */
  private unwrittenFeedbackShown: ExplainBackFeedbackShownLogRecordInput | null = null;

  constructor(app: App, deps: ExplainBackModalDeps, seed: ExplainBackSeed) {
    super(app);
    this.deps = deps;
    this.feedbackExposureLedger = deps.feedbackExposureLedger ?? sessionFeedbackExposureLedger;
    this.seed = seed;
    this.now = deps.now ?? (() => new Date());
    this.state = seed.kind === 'freeform' ? { phase: 'topic', topic: '' } : { phase: 'loading' };
  }

  override onOpen(): void {
    this.titleEl.setText(EXPLAIN_BACK_MODAL_TITLE);
    if (this.seed.kind === 'instrument') {
      void this.resolveInstrumentPrompt(this.seed.instrument);
    }
    this.render();
  }

  override onClose(): void {
    // `ol-0r92.104` [DOS-I9] (`[D-306]`): a prompt she opened and closed
    // without submitting is recorded the same way a named skip is — one
    // non-attempt event, never which exit she took. `'answering'` is the ONLY
    // phase that means "the question is on screen and she has not yet
    // submitted". Fire-and-forget: `onClose` is synchronous, and
    // `recordNonAttemptIfPossible` never throws.
    if (this.state.phase === 'answering') void this.recordNonAttemptIfPossible(this.state.prompt);
    // `[D-460]`: she leaves the passages without "Done" or "Try again" and their marker never
    // reached her log: one more write, so a later answer is not read as written before them.
    if (this.state.phase === 'passages') this.writeUnwrittenFeedbackShown(this.state.attemptId);
    this.closed = true;
    this.contentEl.empty();
    this.deps.onClosed?.();
  }

  private async resolveInstrumentPrompt(instrument: ReviewInstrument): Promise<void> {
    const query = questionQuery(instrument);
    const sourceBlocks = await this.deps.retrieveSourceBlocks(query);
    const subjectConceptId = instrument.conceptIds[0] ?? null;
    // F5.2a's lookup, done once, here: the passages she is shown after answering are these, never
    // a fresh search. A resolved causes partner makes this a relation prompt.
    const lookup = await resolveGradingSourceBlocks(this.deps, subjectConceptId, sourceBlocks);
    const prompt: ResolvedPrompt = {
      question: buildExplainBackPromptContextFromInstrument(instrument, lookup.sourceBlocks)
        .question,
      subjectConceptId,
      originInstrumentId: instrument.instrumentId,
      passages: lookup.sourceBlocks,
      shape:
        lookup.relationExpected && lookup.relationNames !== undefined
          ? { kind: 'relation', ...lookup.relationNames }
          : { kind: 'concept' },
      conceptIds: instrument.conceptIds,
      // `[STY-9]`: real, already-available instrument fields — see `ResolvedPrompt.courseCode`.
      courseCode: instrument.courseCode,
      noteTitle: instrument.noteTitle,
    };
    this.enterNewQuestion(prompt);
  }

  private async resolveTopicPrompt(topic: string): Promise<void> {
    this.state = { phase: 'loading' };
    this.render();
    const sourceBlocks = await this.deps.retrieveSourceBlocks(topic);
    // A topic she typed herself is looked up by the topic alone, as before `[D-603]`: the
    // lookup's `null` subject returns the retrieval unchanged, and the prompt is a concept prompt.
    const lookup = await resolveGradingSourceBlocks(this.deps, null, sourceBlocks);
    // `[D-322]` (`ol-egov.141.89.6.4`): resolve the freeform topic to one subject concept HERE, at
    // composition time, before she ever sees an answer box. Absent, or `undefined`, is no match.
    const topicMatch: FreeformTopicConceptMatch = this.deps.matchFreeformTopicConcept?.(topic) ?? {
      kind: 'no-match',
    };
    const subjectConceptId = topicMatch.kind === 'unique' ? topicMatch.conceptId : null;
    const conceptIds = topicMatch.kind === 'unique' ? [topicMatch.conceptId] : [];
    const context = buildExplainBackPromptContextFromTopic(topic, lookup.sourceBlocks);
    const prompt: ResolvedPrompt = {
      question: context.question,
      subjectConceptId,
      originInstrumentId: this.deps.generateInstrumentId(),
      passages: lookup.sourceBlocks,
      shape: { kind: 'concept' },
      conceptIds,
      // `[STY-9]`: a freeform topic has no seeding instrument, so genuinely no course to report.
      courseCode: null,
      noteTitle: null,
    };
    if (context.referenceAnswer.trim() === '') {
      // Nothing to explain against: the insufficient-notes refusal, before any answer box, as
      // before `[D-603]`. No prompt is presented, so nothing is timed.
      this.state = { phase: 'refused', prompt };
      this.render();
      return;
    }
    this.enterNewQuestion(prompt);
  }

  /** A newly resolved question: a fresh clock, no earlier attempts in this view, an empty answer box. */
  private enterNewQuestion(prompt: ResolvedPrompt): void {
    this.presentedAtMs = this.now().getTime();
    this.attemptsLeftByTryAgain = [];
    this.state = { phase: 'answering', prompt, answer: '' };
    this.render();
  }

  /**
   * "Show the passages" (F5.2, `[D-603]`). Sends nothing anywhere: the
   * passages are already on her device. In order:
   *
   * 1. `durationMs` is computed HERE, at the moment she submits (`ol-yj0k`:
   *    milliseconds from presentation to answer), and `attemptId` is minted
   *    here, once per answer (`ol-0r92.94`).
   * 2. The session note and the `[D-460]` marker record the exposure, and the
   *    passages render only once the marker write has settled (F5.4). A
   *    closed view shows nothing and records nothing as shown.
   *
   * Her text stays in memory until she leaves the answer; it is written only
   * by the practice explanation, to the content store (D7.1).
   */
  private async submitAnswer(prompt: ResolvedPrompt, answer: string): Promise<void> {
    if (this.closed) return;
    const durationMs =
      this.presentedAtMs !== null ? Math.max(0, this.now().getTime() - this.presentedAtMs) : null;
    const attemptId = this.deps.generateInstrumentId();
    this.state = { phase: 'revealing', prompt, answer, attemptId, durationMs };
    this.render();
    // Row 50: the passages are about to be shown, so this session knows she was exposed.
    this.feedbackExposureLedger.noteShown(prompt.originInstrumentId, attemptId);
    // `[D-460]`: the marker reaches her log BEFORE the passages render.
    await this.recordFeedbackShownBeforeDisplay(prompt.originInstrumentId, attemptId);
    if (this.closed || this.state.phase !== 'revealing' || this.state.attemptId !== attemptId) {
      return;
    }
    this.state = { phase: 'passages', prompt, answer, attemptId, durationMs };
    this.render();
  }

  /**
   * `[D-460]` (`ol-egov.141.89.6.86`): writes the exposure marker for the
   * passages `submitAnswer` is about to show, and returns only once the write
   * has settled, so the passages never render before their marker.
   *
   * **A failed write** is absorbed (`writeFeedbackShown`): the passages still
   * render and she is never told. The view holds the exposure as shown (the
   * next answer's practice explanation names these passages, by digest) and
   * so does the session note; the marker is kept in `unwrittenFeedbackShown`
   * to be written once more when she leaves the passages. Unwired
   * (`deps.recordFeedbackShown` absent), nothing is written.
   */
  private async recordFeedbackShownBeforeDisplay(
    instrumentId: string,
    attemptId: string,
  ): Promise<void> {
    this.unwrittenFeedbackShown = null;
    const record = this.deps.recordFeedbackShown;
    if (!record) return;
    const input = feedbackShownRecordInput({ instrumentId, attemptId, at: this.now() });
    if (!(await writeFeedbackShown(record, input))) this.unwrittenFeedbackShown = input;
  }

  /**
   * `[D-460]`, `[D-520]`: the one retry of a marker whose write before display
   * failed, made as she leaves the passages ("Done", "Try again", or closing
   * the view). Writing it twice is harmless. Fire-and-forget; never throws.
   */
  private writeUnwrittenFeedbackShown(attemptId: string): void {
    const unwritten = this.unwrittenFeedbackShown;
    this.unwrittenFeedbackShown = null;
    if (unwritten === null || unwritten.attemptId !== attemptId) return;
    if (this.deps.recordFeedbackShown) {
      void writeFeedbackShown(this.deps.recordFeedbackShown, unwritten);
    }
  }

  /**
   * "Done" (registry §39): she leaves the answer. Its practice explanation is
   * written (D7.1), the marker is written once more if its first write
   * failed, and the view closes. Nothing is said about how she did.
   */
  private finishPractice(
    prompt: ResolvedPrompt,
    answer: string,
    attemptId: string,
    durationMs: number | null,
  ): void {
    void this.recordPracticeExplanationIfPossible(prompt, answer, attemptId, durationMs);
    this.writeUnwrittenFeedbackShown(attemptId);
    this.close();
  }

  /**
   * "Try again" (registry §39, F5.4): she leaves this answer and writes again
   * with her text still in the field. Its practice explanation is written
   * now, and the next answer is a separate attempt whose practice explanation
   * names the passages shown after this one (`[D-614]`: "Try again" never
   * erases exposure). The clock restarts for the next answer (`ol-yj0k`).
   */
  private tryAgain(
    prompt: ResolvedPrompt,
    answer: string,
    attemptId: string,
    durationMs: number | null,
  ): void {
    void this.recordPracticeExplanationIfPossible(prompt, answer, attemptId, durationMs);
    this.writeUnwrittenFeedbackShown(attemptId);
    this.attemptsLeftByTryAgain = [...this.attemptsLeftByTryAgain, attemptId];
    this.presentedAtMs = this.now().getTime();
    this.state = { phase: 'answering', prompt, answer };
    this.render();
  }

  /**
   * D7.1, `[D-614]`: the practice explanation for one answer she is leaving,
   * through `deps.recordPracticeExplanation`, once per attempt. The earlier
   * attempts it names are the ones she left by "Try again" before this one,
   * read before this one joins them.
   *
   * Writes nothing when the dep is unwired, or when the prompt names no
   * concept (a free-form topic that matched none: D7.1's `conceptIds` must be
   * non-empty, the same rule a non-attempt follows). A rejection is caught
   * and logged content-free (D-005), never thrown: it accompanies leaving the
   * answer, which completes either way. `{ written: false }` (her log already
   * holds this attempt) needs nothing more.
   */
  private async recordPracticeExplanationIfPossible(
    prompt: ResolvedPrompt,
    answer: string,
    attemptId: string,
    durationMs: number | null,
  ): Promise<void> {
    const record = this.deps.recordPracticeExplanation;
    if (!record || prompt.conceptIds.length === 0) return;
    if (this.practiceRecorded.has(attemptId)) return;
    this.practiceRecorded.add(attemptId);
    const earlierAttemptIds = this.attemptsLeftByTryAgain.filter((id) => id !== attemptId);
    const leftAt = this.now();
    try {
      await record(
        await practiceExplanationInput({
          instrumentId: prompt.originInstrumentId,
          attemptId,
          conceptIds: prompt.conceptIds,
          promptShape: promptShapeOf(prompt),
          durationMs,
          answer,
          leftAt,
          earlierAttemptIds,
          passageTexts: prompt.passages.map((entry) => entry.block.text),
        }),
      );
    } catch (error) {
      console.error('Olea: practice explanation record failed (leaving the answer unaffected)', {
        error,
      });
    }
  }

  /**
   * `ol-0r92.104` [DOS-I9] (`[D-273]`, SKIP-1): the named skip action — the
   * `'answering'` phase's OTHER button. Shows nothing and sends nothing: no
   * passage, no reflection prompt, so a skip is never a way to read the
   * passages without explaining first (F5.2). Synchronous; the non-attempt
   * write is best-effort and never blocks this transition.
   */
  private skipPrompt(prompt: ResolvedPrompt): void {
    void this.recordNonAttemptIfPossible(prompt);
    this.state = { phase: 'skipped' };
    this.render();
  }

  /**
   * `ol-0r92.104` [DOS-I9] (D7.1, `[D-304]`, `[D-306]`): the one place both
   * `skipPrompt` and `onClose`'s `'answering'` guard write a non-attempt
   * event through — never called for an answer she submitted (`[D-304]`).
   *
   * Writes nothing, silently, when `deps.recordNonAttempt` is unwired or when
   * `prompt.conceptIds` is empty (`canRecordNonAttempt`, `./skip.ts`). A
   * failed write is caught and logged content-free (D-005), never thrown.
   */
  private async recordNonAttemptIfPossible(prompt: ResolvedPrompt): Promise<void> {
    if (!this.deps.recordNonAttempt || !canRecordNonAttempt(prompt.conceptIds)) return;
    // F5.7, D7.1: once she has left an answer by "Try again", this prompt produced an
    // explanation, so leaving the next answer box unanswered is not a non-attempt of it.
    if (this.attemptsLeftByTryAgain.length > 0) return;
    try {
      await this.deps.recordNonAttempt({
        conceptIds: prompt.conceptIds,
        timestamp: this.now().toISOString(),
      });
    } catch (error) {
      console.error('Olea: non-attempt record failed (skip/close unaffected)', { error });
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('olea-explain-back');

    switch (this.state.phase) {
      case 'topic':
        this.renderTopicPhase(root, this.state.topic);
        return;
      case 'loading':
        // No words: the wait line registry §39 retired promised a check that no longer runs,
        // and no loading line is ruled. The region keeps its place while the lookup runs.
        root.createDiv({ cls: 'olea-explain-back-loading' });
        return;
      case 'answering':
        this.renderAnsweringPhase(root, this.state.prompt, this.state.answer);
        return;
      case 'revealing':
        this.renderQuestion(root, this.state.prompt);
        this.renderExplanation(root, this.state.answer);
        return;
      case 'passages':
        this.renderPassagesPhase(
          root,
          this.state.prompt,
          this.state.answer,
          this.state.attemptId,
          this.state.durationMs,
        );
        return;
      case 'refused':
        this.renderRefusedPhase(root, this.state.prompt);
        return;
      case 'skipped':
        this.renderSkippedPhase(root);
        return;
    }
  }

  private renderTopicPhase(root: HTMLElement, topic: string): void {
    root.createEl('p', { text: EXPLAIN_BACK_TOPIC_PROMPT });
    const input = root.createEl('input', { type: 'text', cls: 'olea-explain-back-topic' });
    input.value = topic;
    // `[STY-9]` (`ol-l5og.18.19`, fix-list item 1): the kit's primary-action fill, same class the
    // answering phase's submit button below takes.
    const button = root.createEl('button', {
      cls: 'olea-explain-back-primary',
      text: EXPLAIN_BACK_TOPIC_CONTINUE_LABEL,
    });
    button.addEventListener('click', () => {
      const value = input.value.trim();
      if (value.length === 0) return;
      void this.resolveTopicPrompt(value);
    });
  }

  /**
   * The question, and registry §39's notice on every prompt (`[D-611]`):
   * every phase that shows a question shows the notice beneath it, whatever
   * the prompt's shape and whichever ruled entry point opened it (F5.1).
   */
  private renderQuestion(root: HTMLElement, prompt: ResolvedPrompt): void {
    this.renderIdentityStrip(root, prompt);
    const header = root.createDiv({ cls: 'olea-explain-back-header' });
    header.createDiv({
      cls: 'olea-explain-back-question-label',
      text: EXPLAIN_BACK_QUESTION_LABEL,
    });
    this.renderMasteryTag(header, prompt.subjectConceptId);
    root.createDiv({ cls: 'olea-explain-back-question', text: prompt.question });
    // No `cls`: a bare element, the same posture `[D-322]`'s placeholder notice it replaces took.
    root.createDiv({ text: EXPLAIN_BACK_PRACTICE_NOTICE });
  }

  /**
   * `[STY-9]` (fix-list item 2): the course/note identity line the kit's `Head` places above the
   * prompt — same course/note-title pair `review/view.ts`'s own `meta` renders. Renders nothing
   * for a free-form topic entry (`prompt.courseCode === null`).
   */
  private renderIdentityStrip(root: HTMLElement, prompt: ResolvedPrompt): void {
    if (prompt.courseCode === null) return;
    const strip = root.createDiv({ cls: 'olea-explain-back-identity' });
    strip.createSpan({ cls: 'olea-explain-back-identity-course', text: prompt.courseCode });
    if (prompt.noteTitle === null || prompt.noteTitle.trim() === '') return;
    strip.createSpan({ cls: 'olea-explain-back-identity-dot' });
    strip.createSpan({ cls: 'olea-explain-back-identity-note', text: prompt.noteTitle });
  }

  /**
   * `[STY-0d]`: the sprig-plus-word tag the kit places on every explain-back
   * screen — same shape as `gap/view.ts`'s `.olea-gap-mastery`. Renders
   * nothing for a free-form, unmatched topic (`subjectConceptId === null`)
   * and nothing until `deps.getMasteryState` answers — never a fabricated
   * stage. It reads her concept's existing stage; nothing on this view moves
   * it (F5.5).
   */
  private renderMasteryTag(parent: HTMLElement, subjectConceptId: string | null): void {
    if (subjectConceptId === null) return;
    const state = this.deps.getMasteryState?.(subjectConceptId) ?? null;
    if (state === null) return;
    const tag = parent.createSpan({ cls: 'olea-explain-back-mastery' });
    tag.appendChild(renderSprig({ state, size: 14, container: tag }));
    tag.createSpan({ text: state });
  }

  /**
   * The answering phase: the question, a textarea and two buttons. **Nothing
   * open beside her while she writes** — no passage, no hint — so a first
   * answer is written unaided, and the passages appear only after she
   * submits (F5.2, F5.4).
   */
  private renderAnsweringPhase(root: HTMLElement, prompt: ResolvedPrompt, answer: string): void {
    this.renderQuestion(root, prompt);
    const textarea = root.createEl('textarea', {
      cls: 'olea-explain-back-answer',
      attr: { placeholder: EXPLAIN_BACK_ANSWER_PLACEHOLDER },
    });
    textarea.value = answer;
    // `[STY-9]` (fix-list item 1): same primary class `renderTopicPhase`'s Continue button takes.
    const button = root.createEl('button', {
      cls: 'olea-explain-back-primary',
      text: EXPLAIN_BACK_SUBMIT_LABEL,
    });
    button.addEventListener('click', () => {
      // `ol-0r92.98`: mirrors `renderTopicPhase`'s own guard above — an empty
      // or whitespace-only answer is a no-op: no passages, no marker, no
      // practice explanation, so an empty submit is never a way to read the
      // passages without explaining first (F5.2). Deliberately NOT the
      // explicit "skip" action (`[DOS-I9]`, SKIP-2/3/4): it writes nothing.
      if (isBlankExplainBackAnswer(textarea.value)) return;
      void this.submitAnswer(prompt, textarea.value);
    });
    // `ol-0r92.104` [DOS-I9]: the named skip action — a second, independent
    // button, never the same click handler as the guard above. No `cls`: the
    // kit's ghost "Skip for now" is secondary and unfilled.
    const skip = root.createEl('button', { text: EXPLAIN_BACK_SKIP_LABEL });
    skip.addEventListener('click', () => this.skipPrompt(prompt));
  }

  /** Her explanation as she wrote it, one paragraph per line, read-only. */
  private renderExplanation(root: HTMLElement, answer: string): void {
    const explanation = root.createDiv({ cls: 'olea-explain-back-item-text' });
    for (const line of answer.split('\n')) explanation.createEl('p', { text: line });
  }

  /**
   * After an answer (F5.2, F5.4 as amended; registry §39): her explanation,
   * then under "From your notes" the passages the prompt carries, each with
   * its note's label, then the reflection prompts for the prompt's shape —
   * text only, with no answer field — and the end controls "Done" and "Try
   * again". Nothing here grades, ranks or describes her explanation: no
   * depth heading, no omission, error or confusion region, no misconception
   * region, no follow-up question, no first-full-depth sentence, and no
   * "See in registry" (it followed cited findings, and there are none, F5.3).
   *
   * With no passages (a lookup that found none for an instrument's
   * question), the same view renders with an empty list, as the prompt is
   * offered today; no line is added for it.
   */
  private renderPassagesPhase(
    root: HTMLElement,
    prompt: ResolvedPrompt,
    answer: string,
    attemptId: string,
    durationMs: number | null,
  ): void {
    this.renderQuestion(root, prompt);
    this.renderExplanation(root, answer);
    root.createDiv({ cls: 'olea-explain-back-heading', text: EXPLAIN_BACK_PASSAGES_HEADING });
    const list = root.createDiv({ cls: 'olea-explain-back-region-items' });
    for (const passage of prompt.passages) {
      const row = list.createDiv({ cls: 'olea-explain-back-item' });
      row.createDiv({ cls: 'olea-explain-back-item-text', text: passage.block.text });
      const label = passageSourceLabel(passage);
      if (label !== null) row.createDiv({ cls: 'olea-explain-back-cite', text: label });
    }
    for (const reflection of explainBackReflectionPrompts(prompt.shape)) {
      root.createEl('p', { text: reflection });
    }
    const actions = root.createDiv({ cls: 'olea-explain-back-actions' });
    const done = actions.createEl('button', { text: EXPLAIN_BACK_DONE_LABEL });
    done.addEventListener('click', () =>
      this.finishPractice(prompt, answer, attemptId, durationMs),
    );
    const tryAgain = actions.createEl('button', { text: EXPLAIN_BACK_DISCARD_LABEL });
    tryAgain.addEventListener('click', () => this.tryAgain(prompt, answer, attemptId, durationMs));
  }

  /**
   * [STY-0h] (`ol-l5og.18.8`): the insufficient-notes refusal for a free-form
   * topic whose lookup found nothing to explain against — dashed edge and,
   * whenever retrieval returned anything at all, the found-list itself
   * (C4.7's permitted content). Reached before any answer, as before
   * `[D-603]`.
   */
  private renderRefusedPhase(root: HTMLElement, prompt: ResolvedPrompt): void {
    this.renderQuestion(root, prompt);
    const box = root.createDiv({
      cls: 'olea-explain-back-refusal-box olea-explain-back-refusal-box--absent',
    });
    const eyebrow = box.createDiv({ cls: 'olea-explain-back-refusal-eyebrow' });
    eyebrow.createSpan({ cls: 'olea-explain-back-refusal-eyebrow-mark--dashed' });
    eyebrow.createSpan({
      cls: 'olea-explain-back-refusal-eyebrow-text',
      text: EXPLAIN_BACK_NOTHING_MATCHED_EYEBROW,
    });
    box.createEl('p', {
      cls: 'olea-explain-back-refusal',
      text: explainBackInsufficientNotesRefusal(prompt.passages.length),
    });
    if (prompt.passages.length > 0) this.renderFoundList(box, prompt.passages);
  }

  /**
   * The found-list `renderRefusedPhase` shows when retrieval returned at least
   * one block — read-only (the note path and the passage text itself, never a
   * summary of it).
   */
  private renderFoundList(parent: HTMLElement, blocks: readonly ExplainBackSourceBlock[]): void {
    const wrap = parent.createDiv({ cls: 'olea-explain-back-found-list' });
    wrap.createDiv({
      cls: 'olea-explain-back-found-list-caption',
      text: EXPLAIN_BACK_FOUND_LIST_CAPTION,
    });
    const rows = wrap.createDiv({ cls: 'olea-explain-back-found-list-rows' });
    for (const block of blocks) {
      const row = rows.createDiv({ cls: 'olea-explain-back-found-list-row' });
      row.createSpan({ cls: 'olea-explain-back-found-list-path', text: block.path });
      row.createSpan({ cls: 'olea-explain-back-found-list-text', text: block.block.text });
    }
  }

  /**
   * `ol-0r92.104` [DOS-I9] (`[D-305]`): a skip closes with nothing said and
   * nothing shown — no line about the prompt, no passage, no reflection
   * prompt (F5.2, F5.7) — above the shared Done button.
   */
  private renderSkippedPhase(root: HTMLElement): void {
    this.renderDoneButton(root);
  }

  private renderDoneButton(root: HTMLElement): void {
    const button = root.createEl('button', { text: EXPLAIN_BACK_DONE_LABEL });
    button.addEventListener('click', () => this.close());
  }
}

/**
 * A passage's source label: `olea-core`'s `formatSourceCitation` for the note
 * it came from — never a second, re-typed basename routine — and `null` when
 * the note is unknown, never an invented source.
 */
function passageSourceLabel(passage: ExplainBackSourceBlock): string | null {
  return passage.path.trim() === '' ? null : formatSourceCitation({ sourcePath: passage.path });
}

function questionQuery(instrument: ReviewInstrument): string {
  switch (instrument.type) {
    case 'qa':
      return instrument.question;
    case 'cloze':
      return `${instrument.before} ${instrument.after}`;
    case 'mcq':
      return instrument.stem;
  }
}
