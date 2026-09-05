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

import type { McqCorrectness, McqMisconceptionProvenance, Rating } from 'olea-contracts';
import type {
  BuildSchedulingObservationFieldInput,
  ConfusionRoutingDecision,
  ConfusionRoutingInput,
  McqRating,
  Scheduler,
  SchedulingObservationDecision,
  StrongRecallProposalDecision,
} from 'olea-core';
import { mapMcqRating, STRONG_RECALL_PROPOSAL_TRIGGER } from 'olea-core';
import type { DraftAcceptPort } from '../generation/accept.js';
import type { StampOnFirstSightPort } from '../instrument-stamping/port.js';
import type { GradeContestPort } from './contest.js';
import { CONTEST_GESTURE_LABEL, CONTEST_QUARANTINE_BADGE } from './copy.js';
import {
  buildExplainWhyRequest,
  type ExplainWhyOutcome,
  type ExplainWhyPort,
} from './explainWhy.js';
import { previewQaClozeIntervals, previewSingleInterval, type RatingPreview } from './interval.js';
import type {
  Clock,
  EditPort,
  ExplainBackOfferLogPort,
  NoteExistsPort,
  ReviewLogPort,
  SuspendPort,
} from './ports.js';
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
   * F5.3a / R7's third trigger for the SAME on-demand offer (`ol-0r92.11`,
   * `[D-083]`/`[D-087]`): an unconsumed scheduling observation naming the
   * just-graded instrument's concept as a neighbour. Composed at
   * `../grading/wiring.ts`'s `evaluateSchedulingObservationRouting`, a pure
   * delegate to `olea-core`'s function of the same name — but, unlike
   * `evaluateConfusionRouting` just above, the `liveObservations` map that
   * decision reads is per-vault and closed over by `../review/open-session.ts`
   * (the only production caller, since it already reads the whole log to
   * build `composed.entries`), not threaded onto this session's deps by
   * `main.ts` at plugin-construction time. Optional and absent by default,
   * same "simply cannot offer it" posture every other optional port here
   * has — an absent evaluator reads as "never offer."
   */
  readonly evaluateSchedulingObservationRouting?: (input: {
    readonly conceptIds: readonly string[];
  }) => SchedulingObservationDecision;
  /**
   * F2.21's third trigger for the SAME on-demand offer (`ol-v7r5.40`,
   * `[D-076]` round 3): is the concept the just-graded instrument teaches
   * one she is quietly good at, with no depth evidence on record? Composed
   * at `./strong-recall-wiring.ts`'s `createStrongRecallProposalReader`,
   * closed over the review log `../review/open-session.ts` already read to
   * compose this session — exactly the same "per-vault state closed over
   * here, not threaded from `main.ts`" reason
   * `evaluateSchedulingObservationRouting` just above gives, and for the
   * heavier reason too: this decision needs the concept's whole-log mastery
   * rollup and its vitality reading, neither of which this class holds or
   * should learn to compute.
   *
   * Optional and absent by default, same "simply cannot offer it" posture
   * every other optional port here has — an absent evaluator reads as "never
   * offer."
   */
  readonly evaluateStrongRecallProposal?: (input: {
    readonly conceptIds: readonly string[];
  }) => StrongRecallProposalDecision;
  /**
   * The kind-general grade-write producer for F5.3a/C5.11's scheduling
   * observation (`[D-185]`, `ol-0r92.41`) — NOT to be confused with
   * `evaluateSchedulingObservationRouting` just above, which reads an
   * observation a PRIOR review already wrote to decide whether to offer the
   * reciprocal explain-back; this one decides whether the review being
   * written RIGHT NOW carries a fresh observation of its own. Called for
   * every graded item, of any kind, and handed straight to `ReviewLogPort`
   * as the raw input — this class never calls `olea-core`'s single producer,
   * `buildSchedulingObservationField`, itself; `ports.ts`'s
   * `createVaultReviewLogPort` does, the same "caller decides, port writes"
   * split `RecordReviewInput.supportLevel` already uses for
   * `supportLevelReviewFields`, so this class holds no per-kind judgement of
   * its own about what counts as demonstrated use. Optional and absent by
   * default, same "simply cannot offer it" posture every other optional
   * port here has.
   *
   * **No production composer wires this yet, for any kind — that is a
   * follow-up, not an oversight.** MCQ, Q&A and cloze items carry no
   * "authored with a neighbour concept as context" signal anywhere in
   * today's queue-composition or generation pipeline (`ol-0r92.41`'s own
   * note: C5.11's kind-general authoring rule, `[D-185]`/ITEM-1, is ruled
   * but its generator-side wiring — `ol-0r92.33` — has not landed a caller
   * that could fill this in). Explain-back already has its own, separate
   * grade-write path (`packages/core/src/study-session/explain-back-grade-
   * write.ts`, driven from `explain-back/solo-review.ts`, not this class)
   * and is untouched by this dep. This exists so `logAndAdvance` is ready
   * the day a neighbour signal exists for one of the three kinds this class
   * does own, without a second wiring pass through this file.
   */
  readonly evaluateSchedulingObservationForGradeWrite?: (input: {
    readonly instrument: ReviewInstrument;
    readonly rating: Rating;
  }) => BuildSchedulingObservationFieldInput | undefined;
  /**
   * The grade case of the contest mechanism (`ol-fgba`, `[D-095]`). Optional
   * and absent by default for the same reason `explainWhyPort` is: a session
   * assembled without one cannot record a dispute, and an affordance that
   * cannot record is the dismiss button `[D-046]` clause 4 exists to rule out.
   * Absent reads as "cannot offer it", never as "offer it and drop the
   * record".
   */
  readonly gradeContestPort?: GradeContestPort;
  /**
   * `ol-2zfj.53`'s first-sight stamping trigger for a vault-AUTHORED
   * instrument (`instrument-stamping/port.ts`): consulted at the top of
   * `logAndAdvance`, before either the review-log write or the scheduler
   * call, so a marker written this exact moment is what both of them key
   * on rather than a provisional, position-derived stand-in. Optional and
   * absent by default, same "simply cannot offer it" posture every other
   * optional port here has — but degrades to "stay provisional" rather
   * than "never offer", since this is not a feature she is offered at all,
   * only a durability upgrade to an id she already has. `open-session.ts`'s
   * `createStampOnFirstSightPort` is the only production composer, closing
   * over the SAME `VaultInstrumentEnumeration` this session's queue was
   * built from — no second vault walk.
   */
  readonly stampOnFirstSight?: StampOnFirstSightPort;
  /**
   * The D7.1 write path for F2.12's explain-back offer and its paired
   * decline (`[D-178 / LOG-3]` item 2, `ol-0r92.28`). Optional and absent by
   * default, same "simply cannot offer it" posture every other optional
   * port here has — but degrades to "the banner still renders and just
   * writes nothing," the same shape `stampOnFirstSight`'s absence takes,
   * never to "never offer": a session with no writer wired can still show
   * her the offer, exactly as it always could before this bead.
   * `open-session.ts`'s `createVaultExplainBackOfferLogPort` (`ports.ts`) is
   * the only production composer.
   */
  readonly explainBackOfferLog?: ExplainBackOfferLogPort;
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

