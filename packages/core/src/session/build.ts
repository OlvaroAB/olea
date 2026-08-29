/**
 * The session pipeline's one entry point (F2.5, F2.6, F2.14, F2.17, F6.1).
 *
 * ```
 *   VaultSource ──enumerate.ts──▶ VaultInstrumentRecord[]  ─┐
 *                                                            ├─▶ QueueCandidate[] ──composeQueue──▶ ComposedQueue
 *   review log ──history.ts──▶ entries ──replay.ts──▶ states ┘        (suspension.ts excludes)
 * ```
 *
 * Four modules, each testable alone, joined here and nowhere else. What this
 * function adds beyond wiring is the one thing a caller cannot do afterwards:
 * it returns **both** the composed queue and the enumerated records, so
 * rendering what the queue chose does not mean walking the vault a second time
 * with a second enumeration that can disagree about what exists.
 *
 * ## What it does not do
 *
 * It does not order, prioritise, dedupe or filter — `composeQueue` does all
 * four and this passes its arguments through untouched. It does not read a
 * clock: `now` is the caller's, same discipline as `ScheduleInput.now` and
 * `ComposeQueueInput.now`, so a composed session is deterministic and a replay
 * of it is trustworthy. And it writes nothing at all, into the vault or beside
 * it.
 *
 * ## Suspension comes from the whole log, deliberately
 *
 * `suspendedInstrumentIds` is folded over every entry this read produced, not
 * over a window. `today/data-source.ts` explains the asymmetry from the other
 * side: a suspend from last term is outside any trailing window, and a
 * projection that forgot it would put an instrument she stopped studying back
 * in front of her. This is the component F2.6's scenarios mean when they say
 * "the queue reads the full history".
 *
 * ## C7.9's containment co-presence rule, and the plumbing gap it exposes
 *
 * `containment.ts`'s `filterContainmentCoPresence` runs here, over `candidates`
 * and before `composeQueue`, so a broad-area concept and one of its own parts
 * are never composed into the same session (C7.9; register row 3.7). It is a
 * real filter with a real caller — this function — not a dangling helper.
 *
 * **What it is not, yet: reachable with a live edge set in production.**
 * `input.relations` is optional and every real caller omits it today, which
 * makes the filter a no-op everywhere it currently runs. The edges the rule
 * needs are produced — `WorkerConceptReader`'s per-document read emits
 * `part-of` on every pass (component register row 1.2) — but nothing threads
 * them here:
 *
 *   - `packages/plugin/src/main.ts:184` holds the live fold as
 *     `OleaPlugin.relations` (a `RelationSet`, populated at
 *     `main.ts:584` on every ingestion-session close), and it is read by
 *     nothing (component register row 1.2a's "read by nothing" finding,
 *     unchanged by this bead).
 *   - `packages/plugin/src/review/open-session.ts:199` calls
 *     `buildReviewSession` — the real "Olea: Start today's review" command —
 *     without a `relations` argument.
 *   - `packages/plugin/src/today/data-source.ts:240` calls it a second time,
 *     for the Today panel's count, also without one.
 *
 * Closing that gap means passing `servedRelations(this.relations)` (or
 * equivalent) from `main.ts` through both call sites above, all three of
 * which sit outside `packages/core/src/session/`'s ownership for this bead.
 * Nothing here invents a new persisted store to work around that — `edges`
 * stays an explicit, transient parameter, matching every other model-derived
 * value this package accepts rather than caches.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { AssessmentConceptContext } from '../assessment/scope-concept-keys.js';
import { resolveAssessmentGroupingContext } from '../assessment/scope-concept-keys.js';
import type { AssessmentRecord } from '../assessment/types.js';
import { resolveRelatedConceptKeys } from '../concept/related-concept-keys.js';
import type { ConceptRelation } from '../concept/relation.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import { composeQueue } from '../queue/compose.js';
import type { ComposedQueue, QueueCandidate, QueueFilter } from '../queue/types.js';
import { suspendedInstrumentIds } from '../review-log/suspension.js';
import type { Scheduler } from '../scheduler/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { filterContainmentCoPresence } from './containment.js';
import type { EnumerateVaultInstrumentsOptions } from './enumerate.js';
import { enumerateVaultInstruments } from './enumerate.js';
import type { ReadReviewLogHistoryOptions } from './history.js';
import { readReviewLogHistory } from './history.js';
import type { ReplayResult } from './replay.js';
import { replaySchedulerStates } from './replay.js';
import type { VaultInstrumentEnumeration, VaultInstrumentRecord } from './types.js';

export interface BuildReviewSessionInput {
  readonly vault: VaultSource;
  /** Replays the log. Its purity is what makes rebuilt state trustworthy — see `replay.ts`. */
  readonly scheduler: Scheduler;
  /** The instant the session is composed. Always the caller's, never a clock read here. */
  readonly now: Date;
  /** F2.5. Omitted means no filter. */
  readonly filter?: QueueFilter;
  /**
   * Review-log entries the caller already holds. When given, **no log is
   * read** — the whole function becomes pure apart from reading notes.
   *
   * This is the seam a harness uses to compose against a history that lives
   * somewhere other than `.olea/reviews/`: it reads that history itself and
   * hands the parsed records over, so core never learns another namespace
   * exists and no writer is pointed anywhere new.
   */
  readonly entries?: readonly ReviewLogEntry[];
  /** Passed to `readReviewLogHistory` when `entries` is not given. */
  readonly reviewLog?: ReadReviewLogHistoryOptions;
  /** Restrict the vault walk to a subtree. */
  readonly under?: VaultPath;
  /** Passed straight to `enumerateVaultInstruments` — including the D-030 id seam. */
  readonly instruments?: Omit<EnumerateVaultInstrumentsOptions, 'under'>;
  /** F2.17's format preference, injected. Omitted means none — see `ComposeQueueInput`. */
  readonly formatPreference?: readonly SchedulableInstrumentType[];
  /** F2.17's per-session dedupe. Defaults to `true`, as `composeQueue` does. */
  readonly dedupeByConcept?: boolean;
  /**
   * `part-of` edges available at composition time (C7.9; register row 3.7;
   * `./containment.js`). Omitted means none, which is a real no-op, not a
   * degraded mode — see this file's module doc for exactly what still has to
   * be wired before a real caller can pass one. Edge types other than
   * `part-of` are ignored rather than rejected, so a caller holding a whole
   * `RelationSet`'s served edges may pass them through unfiltered.
   */
  readonly relations?: readonly ConceptRelation[];
  /**
   * F2.19 (`ol-vr8z`): assessment records this function resolves — together
   * with `relations` above and its own `instruments.concepts` enumeration —
   * into `composeQueue`'s `relatedConceptKeys`/`assessmentContext` maps via
   * `resolveRelatedConceptKeys`/`resolveAssessmentGroupingContext`. This
   * function does the resolution itself rather than taking the two maps
   * pre-resolved, so a caller never has to enumerate concepts a second time
   * just to join against them (`ol-ua0i`'s hand-back, option (b)). Omitted
   * means no assessment-scope signal, a real no-op (`block-order.ts`'s
   * doc), not a degraded mode — same posture `relations` already documents.
   *
   * Also the source, via `targetAssessmentPathIndex`, for each candidate's
   * own `QueueCandidate.targetAssessmentPath` (`ol-f3qu`) — without this,
   * `assessmentContext` was resolved but nothing joined against it, so
   * `block-order.ts`'s scope-matching half of F2.19 silently scored `0` on
   * this path regardless of what was passed here. See `toQueueCandidate`'s
   * doc.
   */
  readonly assessments?: readonly AssessmentRecord[];
}

