/**
 * `recordSoloGradeAndReview` — the composition `ExplainBackModal`'s accept
 * flow calls to run the SOLO depth pipeline and append the subject's own
 * review-log event (`ol-cqz8`, closing the two gaps `ol-12gs`'s own close
 * evidence named by name: "No review-log write for the graded verdict" and
 * "No SOLO depth grading").
 *
 * ===========================================================================
 * THE DESIGN QUESTION THIS MODULE ANSWERS: ONE EVENT, NOT TWO
 * ===========================================================================
 * `ol-cqz8`'s brief asked, before any wiring: does an accepted explain-back
 * need BOTH the correctness verdict and a review-kind event with
 * `explainBackGrade`, or do they land on the SAME event? **One event.**
 * Settled from ruled sources, not guessed:
 *
 * - `docs/dev/verdict-seam-design.md` §2 (olea-service), quoting
 *   `mastery/gradingInputContract.ts`'s own `SchedulingObservation` doc
 *   verbatim: "It rides the SAME review event as the subject's own verdict…
 *   [D-087]: 'one review stays one event'."
 * - `grading/explainBackSolo.ts`'s own module doc: `explainBackGrade`/
 *   `schedulingObservation` are "ready to be spread onto the SAME
 *   `ReviewLogRecordInput` the subject's own rating attempt writes
 *   (review-log is append-only; there is no 'attach to an already-written
 *   event' — the fields must be present on the record at the moment it is
 *   first appended, per `[D-117]`'s 'rides the same review event' ruling)."
 * - Structurally confirmed by reading the code rather than assuming: the
 *   OTHER "verdict"-shaped record in the schema (`verdictLogRecordV5`,
 *   `kind: 'verdict'`) carries `artifactVerdict` — accepted/edited/rejected
 *   of an OLEA-DRAFTED artifact (`ol-548w`, INV-6) — a wholly different
 *   concept from the explain-back correctness judge's correct/partial/
 *   incorrect classification. Nothing in `acceptExplainBackGradingWithObser
 *   vation` (`../grading/wiring.ts`) ever calls `appendReviewLogRecord`/
 *   `appendVerdictRecord`: the correctness verdict has no persisted
 *   review-log home of its own today, by design — GLOSSARY's SOLO rule 5
 *   ("level names are never exposed to the student") and R9's whole
 *   argument against a flat correct/incorrect field mean the review log's
 *   evidence-of-success comes from SOLO depth alone. **Superseded in part by
 *   `[D-281]` (`ol-95vv.10`), 2026-09-22:** the correctness verdict now DOES
 *   have a persisted home — `explainBackGrade.correctness`, on this same one
 *   event — because depth without correctness is a confident wrong answer and
 *   the mastery fold must never promote one. R9 is untouched: the two verdicts
 *   remain independent assessments of one attempt, the depth assessor blind to
 *   correctness, and neither is derived from the other. What is unchanged is
 *   the shape of the write: still exactly
 *   ONE review-log write to make here, not a second one to reconcile with
 *   an existing first: `recordGradedExplainBackReview` (`olea-core`,
 *   `ol-95vv.3`) IS that one write.
 *
 * ===========================================================================
 * WHAT THIS MODULE DOES
 * ===========================================================================
 * 1. `buildGradeSoloInputFromTypedAnswer` (`./request.ts`) builds the SOLO
 *    request from the SAME `ExplainBackPromptContext` already resolved for
 *    the correctness pipeline — no second retrieval. `ol-egov.141.89.6.50`:
 *    when `params.sourceMaterial`/`params.relationExpected` are supplied
 *    (`modal.ts`'s `resolveGradingSourceBlocks` result, carried on
 *    `ResolvedPrompt`), they are forwarded as that function's `resolved`
 *    argument — F5.3's narrower omission denominator, instead of the
 *    role-blind `context.sourceBlocks` default.
 * 2. `gradeSoloAttempt` (`../grading/wiring.ts`) runs it through the
 *    composed `SoloJudgeCaller`, coming back with a real `[D-117]`
 *    `artifactProvenance` alongside the grading (`null` under F7.8's
 *    grey-out, or when the Worker response carried no D7.3 stamp).
 * 3. `acceptSoloGrading` (`olea-core`, INV-6) turns the pending grading into
 *    something fit to write — called only from inside this accept flow,
 *    i.e. only after she has clicked Accept on the (correctness) grading
 *    already shown to her. The SOLO depth level itself is NEVER separately
 *    shown to her (GLOSSARY SOLO rule 5) or separately confirmed — her one
 *    Accept gesture covers whatever evidence this attempt produces, the
 *    same "one review, one event" model the design question above settles.
 * 4. `recordGradedExplainBackReview` (`olea-core`, `ol-95vv.3`) mints a real
 *    `[D-077]` `contentRef`, composes the full `ReviewLogRecordInput`, and
 *    appends it.
 *
 * ===========================================================================
 * `answerEdits` REACHES THE PERSISTED RECORD (`ol-0r92.124`, closing
 * `ol-0r92.123` / `ol-0r92.56` / `[D-228 / SIG-3]`)
 * ===========================================================================
 * `modal.ts` (`ol-0r92.56`) seals `answerEdits` at `submitAnswer` and
 * threads it onto `deps.recordSoloGradeAndReview`'s params — the same
 * "computed once, carried through" posture `durationMs` already documents
 * just below — and `main.ts`'s untouched, unreconstructed pass-through
 * (`recordSoloGradeAndReview: (params) => this.recordExplainBackSoloGrade
 * AndReview(params)`) means the real value genuinely reaches THIS module's
 * `params.answerEdits` at runtime, for every production call.
 *
 * `ol-0r92.124` widened `GradedExplainBackReviewSubject` and
 * `composeGradedExplainBackReviewRecord`
 * (`../../../core/src/study-session/explain-back-grade-write.ts`) with an
 * `answerEdits` slot, conditionally spread exactly as `supportLevelShown`
 * already was — so this module now forwards `params.answerEdits` onto
 * `subject.answerEdits` (see {@link recordSoloGradeAndReview} below), and it
 * rides the same one write `recordGradedExplainBackReview` performs. Absence
 * still means "not captured," never a fabricated zero.
 *
 * ===========================================================================
 * THE NEIGHBOUR'S KEY, AND WHAT A MISSING ONE COSTS (`ol-egov.141.89.6.75`)
 * ===========================================================================
 * For a relational prompt (`relationExpected`), the depth judge may report
 * that her answer used the neighbour correctly, and F5.3a records that as a
 * scheduling observation carrying only the neighbour's concept KEY
 * (`params.neighbourConceptId`, decided when the prompt was composed). The key
 * is forwarded to `recordGradedExplainBackReview`; it is never read off the
 * response and never guessed. **A missing key never costs the attempt its
 * depth record**: the writer records the grade without the observation and its
 * outcome says `not-recorded`, which this module surfaces on
 * `RecordSoloGradeAndReviewOutcome.schedulingObservation` (four outcomes:
 * recorded, not-observed, not-recorded, not-run) and announces with a
 * content-free log line. Before this bead the write threw and the depth record
 * and the observation were both lost. `modal.ts` is the caller that knows the
 * key (it resolves the partner); handing it over is that file's last hop.
 *
 * ===========================================================================
 * DISCLOSED GAP: `conceptIds` REQUIRES A KNOWN CONCEPT (DF-20)
 * ===========================================================================
 * `reviewLogRecordV5.conceptIds` is non-empty by schema — an instrument with
 * no concept is invisible to the mastery fold (the same rule
 * `reviewLogRecordV3`'s own doc gives). `ExplainBackModal`'s free-form,
 * on-demand entry point resolves `subjectConceptId: null` when no concept is
 * known (`modal.ts`'s `resolveTopicPrompt`) — there is no concept id to
 * write. `recordSoloGradeAndReview` returns without grading or writing
 * anything in that case, the same honest-skip posture `./observation.ts`'s
 * `resolveConceptId` already takes for a citation it cannot resolve, rather
 * than inventing or guessing a concept.
 *
 * ===========================================================================
 * OTHER FIELDS THIS MODULE FIXES, AND WHY (Class B — flagged, not guessed)
 * ===========================================================================
 * `GradedExplainBackReviewSubject` needs `wasUnsure`, `durationMs` and a full
 * `selectionContext`; `wasUnsure` and `selectionContext` are not tracked by
 * this view, `durationMs` now is (`ol-yj0k`):
 *
 * - `wasUnsure: false`, always. `review/session.ts`'s `wasUnsure` is a
 *   self-report guess-toggle the review UI renders for rated instruments;
 *   building an equivalent toggle here would be a new user-visible
 *   affordance with no citing clause. Structurally `false` mirrors
 *   `explain-back-grade-write.ts`'s own hardcoded `rating: null` — an
 *   explanation is free production, never a flagged guess.
 * - `durationMs: params.durationMs ?? null` — **wired, `ol-yj0k`.** Defined
 *   the same way `review/session.ts` defines it for QA/cloze/MCQ: the
 *   milliseconds from the moment the prompt became visible to the moment
 *   she submitted an answer to it. `modal.ts` is the only place that can
 *   observe both those moments (they are UI state transitions, not
 *   anything this module resolves), so `modal.ts` computes the value
 *   through its own injected clock and passes it in on
 *   `RecordSoloGradeAndReviewParams.durationMs`; this module only relays it
 *   into the field, same "true absence, not a placeholder" discipline as
 *   before when the caller has no clock wired (falls back to `null`, never
 *   a guessed number). Optional on the params type — not because the value
 *   is optional in principle, but because `main.ts`'s existing inline
 *   `recordExplainBackSoloGradeAndReview` params type
 *   (`packages/plugin/src/main.ts`, outside this bead's `owns`) does not
 *   declare it; TypeScript's structural typing lets the extra field ride
 *   through main.ts's untouched forwarding call unchanged (same object
 *   reference start to finish, nothing reconstructs it), so the real value
 *   modal.ts computes still reaches this function at runtime. Tightening
 *   main.ts's inline type to name `durationMs` explicitly is a Class A
 *   follow-up, not required for correctness.
 * - `selectionContext.dueState: 'new'` — explain-back is never queue-selected
 *   (F2.14/`[D-126]`, "priced, never selected"), so none of the four
 *   `dueState` values is literally true of a self-initiated or routed
 *   attempt. `'new'` is the least-fictional of the four (this instrument
 *   carries no FSRS due state at all to be overdue or early against).
 * - `examProximity: null`, `yieldRank: null` — honest "not computed",
 *   matching every non-P5/non-oracle writer's own default.
 * - `instrumentTypesOffered: ['explain-back']` — the only type "offered"
 *   being this attempt itself, since nothing queued alternatives for it.
 * - `planVersion: null` — pre-P5/not applicable, the schema's own default
 *   for every writer that isn't the study-plan queue.
 *
 * These are Class B calls (non-persisted vocabulary/threshold choices) per
 * this repo's run charter — proceeding with the reversible default, flagged
 * here for retroactive review, not escalated.
 *
 * `misconceptionDetail` is deliberately never populated here:
 * `MintSoloGradingContentInput`'s own doc says whether a grading "surfaced a
 * misconception" is `misconception/`'s classification to make, not this
 * module's to guess at — out of `ol-cqz8`'s `owns` either way.
 * `masteryAtTime` is left absent for the same "not recorded" reason every
 * other non-computing caller leaves it. `supportLevelShown` is no longer in
 * that list (`ol-l7ew` [DOS-C5a]): `modal.ts` resolves it from what it
 * actually renders and passes it in, and this module relays whatever it is
 * given — absent still means unknown, never `'independent'`.
 *
 * ===========================================================================
 * REACHABILITY ([D-072] clause 5) — NAMED, NOT HIDDEN
 * ===========================================================================
 * `recordSoloGradeAndReview` is real, callable, tested code — not a stub —
 * and `modal.ts`'s `acceptGrading` calls it via `ExplainBackModalDeps
 * .recordSoloGradeAndReview` (`packages/plugin/src/explain-back/modal.ts`,
 * `acceptGrading`). That field is OPTIONAL and the call is best-effort
 * (mirrors `acceptExplainBackGradingWithObservation`'s own "an embedding
 * failure never fails the grade acceptance it rode on" posture), but IS
 * supplied in production: `main.ts`'s `recordExplainBackSoloGradeAndReview`
 * (`ol-38kp`) builds a real `RecordSoloGradeAndReviewDeps` from `this.grading`
 * plus a fresh `ObsidianSource`/device id and is wired into
 * `openExplainBackModal`'s deps literal
 * (`packages/plugin/src/main.ts`, `recordSoloGradeAndReview: (params) =>
 * this.recordExplainBackSoloGradeAndReview(params)`).
 *
 * **`ol-iti2` closes the one remaining gap.** `[D-217]`'s depth heading
 * (`modal.ts`'s `renderAcceptedPhase`) needs the graded `SoloLevel` itself,
 * not just a successful write — this module now returns it (see
 * `RecordSoloGradeAndReviewOutcome` above), and `main.ts`'s wrapper forwards
 * `.soloLevel` on rather than discarding it (its own return type widened
 * from `Promise<void>` to `Promise<SoloLevel | void>` to match).
 */

