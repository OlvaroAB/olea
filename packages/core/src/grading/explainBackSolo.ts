/**
 * The client-side SOLO depth grading pipeline (`ol-95vv.2` [MAT-5], `[D-117]`,
 * knowledge model R7/R9) — the production caller `gradingInputContract.ts`
 * (`ol-0r92.4` [MAT-4]) was built without one, and the seam design
 * (`../olea-service/docs/dev/verdict-seam-design.md`) names this bead as the
 * intended producer of `explainBackGrade`/`schedulingObservation`.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE PIPELINE FROM `gradingPipeline.ts`
 * ===========================================================================
 * `gradeExplainBack` (`./gradingPipeline.ts`) grades correctness against a
 * synthesized reference answer. This pipeline grades a different, orthogonal
 * property of the SAME explain-back attempt: the SOLO structural depth R7's
 * top-stage gate reads. They are independent calls to independent Worker task
 * ids (`explain-back.judge.v1` vs `explain-back.solo.v1`) because they answer
 * independent questions — see `olea-service/src/tasks/explainBackSolo.ts`'s
 * module header for the fuller argument. Nothing here calls or depends on
 * `gradingPipeline.ts`.
 *
 * ===========================================================================
 * THE WIRE TYPES ARE A MIRROR, NOT AN IMPORT (same reason as `gradingPipeline.ts`)
 * ===========================================================================
 * `olea-core` cannot depend on `olea-service` — `ExplainBackSoloWireRequest`/
 * `ExplainBackSoloWireResponse` below are a maintained mirror of
 * `olea-service/src/tasks/explainBackSolo.ts`'s zod schemas, not a shared
 * type. `SoloLevel` is the one exception, imported from `olea-contracts`
 * rather than re-declared as a fourth copy of the same five-level union — it
 * already exists there as the WIRE ENCODING of R9's verdict
 * (`contracts/review-log.ts`'s `soloLevel`), and the persisted enum and this
 * task's response enum are the same five values by design (R9's rule is
 * stated once; a second, hand-maintained literal union here would just be a
 * second place for the two to silently disagree).
 *
 * ===========================================================================
 * R9, STRUCTURALLY, ON THE CLIENT SIDE TOO
 * ===========================================================================
 * Nothing in this file ever holds, computes or emits a mastery estimate.
 * `PendingSoloGrading`/`AcceptedSoloGrading` carry `soloLevel` (one of five
 * fixed labels) and nothing numeric — nothing here could feed a stage or a
 * vitality reading directly even if a future edit tried, because there is no
 * field shaped like one. The fold (`../mastery/rollup.ts`, out of scope here)
 * is the only place a stage number is ever computed, and it computes it from
 * the REVIEW LOG, never from this pipeline's return value directly.
 *
 * ===========================================================================
 * INV-6: PENDING, NEVER ACCEPTED, UNTIL SHE SAYS SO
 * ===========================================================================
 * `gradeSolo` returns a `PendingSoloGrading`; only `acceptSoloGrading` turns
 * it into something fit to feed a review event, mirroring
 * `acceptExplainBackGrading`/`acceptGeneratedMcq`'s existing boundary.
 *
 * ===========================================================================
 * WHERE THIS STOPS, NAMED RATHER THAN HIDDEN (D-072's escape hatch)
 * ===========================================================================
 * `buildExplainBackGradeReviewFields` produces plain `explainBackGrade`/
 * `schedulingObservation` VALUES, ready to be spread onto the SAME
 * `ReviewLogRecordInput` the subject's own rating attempt writes (review-log
 * is append-only; there is no "attach to an already-written event" — the
 * fields must be present on the record at the moment it is first appended,
 * per `[D-117]`'s "rides the same review event" ruling). This module never
 * calls `appendReviewLogRecord` itself: the actual call site that assembles a
 * `ReviewLogRecordInput` for an explain-back review lives in
 * `packages/core/src/study-session/`, a module this bead does not own (see
 * this bead's `owns`). `features/F5-explain-it-back.md`'s SOLO block names
 * this seam as a `@manual` scenario, the same shape `ol-drfy` left
 * `gradeExplainBack` in before its own follow-on (`ol-p4t05`-adjacent) wired
 * it into `main.ts`.
 *
 * `contentRef` (the `[D-077]` content store pointer) is likewise never
 * manufactured here — `buildExplainBackGradeReviewFields` takes it as a
 * required input. The `[D-077]` content store itself (`ol-2jod.8`) does not
 * exist anywhere in this repo as of this writing (checked: no
 * `content-store.ts` file anywhere under `packages/core/src`, despite
 * `features/F5-explain-it-back.md` citing a `content-store.spec` test that
 * does not exist either — a pre-existing dangling citation, not one this
 * bead introduces or fixes). A caller cannot honestly have a real
 * `contentRef` until that store is built; this module refuses to fabricate
 * one and says so at the parameter, not in a comment nobody reads at the call
 * site.
 *
 * `CandidateEdgeNomination` (surfaced unchanged on `PendingSoloGrading`,
 * exactly as `buildGradingSourceMaterial` produced it) is likewise not turned
 * into an edge here. Doing that means re-entering the corpus-relations
 * candidate pipeline (`../concept/corpus-relations/`) as a new nomination
 * signal, which needs a new `NominationSignalKind` member in a closed union
 * this bead does not own (`owns` names `./` and `../mastery/
 * gradingInputContract.ts`'s consumers, not `../concept/corpus-relations/`)
 * plus a concept-id-to-name resolution `nominate.ts` does not yet accept.
 * Named here and in the scenario file rather than reaching into a file
 * another lane may be mid-change on.
 */

