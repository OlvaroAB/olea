/**
 * The session pipeline's one entry point (F2.5, F2.6, F2.14, F2.17, F6.1).
 *
 * ```
 *   VaultSource ──enumerate.ts──▶ VaultInstrumentRecord[]  ─┐
 *                                                            ├─▶ QueueCandidate[] (containment-filtered)
 *   review log ──history.ts──▶ entries ──replay.ts──▶ states ┘
 * ```
 *
 * Four modules, each testable alone, joined here and nowhere else.
 *
 * **`[SESS-8.6]` (`ol-egov.132.6`, `docs/dev/one-assembly-path.md` §4): this
 * function no longer composes a session.** Before this bead it ran
 * `../queue/compose.js`'s `composeQueue` over the enumerated, containment-
 * filtered candidates and returned the result as `ReviewSession.queue` —
 * that call, that field, and the `BuildReviewSessionInput` fields that fed it
 * alone (`filter`, `formatPreference`, `dedupeByConcept`, `servingPolicy`)
 * are gone, once `[SESS-8.4]` (row 4) moved the review tab off reading
 * `.queue` and nothing production read it anywhere else — see the design
 * note §2 for the argument (`buildComposedStudySession` is the one
 * composition now) and §4 for exactly what this row deletes, keeps and
 * moves. What survives is the KEPT half the design note names: the vault
 * enumeration and its by-id records, the containment-filtered candidate pool
 * (`candidates`/`containmentDropped`, still real — see below), the replay and
 * the suspension projection. A caller wanting a composed, servable session
 * now calls `../study-session/compose.js`'s `buildComposedStudySession` (or,
 * for the plugin's own held composition, reads the shared holder,
 * `packages/plugin/src/session/holder.ts`) — this function only ever
 * enumerates.
 *
 * `composeQueue` itself is not gone: `../queue/compose.js` still exists,
 * reduced to what its two remaining, non-production callers need — see that
 * module's own doc.
 *
 * ## What it does not do
 *
 * It does not order, prioritise, dedupe or filter beyond the containment rule
 * below. It does not read a clock: `now` is the caller's, same discipline as
 * `ScheduleInput.now`, so a caller's own composition over this enumeration is
 * deterministic and a replay of it is trustworthy. And it writes nothing at
 * all, into the vault or beside it.
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
 * ## C7.9's containment co-presence rule
 *
 * `containment.ts`'s `filterContainmentCoPresence` runs here, over the
 * enumerated candidates, so a broad-area concept and one of its own parts are
 * never both counted as "kept" by this enumeration (C7.9; register row 3.7).
 * `candidates`/`containmentDropped` feed `ReviewSession`'s own diagnostics
 * (`instrumentTypesOfferedAmong`, a candidate's replayed FSRS state) rather
 * than deciding what is served — that decision belongs to whichever composer
 * a caller runs over this enumeration, and `study-session/compose.ts`'s own
 * `applyContainmentCoPresence` (`[SESS-11]`, `ol-egov.132.12`) is the one
 * that now enforces C7.9 on what is actually served, wired to a real edge set
 * by `[SESS-8.6]` at `session-builder/provider.ts`'s `composedInput`.
 *
 * `input.relations` omitted means no edges, a real no-op rather than a
 * degraded mode — the same posture this field has always documented.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { AssessmentConceptContext } from '../assessment/scope-concept-keys.js';
import { resolveAssessmentGroupingContext } from '../assessment/scope-concept-keys.js';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptRelation } from '../concept/relation.js';
import { daysBetween } from '../dates.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type { QueueCandidate, QueueItem, QueueSelectionContext } from '../queue/types.js';
import { suspendedInstrumentIds } from '../review-log/suspension.js';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import type { StudySessionItem } from '../study-session/build.js';
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
  /**
   * `part-of` edges available at composition time (C7.9; register row 3.7;
   * `./containment.js`). Omitted means none, which is a real no-op, not a
   * degraded mode. Edge types other than `part-of` are ignored rather than
   * rejected, so a caller holding a whole `RelationSet`'s served edges may
   * pass them through unfiltered.
   */
  readonly relations?: readonly ConceptRelation[];
  /**
   * F2.19 (`ol-vr8z`): assessment records, resolved (together with this
   * call's own `instruments.concepts` enumeration) into the
   * `assessmentContext` map `targetAssessmentPathIndex` reads. Omitted means
   * no assessment-scope signal, a real no-op, not a degraded mode — same
   * posture `relations` above documents.
   *
   * The source, via `targetAssessmentPathIndex`, for each candidate's own
   * `QueueCandidate.targetAssessmentPath` (`ol-f3qu`) — without this,
   * `assessmentContext` was resolved but nothing joined against it. See
   * `toQueueCandidate`'s doc.
   */
  readonly assessments?: readonly AssessmentRecord[];
}