import type { AnswerEdits, ExplainBackCorrectness, SoloLevel, SupportLevel } from 'olea-contracts';
import {
  type AppendReviewLogOptions,
  type AppendReviewLogResult,
  acceptSoloGrading,
  appendReviewLogRecord,
  EXPLAIN_BACK_JUDGE_TASK_ID,
  type ExplainBackPromptContext,
  type GradedExplainBackReviewSubject,
  type GradingSourceMaterial,
  type ReviewLogRecordInput,
  recordGradedExplainBackReview,
  type VaultSource,
  type WriteContentOptions,
} from 'olea-core';
import { type GradingWiring, gradeSoloAttempt } from '../grading/wiring.js';
import { isoWithLocalOffset } from '../review/ports.js';
import { buildGradeSoloInputFromTypedAnswer } from './request.js';

export interface RecordSoloGradeAndReviewDeps {
  readonly grading: GradingWiring;
  readonly vault: VaultSource;
  /** Per-install identifier (`AppendReviewLogOptions.deviceId`'s own doc) — supplied by the caller, never minted here. */
  readonly deviceId: string;
  /** INV-1: no clock in this module itself — the caller's real `Date`, injectable for tests. */
  readonly now: () => Date;
}

export interface RecordSoloGradeAndReviewParams {
  readonly instrumentId: string;
  /**
   * `ol-0r92.94` [DOS-C1]: the caller's per-attempt id, minted once at
   * submit time (`modal.ts`'s `submitAnswer`) — distinct from
   * `instrumentId`, which is the instrument's own id and is shared by every
   * attempt at it. Forwarded to `recordGradedExplainBackReview`'s durable
   * idempotency key; see that function's own doc for what it is checked
   * against.
   *
   * Optional, not required: `main.ts`'s existing inline
   * `recordExplainBackSoloGradeAndReview` params type (outside this bead's
   * `owns`) does not declare it, the same structural-typing accommodation
   * `durationMs` above already documents. Absent, this function falls back
   * to `instrumentId` — the exact PRE-this-bead behaviour for that one
   * un-updated call site (still collapses two genuine attempts at one
   * instrument, but no worse than before this bead). `modal.ts`'s own
   * production call always supplies a real one. Widening `main.ts`'s inline
   * type to require and forward it is a named follow-up, not required for
   * correctness here.
   */
  readonly attemptId?: string;
  /** `null` for a free-form entry point with no resolved concept — see this module's own "disclosed gap" doc. */
  readonly subjectConceptId: string | null;
  readonly context: ExplainBackPromptContext;
  readonly answer: string;
  /**
   * Milliseconds from the prompt being shown to the answer being submitted
   * (`modal.ts`'s definition, matching `review/session.ts`'s
   * presented-to-rated window for QA/cloze/MCQ) — `null` when nothing timed
   * it. Optional so a caller with no clock wired (or an older inline type
   * that doesn't yet name this field — see this module's doc) still
   * type-checks; always relayed as `null`, never inferred, when absent.
   */
  readonly durationMs?: number | null;
  /**
   * **`[D-281]` / `ol-95vv.10`: the support level actually shown on this
   * attempt**, which the fold reads to tell demonstration-with-help from
   * independent demonstration. Optional and NEVER defaulted HERE: this
   * module cannot see a screen, so a caller that does not know what was
   * shown leaves it absent, which `[D-281]` rules is unknown and does not
   * permit the top growth stage's claim.
   *
   * `ol-l7ew` [DOS-C5a] RETRACTS this field's earlier "no plumbing exists"
   * note: `modal.ts` — the one rendering implementation of this exchange —
   * now resolves the level from what its answering phase actually renders,
   * via {@link supportLevelShownForExplainBack} just below, and passes it on
   * the same call that carries `attemptId`. That is a reading of the view,
   * not an assumption about it; the constant it reads lives beside the
   * render method it describes.
   */
  readonly supportLevelShown?: SupportLevel;
  /**
   * The `eventId` of the review-log event this attempt corrects, when this
   * call is a corrective re-grade — absent or `null` for an ordinary fresh
   * attempt, the historical and still the ordinary case. Forwarded verbatim
   * to `recordGradedExplainBackReview`'s own `revisionOf`
   * (`../../../core/src/study-session/explain-back-grade-write.js`), whose
   * doc states a corrective re-grade "is a DIFFERENT attempt (a fresh
   * attemptId), never [equal] to instrumentId or revisionOf" — a caller
   * supplying this must still mint a fresh `attemptId` above, never reuse
   * the corrected attempt's own id.
   *
   * **`[D-281]` (`ol-95vv.10`)'s correction rule is the one ruled exception
   * to the growth stage's otherwise-monotone high-water mark** — "where one
   * grade supersedes another via `revisionOf`, the later grade wins"
   * (`ol-95vv.10`'s close reason). `../../../core/src/mastery/rollup.js`'s
   * `qualifiesForTopStage` already reads this field, unconditionally, off
   * whatever the log carries; before this field existed on this module's
   * params, this — the one production writer of `explainBackGrade` — always
   * passed `null` regardless of what a caller intended, so the correction
   * rule had no real value in production to ever act on
   * (`docs/dev/intelligence-build/att.md` item 7, `olea-service`).
   */
  readonly revisionOf?: string | null;
  /**
   * **`ol-0r92.56` (`[D-228 / SIG-3]`): how this attempt's answer was
   * composed.** Optional for the same structural-typing reason `durationMs`
   * above is: `modal.ts`'s real call always supplies a real one (sealed once
   * at `submitAnswer`, never re-derived here), but the type stays optional so
   * a caller — or an older inline type that doesn't yet name this field —
   * still typechecks without it.
   *
   * **Forwarded onto the persisted record** (`ol-0r92.124`): relayed
   * unchanged onto `GradedExplainBackReviewSubject.answerEdits`, which
   * `composeGradedExplainBackReviewRecord`
   * (`../../../core/src/study-session/explain-back-grade-write.ts`) spreads
   * conditionally, exactly as `supportLevelShown` already is. Absence must
   * keep meaning "not captured", never "no edits made" (the contract field's
   * own doc) — this module makes no attempt to default or guess a value when
   * the caller omits it.
   */
  readonly answerEdits?: AnswerEdits;
  /**
   * **`ol-egov.141.89.6.50`: the `GradingSourceMaterial` `modal.ts`'s
   * `resolveGradingSourceBlocks` built for this prompt** — carried on
   * `ResolvedPrompt.sourceMaterial` since prompt-resolution time, never
   * re-derived here, and threaded verbatim into `buildGradeSoloInputFromTypedAnswer`'s
   * (`./request.ts`) `resolved.sourceMaterial`. This is the fix for the gap
   * that function's own doc names: "resolveGradingSourceBlocks flattens
   * GradingSourceMaterial.sourceBlocks into one undifferentiated
   * ExplainBackSourceBlock[] and discards .omissionDenominator entirely" —
   * F5.3's narrower denominator (subject material plus the edge's own
   * provenance, never the neighbour's own defining passages) only reaches
   * SOLO if this field is forwarded.
   *
   * Optional, same structural-typing accommodation `durationMs` above
   * documents: absent — every call before this bead, and every call whose
   * prompt has no live causes partner or no subject concept at all — falls
   * back to `buildGradeSoloInputFromTypedAnswer`'s pre-existing
   * concept-only default, byte-identical to today.
   */
  readonly sourceMaterial?: GradingSourceMaterial;
  /**
   * **`ol-egov.141.89.6.50`: true exactly when `sourceMaterial` was built
   * from a relation context** (`GradingRelationContext.kind === 'relation'`)
   * — `modal.ts`'s `resolveGradingSourceBlocks`'s own `relationExpected`,
   * carried on `ResolvedPrompt` the same way `sourceMaterial` is and
   * forwarded verbatim into `buildGradeSoloInputFromTypedAnswer`'s
   * `resolved.relationExpected`. Absent falls back to `false`, the
   * pre-existing default — `groundSoloResponse` (`olea-core`) then drops
   * `neighbourUseDemonstrated` entirely, exactly as it did before this field
   * existed.
   */
  readonly relationExpected?: boolean;
  /**
   * **`ol-egov.141.89.6.75` (F5.3a, C5.11): the neighbour's concept KEY** — the
   * opaque `ConceptRecord.key` of the other end of the causes edge the prompt
   * was composed from (`./request.ts`'s `resolveExplainBackCausesPartner`
   * returns it as `neighbourConceptId`), never its wording. It is decided when
   * the prompt is composed and handed in here, never read off the model's
   * response (which carries no field a neighbour could be identified by) and
   * never guessed from the subject. Forwarded verbatim to
   * `recordGradedExplainBackReview`, where it becomes
   * `schedulingObservation.neighbourConceptId` exactly when the depth judge
   * reports that her answer used the neighbour correctly. The review view
   * compares that value with instrument `conceptIds`, which are keys, so a
   * wording here would name a neighbour nothing could match.
   *
   * Optional, same structural-typing accommodation `durationMs` above
   * documents (`main.ts`'s inline params type does not name it; the object
   * reaches this function unreconstructed). Absent — every call whose prompt
   * has no causes partner, and, until `modal.ts` hands it over, every call —
   * means no observation can be recorded: if the judge nonetheless reports
   * neighbour use, the depth record is still written whole and the outcome's
   * `schedulingObservation` says `not-recorded` (see
   * {@link SoloSchedulingObservationOutcome}).
   */
  readonly neighbourConceptId?: string;
  /**
   * **`ol-ryrh` (`[D-286]`, `[D-320]`): whether the depth pass runs for this
   * attempt at all.** `'skipped'` when the caller has already decided, from
   * the correctness verdict she accepted, that no depth call is made
   * (`./request.ts`'s `shouldRunExplainBackDepthPass`) — no Worker call is
   * made here, and the accepted correctness verdict is still recorded, on its
   * own (see {@link recordSoloGradeAndReview}).
   *
   * Optional, same structural-typing accommodation `durationMs` above
   * documents: `main.ts`'s inline params type does not name it, and the
   * object reaches this function unreconstructed. Absent means `'run'`, the
   * behaviour every caller had before this field existed.
   */
  readonly depthPass?: 'run' | 'skipped';
  /**
   * **`[D-416]`: the attempt this accepted answer followed** — the
   * `attemptId` of the attempt she set aside with Try again immediately
   * before writing it (`modal.ts`'s sealed `SealedAttemptSupport`). Relayed
   * onto `GradedExplainBackReviewSubject.followsAttemptId` and so onto the
   * review's `followsAttemptId`, on the depth-graded and correctness-only
   * writes alike. Absent for a first attempt; never defaulted or guessed.
   */
  readonly followsAttemptId?: string;
}

