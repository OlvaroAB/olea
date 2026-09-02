/**
 * From a composed session to what the review view renders (F2.14, F2.15, F2.17, D7.1).
 *
 * `types.ts` has said since P2-T08 that `ReviewQueueItem` is "what that composer
 * is expected to hand the view once it exists", and that until then callers
 * build the array by hand. The composer exists now (`olea-core`'s
 * `buildReviewSession`), and this file is the join it was waiting for: queue
 * items in, presentation shapes out.
 *
 * ## Three things this adapter is forbidden to do
 *
 * **It does not decide what is offered.** The order, the dedupe, the filter and
 * the due-state are all decided in core and arrive settled. This walks
 * `queue.items` in the order it was given and never reorders, drops or adds.
 *
 * **It does not invent a selection context.** `QueueSelectionContext` carries
 * `yieldRank: null` and `examProximity: null` as *statements* — D7.1's own doc
 * is explicit that recording them as explicit nulls is what makes the Phase A
 * baseline and the Phase B comparison the same shape. This fills the one
 * context field the queue does not own (`planVersion`, null until P5 publishes
 * a plan) with a null for the same reason, and copies the queue's four through
 * untouched. An adapter that guessed here would quietly become the thing the
 * A→B checkpoint measures.
 *
 * `masteryAtTime` is not in the context at all since `ol-g6zg`: it moved onto
 * the record, keyed by `conceptIds`. It is still not the adapter's to know —
 * C5.4's rollup (`ol-p4t06`) does not exist yet — so nothing here writes it,
 * and an absent field says "not recorded", which is the true statement.
 *
 * **It does not cache a presentation.** `presentMcq` runs on every adaptation,
 * because F2.15's sampling is per *showing*: three distractors drawn from the
 * pool and all four positions shuffled, so that meeting the same item a second
 * time still tests the answer rather than where the answer sat last time.
 * Sampling once per instrument and reusing it would satisfy the type and
 * defeat the requirement.
 *
 * ## `adaptExecutedReviewQueue` — P5-T07's addition, `adaptReviewQueue` untouched
 *
 * `adaptReviewQueue`'s `toSelectionContext` states `planVersion: null` because
 * until P5-T07, nothing upstream of it could have produced anything else — no
 * caller executed a queue against a plan. That is no longer true for
 * `open-session.ts`, which now runs `olea-core`'s `executeStudyPlan` before
 * adapting, and `executeStudyPlan`'s `PlannedQueueItem` already carries a
 * *complete* `SelectionContextV4` (planVersion included, from the plan when
 * one ranked the item and stated `null` — not omitted — when none did, exactly
 * the same "state the absence" discipline this file's own doc describes).
 * Rebuilding that object here a second time would either duplicate
 * `executeStudyPlan`'s join or, worse, silently overwrite its `planVersion`
 * with the hard-coded `null` above — which is precisely what would have
 * happened had this file's *existing* export been pointed at planned items
 * instead of composed ones.
 *
 * So this is a second, additive function rather than a signature change to
 * `adaptReviewQueue`: `packages/workbench` calls the original with a raw
 * `ComposedQueue` and is untouched by this bead (out of this lane's file
 * ownership), and `open-session.ts` calls the new one with an executed
 * queue's items. Both share every presentation helper below; only which
 * `selectionContext` reaches the view differs.
 *
 * ## Row 3.9's chooser, threaded here rather than in `queue/compose.ts` ([SUPP-3], `ol-lpl4`)
 *
 * `study-session/build.ts` already folds a concept's review history through
 * `chooseSupportLevel` at COMPOSITION time (`[SUPP-2]`, `ol-95vv.4`), but this
 * queue has a different production caller downstream: `open-session.ts` always
 * runs `composeQueue`'s output through `plan/execute.ts`'s `executeStudyPlan`
 * before it ever reaches an adapter, and that module rebuilds `PlannedQueueItem`
 * from an explicit field list rather than a spread (`{ instrumentId, ...,
 * planWeight }` — see its own source) — it is out of this lane's ownership, and
 * any field added to `QueueItem` in `queue/compose.ts` would be silently
 * dropped there before `adaptExecutedReviewQueue` ever saw it. Computing the
 * decision here, in ADAPTATION, sidesteps that: `PlannedQueueItem` (and
 * `QueueItem`) both carry `instrumentType`/`conceptIds` verbatim regardless,
 * which is all {@link supportLevelForRecord} needs.
 *
 * {@link buildSupportLevelHistoryLookup} is this queue's equivalent of what
 * `session-builder/provider.ts` demonstrates for the F4.6 preview path
 * (folding `readReviewLogHistory`'s entries through `deriveFailureShape`) —
 * built from raw `ReviewLogEntry[]`, which `buildReviewSession`'s own return
 * shape (`ReviewSession.entries`, `packages/core/src/session/build.ts`)
 * already carries, so the live caller has this data in hand without a second
 * vault read. Wiring `open-session.ts` to actually pass it is outside this
 * lane's ownership — see that file's hand-back note in the lane report.
 *
 * ## `createFrozenReviewQueue` — C5.8's freeze (`ol-v7r5.35`, `[D-193]`)
 *
 * Both adapters above are pure `input -> ReviewQueueItem[]` maps with no
 * memory of a prior call — correct for a one-shot read, but C5.8's "the
 * session holds still" cannot be discharged by a stateless function; it
 * needs something that remembers what a session already showed her and
 * refuses to let a fresh read move it. `createFrozenReviewQueue`, near the
 * bottom of this file, is that something — see its own section doc for the
 * three verbs (`open`/`extend`/`close`) and how it reuses `rebuild-
 * controller.ts`'s `SittingState`/`decideRebuild` rather than a second freeze
 * mechanism invented here.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  ComposedQueue,
  GradedReviewEvidence,
  McqInstrumentRecord,
  PlannedQueueItem,
  QueueItem,
  RandomSource,
  SchedulableInstrumentType,
  SelfAssessmentFeeling,
  SessionSupportOutcome,
  SittingStalenessInput,
  SittingState,
  SupportLadderTier,
  SupportLevelPresentation,
  VaultInstrumentRecord,
} from 'olea-core';
import {
  chooseSupportLevel,
  decideRebuild,
  deriveFailureShape,
  enterSitting,
  exitSitting,
  IDLE_SITTING,
  mathRandomSource,
  presentMcq,
} from 'olea-core';
import { localToday } from '../today/data-source.js';
import type { McqOption, ReviewInstrument, ReviewQueueItem, SelectionContextV4 } from './types.js';

/** Option keys in presentation order — the same letters `keymap.ts` binds. */
const OPTION_IDS = 'abcdefghij';

