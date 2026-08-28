/**
 * The per-instrument explain-back grade history **projection**
 * (`ol-0r92.1` [EVID-1], C6.2a, `[D-117]`).
 *
 * `[D-077]`'s content store (`./content-store.ts`) is the durable home for
 * her explanation text, the grader's feedback and misconception detail — one
 * immutable file per graded attempt, referenced from the review event by
 * `explainBackGrade.contentRef`. The review log itself (`./write.ts`) keeps
 * only the verdict (`soloLevel`) and its supporting facts (`contentRef`,
 * `revisionOf`, `artifactProvenance`). Neither of those, alone, is "her
 * history with one instrument" — that view has to be assembled by walking
 * the log, which is exactly what this module does and exactly why nothing
 * else may: a second place that persists a per-instrument list would be the
 * "two writable homes for one fact" failure shape `ol-0r92.1`'s own
 * description names, the same one C6 forbids for server-side state.
 *
 * ===========================================================================
 * WHY THIS LIVES BESIDE `./verdicts.ts`, NOT INSIDE IT
 * ===========================================================================
 * `./verdicts.ts` projects the accept/edit/reject `'verdict'` records
 * `ol-548w` added — a different `kind` on the same union, answering a
 * different question ("what did she do with a drafted artifact"). This
 * module projects `'review'` records whose `explainBackGrade` is present —
 * "what did she say, and how was it graded" — never verdict records. The two
 * projections share a shape (fold the log, resolve "most recent" by the same
 * `(instant, eventId)` order `./merge.ts` already sorts by) but not a
 * question, so they stay separate modules rather than one that answers both
 * by an internal branch.
 *
 * ===========================================================================
 * ORDER-INDEPENDENT, LIKE EVERY OTHER PROJECTION HERE
 * ===========================================================================
 * `entries` may arrive in any order — a caller that read one device's file
 * before another's, or merged them differently, must get the same answer.
 * So this module sorts internally by `(instant, eventId)` rather than
 * trusting input order, the same discipline `./suspension.ts` and
 * `./verdicts.ts` both state for the same reason.
 *
 * ===========================================================================
 * SUPERSESSION IS READ HERE, NEVER STORED (GLOSSARY SOLO rule 3)
 * ===========================================================================
 * GLOSSARY defines depth as "the SOLO level of the MOST RECENT graded
 * explain-back for the concept" — a read-time, chronological fact, not a
 * flag any event carries about itself (`docs/dev/verdict-seam-design.md`
 * §4, `[D-117]`). `historyEntry.superseded` below is exactly that
 * chronological read: true when a later graded attempt exists for the same
 * `instrumentId`. `explainBackGrade.revisionOf` is carried through
 * unchanged, verbatim, for the one thing chronology alone cannot say — that
 * a later entry is a RE-GRADE of the same recorded answer, not a fresh
 * attempt — but this module never uses it to decide "most recent"; that
 * would double-count the one signal ordering already gives for free and risk
 * disagreeing with it. **This module folds no mastery.** It is a display
 * projection over the log for showing her the history of one instrument, not
 * an input to the stage/vitality fold — that fold is `../mastery/rollup.ts`'s
 * own charter (`ol-95vv`, MAT-2, open) and reads `soloLevel` off the log
 * directly, never through this module (see that ticket's own scope note in
 * `docs/dev/verdict-seam-design.md` §5: "still not this bead's scope to
 * change, and still unwired").
 *
 * ===========================================================================
 * WHY THE ANSWER TEXT AND FEEDBACK ARE NOT INLINED HERE
 * ===========================================================================
 * `ExplainBackHistoryEntry` carries `contentRef`, not `studentAnswer` or
 * `feedback` — resolving those is `./content-store.ts`'s `readContentForGrade`,
 * a second, optional read a caller makes per entry it actually displays. A
 * history view can therefore show every graded attempt's verdict and
 * timestamp cheaply (one log read) and fetch the evidence text only for the
 * entries she expands — and `readContentForGrade` already handles a missing
 * referent as a defined outcome, so composing the two costs this module
 * nothing extra to get right.
 *
 * ===========================================================================
 * REACHABILITY (`[D-072]`)
 * ===========================================================================
 * No production caller exists yet. The write side this reads
 * (`explainBackGrade` actually landing on a review event) is itself unwired —
 * `ol-95vv.3` composes `writeSoloGradingContent` /
 * `buildExplainBackGradeReviewFields` onto a real `appendReviewLogRecord`
 * call from `packages/core/src/study-session/`, outside this bead's `owns`,
 * and is not yet done. A per-instrument history VIEW (a UI surface reading
 * this projection) has no clause naming it yet either — this module makes
 * the projection buildable without inventing a surface for it, per this
 * repo's "no user-visible affordance without a clause" rule. Named here
 * rather than hidden rather than filed: a follow-on bead for the eventual UI
 * caller, once a clause names one, is left for the orchestrator to file with
 * a `discovered-from` edge onto `ol-0r92.1` — this lane's `owns` does not
 * extend to `bd create`.
 */