/**
 * F5.3a / R7's third-trigger pending offer (`ol-0r92.11`) — the instrument
 * that was JUST rated (same "not necessarily the one the view is currently
 * showing" caveat as `PendingConfusionRoutingOffer`), which concept the
 * observation names as neighbour, and the trigger's own reason line.
 */
export interface PendingSchedulingObservationOffer {
  readonly instrument: ReviewInstrument;
  readonly neighbourConceptId: string;
  readonly promptText: string;
}

/**
 * F2.21's pending offer (`ol-v7r5.40`) — the instrument that was JUST rated
 * (same caveat as the two above), which of its concepts the proposal is
 * about, and F2.21's own *"says why it is asking"* line.
 *
 * `conceptId` is carried because an instrument may be evidence for several
 * concepts (D-031) and the proposal is about exactly one of them: it is what
 * the offer record names, and what a reader of that record needs in order to
 * tell this offer from the same instrument's F2.12 one.
 */
export interface PendingStrongRecallOffer {
  readonly instrument: ReviewInstrument;
  readonly conceptId: string;
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
  /** F5.3a / R7's third trigger (`ol-0r92.11`) — set by `logAndAdvance` after every graded review, cleared by `resolveSchedulingObservationOffer`. */
  private pendingSchedulingObservationOffer: PendingSchedulingObservationOffer | null = null;
  /** F2.21's third trigger (`ol-v7r5.40`) — set by `logAndAdvance` after every graded review, cleared by `resolveStrongRecallOffer`. */
  private pendingStrongRecallOffer: PendingStrongRecallOffer | null = null;

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

