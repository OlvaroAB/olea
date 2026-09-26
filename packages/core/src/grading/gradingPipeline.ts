/**
 * The client-side explain-back grading pipeline (F5.2–F5.4, `ol-p4t02`
 * [P4-T02]) — wires the mechanical restatement pre-check (`ol-nvdk`,
 * `restatementOverlap.ts`, imported and never edited here) upstream of a
 * `explain-back.judge.v1` (Slot J) call, grounds every citation the model
 * returns against the source blocks the caller actually supplied, and gates
 * the result behind an explicit accept step (INV-6) before it is fit to feed
 * the two downstream consumers being built in parallel: the misconception
 * store (`ol-p4t04`) and the mastery rollup (`ol-p4t06`).
 *
 * ===========================================================================
 * WHY THE WIRE TYPES ARE A MIRROR, NOT AN IMPORT
 * ===========================================================================
 *
 * `olea-core` (this package, public repo) cannot depend on `olea-service`
 * (private repo, INV-3) — there is no import path between them, by design.
 * The types below (`SourceBlockRef`, `CitedIssue`, `MisconceptionCandidate`,
 * `ExplainBackGradingWireResponse`, `ExplainBackJudgeWireRequest`) are
 * therefore a **maintained mirror** of
 * `olea-service/src/tasks/explainBackJudge.ts`'s zod schemas, not a shared
 * type. That is a real drift risk with no compiler to catch it — the two
 * files must be read together whenever either changes. Recorded here rather
 * than assumed away.
 *
 * `MisconceptionDigestEntry` is the one exception, and deliberately **is** a
 * real import (`../misconception/digest.js`, `ol-p4t04`): D-008's digest is
 * *produced* by that module from the misconception store's own projection,
 * so it is the actual producer type, not something this file should
 * redefine and risk drifting from. This pipeline maps it down to the
 * Worker's minimal `{ concept, statement }` wire shape — see
 * `toWireMisconceptionDigest` — because the digest's other fields
 * (`id`, `status`, `occurrenceCount`) are store bookkeeping the grader has
 * no use for, per D-005/D-008's "send the minimum transient context".
 *
 * ===========================================================================
 * THE PIPELINE SHAPE
 * ===========================================================================
 *
 * `gradeExplainBack` is the whole flow, in order:
 *
 * 1. **Refuse rather than confabulate on unusable input (INV-5).** An empty
 *    `referenceAnswer` means there is nothing to grade against — the model
 *    is never called; see `UnusableGradingInputError` below. (An empty
 *    `studentAnswer` is *not* unusable input: E2a's `blank` trap already
 *    proves the model handles that correctly, and the mechanical pre-check
 *    below also treats it as "let the model see it" rather than as a reason
 *    to refuse — see `restatementOverlap.ts`'s own reasoning.)
 * 2. **Measure, record-only (`ol-nvdk`, `[D-138]`).** `precheckRestatement`
 *    always runs and its `overlap` measurement is always returned to the
 *    caller. `[D-138]` deleted the threshold that used to let a caller gate
 *    on this measurement — there is no way to short-circuit the model call
 *    from `overlap` any more, and this pipeline never invents one.
 * 3. **Then call the model** through the caller-supplied `JudgeCaller`
 *    — this module does not perform the HTTP call itself (no client-side
 *    `/v1/task` transport exists yet anywhere in this repo; that is a
 *    separate, not-yet-built concern), only the request/response shape and
 *    the logic around the call. The request now always carries
 *    `restatementOverlap` (`toRestatementOverlapEvidence(overlap)`,
 *    `ol-0r92.99` / `[D-279]`) — evidence for the model to weigh, never a
 *    gate; see `ExplainBackJudgeWireRequest` below.
 * 4. **Ground every citation (INV-5's confabulation surface for this
 *    feature).** `groundCitations` drops any `citedIssues` or
 *    `misconceptionCandidates` entry whose citation set, once filtered to
 *    ids the caller's own `sourceBlocks` actually contains, is empty —
 *    never surfacing an invented `blockId` to anything downstream. This is
 *    the one place in this task's scope where the model could confabulate
 *    (verdict/feedback/missedPoints already have E2a as their gate).
 * 5. **Return a `PendingExplainBackGrading` — never an accepted one.**
 *    `status: 'pending-review'` is a status a downstream consumer cannot
 *    write to the misconception store or feed to mastery from directly; the
 *    type only becomes an `AcceptedExplainBackGrading` by passing through
 *    `acceptExplainBackGrading` (INV-6), mirroring
 *    `packages/core/src/instrument/mcq-generated.ts`'s `acceptGeneratedMcq`
 *    boundary for the same invariant on a different artefact.
 *
 * ===========================================================================
 * WHAT THIS EMITS FOR THE TWO DOWNSTREAM CONSUMERS
 * ===========================================================================
 *
 * Neither consumer is built here (both are being built in parallel, `ol-
 * p4t04` and `ol-p4t06`) — this module's job is to make what it emits
 * directly usable by both without either having to re-derive it:
 *
 * - **Misconception store (`ol-p4t04`, knowledge-model §4.1).**
 *   `AcceptedExplainBackGrading.misconceptionCandidates` is shaped as
 *   §4.1's record minus the fields only the store can know (`firstSeen` /
 *   `lastSeen` / `occurrenceCount` / `status` — recurrence bookkeeping,
 *   M1's embedding match) or only the caller's surrounding context can know
 *   (`originInstrumentId`/`originReviewEventId` — which explain-back attempt
 *   this came from). Every surviving candidate is grounded
 *   (`correctionSourceBlockIds` is a non-empty subset of ids the caller
 *   actually supplied) — M2 ("resolution is evidenced, not assumed")
 *   extended one step earlier to "capture is evidenced, not assumed" for the
 *   same reason. **The exact target shape already exists**:
 *   `misconception/events.js`'s `buildObservationEvent` takes an
 *   `ObservationInput` whose `conceptId`/`confusedWithConceptId`/`statement`/
 *   `correction` line up field-for-field with a `MisconceptionCandidate`
 *   here, modulo two things a caller resolves at the integration point (not
 *   built by this lane — no HTTP transport exists yet for either side of
 *   this call): (a) `ObservationInput.citation` is a single `SourceCitation`
 *   (`{ path, blockIndex }`), where a `MisconceptionCandidate` can carry
 *   several `correctionSourceBlockIds` — a caller takes the first (or the
 *   one it has most confidence in) and resolves it back to a
 *   `SourceCitation` via whatever `blockId -> { path, blockIndex }` mapping
 *   it used to build the `sourceBlocks` sent on the request in the first
 *   place; (b) `statementEmbedding` (M1's match input) is computed by the
 *   caller, not by this pipeline, which never calls an embedder.
 * - **Mastery rollup (`ol-p4t06`, C5.4, R7).** `AcceptedExplainBackGrading
 *   .verdict` is the recall/explanation evidence R7 weights; per D-018/plan
 *   §7.1 and D-008, it is transient — this module holds no state and this
 *   pipeline is not itself a place mastery is computed or cached.
 *   `conceptIds` deliberately do **not** appear anywhere in this module: an
 *   explain-back instrument's concept binding lives with the instrument
 *   (knowledge-model §5, concept ↔ instrument 1:N), which the caller already
 *   holds — this pipeline grades an *answer*, and has no reason to know or
 *   invent which concept it was an answer for.
 *
 * ===========================================================================
 * NEVER LOG CONTENT
 * ===========================================================================
 *
 * `summarizeGradingForTelemetry` is the one function in this file meant to
 * be handed to a logging call site. It returns counts and a verdict only —
 * never `feedback`, never a `missedPoints`/`citedIssues`/misconception
 * string. `gradingPipeline.spec.ts` asserts this by serialising the summary
 * and checking a content sentinel never appears in it.
 *
 * ===========================================================================
 * `ol-0r92.130` / `[D-321]` / `[D-320]`: THE WIRE RESPONSE IS NOW A
 * DISCRIMINATED UNION, MIRRORING THE SERVICE'S COORDINATED MIGRATION
 * ===========================================================================
 * `olea-service/src/tasks/explainBackJudge.ts`'s `explainBackJudgeResponse`
 * (`ol-0r92.105`) is now `z.discriminatedUnion('outcome', [...])`: a
 * `{ outcome: 'graded', verdict, feedback, missedPoints, citedIssues,
 * misconceptionCandidates }` branch, byte-identical to the pre-migration
 * flat shape, or `{ outcome: 'unable-to-assess', reason }` when pass one
 * cannot tell whether she made a genuine attempt at all. `[D-321]` rules
 * that outcome must produce **no scored learning evidence** — no
 * misconception observation, no mastery update, no scored review-log entry
 * — while staying recoverable for the session.
 *
 * `ExplainBackGradingWireResponse` and `GroundedGrading` below are now the
 * SAME shape of union, for the SAME reason the service task's module doc
 * gives: an additive flag beside a still-compulsory `verdict` would let an
 * old consumer read `.verdict` and silently misgrade. Making `outcome` the
 * discriminant instead means a consumer cannot read `.verdict`/`.feedback`/
 * etc. off `PendingExplainBackGrading.grading` without first narrowing on
 * `outcome === 'graded'` — the type system forces the migration, the same
 * remedy for the same gap.
 *
 * **`AcceptedExplainBackGrading` deliberately stays a FLAT, graded-only
 * type — it is NOT widened into a union.** `acceptExplainBackGrading` below
 * refuses (throws) when handed a `pending.grading.outcome ===
 * 'unable-to-assess'` — a caller bug, the same "defensive, not redundant"
 * posture it already takes for an ungrounded citation — so nothing ever
 * constructs an `AcceptedExplainBackGrading` for an unassessable attempt in
 * the first place. This is what makes D-321's "misconception and mastery
 * never run off it" true *structurally*, with zero changes needed to every
 * downstream consumer that only ever receives an `AcceptedExplainBackGrading`
 * (`packages/plugin/src/grading/wiring.ts`'s
 * `acceptExplainBackGradingWithObservation`, `packages/core/src/misconception/`,
 * `packages/core/src/mastery/`): they are simply never called with this
 * outcome, because the one function that could feed them refuses first.
 *
 * `[D-320]` (the depth-gate/growth-stage change, unrelated field): where no
 * depth reading exists, a caller omits the depth score rather than
 * defaulting it, and distinguishes "unavailable/pending" from "deliberately
 * not performed" — see `packages/core/src/mastery/rollup.ts` and
 * `packages/plugin/src/depth-gate/` for where that already lives; nothing
 * in THIS file computes or stores a depth score, so D-320 constrains this
 * file only by NOT inventing one here either.
 */

