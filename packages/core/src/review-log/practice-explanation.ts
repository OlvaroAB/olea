/**
 * Reading the **practice explanation** back from her log (D7.1, `[D-603]`,
 * `[D-614]`; `ol-egov.141.89.6.128`), and the one rule for what counts as
 * study activity.
 *
 * In v0.9 an explanation she writes is ungraded practice. Each answer she
 * saves is one `practice-explanation` record (`olea-contracts`'
 * `practiceExplanationLogRecordV6`, written by `./write.ts`'s
 * `recordPracticeExplanation`). This module holds the pure readings around
 * it; it does no I/O, so a caller that already holds the whole log reads it
 * once.
 *
 * ## Study activity, never evidence
 *
 * D7.1: a practice explanation "is study activity, never evidence: a genuine
 * one (not an answer the declared local check flagged, F5.7) may count
 * wherever Olea reads that she studied, including whether she returns
 * unprompted, and none counts in any reading of what she knows or has
 * attained". So there are two sets of readers and one predicate between them:
 *
 * - **What she knows** (the evidence fold and growth stage, readiness,
 *   vitality, the misconception projection, scheduling, the support ladder):
 *   none reads this kind. Each reads `kind: 'review'` only, which is how the
 *   set-aside and `[D-460]` marker kinds are already excluded; nothing here is
 *   imported by any of them, and `./practice-explanation-not-evidence.spec.ts`
 *   proves the readings identical with and without these records.
 * - **When she studied** (days and occasions of study): {@link isStudyActivity}
 *   is the one predicate. A review counts, as it always has; a genuine
 *   practice explanation counts beside it; a flagged answer, a non-attempt and
 *   every other kind count in none. The readers that use it are listed in
 *   `./practice-explanation-study-activity.spec.ts`. C5.6's session clustering
 *   (`../session/cluster.ts`) is not one of them: it is contract-grade and
 *   reads review events only (`[D-091]`), unchanged.
 *
 * ## The support shown, from her log and not only the open view
 *
 * D7.1's "the support actually shown (which supporting passages she had been
 * shown, on this attempt or an earlier one, before she wrote it)". "An earlier
 * one" is any earlier attempt her log records on the same prompt, in any
 * session, through the `[D-460]` exposure markers (question id, attempt id,
 * time), which the view writes before the passages appear (F5.4). `[D-459]`'s
 * "a later session is fresh" rule is for graded credit and is dormant in v0.9;
 * it does not apply here.
 *
 * **What a marker can and cannot say.** A marker names the question and the
 * attempt, never the passages. A prompt carries its source blocks (F5.2a), but
 * which blocks a lookup returned then is not recoverable now: the index, the
 * notes and the graph may all have changed. So the passages an earlier
 * attempt in the open view showed are named by digest (the view knows them),
 * and an exposure known only from an earlier attempt's marker is recorded as
 * the honest coarser fact — this prompt's passages had been shown — with no
 * digest guessed. See {@link practiceExplanationSupportShown}.
 */
import type { ReviewLogEntry, ReviewLogRecord, SupportLevel } from 'olea-contracts';
import { scoredConceptId } from '../session/scored-concept.js';
import { explainBackFeedbackShownAttempts } from './feedback-shown.js';

/** The contracts `practiceExplanationLogRecordV6` shape, narrowed off the current union on its `kind`. */
export type PracticeExplanationLogRecord = Extract<
  ReviewLogEntry,
  { readonly kind: 'practice-explanation' }
>;

/** Any practice explanation, genuine or flagged. */
export function isPracticeExplanation(
  entry: ReviewLogEntry,
): entry is PracticeExplanationLogRecord {
  return entry.kind === 'practice-explanation';
}

/**
 * A **genuine** practice explanation (D7.1, F5.7): one the declared local
 * check did not flag. The flag is the record's `localCheckFlagged: true`;
 * its absence is genuine (no check ran, or it did not flag).
 */
export function isGenuinePracticeExplanation(
  entry: ReviewLogEntry,
): entry is PracticeExplanationLogRecord {
  return entry.kind === 'practice-explanation' && entry.localCheckFlagged !== true;
}

/** A record that counts as her having studied: a review, or a genuine practice explanation. */
export type StudyActivityEntry = ReviewLogRecord | PracticeExplanationLogRecord;

/**
 * Whether `entry` counts as study activity (D7.1): every `kind: 'review'`
 * entry, as every reading of when she studied already counted, and a genuine
 * practice explanation. A flagged answer, a non-attempt, an offer, a
 * set-aside, a marker and every other kind are not.
 */
export function isStudyActivity(entry: ReviewLogEntry): entry is StudyActivityEntry {
  return entry.kind === 'review' || isGenuinePracticeExplanation(entry);
}

/**
 * The concept a study occasion was study of: a review's scored concept
 * (`[D-423]`) or the concept a practice explanation explained — index 0 of
 * either list, the one position rule both records share. `undefined` only for
 * a hand-built empty list.
 */