/** What a successful write hands back — the real `AppendReviewLogResult` (`ol-cqz8`'s original shape, a test or future caller can still inspect exactly what landed) plus the `SoloLevel` `acceptSoloGrading` graded it at, surfaced so a caller can forward it on without re-deriving it from `result.record.explainBackGrade` (`ol-iti2`, `[D-217]`'s render path). */
export interface RecordSoloGradeAndReviewOutcome {
  readonly result: AppendReviewLogResult;
  /**
   * Present exactly when `depth` is `'graded'`. Absent — never a default
   * level — when the record carries the correctness verdict alone
   * (`ol-ryrh`, `[D-320]`), so `main.ts`'s `outcome?.soloLevel` still reads
   * `undefined` and the modal renders no depth heading.
   */
  readonly soloLevel?: SoloLevel;
  /**
   * `ol-ryrh` (`[D-320]`): why the record does or does not carry a depth
   * grade. `'unavailable'` covers every reason `gradeSoloAttempt` gives no
   * grading (Worker not configured, kill switch tripped, no usable D7.3
   * stamp, or the call itself failing); `'skipped'` is the caller's
   * deliberate `depthPass: 'skipped'`. The two are kept apart because the
   * ruling keeps them apart; neither is ever a complete assessment.
   */
  readonly depth: 'graded' | 'unavailable' | 'skipped';
  /**
   * **`ol-egov.141.89.6.75`: what became of F5.3a's scheduling observation on
   * this write** — always present, so a caller can never mistake a failure for
   * an absence. See {@link SoloSchedulingObservationOutcome}.
   */
  readonly schedulingObservation: SoloSchedulingObservationOutcome;
}

