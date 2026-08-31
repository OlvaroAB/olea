/**
 * `SessionBuilderView` — the time-bounded session screen (F4.6, F4.7, F4.8,
 * F4.9; `ol-p5t06b` [P5-T06b]), and F6.6's re-entry-after-absence surface
 * (`ol-v7r5.18`, discovered from `ol-blwb` / `[BKLG-1]`).
 *
 * **Thin by design, and here that is a safety property.** Everything this
 * screen *decides* is in `olea-core`'s `study-session/` — which instruments are
 * offered, in what order, at what estimated cost, and what was left out and
 * why. Everything it *says* is in `./copy.ts`. What is left here is DOM and one
 * piece of state (the chosen budget), which is exactly the split `gap/view.ts`
 * holds and for the same reason (`ol-09kf`).
 *
 * So there is no test file for this module and none is expected — `obsidian`
 * has no runtime outside a real host (its `package.json` `main` is empty, so it
 * cannot even be imported under Vitest). `test/session-builder/copy.spec.ts` is
 * where the honesty properties are asserted, and `test/main-wiring.spec.ts` is
 * where its reachability is.
 *
 * **RBLD-2 (`ol-e228`), component register row 3.6.** This view holds no
 * `SittingState` itself, even though it is the surface that decides *when* a
 * sitting begins and ends. The freeze the rebuild controller (`olea-core`'s
 * `queue/rebuild-controller.ts`) provides is only worth holding somewhere that
 * can also cheaply tell whether a between-sittings trigger fired, and this
 * file has no vault or review-log access to do that (the thin-view rule
 * above) — `./provider.js` does, so `deps.load` is where the `SittingState`
 * actually lives, closed over once per leaf. What this view DOES own, per the
 * bead: the two lifecycle edges deciding when a sitting starts and ends —
 * every `load` call from `refresh`/`setFocusConcept`/a budget click IS "she
 * asked for a session" (`load`'s own controller always honours an explicit
 * ask), and `onClose` below is "she finished or abandoned" via
 * `deps.endSitting`.
 *
 * **The one rule this file must not break.** It renders `sessionScreenCopy`'s
 * result for an ordinary session and `reentryScreenCopy`'s result for a
 * re-entry one (`SessionBuilderState`'s `'reentry'` branch) — session or no
 * session, focused or not, re-entry or not. Those two functions are what emit
 * the F4.9 framing, the left-out lines (ordinary only — see `reentryScreenCopy`'s
 * own doc for why a re-entry render must never reach `leftOutLines`) and F6.6's
 * always-available line, and neither has a branch that produces a bare list of
 * cards. A card list written here directly, or a summary line assembled in this
 * file, would be a claim nothing can assert on.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { ReentryStudySessionView, StudySessionItem, StudySessionModel } from 'olea-core';
import { EXPLAIN_BACK_SESSION_ENTRY_LABEL } from '../explain-back/copy.js';
import {
  budgetOptionLabel,
  DEFAULT_SESSION_BUDGET_MINUTES,
  reentryScreenCopy,
  SESSION_BUDGET_OPTIONS,
  SESSION_UNAVAILABLE_BODY,
  SESSION_UNAVAILABLE_TITLE,
  SESSION_VIEW_TITLE,
  sessionItemLine,
  sessionScreenCopy,
} from './copy.js';

export const VIEW_TYPE_OLEA_SESSION = 'olea-session-builder';

/**
 * What the view was handed. Three states, for the reason `GapViewState`'s own
 * doc gives: "we could not read your vault" and "there is nothing to build"
 * are different sentences — and F6.6 (`ol-v7r5.18`) adds a third that is
 * neither: `'reentry'` carries `ReentryStudySessionView`, not
 * `StudySessionModel`, so a re-entry render is structurally unable to reach
 * `leftOutInstrumentCount`/`consideredRowCount` (`olea-core`'s
 * `ReentryStudySessionView` doc) — the same reason `composeReentrySession`
 * gives that type its own shape rather than a flag on the ordinary one.
 */