import type { MisconceptionDigestEntry } from '../misconception/digest.js';
import {
  type OverlapMeasurement,
  precheckRestatement,
  type RestatementOverlapEvidence,
  type RestatementPrecheckOptions,
  toRestatementOverlapEvidence,
} from './restatementOverlap.js';

// ---------------------------------------------------------------------------
// Wire types — mirror explainBackJudge.ts's zod schemas (see header)
// ---------------------------------------------------------------------------

export interface SourceBlockRef {
  readonly blockId: string;
  readonly text: string;
}

export type CitedIssueKind = 'omission' | 'error' | 'confusion';

export interface CitedIssue {
  readonly kind: CitedIssueKind;
  readonly description: string;
  readonly sourceBlockIds: readonly string[];
}

/** Knowledge-model §4.1, minus the fields only the store/caller can populate — see header. */
export interface MisconceptionCandidate {
  readonly concept: string;
  readonly confusedWith?: string;
  readonly statement: string;
  readonly correction: string;
  readonly correctionSourceBlockIds: readonly string[];
}

/**
 * The graded branch of the response, exactly as `explain-back.judge.v1`
 * returns it, before grounding — byte-identical in its fields to the
 * pre-`[D-321]` flat response, plus the `outcome` discriminant. Mirrors
 * `explainBackJudge.ts`'s `explainBackJudgeGradedOutcome` schema.
 */
