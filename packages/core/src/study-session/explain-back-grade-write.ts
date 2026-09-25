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

import type { AnswerEdits, MasteryAtTime, SelectionContextV4 } from 'olea-contracts';
import type { AcceptedSoloGrading, SoloArtifactProvenance } from '../grading/explainBackSolo.js';
import {
  buildExplainBackGradeReviewFields,
  writeSoloGradingContent,
} from '../grading/explainBackSolo.js';
import type { WriteContentOptions } from '../review-log/content-store.js';
import { readContentRecord } from '../review-log/content-store.js';
import { explainBackGradeEvents } from '../review-log/explain-back-history.js';
import { reviewLogPath } from '../review-log/path.js';
import { readReviewLogFile } from '../review-log/read.js';
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
  /**
   * `[D-228 / SIG-3]`: how this attempt's answer was composed. Absent means
   * "not captured," never "she made no edits" (`AnswerEdits`'s own contract
   * doc) — travels onto the composed record exactly as `supportLevelShown`
   * does, never fabricated when the caller has none.
   */
  readonly answerEdits?: AnswerEdits;
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
  /**
   * **`[D-281]` / `ol-95vv.10`: the INDEPENDENT correctness verdict for this
   * same attempt**, from the explain-back correctness judge — the second of
   * two independent readings of one answer, the first being
   * `accepted.soloLevel`, which is produced blind to this one and stays that
   * way (nothing here derives either from the other).
   *
   * **Optional, and omitted rather than defaulted when the caller has none.**
   * `[D-281]` rules that a record carrying no verdict reads as unknown and can
   * never newly qualify the top growth stage, so a caller that cannot resolve
   * a verdict for this attempt — a grading rejected as stale, an attempt whose
   * correctness pipeline did not run — leaves it absent. Writing a guess here
   * is the one way this field can do harm.
   */
  readonly correctness?: 'correct' | 'partial' | 'incorrect';
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
    ...(subject.answerEdits !== undefined ? { answerEdits: subject.answerEdits } : {}),
    explainBackGrade: {
      ...gradeFields.explainBackGrade,
      // `[D-281]`: merged here rather than inside
      // `buildExplainBackGradeReviewFields` so that builder keeps its single
      // job (turning an accepted SOLO grading into review fields) and stays
      // blind to correctness, which is a different judge's output.
      ...(input.correctness !== undefined ? { correctness: input.correctness } : {}),
    },
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
  /**
   * `ol-0r92.94` [DOS-C1]: a fresh id the caller mints once per genuine
   * attempt at submit time (`packages/plugin/src/explain-back/modal.ts`'s
   * `submitAnswer`) — NOT `subject.instrumentId`, which is the instrument's
   * own id and, for a real instrument, is shared by every attempt she ever
   * makes at it. This is the durable idempotency key: see this function's
   * own "DURABLE IDEMPOTENCY" doc section for what it is checked and stamped
   * against.
   */
  readonly attemptId: string;
}

/**
 * `ol-0r92.94` [DOS-C1]: the `[D-077]` content id this attempt's evidence is
 * (or will be) filed under. Deterministic in `attemptId` — never random —
 * which is what makes both halves of durable idempotency possible below: a
 * genuine retry of the SAME attempt always asks for the SAME content id, so
 * the content store's own write-once refusal (`content-store.ts`'s
 * `writeContentRecord`) becomes a crash-recovery signal rather than a bug,
 * and the review log itself can be searched for this exact id without a new
 * store. `${deviceId}.attempt-${attemptId}` keeps the existing
 * `<deviceId>.<opaque>` convention `defaultGenerateContentId` already uses
 * (`content-store.ts`'s own "two devices never conflict" doc) so two devices
 * accepting concurrently still cannot collide even if a caller ever reused
 * an `attemptId` across devices (it should not, but this makes that safe
 * too).
 *
 * `attemptId` is sanitized before use — `content-store.ts`'s own
 * `isValidContentId` only allows `[A-Za-z0-9._-]`, and `attemptId` is not
 * guaranteed to be a fresh UUID by every caller: `solo-review.ts`'s optional
 * fallback (see `RecordSoloGradeAndReviewParams.attemptId`'s own doc) can
 * hand this a real `instrumentId`, and those routinely carry `:` (e.g.
 * `explain-back:heap:1`). Any disallowed character becomes `_` — lossy, but
 * only ever affects that fallback path's key, never a real, freshly minted
 * `attemptId`, which is already a valid id by construction (a UUID).
 */
