/**
 * Wiring `acceptSoloGrading`'s output onto the subject's own review event
 * (`ol-95vv.3`; `[D-117]`'s verdict seam; `../../../olea-service/docs/dev/
 * verdict-seam-design.md` §5) — the half `../grading/explainBackSolo.ts`
 * names but does not do: "the actual call site that assembles a
 * `ReviewLogRecordInput` for an explain-back review lives in
 * `packages/core/src/study-session/`" (that module's own header).
 *
 * ===========================================================================
 * WHAT THIS COMPLETES, AND WHAT IT DOES NOT
 * ===========================================================================
 * `buildExplainBackGradeReviewFields` (`../grading/explainBackSolo.js`,
 * `ol-95vv.2`) already produces `explainBackGrade`/`schedulingObservation`
 * as plain values "ready to be spread onto the SAME `ReviewLogRecordInput`
 * the subject's own rating attempt writes" — but nothing did that spreading,
 * or the write. This module is that seam:
 *
 * 1. {@link composeGradedExplainBackReviewRecord} — the pure merge: the
 *    subject's own base review fields (mirroring
 *    `packages/plugin/src/review/ports.ts`'s `RecordReviewInput`, minus the
 *    two grade-shaped fields) plus the grading result, into one complete
 *    `ReviewLogRecordInput`. This is literally "the actual
 *    `ReviewLogRecordInput` write" the verdict-seam design says nothing
 *    composes yet.
 * 2. {@link recordGradedExplainBackReview} — the one impure export (mirrors
 *    `writeSoloGradingContent`'s own "one impure export" posture in
 *    `../grading/explainBackSolo.js`): mint a real `[D-077]` `contentRef`,
 *    compose the record, and append it — the whole `SoloJudgeCaller`
 *    production chain in one call, over a real `VaultSource`.
 *
 * ===========================================================================
 * REACHABILITY ([D-072] clause 5) — NAMED, NOT HIDDEN
 * ===========================================================================
 * `recordGradedExplainBackReview` performs the real write; it is not a stub.
 * But nothing in the product calls it yet. **This is no longer "no UI
 * destination exists" — `[D-163]`/`ol-2cte` ratified one and `ol-12gs`
 * (closed 2026-08-31, same round as this bead) built and wired it**:
 * `ExplainBackModal` (`packages/plugin/src/explain-back/modal.ts`) is now a
 * real, live destination for all four ruled entry points, and its accept
 * flow already calls the correctness-grading sibling
 * (`acceptExplainBackGradingWithObservation`,
 * `packages/plugin/src/grading/wiring.ts`) end to end. `ol-12gs`'s own close
 * evidence discloses, by name, exactly the two things it deliberately left
 * for this bead's charter: *"No review-log write for the graded verdict...
 * is `ol-95vv`'s mastery-fold job"* and *"No SOLO depth grading
 * (`explain-back.solo.v1`)... also `ol-95vv`'s charter."* So the real gap
 * left is narrower and more concrete than "no UI exists": (a) nothing in the
 * plugin composes a `SoloJudgeCaller` Worker port
 * (`../grading/workerSoloJudgeCaller.js`'s `createWorkerSoloJudgeCaller` has
 * no plugin-side caller, unlike its correctness-grading sibling
 * `createWorkerJudgeCaller`, which `GradingWiring` already composes), and
 * (b) `ExplainBackModal`'s accept flow does not yet call `gradeSolo` /
 * `acceptSoloGrading` or either export of this module. Filed as `ol-cqz8`
 * (`discovered-from`/`blocked-by` this bead) rather than reached into
 * `packages/plugin/` past this bead's own `owns` — that follow-on also has
 * to settle a real design question this bead does not presume the answer
 * to: whether the correctness verdict and the SOLO depth verdict land on
 * ONE `appendReviewLogRecord` call for the same event, or two, given
 * `modal.ts`'s accept flow does not call `appendReviewLogRecord` at all
 * today for either half.
 *
 * A second, narrower reachability note: `packages/core/src/index.ts` (the
 * public barrel) is outside this bead's `owns` too, so the two exports below
 * — and `gradeSolo`/`acceptSoloGrading`/`buildExplainBackGradeReviewFields`
 * themselves, which also have no barrel export yet — are not reachable from
 * `olea-core` by a plugin-side caller without a deep import. `ol-cqz8` names
 * this as part of its own scope.
 *
 * ===========================================================================
 * WHY `rating` IS ALWAYS `null` HERE, STRUCTURALLY
 * ===========================================================================
 * F2.16 / `contracts/review-log.ts`'s own `rating` doc: "Explain-back
 * produces no rating at all; the field is nullable for it." This module
 * hardcodes `rating: null` and `instrumentType: 'explain-back'` rather than
 * accepting either as a parameter, so a caller cannot accidentally route a
 * rated instrument's write through this path.
 *
 * ===========================================================================
 * INV-1 / NO CLOCK
 * ===========================================================================
 * `GradedExplainBackReviewSubject.timestamp` is supplied by the caller
 * (ISO-8601 with local offset, exactly `ports.ts`'s `isoWithLocalOffset`
 * shape) — this module never calls `new Date()`, matching every other
 * `study-session/` module's stated discipline. `recordGradedExplainBackReview`
 * is not otherwise pure (it writes to `vault`), the same named exception
 * `writeSoloGradingContent` already is for its own sibling module.
 *
 * ===========================================================================
 * D-005 / NEVER LOGGED
 * ===========================================================================
 * Nothing here logs or returns her answer text or the grader's rationale —
 * both go straight into the `[D-077]` content store
 * (`writeSoloGradingContent`) and never appear on the composed record or in
 * any thrown error message.
 */