export interface ExplainBackGradingWireGraded {
  readonly outcome: 'graded';
  readonly verdict: 'correct' | 'partial' | 'incorrect';
  readonly feedback: string;
  readonly missedPoints: readonly string[];
  readonly citedIssues: readonly CitedIssue[];
  readonly misconceptionCandidates: readonly MisconceptionCandidate[];
}

/**
 * `[D-321]`'s unable-to-assess branch: pass one could not tell whether she
 * made a genuine attempt at all. `reason` is free text explaining why —
 * never a referral flag or a defective-question signal (see
 * `explainBackJudge.ts`'s identical shape and the same binding
 * clarification: grader uncertainty alone is never a reason to refer the
 * instrument to item validation).
 */
export interface ExplainBackGradingWireUnableToAssess {
  readonly outcome: 'unable-to-assess';
  readonly reason: string;
}

/**
 * The response shape exactly as `explain-back.judge.v1` returns it, before
 * grounding — a discriminated union on `outcome` (see the module header's
 * `ol-0r92.130` / `[D-321]` section for why this is a union, not an
 * additive field).
 */
export type ExplainBackGradingWireResponse =
  | ExplainBackGradingWireGraded
  | ExplainBackGradingWireUnableToAssess;

/**
 * The `explain-back.judge.v1` request exactly as the Worker's zod schema
 * shapes it. `restatementOverlap` is `ol-0r92.99` / `[D-279]`'s addition —
 * `RestatementOverlapEvidence` (from `restatementOverlap.js`) already IS the
 * mirror of the Worker's `restatementOverlapEvidence` schema, so this field
 * is typed directly from it rather than re-declared here. Optional on the
 * wire type for schema symmetry with the Worker's own `.optional()` (an old
 * caller that never populates it still type-checks), but `gradeExplainBack`
 * below always supplies it — see that function's call site.
 */
