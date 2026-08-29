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
  EXPLAIN_WHY_UNAVAILABLE,
  mcqFeedbackSentence,
  mcqOptionKeycap,
  questionText,
  REVIEW_UNAVAILABLE_BODY,
  REVIEW_UNAVAILABLE_TITLE,
  ratingKeycap,
  ratingLabel,
  sessionCompleteSentence,
  verifiedKeycap,
} from './copy.js';
import type { ExplainWhyOutcome } from './explainWhy.js';
import type { RatingPreview } from './interval.js';
import { hintsFor, type ReviewAction, type ReviewScreen, resolveReviewKey } from './keymap.js';
import type {
  PendingConfusionRoutingOffer,
  ReviewSession,
  ReviewViewModel,
  SessionCompleteSummary,
} from './session.js';
import type { ClozeCard, McqItem, QaCard, ReviewInstrument } from './types.js';

/**
 * F2.7's on-demand panel state, keyed by which instrument the last request
 * was about — so a re-render for a DIFFERENT current item never shows a
 * stale result (`ol-sn1q`).
 */
type ExplainWhyPanelState =
  | { readonly instrumentId: string; readonly status: 'loading' }
  | { readonly instrumentId: string; readonly status: 'done'; readonly outcome: ExplainWhyOutcome };

/**
 * F2.12's offer banner state (`ol-h2bx`). `presentedWithInstrumentId` is the
 * instrument that was current the moment the offer first appeared — the
 * banner clears itself once she moves past THAT item (see
 * `syncConfusionRoutingOffer`'s doc), which is what keeps it from lingering
 * indefinitely without an explicit "decline" control (F2.12's own "one
 * available action" framing).
 */
interface ConfusionBannerState {
  readonly instrument: ReviewInstrument;
  readonly promptText: string;
  readonly presentedWithInstrumentId: string | null;
  readonly status: 'idle' | 'loading' | 'unavailable' | 'done';
  readonly outcome?: ExplainWhyOutcome;
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

export class ReviewView extends ItemView {
  private readonly openSession: ReviewSessionProvider;
  private readonly activity: ReviewActivityNotifier;
  private readonly retrieveSourceChunks: RetrieveExplainWhySourceChunks | undefined;
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
  ) {
    super(leaf);
    this.openSession = openSession;
    this.activity = new ReviewActivityNotifier(onReviewActivity);
    this.retrieveSourceChunks = retrieveSourceChunks;
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
    const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
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
    const hadFocus = root.contains(document.activeElement);
    root.empty();

    if (this.session === null) {
      this.renderUnavailable();
      if (hadFocus) this.focusableControls()[0]?.focus();
      return;
    }
    this.syncConfusionRoutingOffer(this.session);
    this.renderConfusionRoutingBanner();
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
   * **The "new" badge and its edit/reject controls (F3.3/`[D-097]`, keyboard
   * bindings ol-uxk9).** A draft item replaces "Edit note"/"Suspend" with
   * "Edit before saving" and "Reject" — the ordinary pair means nothing for
   * something not yet in the vault (there is no note-anchored edit target,
   * and nothing scheduled yet to suspend). Both are one click away, matching
   * `[D-097]`'s "edit and reject one tap away", **and now also one keypress
   * away, on the same E/S keys the ordinary "Edit note"/"Suspend" pair
   * already used** — `keymap.ts`'s `resolveReviewKey`/`hintsFor` swap what
   * E/S mean based on `screen.isNewDraft` (computed in `currentScreen`
   * above), rather than this view growing a second pair of keys. That keeps
   * `Q6.5`'s promise intact two ways at once: no hint row ever claims a key
   * this resolver doesn't accept, and every action — including these two —
   * now has a keyboard path. `dispatch` (below) is the single place either
   * button's click or the matching keypress ends up, so the two can't drift.
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
    }

    if (instrument !== null && instrument.draftId !== null) {
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
      return;
    }

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
        status: 'idle',
      };
      return;
    }
    if (
      this.confusionBanner !== null &&
      this.confusionBanner.presentedWithInstrumentId !== currentInstrumentId
    ) {
      this.confusionBanner = null;
    }
  }

  private renderConfusionRoutingBanner(): void {
    const state = this.confusionBanner;
    if (state === null) return;

    const banner = this.contentEl.createDiv({ cls: 'olea-review-confusion-banner' });
    banner.createEl('p', { cls: 'olea-review-confusion-prompt', text: state.promptText });

    if (state.status === 'idle') {
      const btn = banner.createEl('button', {
        cls: 'olea-review-primary-action',
        attr: { [FOCUSABLE_ATTR]: 'true' },
      });
      btn.createSpan({ text: 'Explain it back' });
      this.registerDomEvent(btn, 'click', () => void this.handleAcceptConfusionOffer());
      return;
    }
    if (state.status === 'loading') {
      banner.createEl('p', { cls: 'olea-review-confusion-message', text: 'Asking Olea…' });
      return;
    }
    if (state.status === 'unavailable') {
      banner.createEl('p', { cls: 'olea-review-confusion-message', text: EXPLAIN_WHY_UNAVAILABLE });
      return;
    }
    if (state.outcome !== undefined) {
      banner.createEl('p', {
        cls: 'olea-review-confusion-message',
        text: state.outcome.refused ? EXPLAIN_WHY_REFUSAL : state.outcome.text,
      });
    }
  }

  /** The banner's one action — see `syncConfusionRoutingOffer`'s doc for why there is no second, "decline" one. */
  private async handleAcceptConfusionOffer(): Promise<void> {
    const session = this.session;
    const pending = this.confusionBanner;
    if (session === null || pending === null) return;
    this.confusionBanner = { ...pending, status: 'loading' };
    this.render();

    const chunks = this.retrieveSourceChunks
      ? await this.retrieveSourceChunks(pending.instrument)
      : [];
    const outcome = await session.acceptConfusionRoutingOffer(chunks);

    // A NEW offer may have superseded this one while the request was in
    // flight — never clobber it with a stale result.
    const latest = this.confusionBanner;
    if (latest === null || latest.instrument.instrumentId !== pending.instrument.instrumentId)
      return;
    this.confusionBanner =
      outcome === null
        ? { ...pending, status: 'unavailable' }
        : { ...pending, status: 'done', outcome };
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

  private renderComplete(summary: SessionCompleteSummary): void {
    const body = this.contentEl.createDiv({ cls: 'olea-review-body olea-review-complete' });
    body.createEl('h2', { cls: 'olea-review-question', text: "That's the queue for today." });

    body.createEl('p', {
      cls: 'olea-review-note-context',
      text: sessionCompleteSentence(summary),
    });

    const close = body.createEl('button', {
      cls: 'olea-review-primary-action',
      attr: { [FOCUSABLE_ATTR]: 'true' },
    });
    close.createSpan({ text: 'Close' });
    this.keycap(close, verifiedKeycap({ kind: 'session-complete' }, 'Escape', 'Esc', 'close-tab'));
    this.registerDomEvent(close, 'click', () => this.leaf.detach());
  }
}
