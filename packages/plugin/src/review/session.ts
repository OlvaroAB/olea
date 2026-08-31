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
import type {
  ConfusionRoutingDecision,
  ConfusionRoutingInput,
  McqRating,
  Scheduler,
} from 'olea-core';
import { mapMcqRating } from 'olea-core';
import type { DraftAcceptPort } from '../generation/accept.js';
import type { GradeContestPort } from './contest.js';
import { CONTEST_GESTURE_LABEL, CONTEST_QUARANTINE_BADGE } from './copy.js';
import {
  buildExplainWhyRequest,
  type ExplainWhyOutcome,
  type ExplainWhyPort,
} from './explainWhy.js';
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
      /**
       * The contest gesture on the grade Olea has just asserted (`[D-046]`
       * clause 4, `[D-095]`, `ol-fgba` [DISP-1]).
       *
       * An MCQ result IS an instrument grade — `[D-095]`'s third kind, "an
       * explain-back verdict, an instrument grade" — so principle 12's fourth
       * part binds on it exactly as it binds on a mastery reading. `null` when
       * no `gradeContestPort` is wired: a session that cannot record a dispute
       * does not offer the gesture, rather than offering one that would
       * silently do nothing. That is the same "simply cannot offer it" posture
       * `explainWhyPort` already takes, and it is the difference between an
       * unavailable affordance and a dismiss button.
       */
      readonly contestGestureLabel: string | null;
      /** Whether she has already contested this grade — it dims with a badge, never disappears. */
      readonly contestBadge: string | null;
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
  /**
   * Resolves a cached, unreviewed draft (`instrument.draftId !== null`, F3.3,
   * `ol-p3t07a`) into a real instrument the moment she answers, edits, or
   * rejects it. Required even for a session with no draft items today —
   * same "always wired, not every item uses it" posture `suspendPort` and
   * `editPort` already have.
   */
  readonly draftAcceptPort: DraftAcceptPort;
  /** Shown on the empty state when the queue starts with nothing due (F2.2's "nothing due" scenario). */
  readonly nextDueLabel?: string | null;
  /**
   * F2.7's on-demand "explain why I got this wrong" (`ol-p3t08`). Optional
   * and absent by default, matching plan §7.1's "AI features un-grey" — a
   * session built with no port wired (offline, or no caller has assembled
   * one yet) simply cannot offer it, rather than this class inventing a
   * fallback behaviour. See `requestExplainWhy` below and `explainWhy.ts`'s
   * module doc for what this port does and does not do (grounding-context
   * retrieval is NOT its job, and is not done here — see the lane report).
   */
  readonly explainWhyPort?: ExplainWhyPort;
  /**
   * F2.12's confusion-routing decision (`ol-h2bx`), composed at
   * `OleaPlugin.evaluateConfusionRouting` (`grading/wiring.ts`'s pure
   * delegate to `olea-core`'s `evaluateConfusionRouting`). Optional and
   * absent by default — not because this decision is AI-gated (it is pure
   * and synchronous, unlike `explainWhyPort`), but so every existing
   * `ReviewSessionDeps` fixture stays valid without this bead touching it.
   * An absent evaluator reads as "never offer," the same "simply cannot
   * offer it" posture `explainWhyPort` above already has.
   */
  readonly evaluateConfusionRouting?: (input: ConfusionRoutingInput) => ConfusionRoutingDecision;
  /**
   * The grade case of the contest mechanism (`ol-fgba`, `[D-095]`). Optional
   * and absent by default for the same reason `explainWhyPort` is: a session
   * assembled without one cannot record a dispute, and an affordance that
   * cannot record is the dismiss button `[D-046]` clause 4 exists to rule out.
   * Absent reads as "cannot offer it", never as "offer it and drop the
   * record".
   */
  readonly gradeContestPort?: GradeContestPort;
}

/**
 * F2.12's pending offer, as `ReviewSession` holds it: which instrument it is
 * about (the one that was JUST rated, not necessarily the one the view is
 * currently showing) and the offer's own prompt sentence.
 */