export interface ExplainBackJudgeWireRequest {
  readonly question: string;
  readonly studentAnswer: string;
  readonly referenceAnswer: string;
  readonly sourceBlocks: readonly SourceBlockRef[];
  readonly misconceptionDigest: readonly { concept: string; statement: string }[];
  readonly restatementOverlap?: RestatementOverlapEvidence;
}

export interface GradeExplainBackInput {
  readonly question: string;
  readonly studentAnswer: string;
  readonly referenceAnswer: string;
  /** F5.2: the retrieved source content, for grounded citation. May be empty. */
  readonly sourceBlocks: readonly SourceBlockRef[];
  /**
   * D-008: transient, injected fresh per call. May be empty. The real
   * producer type (`../misconception/digest.js`) — see the module header for
   * why this is imported rather than re-defined, and `toWireMisconceptionDigest`
   * for how it is cut down to what actually crosses the wire.
   */
  readonly misconceptionDigest: readonly MisconceptionDigestEntry[];
}

/**
 * D-005/D-008: send the *minimum* transient context the grader needs.
 * `id`, `status` and `occurrenceCount` are store bookkeeping the prompt has
 * no use for; `conceptId` becomes the wire `concept` field — the grader uses
 * it only to recognise recurrence within one call, not to display it to her,
 * so an opaque stable id serves exactly as well as a display label would.
 */
export function toWireMisconceptionDigest(
  entries: readonly MisconceptionDigestEntry[],
): readonly { concept: string; statement: string }[] {
  return entries.map((entry) => ({ concept: entry.conceptId, statement: entry.statement }));
}

/** Performs the actual model call. Not implemented here — see header. */
export type JudgeCaller = (
  input: ExplainBackJudgeWireRequest,
) => Promise<ExplainBackGradingWireResponse>;

/** Raised instead of calling the model on input this pipeline cannot honestly grade. */
export class UnusableGradingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnusableGradingInputError';
  }
}

// ---------------------------------------------------------------------------
// Grounding — the anti-confabulation layer for citedIssues / misconceptionCandidates
// ---------------------------------------------------------------------------

/**
 * `groundCitations`'s output for the graded branch: the wire response with
 * every citation verified real. Exported separately from `GroundedGrading`
 * (the union) so a caller that has already narrowed on `outcome === 'graded'`
 * — `packages/plugin/src/explain-back/modal.ts`'s `renderGradedRegions`, in
 * particular — can name the narrowed shape directly rather than re-narrowing
 * a union parameter.
 */
