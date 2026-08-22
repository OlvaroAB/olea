/**
 * `ReviewSession` — the review view's state machine (F2.2, F2.4, F2.6, F2.16,
 * Q6.5). Obsidian-free and fully unit-testable by construction: every side
 * effect (writing a review-log record, suspending, editing, checking a
 * note's existence, reading the clock) goes through a port from `ports.ts`,
 * so `session.spec.ts` drives this with fakes and asserts on
 * `getViewModel()` — the same "logic tested, DOM glue untested" split
 * `settings-tab.ts` and `register-commands.ts` already use elsewhere in this
 * package.
 *
 * `view.ts` is the only caller: it constructs one `ReviewSession` per
 * opened tab, feeds it real `KeyboardEvent`s translated through
 * `keymap.ts`, and re-renders from `getViewModel()` after every mutating
 * call.
 */

import type { Rating } from 'olea-contracts';
import type { McqRating, Scheduler } from 'olea-core';
import { mapMcqRating } from 'olea-core';
import { previewQaClozeIntervals, previewSingleInterval, type RatingPreview } from './interval.js';
import type { Clock, EditPort, NoteExistsPort, ReviewLogPort, SuspendPort } from './ports.js';
import type { ClozeCard, McqItem, QaCard, ReviewInstrument, ReviewQueueItem } from './types.js';

export interface ReviewProgress {
  /** 1-based position of the current item among what's left of today's queue. */
  readonly position: number;
  /** Shrinks when an item is suspended or its note is found missing and removed — "of N" always describes what's actually still ahead, not the session's original size. */
  readonly total: number;
}

export interface SessionCompleteSummary {
  readonly reviewedCount: number;
  readonly courseCodes: readonly string[];
  /** Count of reviewed items whose *actual* resulting interval (via `Scheduler.schedule`, the real rating she gave) is due today or tomorrow. */
  readonly dueSoonCount: number;
}

export type ReviewViewModel =
  | { readonly phase: 'loading' }
  | { readonly phase: 'empty'; readonly nextDueLabel: string | null }
  | {
      readonly phase: 'note-missing';
      readonly instrument: ReviewInstrument;
      readonly progress: ReviewProgress;
    }
  | {
      readonly phase: 'front';
      readonly instrument: QaCard | ClozeCard;
      readonly progress: ReviewProgress;
    }
  | {
      readonly phase: 'reveal';
      readonly instrument: QaCard | ClozeCard;
      readonly progress: ReviewProgress;
      readonly ratingPreviews: readonly RatingPreview[];
    }
  | { readonly phase: 'mcq-open'; readonly instrument: McqItem; readonly progress: ReviewProgress }
  | {
      readonly phase: 'mcq-answered';
      readonly instrument: McqItem;
      readonly progress: ReviewProgress;
      readonly selectedIndex: number;
      readonly wasUnsure: boolean;
      readonly intervalLabel: string;
    }
  | { readonly phase: 'complete'; readonly summary: SessionCompleteSummary };

export interface ReviewSessionDeps {
  readonly queue: readonly ReviewQueueItem[];
  readonly scheduler: Scheduler;
  readonly reviewLog: ReviewLogPort;
  readonly suspendPort: SuspendPort;
  readonly editPort: EditPort;
  readonly noteExists: NoteExistsPort;
  readonly clock: Clock;
  /** Shown on the empty state when the queue starts with nothing due (F2.2's "nothing due" scenario). */
  readonly nextDueLabel?: string | null;
}

type InternalPhase =
  | 'loading'
  | 'empty'
  | 'note-missing'
  | 'front'
  | 'reveal'
  | 'mcq-open'
  | 'mcq-answered'
  | 'complete';

export class ReviewSession {
  private items: ReviewQueueItem[];
  private readonly startedWithItems: boolean;
  private index = 0;
  private phase: InternalPhase = 'loading';
  private mcqSelectedIndex: number | null = null;
  private wasUnsure = false;
  private presentedAtMs: number | null = null;
  private mcqIntervalLabel = '';

  private reviewedCount = 0;
  private readonly courseCodesSeen = new Set<string>();
  private dueSoonCount = 0;

  constructor(private readonly deps: ReviewSessionDeps) {
    this.items = [...deps.queue];
    this.startedWithItems = deps.queue.length > 0;
  }