export interface ReviewSession {
  /** What is offered and what was due and deferred (F2.17). */
  readonly queue: ComposedQueue;
  /** Everything the walk found, including what it refused and why. */
  readonly instruments: VaultInstrumentEnumeration;
  /**
   * The candidates handed to `composeQueue`, in enumeration order —
   * **after** the C7.9 containment co-presence filter, so this is exactly
   * what `composeQueue` saw. Exposed for diagnostics and for the Today
   * panel's count.
   */
  readonly candidates: readonly QueueCandidate[];
  /**
   * Candidates the C7.9 containment co-presence filter dropped before
   * `composeQueue` ran (`./containment.js`) — empty whenever `input.relations`
   * is omitted, which is every real caller today. Reported rather than folded
   * silently into `candidates`' absence, the same posture `instruments.unbound`
   * and `queue.deferred` already take.
   */
  readonly containmentDropped: readonly QueueCandidate[];
  /** Replayed scheduling state, by instrument id. Absent means never reviewed. */
  readonly replay: ReplayResult;
  /** F2.6's projection over the whole log. */
  readonly suspended: ReadonlySet<string>;
  /** The entries the replay and the projection were built from. */
  readonly entries: readonly ReviewLogEntry[];
  /** `instrumentId` -> record, so a caller rendering `queue.items` does not re-scan. */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
}

