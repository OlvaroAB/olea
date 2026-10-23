/**
 * `[D-627]` (`ol-3ux7.5.57.98`): a session never serves the same content twice. The queue
 * `open-session.ts` builds is the session builder's instruments followed by every pending draft
 * (`[D-568]`), and two concepts drafted from one note can carry byte-identical cards. Before this,
 * both copies were served. This module runs once over that merged queue and sets each later copy
 * aside.
 *
 * - **The key is exact student-facing content, by type** — never the id, the draft id or the
 *   concept. A Q&A card is its question and answer; a cloze its text before the blank, the blank,
 *   the text after it and its context line; an MCQ its stem, its options as a set (label, whether
 *   correct, and any misconception provenance) and its feedback. Option ids and order are left out
 *   because a draft's options are shuffled per item (`generation/review-adapter.ts`). Nothing is
 *   normalised: one character or one space of difference keeps both.
 * - **The first occurrence in queue order is kept**, so a due instrument wins over a pending draft.
 *   First-occurrence filtering is stable as the queue grows: the kept items of a queue begin the
 *   kept items of that queue with more appended, which is what `ReviewSessionOpener.extend`'s diff
 *   base relies on.
 * - **Nothing is merged and nothing is written.** The kept item is returned unchanged, carrying
 *   only its own concept ids, so answering it credits only its own concepts. The set-aside copy is
 *   not accepted, rejected or touched in the draft cache: a pending draft stays pending, with its
 *   provenance and concept binding as stored.
 * - **Why a copy was set aside is recorded** in {@link DuplicateContentSetAside}, held on the opened
 *   session in memory and never persisted. It names ids and concept ids only, never the content.
 *
 * Not covered: an item that "Keep going" adds is compared with that call's own queue, which holds
 * the builder's instruments but not the drafts served when the session opened.
 */

import type { ReviewInstrument, ReviewQueueItem } from './types.js';

/** One queue item withheld because an earlier item in the same queue has the same content. */
export interface DuplicateContentSetAside {
  readonly reason: 'duplicate-content';
  /** The withheld copy's own instrument id (a pending draft's id is its draft id). */
  readonly instrumentId: string;
  readonly draftId: string | null;
  /** The withheld copy's own concept ids, as stored — never merged into the kept copy's. */
  readonly conceptIds: readonly string[];
  /** The copy that was served instead. */
  readonly duplicateOf: {
    readonly instrumentId: string;
    readonly draftId: string | null;
    readonly conceptIds: readonly string[];
  };
}

export interface DuplicateContentOutcome {
  /** The queue with every later copy removed, in its original order. */
  readonly queue: readonly ReviewQueueItem[];
  readonly setAside: readonly DuplicateContentSetAside[];
}

/** The exact student-facing content of an instrument, as a string two instruments share only when a student could not tell them apart. */
export function reviewContentKey(instrument: ReviewInstrument): string {
  switch (instrument.type) {
    case 'qa':
      return JSON.stringify(['qa', instrument.question, instrument.answer]);
    case 'cloze':
      return JSON.stringify([
        'cloze',
        instrument.before,
        instrument.clozeText,
        instrument.after,
        instrument.noteContext,
      ]);
    case 'mcq': {
      const options = instrument.options
        .map((option) =>
          JSON.stringify([
            option.label,
            option.correct,
            option.believes ?? null,
            option.source_says ?? null,
          ]),
        )
        .sort();
      return JSON.stringify(['mcq', instrument.stem, options, instrument.feedback]);
    }
  }
}

/** Keeps the first item for each content key and sets every later copy aside, with the reason. */
export function setAsideDuplicateContent(
  queue: readonly ReviewQueueItem[],
): DuplicateContentOutcome {
  const keptByKey = new Map<string, ReviewInstrument>();
  const kept: ReviewQueueItem[] = [];
  const setAside: DuplicateContentSetAside[] = [];
  for (const item of queue) {
    const key = reviewContentKey(item.instrument);
    const first = keptByKey.get(key);
    if (first === undefined) {
      keptByKey.set(key, item.instrument);
      kept.push(item);
      continue;
    }
    setAside.push({
      reason: 'duplicate-content',
      instrumentId: item.instrument.instrumentId,
      draftId: item.instrument.draftId,
      conceptIds: [...item.instrument.conceptIds],
      duplicateOf: {
        instrumentId: first.instrumentId,
        draftId: first.draftId,
        conceptIds: [...first.conceptIds],
      },
    });
  }
  return { queue: kept, setAside };
}