/**
 * **`ol-egov.141.89.6.75`: the four outcomes of the scheduling observation,
 * kept apart.** The first three are the writer's own words
 * (`recordGradedExplainBackReview`'s `SchedulingObservationOutcome`); the
 * fourth is this module's, for an attempt with no depth grade at all:
 *
 * - `recorded`: the judge reported neighbour use, the neighbour key was
 *   handed in, and the event carries the observation.
 * - `not-observed`: no neighbour use was reported (or none was asked for).
 *   An honest absence.
 * - `not-recorded`: neighbour use WAS reported and the observation could not
 *   be put on the record (`reason` is a closed word, never content). **A
 *   failure, kept distinct and never silent**, and never a reason to lose the
 *   depth grade, which is written regardless; a content-free line is logged.
 * - `not-run`: no depth grade was made (`depth` is `'skipped'` or
 *   `'unavailable'`), so there was no judgement to record.
 */
export type SoloSchedulingObservationOutcome =
  | Awaited<ReturnType<typeof recordGradedExplainBackReview>>['schedulingObservation']
  | { readonly status: 'not-run' };

/**
 * What an explain-back view had on screen while she was composing her
 * answer — the two affordances `[D-094]`'s ladder distinguishes, as
 * `olea-contracts`' `supportLevel` doc names them: a targeted hint on
 * demand, and the source expanded beside her.
 *
 * Deliberately a description of the PRESENTATION, never of the session's
 * intent: `[D-094]` / principle 16 is "record what was shown, never what she
 * said", and a level chosen upstream that no view ever rendered is not a
 * level she was shown.
 */
