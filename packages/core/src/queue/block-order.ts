/**
 * F2.18/F2.19, applied to `composeQueue`'s already-selected offer list
 * (`ol-ua0i`).
 *
 * `compose.ts`'s own module doc explains WHY this runs strictly *after*
 * filter/suspend/dedupe rather than before: `study-session/compose.ts`
 * states the identical rule for the identical reason ("F2.18 — course
 * blocks, applied after selection... constrains what she meets in what
 * order and never what gets chosen, and therefore cannot starve anything").
 * This module only ever reorders an already-decided `QueueItem[]` — same
 * items, same length, never a different set, never a second dedupe pass.
 *
 * ## Reused, not duplicated
 *
 * The formulas that are F2.19's actual substance —
 * {@link withinBlockRelatedness}'s adjacency fraction,
 * {@link withinBlockAssessmentProximity}'s `[D-110]` half-life decay, and
 * (`[D-149]`, `ol-v7r5.22`) {@link withinBlockCohortAffinity}'s exact
 * source-note overlap plus {@link withinBlockCohortDecayWeight}'s continuous
 * decay — are imported from `study-session/compose.ts`, which the ratified
 * shape already ships for the Today session. They are not restated here.
 *
 * ## The material-arrival cohort (`[D-149]`, `ol-v7r5.22`)
 *
 * `groupingScore` blends the cohort into relatedness exactly the way
 * `study-session/compose.ts`'s `withinBlockGroupingScore` does:
 * `blendedRelatedness = (1 - cohortWeight) * relatedness + cohortWeight *
 * cohortAffinity`, computed *before* the outer `(1 - proximity) *
 * blendedRelatedness + proximity * scopeMembership` blend — so F4.7's
 * stop-at-the-assessment rule still has final say over cohort placement
 * exactly as it already does over plain relatedness. The grain is exact
 * `ComposeQueueInput.conceptSourcePaths` overlap (that map's own doc explains
 * why it is caller-resolved rather than a new field on `QueueCandidate`); the
 * signal is `ComposeQueueInput.arrivalDays` (`ARRIVE-1`), continuous, never a
 * threshold or a stored flag. **No-op, provably, absent `arrivalDays`**: an
 * omitted map, or a concept missing from it, reads `arrivalDay: null`,
 * {@link withinBlockCohortDecayWeight} returns `0`, and `blendedRelatedness`
 * collapses to `relatedness` alone — byte-for-byte this module's behaviour
 * before this bead, the same posture `relatedConceptKeys`/`assessmentContext`
 * already have (see "No signal, no-op, provably" below). `block-order.spec.ts`
 * pins this equivalence explicitly.
 *
 * What IS rewritten is the scaffolding around them (grouping by course,
 * tie-banding, block ordering), because it has to operate over a different
 * row shape: `study-session`'s `ClassifiedRow` wraps a `GapRow` — one row,
 * one course, one concept, one `overdueDays` already classified upstream.
 * `QueueItem`/`QueueCandidate` describe an *instrument*, which may be
 * evidence for several concepts and belong to several courses at once
 * (R1/R2, `ol-t3sd`), and carries no obligation classification at all — only
 * a `SchedulerState`. Sharing one grouping function across both would mean
 * fabricating a `GapRow` for every instrument; reusing the two pure formulas
 * and rewriting the thin sort/band/block harness against this queue's own
 * shape is the honest alternative.
 *
 * ## The M:N-to-one convention
 *
 * F2.18's blocks and F2.19's bands both need one course and one concept per
 * item. This module reads `courses[0]` and `conceptIds[0]` — the same
 * reversible "first, in her authored order" convention `compose.ts`'s own
 * `DeferredInstrument.deferredBehind` and `queue-adapter.ts`'s `courseCodeOf`
 * already use for the identical M:N-collapses-to-one problem. Not a new rule
 * invented here.
 *
 * ## `[D-113]`'s overdue-first primacy stays structurally unoverridable
 *
 * F2.19 only ever reorders WITHIN an exact tie band — identical calendar
 * days late, the same equality `study-session/compose.ts` uses ("comparably
 * due", no invented fuzziness window) — never across one. A never-reviewed
 * ('new') item has no days-late figure at all and never joins a band; it
 * keeps the position plain FSRS order already gave it. Block order itself is
 * decided by the single most urgent due-state present in the block —
 * `overdue` beats `due` beats `new` — mirroring
 * `blockByCoursePresentation`'s "most urgent obligation class present" rule
 * with this queue's own three-value `dueState` standing in for
 * `ObligationClass`.
 *
 * ## No signal, no-op, provably
 *
 * With `relatedConceptKeys` and `assessmentContext` both omitted, every
 * item's score is `0`. `Array.prototype.sort` is stable, so a `0`-vs-`0`
 * comparison inside a tie band leaves the pre-existing FSRS order exactly
 * where it was — the same no-op proof `study-session/compose.ts`'s own doc
 * states for its version, and `block-order.spec.ts` pins it for this one.
 */

