/**
 * `SessionBuilderView` — the time-bounded session screen (F4.6, F4.7, F4.8,
 * F4.9; `ol-p5t06b` [P5-T06b]).
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
 * **The one rule this file must not break.** It renders `sessionScreenCopy`'s
 * result on every path — session or no session, focused or not. That function
 * is what emits the F4.9 framing and the left-out lines, and it has no branch
 * that produces a bare list of cards. A card list written here directly, or a
 * summary line assembled in this file, would be a claim nothing can assert on.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { StudySessionItem, StudySessionModel } from 'olea-core';
import {
  budgetOptionLabel,
  DEFAULT_SESSION_BUDGET_MINUTES,
  SESSION_BUDGET_OPTIONS,
  SESSION_UNAVAILABLE_BODY,
  SESSION_UNAVAILABLE_TITLE,
  SESSION_VIEW_TITLE,
  sessionItemLine,
  sessionScreenCopy,
} from './copy.js';

export const VIEW_TYPE_OLEA_SESSION = 'olea-session-builder';

/** What the view was handed. Two states, for the reason `GapViewState`'s own doc gives: "we could not read your vault" and "there is nothing to build" are different sentences. */
export type SessionBuilderState =
  | { readonly kind: 'model'; readonly model: StudySessionModel }
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

    if (state.kind === 'unavailable') {
      const box = root.createDiv({ cls: 'olea-session-unavailable' });
      box.createDiv({ cls: 'olea-session-unavailable-title', text: SESSION_UNAVAILABLE_TITLE });
      box.createDiv({ cls: 'olea-session-unavailable-body', text: SESSION_UNAVAILABLE_BODY });
      return;
    }

    // Every sentence on this screen comes from `copy.ts`, including the F4.9
    // framing and the left-out lines. This loop must never gain a sibling that
    // writes a sentence of its own.
    const copy = root.createDiv({ cls: 'olea-session-copy' });
    for (const line of sessionScreenCopy(state.model)) {
      copy.createDiv({ cls: 'olea-session-line', text: line });
    }

    const list = root.createDiv({ cls: 'olea-session-items' });
    for (const item of state.model.items) this.renderItem(list, item);
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