export interface ExplainBackSupportShown {
  /** A targeted hint was offered to her at any point before she submitted. */
  readonly hintOffered: boolean;
  /** The cited source was expanded, and readable, while she composed her answer. */
  readonly sourceShownWhileAnswering: boolean;
}

/**
 * The ladder value for one explain-back attempt, from what was on screen.
 *
 * `null` means the presentation is genuinely unobservable, and the answer is
 * `undefined` — UNKNOWN, which `[D-281]` does not admit for the top growth
 * stage. Never collapse that case to `'independent'`: an unknown support
 * level and a demonstrably unaided one are exactly the two things the
 * decision needs told apart, and guessing the second fabricates the evidence
 * it asks for.
 *
 * The source outranks the hint because it is the stronger scaffold: with the
 * text open beside her, an explanation may be a reading of it rather than her
 * own account, which is precisely why `ADMITTED_SUPPORT_LEVELS`
 * (`olea-core`'s `mastery/rollup.ts`) refuses `'guided'`.
 */
export function supportLevelShownForExplainBack(
  shown: ExplainBackSupportShown | null,
): SupportLevel | undefined {
  if (shown === null) return undefined;
  if (shown.sourceShownWhileAnswering) return 'guided';
  return shown.hintOffered ? 'prompted' : 'independent';
}