import { daysBetween } from '../dates.js';
import {
  withinBlockAssessmentProximity,
  withinBlockCohortAffinity,
  withinBlockCohortDecayWeight,
  withinBlockRelatedness,
} from '../study-session/compose.js';
import { type CalendarDay, calendarDayOfTimestamp } from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';
import type { QueueAssessmentContext, QueueCandidate, QueueItem } from './types.js';

/**
 * Due-state urgency, most urgent first — this queue's stand-in for
 * `study-session/compose.ts`'s `CLASS_PRECEDENCE`, over this queue's own
 * three-value `dueState` rather than the four obligation classes (`'early'`
 * is unreachable in v1 — see `compose.ts`'s `dueStateOf` — and is never
 * looked up here).
 */
const DUE_STATE_PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  overdue: 0,
  due: 1,
  new: 2,
});

export interface ApplyCourseBlockingInput {
  /** `composeQueue`'s already-selected, already-deduped offer list, in plain FSRS order. */
  readonly items: readonly QueueItem[];
  /** `instrumentId` -> the candidate it came from, for `courses`/`targetAssessmentPath`. */
  readonly candidatesById: ReadonlyMap<string, QueueCandidate>;
  /** The same instant `composeQueue` was called with — never a fresh clock read. */
  readonly now: Date;
  /** F2.19 — see `ComposeQueueInput.relatedConceptKeys`. */
  readonly relatedConceptKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  /** F2.19 — see `ComposeQueueInput.assessmentContext`. */
  readonly assessmentContext?: ReadonlyMap<VaultPath, QueueAssessmentContext>;
  /** `[D-149]` (`ol-v7r5.22`) — see `ComposeQueueInput.arrivalDays`. */
  readonly arrivalDays?: ReadonlyMap<string, CalendarDay>;
  /** `[D-149]` (`ol-v7r5.22`) — see `ComposeQueueInput.conceptSourcePaths`. */
  readonly conceptSourcePaths?: ReadonlyMap<string, readonly VaultPath[]>;
}

interface Placed {
  readonly item: QueueItem;
  readonly course: string;
  readonly conceptKey: string;
  readonly targetAssessmentPath: VaultPath | null;
  /**
   * Calendar days late, computed the same UTC-normalised way `compose.ts`'s
   * own `dueStateOf` classifies due/overdue — `null` for a never-reviewed
   * ('new') instrument, which never joins a tie band (see the module doc).
   */
  readonly overdueDays: number | null;
}

function placementOf(
  item: QueueItem,
  candidatesById: ReadonlyMap<string, QueueCandidate>,
  now: Date,
): Placed {
  const candidate = candidatesById.get(item.instrumentId);
  return {
    item,
    course: candidate?.courses[0] ?? '',
    conceptKey: item.conceptIds[0] ?? item.instrumentId,
    targetAssessmentPath: candidate?.targetAssessmentPath ?? null,
    overdueDays: item.priorState === null ? null : daysBetween(new Date(item.priorState.due), now),
  };
}

/**
 * F2.19's placement-affinity score for one item within its tie band — higher
 * sorts earlier. Same blend `study-session/compose.ts`'s
 * `withinBlockGroupingScore` states — `(1 - proximity) * blendedRelatedness +
 * proximity * scopeMembership`, where `blendedRelatedness` is itself
 * `(1 - cohortWeight) * relatedness + cohortWeight * cohortAffinity`
 * (`[D-149]`, `ol-v7r5.22` — see the module doc's "material-arrival cohort"
 * section) — built from the imported formulas rather than restated. `0` when
 * none of the optional maps are supplied.
 */