/**
 * Row 3.9's chooser input for this queue ([SUPP-3], `ol-lpl4`) — the same
 * shape `study-session/build.ts`'s `SupportLevelHistoryLookup` states,
 * re-declared here rather than imported: `study-session/` is a sibling
 * branch of `packages/core`'s pipeline, not a dependency of `queue/`, and
 * this interface's only two members are cheap to restate rather than reach
 * across that boundary for.
 */
export interface SupportLevelHistoryLookup {
  outcomesFor(conceptId: string, tier: SupportLadderTier): readonly SessionSupportOutcome[];
}

/**
 * `[D-094]`'s scope clause, restated for this queue's instrument types:
 * recognition (`mcq`) has no ladder at all ("its options are its
 * scaffolding"), and `qa`/`cloze` are both scored at the `'recall'` tier —
 * this queue never renders `explain-back` (F2.14) so `'explanation'` never
 * arises here. Mirrors `study-session/build.ts`'s private
 * `supportLadderTierFor`, which this module cannot import (`study-session/`
 * is out of this lane's ownership).
 */
function supportLadderTierFor(instrumentType: SchedulableInstrumentType): SupportLadderTier | null {
  return instrumentType === 'mcq' ? null : 'recall';
}

/**
 * Build a `SupportLevelHistoryLookup` from raw review-log entries — this
 * queue's equivalent of what `session-builder/provider.ts` demonstrates for
 * the F4.6 preview path. Folds every past `qa`/`cloze` review's outcome
 * (`deriveFailureShape`) into every concept it names, at the `'recall'` tier,
 * in the order `entries` is given — `session/history.ts` documents that as
 * `(timestamp, eventId)` order, oldest first, which is exactly the ordering
 * `chooseSupportLevel`'s fold requires (see its own module doc's "ordering
 * rule").
 *
 * `mcq` and `explain-back` review-kind entries are skipped: an `mcq` review
 * has no ladder tier to attribute (see {@link supportLadderTierFor}), and this
 * queue never offers `explain-back` (F2.14) so its entries carry no signal
 * this queue's own chooser calls will ever ask for. A `qa`/`cloze` entry with
 * a `null` rating is skipped too rather than guessed at — the schema's own
 * doc says `rating` is nullable only for `explain-back`, so a null rating on
 * a recall-tier entry is not a shape this fold has an honest reading for.
 *
 * `hintUptake` is always `false` — `deriveFailureShape`'s own module doc: no
 * review-log field records hint use, so the honest default is "not used",
 * never a fabricated positive.
 */
