/**
 * `ReviewView` — the full-tab review session (F2.2, F2.4, F2.6, F2.13,
 * Q6.5). This file and `obsidian-source.ts`/`obsidian-ports.ts` are the only
 * places under `packages/plugin` that build real DOM against a real
 * Obsidian host, so — same reasoning as `settings-tab.ts`'s module doc —
 * there is no test file here and none is expected: `ReviewSession`
 * (`session.spec.ts`), `keymap.ts` (`keymap.spec.ts`), `copy.ts`
 * (`copy.spec.ts`), `interval.ts` (`interval.spec.ts`) and — since the view
 * was wired to the product — `open-session.ts` (`open-session.spec.ts`, which
 * covers everything about *what queue this view is handed*) carry every
 * scenario that doesn't need a real DOM.
 *
 * **What "thin, mechanical glue" is now true of, having not been (ol-09kf).**
 * It builds the header, builds one of eight screens — the seven
 * `ReviewSession.getViewModel()` phases, plus the "could not compose a
 * session at all" screen it renders when its provider hands back `null` —
 * wires clicks and one `keydown` listener through `resolveReviewKey`, and
 * re-renders. Every string it *derives* —
 * the session-complete paragraph, the MCQ feedback line, the course list,
 * the rating labels, the cloze blank, and every keycap glyph — comes from
 * `copy.ts` and is asserted there. What it still owns, and should:
 *
 *   - **Structure**: elements, classes, nesting, the focus ring's
 *     `data-olea-focusable` marker, focus restoration across re-renders.
 *   - **Fixed labels on controls it builds**: "Edit note", "Suspend",
 *     "Close", "Skip for now", "Remove from queue", "next item", "You
 *     chose", "From your own note", "Loading review…", the note-missing
 *     explanation. Unconditional, derived from nothing, asserting nothing,
 *     and meaningless away from the element they name. A label that starts
 *     varying with state, counting something, or promising a date has left
 *     that category and belongs in `copy.ts`.
 *
 * The distinction is worth keeping sharp, because this file's own doc is
 * what tells the next reader there is nothing here worth testing — and for
 * three passes that sentence was covering for a paragraph that told her when
 * her items were coming back.
 *
 * **Dark by default, regardless of her theme (F2.4).** `contentEl` gets the
 * `theme-dark` class directly. Obsidian's own theming convention scopes a
 * theme's dark-mode variable values under `.theme-dark` on `<body>`; adding
 * that class to this view's own root, rather than reading whatever the
 * ambient body carries, makes every `var(--background-primary, …)` etc.
 * declared in `styles.css` resolve through the *dark* branch of her actual
 * installed theme. A CSS custom property set directly on an element always
 * wins over one inherited from an ancestor, regardless of the ancestor's
 * class, so this requires no fighting with the rest of Obsidian and undoes
 * itself the instant this view closes (F2.4's "leaving review returns her
 * to light immediately" scenario) — nothing outside `contentEl` is ever
 * touched.
 *
 * **What that class does NOT buy, and where the guarantee actually lives
 * (ol-ro57).** This doc used to claim the result was "still her real
 * theme's colours, just always the dark half of it". It isn't, on its own.
 * The class only makes the theme's `.theme-dark`-scoped declarations apply
 * to this element; a variable the theme declares in *only* its light branch
 * has no declaration here at all, so this root — a `.theme-dark` element
 * nested inside a `.theme-light` body — **inherits the light value** for it
 * while everything declared in both resolves dark. Real themes do declare
 * different sets in their two branches (Things 2.2.4 declares
 * `--background-modifier-hover` only under `.theme-light`), and the result
 * was a mixed palette that rendered every keycap unreadable. Adding this
 * class is therefore necessary but not sufficient: what makes F2.4 hold is
 * the `olea-host-fallback` cascade layer in `styles.css`, which puts a dark
 * floor under every branch-varying colour role while still letting the
 * host's own `.theme-dark` rules win. Read that file's header before
 * changing either half.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { ReviewActivityNotifier } from './activity.js';
import {
  actionKeycap,
  EXPLAIN_WHY_REFUSAL,
  mcqFeedbackSentence,
  mcqOptionKeycap,
  questionText,
  REGISTRY_ENTRY_ACTION,
  REVIEW_UNAVAILABLE_BODY,
  REVIEW_UNAVAILABLE_TITLE,
  ratingKeycap,
  ratingLabel,
  SESSION_COMPLETE_CONTINUE_LABEL,
  sessionCompleteSentence,
  verifiedKeycap,
} from './copy.js';
import type { ExplainWhyOutcome } from './explainWhy.js';
import {
  HEADING_OFFER_ACCEPT_LABEL,
  HEADING_OFFER_DISMISS_LABEL,
  HEADING_OFFER_PROMPT_TEXT,
} from './heading-offer.js';
import type { HeadingOfferBannerState, HeadingOfferBannerTracker } from './heading-offer-wiring.js';
import type { RatingPreview } from './interval.js';
import {
  hasGlobalBindings,
  hintsFor,
  type ReviewAction,
  type ReviewScreen,
  resolveReviewKey,
} from './keymap.js';
import type {
  PendingConfusionRoutingOffer,
  ReviewSession,
  ReviewViewModel,
  SessionCompleteSummary,
} from './session.js';
import type { ClozeCard, McqItem, QaCard, ReviewInstrument, ReviewQueueItem } from './types.js';

/**
 * F2.7's on-demand panel state, keyed by which instrument the last request
 * was about — so a re-render for a DIFFERENT current item never shows a
 * stale result (`ol-sn1q`).
 */
type ExplainWhyPanelState =
  | { readonly instrumentId: string; readonly status: 'loading' }
  | { readonly instrumentId: string; readonly status: 'done'; readonly outcome: ExplainWhyOutcome };

/**
 * F2.12's offer banner state (`ol-h2bx`, destination changed by `[D-163]`/
 * `ol-12gs`). `presentedWithInstrumentId` is the instrument that was current
 * the moment the offer first appeared — the banner clears itself once she
 * moves past THAT item (see `syncConfusionRoutingOffer`'s doc), which is
 * what keeps it from lingering indefinitely without an explicit "decline"
 * control (F2.12's own "one available action" framing).
 *
 * **No `status`/`outcome` fields any more.** Accepting used to call an
 * `ExplainWhyPort` inline and render its async result in this banner; now
 * accepting opens `ExplainBackModal` (a separate `Modal`, not a panel this
 * view renders), so there is nothing left for this banner to show once the
 * one action is taken — see `handleAcceptConfusionOffer`'s own doc.
 */
interface ConfusionBannerState {
  readonly instrument: ReviewInstrument;
  readonly promptText: string;
  readonly presentedWithInstrumentId: string | null;
  /**
   * The event id `ReviewSession.recordExplainBackOfferShown` returned when
   * this offer arrived (`[D-178 / LOG-3]` item 2, `ol-0r92.28`) — held so a
   * later decline can name it via `answers`. `null` when no
   * `explainBackOfferLog` port is wired; the paired decline write is then
   * skipped rather than naming nothing.
   */
  readonly offerEventId: string | null;
}