  /**
   * The queue this session is walking, exactly as it stands — every item it
   * was constructed with plus anything appended by {@link continueWith}.
   *
   * Exists so a caller extending one session from a second, freshly-opened
   * one (`view.ts`'s "Continue" handler, `ol-0r92.32`) can hand that second
   * session's own queue over to {@link continueWith} without this class ever
   * reaching for a provider or a plan of its own — see that method's doc.
   * A snapshot, never the live array: mutating the result does nothing.
   */
  get queueSnapshot(): readonly ReviewQueueItem[] {
    return [...this.items];
  }

  /**
   * `[D-091]`'s "always free to keep going" (`ol-0r92.32`, component
   * register §3.7): resumes a `complete` session into `more` instead of
   * ending it, rather than replacing it with a second session that would
   * restart `reviewedCount`/`courseCodesSeen`/`dueSoonCount` from zero —
   * finishing today's due items is the declared target reached, never a
   * cap, so continuing past it stays the SAME session rather than a new one.
   *
   * **Never a second policy (D-091 point 1).** This method reorders,
   * re-ranks, re-selects or drops nothing of `more` — it is appended
   * verbatim and walked in the order it arrives. The only policy that ever
   * decided what she sees is whatever composed `deps.queue` in the first
   * place (`open-session.ts`'s `executeStudyPlan`, over the SAME cached
   * plan); `more` is expected to have come from that identical path — see
   * {@link queueSnapshot}'s doc for how `view.ts` sources it — so
   * "continuing" can never become a rival selection mechanism standing next
   * to it.
   *
   * A no-op returning `false` when not currently `complete`, or when `more`
   * is empty: nothing due beyond what she already finished is exactly the
   * honest state the ordinary empty screen already states, so this leaves
   * `complete` showing (Close still there) rather than inventing a second
   * "nothing to continue into" screen of its own.
   */
  async continueWith(more: readonly ReviewQueueItem[]): Promise<boolean> {
    if (this.phase !== 'complete' || more.length === 0) return false;
    this.items = [...this.items, ...more];
    await this.presentCurrent();
    return true;
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
   * Picking an option does NOT resolve a still-pending draft — mirroring
   * how `rate()` defers Q&A/cloze's resolution all the way to the tap that
   * actually leaves the reveal. `draftId` stays set on the item straight
   * through `mcq-answered`, so the header's reveal-gated draft pair (edit-
   * before-saving, reject — `view.ts`, `screen.kind === 'mcq-answered'`)
   * renders instead of the ordinary edit/suspend pair (`ol-0r92.42`,
   * `[D-189]`). Resolving here instead nulled `draftId` before that
   * viewmodel was built, which is exactly the bug this method used to have:
   * the reveal showed edit-and-suspend, and neither `acceptEditDraft` nor
   * `rejectDraft` could do anything because both no-op once `draftId` is
   * null.
   *
   * The interval preview below runs against the transient draft-id
   * stand-in (`generation/review-adapter.ts`'s doc) when the item is still
   * a draft — harmless, because `scheduler.schedule` is pure over
   * `{ instrumentId, state, rating, now }` and never looks the id up
   * anywhere; the label is identical either way. `mcqNext` is what
   * actually materializes an accepted draft, exactly once, right before
   * `logAndAdvance` needs the real id for the write.
   */
  async mcqAnswer(optionIndex: number): Promise<void> {
    if (this.phase !== 'mcq-open') return;
    const item = this.requireCurrent();
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
   *
   * **Reachable while the current item is still a pending draft**
   * (`instrument.draftId !== null`) — `[D-189]`/`ol-0r92.42` defers an MCQ
   * draft's materialization to `mcqNext` specifically so the edit/reject
   * pair stays live through `mcq-answered`, and the contest gesture renders
   * on that same screen (`view.ts`'s header), independently of that pair.
   * Contesting commits her to the grade being about a real instrument — the
   * same "engaging with it is accepting it" posture `rate()` already has for
   * Q&A/cloze — so this resolves the draft first, exactly as `rate()` does,
   * before the contest key or `GradeContestPort` call is built. That keeps
   * `contestedGrades`, this call, and the review-log entry `logAndAdvance`
   * eventually writes all keyed on the SAME materialized id, never the
   * transient draft-id stand-in (`ol-0r92.43`) — without it, the dispute
   * record and `quarantinedGradeInstrumentIds`'s later fold would disagree
   * on which instrument is quarantined and the re-derivation would never
   * find it.
   *
   * `resolveDraftAt`'s own no-op-when-already-resolved and idempotent-accept
   * guarantees mean `mcqNext`'s later `resolveDraftAt` call on this same item
   * is then a true no-op — the same shape any item resolved earlier by
   * `rate()`/`acceptEditDraft` already produces. The one visible side effect:
   * once contested, `instrument.draftId` is `null`, so a subsequent
   * `acceptEditDraft`/`rejectDraft` on this item silently no-ops — the same
   * "no-op past an already-resolved draft" contract those two already
   * document, not a new one introduced here.
   */
  async contestGrade(): Promise<void> {
    if (this.phase !== 'mcq-answered') return;
    const port = this.deps.gradeContestPort;
    if (port === undefined) return;

    const item = await this.resolveDraftAt(this.index, 'accepted');
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

  /**
   * The MCQ side of `[D-097]`'s "answering it is accepting it": a still-
   * pending draft is materialized here — real `instrumentId` minted, same
   * `resolveDraftAt` call `rate()` makes for Q&A/cloze — before
   * `logAndAdvance` writes anything, so the review log and scheduler both
   * key on the real instrument, never the transient draft-id stand-in.
   * A no-op resolution (same item back) for an ordinary instrument.
   * `acceptEditDraft`/`rejectDraft` already carried their own verdicts by
   * the time this can run, since both remove or resolve the draft (and, for
   * reject, splice the item out of the queue) before she ever reaches
   * `mcq-next` — this is reached only on passive accept.
   */
  async mcqNext(): Promise<void> {
    if (this.phase !== 'mcq-answered') return;
    const item = await this.resolveDraftAt(this.index, 'accepted');
    const instrument = this.requireMcq(item);
    const rating = this.mcqRating(instrument, this.mcqSelectedIndex);
    const correctness = this.mcqCorrectness(instrument, this.mcqSelectedIndex);
    const misconceptionDistractor = this.mcqMisconceptionDistractor(
      instrument,
      this.mcqSelectedIndex,
    );
    await this.logAndAdvance(item, rating, this.wasUnsure, correctness, misconceptionDistractor);
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

  /**
   * The D7.1 write for an F2.12 offer the instant it reaches the surface
   * (`[D-178 / LOG-3]` item 2, `ol-0r92.28`). `view.ts`'s
   * `syncConfusionRoutingOffer` calls this from its offer-arrives branch and
   * holds the returned event id, so a later decline (below) can name it —
   * never the caller reaching for `deps.explainBackOfferLog` directly, the
   * same "thread it through session deps" seam `recordReview` already uses.
   *
   * `null` when no `explainBackOfferLog` port is wired: the banner still
   * renders (this method has no bearing on `pendingConfusionOffer`), and a
   * `null` return here is exactly what the paired `recordExplainBackOfferDeclined`
   * treats as "nothing to pair" and skips.
   */
  recordExplainBackOfferShown(instrument: ReviewInstrument): string | null {
    if (this.deps.explainBackOfferLog === undefined) return null;
    return this.deps.explainBackOfferLog.recordOffered({
      conceptIds: instrument.conceptIds,
      trigger: 'repeated-failure',
      instrumentId: instrument.instrumentId,
    });
  }

  /**
   * The paired write for an F2.12 offer that left the surface unaccepted
   * (`[D-178 / LOG-3]` item 2, `ol-0r92.28`). `offerEventId` is whatever
   * `recordExplainBackOfferShown` returned for the SAME offer — `null` means
   * there was nothing to pair (no port wired, or the offered write never
   * happened), so this is a no-op rather than a decline naming nothing.
   * `view.ts`'s `syncConfusionRoutingOffer` calls this from its
   * clears-unaccepted branch, the same "one call site each" split its own
   * doc describes for the offer/decline pair.
   */
  recordExplainBackOfferDeclined(instrument: ReviewInstrument, offerEventId: string | null): void {
    if (this.deps.explainBackOfferLog === undefined || offerEventId === null) return;
    this.deps.explainBackOfferLog.recordDeclined({
      conceptIds: instrument.conceptIds,
      trigger: 'repeated-failure',
      instrumentId: instrument.instrumentId,
      answers: offerEventId,
    });
  }

  /**
   * F5.3a / R7's offer for the caller to render, or `null` when none is
   * pending (`ol-0r92.11`). Same "read after every render, not inside
   * `ReviewViewModel`'s phase union" posture as `getConfusionRoutingOffer` —
   * this offer is about the instrument that was JUST rated.
   */
  getSchedulingObservationOffer(): PendingSchedulingObservationOffer | null {
    return this.pendingSchedulingObservationOffer;
  }

  /**
   * The one available action for F5.3a's offer, mirroring
   * `resolveConfusionRoutingOffer` exactly: resolves the just-offered
   * instrument and clears the pending offer, nothing more. Returns `null`
   * without touching anything when there is nothing pending.
   */
  resolveSchedulingObservationOffer(): PendingSchedulingObservationOffer | null {
    const offer = this.pendingSchedulingObservationOffer;
    if (offer === null) return null;
    this.pendingSchedulingObservationOffer = null;
    return offer;
  }

  /**
   * The D7.1 write for an F5.3a offer the instant it reaches the surface
   * (`[D-178 / LOG-3]` item 2 widened by `[D-204 / LOG-4]`, `ol-0r92.25`) —
   * mirrors `recordExplainBackOfferShown` exactly, except the concept named
   * is the NEIGHBOUR concept the offer is about (`offer.neighbourConceptId`),
   * never `offer.instrument.conceptIds` (the subject just rated, which is
   * evidence FOR the neighbour, not what the offer itself concerns), and the
   * trigger is the fourth literal `[D-204]` added rather than F2.12's
   * `repeated-failure`. `view.ts`'s `syncSchedulingObservationOffer` calls
   * this from its offer-arrives branch and holds the returned event id for
   * the paired decline below — same seam, same "thread it through session
   * deps" discipline.
   */
  recordSchedulingObservationOfferShown(offer: PendingSchedulingObservationOffer): string | null {
    if (this.deps.explainBackOfferLog === undefined) return null;
    return this.deps.explainBackOfferLog.recordOffered({
      conceptIds: [offer.neighbourConceptId],
      trigger: 'scheduling-observation',
      instrumentId: offer.instrument.instrumentId,
    });
  }

  /**
   * The paired write for an F5.3a offer that left the surface unaccepted
   * (`[D-178 / LOG-3]` item 2 widened by `[D-204 / LOG-4]`) — mirrors
   * `recordExplainBackOfferDeclined` exactly, with the same
   * neighbour-concept/trigger substitution `recordSchedulingObservationOfferShown`
   * above documents. `offerEventId` is whatever that method returned for the
   * SAME offer; `null` means nothing to pair, same no-op posture.
   */
  recordSchedulingObservationOfferDeclined(
    offer: PendingSchedulingObservationOffer,
    offerEventId: string | null,
  ): void {
    if (this.deps.explainBackOfferLog === undefined || offerEventId === null) return;
    this.deps.explainBackOfferLog.recordDeclined({
      conceptIds: [offer.neighbourConceptId],
      trigger: 'scheduling-observation',
      instrumentId: offer.instrument.instrumentId,
      answers: offerEventId,
    });
  }

  /**
   * F2.21's offer for the caller to render, or `null` when none is pending
   * (`ol-v7r5.40`). Same "read after every render, not inside
   * `ReviewViewModel`'s phase union" posture the two offers above have —
   * this offer is about the instrument that was JUST rated.
   */
  getStrongRecallOffer(): PendingStrongRecallOffer | null {
    return this.pendingStrongRecallOffer;
  }

  /**
   * The one available action for F2.21's offer, mirroring
   * `resolveConfusionRoutingOffer` exactly: resolves the just-offered
   * instrument and clears the pending offer, nothing more. Returns `null`
   * without touching anything when there is nothing pending.
   *
   * The destination is `ExplainBackModal` seeded from the offer's own
   * instrument, exactly as F2.12's is — unlike F5.3a's offer, this one is
   * about a concept the graded instrument already teaches, so the seed is
   * never invented.
   */
  resolveStrongRecallOffer(): PendingStrongRecallOffer | null {
    const offer = this.pendingStrongRecallOffer;
    if (offer === null) return null;
    this.pendingStrongRecallOffer = null;
    return offer;
  }

  /**
   * The D7.1 write for an F2.21 offer the instant it reaches the surface —
   * mirrors `recordExplainBackOfferShown` exactly, except the concept named
   * is the one the PROPOSAL is about (`offer.conceptId`, one of the
   * instrument's several under D-031) and the trigger is the literal
   * `olea-core`'s decision module names,
   * {@link STRONG_RECALL_PROPOSAL_TRIGGER}, never hand-typed here.
   *
   * **No persisted schema change**: `strong-recall-proposal` has been a
   * member of `olea-contracts`' `explainBackOfferTrigger` since
   * `[D-178 / LOG-3]`; this is the first writer of it.
   */
  recordStrongRecallOfferShown(offer: PendingStrongRecallOffer): string | null {
    if (this.deps.explainBackOfferLog === undefined) return null;
    return this.deps.explainBackOfferLog.recordOffered({
      conceptIds: [offer.conceptId],
      trigger: STRONG_RECALL_PROPOSAL_TRIGGER,
      instrumentId: offer.instrument.instrumentId,
    });
  }

  /**
   * The paired write for an F2.21 offer that left the surface unaccepted —
   * mirrors `recordExplainBackOfferDeclined` exactly, with the same
   * concept/trigger substitution `recordStrongRecallOfferShown` documents.
   * `manner` is `'not-taken'`, written by the port: F2.14a rules there is no
   * dismiss control and declining is not a state.
   */
  recordStrongRecallOfferDeclined(
    offer: PendingStrongRecallOffer,
    offerEventId: string | null,
  ): void {
    if (this.deps.explainBackOfferLog === undefined || offerEventId === null) return;
    this.deps.explainBackOfferLog.recordDeclined({
      conceptIds: [offer.conceptId],
      trigger: STRONG_RECALL_PROPOSAL_TRIGGER,
      instrumentId: offer.instrument.instrumentId,
      answers: offerEventId,
    });
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

  /**
   * `[D-205 / SIG-2]` (`ol-yj0k`, `ol-egov.96`) — the behavioural signal this
   * bead persists, captured at the exact spot `mcqRating` just above already
   * reads `option?.correct` transiently to build the self-rating. Never
   * content (D-005): an opaque index and a boolean, never the option's
   * label. `chosenIndex: -1` cannot reach `mcqNext` in practice (only
   * reachable from `mcq-answered`, which requires a real `mcqAnswer` tap
   * first), but this mirrors `mcqRating`'s own `?? -1` defensive read rather
   * than assuming a non-null selection.
   */
  private mcqCorrectness(instrument: McqItem, selectedIndex: number | null): McqCorrectness {
    const chosenIndex = selectedIndex ?? -1;
    const option = instrument.options[chosenIndex];
    return { chosenIndex, matchedKey: option?.correct ?? false };
  }

  /**
   * `[D-202]` (`ol-egov.92`, `ol-0r92.44`) — the chosen distractor's
   * misconception provenance, computed at the same spot `mcqCorrectness`
   * just above reads the same option. `undefined` — never appended, per
   * `ReviewLogPort.recordReview`'s doc — for a correct pick, for no
   * selection, and for a wrong pick whose option carries no `believes`/
   * `source_says` (every option today: see `McqOption`'s own doc for why
   * nothing populates these two fields yet). `misconceptionId` is minted
   * downstream, in `packages/core/src/review-log/write.ts`'s
   * `appendMisconceptionObservedRecord` — never here, and never matched
   * against prior occurrences first (`[D-202]`'s own words).
   */
  private mcqMisconceptionDistractor(
    instrument: McqItem,
    selectedIndex: number | null,
  ): McqMisconceptionProvenance | undefined {
    const chosenIndex = selectedIndex ?? -1;
    const option = instrument.options[chosenIndex];
    if (option === undefined || option.correct) return undefined;
    if (option.believes === undefined || option.source_says === undefined) return undefined;
    return { text: option.label, believes: option.believes, source_says: option.source_says };
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
   * it" actually happens (`rate`/`acceptEditDraft`/`contestGrade`/`mcqNext`
   * are this method's only callers — NOT `mcqAnswer`, which deliberately
   * defers resolution so the reveal-gated edit/reject pair stays live
   * through `mcq-answered`, per that method's own doc). A no-op returning
   * the item unchanged for an ordinary instrument, or one already resolved
   * by an earlier caller (`accept`'s own idempotency guarantee makes a
   * second `accept` on the same draft id safe too), so every caller can call
   * this unconditionally rather than branching on `draftId` itself.
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

  /**
   * `ol-2zfj.53`'s first-sight stamping trigger. A no-op, returning `item`
   * unchanged, when `deps.stampOnFirstSight` is not wired (a test, or a
   * caller that has not composed the vault write yet) or when the port
   * reports the id unchanged (already durable, or nothing could be located
   * to stamp). Otherwise replaces `item` — both the copy this method
   * returns and `this.items[this.index]` in place — with one carrying the
   * durable id, the same "resolve in place before anything downstream reads
   * the id" shape `resolveDraftAt` already uses for a materialized draft.
   */
  private async stampOnFirstSight(item: ReviewQueueItem): Promise<ReviewQueueItem> {
    if (this.deps.stampOnFirstSight === undefined) return item;
    const { instrumentId } = await this.deps.stampOnFirstSight(item.instrument.instrumentId);
    if (instrumentId === item.instrument.instrumentId) return item;
    const resolved: ReviewQueueItem = {
      ...item,
      instrument: { ...item.instrument, instrumentId },
    };
    this.items[this.index] = resolved;
    return resolved;
  }

  private async logAndAdvance(
    item: ReviewQueueItem,
    rating: Rating,
    wasUnsure: boolean,
    correctness?: McqCorrectness,
    misconceptionDistractor?: McqMisconceptionProvenance,
  ): Promise<void> {
    // Stamped BEFORE the review-log write or the scheduler call below, so a
    // marker minted this exact moment is what both of them key on — never
    // the provisional, position-derived id it replaces.
    const stamped = await this.stampOnFirstSight(item);

    const now = this.deps.clock.now();
    const durationMs =
      this.presentedAtMs !== null ? Math.max(0, now.getTime() - this.presentedAtMs) : null;

    // F5.3a / C5.11's grade-write half, widened kind-general by `[D-185]`
    // (`ol-0r92.41`): built BEFORE the write below, from the same optional,
    // absent-by-default port every other decision in this method reads. The
    // RAW producer input is handed to `recordReview`, not the built field —
    // `ports.ts`'s `createVaultReviewLogPort` is what calls `olea-core`'s
    // `buildSchedulingObservationField`, same "caller decides, port writes"
    // split `supportLevel` already uses below. See
    // `evaluateSchedulingObservationForGradeWrite`'s own doc for why nothing
    // wires the evaluator itself yet for any of the three kinds this class
    // owns.
    const schedulingObservationInput = this.deps.evaluateSchedulingObservationForGradeWrite?.({
      instrument: stamped.instrument,
      rating,
    });

    await this.deps.reviewLog.recordReview({
      instrument: stamped.instrument,
      rating,
      wasUnsure,
      durationMs,
      selectionContext: stamped.selectionContext,
      // Row 3.9's write seam ([SUPP-3], `ol-lpl4`): `stamped.instrument.supportLevel`
      // is the chooser decision `queue-adapter.ts` computed at adaptation time
      // (`undefined` for an `'mcq'` item or a caller with no `supportHistory`
      // wired) — conditional spread, not `supportLevel: stamped.instrument.supportLevel`,
      // because `RecordReviewInput.supportLevel` is optional under
      // `exactOptionalPropertyTypes` and an explicit `undefined` value is not
      // the same as an absent key there.
      ...(stamped.instrument.supportLevel !== undefined
        ? { supportLevel: stamped.instrument.supportLevel }
        : {}),
      // Same conditional-spread discipline as `supportLevel` just above, and
      // for the same `exactOptionalPropertyTypes` reason.
      ...(schedulingObservationInput !== undefined ? { schedulingObservationInput } : {}),
      // `[D-205 / SIG-2]`: present only when `mcqNext` computed it (an MCQ
      // review) — `rate()`'s Q&A/cloze call never passes a fourth argument,
      // so this stays absent there, never a fabricated `false`/`-1` pair.
      ...(correctness !== undefined ? { correctness } : {}),
      // `[D-202]`: present only when `mcqNext` computed it — a wrong pick
      // whose chosen option carried provenance. `ports.ts`'s
      // `createVaultReviewLogPort` is what turns this into a SEPARATE
      // `misconception-observed` append, never a field merged onto this
      // same record — see `RecordReviewInput.misconceptionDistractor`'s doc.
      ...(misconceptionDistractor !== undefined ? { misconceptionDistractor } : {}),
    });

    // Called directly (rather than through `previewSingleInterval`) because
    // F2.12 needs the resulting `SchedulerState.lapses` this same call
    // produces — one `Scheduler.schedule` call, never two, for one rating.
    const scheduled = this.deps.scheduler.schedule({
      instrumentId: stamped.instrument.instrumentId,
      state: stamped.priorState,
      rating,
      now,
    });
    this.reviewedCount += 1;
    this.courseCodesSeen.add(stamped.instrument.courseCode);
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
      ? { instrument: stamped.instrument, promptText: decision.promptText }
      : null;

    // F5.3a / R7's third trigger (`ol-0r92.11`): evaluated after every
    // graded review, for the concept(s) the instrument just rated is
    // evidence for — never gated on `rating`, unlike F2.12 above, because an
    // unconsumed observation is worth surfacing regardless of how this
    // particular review of the neighbour concept went (F2.14/F2.21: this
    // proposes, it does not schedule). An absent evaluator never offers,
    // same posture as every other optional port.
    const schedulingObservationDecision = this.deps.evaluateSchedulingObservationRouting?.({
      conceptIds: stamped.instrument.conceptIds,
    });
    this.pendingSchedulingObservationOffer = schedulingObservationDecision?.shouldOffer
      ? {
          instrument: stamped.instrument,
          neighbourConceptId: schedulingObservationDecision.neighbourConceptId,
          promptText: schedulingObservationDecision.promptText,
        }
      : null;

    // F2.21's third trigger (`ol-v7r5.40`): the same reveal-screen moment,
    // for the concept(s) the instrument just rated is evidence for. Not
    // gated on `rating` — like F5.3a above and unlike F2.12, because this
    // trigger is about accumulated evidence across spaced days, not about
    // this answer.
    //
    // **Suppressed when F2.12 has already fired for this same item.** They
    // are the same offer — the same action, the same `ExplainBackModal`
    // seeded from the same instrument — which F2.21 itself says, calling
    // itself "the same offer shape as F2.12's … triggered from the opposite
    // side of the evidence." Two banners would be one offer shown twice. No
    // such suppression against F5.3a's offer: that one's destination is a
    // DIFFERENT concept, so the two are genuinely two offers, and they
    // already co-exist by test.
    const strongRecallDecision =
      this.pendingConfusionOffer === null
        ? this.deps.evaluateStrongRecallProposal?.({
            conceptIds: stamped.instrument.conceptIds,
          })
        : undefined;
    this.pendingStrongRecallOffer = strongRecallDecision?.shouldPropose
      ? {
          instrument: stamped.instrument,
          conceptId: strongRecallDecision.conceptId,
          promptText: strongRecallDecision.promptText,
        }
      : null;

    this.index += 1;
    await this.presentCurrent();
  }
}