export function buildSupportLevelHistoryLookup(
  entries: readonly ReviewLogEntry[],
): SupportLevelHistoryLookup {
  const byKey = new Map<string, SessionSupportOutcome[]>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (entry.instrumentType !== 'qa' && entry.instrumentType !== 'cloze') continue;
    if (entry.rating === null) continue;

    const evidence: GradedReviewEvidence = {
      instrumentType: entry.instrumentType,
      rating: entry.rating,
    };
    const outcome: SessionSupportOutcome = {
      failureShape: deriveFailureShape(evidence),
      hintUptake: false,
    };
    for (const conceptId of entry.conceptIds) {
      const key = `${conceptId}:recall`;
      const bucket = byKey.get(key);
      if (bucket === undefined) byKey.set(key, [outcome]);
      else bucket.push(outcome);
    }
  }
  return {
    outcomesFor(conceptId, tier) {
      return byKey.get(`${conceptId}:${tier}`) ?? [];
    },
  };
}

/**
 * Row 3.9's chooser decision for one instrument, or `undefined` when no
 * decision was made — an `'mcq'` record (out of `[D-094]`'s ladder scope) or
 * a caller that supplied no `supportHistory` at all. Mirrors
 * `study-session/build.ts`'s fill-loop call exactly: fold `outcomesFor` for
 * the concept, apply the transient self-assessment for this offer only.
 *
 * **The first of the record's `conceptIds`, not all of them** — the same
 * reversible, stated convention this file's own `courseCodeOf` and
 * `queue/compose.ts`'s `blockedBy` already use for a multi-concept
 * instrument (R1/R2: her authored order, never re-sorted). A concept-level
 * decision has to name one concept when an instrument is evidence for
 * several, and "the first she listed" is the convention already established
 * twice over in this exact pipeline rather than a new one invented here.
 */
function supportLevelForRecord(
  record: VaultInstrumentRecord,
  supportHistory: SupportLevelHistoryLookup | undefined,
  supportSelfAssessment: SelfAssessmentFeeling | undefined,
): SupportLevelPresentation | undefined {
  if (supportHistory === undefined) return undefined;
  const tier = supportLadderTierFor(record.instrumentType);
  if (tier === null) return undefined;
  const conceptId = record.conceptIds[0];
  if (conceptId === undefined) return undefined;
  return chooseSupportLevel(
    supportHistory.outcomesFor(conceptId, tier),
    supportSelfAssessment ?? null,
  );
}