/**
 * F2.7's grounding half (`ol-sn1q`): retrieves `sourceChunks` for an
 * instrument before either the on-demand tap or F2.12's "explain it back"
 * calls into `ReviewSession`. Injected so `view.ts` never imports
 * `olea-core`'s retrieval machinery directly — `main.ts` composes it from
 * the real keyword index and embedding cache, same as every other
 * Obsidian-only composition in this package.
 */
export type RetrieveExplainWhySourceChunks = (
  instrument: ReviewInstrument,
) => Promise<readonly string[]>;

export const VIEW_TYPE_OLEA_REVIEW = 'olea-review';

const FOCUSABLE_ATTR = 'data-olea-focusable';

/**
 * How this view gets its session — called once, on open (`ol-p2t08a`).
 *
 * It takes a *provider* rather than a `ReviewSession` because Obsidian's
 * `registerView` factory is synchronous and composing a session is not: it
 * walks the vault and reads the review log. Deferring the build into `onOpen`
 * is also what makes the tab correct when Obsidian restores it at startup with
 * no command behind it — the queue is rebuilt from the vault as it is *now*,
 * rather than the tab reopening onto whatever was composed before the restart.
 *
 * `null` means "the session could not be built" — a vault that could not be
 * walked, not a vault with nothing due. The two render differently, because
 * "You're caught up" is a claim and an unreadable vault supports no claim at
 * all. See `open-session.ts`.
 */
export type ReviewSessionProvider = () => ReviewSession | null | Promise<ReviewSession | null>;

// ---------------------------------------------------------------------------
// F2.10 heading-offer banner — THE MOUNT (`[D-170]`/`[GEN-2]`, `ol-0r92.27`;
// wired by `ol-i19f`).
//
// A free function rather than a `ReviewView` method, deliberately: F2.10's
// offer belongs to a heading in whichever note she has open, not to "the
// currently reviewed instrument" `this.session` tracks in general — see
// `heading-offer-wiring.ts`'s own module doc for the narrower, concretely
// reachable case `ol-i19f` actually wires (the current review item's own
// source note) and why that is a deliberate first step rather than the
// full-generality trigger this paragraph once described as open. Matching a
// live note's headings to a `HeadingOfferCandidate` (`olea-core`'s
// `detectHeadingOffers`), resolving its concept, and deciding *when* to
// mount this banner all live in `heading-offer-wiring.ts`, never here —
// `render()` below calls `this.headingOffer?.bannerFor(...)` (a
// `HeadingOfferBannerTracker`) and gets back a ready `HeadingOfferBannerState`
// or `null`; this function still knows nothing about candidates, concepts or
// the port.
//
// Copy comes from `heading-offer.ts` (F2.10's own wording, `[D-170]`'s two
// verbs) rather than being hand-typed a second time here — the same
// discipline this file's own module doc asks of every *derived* string, one
// step further: these three strings are fixed, but still owned by the module
// whose contract citation they carry, not duplicated into a UI-only file.
//
// Click wiring is left to the caller (returned as plain `HTMLButtonElement`s)
// rather than bound here with `addEventListener`/`registerDomEvent`: this
// function has no `Component` of its own to scope a listener's lifecycle to;
// `render()` below is the caller that owns that lifecycle and calls
// `registerDomEvent` against itself, then calls the bound
// `HeadingOfferBannerState.accept`/`dismiss` `heading-offer-wiring.ts` handed
// it — never a `HeadingOfferPort` directly. Untested here for the same
// reason every other DOM builder in this file is untested (module doc,
// above): `createDiv`/`createEl` are Obsidian's own `HTMLElement` extensions
// and only exist inside a real Obsidian host; `heading-offer-wiring.spec.ts`
// covers everything about *what* gets offered and *when* without a DOM.
export interface HeadingOfferBannerHandles {
  readonly container: HTMLElement;
  readonly acceptButton: HTMLButtonElement;
  readonly dismissButton: HTMLButtonElement;
}

export function renderHeadingOfferBanner(
  parent: HTMLElement,
  promptText: string = HEADING_OFFER_PROMPT_TEXT,
): HeadingOfferBannerHandles {
  const banner = parent.createDiv({ cls: 'olea-review-heading-offer-banner' });
  banner.createEl('p', { cls: 'olea-review-heading-offer-prompt', text: promptText });

  const actions = banner.createDiv({ cls: 'olea-review-heading-offer-actions' });

  const acceptButton = actions.createEl('button', {
    cls: 'olea-review-primary-action',
    attr: { [FOCUSABLE_ATTR]: 'true' },
  });
  acceptButton.createSpan({ text: HEADING_OFFER_ACCEPT_LABEL });

  const dismissButton = actions.createEl('button', {
    cls: 'olea-review-ghost-action',
    attr: { [FOCUSABLE_ATTR]: 'true' },
  });
  dismissButton.createSpan({ text: HEADING_OFFER_DISMISS_LABEL });

  return { container: banner, acceptButton, dismissButton };
}

export class ReviewView extends ItemView {
  private readonly openSession: ReviewSessionProvider;
  private readonly activity: ReviewActivityNotifier;
  private readonly retrieveSourceChunks: RetrieveExplainWhySourceChunks | undefined;
  private readonly openExplainBack: ((instrument: ReviewInstrument) => void) | undefined;
  /** `[D-171]`'s one-step affordance target — see `constructor`'s own param doc. */
  private readonly openRegistryEntry: ((instrumentId: string) => void) | undefined;
  /** F2.10's surface wiring (`ol-i19f`) — see `constructor`'s own param doc and `heading-offer-wiring.ts`. */
  private readonly headingOffer: HeadingOfferBannerTracker | undefined;
  /** `ol-v7r5.35` (`[D-193]`) — see `constructor`'s own param doc and `continueSessionAfterComplete`'s. */
  private readonly extendSession: (() => Promise<readonly ReviewQueueItem[]>) | undefined;
  /** `ol-v7r5.35` (`[D-193]`) — see `constructor`'s own param doc and `onClose`'s. */
  private readonly releaseSession: (() => void) | undefined;
  private session: ReviewSession | null = null;
  private started = false;
  private explainWhyPanel: ExplainWhyPanelState | null = null;
  private confusionBanner: ConfusionBannerState | null = null;