  /** Presents the first item (or the empty/complete state). Call once before rendering. */
  async start(): Promise<void> {
    await this.presentCurrent();
  }

  get currentItem(): ReviewQueueItem | null {
    return this.items[this.index] ?? null;
  }

  getViewModel(): ReviewViewModel {
    switch (this.phase) {
      case 'loading':
        return { phase: 'loading' };
      case 'empty':
        return { phase: 'empty', nextDueLabel: this.deps.nextDueLabel ?? null };
      case 'complete':
        return {
          phase: 'complete',
          summary: {
            reviewedCount: this.reviewedCount,
            courseCodes: [...this.courseCodesSeen].sort(),
            dueSoonCount: this.dueSoonCount,
          },
        };
      case 'note-missing': {
        const item = this.requireCurrent();
        return { phase: 'note-missing', instrument: item.instrument, progress: this.progress() };
      }
      case 'front': {
        const item = this.requireCurrent();
        return {
          phase: 'front',
          instrument: this.requireQaOrCloze(item),
          progress: this.progress(),
        };
      }
      case 'reveal': {
        const item = this.requireCurrent();
        const instrument = this.requireQaOrCloze(item);
        return {
          phase: 'reveal',
          instrument,
          progress: this.progress(),
          ratingPreviews: previewQaClozeIntervals(
            this.deps.scheduler,
            instrument.instrumentId,
            item.priorState,
            this.deps.clock.now(),
          ),
        };
      }
      case 'mcq-open': {
        const item = this.requireCurrent();
        return { phase: 'mcq-open', instrument: this.requireMcq(item), progress: this.progress() };
      }
      case 'mcq-answered': {
        const item = this.requireCurrent();
        return {
          phase: 'mcq-answered',
          instrument: this.requireMcq(item),
          progress: this.progress(),
          selectedIndex: this.mcqSelectedIndex ?? -1,
          wasUnsure: this.wasUnsure,
          intervalLabel: this.mcqIntervalLabel,
        };
      }
    }
  }

  reveal(): void {
    if (this.phase !== 'front') return;
    this.phase = 'reveal';
  }

  flipBack(): void {
    if (this.phase !== 'reveal') return;
    this.phase = 'front';
  }

  /** Q&A/cloze rating (F2.16: all four values valid — no MCQ-style narrowing here). */
  async rate(rating: Rating): Promise<void> {
    if (this.phase !== 'reveal') return;
    const item = this.requireCurrent();
    await this.logAndAdvance(item, rating, false);
  }

  mcqAnswer(optionIndex: number): void {
    if (this.phase !== 'mcq-open') return;
    const instrument = this.requireMcq(this.requireCurrent());
    if (optionIndex < 0 || optionIndex >= instrument.options.length) return;
    this.mcqSelectedIndex = optionIndex;
    this.wasUnsure = false;
    this.phase = 'mcq-answered';

    this.mcqIntervalLabel = this.previewMcqInterval(this.mcqRating(instrument, optionIndex));
  }

  /** "Wasn't sure / guessed" (F2.16) — offered regardless of whether the answer was right or wrong (`PluginMcqAnswered`'s doc), even though it only changes the recorded rating when she was actually correct. */
  mcqToggleGuessed(): void {
    if (this.phase !== 'mcq-answered') return;
    this.wasUnsure = !this.wasUnsure;

    const instrument = this.requireMcq(this.requireCurrent());
    this.mcqIntervalLabel = this.previewMcqInterval(
      this.mcqRating(instrument, this.mcqSelectedIndex),
    );
  }

  async mcqNext(): Promise<void> {
    if (this.phase !== 'mcq-answered') return;
    const item = this.requireCurrent();
    const instrument = this.requireMcq(item);
    const rating = this.mcqRating(instrument, this.mcqSelectedIndex);
    await this.logAndAdvance(item, rating, this.wasUnsure);
  }

  async suspend(): Promise<void> {
    const item = this.items[this.index];
    if (item === undefined) return;
    this.items.splice(this.index, 1);
    await this.deps.suspendPort.suspend(item.instrument.instrumentId, item.instrument.conceptIds);
    await this.presentCurrent();
  }

  async edit(): Promise<void> {
    const item = this.currentItem;
    if (item === null) return;
    await this.deps.editPort.edit(item.instrument);
  }