export interface AdaptReviewQueueInput {
  /** What `buildReviewSession` composed. Only `items` is read; `deferred` is the caller's to report. */
  readonly queue: ComposedQueue;
  /** `instrumentId` -> record, from the same walk that produced the queue. */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
  /** Injected for deterministic tests. Production takes the default, which is `Math.random`. */
  readonly random?: RandomSource;
  /**
   * Row 3.9's chooser input ([SUPP-3], `ol-lpl4`) — see
   * {@link buildSupportLevelHistoryLookup}. Omitted entirely means no support
   * level is computed for any item, exactly today's (pre-`ol-lpl4`) behaviour
   * — every existing caller and fixture needs no change.
   */
  readonly supportHistory?: SupportLevelHistoryLookup;
  /**
   * The session's one pre-session self-assessment (F2.20), applied to every
   * item this adapter scores — same singular reading `study-session/build.ts`
   * gives `BuildStudySessionInput.supportSelfAssessment`. Ignored entirely
   * when {@link AdaptReviewQueueInput.supportHistory} is not supplied.
   */
  readonly supportSelfAssessment?: SelfAssessmentFeeling;
}

/**
 * The course shown in the review view's meta line.
 *
 * A concept's course membership is M:N (R1/R2) and the meta line has room for
 * one code, so the first is shown — the same reversible default, and the same
 * stated question, as `toDueInstruments`. An empty string where a concept names
 * no course: the view renders a card with no course rather than dropping a due
 * instrument, and there is nothing here to invent one from (INV-3).
 */
function courseCodeOf(record: VaultInstrumentRecord): string {
  return record.courses[0] ?? '';
}

function common(record: VaultInstrumentRecord, supportLevel: SupportLevelPresentation | undefined) {
  return {
    instrumentId: record.instrumentId,
    conceptIds: record.conceptIds,
    courseCode: courseCodeOf(record),
    noteTitle: record.noteTitle,
    sourcePath: record.notePath,
    blockId: record.blockId,
    // Every instrument this adapter enumerates already exists in the vault
    // (`buildReviewSession` walked it) — never a cached, unreviewed draft.
    // `ol-p3t07a`'s new-badge items come from `generation/review-adapter.ts`
    // instead, which sets this to the draft's own id.
    draftId: null,
    // Row 3.9's chooser decision ([SUPP-3], `ol-lpl4`) — `undefined` (never a
    // fabricated value) produces no field at all under `exactOptionalPropertyTypes`,
    // matching `RecordReviewInput.supportLevel`'s own "absent means no decision"
    // discipline (`review/ports.ts`).
    ...(supportLevel !== undefined ? { supportLevel } : {}),
  } as const;
}

/** One showing of an MCQ: sampled and shuffled now, not when the instrument was parsed. */
function presentOptions(record: McqInstrumentRecord, random: RandomSource): readonly McqOption[] {
  const presentation = presentMcq(record.mcq, random);
  return presentation.options.map((option, index) => ({
    id: OPTION_IDS[index] ?? String(index),
    label: option.text,
    correct: option.correct,
  }));
}

/**
 * The presentation shape for one enumerated instrument.
 *
 * `supportLevel` is row 3.9's chooser decision for this instrument
 * ([SUPP-3], `ol-lpl4`), computed by the caller (`adaptReviewQueue`/
 * `adaptExecutedReviewQueue` below, via {@link supportLevelForRecord}) and
 * passed in rather than derived here — this function stays a pure
 * `record -> instrument` mapping, unaware of history lookups or self-assessment.
 */
export function toReviewInstrument(
  record: VaultInstrumentRecord,
  random: RandomSource = mathRandomSource,
  supportLevel?: SupportLevelPresentation,
): ReviewInstrument {
  if (record.instrumentType === 'qa') {
    return {
      ...common(record, supportLevel),
      type: 'qa',
      question: record.card.front,
      answer: record.card.back,
    };
  }
  if (record.instrumentType === 'cloze') {
    return {
      ...common(record, supportLevel),
      type: 'cloze',
      before: record.card.before,
      clozeText: record.card.clozeText,
      after: record.card.after,
      // The optional context line under the sentence. The heading a cloze sits
      // under is the note's own words about it — her question-headed outline —
      // and is the only context the vault offers without generating one.
      noteContext: record.heading,
    };
  }
  return {
    ...common(record, supportLevel),
    type: 'mcq',
    stem: record.mcq.stem,
    options: presentOptions(record, random),
    // `McqItem.feedback` is shown after she answers regardless of correctness.
    // The block's `feedback:` field is optional, and an absent one is an empty
    // string rather than a sentence this adapter wrote.
    feedback: record.mcq.feedback ?? '',
  };
}