  /**
   * `onReviewActivity` fires whenever her due counts may have moved, which is
   * two moments, not one — see `review/activity.ts` for the policy and the
   * tests that run it.
   *
   * It fires from `onClose` below, whatever her review actually did: completed
   * the queue, closed early after some ratings, or never composed at all. Every
   * one of those already wrote to the review log (rating writes happen per-item,
   * not at the end) or changed nothing; refreshing either way is cheap and
   * correct.
   *
   * It ALSO fires when the session reaches `complete` with the tab still open.
   * Run 10 had only the close path, and that missed the ordinary case:
   * `main.ts`'s `revealTodayView` opens Today in the right sidebar, so Today is
   * normally visible NEXT TO an open review tab, and there is no reason to close
   * review just because the queue ran out. Without this, she finishes the last
   * card and the panel beside her still shows the count she started with — which
   * is `ol-h3wy`'s own description of the bug, surviving the fix for it.
   *
   * `main.ts` wires this to `today/refresh.ts`'s `refreshOpenTodayViews`.
   */
  constructor(
    leaf: WorkspaceLeaf,
    openSession: ReviewSessionProvider,
    onReviewActivity?: () => void,
    retrieveSourceChunks?: RetrieveExplainWhySourceChunks,
    /** F2.12, `[D-163]` (`ol-12gs`): opens `ExplainBackModal` for the offered instrument — see `handleAcceptConfusionOffer`'s own doc. */
    openExplainBack?: (instrument: ReviewInstrument) => void,
    /**
     * `[D-171]`/`ol-2zfj.47`: the one-step affordance F8.4 asks every
     * instrument-rendering surface for — leads to that instrument's registry
     * entry, never prints provenance here. `main.ts` wires this to
     * `openRegistryEntryFor(this.app, { instrumentId })`
     * (`registry/obsidian-ports.ts`); a callback rather than an `App`
     * import keeps this file free of the real-Obsidian-host constraint that
     * already governs `openExplainBack` above.
     */
    openRegistryEntry?: (instrumentId: string) => void,
    /**
     * F2.10's surface wiring (`ol-i19f`): checked against the current
     * review item's own source note on every render, via
     * `heading-offer-wiring.ts`'s `HeadingOfferBannerTracker` —
     * `main.ts` wires this to `createHeadingOfferBannerTracker` over the
     * real `HeadingOfferPort`, vault and folded `ConceptRecord[]`. Absent
     * means no offer is ever checked for, same grey-out-by-omission posture
     * `retrieveSourceChunks`/`openRegistryEntry` above already use.
     */
    headingOffer?: HeadingOfferBannerTracker,
    /**
     * `ol-v7r5.35` (`[D-193]`): the "Keep going" continue path's real
     * extend seam — `main.ts` wires this to the SAME `ReviewSessionOpener`
     * (`open-session.ts`, `createReviewSessionOpener`) that `openSession`
     * above routes `onOpen` through, one instance per opened tab, so
     * `continueSessionAfterComplete` grows the SAME frozen sitting rather
     * than a second, unfrozen one. Absent (the workbench's canned
     * single-session fixture, which has no opener at all) falls back to
     * this view's pre-freeze behaviour — see that method's own doc.
     */
    extendSession?: () => Promise<readonly ReviewQueueItem[]>,
    /**
     * `ol-v7r5.35` (`[D-193]`): releases the same opener's freeze when this
     * tab closes, so the NEXT time she opens review it recomposes
     * unconditionally rather than holding a stale sitting from a closed
     * tab. `main.ts` wires this to the same opener's `close()`. Absent is
     * the same no-op posture as `extendSession` above.
     */
    releaseSession?: () => void,
  ) {
    super(leaf);
    this.openSession = openSession;
    this.activity = new ReviewActivityNotifier(onReviewActivity);
    this.retrieveSourceChunks = retrieveSourceChunks;
    this.openExplainBack = openExplainBack;
    this.openRegistryEntry = openRegistryEntry;
    this.headingOffer = headingOffer;
    this.extendSession = extendSession;
    this.releaseSession = releaseSession;
    // A review session isn't a file to navigate back/forward through like a
    // note — closing it and reopening review starts fresh, same as the old
    // olea-app review screen.
    this.navigation = false;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_REVIEW;
  }

  override getDisplayText(): string {
    return 'Olea review';
  }

  override getIcon(): string {
    return 'graduation-cap';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('olea-review-root', 'theme-dark');
    this.contentEl.setAttr('tabindex', '-1');
    this.registerDomEvent(this.contentEl, 'keydown', (evt) => {
      void this.handleKeydown(evt);
    });

    this.renderLoading();
    this.session = await this.openSession();
    await this.session?.start();
    this.started = true;
    this.render();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
    this.activity.observeClose();
    // `ol-v7r5.35` (`[D-193]`): she finished or left — releases this tab's
    // own frozen sitting so the next open recomposes unconditionally,
    // rather than holding a sitting from a tab that no longer exists.
    this.releaseSession?.();
  }

  // ---- keyboard ----

  /**
   * The unavailable screen borrows `empty`'s bindings deliberately: Escape
   * closes the tab, and nothing else is bound, which is exactly the set of
   * actions that screen offers. Q6.5 is satisfied by the *absence* — no hint
   * row is drawn there beyond the Close button's own keycap.
   */
  private currentScreen(
    vm: ReviewViewModel | null = this.session?.getViewModel() ?? null,
  ): ReviewScreen {
    if (vm === null) return { kind: 'empty' };
    switch (vm.phase) {
      case 'loading':
        return { kind: 'empty' };
      case 'empty':
        return { kind: 'empty' };
      case 'note-missing':
        return { kind: 'note-missing' };
      case 'front':
        return { kind: 'card-front', isNewDraft: vm.instrument.draftId !== null };
      case 'reveal':
        return { kind: 'card-reveal', isNewDraft: vm.instrument.draftId !== null };
      case 'mcq-open':
        return {
          kind: 'mcq-unanswered',
          optionCount: vm.instrument.options.length,
          // `mcqAnswer` resolves any pending draft before this phase can ever
          // render again (`session.ts`'s `resolveDraftAt`), so this is the
          // only one of the three item screens where a real MCQ presentation
          // can actually carry `isNewDraft: true` — computed the same way as
          // the other two rather than assumed, so a future change to that
          // ordering shows up here rather than silently going stale.
          isNewDraft: vm.instrument.draftId !== null,
        };
      case 'mcq-answered':
        return { kind: 'mcq-answered' };
      case 'complete':
        return { kind: 'session-complete' };
    }
  }

  private async handleKeydown(evt: KeyboardEvent): Promise<void> {
    if (!this.started) return;
    const target = evt.target;
    // Defensive: never steal a keystroke from a genuine text field. Nothing
    // under this view is one today, but a future inline-edit affordance
    // should not have to remember to guard this itself.
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    // Space/Enter on a focused button (or anchor, or role="button" element)
    // activates that control, not the screen-wide binding (ol-l5og.13).
    // Every review control is a real <button> wired to its own click
    // handler, so letting native activation win here is sufficient.
    if (
      (evt.key === ' ' || evt.key === 'Spacebar' || evt.key === 'Enter') &&
      target instanceof HTMLElement &&
      (target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.getAttribute('role') === 'button')
    ) {
      return;
    }

    const action = resolveReviewKey({ key: evt.key }, this.currentScreen());
    if (action === null) return;
    evt.preventDefault();
    await this.dispatch(action);
  }

