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
 *    the logic around the call.
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
 */

import type { MisconceptionDigestEntry } from '../misconception/digest.js';
import {
  type OverlapMeasurement,
  precheckRestatement,
  type RestatementPrecheckOptions,
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

/** The response shape exactly as `explain-back.judge.v1` returns it, before grounding. */
export interface ExplainBackGradingWireResponse {
  readonly verdict: 'correct' | 'partial' | 'incorrect';
  readonly feedback: string;
  readonly missedPoints: readonly string[];
  readonly citedIssues: readonly CitedIssue[];
  readonly misconceptionCandidates: readonly MisconceptionCandidate[];
}

/** The `explain-back.judge.v1` request exactly as the Worker's zod schema shapes it. */
export interface ExplainBackJudgeWireRequest {
  readonly question: string;
  readonly studentAnswer: string;
  readonly referenceAnswer: string;
  readonly sourceBlocks: readonly SourceBlockRef[];
  readonly misconceptionDigest: readonly { concept: string; statement: string }[];
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

/** `groundCitations`'s output: the wire response with every citation verified real. */
export interface GroundedGrading {
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
 * Filters every citation in `response` down to ids that are actually in
 * `sourceBlocks`, dropping an entry entirely if none of its ids survive.
 * Pure, synchronous, no I/O — the same discipline `restatementOverlap.ts`
 * uses for its own pure functions, for the same reason: this is the one
 * place in the grading pipeline a model's invention could reach a
 * downstream store, so the check has to be structural rather than a prompt
 * instruction it can be talked out of (the exact argument `ol-nvdk`'s
 * header makes for the restatement pre-check, applied to a different
 * failure mode on the same task).
 */
export function groundCitations(
  response: ExplainBackGradingWireResponse,
  sourceBlocks: readonly SourceBlockRef[],
): GroundedGrading {
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
 */
export function acceptExplainBackGrading(
  pending: PendingExplainBackGrading,
): AcceptedExplainBackGrading {
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

export interface GradingTelemetrySummary {
  readonly verdict: 'correct' | 'partial' | 'incorrect';
  readonly containment: number;
  readonly citedIssueCount: number;
  readonly misconceptionCandidateCount: number;
  readonly droppedCitationCount: number;
  readonly droppedMisconceptionCount: number;
}

/** See "never log content" in the module header. */
export function summarizeGradingForTelemetry(
  pending: PendingExplainBackGrading,
): GradingTelemetrySummary {
  return {
    verdict: pending.grading.verdict,
    containment: pending.overlap.containment,
    citedIssueCount: pending.grading.citedIssues.length,
    misconceptionCandidateCount: pending.grading.misconceptionCandidates.length,
    droppedCitationCount: pending.grading.droppedCitationCount,
    droppedMisconceptionCount: pending.grading.droppedMisconceptionCount,
  };
}