import type {
  ArtifactProvenance,
  ExplainBackGrade,
  ReviewLogEntry,
  ReviewLogRecord,
  SoloLevel,
} from 'olea-contracts';

/** One graded explain-back attempt, projected for display — never a second write. */
export interface ExplainBackHistoryEntry {
  readonly eventId: string;
  readonly timestamp: string;
  readonly instrumentId: string;
  /** Verbatim from the record — R1/R2, never sorted or deduplicated here. */
  readonly conceptIds: readonly string[];
  readonly soloLevel: SoloLevel;
  /** Opaque `[D-077]` content-store pointer — resolve with `./content-store.ts`'s `readContentForGrade`. */
  readonly contentRef: string;
  /**
   * The `eventId` of a prior review this one re-grades under a changed
   * rubric — `null` for a fresh attempt. Carried verbatim; see this module's
   * header for why it plays no part in deciding `superseded`.
   */
  readonly revisionOf: string | null;
  readonly artifactProvenance: ArtifactProvenance;
  /**
   * True when a later graded attempt exists for the same `instrumentId` —
   * the read-time chronological fact GLOSSARY's SOLO rule 3 defines, never a
   * stored flag. The most recent entry for an instrument is always `false`.
   */
  readonly superseded: boolean;
}

/** A `'review'`-kind record whose `explainBackGrade` is present — see the module header. */
export type GradedExplainBackReview = ReviewLogRecord & {
  readonly explainBackGrade: ExplainBackGrade;
};

/** Narrows a mixed `ReviewLogEntry[]` down to graded explain-back reviews, unordered. */
export function explainBackGradeEvents(
  entries: readonly ReviewLogEntry[],
): readonly GradedExplainBackReview[] {
  return entries.filter(
    (entry): entry is GradedExplainBackReview =>
      entry.kind === 'review' && entry.explainBackGrade !== undefined,
  );
}

/** `(instant, eventId)` ascending — the same tiebreak order `./merge.ts` sorts by. */
function compareByInstantThenEventId(
  a: { readonly timestamp: string; readonly eventId: string },
  b: { readonly timestamp: string; readonly eventId: string },
): number {
  const instantA = Date.parse(a.timestamp);
  const instantB = Date.parse(b.timestamp);
  if (instantA !== instantB) return instantA - instantB;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/**
 * `instrumentId` -> its graded explain-back attempts, oldest first, each
 * marked `superseded` per this module's header. Order-independent (sorted
 * internally, never trusting `entries`' own order — see the header).
 *
 * An instrument with no graded explain-back attempt is simply absent from
 * the returned map — there is nothing to show, and an empty array would
 * invite a caller to conflate "never attempted" with "attempted, all
 * entries somehow filtered out".
 */
export function explainBackGradeHistoryByInstrument(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, readonly ExplainBackHistoryEntry[]> {
  const byInstrument = new Map<string, ExplainBackHistoryEntry[]>();

  for (const entry of explainBackGradeEvents(entries)) {
    const grade = entry.explainBackGrade;
    const list = byInstrument.get(entry.instrumentId) ?? [];
    list.push({
      eventId: entry.eventId,
      timestamp: entry.timestamp,
      instrumentId: entry.instrumentId,
      conceptIds: entry.conceptIds,
      soloLevel: grade.soloLevel,
      contentRef: grade.contentRef,
      revisionOf: grade.revisionOf,
      artifactProvenance: grade.artifactProvenance,
      // Resolved below, once every attempt for this instrument is collected.
      superseded: false,
    });
    byInstrument.set(entry.instrumentId, list);
  }

  const result = new Map<string, readonly ExplainBackHistoryEntry[]>();
  for (const [instrumentId, list] of byInstrument) {
    list.sort(compareByInstantThenEventId);
    const ordered = list.map((item, index) => ({
      ...item,
      superseded: index < list.length - 1,
    }));
    result.set(instrumentId, ordered);
  }
  return result;
}

/**
 * Convenience: `instrumentId` -> its single most recent graded explain-back
 * attempt (`superseded: false` by construction). Built from
 * `explainBackGradeHistoryByInstrument` rather than a separate fold, so
 * "most recent" can never disagree between the two — one resolution of
 * "most recent", read twice.
 */
export function latestExplainBackGradeByInstrument(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, ExplainBackHistoryEntry> {
  const history = explainBackGradeHistoryByInstrument(entries);
  const result = new Map<string, ExplainBackHistoryEntry>();
  for (const [instrumentId, list] of history) {
    const mostRecent = list[list.length - 1];
    if (mostRecent !== undefined) result.set(instrumentId, mostRecent);
  }
  return result;
}