export interface GroundedGradingGraded {
  readonly outcome: 'graded';
  readonly verdict: 'correct' | 'partial' | 'incorrect';
  readonly feedback: string;
  readonly missedPoints: readonly string[];
  /** Only entries with at least one citation to a block the caller actually supplied. */
  readonly citedIssues: readonly CitedIssue[];
  readonly misconceptionCandidates: readonly MisconceptionCandidate[];
  /** False when no source blocks were supplied at all — citations were never possible. */
  readonly citationsAvailable: boolean;
  /** Count only — never the dropped content itself. See "never log content" above. */
  readonly droppedCitationCount: number;
  readonly droppedMisconceptionCount: number;
}

/**
 * `[D-321]`'s unable-to-assess branch, post-grounding — passed through
 * unchanged from the wire response (see `groundCitations` below): there is
 * nothing in it for the grounding step to check, mirroring
 * `explainBackJudge.ts`'s `groundExplainBackCitations` doing the identical
 * pass-through service-side.
 */
export interface GroundedGradingUnableToAssess {
  readonly outcome: 'unable-to-assess';
  readonly reason: string;
}

/**
 * `groundCitations`'s output: a discriminated union on `outcome` — see the
 * module header's `ol-0r92.130` / `[D-321]` section for why. A consumer that
 * reads `.verdict`/`.feedback`/etc. off a `GroundedGrading` without first
 * checking `outcome === 'graded'` fails typecheck, which is the whole point:
 * it is what forces every consumer of `PendingExplainBackGrading.grading`
 * (`modal.ts`'s `renderGradedPhase`, in particular) to handle the
 * unable-to-assess case rather than silently misreading it as a grade.
 */
export type GroundedGrading = GroundedGradingGraded | GroundedGradingUnableToAssess;

/**
 * Filters every citation in `response` down to ids that are actually in
 * `sourceBlocks`, dropping an entry entirely if none of its ids survive.
 * Pure, synchronous, no I/O — the same discipline `restatementOverlap.ts`
 * uses for its own pure functions, for the same reason: this is the one
 * place in the grading pipeline a model's invention could reach a
 * downstream store, so the check has to be structural rather than a prompt
 * instruction it can be talked out of (the exact argument `ol-nvdk`'s
 * header makes for the restatement pre-check, applied to a different
 * failure mode on the same task).
 *
 * `[D-321]`: an `outcome: 'unable-to-assess'` response carries no citations
 * at all — it passes through unchanged (still the same discriminant), never
 * coerced into the graded shape's measurements.
 *
 * **Overloaded on the input's own narrowness, round 2 (`ol-0r92.130`).** A
 * caller that already holds a statically-graded `ExplainBackGradingWireGraded`
 * (every hand-built test fixture in this file's own spec, in particular) gets
 * back a statically-graded `GroundedGradingGraded` — no `outcome` narrowing
 * needed to read `.citedIssues`/`.droppedCitationCount`/etc., because the
 * input already proved which branch this is. A caller holding the general
 * `ExplainBackGradingWireResponse` union (`gradeExplainBack` below, receiving
 * a real, not-yet-known Worker response) still gets back the general
 * `GroundedGrading` union, and still has to narrow — this overload changes
 * nothing about what `gradeExplainBack` produces or what its own callers
 * must do; it only sharpens the type for a caller who already knew more.
 */
export function groundCitations(
  response: ExplainBackGradingWireGraded,
  sourceBlocks: readonly SourceBlockRef[],
): GroundedGradingGraded;
export function groundCitations(
  response: ExplainBackGradingWireResponse,
  sourceBlocks: readonly SourceBlockRef[],
): GroundedGrading;
export function groundCitations(
  response: ExplainBackGradingWireResponse,
  sourceBlocks: readonly SourceBlockRef[],
): GroundedGrading {
  if (response.outcome === 'unable-to-assess') {
    return { outcome: 'unable-to-assess', reason: response.reason };
  }

  const knownIds = new Set(sourceBlocks.map((block) => block.blockId));

  let droppedCitationCount = 0;
  const citedIssues: CitedIssue[] = [];
  for (const issue of response.citedIssues) {
    const validIds = issue.sourceBlockIds.filter((id) => knownIds.has(id));
    if (validIds.length === 0) {
      droppedCitationCount++;
      continue;
    }
    citedIssues.push({ ...issue, sourceBlockIds: validIds });
  }

  let droppedMisconceptionCount = 0;
  const misconceptionCandidates: MisconceptionCandidate[] = [];
  for (const candidate of response.misconceptionCandidates) {
    const validIds = candidate.correctionSourceBlockIds.filter((id) => knownIds.has(id));
    if (validIds.length === 0) {
      droppedMisconceptionCount++;
      continue;
    }
    misconceptionCandidates.push({ ...candidate, correctionSourceBlockIds: validIds });
  }

  return {
    outcome: 'graded',
    verdict: response.verdict,
    feedback: response.feedback,
    missedPoints: response.missedPoints,
    citedIssues,
    misconceptionCandidates,
    citationsAvailable: sourceBlocks.length > 0,
    droppedCitationCount,
    droppedMisconceptionCount,
  };
}