/**
 * Runs the SOLO pipeline and appends the one review-log event this module's
 * header settles is the correct shape.
 *
 * **`ol-ryrh` (`[D-303]`, `[D-320]`): the correctness verdict she accepted
 * is recorded whether or not depth grading succeeds.** When the depth pass
 * is skipped (`params.depthPass === 'skipped'`) or unavailable
 * (`gradeSoloAttempt` returns `null`, or the call fails), the one event is
 * still appended, carrying the top-level `explainBackCorrectness` and no
 * `explainBackGrade` at all — depth is simply absent from the record, never
 * a default level. Before this, the only write required a depth grade, so an
 * accept she had already seen left no trace whenever depth failed.
 *
 * `undefined` (nothing written) only when there is nothing honest to write:
 * `subjectConceptId` is `null` (no concept to attribute evidence to), or no
 * depth grade came back AND no stamped correctness verdict exists for this
 * attempt (`resolveIndependentCorrectness`'s own list). Never a fabricated
 * write. Returns the real write outcome otherwise (`ol-iti2`: `main.ts`'s
 * wrapper forwards `.soloLevel` on to `modal.ts`'s `[D-217]` depth heading; a
 * test can still reach the full `AppendReviewLogResult` at `.result`).
 */
export async function recordSoloGradeAndReview(
  deps: RecordSoloGradeAndReviewDeps,
  params: RecordSoloGradeAndReviewParams,
): Promise<RecordSoloGradeAndReviewOutcome | undefined> {
  const subjectConceptId = params.subjectConceptId;
  if (subjectConceptId === null) return undefined;

  const attemptId = params.attemptId ?? params.instrumentId;
  // R10 / `[D-343]` (`ol-egov.141.89.9.85`): an accept after its cited passage changed is refused at
  // the writer and never recorded, correctness or depth. A fold over the log cannot know it, so it
  // is decided here, before any depth call is spent.
  if (await acceptWasStale(deps.grading, attemptId)) return undefined;
  const subject = (timestamp: string): GradedExplainBackReviewSubject => ({
    instrumentId: params.instrumentId,
    conceptIds: [subjectConceptId],
    timestamp,
    wasUnsure: false,
    durationMs: params.durationMs ?? null,
    ...(params.supportLevelShown !== undefined
      ? { supportLevelShown: params.supportLevelShown }
      : {}),
    ...(params.answerEdits !== undefined ? { answerEdits: params.answerEdits } : {}),
    ...(params.followsAttemptId !== undefined ? { followsAttemptId: params.followsAttemptId } : {}),
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
  });
  const options: AppendReviewLogOptions & WriteContentOptions = { deviceId: deps.deviceId };

  if (params.depthPass === 'skipped') {
    return recordCorrectnessOnly(deps, attemptId, subject, options, 'skipped');
  }

  // `ol-egov.141.89.6.50`: `resolved` is genuinely absent-field-vs-undefined
  // sensitive under `exactOptionalPropertyTypes` (`request.ts`'s own
  // `resolved?` param doc) — each key spread only when the caller actually
  // supplied it, so an older or partner-less call still resolves
  // `buildGradeSoloInputFromTypedAnswer`'s pre-existing concept-only
  // default exactly as before this bead.
  const soloInput = buildGradeSoloInputFromTypedAnswer(params.answer, params.context, {
    ...(params.sourceMaterial !== undefined ? { sourceMaterial: params.sourceMaterial } : {}),
    ...(params.relationExpected !== undefined ? { relationExpected: params.relationExpected } : {}),
  });
  // `ol-ryrh`: a depth call that throws is unavailable depth, exactly as a
  // `null` is — never a reason to lose the correctness verdict she accepted.
  let outcome: Awaited<ReturnType<typeof gradeSoloAttempt>>;
  try {
    outcome = await gradeSoloAttempt(deps.grading, soloInput);
  } catch (error) {
    // D-005: a content-free line only, the same one `modal.ts` used to print
    // when this failure escaped to it.
    console.error('Olea: SOLO depth grading failed (correctness verdict still recorded)', {
      error,
    });
    outcome = null;
  }
  if (outcome === null) {
    return recordCorrectnessOnly(deps, attemptId, subject, options, 'unavailable');
  }

  const accepted = acceptSoloGrading(outcome.pending);
  const timestamp = isoWithLocalOffset(deps.now());
  const explainBackCorrectness = await resolveIndependentCorrectness(deps.grading, attemptId);

  const result = await recordGradedExplainBackReview(
    deps.vault,
    {
      subject: subject(timestamp),
      accepted,
      revisionOf: params.revisionOf ?? null,
      artifactProvenance: outcome.artifactProvenance,
      studentAnswer: params.answer,
      attemptId,
      // `ol-egov.141.89.6.75`: the neighbour's KEY, when the prompt named one — the one thing
      // F5.3a's observation is built from. Spread only when supplied; never derived here.
      ...(params.neighbourConceptId !== undefined
        ? { neighbourConceptId: params.neighbourConceptId }
        : {}),
      ...(explainBackCorrectness !== undefined ? { explainBackCorrectness } : {}),
    },
    options,
  );

  if (result.schedulingObservation.status === 'not-recorded') {
    // D-005: a closed reason word only, never her wording, the grader's, or a concept key. The
    // depth record above is whole; this is the one place the lost observation is announced.
    console.error('Olea: the depth grade was recorded without its scheduling observation', {
      reason: result.schedulingObservation.reason,
    });
  }
  const { schedulingObservation, ...written } = result;
  return {
    result: written,
    soloLevel: accepted.soloLevel,
    depth: 'graded',
    schedulingObservation,
  };
}