export interface ReviewSession {
  /** Everything the walk found, including what it refused and why. */
  readonly instruments: VaultInstrumentEnumeration;
  /**
   * Every enumerated instrument, in enumeration order, **after** the C7.9
   * containment co-presence filter — see this file's module doc. Exposed for
   * diagnostics (`instrumentTypesOfferedAmong`, a candidate's replayed FSRS
   * state) and for the Today panel's legacy count; it does not decide what is
   * served — see the module doc for which composer does.
   */
  readonly candidates: readonly QueueCandidate[];
  /**
   * Candidates the C7.9 containment co-presence filter dropped from
   * `candidates` (`./containment.js`) — empty whenever `input.relations` is
   * omitted. Reported rather than folded silently into `candidates`' absence,
   * the same posture `instruments.unbound` already takes.
   */
  readonly containmentDropped: readonly QueueCandidate[];
  /** Replayed scheduling state, by instrument id. Absent means never reviewed. */
  readonly replay: ReplayResult;
  /** F2.6's projection over the whole log. */
  readonly suspended: ReadonlySet<string>;
  /** The entries the replay and the projection were built from. */
  readonly entries: readonly ReviewLogEntry[];
  /** `instrumentId` -> record, so a caller rendering a composer's chosen items does not re-scan. */
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
 * Walk the vault, replay the log, enumerate what a composer could draw from.
 *
 * The single call a plugin, a panel or a harness makes to get an enumeration
 * — see this file's module doc for why it no longer composes a session
 * itself. Everything it returns is plain data.
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

  // F2.19 (`ol-vr8z`/`ol-f3qu`): resolved against the same
  // `instruments.concepts` enumeration this call already produced above — no
  // second vault walk. An empty `input.assessments` reads identically to it
  // being omitted (`block-order.ts`'s own no-op proof), so this is
  // unconditional.
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

  const recordsById = new Map(instruments.records.map((record) => [record.instrumentId, record]));

  return {
    instruments,
    candidates,
    containmentDropped: containment.dropped,
    replay,
    suspended,
    entries,
    recordsById,
  };
}

/**
 * `dueState` for one instrument the study-session composer already chose, at
 * `now` — the same three-way math `../queue/compose.js`'s private `dueStateOf`
 * uses, widened to answer `'early'` rather than excluding the instrument.
 *
 * `composeQueue` only ever offers a due-or-overdue instrument, so `dueStateOf`
 * documents `'early'` as "deliberately unreachable in v1". The study-session
 * composer is not so restricted — SESS-2's baseline/elective obligation
 * classes (`study-session/compose.ts`) can and do choose a concept ahead of
 * its FSRS due day — so an item this function is asked about may genuinely be
 * early, and stating that honestly is the point: mislabelling it `'due'`
 * would be a false claim about what the composer actually decided.
 */
function composedDueState(
  state: SchedulerState | null,
  now: Date,
): QueueSelectionContext['dueState'] {
  if (state === null) return 'new';
  const daysLate = daysBetween(new Date(state.due), now);
  if (daysLate < 0) return 'early';
  return daysLate === 0 ? 'due' : 'overdue';
}

/**
 * D7.1's `instrumentTypesOffered` for one item the study-session composer
 * chose: every type of an instrument in `candidates` sharing at least one of
 * `conceptIds`, in `candidates`' own order — the same question and the same
 * formula `../queue/compose.js`'s private `instrumentTypesOfferedFor` answers
 * for `composeQueue`'s own offer.
 *
 * `candidates` here is the KEPT enumeration `buildReviewSession` still
 * produces (every schedulable instrument in scope, post-containment-filter,
 * pre-selection) rather than `compose.ts`'s narrower due-only "eligible" set:
 * with `'early'` reachable ({@link composedDueState}), "eligible" no longer
 * means "due", so the honest answer to "what else could this concept have
 * offered" is read off the whole kept set.
 */
function instrumentTypesOfferedAmong(
  ownType: SchedulableInstrumentType,
  conceptIds: readonly string[],
  candidates: readonly QueueCandidate[],
): SchedulableInstrumentType[] {
  const concepts = new Set(conceptIds);
  const types: SchedulableInstrumentType[] = [];
  for (const candidate of candidates) {
    if (!candidate.conceptIds.some((conceptId) => concepts.has(conceptId))) continue;
    if (!types.includes(candidate.instrumentType)) types.push(candidate.instrumentType);
  }
  return types.length > 0 ? types : [ownType];
}