function attemptContentId(deviceId: string, attemptId: string): string {
  const sanitized = attemptId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${deviceId}.attempt-${sanitized}`;
}

/**
 * The one impure export in this module — see the module header's
 * "reachability" section for its real production caller
 * (`packages/plugin/src/explain-back/solo-review.ts`'s
 * `recordSoloGradeAndReview`). Mints a real `contentRef`
 * (`writeSoloGradingContent`), composes the full record
 * ({@link composeGradedExplainBackReviewRecord}), and appends it as the
 * subject's own review event (`appendReviewLogRecord`) — the whole
 * `ol-95vv.3` chain in one call, over a real `VaultSource`.
 *
 * ===========================================================================
 * `ol-0r92.94` [DOS-C1]: DURABLE IDEMPOTENCY, KEYED ON `input.attemptId`
 * ===========================================================================
 * TWO GUARANTEES, STATED SEPARATELY — NOT ONE:
 *
 * 1. **Sequential retry / restart never duplicates the accepted assessment.**
 *    Before writing anything, this function reads today's review-log file
 *    for `input.subject.timestamp`'s date and device
 *    (`readReviewLogFile`/`explainBackGradeEvents`, both existing exports —
 *    no new store) for a record whose `explainBackGrade.contentRef` already
 *    equals `attemptContentId(deviceId, input.attemptId)`. If one exists,
 *    THIS ATTEMPT WAS ALREADY DURABLY RECORDED — on a prior run, possibly
 *    before a restart — and that exact record is returned, unchanged,
 *    without writing content or appending a second event. This is what
 *    makes the idempotency key durable rather than in-memory-only: the log
 *    itself is the persisted check, and it survives a process restart
 *    because it is read fresh off the vault every call.
 * 2. **A crash between `writeSoloGradingContent` and `appendReviewLogRecord`
 *    is recoverable, never doubly-written.** If step 1 finds no matching
 *    review event yet, this function asks the content store to write under
 *    the SAME deterministic id every retry of this attempt would ask for.
 *    Two outcomes:
 *    - The id is genuinely new: the ordinary path runs, exactly as before
 *      this bead.
 *    - The id already has a file (`writeContentRecord`'s own write-once
 *      refusal) but step 1 found no review event citing it: the content
 *      write from a PRIOR attempt at this exact `attemptId` landed, then the
 *      process died before `appendReviewLogRecord` ran. This function
 *      reclaims that orphaned content record (skips rewriting it — the text
 *      is identical, it is the same attempt) and proceeds straight to
 *      composing and appending the review-log record, so the crash costs a
 *      retry, never a duplicate event or a permanently orphaned content
 *      file.
 *
 * Neither guarantee claims an exactly-once WORKER call — `gradeSoloAttempt`
 * itself has no retry budget, and re-grading is out of this function's
 * reach. What is guaranteed is the durable EFFECT of one accepted attempt:
 * one review event, one content record, regardless of how many times this
 * function is called for the same `attemptId`.
 *
 * A `revisionOf` corrective grade is a DIFFERENT attempt (a fresh
 * `attemptId`, minted at its own submit) and is never suppressed as a
 * duplicate of the one it revises — this function's dedup is scoped to one
 * `attemptId`, never to `instrumentId` or `revisionOf`.
 */
export async function recordGradedExplainBackReview(
  vault: VaultSource,
  input: RecordGradedExplainBackReviewInput,
  options: AppendReviewLogOptions & WriteContentOptions,
): Promise<AppendReviewLogResult> {
  const contentId = attemptContentId(options.deviceId, input.attemptId);
  const dateOf = input.subject.timestamp.slice(0, input.subject.timestamp.indexOf('T'));
  const path = reviewLogPath(dateOf, options.deviceId);

  const existing = await readReviewLogFile(vault, path);
  const alreadyRecorded = explainBackGradeEvents(existing.records).find(
    (record) => record.explainBackGrade.contentRef === contentId,
  );
  if (alreadyRecorded !== undefined) {
    // Guarantee 1: this exact attempt is already durably recorded — return
    // it verbatim rather than writing anything a second time.
    return { record: alreadyRecorded, path };
  }

  let contentRef: string;
  try {
    contentRef = await writeSoloGradingContent(
      vault,
      {
        accepted: input.accepted,
        studentAnswer: input.studentAnswer,
        ...(input.misconceptionDetail !== undefined
          ? { misconceptionDetail: input.misconceptionDetail }
          : {}),
      },
      { ...options, generateContentId: () => contentId },
    );
  } catch (error) {
    // Guarantee 2: the only expected reason this specific, deterministic id
    // can already have a file with no matching review event (just checked
    // above) is a prior crash between the content write and the log append
    // for this exact attempt — reclaim it rather than minting a new,
    // orphan-producing id. Verified, not assumed: a genuine vault error
    // (disk full, permission denied) also throws from `writeSoloGradingContent`,
    // and must never be mistaken for a reclaimable duplicate — so this only
    // reclaims when the content record actually exists on disk under this
    // id; anything else rethrows the original error unchanged.
    const existingContent = await readContentRecord(vault, contentId);
    if (existingContent.status !== 'found') throw error;
    contentRef = contentId;
  }

  const record = composeGradedExplainBackReviewRecord({
    subject: input.subject,
    accepted: input.accepted,
    contentRef,
    revisionOf: input.revisionOf,
    artifactProvenance: input.artifactProvenance,
    ...(input.neighbourConceptId !== undefined
      ? { neighbourConceptId: input.neighbourConceptId }
      : {}),
    // `[D-281]`: forwarded, never defaulted — absent here means the caller had
    // no independent correctness verdict for this attempt, which the mastery
    // fold reads as unknown.
    ...(input.correctness !== undefined ? { correctness: input.correctness } : {}),
  });

  return appendReviewLogRecord(vault, record, options);
}