function groupingScore(
  placed: Placed,
  peers: readonly string[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, QueueAssessmentContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  conceptSourcePaths: ReadonlyMap<string, readonly VaultPath[]> | undefined,
  asOf: CalendarDay,
): number {
  const relatedness = withinBlockRelatedness(placed.conceptKey, peers, relatedConceptKeys);
  const cohortWeight = withinBlockCohortDecayWeight(
    arrivalDays?.get(placed.conceptKey) ?? null,
    asOf,
  );
  const cohortAffinity = withinBlockCohortAffinity(
    conceptSourcePaths?.get(placed.conceptKey) ?? [],
    peers,
    conceptSourcePaths ?? new Map(),
  );
  const blendedRelatedness = (1 - cohortWeight) * relatedness + cohortWeight * cohortAffinity;
  const context =
    placed.targetAssessmentPath !== null
      ? assessmentContext?.get(placed.targetAssessmentPath)
      : undefined;
  if (context === undefined) return blendedRelatedness;
  const proximity = withinBlockAssessmentProximity(context.dueDay, asOf);
  const scopeMembership = context.scopeConceptKeys.has(placed.conceptKey) ? 1 : 0;
  return (1 - proximity) * blendedRelatedness + proximity * scopeMembership;
}

/** F2.19: reorder one course's items within exact-`overdueDays` tie bands only — see the module doc. */
function withinBlockOrderForQueue(
  bucket: readonly Placed[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, QueueAssessmentContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  conceptSourcePaths: ReadonlyMap<string, readonly VaultPath[]> | undefined,
  asOf: CalendarDay,
): readonly Placed[] {
  const result: Placed[] = [];
  let i = 0;
  while (i < bucket.length) {
    const first = bucket[i];
    if (first === undefined) break;
    let j = i + 1;
    while (
      j < bucket.length &&
      first.overdueDays !== null &&
      bucket[j]?.overdueDays === first.overdueDays
    ) {
      j += 1;
    }
    const band = bucket.slice(i, j);
    if (band.length <= 1) {
      result.push(...band);
    } else {
      const keys = band.map((p) => p.conceptKey);
      const scored = band.map((p) => ({
        p,
        score: groupingScore(
          p,
          keys.filter((k) => k !== p.conceptKey),
          relatedConceptKeys,
          assessmentContext,
          arrivalDays,
          conceptSourcePaths,
          asOf,
        ),
      }));
      // Stable: equal scores (including the all-zero no-signal case) leave
      // the band in the order it already held.
      scored.sort((a, b) => b.score - a.score);
      result.push(...scored.map((s) => s.p));
    }
    i = j;
  }
  return result;
}

function bestPrecedence(bucket: readonly Placed[]): number {
  return bucket.reduce(
    (min, p) => Math.min(min, DUE_STATE_PRECEDENCE[p.item.selectionContext.dueState] ?? 2),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * F2.18/F2.19 over `composeQueue`'s finished offer list — see the module
 * doc. A pure reordering: same items, same length, never a different set.
 */
export function applyCourseBlocking(input: ApplyCourseBlockingInput): readonly QueueItem[] {
  const {
    items,
    candidatesById,
    now,
    relatedConceptKeys,
    assessmentContext,
    arrivalDays,
    conceptSourcePaths,
  } = input;
  if (items.length === 0) return items;

  // UTC calendar day of `now`, matching `compose.ts`'s own UTC-normalised
  // due arithmetic rather than `today/calendar-day.ts`'s local-zone reading
  // (that reading answers "what day did she experience", the wrong question
  // for queue ordering — see `dates.ts`'s own doc, quoted in `compose.ts`).
  const asOf = calendarDayOfTimestamp(now.toISOString()) ?? now.toISOString().slice(0, 10);

  const placed = items.map((item) => placementOf(item, candidatesById, now));

  const byCourse = new Map<string, Placed[]>();
  for (const p of placed) {
    const bucket = byCourse.get(p.course);
    if (bucket === undefined) byCourse.set(p.course, [p]);
    else bucket.push(p);
  }

  const ordered = new Map<string, readonly Placed[]>();
  for (const [course, bucket] of byCourse) {
    ordered.set(
      course,
      withinBlockOrderForQueue(
        bucket,
        relatedConceptKeys,
        assessmentContext,
        arrivalDays,
        conceptSourcePaths,
        asOf,
      ),
    );
  }

  const blocks = [...ordered.entries()].sort((a, b) => {
    const diff = bestPrecedence(a[1]) - bestPrecedence(b[1]);
    return diff !== 0 ? diff : a[0] < b[0] ? -1 : 1;
  });

  return blocks.flatMap(([, bucket]) => bucket.map((p) => p.item));
}