  async skipMissingNote(): Promise<void> {
    if (this.phase !== 'note-missing') return;
    this.index += 1;
    await this.presentCurrent();
  }

  /** Removes the instrument from today's queue entirely (session-scoped, same as suspend — deleting the instrument record itself is a vault-write concern this view doesn't own). */
  async removeMissingNote(): Promise<void> {
    if (this.phase !== 'note-missing') return;
    this.items.splice(this.index, 1);
    await this.presentCurrent();
  }

  // ---- internals ----

  /**
   * F2.16's MCQ mapping — `olea-core`'s, and the plugin has no other.
   *
   * This used to call a three-line copy in `review/rating.ts`, written while
   * `ol-p2t06` was still open and documented as provisional ("when that lands,
   * this file should be replaced by an import from it"). It landed; the copy is
   * deleted rather than left standing, because two implementations of one
   * requirement drift while both keep passing their own tests.
   *
   * `mapMcqRating` returns `McqRating` (`Exclude<Rating, 'easy'>`), so "Easy is
   * never offered for recognition" is enforced by the compiler at this call
   * site rather than by a comment. An index that names no option is `correct:
   * false` — an unanswered MCQ cannot reach here, and Again is the safe reading
   * if one ever did.
   */
  private mcqRating(instrument: McqItem, selectedIndex: number | null): McqRating {
    const option = instrument.options[selectedIndex ?? -1];
    return mapMcqRating({
      type: 'mcq',
      correct: option?.correct ?? false,
      wasUnsure: this.wasUnsure,
    });
  }

  private previewMcqInterval(rating: Rating): string {
    const item = this.requireCurrent();
    return previewSingleInterval(
      this.deps.scheduler,
      item.instrument.instrumentId,
      item.priorState,
      rating,
      this.deps.clock.now(),
    ).label;
  }

  private progress(): ReviewProgress {
    return { position: this.index + 1, total: this.items.length };
  }

  private requireCurrent(): ReviewQueueItem {
    const item = this.items[this.index];
    if (item === undefined) {
      throw new Error(`ReviewSession: no current item for phase ${this.phase}`);
    }
    return item;
  }

  private requireQaOrCloze(item: ReviewQueueItem): QaCard | ClozeCard {
    if (item.instrument.type === 'mcq') {
      throw new Error('ReviewSession: expected a Q&A/cloze instrument, got mcq');
    }
    return item.instrument;
  }

  private requireMcq(item: ReviewQueueItem): McqItem {
    if (item.instrument.type !== 'mcq') {
      throw new Error('ReviewSession: expected an mcq instrument');
    }
    return item.instrument;
  }

  private async presentCurrent(): Promise<void> {
    if (this.index >= this.items.length) {
      this.phase = this.startedWithItems || this.reviewedCount > 0 ? 'complete' : 'empty';
      return;
    }

    const item = this.items[this.index];
    if (item === undefined) {
      this.phase = 'complete';
      return;
    }

    const exists = await this.deps.noteExists.exists(item.instrument.sourcePath);
    if (!exists) {
      this.phase = 'note-missing';
      return;
    }

    this.mcqSelectedIndex = null;
    this.wasUnsure = false;
    this.mcqIntervalLabel = '';
    this.presentedAtMs = this.deps.clock.now().getTime();
    this.phase = item.instrument.type === 'mcq' ? 'mcq-open' : 'front';
  }

  private async logAndAdvance(
    item: ReviewQueueItem,
    rating: Rating,
    wasUnsure: boolean,
  ): Promise<void> {
    const now = this.deps.clock.now();
    const durationMs =
      this.presentedAtMs !== null ? Math.max(0, now.getTime() - this.presentedAtMs) : null;

    await this.deps.reviewLog.recordReview({
      instrument: item.instrument,
      rating,
      wasUnsure,
      durationMs,
      selectionContext: item.selectionContext,
    });

    const { intervalDays } = previewSingleInterval(
      this.deps.scheduler,
      item.instrument.instrumentId,
      item.priorState,
      rating,
      now,
    );
    this.reviewedCount += 1;
    this.courseCodesSeen.add(item.instrument.courseCode);
    if (intervalDays <= 1) this.dueSoonCount += 1;

    this.index += 1;
    await this.presentCurrent();
  }
}