export interface PendingConfusionRoutingOffer {
  readonly instrument: ReviewInstrument;
  readonly promptText: string;
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
  /**
   * Instruments whose grade she has contested during this session, so the
   * badge appears without a second read of the log. The durable answer is
   * always `quarantinedGradeInstrumentIds` folded from the review log — this
   * set is a render cache, never the truth.
   */
  private readonly contestedGrades = new Set<string>();

  private reviewedCount = 0;
  private readonly courseCodesSeen = new Set<string>();
  private dueSoonCount = 0;
  /** F2.12 (`ol-h2bx`) — set by `logAndAdvance` after every graded review, cleared by `acceptConfusionRoutingOffer`. */
  private pendingConfusionOffer: PendingConfusionRoutingOffer | null = null;

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
          contestGestureLabel:
            this.deps.gradeContestPort === undefined ? null : CONTEST_GESTURE_LABEL,
          contestBadge: this.contestedGrades.has(item.instrument.instrumentId)
            ? CONTEST_QUARANTINE_BADGE
            : null,
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

  /**
   * Q&A/cloze rating (F2.16: all four values valid — no MCQ-style narrowing
   * here). For a still-pending draft (F3.3, `ol-p3t07a`) this IS the accept
   * step — `[D-097]`'s "answering it is accepting it, no added tap" — before
   * anything is recorded.
   */
  async rate(rating: Rating): Promise<void> {
    if (this.phase !== 'reveal') return;
    const item = await this.resolveDraftAt(this.index, 'accepted');
    await this.logAndAdvance(item, rating, false);
  }

  /**
   * `[D-097]`'s "answering it is accepting it" for an MCQ new-badge item: a
   * still-pending draft is materialized into the vault (real `instrumentId`
   * minted) BEFORE anything else below runs, so the interval preview and the
   * eventual `logAndAdvance` both operate on the real instrument, never the
   * transient draft-id stand-in (`generation/review-adapter.ts`'s doc).
   * A no-op resolution (same item back) for an ordinary instrument.
   */
  async mcqAnswer(optionIndex: number): Promise<void> {
    if (this.phase !== 'mcq-open') return;
    const item = await this.resolveDraftAt(this.index, 'accepted');
    const instrument = this.requireMcq(item);
    if (optionIndex < 0 || optionIndex >= instrument.options.length) return;
    this.mcqSelectedIndex = optionIndex;
    this.wasUnsure = false;
    this.phase = 'mcq-answered';

    this.mcqIntervalLabel = this.previewMcqInterval(this.mcqRating(instrument, optionIndex));
  }

  /**
   * F3.3/`[D-097]`'s one-tap "edit" for a new-badge item: resolves the draft
   * with verdict `'edited'` (materializing it, exactly as `accept` does),
   * then opens the note it just landed in through the ordinary `editPort` so
   * she can hand-edit the persisted text before it is ever offered again.
   * No-op — deliberately — for an ordinary, already-materialized item; the
   * header's regular "Edit note" button already covers that case.
   */
  async acceptEditDraft(): Promise<void> {
    const item = this.currentItem;
    if (item === null || item.instrument.draftId === null) return;
    const resolved = await this.resolveDraftAt(this.index, 'edited');
    await this.deps.editPort.edit(resolved.instrument);
  }