// ---------------------------------------------------------------------------
// The pipeline: pre-check (record-only) -> model call -> grounding -> pending
// ---------------------------------------------------------------------------

export interface PendingExplainBackGrading {
  readonly status: 'pending-review';
  readonly grading: GroundedGrading;
  /** Record-only (`ol-nvdk`, `[D-138]`) — never gates the model call below. */
  readonly overlap: OverlapMeasurement;
}

/**
 * The whole client-side pipeline. See the module header for the four-step
 * shape. `precheckOptions` only tunes `precheckRestatement`'s measurement
 * (e.g. `ngramSize`) — `[D-138]` deleted the threshold that used to let it
 * gate the model call, so there is nothing left here to ratify or supply on
 * the caller's behalf.
 */
export async function gradeExplainBack(
  input: GradeExplainBackInput,
  callJudge: JudgeCaller,
  precheckOptions: RestatementPrecheckOptions = {},
): Promise<PendingExplainBackGrading> {
  if (input.referenceAnswer.trim() === '') {
    throw new UnusableGradingInputError(
      'gradeExplainBack: referenceAnswer is empty — there is nothing to grade the answer ' +
        'against, so the model is never called (INV-5: refuse rather than confabulate)',
    );
  }

  // `exactOptionalPropertyTypes` means an explicit `sourceExcerpt: undefined`
  // is not the same as omitting the key — so the key is present only when
  // there is a real excerpt to give it.
  const overlap = precheckRestatement(
    {
      question: input.question,
      studentAnswer: input.studentAnswer,
      referenceAnswer: input.referenceAnswer,
      ...(input.sourceBlocks.length > 0
        ? { sourceExcerpt: input.sourceBlocks.map((block) => block.text).join('\n\n') }
        : {}),
    },
    precheckOptions,
  );

  const wire = await callJudge({
    question: input.question,
    studentAnswer: input.studentAnswer,
    referenceAnswer: input.referenceAnswer,
    sourceBlocks: input.sourceBlocks,
    misconceptionDigest: toWireMisconceptionDigest(input.misconceptionDigest),
    // `ol-0r92.99` / `[D-279]`: the measurement above, projected to the
    // strict subset the judge is sent — evidence only, never a gate (see
    // `overlap` above and restatementOverlap.ts's own header). Sent on
    // every call now that this pipeline wires it, which is why the prompt
    // version was bumped alongside this change (D7.3) — see
    // prompts/explain-back.judge/VERSION in olea-service.
    restatementOverlap: toRestatementOverlapEvidence(overlap),
  });
  return {
    status: 'pending-review',
    overlap,
    grading: groundCitations(wire, input.sourceBlocks),
  };
}

// ---------------------------------------------------------------------------
// The accept step (INV-6)
// ---------------------------------------------------------------------------

export interface AcceptedExplainBackGrading {
  readonly status: 'accepted';
  readonly verdict: 'correct' | 'partial' | 'incorrect';
  readonly feedback: string;
  readonly missedPoints: readonly string[];
  readonly citedIssues: readonly CitedIssue[];
  readonly misconceptionCandidates: readonly MisconceptionCandidate[];
}