export type SessionBuilderState =
  | { readonly kind: 'model'; readonly model: StudySessionModel }
  | { readonly kind: 'reentry'; readonly view: ReentryStudySessionView }
  | { readonly kind: 'unavailable' };

/** What the view asks for when it (re)builds. */
export interface SessionBuilderRequest {
  readonly budgetMinutes: number;
  /** The concept the gap view's `build-session` affordance named, if any. Omitted means "build from the whole ranking". */
  readonly focusConceptName?: string;
}

export interface SessionBuilderViewDeps {
  /** Builds a session. Async because it reads the vault and runs the oracle chain. */
  readonly load: (request: SessionBuilderRequest) => Promise<SessionBuilderState>;
  /** Overrides `SESSION_BUDGET_OPTIONS` — the budgets are a Class B default, reversible from the outside. */
  readonly budgetOptions?: readonly number[];
  readonly defaultBudgetMinutes?: number;
  /**
   * RBLD-2 (`ol-e228`), component register row 3.6: tells `load`'s own
   * rebuild controller that she finished or navigated away, so the freeze it
   * holds across `load` calls (`./provider.js`'s `SittingState`) releases —
   * the next `load` is free to recompute rather than reuse. `onClose` is this
   * surface's operational reading of "she finished" (`rebuild-controller.ts`'s
   * own doc offers "opening the view vs. closing it" as the two candidates;
   * there is no explicit finish/abandon affordance on this screen to read
   * instead — F4.6/F4.7/F4.8 name none). Optional so a `deps` that predates
   * this wiring (a test double, say) still satisfies the interface.
   */
  readonly endSitting?: () => void;
  /**
   * F4.6 session assembly / F6.4 Today's suggestion — two of `[D-163]`'s four
   * ruled entry points onto `ExplainBackModal` (`ol-12gs`), both converging
   * on THIS screen: `today/copy.ts`'s own module doc names this view as
   * F6.4's reachable caller ("the suggested session's screen... is the
   * reachable caller"), and F4.6 is this screen's own clause. Optional on the
   * same "main.ts supplies a handler" terms every other cross-package
   * callback in this plugin uses — this module never imports
   * `explain-back/modal.ts` or any grading/retrieval wiring itself.
   */
  readonly openExplainBack?: () => void;
}

export class SessionBuilderView extends ItemView {
  private readonly deps: SessionBuilderViewDeps;
  private budgetMinutes: number;
  private focusConceptName: string | undefined;

  constructor(leaf: WorkspaceLeaf, deps: SessionBuilderViewDeps) {
    super(leaf);
    this.deps = deps;
    this.budgetMinutes = deps.defaultBudgetMinutes ?? DEFAULT_SESSION_BUDGET_MINUTES;
    this.focusConceptName = undefined;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_SESSION;
  }

  override getDisplayText(): string {
    return SESSION_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'timer';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-session-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
    // RBLD-2 (`ol-e228`): closing the tab is this surface's "she finished or
    // abandoned" — see `SessionBuilderViewDeps.endSitting`'s own doc.
    this.deps.endSitting?.();
  }

  /**
   * Rebuilds and redraws.
   *
   * `focusConceptName` is *sticky* across a budget change on purpose: she asked
   * to start from a concept, then asked for more time, and dropping the first
   * request because of the second would be the surface quietly deciding it knew
   * better. {@link setFocusConcept} is the only thing that changes it.
   */
  async refresh(): Promise<void> {
    const request: SessionBuilderRequest =
      this.focusConceptName === undefined
        ? { budgetMinutes: this.budgetMinutes }
        : { budgetMinutes: this.budgetMinutes, focusConceptName: this.focusConceptName };
    this.render(await this.deps.load(request));
  }