  /**
   * F3.3's "reject prunes — withdrawn from circulation, retained in full,
   * never deleted": one tap away, before she has answered. Writes nothing to
   * the vault (there is no instrument yet) and removes the item from
   * today's queue, same shape `removeMissingNote` already uses. No-op for an
   * ordinary item or an already-resolved draft.
   */
  async rejectDraft(): Promise<void> {
    const item = this.currentItem;
    if (item === null || item.instrument.draftId === null) return;
    await this.deps.draftAcceptPort.reject(item.instrument.draftId);
    this.items.splice(this.index, 1);
    await this.presentCurrent();
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

  /**
   * Contests the grade Olea has just asserted about this answer (`[D-046]`
   * clause 4, mechanised by `[D-095]`; `ol-fgba` [DISP-1]).
   *
   * **One gesture, one event, and the effect is fixed by what she touched.**
   * She is never asked to classify her own disagreement, so this method takes
   * no reason and there is nowhere to put one: an MCQ result is an instrument
   * grade, `[D-095]` routes a grade to `quarantined`, and that is the whole
   * decision. The dispute is recorded either way — that recording is what
   * makes this more than a dismiss button.
   *
   * **It does not move her on.** Contesting is not answering: the phase stays
   * `mcq-answered`, so the claim, its evidence and her contest are all still
   * on screen together, which is the acknowledgment `[D-095]` §2 requires.
   *
   * Returns silently when no port is wired — the same posture
   * `requestExplainWhy` takes, and the reason `contestGestureLabel` is `null`
   * in that case, so she is never offered a gesture that would drop her
   * dispute.
   */
  async contestGrade(): Promise<void> {
    if (this.phase !== 'mcq-answered') return;
    const port = this.deps.gradeContestPort;
    if (port === undefined) return;

    const item = this.requireCurrent();
    const instrument = this.requireMcq(item);
    if (this.contestedGrades.has(instrument.instrumentId)) return;

    await port.contestGrade({
      instrumentId: instrument.instrumentId,
      conceptIds: instrument.conceptIds,
      // The evidence this grade rests on is the answer she gave to this
      // instrument, in this session — an opaque fingerprint, never her text
      // (D-005). A re-derivation on the same answer shares it; a later,
      // different answer does not, which is evidence-relative aging applied
      // to a grade exactly as `[D-095]` §3 applies it to a reading.
      evidenceBasis: `mcq|${instrument.instrumentId}|${this.mcqSelectedIndex ?? -1}|${this.wasUnsure}`,
    });
    this.contestedGrades.add(instrument.instrumentId);
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

  /**
   * F2.7's on-demand "explain why I got this wrong" hook (`ol-p3t08`).
   * Deliberately never gated on the current phase or on whether her answer
   * was actually wrong — F2.20 says this help "stays available at every
   * stage, to every concept, regardless of how well she knows it", so it is
   * the caller's job to decide when to surface the affordance, not this
   * class's job to second-guess it.
   *
   * **Never mutates `phase`, `index`, or any rating/logging state** — the
   * property `features/F2-review.md`'s "the tap never blocks the session"
   * scenario asks for. Calling this can never leave the session unable to
   * `rate`/`mcqAnswer`/`mcqNext`/`suspend`/etc., because it touches none of
   * the state those methods read or write.
   *
   * `sourceChunks` is the caller's already-retrieved grounding context
   * (F2.7's grounding half — see `explainWhy.ts`'s module doc for why that
   * is deliberately not this method's job either). Returns `null` when no
   * `explainWhyPort` is wired (AI features "greyed", plan §7.1) rather than
   * throwing — the caller decides how to render that, same as an absent
   * `nextDueLabel` is a normal, renderable state rather than an error.
   */
  async requestExplainWhy(
    studentAnswer: string,
    sourceChunks: readonly string[],
  ): Promise<ExplainWhyOutcome | null> {
    if (this.deps.explainWhyPort === undefined) return null;
    const item = this.currentItem;
    if (item === null) return null;
    const request = buildExplainWhyRequest(item.instrument, studentAnswer, sourceChunks);
    return this.deps.explainWhyPort.explainWhy(request);
  }

  /**
   * F2.12's offer for the caller to render, or `null` when none is pending
   * (`ol-h2bx`). `view.ts` reads this after every render rather than the
   * offer riding inside `ReviewViewModel`'s phase union, because the offer
   * is about the instrument that was JUST rated — not necessarily the one
   * `getViewModel()` is currently showing.
   */
  getConfusionRoutingOffer(): PendingConfusionRoutingOffer | null {
    return this.pendingConfusionOffer;
  }

  /**
   * F2.12's "one available action" (`[D-163]`/`ol-12gs`, superseding
   * `ol-h2bx`'s `acceptConfusionRoutingOffer`): resolves the just-offered
   * instrument and clears the pending offer — nothing more. The actual
   * "explain it back" exchange is `ExplainBackModal`'s job now (F5.1's
   * dedicated destination), opened by `review/view.ts`'s
   * `handleAcceptConfusionOffer` with the instrument this method returns;
   * this method performs no port call and retrieves no grounding context,
   * unlike the method it replaces, because there is no longer an inline
   * result for THIS class to produce.
   *
   * Returns `null` without touching anything when there is nothing pending
   * — "one available action," taken once, is a no-op the second time.
   */
  resolveConfusionRoutingOffer(): PendingConfusionRoutingOffer | null {
    const offer = this.pendingConfusionOffer;
    if (offer === null) return null;
    this.pendingConfusionOffer = null;
    return offer;
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

  /**
   * If the item at `index` is a still-pending draft (`instrument.draftId !==
   * null`), resolves it through `draftAcceptPort.accept` and replaces it IN
   * PLACE with a `draftId: null` copy carrying the real, materialized
   * `instrumentId` — the one moment `[D-097]`'s "answering it is accepting
   * it" actually happens (`rate`/`mcqAnswer`/`acceptEditDraft` are this
   * method's only callers). A no-op returning the item unchanged for an
   * ordinary instrument, so every caller can call this unconditionally
   * rather than branching on `draftId` itself.
   */
  private async resolveDraftAt(
    index: number,
    verdict: 'accepted' | 'edited',
  ): Promise<ReviewQueueItem> {
    const item = this.items[index];
    if (item === undefined) {
      throw new Error(`ReviewSession: no item at index ${index} to resolve`);
    }
    if (item.instrument.draftId === null) return item;

    const { instrumentId } = await this.deps.draftAcceptPort.accept(
      item.instrument.draftId,
      verdict,
    );
    const resolved: ReviewQueueItem = {
      ...item,
      instrument: { ...item.instrument, instrumentId, draftId: null },
    };
    this.items[index] = resolved;
    return resolved;
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
      // Row 3.9's write seam ([SUPP-3], `ol-lpl4`): `item.instrument.supportLevel`
      // is the chooser decision `queue-adapter.ts` computed at adaptation time
      // (`undefined` for an `'mcq'` item or a caller with no `supportHistory`
      // wired) — conditional spread, not `supportLevel: item.instrument.supportLevel`,
      // because `RecordReviewInput.supportLevel` is optional under
      // `exactOptionalPropertyTypes` and an explicit `undefined` value is not
      // the same as an absent key there.
      ...(item.instrument.supportLevel !== undefined
        ? { supportLevel: item.instrument.supportLevel }
        : {}),
    });

    // Called directly (rather than through `previewSingleInterval`) because
    // F2.12 needs the resulting `SchedulerState.lapses` this same call
    // produces — one `Scheduler.schedule` call, never two, for one rating.
    const scheduled = this.deps.scheduler.schedule({
      instrumentId: item.instrument.instrumentId,
      state: item.priorState,
      rating,
      now,
    });
    this.reviewedCount += 1;
    this.courseCodesSeen.add(item.instrument.courseCode);
    if (scheduled.intervalDays <= 1) this.dueSoonCount += 1;

    // F2.12 (`ol-h2bx`): evaluated after every graded review, for the
    // instrument that was just rated. An absent evaluator (no port wired)
    // never offers, matching every other optional port's "simply cannot
    // offer it" posture.
    const decision = this.deps.evaluateConfusionRouting?.({
      rating,
      lapses: scheduled.state.lapses,
    });
    this.pendingConfusionOffer = decision?.shouldOffer
      ? { instrument: item.instrument, promptText: decision.promptText }
      : null;

    this.index += 1;
    await this.presentCurrent();
  }
}