import type { SoloLevel } from 'olea-contracts';
import type {
  CandidateEdgeNomination,
  GradingSourceMaterial,
} from '../mastery/gradingInputContract.js';
import type { SourceBlockRef } from './gradingPipeline.js';

export type { SoloLevel };

// ---------------------------------------------------------------------------
// Wire types — mirror explainBackSolo.ts's zod schemas (see module header)
// ---------------------------------------------------------------------------

/** The `explain-back.solo.v1` request exactly as the Worker's zod schema shapes it. */
export interface ExplainBackSoloWireRequest {
  readonly question: string;
  readonly studentAnswer: string;
  readonly sourceBlocks: readonly SourceBlockRef[];
  readonly relationExpected: boolean;
}

/** The response shape exactly as `explain-back.solo.v1` returns it, before grounding. */
export interface ExplainBackSoloWireResponse {
  readonly soloLevel: SoloLevel;
  readonly rationale: string;
  readonly citedBlockIds: readonly string[];
  readonly neighbourUseDemonstrated?: boolean;
}

/** Performs the actual model call. Not implemented here — see `./workerSoloJudgeCaller.ts`. */
export type SoloJudgeCaller = (
  input: ExplainBackSoloWireRequest,
) => Promise<ExplainBackSoloWireResponse>;

// ---------------------------------------------------------------------------
// Grounding — client-side primary check, mirroring `groundCitations`
// ---------------------------------------------------------------------------

export interface GroundedSoloGrading {
  readonly soloLevel: SoloLevel;
  readonly rationale: string;
  /** Only ids the caller actually supplied — never a fabricated one (INV-5). */
  readonly citedBlockIds: readonly string[];
  /** Present only when `relationExpected` was true — see the module header. */
  readonly neighbourUseDemonstrated?: boolean;
  /** False when no source blocks were supplied at all — citations were never possible. */
  readonly citationsAvailable: boolean;
  /** Count only — never the dropped ids themselves (D-005). */
  readonly droppedCitationCount: number;
}

/**
 * Filters `citedBlockIds` down to ids actually in `sourceBlocks`, and drops
 * `neighbourUseDemonstrated` entirely when `relationExpected` is false — the
 * same two checks `explainBackSolo.ts`'s (olea-service) `groundResponse`
 * applies Worker-side, run here first as the primary layer (mirroring
 * `groundCitations`'s role for the correctness judge; the Worker-side check
 * is defence in depth, not a substitute — see that task's own module doc).
 */