  private async dispatch(action: ReviewAction): Promise<void> {
    // Closing and moving focus are the only two actions that mean anything
    // without a session, and both are reachable on the unavailable screen.
    if (action.kind === 'end-session' || action.kind === 'close-tab') {
      this.leaf.detach();
      return;
    }
    if (action.kind === 'focus-move') {
      this.moveFocus(action.direction);
      return;
    }
    const session = this.session;
    if (session === null) return;

    switch (action.kind) {
      case 'reveal':
        session.reveal();
        break;
      case 'flip-back':
        session.flipBack();
        break;
      case 'rate':
        await session.rate(action.rating);
        break;
      case 'mcq-answer':
        // Awaited: for a new-badge item (`renderHeader`'s doc) this is the
        // `[D-097]` accept step, materializing the draft into the vault
        // before this method returns — see `session.ts`'s own doc.
        await session.mcqAnswer(action.optionIndex);
        break;
      case 'mcq-toggle-guessed':
        session.mcqToggleGuessed();
        break;
      case 'mcq-next':
        await session.mcqNext();
        break;
      case 'edit':
        await session.edit();
        break;
      case 'suspend':
        await session.suspend();
        break;
      case 'accept-edit-draft':
        await session.acceptEditDraft();
        break;
      case 'reject-draft':
        await session.rejectDraft();
        break;
      case 'skip-missing-note':
        await session.skipMissingNote();
        break;
      case 'remove-missing-note':
        await session.removeMissingNote();
        break;
    }
    this.render();
  }

  private moveFocus(direction: 'up' | 'down'): void {
    const controls = this.focusableControls();
    if (controls.length === 0) return;
    const activeIndex = controls.indexOf(this.contentEl.ownerDocument.activeElement as HTMLElement);
    const base = activeIndex === -1 ? 0 : activeIndex;
    const delta = direction === 'down' ? 1 : -1;
    const next = controls[(base + delta + controls.length) % controls.length];
    next?.focus();
  }

  private focusableControls(): HTMLElement[] {
    return Array.from(this.contentEl.querySelectorAll<HTMLElement>(`[${FOCUSABLE_ATTR}]`));
  }

  // ---- rendering ----

  private renderLoading(): void {
    const root = this.contentEl;
    root.empty();
    root.createDiv({ cls: 'olea-review-loading', text: 'Loading review…' });
  }

  private render(): void {
    const root = this.contentEl;
    const hadFocus = root.contains(root.ownerDocument.activeElement);
    root.empty();

    if (this.session === null) {
      this.renderUnavailable();
      if (hadFocus) this.focusableControls()[0]?.focus();
      return;
    }
    this.syncConfusionRoutingOffer(this.session);
    this.renderConfusionRoutingBanner();
    this.renderHeadingOfferBannerIfAny(this.session);
    const vm = this.session.getViewModel();
    // Every path that changes the queue ends in a `render()`, so this is the one
    // place that sees every phase transition. The notifier fires only on the
    // first `complete` — see `review/activity.ts` (ol-h3wy).
    this.activity.observePhase(vm.phase);

    switch (vm.phase) {
      case 'loading':
        this.renderLoading();
        return;
      case 'empty':
        this.renderEmpty(vm.nextDueLabel);
        break;
      case 'complete':
        this.renderComplete(vm.summary);
        break;
      case 'note-missing':
        this.renderHeader(vm.progress, this.currentScreen(vm), vm.instrument);
        this.renderNoteMissing();
        break;
      case 'front': {
        const screen = this.currentScreen(vm);
        this.renderHeader(vm.progress, screen, vm.instrument);
        this.renderFront(vm.instrument, screen);
        break;
      }
      case 'reveal': {
        const screen = this.currentScreen(vm);
        this.renderHeader(vm.progress, screen, vm.instrument);
        this.renderReveal(vm.instrument, vm.ratingPreviews, screen);
        break;
      }
      case 'mcq-open': {
        const screen = this.currentScreen(vm);
        this.renderHeader(vm.progress, screen, vm.instrument);
        this.renderMcqOpen(vm.instrument, screen);
        break;
      }
      case 'mcq-answered':
        this.renderHeader(
          vm.progress,
          this.currentScreen(vm),
          vm.instrument,
          vm.instrument.options[vm.selectedIndex]?.label ?? '',
        );
        this.renderMcqAnswered(
          vm.instrument,
          vm.selectedIndex,
          vm.wasUnsure,
          vm.intervalLabel,
          vm.contestGestureLabel,
          vm.contestBadge,
        );
        break;
    }

    this.renderExplainWhyPanelIfPending();

    if (hadFocus) {
      const controls = this.focusableControls();
      controls[0]?.focus();
    }
  }