import type { MasteryAtTime, SelectionContextV4 } from 'olea-contracts';
import type { AcceptedSoloGrading, SoloArtifactProvenance } from '../grading/explainBackSolo.js';
import {
  buildExplainBackGradeReviewFields,
  writeSoloGradingContent,
} from '../grading/explainBackSolo.js';
import type { WriteContentOptions } from '../review-log/content-store.js';
import type {
  AppendReviewLogOptions,
  AppendReviewLogResult,
  ReviewLogRecordInput,
} from '../review-log/write.js';
import { appendReviewLogRecord } from '../review-log/write.js';
import type { SupportLevel } from '../support-level/types.js';
import type { VaultSource } from '../vault/types.js';

/**
 * Every base review-log field an explain-back write needs, excluding
 * `explainBackGrade`/`schedulingObservation` — those are composed from the
 * grading result, never supplied directly (see
 * {@link composeGradedExplainBackReviewRecord}). Mirrors
 * `packages/plugin/src/review/ports.ts`'s `RecordReviewInput`: same
 * `wasUnsure`/`durationMs`/`selectionContext`/`masteryAtTime`/
 * `supportLevelShown` shape, generalised for `conceptIds` (the frozen
 * schema's own field — `RecordReviewInput` derives its concept list from a
 * live `ReviewInstrument` this module has no equivalent for) and with no
 * `rating` field at all, since an explain-back review's rating is always
 * `null` (F2.16) rather than a value a caller could supply incorrectly.
 */
export interface GradedExplainBackReviewSubject {
  readonly instrumentId: string;
  /** Opaque concept keys (R2 / `ol-63e1`), never display names. Non-empty, per the frozen schema. */
  readonly conceptIds: readonly string[];
  /** ISO-8601 with local offset — the caller's clock; see this module's "INV-1 / no clock" doc. */
  readonly timestamp: string;
  readonly wasUnsure: boolean;
  readonly durationMs: number | null;
  readonly selectionContext: SelectionContextV4;
  /** C5.4's rollup — absent means not recorded, matching every writer today (`masteryAtTime`'s own contract doc). */
  readonly masteryAtTime?: MasteryAtTime;
  /** Row 3.9's chooser decision ([SUPP-2]) — absent when this item carried none, never fabricated. */
  readonly supportLevelShown?: SupportLevel;
}