export function studiedConceptOf(entry: StudyActivityEntry): string | undefined {
  return scoredConceptId(entry.conceptIds);
}

/** The practice explanation already recorded for `attemptId`, if any — the writer's idempotency key. */
export function practiceExplanationForAttempt(
  entries: readonly ReviewLogEntry[],
  attemptId: string,
): PracticeExplanationLogRecord | undefined {
  for (const entry of entries) {
    if (entry.kind === 'practice-explanation' && entry.attemptId === attemptId) return entry;
  }
  return undefined;
}

/**
 * The passages the open view showed her after one earlier attempt at this
 * prompt, before she wrote the answer being recorded: the attempt's id and
 * the digest of each passage shown, in the order shown (`olea-core`'s
 * `digestPassage`, the digest space `presentedPassageDigest` uses). Never the
 * passage text.
 */
export interface PassagesShownInView {
  readonly attemptId: string;
  readonly passageFingerprints: readonly string[];
}

/** The slice of a whole-log read this reading needs (`../session/history.ts`'s `readReviewLogHistory`). */
export interface PracticeSupportHistory {
  readonly entries: readonly ReviewLogEntry[];
  readonly invalidLines: readonly { readonly line: { readonly raw: string } }[];
}

/** D7.1's support actually shown, in the record's two fields. Absent fields are true absences. */
export interface PracticeSupportShown {
  /** `'guided'`: passages had been shown before she wrote it; `'independent'`: none had; absent: unknown. */
  readonly supportLevelShown?: SupportLevel;
  /** The passages by digest, beside `'guided'` only, when every exposure can be named. */
  readonly passageFingerprints?: readonly string[];
}

function isLaterThan(candidate: string, than: string): boolean {
  const a = Date.parse(candidate);
  const b = Date.parse(than);
  return !Number.isNaN(a) && !Number.isNaN(b) && a > b;
}

/**
 * The support shown before she wrote one answer, from the open view and from
 * her log together.
 *
 * - **The open view** supplies {@link PassagesShownInView} for its own earlier
 *   attempts at this prompt (each one she left by "Try again"): those passages
 *   are named by digest. An earlier attempt whose lookup found no passage
 *   showed none.
 * - **Her log** supplies the `[D-460]` markers for this prompt (`instrumentId`).
 *   A marker for an attempt other than this one and other than the view's
 *   own, written no later than `leftAt`, is exposure on an earlier attempt —
 *   in this session after a reload, or in any earlier session. Its passages
 *   cannot be named (see the module doc), so the record says only that this
 *   prompt's passages had been shown.
 * - **An unreadable line** that names this prompt may have been such a
 *   marker (a write cut short). Where nothing else confirms exposure the
 *   support is unknown — no rung, never `'independent'` and never
 *   `'guided'` — as F5.4 rules for uncertain exposure. Where the view
 *   confirms exposure it stands, but the list is no longer known to be
 *   complete, so the coarser fact is recorded.
 *
 * The result: the coarser fact (`'guided'`, no digests) whenever any exposure
 * cannot be named; `'guided'` with every named digest, deduplicated in the
 * order first shown, when all can; unknown as above; and `'independent'` when
 * nothing had been shown.
 */
export function practiceExplanationSupportShown(input: {
  readonly history: PracticeSupportHistory;
  readonly instrumentId: string;
  readonly attemptId: string;
  /** When she left this answer: the record's own `timestamp`. A marker after it is not "before". */
  readonly leftAt: string;
  readonly passagesShownInView: readonly PassagesShownInView[];
}): PracticeSupportShown {
  const viewAttemptIds = new Set(input.passagesShownInView.map((shown) => shown.attemptId));
  const named: string[] = [];
  for (const shown of input.passagesShownInView) {
    if (shown.attemptId === input.attemptId) continue;
    for (const fingerprint of shown.passageFingerprints) {
      if (!named.includes(fingerprint)) named.push(fingerprint);
    }
  }

  const unnamedEarlierExposure = explainBackFeedbackShownAttempts(
    input.history.entries,
    input.instrumentId,
  ).some(
    (marked) =>
      marked.attemptId !== input.attemptId &&
      !viewAttemptIds.has(marked.attemptId) &&
      !isLaterThan(marked.timestamp, input.leftAt),
  );
  const unreadableNamingIt = input.history.invalidLines.some(({ line }) =>
    line.raw.includes(input.instrumentId),
  );

  if (unnamedEarlierExposure) return { supportLevelShown: 'guided' };
  if (named.length > 0) {
    return unreadableNamingIt
      ? { supportLevelShown: 'guided' }
      : { supportLevelShown: 'guided', passageFingerprints: named };
  }
  if (unreadableNamingIt) return {};
  return { supportLevelShown: 'independent' };
}