/**
 * The full D7.1 context: the queue's four fields verbatim, plus the one it does
 * not own, stated as null rather than omitted.
 */
export function toSelectionContext(item: QueueItem): SelectionContextV4 {
  return {
    dueState: item.selectionContext.dueState,
    examProximity: item.selectionContext.examProximity,
    yieldRank: item.selectionContext.yieldRank,
    instrumentTypesOffered: item.selectionContext.instrumentTypesOffered,
    // C7.6: no study plan has been published, so none selected this item.
    planVersion: null,
  };
}

/**
 * Every offered item, in the order the queue offered it.
 *
 * An item whose record is missing is skipped rather than rendered blank — the
 * two are produced by one walk in `buildReviewSession`, so a miss means the
 * caller assembled the two halves from different enumerations, and a view
 * showing an empty card is a worse report of that than a shorter queue.
 */
export function adaptReviewQueue(input: AdaptReviewQueueInput): readonly ReviewQueueItem[] {
  const random = input.random ?? mathRandomSource;
  const items: ReviewQueueItem[] = [];

  for (const item of input.queue.items) {
    const record = input.recordsById.get(item.instrumentId);
    if (record === undefined) continue;
    items.push({
      instrument: toReviewInstrument(
        record,
        random,
        supportLevelForRecord(record, input.supportHistory, input.supportSelfAssessment),
      ),
      priorState: item.priorState,
      selectionContext: toSelectionContext(item),
    });
  }

  return items;
}

export interface AdaptExecutedReviewQueueInput {
  /** `executeStudyPlan`'s items — already ordered, already carrying a complete D7.1 context. */
  readonly items: readonly PlannedQueueItem[];
  /** `instrumentId` -> record, from the same walk that produced the queue. */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
  /** Injected for deterministic tests. Production takes the default, which is `Math.random`. */
  readonly random?: RandomSource;
  /**
   * Row 3.9's chooser input ([SUPP-3], `ol-lpl4`) — see
   * {@link AdaptReviewQueueInput.supportHistory}. This is the field
   * `open-session.ts` (the live "Olea: Start today's review" caller) needs to
   * pass — see this file's module doc for why it must build it from
   * `ReviewSession.entries` (`buildReviewSession`'s own return) rather than
   * from anything `executeStudyPlan` hands over.
   */
  readonly supportHistory?: SupportLevelHistoryLookup;
  /** See {@link AdaptReviewQueueInput.supportSelfAssessment}. */
  readonly supportSelfAssessment?: SelfAssessmentFeeling;
}

/**
 * Every executed item, in the order `executeStudyPlan` placed it.
 *
 * The plan-shaped sibling of `adaptReviewQueue` — see this file's module doc
 * for why it exists separately rather than as a signature change. Its
 * `selectionContext` is passed through verbatim: `executeStudyPlan` is the
 * one place that decides it (the plan's join, or the queue's own nulls when
 * there is no plan), and rebuilding it here would be a second, and possibly
 * disagreeing, opinion about what selected the item.
 */