export interface ComposeGradedExplainBackReviewRecordInput {
  readonly subject: GradedExplainBackReviewSubject;
  readonly accepted: AcceptedSoloGrading;
  /** The `[D-077]` content store pointer — required, never manufactured (see `buildExplainBackGradeReviewFields`'s own doc). */
  readonly contentRef: string;
  readonly revisionOf: string | null;
  readonly artifactProvenance: SoloArtifactProvenance;
  /** Required exactly when `accepted.neighbourUseDemonstrated` is `true` — checked by `buildExplainBackGradeReviewFields`, not re-checked here. */
  readonly neighbourConceptId?: string;
}

/**
 * The pure half: spreads `buildExplainBackGradeReviewFields`'s output onto
 * the subject's own base review fields, producing one complete
 * `ReviewLogRecordInput` — see this module's header for why this is the
 * literal thing the verdict-seam design says nothing composes yet.
 * `schedulingObservation` is merged only when present (`undefined`, never a
 * fabricated value — `reviewLogRecordV5`'s own `.optional()` discipline).
 */
export function composeGradedExplainBackReviewRecord(
  input: ComposeGradedExplainBackReviewRecordInput,
): ReviewLogRecordInput {
  const gradeFields = buildExplainBackGradeReviewFields({
    accepted: input.accepted,
    contentRef: input.contentRef,
    revisionOf: input.revisionOf,
    artifactProvenance: input.artifactProvenance,
    ...(input.neighbourConceptId !== undefined
      ? { neighbourConceptId: input.neighbourConceptId }
      : {}),
  });

  const { subject } = input;
  return {
    timestamp: subject.timestamp,
    instrumentId: subject.instrumentId,
    instrumentType: 'explain-back',
    conceptIds: [...subject.conceptIds],
    // F2.16: explain-back produces no FSRS rating — the field is nullable
    // for exactly this case (`contracts/review-log.ts`'s own `rating` doc).
    rating: null,
    wasUnsure: subject.wasUnsure,
    durationMs: subject.durationMs,
    selectionContext: subject.selectionContext,
    ...(subject.masteryAtTime !== undefined ? { masteryAtTime: subject.masteryAtTime } : {}),
    ...(subject.supportLevelShown !== undefined
      ? { supportLevelShown: subject.supportLevelShown }
      : {}),
    explainBackGrade: gradeFields.explainBackGrade,
    ...(gradeFields.schedulingObservation !== undefined
      ? { schedulingObservation: gradeFields.schedulingObservation }
      : {}),
  };
}

export interface RecordGradedExplainBackReviewInput
  extends Omit<ComposeGradedExplainBackReviewRecordInput, 'contentRef'> {
  /** Her explanation text this grading was produced from — minted into the `[D-077]` content store, never persisted inline (D-005). */
  readonly studentAnswer: string;
  /** Present only when this grading surfaced a misconception — the caller's own classification (`misconception/` territory, not re-derived here). */
  readonly misconceptionDetail?: string;
}

/**
 * The one impure export in this module — see the module header's
 * "reachability" section for what calls it today (nothing, by design) and
 * what will. Mints a real `contentRef` (`writeSoloGradingContent`), composes
 * the full record ({@link composeGradedExplainBackReviewRecord}), and
 * appends it as the subject's own review event (`appendReviewLogRecord`) —
 * the whole `ol-95vv.3` chain in one call, over a real `VaultSource`.
 */
export async function recordGradedExplainBackReview(
  vault: VaultSource,
  input: RecordGradedExplainBackReviewInput,
  options: AppendReviewLogOptions & WriteContentOptions,
): Promise<AppendReviewLogResult> {
  const contentRef = await writeSoloGradingContent(
    vault,
    {
      accepted: input.accepted,
      studentAnswer: input.studentAnswer,
      ...(input.misconceptionDetail !== undefined
        ? { misconceptionDetail: input.misconceptionDetail }
        : {}),
    },
    options,
  );

  const record = composeGradedExplainBackReviewRecord({
    subject: input.subject,
    accepted: input.accepted,
    contentRef,
    revisionOf: input.revisionOf,
    artifactProvenance: input.artifactProvenance,
    ...(input.neighbourConceptId !== undefined
      ? { neighbourConceptId: input.neighbourConceptId }
      : {}),
  });

  return appendReviewLogRecord(vault, record, options);
}
