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
 * The two formulas that are F2.19's actual substance —
 * {@link withinBlockRelatedness}'s adjacency fraction and
 * {@link withinBlockAssessmentProximity}'s `[D-110]` half-life decay — are
 * imported from `study-session/compose.ts`, which the ratified shape already
 * ships for the Today session. They are not restated here.
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
 * `withinBlockGroupingScore` states — `(1 - proximity) * relatedness +
 * proximity * scopeMembership` — built from the two imported formulas rather
 * than restated. `0` when neither optional map is supplied.
 */
function groupingScore(
  placed: Placed,
  peers: readonly string[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, QueueAssessmentContext> | undefined,
  asOf: CalendarDay,
): number {
  const relatedness = withinBlockRelatedness(placed.conceptKey, peers, relatedConceptKeys);
  const context =
    placed.targetAssessmentPath !== null
      ? assessmentContext?.get(placed.targetAssessmentPath)
      : undefined;
  if (context === undefined) return relatedness;
  const proximity = withinBlockAssessmentProximity(context.dueDay, asOf);
  const scopeMembership = context.scopeConceptKeys.has(placed.conceptKey) ? 1 : 0;
  return (1 - proximity) * relatedness + proximity * scopeMembership;
}

/** F2.19: reorder one course's items within exact-`overdueDays` tie bands only — see the module doc. */
function withinBlockOrderForQueue(
  bucket: readonly Placed[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, QueueAssessmentContext> | undefined,
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
  const { items, candidatesById, now, relatedConceptKeys, assessmentContext } = input;
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
      withinBlockOrderForQueue(bucket, relatedConceptKeys, assessmentContext, asOf),
    );
  }

  const blocks = [...ordered.entries()].sort((a, b) => {
    const diff = bestPrecedence(a[1]) - bestPrecedence(b[1]);
    return diff !== 0 ? diff : a[0] < b[0] ? -1 : 1;
  });

  return blocks.flatMap(([, bucket]) => bucket.map((p) => p.item));
}