export function adaptExecutedReviewQueue(
  input: AdaptExecutedReviewQueueInput,
): readonly ReviewQueueItem[] {
  const random = input.random ?? mathRandomSource;
  const items: ReviewQueueItem[] = [];

  for (const item of input.items) {
    const record = input.recordsById.get(item.instrumentId);
    if (record === undefined) continue;
    items.push({
      instrument: toReviewInstrument(
        record,
        random,
        supportLevelForRecord(record, input.supportHistory, input.supportSelfAssessment),
      ),
      priorState: item.priorState,
      selectionContext: item.selectionContext,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// `ol-v7r5.35` — C5.8's freeze, held here rather than assumed of the caller.
//
// Before this, both adapters above were pure `input -> ReviewQueueItem[]`
// maps with no memory: every call recomposed from whatever `input` carried,
// which is honest and correct for a ONE-SHOT read but leaves C5.8's "the
// session holds still" resting entirely on `open-session.ts`/`view.ts` never
// calling this twice for the same sitting — a discipline this file could not
// see, let alone enforce. `ol-egov.81`'s close note names exactly that gap.
//
// `createFrozenReviewQueue` is the seam `rebuild-controller.ts`'s own module
// doc already names as owed here ("still composes the review queue with no
// freeze at all ... filed as a follow-up"): it wraps `adaptExecutedReviewQueue`
// in the SAME `SittingState`/`decideRebuild` controller `session-builder/
// provider.ts` already proves out for the study-session builder, rather than
// inventing a second freeze mechanism for this queue.
//
// Three verbs, matching C5.8's three "changes only by her own action" cases:
//
//  - `open` — session entry, or an idempotent re-render of one already open.
//    A sitting that is active and not stale returns the SAME frozen array by
//    reference, no recompute, regardless of what a fresh `input` would now
//    produce (a new due item mid-session is exactly what this refuses to
//    surface). A sitting that has gone stale (`decideRebuild`'s
//    `'sitting-stale'`) ENDS per `[D-162]` — never a recompose of the
//    unreviewed tail — and this composes a fresh sitting in its place, same
//    as an idle one.
//  - `extend` — C5.5's "she outran the target": always composes a fresh
//    candidate list and APPENDS whatever it offers that is not already in
//    the frozen list, onto the end, never reordering or dropping what is
//    already there. It does not re-derive "the same plan's shares" itself —
//    that redistribution is `composeQueue`/`executeStudyPlan`'s job (C5.5's
//    own text: "the extension is composed under the same plan's shares"),
//    already done by the time an `input` reaches this adapter; `extend`'s
//    contract is only "grow, never replace, never reorder, never duplicate".
//  - `close` — she finished or left. Releases the freeze; the next `open`
//    recomposes unconditionally, which is C5.8's "between sessions it
//    recomputes on anything that changes the answer" read at this component's
//    scope: an ended sitting has nothing left to hold.
//
// Held per instance, the same "one `SittingState` per surface across
// renders/opens, not just per call" scope `ol-e228`'s acceptance criteria
// state for the study-session builder — a caller (`open-session.ts`/
// `main.ts`, outside this lane's owned paths) constructs one
// `FrozenReviewQueue` per opened review tab and calls `open`/`extend`/`close`
// through its own lifecycle, exactly the shape `createLocalSessionBuilderProvider`
// already demonstrates for `SessionBuilderState`. Wiring that caller is
// tracked as a follow-up rather than done here, across this lane's file
// ownership boundary (`packages/plugin/src/review/queue-adapter.ts` and its
// spec only) — see this bead's close notes.
// ---------------------------------------------------------------------------

export interface FrozenReviewQueueDeps {
  /** The caller's own clock reading — never read internally (INV-1). */
  readonly now: () => Date;
  /**
   * Gates when a frozen sitting's staleness may even be evaluated — defaults
   * to {@link DEFAULT_SITTING_IDLE_THRESHOLD_MS} (`rebuild-controller.ts`).
   * Overridable for tests; production leaves it at the default.
   */
  readonly idleThresholdMs?: number;
}

export interface OpenFrozenReviewQueueInput extends AdaptExecutedReviewQueueInput {
  /**
   * The frozen sitting's own material-change facts
   * (`rebuild-controller.ts`'s `SittingStalenessInput`), scoped to its
   * composition — the caller resolves these (a `SittingScopeSnapshot` diff,
   * same shape `session-builder/provider.ts` builds), never this module,
   * which has no vault or review-log access of its own (INV-1). Omitted
   * reads as "nothing changed" — honest whenever the caller has not (yet)
   * wired scope-tracking, and `decideRebuild` never consults it before the
   * idle threshold has elapsed regardless.
   */
  readonly staleness?: SittingStalenessInput;
}

const NOT_STALE: SittingStalenessInput = Object.freeze({
  itemsDueInScope: false,
  materialArrivedInScope: false,
  assessmentProximityBandCrossedInScope: false,
});

export interface FrozenReviewQueue {
  /**
   * Session entry, or an idempotent re-render of the sitting already open —
   * see this section's module doc for the three cases (hold / stale-so-end
   * / idle-so-compose).
   */
  readonly open: (input: OpenFrozenReviewQueueInput) => readonly ReviewQueueItem[];
  /**
   * C5.5's "she outran the target": composes `input` fresh and appends every
   * item it offers that the frozen list does not already carry (matched by
   * `instrument.instrumentId`), in the order the fresh composition offered
   * them. A no-op sitting-wise if every candidate is already present.
   * Extending an idle holder (no sitting open) is the same as `open` with no
   * staleness input — there is nothing to append onto.
   */
  readonly extend: (input: AdaptExecutedReviewQueueInput) => readonly ReviewQueueItem[];
  /** She finished or left. Releases the freeze; the next `open` recomposes unconditionally. */
  readonly close: () => void;
}

/**
 * C5.8's freeze, made real: one `SittingState<readonly ReviewQueueItem[]>`
 * per instance, driven by `rebuild-controller.ts`'s own `decideRebuild` —
 * see this section's module doc for why this exists and what each verb does.
 */
export function createFrozenReviewQueue(deps: FrozenReviewQueueDeps): FrozenReviewQueue {
  let sitting: SittingState<readonly ReviewQueueItem[]> = IDLE_SITTING;

  function open(input: OpenFrozenReviewQueueInput): readonly ReviewQueueItem[] {
    const now = deps.now();

    if (sitting.status === 'active') {
      const today = localToday(now);
      const decision = decideRebuild(sitting, {
        now,
        ...(deps.idleThresholdMs !== undefined ? { idleThresholdMs: deps.idleThresholdMs } : {}),
        // `decideRebuild` never reads `trigger` while a sitting is active
        // (rebuild-controller.ts's own doc) — this satisfies the required
        // field honestly (today's own date, both sides, every named fact
        // `false`) rather than fabricating a between-sittings fact this
        // adapter has no way to observe, the same posture `session-builder/
        // provider.ts`'s `load()` takes for the identical shape of call.
        trigger: {
          lastRebuiltDay: today,
          today,
          materialLandedSinceLastRebuild: false,
          assessmentDatePassedSinceLastRebuild: false,
        },
        staleness: input.staleness ?? NOT_STALE,
      });
      if (decision.action === 'hold') return sitting.items;
      // `'sitting-stale'`: `[D-162]` rules the sitting ENDS — never a
      // recompose of the unreviewed tail — so this falls through to the
      // fresh composition below exactly as the idle case does.
      sitting = exitSitting();
    }

    const items = adaptExecutedReviewQueue(input);
    sitting = enterSitting(now, items);
    return items;
  }

  function extend(input: AdaptExecutedReviewQueueInput): readonly ReviewQueueItem[] {
    const now = deps.now();
    const candidates = adaptExecutedReviewQueue(input);

    if (sitting.status !== 'active') {
      sitting = enterSitting(now, candidates);
      return candidates;
    }

    const known = new Set(sitting.items.map((item) => item.instrument.instrumentId));
    const additions = candidates.filter((item) => !known.has(item.instrument.instrumentId));
    const extended = additions.length === 0 ? sitting.items : [...sitting.items, ...additions];
    // The freeze clock does not restart on an extension — `enteredAt` still
    // marks when SHE opened this sitting, which is what the idle threshold
    // (C5.8's "long enough that coming back is a return") must keep
    // measuring against, not when it was last topped up.
    sitting = enterSitting(sitting.enteredAt, extended);
    return extended;
  }

  function close(): void {
    sitting = exitSitting();
  }

  return { open, extend, close };
}
