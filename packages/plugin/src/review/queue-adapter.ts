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
 */

import type {
  ComposedQueue,
  McqInstrumentRecord,
  PlannedQueueItem,
  QueueItem,
  RandomSource,
  VaultInstrumentRecord,
} from 'olea-core';
import { mathRandomSource, presentMcq } from 'olea-core';
import type { McqOption, ReviewInstrument, ReviewQueueItem, SelectionContextV4 } from './types.js';

/** Option keys in presentation order — the same letters `keymap.ts` binds. */
const OPTION_IDS = 'abcdefghij';

export interface AdaptReviewQueueInput {
  /** What `buildReviewSession` composed. Only `items` is read; `deferred` is the caller's to report. */
  readonly queue: ComposedQueue;
  /** `instrumentId` -> record, from the same walk that produced the queue. */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
  /** Injected for deterministic tests. Production takes the default, which is `Math.random`. */
  readonly random?: RandomSource;
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

function common(record: VaultInstrumentRecord) {
  return {
    instrumentId: record.instrumentId,
    conceptIds: record.conceptIds,
    courseCode: courseCodeOf(record),
    noteTitle: record.noteTitle,
    sourcePath: record.notePath,
    blockId: record.blockId,
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

/** The presentation shape for one enumerated instrument. */
export function toReviewInstrument(
  record: VaultInstrumentRecord,
  random: RandomSource = mathRandomSource,
): ReviewInstrument {
  if (record.instrumentType === 'qa') {
    return {
      ...common(record),
      type: 'qa',
      question: record.card.front,
      answer: record.card.back,
    };
  }
  if (record.instrumentType === 'cloze') {
    return {
      ...common(record),
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
    ...common(record),
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
      instrument: toReviewInstrument(record, random),
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
      instrument: toReviewInstrument(record, random),
      priorState: item.priorState,
      selectionContext: item.selectionContext,
    });
  }

  return items;
}