/**
 * The queue's half of a record. The renderer's half stays on the record and
 * never reaches composition.
 *
 * `targetAssessmentPathByConceptKey` (`ol-f3qu`) is the reverse index
 * {@link targetAssessmentPathIndex} builds from `resolveAssessmentGroupingContext`'s
 * output — omitted entirely, this reads as "no known target assessment" for
 * every candidate, exactly the prior behaviour. Looked up by
 * `record.conceptIds[0]`, the same "first concept, her authored order"
 * M:N-to-one convention `queue/block-order.ts`'s own `placementOf` already
 * uses for the identical join (`placed.conceptKey`), so the key produced here
 * is the key that consumer will actually look up.
 */
export function toQueueCandidate(
  record: VaultInstrumentRecord,
  replay: ReplayResult,
  targetAssessmentPathByConceptKey?: ReadonlyMap<string, VaultPath>,
): QueueCandidate {
  const conceptKey = record.conceptIds[0];
  return {
    instrumentId: record.instrumentId,
    instrumentType: record.instrumentType,
    conceptIds: record.conceptIds,
    courses: record.courses,
    state: replay.states.get(record.instrumentId)?.state ?? null,
    targetAssessmentPath:
      (conceptKey !== undefined ? targetAssessmentPathByConceptKey?.get(conceptKey) : undefined) ??
      null,
  };
}

/**
 * F2.19 (`ol-f3qu`): the reverse of `assessmentContext`'s scope membership —
 * for each concept key an assessment's resolved scope names, which single
 * assessment {@link toQueueCandidate} should record as that concept's
 * `targetAssessmentPath`. Built entirely from `resolveAssessmentGroupingContext`'s
 * already-resolved output (no new vault read, and deliberately not the
 * oracle's edge-weighted equivalent — `gap/build.ts`'s `contributions[0]` —
 * which comes from `evidence-edge/build.ts`'s tier-3 past-paper walk;
 * `oracle/compose.ts`'s own doc is explicit that walk is not for every
 * render, which the plain queue path does).
 *
 * A concept named in more than one assessment's scope (rare, but possible —
 * a topic on both a midterm and a final) resolves by soonest known `dueDay`
 * first, ties by `VaultPath` ascending — the same tie-break convention
 * `oracle/rank.ts` already uses for `contributions`, applied here because
 * `withinBlockAssessmentProximity` is driven purely by `dueDay` (nearer
 * scores higher, `null` scores `0`), so the soonest assessment is the one
 * whose selection actually changes anything; when nothing has a known due
 * day the tie-break is for determinism only. Zero free parameters, no
 * corpus fitting — a deterministic index over data already in hand.
 */