  /**
   * `instrument` is `null` only for the note-missing/empty/complete screens
   * that never carry one — everything else passes its `vm.instrument`
   * through so this can tell a still-pending draft (`instrument.draftId !==
   * null`, F3.3, `[D-097]`, `ol-p3t07a`) from an ordinary instrument.
   *
   * **The "new" badge and its edit/reject controls now render ONLY at the
   * reveal (F3.3/`[D-097]`, amended `[D-189]`, `ol-0r92.36`).** `[D-189]`
   * adds one clause to F3.3 and principle 7: the first serve asks for her
   * answer before it shows the draft's own, and the edit affordance — beside
   * `Reject` — sits at the reveal, alongside that comparison, never before
   * it. So this method draws NEITHER pair on a draft's pre-reveal screen
   * (`card-front` / `mcq-unanswered`): not the draft pair (too early — she
   * hasn't seen the draft's answer to weigh an edit against yet) and not the
   * ordinary "Edit note"/"Suspend" pair either (nothing has landed in a note
   * yet to edit, and nothing is scheduled yet to suspend). Only once
   * `screen.kind` is `card-reveal` or `mcq-answered` does the draft pair
   * appear — "Edit before saving" and "Reject" replace "Edit note"/"Suspend",
   * which means nothing for something not yet in the vault. Both are one
   * click away, matching `[D-097]`'s "edit and reject one tap away", **and
   * one keypress away, on the same E/S keys the ordinary "Edit note"/
   * "Suspend" pair already used** — `keymap.ts`'s `resolveReviewKey`/
   * `hintsFor` swap what E/S mean based on `screen.isNewDraft`, and now also
   * suppress E/S entirely on a draft's pre-reveal screen the same way this
   * method suppresses the buttons, so the pointer path and the keyboard path
   * can never disagree about when the pair is reachable. `dispatch` (below)
   * is the single place either button's click or the matching keypress ends
   * up, so the two can't drift.
   */
  private renderHeader(
    progress: { readonly position: number; readonly total: number },
    screen: ReviewScreen,
    instrument: ReviewInstrument | null,
    studentAnswerForExplain = '',
  ): void {
    const header = this.contentEl.createDiv({ cls: 'olea-review-header' });
    header.createSpan({
      cls: 'olea-review-progress',
      text: `${progress.position} of ${progress.total}`,
    });
    if (instrument !== null && instrument.draftId !== null) {
      header.createSpan({ cls: 'olea-review-new-badge', text: 'New' });
    }
    header.createDiv({ cls: 'olea-review-header-spacer' });

    // F2.7 (`ol-sn1q`): available on every screen carrying a current
    // instrument, never gated on phase or on whether her answer was
    // actually wrong (F2.20's "available at every stage" — `session.ts`'s
    // `requestExplainWhy` already holds this discipline; this button just
    // reaches it from every screen rather than a chosen few).
    if (instrument !== null) {
      this.actionButton(
        header,
        'Explain why',
        null,
        () => void this.handleExplainWhy(instrument, studentAnswerForExplain),
      );
      // `[D-171]`'s one-step affordance (F8.4): never prints provenance here
      // (no source path, heading or page anywhere on this card), only leads
      // to the instrument's registry entry — present on every rendered
      // instrument, so absent entirely rather than shown disabled when
      // `openRegistryEntry` was never wired (F7.8-shaped grey-out via
      // omission, same posture `retrieveSourceChunks` above already holds).
      if (this.openRegistryEntry) {
        const openRegistryEntry = this.openRegistryEntry;
        this.actionButton(header, REGISTRY_ENTRY_ACTION, null, () =>
          openRegistryEntry(instrument.instrumentId),
        );
      }
    }

    if (instrument !== null && instrument.draftId !== null) {
      // [D-189] (ol-0r92.36): the draft pair renders only at the reveal —
      // `card-reveal` (Q&A/cloze) or `mcq-answered` (MCQ) — never on the
      // pre-reveal `card-front`/`mcq-unanswered` screens. A pre-reveal draft
      // screen falls through this whole block with neither pair drawn: see
      // this method's own doc, above.
      if (screen.kind === 'card-reveal' || screen.kind === 'mcq-answered') {
        this.actionButton(
          header,
          'Edit before saving',
          verifiedKeycap(screen, 'e', 'E', 'accept-edit-draft'),
          () => void this.dispatch({ kind: 'accept-edit-draft' }),
        );
        this.actionButton(
          header,
          'Reject',
          verifiedKeycap(screen, 's', 'S', 'reject-draft'),
          () => void this.dispatch({ kind: 'reject-draft' }),
        );
      }
      return;
    }

    // ol-63xn (Q6.5): `note-missing` is the one screen `hasGlobalBindings`
    // excludes from the global E/S bindings — there is nothing to edit or
    // suspend once the source note is gone, and the screen already offers
    // skip/remove instead. The keycap side of that already went through
    // `actionKeycap` (it queries the resolver and draws nothing there), but a
    // bare `if (screen.kind !== 'note-missing')` here would be a second,
    // hand-typed copy of exactly the list `hasGlobalBindings` keeps — the
    // duplication this bead exists to remove. Gating the buttons on the same
    // predicate keymap.ts uses means the pointer path can never say yes where
    // the keyboard path says no.
    if (!hasGlobalBindings(screen)) return;

    this.actionButton(
      header,
      'Edit note',
      actionKeycap('edit', screen),
      () => void this.dispatch({ kind: 'edit' }),
    );
    this.actionButton(
      header,
      'Suspend',
      actionKeycap('suspend', screen),
      () => void this.dispatch({ kind: 'suspend' }),
    );
  }

