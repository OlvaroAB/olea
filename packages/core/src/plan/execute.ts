/**
 * `executeStudyPlan` — C5.5's sentence, as a pure function.
 *
 * > "the Worker supplies the **policy** (weights, topic rankings) via the study
 * > plan (A2.5); core **executes** it against due instruments, exam proximity,
 * > and local mastery to produce today's ordered queue. Works offline from the
 * > cached plan. **This is the product.**"
 *
 * Two arguments, no network, no clock, no provider, no store: a composed queue
 * (which is itself pure — `queue/compose.ts`) and a plan that came off disk. If
 * this function needed anything else, "works offline from the cached plan"
 * would be a hope rather than a property, so the signature is the guarantee and
 * the tests assert it by supplying nothing else.
 *
 * ## The one thing it is for: `planVersion` reaches every record
 *
 * C7.6 is a single sentence — *"Study plans are versioned (A2.5), so review
 * events can record which plan selected them, as D7.1 requires"* — and this is
 * where that becomes true. `composeQueue` deliberately produces only the four
 * `selectionContext` fields the queue itself decides, leaving `planVersion` to
 * "the caller assembling a `ReviewLogRecord`" (`queue/types.ts`). Before this
 * module the only such caller was the plugin's adapter, which had nothing to
 * read and wrote `null`. Now the completion happens here, in core, from the
 * plan, for **every** offered item.
 *
 * "Every" is load-bearing and is asserted as such. An item whose concepts the
 * plan does not rank still carries the version, because the record's question is
 * *which plan was in force when this was offered* — and the honest answer for an
 * unranked concept is "this one, and it had no rank for you". That is a
 * different statement from `planVersion: null`, which means no plan existed at
 * all, and the Phase A→B checkpoint reads exactly this distinction.
 *
 * ## Ordering, and the line between this and P5-T07
 *
 * This module reorders. F2.8's **switch-on** — actually running her sessions
 * this way — is P5-T07, and it is not done here: nothing in `packages/plugin`
 * calls this function yet, so what she experiences is unchanged. The mechanism
 * and the decision to turn it on are deliberately separate, because the
 * switch-on is gated on a baseline window that has nothing to do with whether
 * the code works.
 *
 * ## Joining a queue item to the plan
 *
 * A queue item names concepts (`conceptIds`, her order, verbatim); the plan
 * names concepts per course. The join is by that name and nothing else, because
 * a verbatim display name is the only identity a concept has in v0.9 (knowledge
 * model §4) — the same Class B reading P5-T04 already stated and this module
 * inherits rather than re-decides.
 *
 * Two multiplicities have to be resolved, and both resolve toward *the strongest
 * claim the plan makes*:
 *
 * - An instrument may name several concepts (`ol-t3sd`). It takes the **best**
 *   of their planned entries: highest weight, and the lowest `rank` among those
 *   tied. An instrument that is evidence for a top-ranked concept is worth
 *   offering on that concept's account, whatever else it also covers.
 * - A concept may belong to several courses (M:N), and the plan ranks per
 *   course. Ranks are ordinals **within a course** and are meaningless across
 *   courses, so the comparison is by `weight` — which is why the artifact
 *   carries both and why they are not interchangeable.
 *
 * `examProximity` comes from the same winning entry rather than from the
 * minimum across all of them: a record whose yield rank and exam proximity came
 * from different concepts would describe a selection that never happened.
 *
 * ## Unranked items keep their order and follow (Class B)
 *
 * An item none of whose concepts the plan ranks sorts after every ranked one,
 * keeping the queue's own FSRS order among its peers. The alternative — leaving
 * them interleaved at their FSRS position — is defensible and is what a caller
 * who disagrees would change here; this default is chosen because the plan's
 * whole purpose is to say what is worth doing first, and a concept it never
 * ranked is one it has no evidence about. Neither reading is measured against
 * her real study rhythm, so this is a reversible default, not a finding.
 *
 * Note what does **not** change: nothing is dropped, and `deferred` passes
 * through untouched. F2.17's dedupe already decided what is offered; execution
 * only decides the order of what survived it.
 */

import type { SelectionContextV4, StudyPlanArtifact } from 'olea-contracts';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type { ComposedQueue, DeferredInstrument, QueueItem } from '../queue/types.js';
import type { SchedulerState } from '../scheduler/types.js';

/**
 * One item the plan has been executed over: everything `QueueItem` carries,
 * with a **complete** D7.1 selection context in place of the queue's partial
 * one.
 *
 * The field is typed `SelectionContextV4` — the frozen contract type itself,
 * not a local echo of it — so this object is exactly what a
 * `ReviewLogRecordInput` needs and a caller has nothing left to invent.
 */
export interface PlannedQueueItem {
  readonly instrumentId: string;
  readonly instrumentType: SchedulableInstrumentType;
  readonly conceptIds: readonly string[];
  readonly priorState: SchedulerState | null;
  /** Complete, ready to persist. `planVersion` is the plan's, or `null` when no plan was in force. */
  readonly selectionContext: SelectionContextV4;
  /**
   * The plan weight that placed this item, or `null` when the plan ranked none
   * of its concepts (or there was no plan).
   *
   * Not persisted into D7.1 — the record carries the ordinal `yieldRank`, which
   * is what the checkpoint compares — but surfaced here because "why is this
   * first" has to be answerable without recomputing the join, and because F2.8's
   * own scenario asks that each item's selection reason be available if she
   * asks.
   */
  readonly planWeight: number | null;
}