export interface ComposedSessionQueueItemsInput {
  /** The study-session composer's own ordered rows — never reordered here. */
  readonly items: readonly StudySessionItem[];
  /** `ReviewSession.recordsById` — the kept enumeration's `conceptIds` per instrument. */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
  /** `ReviewSession.candidates` — the kept enumeration's FSRS state per instrument, and {@link instrumentTypesOfferedAmong}'s own set. */
  readonly candidates: readonly QueueCandidate[];
  /** The same instant the composition and the enumeration were both read at. */
  readonly now: Date;
}

/**
 * `[SESS-8.4]` (`ol-egov.132.4`, `docs/dev/one-assembly-path.md` row 4):
 * translates the study-session composer's own ordered `StudySessionItem[]`
 * into the `QueueItem[]` shape `../plan/execute.js`'s
 * `executeStudyPlanOverComposedRows` joins against the plan.
 *
 * `StudySessionItem` carries no `conceptIds`/`priorState`/`selectionContext`
 * at all — the study-session composer never touches FSRS scheduling state
 * (`plan/execute.ts`'s own module doc, "Why the input is `QueueItem[]`, not
 * literally `StudySessionItem[]`") — so every field this produces is read off
 * the SAME kept enumeration `buildReviewSession` already produced for this
 * call (`recordsById` for `conceptIds`, `candidates` for FSRS `state`), never
 * a second vault walk or a second replay.
 *
 * **Order is exactly `items`' own order.** This function never reorders,
 * never drops and never adds a row — selection and order are the study-session
 * composer's decision alone (C5.7, F6.4); this only fills in the per-item
 * facts a plan join needs.
 *
 * `dedupeReason` is threaded straight through from `item.dedupeReason`
 * (`[SESS-8.9]`, `ol-egov.132.9`), never recomputed here: the study-session
 * composer's own per-concept selection now runs `[D-240]` item 2's same
 * shared override (`ol-2zfj.71` [SESS-7]'s `recallOutranksFormatPreference`,
 * called from `../study-session/build.ts`'s `orderedForFormat`) that
 * `composeQueue`'s `dedupeRank` runs, so it has exactly `[SESS-6]`'s reason
 * to attach when it fires — `'recall-overdue'` — and the study-session
 * composer already decided whether it fired (see
 * {@link StudySessionItem.dedupeReason}'s own doc); recomputing it here
 * would risk it disagreeing with the order this function's own `items`
 * argument already reflects. `undefined` passes through unchanged, the same
 * "state the absence" posture {@link QueueItem.dedupeReason}'s own doc
 * already takes for the ordinary case.
 *
 * A `StudySessionItem` naming an `instrumentId` absent from `recordsById`
 * would mean the composer's own enumeration and this call's kept one
 * disagreed about what the vault holds, even though both are built from the
 * same walk within one `openReviewSession` call — an inconsistency worth
 * failing loudly on rather than silently dropping the row.
 */
export function queueItemsFromComposedSession(
  input: ComposedSessionQueueItemsInput,
): readonly QueueItem[] {
  const candidatesById = new Map(
    input.candidates.map((candidate) => [candidate.instrumentId, candidate]),
  );

  return input.items.map((item): QueueItem => {
    const record = input.recordsById.get(item.instrumentId);
    if (record === undefined) {
      throw new Error(
        `queueItemsFromComposedSession: composed item's instrument "${item.instrumentId}" is not in the kept enumeration`,
      );
    }
    const state = candidatesById.get(item.instrumentId)?.state ?? null;
    const selectionContext: QueueSelectionContext = {
      dueState: composedDueState(state, input.now),
      // v1's honest "we did not rank this" answer — see `QueueSelectionContext`'s
      // own doc. `executeStudyPlanOverComposedRows` overrides both when the
      // cached plan ranks one of `record.conceptIds`, and leaves them exactly
      // as given otherwise.
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: instrumentTypesOfferedAmong(
        item.instrumentType,
        record.conceptIds,
        input.candidates,
      ),
    };
    return {
      instrumentId: item.instrumentId,
      instrumentType: item.instrumentType,
      conceptIds: record.conceptIds,
      priorState: state,
      selectionContext,
      ...(item.dedupeReason !== undefined ? { dedupeReason: item.dedupeReason } : {}),
    };
  });
}