function targetAssessmentPathIndex(
  assessmentContext: ReadonlyMap<VaultPath, AssessmentConceptContext>,
): ReadonlyMap<string, VaultPath> {
  const bestByConceptKey = new Map<string, { path: VaultPath; dueDay: string | null }>();
  for (const [path, context] of assessmentContext) {
    for (const conceptKey of context.scopeConceptKeys) {
      const current = bestByConceptKey.get(conceptKey);
      if (current === undefined || isSoonerTarget({ path, dueDay: context.dueDay }, current)) {
        bestByConceptKey.set(conceptKey, { path, dueDay: context.dueDay });
      }
    }
  }
  const index = new Map<string, VaultPath>();
  for (const [conceptKey, best] of bestByConceptKey) index.set(conceptKey, best.path);
  return index;
}

/** `true` when `candidate` should win {@link targetAssessmentPathIndex}'s tie over `current` — see that function's doc. */
function isSoonerTarget(
  candidate: { readonly path: VaultPath; readonly dueDay: string | null },
  current: { readonly path: VaultPath; readonly dueDay: string | null },
): boolean {
  if (candidate.dueDay !== current.dueDay) {
    if (candidate.dueDay === null) return false;
    if (current.dueDay === null) return true;
    // `CalendarDay` is `YYYY-MM-DD`, lexical order is chronological order —
    // see `today/calendar-day.ts`'s own doc for why that format was chosen.
    return candidate.dueDay < current.dueDay;
  }
  return candidate.path < current.path;
}

/**
 * Walk the vault, replay the log, compose today's session.
 *
 * The single call a plugin, a panel or a harness makes. Everything it returns
 * is plain data.
 */
export async function buildReviewSession(input: BuildReviewSessionInput): Promise<ReviewSession> {
  const instruments = await enumerateVaultInstruments(input.vault, {
    ...(input.instruments ?? {}),
    ...(input.under !== undefined ? { under: input.under } : {}),
  });

  const entries =
    input.entries ?? (await readReviewLogHistory(input.vault, input.reviewLog ?? {})).entries;

  const replay = replaySchedulerStates(entries, input.scheduler);
  const suspended = suspendedInstrumentIds(entries);

  // F2.19 (`ol-vr8z`/`ol-f3qu`): resolve both signal maps here, against the
  // same `instruments.concepts` enumeration this call already produced above
  // — no second vault walk. Both resolvers accept an empty input array and
  // return an empty map, which `block-order.ts` already proves reads
  // identically to the map being omitted entirely, so passing them
  // unconditionally (rather than spreading on definedness, as `filter`/
  // `formatPreference`/`dedupeByConcept` do above) changes nothing when
  // `input.relations`/`input.assessments` are both omitted. Resolved BEFORE
  // `toQueueCandidate` runs (moved up from after, `ol-f3qu`) because
  // `assessmentContext` is also `targetAssessmentPathIndex`'s input, and a
  // candidate needs its `targetAssessmentPath` set at construction — neither
  // resolver reads `candidates`, so the reorder changes nothing else.
  const { relatedConceptKeys } = resolveRelatedConceptKeys(
    input.relations ?? [],
    instruments.concepts,
  );
  const { assessmentContext } = resolveAssessmentGroupingContext(
    input.assessments ?? [],
    instruments.concepts,
  );
  const targetAssessmentPathByConceptKey = targetAssessmentPathIndex(assessmentContext);

  const enumeratedCandidates = instruments.records.map((record) =>
    toQueueCandidate(record, replay, targetAssessmentPathByConceptKey),
  );
  const containment = filterContainmentCoPresence(
    enumeratedCandidates,
    input.relations ?? [],
    instruments.concepts,
  );
  const candidates = containment.candidates;

  const queue = composeQueue({
    candidates,
    now: input.now,
    suspended,
    ...(input.filter !== undefined ? { filter: input.filter } : {}),
    ...(input.formatPreference !== undefined ? { formatPreference: input.formatPreference } : {}),
    ...(input.dedupeByConcept !== undefined ? { dedupeByConcept: input.dedupeByConcept } : {}),
    relatedConceptKeys,
    assessmentContext,
  });

  const recordsById = new Map(instruments.records.map((record) => [record.instrumentId, record]));

  return {
    queue,
    instruments,
    candidates,
    containmentDropped: containment.dropped,
    replay,
    suspended,
    entries,
    recordsById,
  };
}