  /** Points this view at one concept — the gap view's `build-session` affordance. Public so `main.ts` can seed a leaf it is about to reveal. */
  async setFocusConcept(conceptName: string | undefined): Promise<void> {
    this.focusConceptName = conceptName;
    await this.refresh();
  }

  private render(state: SessionBuilderState): void {
    const root = this.contentEl;
    root.empty();

    this.renderBudgetControls(root);
    this.renderExplainBackEntry(root);

    if (state.kind === 'unavailable') {
      const box = root.createDiv({ cls: 'olea-session-unavailable' });
      box.createDiv({ cls: 'olea-session-unavailable-title', text: SESSION_UNAVAILABLE_TITLE });
      box.createDiv({ cls: 'olea-session-unavailable-body', text: SESSION_UNAVAILABLE_BODY });
      return;
    }

    // Every sentence on this screen comes from `copy.ts` — `sessionScreenCopy`
    // for an ordinary session, `reentryScreenCopy` for F6.6's re-entry one
    // (never the same function: see that function's own doc for why
    // `leftOutLines` must never run over a re-entry view). Neither branch of
    // this loop may gain a sibling that writes a sentence of its own.
    const lines =
      state.kind === 'reentry' ? reentryScreenCopy(state.view) : sessionScreenCopy(state.model);
    const copy = root.createDiv({ cls: 'olea-session-copy' });
    for (const line of lines) {
      copy.createDiv({ cls: 'olea-session-line', text: line });
    }

    const items = state.kind === 'reentry' ? state.view.items : state.model.items;
    const list = root.createDiv({ cls: 'olea-session-items' });
    for (const item of items) this.renderItem(list, item);
  }

  private renderBudgetControls(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: 'olea-session-budgets' });
    for (const minutes of this.deps.budgetOptions ?? SESSION_BUDGET_OPTIONS) {
      const button = bar.createSpan({
        cls: 'olea-session-budget',
        text: budgetOptionLabel(minutes),
      });
      // `addClass` rather than a ternary inside `cls:` — `test/session-builder/
      // styles.spec.ts` reads the class names out of this file's source, and a
      // class hidden inside a conditional expression is one the drift guard
      // cannot see (the same reason `gap/view.ts` keeps its dynamic classes in
      // a template literal rather than a ternary).
      if (minutes === this.budgetMinutes) button.addClass('olea-session-budget-active');
      button.addEventListener('click', () => {
        this.budgetMinutes = minutes;
        void this.refresh();
      });
    }
  }

  /**
   * F4.6 / F6.4, `[D-163]` (`ol-12gs`): the session-builder/Today-suggestion
   * door onto `ExplainBackModal` — see `SessionBuilderViewDeps.openExplainBack`'s
   * own doc for why both clauses converge on this one screen. Rendered
   * standing, independent of `state`, the same way F2.20's "available help"
   * posture keeps F2.7's own on-demand channel reachable regardless of
   * queue state — never gated on whether a session was actually built.
   */
  private renderExplainBackEntry(parent: HTMLElement): void {
    const openExplainBack = this.deps.openExplainBack;
    if (!openExplainBack) return;
    const button = parent.createEl('button', {
      cls: 'olea-session-explain-back',
      text: EXPLAIN_BACK_SESSION_ENTRY_LABEL,
    });
    button.addEventListener('click', () => openExplainBack());
  }

  private renderItem(parent: HTMLElement, item: StudySessionItem): void {
    const el = parent.createDiv({
      cls: `olea-session-item olea-session-item-${item.formatMatch}`,
    });
    el.createSpan({ cls: 'olea-session-position', text: String(item.position) });
    el.createSpan({ cls: 'olea-session-concept', text: item.conceptName });
    el.createSpan({ cls: 'olea-session-course', text: item.course });
    el.createDiv({ cls: 'olea-session-item-line', text: sessionItemLine(item) });
    el.createDiv({ cls: 'olea-session-note', text: item.noteTitle });
  }
}