/**
 * **`ol-ryrh`: the one event, when no depth grade exists for this attempt**
 * — the subject's own review fields plus the top-level
 * `explainBackCorrectness` (`[D-303]`: its own place, its own stamp), and no
 * `explainBackGrade`, `contentRef` or `schedulingObservation`: each of those
 * is produced by the depth pass alone, so each is simply absent.
 *
 * Nothing is written when no stamped verdict resolves for this attempt: an
 * explain-back review with neither a depth grade nor a verdict would say
 * nothing about the attempt, and the verdict is never guessed.
 *
 * **Idempotency.** `recordGradedExplainBackReview`'s durable check keys on
 * the depth grade's `contentRef`, which this record has none of. A double
 * accept is already shared in memory by `modal.ts`'s per-attempt in-flight
 * memo, and a restart leaves no pending grading to accept again — the
 * correctness verdict lives only in `wiring.acceptedObservationsByAttempt`'s
 * in-memory memo — so no second write for the same attempt is reachable.
 */
async function recordCorrectnessOnly(
  deps: RecordSoloGradeAndReviewDeps,
  attemptId: string,
  subject: (timestamp: string) => GradedExplainBackReviewSubject,
  options: AppendReviewLogOptions,
  depth: 'unavailable' | 'skipped',
): Promise<RecordSoloGradeAndReviewOutcome | undefined> {
  const explainBackCorrectness = await resolveIndependentCorrectness(deps.grading, attemptId);
  if (explainBackCorrectness === undefined) return undefined;
  const fields = subject(isoWithLocalOffset(deps.now()));
  const record: ReviewLogRecordInput = {
    timestamp: fields.timestamp,
    instrumentId: fields.instrumentId,
    instrumentType: 'explain-back',
    conceptIds: [...fields.conceptIds],
    // F2.16: explain-back produces no FSRS rating.
    rating: null,
    wasUnsure: fields.wasUnsure,
    durationMs: fields.durationMs,
    selectionContext: fields.selectionContext,
    ...(fields.supportLevelShown !== undefined
      ? { supportLevelShown: fields.supportLevelShown }
      : {}),
    ...(fields.answerEdits !== undefined ? { answerEdits: fields.answerEdits } : {}),
    explainBackCorrectness,
    ...(fields.followsAttemptId !== undefined ? { followsAttemptId: fields.followsAttemptId } : {}),
  };
  const result = await appendReviewLogRecord(deps.vault, record, options);
  // No depth grade was made, so there was no neighbour-use judgement to record.
  return { result, depth, schedulingObservation: { status: 'not-run' } };
}

