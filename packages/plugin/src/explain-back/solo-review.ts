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
 *   evidence-of-success comes from SOLO depth alone. So there is exactly
 *   ONE review-log write to make here, not a second one to reconcile with
 *   an existing first: `recordGradedExplainBackReview` (`olea-core`,
 *   `ol-95vv.3`) IS that one write.
 *
 * ===========================================================================
 * WHAT THIS MODULE DOES
 * ===========================================================================
 * 1. `buildGradeSoloInputFromTypedAnswer` (`./request.ts`) builds the SOLO
 *    request from the SAME `ExplainBackPromptContext` already resolved for
 *    the correctness pipeline — no second retrieval.
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
 * `selectionContext`, none of which this view currently tracks:
 *
 * - `wasUnsure: false`, always. `review/session.ts`'s `wasUnsure` is a
 *   self-report guess-toggle the review UI renders for rated instruments;
 *   building an equivalent toggle here would be a new user-visible
 *   affordance with no citing clause. Structurally `false` mirrors
 *   `explain-back-grade-write.ts`'s own hardcoded `rating: null` — an
 *   explanation is free production, never a flagged guess.
 * - `durationMs: null` — no timing capture is wired for this attempt yet.
 *   Honest absence, matching `RecordReviewInput`'s own optional-and-honest
 *   discipline for the case nothing measured it.
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
 * `masteryAtTime`/`supportLevelShown` are left absent for the same
 * "not recorded" reason every other non-computing caller leaves them.
 *
 * ===========================================================================
 * REACHABILITY ([D-072] clause 5) — NAMED, NOT HIDDEN
 * ===========================================================================
 * `recordSoloGradeAndReview` is real, callable, tested code — not a stub —
 * and `modal.ts`'s `acceptGrading` calls it via `ExplainBackModalDeps
 * .recordSoloGradeAndReview` (`packages/plugin/src/explain-back/modal.ts`,
 * `acceptGrading`). That field is OPTIONAL and the call is best-effort
 * (mirrors `acceptExplainBackGradingWithObservation`'s own "an embedding
 * failure never fails the grade acceptance it rode on" posture) for exactly
 * one reason: nothing supplies a real instance of it in production yet.
 * Building one needs a `GradingWiring` (`../grading/wiring.js`, already
 * composed at `main.ts`'s `this.grading`) PLUS a `VaultSource` and device id
 * (`main.ts`'s `buildExplainBackObservationContextFor` already builds both,
 * a few lines above `openExplainBackModal` — same file, same pattern) — and
 * `main.ts` is outside `ol-cqz8`'s `owns` (`packages/plugin/src/
 * explain-back/`, `packages/plugin/src/grading/`, `packages/core/src/
 * index.ts`), so the actual `openExplainBackModal` construction call
 * (`packages/plugin/src/main.ts:1887-1901`) is not touched by this bead.
 * Filed as a follow-on: wire `openExplainBackModal`'s deps literal to pass
 * `recordSoloGradeAndReview: (params) => recordSoloGradeAndReview({
 * grading: this.grading, vault: new ObsidianSource(this.app), deviceId:
 * await ensureDeviceId(this), now: () => new Date() }, params)`.
 */

import {
  type AppendReviewLogOptions,
  type AppendReviewLogResult,
  acceptSoloGrading,
  type ExplainBackPromptContext,
  type GradedExplainBackReviewSubject,
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
  /** `null` for a free-form entry point with no resolved concept — see this module's own "disclosed gap" doc. */
  readonly subjectConceptId: string | null;
  readonly context: ExplainBackPromptContext;
  readonly answer: string;
}

/**
 * Runs the SOLO pipeline and appends the one review-log event this module's
 * header settles is the correct shape — `undefined` (nothing written) when:
 * `subjectConceptId` is `null` (no concept to attribute evidence to), the
 * Worker isn't configured or the kill-switch has tripped (`gradeSoloAttempt`
 * returns `null`), or the Worker response carried no usable D7.3 stamp.
 * Every one of these is an honest skip, never a fabricated write. Returns the
 * real `AppendReviewLogResult` on a successful write — `modal.ts`'s caller
 * ignores it today, but a test (or a future caller) can inspect exactly what
 * landed.
 */
export async function recordSoloGradeAndReview(
  deps: RecordSoloGradeAndReviewDeps,
  params: RecordSoloGradeAndReviewParams,
): Promise<AppendReviewLogResult | undefined> {
  if (params.subjectConceptId === null) return undefined;

  const soloInput = buildGradeSoloInputFromTypedAnswer(params.answer, params.context);
  const outcome = await gradeSoloAttempt(deps.grading, soloInput);
  if (outcome === null) return undefined;

  const accepted = acceptSoloGrading(outcome.pending);
  const timestamp = isoWithLocalOffset(deps.now());

  const subject: GradedExplainBackReviewSubject = {
    instrumentId: params.instrumentId,
    conceptIds: [params.subjectConceptId],
    timestamp,
    wasUnsure: false,
    durationMs: null,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
  };

  const options: AppendReviewLogOptions & WriteContentOptions = { deviceId: deps.deviceId };

  return recordGradedExplainBackReview(
    deps.vault,
    {
      subject,
      accepted,
      revisionOf: null,
      artifactProvenance: outcome.artifactProvenance,
      studentAnswer: params.answer,
    },
    options,
  );
}