/**
 * The one function that turns a `PendingExplainBackGrading` into something
 * fit to feed the misconception store or the mastery rollup — mirroring
 * `mcq-generated.ts`'s `acceptGeneratedMcq` boundary for INV-6 ("nothing
 * AI-generated lands without an accept step"). A UI calls this only after
 * she has seen and accepted the grading; nothing in this module calls it
 * for her.
 *
 * Re-asserts groundedness rather than trusting `pending` was not mutated
 * between grade time and here — the same defensive-not-redundant reasoning
 * `acceptGeneratedMcq` gives for re-checking `feedback` at its own boundary.
 * Throwing here is a bug in a caller (nothing this module produces can fail
 * this check), not a possible outcome of grading real input.
 *
 * **`[D-321]`: refuses (throws) rather than accepting a `pending.grading`
 * whose `outcome` is `'unable-to-assess'`.** `AcceptedExplainBackGrading`
 * deliberately stays flat and graded-only — see the module header's
 * `ol-0r92.130` section for why — so there is no `verdict` this function
 * could honestly report for an unassessable attempt. A caller must check
 * `pending.grading.outcome` BEFORE calling this function (`modal.ts`'s
 * `renderGradedPhase` only ever reaches the Accept button, and therefore
 * this function, on the graded branch); reaching this guard is a caller bug,
 * the same posture the two checks below already take for an ungrounded
 * citation.
 */
export function acceptExplainBackGrading(
  pending: PendingExplainBackGrading,
): AcceptedExplainBackGrading {
  if (pending.grading.outcome === 'unable-to-assess') {
    throw new Error(
      'acceptExplainBackGrading: pending.grading is unable-to-assess — there is no verdict to ' +
        'accept (D-321); a caller must check pending.grading.outcome and route this outcome its ' +
        'own way (no accept, no misconception observation, no mastery update, no review-log write) ' +
        'rather than calling this function',
    );
  }
  for (const issue of pending.grading.citedIssues) {
    if (issue.sourceBlockIds.length === 0) {
      throw new Error(
        'acceptExplainBackGrading: a citedIssues entry carries no citation — refusing to accept an ungrounded issue',
      );
    }
  }
  for (const candidate of pending.grading.misconceptionCandidates) {
    if (candidate.correctionSourceBlockIds.length === 0) {
      throw new Error(
        'acceptExplainBackGrading: a misconceptionCandidates entry carries no citation — refusing to accept an ungrounded misconception',
      );
    }
  }
  return {
    status: 'accepted',
    verdict: pending.grading.verdict,
    feedback: pending.grading.feedback,
    missedPoints: pending.grading.missedPoints,
    citedIssues: pending.grading.citedIssues,
    misconceptionCandidates: pending.grading.misconceptionCandidates,
  };
}

/**
 * The other side of the accept step: she reviewed the grading and rejected
 * it. Nothing downstream ever sees a discarded grading — `null` is the
 * whole return value, deliberately, so a caller cannot accidentally forward
 * a discarded result by forgetting to check a status field.
 */
export function discardExplainBackGrading(_pending: PendingExplainBackGrading): null {
  return null;
}

// ---------------------------------------------------------------------------
// Telemetry — counts and a verdict only, never content
// ---------------------------------------------------------------------------

export type GradingTelemetrySummary =
  | {
      readonly outcome: 'graded';
      readonly verdict: 'correct' | 'partial' | 'incorrect';
      readonly containment: number;
      readonly citedIssueCount: number;
      readonly misconceptionCandidateCount: number;
      readonly droppedCitationCount: number;
      readonly droppedMisconceptionCount: number;
    }
  | {
      /** `[D-321]`: no verdict, no citation counts — there is nothing graded to count. */
      readonly outcome: 'unable-to-assess';
      readonly containment: number;
    };

/** See "never log content" in the module header. */
export function summarizeGradingForTelemetry(
  pending: PendingExplainBackGrading,
): GradingTelemetrySummary {
  if (pending.grading.outcome === 'unable-to-assess') {
    return { outcome: 'unable-to-assess', containment: pending.overlap.containment };
  }
  return {
    outcome: 'graded',
    verdict: pending.grading.verdict,
    containment: pending.overlap.containment,
    citedIssueCount: pending.grading.citedIssues.length,
    misconceptionCandidateCount: pending.grading.misconceptionCandidates.length,
    droppedCitationCount: pending.grading.droppedCitationCount,
    droppedMisconceptionCount: pending.grading.droppedMisconceptionCount,
  };
}
