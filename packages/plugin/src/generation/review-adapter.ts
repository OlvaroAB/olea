/**
 * `toDraftReviewQueueItem` — one cached, unreviewed draft as a review-queue
 * item (F3.3, `[D-097]`, `ol-p3t07a`).
 *
 * The draft-side sibling of `review/queue-adapter.ts`'s `toReviewInstrument`:
 * same per-showing MCQ sampling (`presentMcq`, F2.15 — a draft answered twice
 * before she resolves it, e.g. after reopening the tab, still gets a fresh
 * shuffle), same `ReviewQueueItem` shape, but built from a `DraftRecord`
 * rather than an enumerated `VaultInstrumentRecord`, because a pending draft
 * is not yet in the vault at all (`[CACHE-1]`'s whole point).
 *
 * **`instrumentId` is a transient stand-in — the draft's own id — until
 * `DraftAcceptPort.accept` mints the real one** (`accept.ts`). Nothing reads
 * or persists this transient value as if it were a real instrument id: no
 * scheduling state exists for it (`priorState: null` below, always — a
 * pending draft has never been reviewed by construction), and
 * `review/session.ts` replaces the whole `ReviewInstrument` with a
 * `draftId: null` copy the instant it resolves, before any review-log write
 * happens.
 *
 * **`noteTitle` has no independent source here.** An enumerated instrument's
 * title comes from `session/enumerate.ts`'s own note-reading pass
 * (`VaultInstrumentRecord.noteTitle`), which this adapter has no cheap way to
 * re-run per draft without a second vault read per item on every queue
 * composition. The note's own basename (extension stripped) is used instead
 * — visibly the note, not blank, and cheap — and is corrected for free the
 * moment the draft is accepted: the review view then re-reads the real
 * instrument through the ordinary enumeration path on its next open, same as
 * any other newly-scheduled instrument.
 */

import type { RandomSource } from 'olea-core';
import { mathRandomSource, presentMcq } from 'olea-core';
import type {
  McqItem,
  McqOption,
  QaCard,
  ReviewQueueItem,
  SelectionContextV4,
} from '../review/types.js';
import type { DraftCardContent, DraftQuestion, DraftRecord } from './types.js';

/** Matches `review/queue-adapter.ts`'s own `OPTION_IDS` convention (the letters `keymap.ts` binds). */
const OPTION_IDS = 'abcdefghij';

/** Exported additively for `bulk-review.ts` (`ol-jie3`), which needs the same note-title derivation for its group headers — one function, not two copies that could drift. */
export function basenameWithoutExtension(path: string): string {
  const slash = path.lastIndexOf('/');
  const file = slash === -1 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return dot <= 0 ? file : file.slice(0, dot);
}

/**
 * `ol-0r92.88`: `DraftRecord.question` is optional because a `'qa'`-kind draft
 * carries `card` instead (`types.ts`). A card draft is presented by
 * `toDraftCardItem` below (`ol-egov.141.89.105.6`); only a record carrying
 * neither shape reaches this throw, which names the record rather than
 * crashing on a bare `undefined`.
 */
function requireMcqQuestion(record: DraftRecord): DraftQuestion {
  if (record.question === undefined) {
    throw new Error(
      `toDraftReviewQueueItem: draft ${record.draftId} has no MCQ question (instrumentType '${record.instrumentType ?? 'mcq'}')`,
    );
  }
  return record.question;
}

function presentDraftOptions(record: DraftRecord, random: RandomSource): readonly McqOption[] {
  const question = requireMcqQuestion(record);
  const presentation = presentMcq(
    {
      stem: question.stem,
      answer: question.correctAnswer,
      distractors: question.distractors,
    },
    random,
  );
  return presentation.options.map((option, index) => ({
    id: OPTION_IDS[index] ?? String(index),
    label: option.text,
    correct: option.correct,
  }));
}

/**
 * `ol-egov.141.89.105.6`: a pending question-and-answer card draft as a `QaCard` carrying its
 * `draftId` (the same new-badge condition an MCQ draft carries). The review screen already
 * renders it: front first, her recall, then the reveal with edit-before-saving and reject, and
 * rating accepts it ([D-097], [D-189], F3.3). Nothing here throws for a card.
 */
function toDraftCardItem(record: DraftRecord, card: DraftCardContent): ReviewQueueItem {
  const instrument: QaCard = {
    instrumentId: record.draftId,
    draftId: record.draftId,
    conceptIds: [...record.conceptIds],
    courseCode: record.courseCode,
    noteTitle: basenameWithoutExtension(record.sourcePath),
    sourcePath: record.sourcePath,
    blockId: null,
    type: 'qa',
    question: card.front,
    answer: card.back,
  };
  return {
    instrument,
    priorState: null,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      // The review-log field records what the queue offered; 'qa' is already a valid value.
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

/** F3.3's "new badge" carries no separate boolean anywhere in this shape — `instrument.draftId !== null` on a `ReviewInstrument` IS the badge condition, so there is exactly one place `view.ts` can get this wrong: reading the wrong field. See that module's doc. */
export function toDraftReviewQueueItem(
  record: DraftRecord,
  random: RandomSource = mathRandomSource,
): ReviewQueueItem {
  if (record.instrumentType === 'qa' && record.card !== undefined) {
    return toDraftCardItem(record, record.card);
  }
  const question = requireMcqQuestion(record);
  const instrument: McqItem = {
    instrumentId: record.draftId,
    draftId: record.draftId,
    conceptIds: [...record.conceptIds],
    courseCode: record.courseCode,
    noteTitle: basenameWithoutExtension(record.sourcePath),
    sourcePath: record.sourcePath,
    blockId: null,
    type: 'mcq',
    stem: question.stem,
    options: presentDraftOptions(record, random),
    feedback: question.feedback,
  };

  const selectionContext: SelectionContextV4 = {
    dueState: 'new',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['mcq'],
    planVersion: null,
  };

  return { instrument, priorState: null, selectionContext };
}