export function groundSoloResponse(
  response: ExplainBackSoloWireResponse,
  sourceBlocks: readonly SourceBlockRef[],
  relationExpected: boolean,
): GroundedSoloGrading {
  const knownIds = new Set(sourceBlocks.map((block) => block.blockId));
  const citedBlockIds = response.citedBlockIds.filter((id) => knownIds.has(id));
  const droppedCitationCount = response.citedBlockIds.length - citedBlockIds.length;

  return {
    soloLevel: response.soloLevel,
    rationale: response.rationale,
    citedBlockIds,
    citationsAvailable: sourceBlocks.length > 0,
    droppedCitationCount,
    // A model claiming demonstrated neighbour use on a concept-only prompt is
    // inventing a second scoring dimension outside what was asked (C5.11) —
    // dropped, not merely ignored, so nothing downstream could read it.
    ...(relationExpected && response.neighbourUseDemonstrated !== undefined
      ? { neighbourUseDemonstrated: response.neighbourUseDemonstrated }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The pipeline: build request from the input contract -> call -> ground -> pending
// ---------------------------------------------------------------------------

export interface GradeSoloInput {
  readonly question: string;
  /** Empty is a valid "she gave no answer" — the honest level for that is `prestructural`, not a refusal (mirrors `explainBackSolo.ts`'s `studentAnswer`). */
  readonly studentAnswer: string;
  /**
   * `buildGradingSourceMaterial`'s output (`../mastery/gradingInputContract.ts`,
   * `[D-083]`) — this pipeline never re-derives retrieval or re-decides the
   * grading unit, both already ruled. `omissionDenominator` is not read here
   * (SOLO grades structure, not omissions); `candidateEdgeNomination` is
   * threaded through unchanged onto the pending result — see the module
   * header for why it stops there.
   */
  readonly sourceMaterial: GradingSourceMaterial;
  /**
   * True exactly when `sourceMaterial` was built from a
   * `GradingRelationContext.kind === 'relation'` — decided by whatever built
   * `sourceMaterial`, never re-derived here (there is nothing in
   * `GradingSourceMaterial` itself that distinguishes the two cases once the
   * source blocks are flattened).
   */
  readonly relationExpected: boolean;
}

export interface PendingSoloGrading {
  readonly status: 'pending-review';
  readonly soloLevel: SoloLevel;
  readonly rationale: string;
  readonly citedBlockIds: readonly string[];
  readonly neighbourUseDemonstrated?: boolean;
  readonly citationsAvailable: boolean;
  readonly droppedCitationCount: number;
  /** Threaded straight from `sourceMaterial`, unchanged by grading — see the module header for why this pipeline does not turn it into an edge itself. */
  readonly candidateEdgeNomination: CandidateEdgeNomination | null;
}

/**
 * The whole client-side SOLO pipeline: build the wire request from
 * `GradingSourceMaterial`, call the model, ground the response, return a
 * `PendingSoloGrading` — never an accepted one (INV-6).
 *
 * No `UnusableGradingInputError` analog to `gradeExplainBack`'s: unlike
 * correctness grading, SOLO structure grading has no "nothing to grade
 * against" precondition — an empty `studentAnswer` is honestly
 * `prestructural`, not unusable input, and `sourceBlocks` being empty
 * degrades what can be cited, not whether a level can be assigned (mirrors
 * `explainBackSolo.ts`'s own `grounding: null` reasoning: refusing to grade
 * is not an available honest answer, because the answer exists).
 */
export async function gradeSolo(
  input: GradeSoloInput,
  callSolo: SoloJudgeCaller,
): Promise<PendingSoloGrading> {
  const sourceBlocks = input.sourceMaterial.sourceBlocks;
  const wire = await callSolo({
    question: input.question,
    studentAnswer: input.studentAnswer,
    sourceBlocks,
    relationExpected: input.relationExpected,
  });
  const grounded = groundSoloResponse(wire, sourceBlocks, input.relationExpected);
  return {
    status: 'pending-review',
    soloLevel: grounded.soloLevel,
    rationale: grounded.rationale,
    citedBlockIds: grounded.citedBlockIds,
    citationsAvailable: grounded.citationsAvailable,
    droppedCitationCount: grounded.droppedCitationCount,
    candidateEdgeNomination: input.sourceMaterial.candidateEdgeNomination,
    ...(grounded.neighbourUseDemonstrated !== undefined
      ? { neighbourUseDemonstrated: grounded.neighbourUseDemonstrated }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The accept step (INV-6)
// ---------------------------------------------------------------------------

const KNOWN_SOLO_LEVELS: ReadonlySet<string> = new Set([
  'prestructural',
  'unistructural',
  'multistructural',
  'relational',
  'extended-abstract',
]);

export interface AcceptedSoloGrading {
  readonly status: 'accepted';
  readonly soloLevel: SoloLevel;
  readonly rationale: string;
  readonly citedBlockIds: readonly string[];
  readonly neighbourUseDemonstrated?: boolean;
}

/**
 * The one function that turns a `PendingSoloGrading` into something fit to
 * feed `buildExplainBackGradeReviewFields` — mirroring
 * `acceptExplainBackGrading`/`acceptGeneratedMcq`'s INV-6 boundary. A UI
 * calls this only after she has seen and accepted the grading; nothing in
 * this module calls it for her.
 *
 * Re-asserts `soloLevel` is one of the five known values rather than trusting
 * `pending` was constructed honestly — defensive, not redundant, the same
 * posture `acceptExplainBackGrading` takes for re-checking citations at its
 * own boundary (a TypeScript type does not survive a hand-built object at a
 * call site that bypassed `gradeSolo`).
 */
export function acceptSoloGrading(pending: PendingSoloGrading): AcceptedSoloGrading {
  if (!KNOWN_SOLO_LEVELS.has(pending.soloLevel)) {
    throw new Error(
      `acceptSoloGrading: "${pending.soloLevel}" is not one of the five SOLO levels — refusing to accept a grading with an unrecognised depth`,
    );
  }
  return {
    status: 'accepted',
    soloLevel: pending.soloLevel,
    rationale: pending.rationale,
    citedBlockIds: pending.citedBlockIds,
    ...(pending.neighbourUseDemonstrated !== undefined
      ? { neighbourUseDemonstrated: pending.neighbourUseDemonstrated }
      : {}),
  };
}

/**
 * The other side of the accept step: she reviewed the grading and rejected
 * it. `null` is the whole return value, deliberately, so a caller cannot
 * accidentally forward a discarded result by forgetting to check a status
 * field (mirrors `discardExplainBackGrading`).
 */
export function discardSoloGrading(_pending: PendingSoloGrading): null {
  return null;
}

// ---------------------------------------------------------------------------
// Review-log field values — ready to spread onto the subject's own event
// ---------------------------------------------------------------------------

/** Matches `contracts/review-log.ts`'s `artifactProvenance` shape (D7.3, D-005). */
export interface SoloArtifactProvenance {
  readonly taskId: string;
  readonly promptVersion: string;
  readonly modelId: string;
}

export interface BuildExplainBackGradeReviewFieldsInput {
  readonly accepted: AcceptedSoloGrading;
  /**
   * The `[D-077]` content store pointer for this grade's evidence (her
   * answer, the rationale). Required, never manufactured here — see the
   * module header for why the store this would come from does not exist yet.
   */
  readonly contentRef: string;
  /**
   * The eventId of a PRIOR review event this one re-grades — `null` for a
   * fresh attempt (the ordinary case), matching `explainBackGrade.revisionOf`'s
   * explicit-null discipline (never omitted).
   */
  readonly revisionOf: string | null;
  readonly artifactProvenance: SoloArtifactProvenance;
  /**
   * Required exactly when `accepted.neighbourUseDemonstrated` is `true` —
   * checked, not assumed. The client already knows this from
   * `GradingRelationContext.neighbourConceptId` (decided when the prompt was
   * composed, C5.11) — it is never read off the model's response, which
   * carries no field a neighbour could be identified by (see module header).
   */
  readonly neighbourConceptId?: string;
}

export interface ExplainBackGradeReviewFields {
  /** Matches `contracts/review-log.ts`'s `explainBackGrade` shape exactly. */
  readonly explainBackGrade: {
    readonly soloLevel: SoloLevel;
    readonly contentRef: string;
    readonly revisionOf: string | null;
    readonly artifactProvenance: SoloArtifactProvenance;
  };
  /**
   * `undefined` (absent), never `null` — matches `reviewLogRecordV5`'s
   * `.optional()` discipline for this field. Present only when
   * `accepted.neighbourUseDemonstrated` was `true`.
   */
  readonly schedulingObservation: { readonly neighbourConceptId: string } | undefined;
}

/**
 * Builds the plain field values a caller spreads onto the SAME
 * `ReviewLogRecordInput` the subject's own rating attempt writes — see the
 * module header for why this function stops there rather than calling
 * `appendReviewLogRecord` itself. Pure, synchronous, no I/O, no vault access
 * (mirrors every other export in this module and in `gradingInputContract.ts`).
 */
export function buildExplainBackGradeReviewFields(
  input: BuildExplainBackGradeReviewFieldsInput,
): ExplainBackGradeReviewFields {
  if (input.accepted.neighbourUseDemonstrated && !input.neighbourConceptId) {
    throw new Error(
      'buildExplainBackGradeReviewFields: accepted.neighbourUseDemonstrated is true but no ' +
        'neighbourConceptId was supplied — the caller must know this from GradingRelationContext',
    );
  }
  return {
    explainBackGrade: {
      soloLevel: input.accepted.soloLevel,
      contentRef: input.contentRef,
      revisionOf: input.revisionOf,
      artifactProvenance: input.artifactProvenance,
    },
    schedulingObservation: input.accepted.neighbourUseDemonstrated
      ? { neighbourConceptId: input.neighbourConceptId as string }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Telemetry — counts and a level only, never content
// ---------------------------------------------------------------------------

export interface SoloGradingTelemetrySummary {
  readonly soloLevel: SoloLevel;
  readonly citedBlockCount: number;
  readonly neighbourUseDemonstrated: boolean | undefined;
  readonly droppedCitationCount: number;
}

/** Never `rationale` — see the module header's "never log content" discipline (D-005). */
export function summarizeSoloGradingForTelemetry(
  pending: PendingSoloGrading,
): SoloGradingTelemetrySummary {
  return {
    soloLevel: pending.soloLevel,
    citedBlockCount: pending.citedBlockIds.length,
    neighbourUseDemonstrated: pending.neighbourUseDemonstrated,
    droppedCitationCount: pending.droppedCitationCount,
  };
}