  /** `hotkey` is `null` when the resolver has no binding for the action; the button is then built without a keycap rather than promising a key that does nothing (Q6.5). */
  private actionButton(
    parent: HTMLElement,
    label: string,
    hotkey: string | null,
    onClick: () => void,
  ): HTMLElement {
    const btn = parent.createEl('button', {
      cls: 'olea-review-ghost-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    btn.createSpan({ text: label });
    this.keycap(btn, hotkey);
    this.registerDomEvent(btn, 'click', onClick);
    return btn;
  }

  private keycap(parent: HTMLElement, key: string | null): void {
    if (key === null) return;
    parent.createSpan({ cls: 'olea-review-keycap', text: key });
  }

  private meta(parent: HTMLElement, courseCode: string, noteTitle: string): void {
    const meta = parent.createDiv({ cls: 'olea-review-meta' });
    meta.createSpan({ cls: 'olea-review-meta-course', text: courseCode });
    meta.createSpan({ cls: 'olea-review-meta-dot' });
    meta.createSpan({ cls: 'olea-review-meta-note', text: noteTitle });
  }

  private hints(parent: HTMLElement, screen: ReviewScreen): void {
    const row = parent.createDiv({ cls: 'olea-review-hints' });
    for (const hint of hintsFor(screen)) {
      const item = row.createSpan({ cls: 'olea-review-hint' });
      item.createSpan({ cls: 'olea-review-keycap', text: hint.key });
      item.createSpan({ text: hint.label });
    }
  }

  // ---- F2.7 on-demand "explain why" (`ol-sn1q`) ----

  /**
   * Retrieves grounding, then asks the session (`requestExplainWhy` never
   * blocks — see that method's own doc). Never throws into the click
   * handler: a rejected port call is the honest "something went wrong"
   * case, and this class has nothing better to do with it than leave the
   * panel showing its last state, so nothing here swallows it silently
   * either — `requestExplainWhy`'s own tests already cover "a port that
   * throws does not corrupt session state."
   */
  private async handleExplainWhy(
    instrument: ReviewInstrument,
    studentAnswer: string,
  ): Promise<void> {
    const session = this.session;
    if (session === null) return;
    this.explainWhyPanel = { instrumentId: instrument.instrumentId, status: 'loading' };
    this.render();
    const chunks = this.retrieveSourceChunks ? await this.retrieveSourceChunks(instrument) : [];
    const outcome = await session.requestExplainWhy(studentAnswer, chunks);
    this.explainWhyPanel =
      outcome === null ? null : { instrumentId: instrument.instrumentId, status: 'done', outcome };
    this.render();
  }

  /**
   * The grade contest (`ol-fgba`). Records the dispute, then re-renders so the
   * quarantine badge replaces the gesture in place — one gesture, one event,
   * and no advance past the claim she just disagreed with.
   */
  private async handleContestGrade(): Promise<void> {
    const session = this.session;
    if (session === null) return;
    await session.contestGrade();
    this.render();
  }

  /**
   * Renders below whatever the current phase drew, only when the panel's
   * state is about the instrument actually on screen right now — a re-render
   * after advancing to a new item (rating, `requestExplainWhy`'s own "never
   * blocks" guarantee) must not show a stale explanation for the PREVIOUS
   * one.
   */
  private renderExplainWhyPanelIfPending(): void {
    const state = this.explainWhyPanel;
    const currentInstrumentId = this.session?.currentItem?.instrument.instrumentId ?? null;
    if (state === null || state.instrumentId !== currentInstrumentId) return;

    const panel = this.contentEl.createDiv({ cls: 'olea-review-explain-why' });
    if (state.status === 'loading') {
      panel.createEl('p', { cls: 'olea-review-explain-why-text', text: 'Asking Olea…' });
      return;
    }
    panel.createEl('p', {
      cls: 'olea-review-explain-why-text',
      text: state.outcome.refused ? EXPLAIN_WHY_REFUSAL : state.outcome.text,
    });
  }

  // ---- F2.12 confusion routing (`ol-h2bx`) ----

  /**
   * Picks up a fresh offer (`session.getConfusionRoutingOffer()`) and clears
   * a stale one. A fresh offer is one about a DIFFERENT instrument than
   * whatever `this.confusionBanner` currently holds — the session clears its
   * own copy the instant `acceptConfusionRoutingOffer` is called, so this
   * class keeps its own copy going to hold the result on screen after that.
   *
   * **Why the banner clears itself without an explicit "decline" control.**
   * F2.12's own framing is "one available action" (vocabulary registry V3) —
   * a second, explicit dismiss button would be a second action. Instead, the
   * banner is scoped to the ONE item presented alongside it
   * (`presentedWithInstrumentId`): once she moves past that item — rating it
   * and advancing to the next — the banner clears on its own, whether or not
   * she ever touched it. That is what "declining changes nothing and does
   * not nag" means operationally: nothing to undo, and nothing that lingers.
   *
   * **The D7.1 pair this now writes (`[D-178 / LOG-3]` item 2, `ol-0r92.28`).**
   * The offer-arrives branch below calls
   * `session.recordExplainBackOfferShown` the moment a fresh offer is
   * accepted onto `this.confusionBanner`, and holds the event id it returns.
   * The clears-unaccepted branch calls `session.recordExplainBackOfferDeclined`
   * with that same id, immediately before clearing the banner — never when
   * `handleAcceptConfusionOffer` clears it instead, since accepting is not a
   * decline (an accepted offer is evidenced by the `explain-back` review
   * record it produces, not by this pair). Both calls go through the session,
   * never `this` reaching for a vault port directly — the same "thread it
   * through session deps" seam `recordReview` already uses — and neither is
   * awaited: a log write must not block this synchronous `render()` path.
   */
  private syncConfusionRoutingOffer(session: ReviewSession): void {
    const offer: PendingConfusionRoutingOffer | null = session.getConfusionRoutingOffer();
    const currentInstrumentId = session.currentItem?.instrument.instrumentId ?? null;

    if (
      offer !== null &&
      offer.instrument.instrumentId !== this.confusionBanner?.instrument.instrumentId
    ) {
      this.confusionBanner = {
        instrument: offer.instrument,
        promptText: offer.promptText,
        presentedWithInstrumentId: currentInstrumentId,
        offerEventId: session.recordExplainBackOfferShown(offer.instrument),
      };
      return;
    }
    if (
      this.confusionBanner !== null &&
      this.confusionBanner.presentedWithInstrumentId !== currentInstrumentId
    ) {
      session.recordExplainBackOfferDeclined(
        this.confusionBanner.instrument,
        this.confusionBanner.offerEventId,
      );
      this.confusionBanner = null;
    }
  }

  private renderConfusionRoutingBanner(): void {
    const state = this.confusionBanner;
    if (state === null) return;

    const banner = this.contentEl.createDiv({ cls: 'olea-review-confusion-banner' });
    banner.createEl('p', { cls: 'olea-review-confusion-prompt', text: state.promptText });

    const btn = banner.createEl('button', {
      cls: 'olea-review-primary-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    btn.createSpan({ text: 'Explain it back' });
    this.registerDomEvent(btn, 'click', () => this.handleAcceptConfusionOffer());
  }

  /**
   * The banner's one action — see `syncConfusionRoutingOffer`'s doc for why
   * there is no second, "decline" one. `[D-163]`/`ol-12gs`: this used to call
   * `ReviewSession.acceptConfusionRoutingOffer` and render its async
   * `ExplainWhyOutcome` inline in this banner; it now opens `ExplainBackModal`
   * (F5.1's dedicated destination) for the offered instrument and clears the
   * banner immediately — there is nothing left for THIS view to show once the
   * one action is taken, because the exchange now happens in a separate
   * `Modal` this view neither renders nor tears down anything to make room
   * for (hand-off, never a second inline copy — `[D-163]`'s own wording).
   * `session.resolveConfusionRoutingOffer` only clears session-side state; it
   * performs no port call, unlike the method it replaces.
   *
   * **Sets `this.confusionBanner = null` directly, never through
   * `session.recordExplainBackOfferDeclined`** (`[D-178 / LOG-3]` item 2):
   * accepting is not a decline. By the time `syncConfusionRoutingOffer` next
   * runs, `this.confusionBanner` is already `null`, so its clears-unaccepted
   * branch — the only call site for that write — never fires for this path.
   */
  private handleAcceptConfusionOffer(): void {
    const session = this.session;
    const pending = this.confusionBanner;
    if (session === null || pending === null) return;
    session.resolveConfusionRoutingOffer();
    this.confusionBanner = null;
    this.openExplainBack?.(pending.instrument);
    this.render();
  }

  // ---- F2.10 heading offer (`ol-i19f`) ----

  /**
   * Checks the CURRENT review item's own source note, via
   * `this.headingOffer` (`HeadingOfferBannerTracker`, `heading-offer-
   * wiring.ts`) — never the previously-current item, and never a note she
   * merely has open elsewhere (see this file's own "THE MOUNT" comment,
   * above `renderHeadingOfferBanner`, for why that wider trigger is a
   * different bead). `bannerFor` is synchronous and cheap to call on every
   * render: it returns `null` immediately while its own background check is
   * in flight or found nothing, and re-renders itself (`onUpdate`) the
   * moment a check for the CURRENT item's path resolves — same "later state
   * wins outright, and a re-render just happens" shape `handleExplainWhy`
   * above already uses for its own async panel.
   */
  private renderHeadingOfferBannerIfAny(session: ReviewSession): void {
    if (!this.headingOffer) return;
    const item = session.currentItem;
    const state = this.headingOffer.bannerFor(
      item === null
        ? null
        : { sourcePath: item.instrument.sourcePath, courseCode: item.instrument.courseCode },
      () => this.render(),
    );
    if (state === null) return;

    const handles = renderHeadingOfferBanner(this.contentEl, state.promptText);
    this.registerDomEvent(
      handles.acceptButton,
      'click',
      () => void this.handleAcceptHeadingOffer(state),
    );
    this.registerDomEvent(handles.dismissButton, 'click', () => {
      state.dismiss();
      this.render();
    });
  }

  /**
   * `[D-170]`'s accept verb: creates the pending draft through the real
   * `HeadingOfferPort` (`heading-offer-wiring.ts`'s bound closure — this
   * class never touches the port or a `ConceptRecord` directly). The
   * outcome (`drafted`/`refused`/`unparseable`/`not-configured`) is not
   * rendered here: F2.10's own contract wording is the fixed offer prompt
   * and the two verbs, nothing about a per-outcome result screen, and the
   * drafted case is exactly `[D-097]`'s ordinary "new" badge once it is
   * served in review — the same discovery path a sweep-drafted card already
   * has. Re-rendering afterwards is what makes the banner disappear either
   * way (`HeadingOfferBannerTracker.bannerFor`'s own doc: resolved either
   * way, it does not linger).
   */
  private async handleAcceptHeadingOffer(state: HeadingOfferBannerState): Promise<void> {
    await state.accept();
    this.render();
  }

  /**
   * `screen` is the same `ReviewScreen` `renderHeader` was just called with
   * (`render`'s `'front'` case computes it once) — reusing it, rather than
   * rebuilding `{ kind: 'card-front' }` here, is what keeps this hint row's
   * E/S labels in sync with a draft item's `isNewDraft` flag; a second,
   * hand-typed literal here could drift from the header's the same way the
   * MCQ hint row's stale `optionCount` comment above once did.
   */
  private renderFront(instrument: QaCard | ClozeCard, screen: ReviewScreen): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body' });
    this.meta(body, instrument.courseCode, instrument.noteTitle);
    body.createEl('h2', { cls: 'olea-review-question', text: questionText(instrument) });
    body.createDiv({ cls: 'olea-review-divider' });
    this.hints(body, screen);
  }

  /** `screen` — see `renderFront`'s doc; same reasoning, same source. */
  private renderReveal(
    instrument: QaCard | ClozeCard,
    ratingPreviews: readonly RatingPreview[],
    screen: ReviewScreen,
  ): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body' });
    this.meta(body, instrument.courseCode, instrument.noteTitle);
    body.createEl('h2', {
      cls: 'olea-review-question olea-review-question--small',
      text: questionText(instrument),
    });

    const answerBlock = body.createDiv({ cls: 'olea-review-answer-block' });
    answerBlock.createDiv({ cls: 'olea-review-eyebrow', text: 'From your own note' });
    if (instrument.type === 'qa') {
      answerBlock.createEl('p', { text: instrument.answer });
    } else {
      const p = answerBlock.createEl('p');
      p.createSpan({ text: instrument.before });
      p.createSpan({ cls: 'olea-cloze-answer', text: instrument.clozeText });
      p.createSpan({ text: instrument.after });
      if (instrument.noteContext) {
        answerBlock.createEl('p', {
          cls: 'olea-review-note-context',
          text: instrument.noteContext,
        });
      }
    }

    const ratings = body.createDiv({ cls: 'olea-review-ratings' });
    for (const preview of ratingPreviews) {
      const btn = ratings.createEl('button', {
        cls: `olea-review-rating-btn olea-review-rating-btn--${preview.rating}`,
        attr: { [FOCUSABLE_ATTR]: 'true' },
      });
      const top = btn.createDiv({ cls: 'olea-review-rating-top' });
      this.keycap(top, ratingKeycap(preview.rating));
      top.createSpan({
        cls: 'olea-review-rating-label',
        text: ratingLabel(preview.rating),
      });
      btn.createDiv({ cls: 'olea-review-rating-interval', text: preview.label });
      this.registerDomEvent(
        btn,
        'click',
        () => void this.dispatch({ kind: 'rate', rating: preview.rating }),
      );
    }

    this.hints(body, screen);
  }

  /** `screen` — see `renderFront`'s doc; same reasoning, same source. */
  private renderMcqOpen(instrument: McqItem, screen: ReviewScreen): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body' });
    this.meta(body, instrument.courseCode, instrument.noteTitle);
    body.createEl('h2', {
      cls: 'olea-review-question olea-review-question--small',
      text: instrument.stem,
    });

    const options = body.createDiv({ cls: 'olea-review-mcq-options' });
    const optionCount = instrument.options.length;
    instrument.options.forEach((option, i) => {
      const row = options.createEl('button', {
        cls: 'olea-review-mcq-option',
        attr: { [FOCUSABLE_ATTR]: 'true' },
      });
      this.keycap(row, mcqOptionKeycap(i, optionCount));
      row.createSpan({ cls: 'olea-review-mcq-option-label', text: option.label });
      this.registerDomEvent(
        row,
        'click',
        () => void this.dispatch({ kind: 'mcq-answer', optionIndex: i }),
      );
    });

    this.hints(body, screen);
  }

  private renderMcqAnswered(
    instrument: McqItem,
    selectedIndex: number,
    wasUnsure: boolean,
    intervalLabel: string,
    contestGestureLabel: string | null,
    contestBadge: string | null,
  ): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body' });
    this.meta(body, instrument.courseCode, instrument.noteTitle);
    body.createEl('h2', {
      cls: 'olea-review-question olea-review-question--small',
      text: instrument.stem,
    });

    const options = body.createDiv({ cls: 'olea-review-mcq-options' });
    const optionCount = instrument.options.length;
    instrument.options.forEach((option, i) => {
      const state = option.correct ? 'correct' : i === selectedIndex ? 'wrong' : 'dim';
      const row = options.createDiv({
        cls: `olea-review-mcq-option olea-review-mcq-option--${state}`,
      });
      this.keycap(row, mcqOptionKeycap(i, optionCount));
      row.createSpan({ cls: 'olea-review-mcq-option-label', text: option.label });
      if (state !== 'dim') {
        row.createSpan({
          cls: 'olea-review-mcq-option-tag',
          text: option.correct ? 'Correct answer' : 'You chose',
        });
      }
    });

    const feedback = body.createDiv({ cls: 'olea-review-mcq-feedback' });
    feedback.createEl('p', { text: mcqFeedbackSentence(instrument.feedback, intervalLabel) });

    // `[D-046]` clause 4 / `[D-095]` (`ol-fgba` [DISP-1]) — the grade Olea has
    // just asserted about this answer is a claim about her knowledge, so it
    // carries the same single gesture every other claim in the product
    // carries, in the same words, right beside the claim itself. Contesting
    // does not advance the session: the claim, its evidence and her contest
    // stay on screen together, which is the acknowledgment `[D-095]` §2 asks
    // for. The gesture is absent — never inert — when no port is wired to
    // record the dispute (`ReviewViewModel`'s `contestGestureLabel` doc).
    if (contestBadge !== null) {
      feedback.createEl('p', { cls: 'olea-review-contest-badge', text: contestBadge });
    } else if (contestGestureLabel !== null) {
      const contest = feedback.createEl('button', {
        cls: 'olea-review-ghost-action olea-review-contest',
        attr: { [FOCUSABLE_ATTR]: 'true' },
      });
      contest.createSpan({ text: contestGestureLabel });
      this.registerDomEvent(contest, 'click', () => void this.handleContestGrade());
    }

    const footer = body.createDiv({ cls: 'olea-review-mcq-footer' });
    const guessToggle = footer.createEl('button', {
      cls: 'olea-review-ghost-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    guessToggle.toggleClass('olea-review-ghost-action--active', wasUnsure);
    guessToggle.createSpan({ text: "Wasn't sure · guessed" });
    this.keycap(guessToggle, actionKeycap('mcq-toggle-guessed', { kind: 'mcq-answered' }));
    this.registerDomEvent(
      guessToggle,
      'click',
      () => void this.dispatch({ kind: 'mcq-toggle-guessed' }),
    );

    const next = footer.createEl('button', {
      cls: 'olea-review-primary-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    this.keycap(next, verifiedKeycap({ kind: 'mcq-answered' }, ' ', 'Space', 'mcq-next'));
    next.createSpan({ text: 'next item' });
    this.registerDomEvent(next, 'click', () => void this.dispatch({ kind: 'mcq-next' }));
  }

  private renderNoteMissing(): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body olea-review-note-missing' });
    body.createEl('h2', { cls: 'olea-review-question', text: 'This item’s source note is gone.' });
    body.createEl('p', {
      cls: 'olea-review-note-missing-body',
      text: 'It was due today, but the note it was anchored to has been deleted from the vault since it was scheduled.',
    });
    const actions = body.createDiv({ cls: 'olea-review-actions-row' });
    const skip = actions.createEl('button', {
      cls: 'olea-review-primary-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    skip.createSpan({ text: 'Skip for now' });
    this.keycap(skip, verifiedKeycap({ kind: 'note-missing' }, 'Enter', '↵', 'skip-missing-note'));
    this.registerDomEvent(skip, 'click', () => void this.dispatch({ kind: 'skip-missing-note' }));

    const remove = actions.createEl('button', {
      cls: 'olea-review-ghost-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    remove.createSpan({ text: 'Remove from queue' });
    this.keycap(
      remove,
      verifiedKeycap({ kind: 'note-missing' }, 'Delete', 'Delete', 'remove-missing-note'),
    );
    this.registerDomEvent(
      remove,
      'click',
      () => void this.dispatch({ kind: 'remove-missing-note' }),
    );

    this.hints(body, { kind: 'note-missing' });
  }

  private renderEmpty(nextDueLabel: string | null): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body olea-review-empty' });
    body.createEl('h2', { cls: 'olea-review-question', text: "You're caught up." });
    body.createEl('p', {
      cls: 'olea-review-note-context',
      text: nextDueLabel ? `Next item is due ${nextDueLabel}.` : 'Nothing is due right now.',
    });
    const close = body.createEl('button', {
      cls: 'olea-review-primary-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    close.createSpan({ text: 'Close' });
    this.keycap(close, verifiedKeycap({ kind: 'empty' }, 'Escape', 'Esc', 'close-tab'));
    this.registerDomEvent(close, 'click', () => this.leaf.detach());
  }

  /**
   * The session could not be composed at all (`open-session.ts` returned
   * `null`) — a vault that could not be walked or a log that could not be read.
   *
   * Deliberately **not** the empty screen. "You're caught up." is a claim about
   * her deck, and nothing here is in a position to make it; rendering a failure
   * as an empty queue is the exact substitution `today/panel.ts` refuses when it
   * keeps `null` distinct from a computed zero. Its two sentences live in
   * `copy.ts` rather than as literals here, because they are a statement about
   * *why* she is being shown nothing — the class of string this file's header
   * says belongs there — and `copy.spec.ts` asserts they blame the vault read
   * rather than her.
   */
  private renderUnavailable(): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body olea-review-empty' });
    body.createEl('h2', { cls: 'olea-review-question', text: REVIEW_UNAVAILABLE_TITLE });
    body.createEl('p', { cls: 'olea-review-note-context', text: REVIEW_UNAVAILABLE_BODY });
    const close = body.createEl('button', {
      cls: 'olea-review-primary-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    close.createSpan({ text: 'Close' });
    this.keycap(close, verifiedKeycap({ kind: 'empty' }, 'Escape', 'Esc', 'close-tab'));
    this.registerDomEvent(close, 'click', () => this.leaf.detach());
  }

  /**
   * `[D-091]`'s "always free to keep going" (`ol-0r92.32`, component
   * register §3.7): today's due queue running out is a declared target
   * reached, never a cap, so this screen must offer a way past it — "Keep
   * going" beside "Close", never Close alone. See `copy.ts`'s
   * `SESSION_COMPLETE_CONTINUE_LABEL` for the wording's own citation and
   * `ReviewSession.continueWith`'s doc for why extending never becomes a
   * second selection policy: `more` below is sourced from the SAME
   * `this.openSession` provider (`ol-p2t08a`'s `ReviewSessionProvider`) this
   * view already opens every session through — whatever plan is cached now,
   * read fresh, exactly as `onOpen` reads it — never a second, invented
   * source of items.
   */
  private renderComplete(summary: SessionCompleteSummary): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body olea-review-complete' });
    body.createEl('h2', { cls: 'olea-review-question', text: "That's the queue for today." });

    body.createEl('p', {
      cls: 'olea-review-note-context',
      text: sessionCompleteSentence(summary),
    });

    const actions = body.createDiv({ cls: 'olea-review-actions-row' });

    const keepGoing = actions.createEl('button', {
      cls: 'olea-review-primary-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    keepGoing.createSpan({ text: SESSION_COMPLETE_CONTINUE_LABEL });
    this.registerDomEvent(keepGoing, 'click', () => void this.continueSessionAfterComplete());

    const close = actions.createEl('button', {
      cls: 'olea-review-ghost-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    close.createSpan({ text: 'Close' });
    this.keycap(close, verifiedKeycap({ kind: 'session-complete' }, 'Escape', 'Esc', 'close-tab'));
    this.registerDomEvent(close, 'click', () => this.leaf.detach());
  }

  /**
   * "Keep going"'s click handler (`renderComplete`, `ol-0r92.32`).
   *
   * **`ol-v7r5.35` (`[D-193]`): routes through `this.extendSession` — the
   * SAME opener's `FrozenReviewQueue.extend` verb `open-session.ts`'s
   * `ReviewSessionOpener` wraps — rather than a second, unfrozen
   * `this.openSession()` call.** Before this, "Keep going" recomposed the
   * whole queue from scratch and handed the fresh compose's ENTIRE
   * `queueSnapshot` to `continueWith`, which is exactly the "the tool
   * re-reads and re-ranks a session that is supposed to be holding still"
   * bug this bead fixes (C5.8, `ol-egov.81`) — it happened to look safe only
   * because a genuinely fresh compose naturally excludes anything already
   * rated (the scheduler moved its due date). `extendSession` gives back
   * only what is genuinely new relative to what THIS tab's sitting already
   * holds, composed under the same plan's shares (C5.5), so `continueWith`
   * appends real growth rather than a second read of the whole due set.
   *
   * `continueWith` is already a safe no-op when there is nothing to
   * continue into (nothing more is due right now) — see its own doc in
   * `session.ts` — so this never needs a fallback session of its own: the
   * `complete` screen simply stays up, honestly, rather than being swapped
   * for a second "nothing to continue into" screen.
   *
   * **Fallback, when no opener is wired** (`this.extendSession` absent —
   * today only the workbench's canned single-session fixture): the
   * pre-freeze behaviour, unchanged — a fresh, unfrozen `this.openSession()`
   * call, its `queueSnapshot` handed to `continueWith`, and a swap to that
   * fresh session directly when there was nothing to continue into.
   */
  private async continueSessionAfterComplete(): Promise<void> {
    if (this.extendSession) {
      const additions = await this.extendSession();
      await this.session?.continueWith(additions);
      this.render();
      return;
    }

    const fresh = await this.openSession();
    const more = fresh?.queueSnapshot ?? [];
    const extended = (await this.session?.continueWith(more)) ?? false;
    if (!extended) {
      this.session = fresh;
      await this.session?.start();
    }
    this.render();
  }
}