export interface ExecutedQueue {
  readonly items: readonly PlannedQueueItem[];
  /** Passed through unchanged: execution reorders, it never defers and never drops. */
  readonly deferred: readonly DeferredInstrument[];
  /** The plan that produced this order, or `null` — restated so a caller need not hold both. */
  readonly planVersion: string | null;
}

export interface ExecuteStudyPlanInput {
  readonly queue: ComposedQueue;
  /**
   * The cached plan, or `null` when none is cached. `null` is the Phase A
   * shape: the queue's own order, and `planVersion`, `yieldRank` and
   * `examProximity` all stated as explicit nulls.
   */
  readonly plan: StudyPlanArtifact | null;
}

/** The plan's claim about one concept, flattened across courses for lookup. */
interface PlannedEntry {
  readonly rank: number;
  readonly weight: number;
  readonly examProximityDays: number | null;
}

/**
 * `conceptId` → the plan's strongest claim about it.
 *
 * Built once per execution rather than searched per item: a plan has one entry
 * per concept per course and a queue has one item per concept per session, so
 * the naive nested scan is quadratic in exactly the numbers that grow together.
 */
function indexPlan(plan: StudyPlanArtifact): ReadonlyMap<string, PlannedEntry> {
  const index = new Map<string, PlannedEntry>();
  for (const course of plan.courses) {
    if (course.status !== 'ranked') continue;
    for (const concept of course.concepts) {
      const existing = index.get(concept.conceptId);
      if (existing !== undefined && !isStronger(concept, existing)) continue;
      index.set(concept.conceptId, {
        rank: concept.rank,
        weight: concept.weight,
        examProximityDays: concept.examProximityDays,
      });
    }
  }
  return index;
}

/** Higher weight wins; equal weight goes to the better (lower) ordinal. See the module doc on cross-course comparison. */
function isStronger(
  candidate: { readonly weight: number; readonly rank: number },
  incumbent: PlannedEntry,
): boolean {
  if (candidate.weight !== incumbent.weight) return candidate.weight > incumbent.weight;
  return candidate.rank < incumbent.rank;
}

/** The best planned entry across an item's concepts, or `null` if the plan ranked none of them. */
function bestEntryFor(
  item: QueueItem,
  index: ReadonlyMap<string, PlannedEntry>,
): PlannedEntry | null {
  let best: PlannedEntry | null = null;
  for (const conceptId of item.conceptIds) {
    const entry = index.get(conceptId);
    if (entry === undefined) continue;
    if (best === null || isStronger(entry, best)) best = entry;
  }
  return best;
}

/**
 * Execute a plan against a composed queue.
 *
 * Pure: same `(queue, plan)` in, same `ExecutedQueue` out, always. Neither
 * argument is mutated.
 */
export function executeStudyPlan(input: ExecuteStudyPlanInput): ExecutedQueue {
  const { queue, plan } = input;
  const planVersion = plan === null ? null : plan.planVersion;
  const index = plan === null ? new Map<string, PlannedEntry>() : indexPlan(plan);

  const placed = queue.items.map((item, order) => {
    const entry = bestEntryFor(item, index);
    const selectionContext: SelectionContextV4 = {
      dueState: item.selectionContext.dueState,
      // From the plan when it ranked one of this item's concepts; otherwise the
      // queue's own value, which is `null` and says "no prioritisation ran".
      examProximity: entry === null ? item.selectionContext.examProximity : entry.examProximityDays,
      yieldRank: entry === null ? item.selectionContext.yieldRank : entry.rank,
      instrumentTypesOffered: item.selectionContext.instrumentTypesOffered,
      // The clause this module exists for: the version reaches EVERY item,
      // ranked or not. See the module doc for why an unranked item still
      // carries it.
      planVersion,
    };
    return {
      order,
      entry,
      item: {
        instrumentId: item.instrumentId,
        instrumentType: item.instrumentType,
        conceptIds: item.conceptIds,
        priorState: item.priorState,
        selectionContext,
        planWeight: entry === null ? null : entry.weight,
      } satisfies PlannedQueueItem,
    };
  });

  // Ranked before unranked; among ranked, by the plan's weight; ties anywhere
  // fall back to the queue's own order, which is plain FSRS due order. Sorting a
  // copy, so the caller's queue is untouched.
  const ordered = [...placed].sort((a, b) => {
    if ((a.entry === null) !== (b.entry === null)) return a.entry === null ? 1 : -1;
    if (a.entry !== null && b.entry !== null && a.entry.weight !== b.entry.weight) {
      return b.entry.weight - a.entry.weight;
    }
    return a.order - b.order;
  });

  return {
    items: ordered.map(({ item }) => item),
    deferred: queue.deferred,
    planVersion,
  };
}