/**
 * **`[D-281]` / `ol-95vv.10`: the independent correctness verdict for THIS
 * attempt, read from the accept the modal has already run.**
 *
 * The correctness judge and the SOLO depth judge are separate Worker tasks by
 * design (this module's header), and the accept flow runs the correctness one
 * first: `modal.ts`'s `acceptGrading` awaits `acceptWithObservation` before it
 * calls this module, and `wiring.ts` memoises that accept's result on
 * `wiring.acceptedObservationsByAttempt`, keyed by the SAME per-attempt id
 * this function is handed. So the verdict is already resolved, for this exact
 * attempt, and is read here rather than re-graded — one attempt, one
 * correctness judgement, and no second Worker call.
 *
 * Reading it here rather than taking it as a parameter is deliberate: it keeps
 * the depth pipeline's own caller (`modal.ts`) unchanged and, more
 * importantly, makes it structurally impossible for a caller to hand this
 * writer a correctness verdict from a DIFFERENT attempt — the key is the
 * attempt.
 *
 * **Returned as the record's top-level `explainBackCorrectness`** (`[D-303]`,
 * `[D-386]`, `ol-95vv.8`): the verdict with the correctness call's own D7.3
 * stamp, carried from the grading pipeline's accept. Since review-log v6 the
 * nested `explainBackGrade.correctness` is never written.
 *
 * `undefined` — recorded as unknown, never as correct — in every case where
 * the verdict is not a standing judgement about this attempt, or cannot be
 * recorded with its own stamp:
 * - the accept carries no stamp: the stamp is mandatory on the top-level
 *   field, and none is ever invented or borrowed from the depth call.
 *   Unreachable from production since `ol-95vv.8`'s Class B change: the only
 *   production judge caller (`createWorkerJudgeCaller`) fails a success reply
 *   without a usable stamp, so no stamp-less verdict is ever accepted. Kept as
 *   a defensive guard;
 * - no memoised accept for this attempt (the correctness pipeline did not run,
 *   or a caller supplied no real per-attempt id);
 * - the accept came back `'stale'` (`ol-0r92.89`): the source the grading cited
 *   has changed, so nothing about it still stands — `[D-281]`'s instrument
 *   validity limb, refused at write time rather than left for the fold;
 * - the accept threw (an ungrounded citation, a caller bug): no verdict
 *   survives a refused accept, and this function never fails the depth write
 *   that rode on it.
 */
async function acceptWasStale(
  wiring: RecordSoloGradeAndReviewDeps['grading'],
  attemptId: string,
): Promise<boolean> {
  const pendingAccept = wiring.acceptedObservationsByAttempt.get(attemptId);
  if (pendingAccept === undefined) return false;
  try {
    return (await pendingAccept).status === 'stale';
  } catch {
    return false;
  }
}

async function resolveIndependentCorrectness(
  wiring: RecordSoloGradeAndReviewDeps['grading'],
  attemptId: string,
): Promise<ExplainBackCorrectness | undefined> {
  const pendingAccept = wiring.acceptedObservationsByAttempt.get(attemptId);
  if (pendingAccept === undefined) return undefined;
  try {
    const accepted = await pendingAccept;
    if (accepted.status !== 'accepted') return undefined;
    // `[D-303]` / `[D-386]`: the verdict is recorded with the correctness
    // call's own stamp or not at all — never with the depth call's stamp,
    // never with an invented one.
    const stamp = accepted.accepted.stamp;
    if (stamp === undefined) return undefined;
    return {
      verdict: accepted.accepted.verdict,
      artifactProvenance: {
        taskId: EXPLAIN_BACK_JUDGE_TASK_ID,
        promptVersion: stamp.promptVersion,
        modelId: stamp.modelId,
      },
    };
  } catch {
    return undefined;
  }
}
