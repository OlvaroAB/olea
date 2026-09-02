/**
 * `BulkReviewView` — F3.3's bulk-review triage path, DOM glue only
 * (`ol-jie3`). All the logic — grouping, resolving, accept-remainder — lives
 * in `bulk-review.ts`'s obsidian-free `BulkReviewController`; this file
 * builds the list, wires clicks, and re-renders after every action, the same
 * "structure here, logic there" split `review/view.ts` uses over
 * `review/session.ts` (see that file's own module doc). No test file exists
 * for this one and none is expected, for the identical reason: `obsidian`
 * has no runtime outside a real host, so `BulkReviewController`
 * (`bulk-review.spec.ts`) carries every scenario that doesn't need a real
 * DOM, and this file is left thin and mechanical on purpose.
 *
 * **Second density, same three actions — F3.3's own clause test.** Every
 * row offers exactly Accept / Edit before saving / Reject, the same three
 * outcomes `review/view.ts`'s new-badge header offers at first presentation,
 * reached through the identical `BulkReviewController` methods that call the
 * identical `DraftAcceptPort` — plus one batch action per group, resolving
 * the whole group through the same `accept()` a single click already uses
 * (`ol-p3t07a`'s own acceptance bar: "clearing 40 drafts from one deck must
 * take minutes").
 *
 * **The batch action and the empty state name no count (F6.7, F3.3;
 * `ol-0r92.30` / `ol-l5og.15`).** F6.7 forbids a standalone number of
 * material she has not yet met, and F3.3 calls bulk review "the same action
 * at a second density, never a second mental model" — so nothing here may
 * read as a queue with a debt to clear. The batch button is labelled "Accept
 * the rest", naming the action without counting what it resolves; the empty
 * state states what is here (nothing) rather than what is "waiting for
 * review". Neither the group header nor the empty state may reintroduce a
 * remaining-items count.
 *
 * **Click-only this round, disclosed (`ol-uxk9`).** No keyboard binding
 * exists for any control here yet. `keymap.ts`'s Q6.5 promise ("every
 * ON-SCREEN hint is a real binding") still holds because this view draws no
 * hint row — nothing here claims an unbound key.
 *
 * **Dark by default, regardless of her theme (F2.4)** — same `theme-dark`
 * class on `contentEl` that `review/view.ts` applies, and the same reasoning:
 * it makes this view's own `var(--background-primary, …)` resolve through
 * the dark branch of her installed theme without fighting the rest of
 * Obsidian, and undoes itself the instant the tab closes.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { BulkReviewController } from './bulk-review.js';

export const VIEW_TYPE_OLEA_BULK_REVIEW = 'olea-bulk-review';

/**
 * Provided by `main.ts` — called once per open, same reasoning
 * `review/view.ts`'s `ReviewSessionProvider` doc gives for its own provider:
 * building a controller is synchronous, but loading it (a vault walk) is
 * not, and deferring both into `onOpen` is what makes a tab Obsidian
 * restores at startup show the vault as it is *now*.
 */
export type BulkReviewControllerProvider = () => BulkReviewController;

export class BulkReviewView extends ItemView {
  private readonly getController: BulkReviewControllerProvider;
  private controller: BulkReviewController | null = null;

  constructor(leaf: WorkspaceLeaf, getController: BulkReviewControllerProvider) {
    super(leaf);
    this.getController = getController;
    // A triage list isn't a file to navigate back/forward through, same
    // reasoning `review/view.ts` gives for its own tab.
    this.navigation = false;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_BULK_REVIEW;
  }

  override getDisplayText(): string {
    return 'Olea bulk review';
  }

  override getIcon(): string {
    return 'list-checks';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('olea-bulk-review-root', 'theme-dark');
    this.renderLoading();
    this.controller = this.getController();
    await this.controller.load();
    this.render();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /**
   * Reloads the controller and re-renders — `today/refresh.ts`'s
   * `refreshOpenTodayViews` calls this by shape (`RefreshableView`) on every
   * already-open leaf when `main.ts#revealBulkReviewView` is invoked, the
   * same "refresh on reveal" convention `TodayView`/`GapView` already use.
   * Reachable only after `onOpen` has run (`this.controller` set); a no-op
   * before that, matching those views' own guard.
   */
  async refresh(): Promise<void> {
    if (this.controller === null) return;
    await this.controller.load();
    this.render();
  }

  /** Runs one controller action, then reloads and re-renders — every action here can change what else is still pending (an accept-remainder resolves a whole group at once), so a fresh `load()` is cheaper to reason about than patching the view model in place. */
  private async run(action: (controller: BulkReviewController) => Promise<void>): Promise<void> {
    const controller = this.controller;
    if (controller === null) return;
    await action(controller);
    await controller.load();
    this.render();
  }

  private renderLoading(): void {
    this.contentEl.empty();
    this.contentEl.createDiv({ cls: 'olea-bulk-review-loading', text: 'Loading drafts…' });
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    const controller = this.controller;
    if (controller === null) return;

    root.createEl('h2', { cls: 'olea-bulk-review-title', text: 'Review drafts in bulk' });

    const vm = controller.getViewModel();
    if (vm.groups.length === 0) {
      root.createEl('p', {
        cls: 'olea-bulk-review-empty',
        text: 'Nothing here to review right now.',
      });
      return;
    }

    for (const group of vm.groups) {
      this.renderGroup(root, group.sourcePath, group.courseCode, group.noteTitle, group.items);
    }
  }

  private renderGroup(
    root: HTMLElement,
    sourcePath: string,
    courseCode: string,
    noteTitle: string,
    items: readonly {
      readonly draftId: string;
      readonly stem: string;
      readonly conceptName: string;
    }[],
  ): void {
    const section = root.createDiv({ cls: 'olea-bulk-review-group' });
    const header = section.createDiv({ cls: 'olea-bulk-review-group-header' });
    header.createSpan({ cls: 'olea-bulk-review-group-course', text: courseCode });
    header.createSpan({ cls: 'olea-bulk-review-group-dot' });
    header.createSpan({ cls: 'olea-bulk-review-group-note', text: noteTitle });

    const remainderBtn = header.createEl('button', {
      cls: 'olea-bulk-review-remainder',
      text: 'Accept the rest',
    });
    this.registerDomEvent(remainderBtn, 'click', () => {
      void this.run((controller) => controller.acceptRemainder(sourcePath).then(() => undefined));
    });

    const list = section.createDiv({ cls: 'olea-bulk-review-items' });
    for (const item of items) {
      const row = list.createDiv({ cls: 'olea-bulk-review-item' });
      row.createDiv({ cls: 'olea-bulk-review-item-stem', text: item.stem });
      row.createDiv({ cls: 'olea-bulk-review-item-concept', text: item.conceptName });

      const actions = row.createDiv({ cls: 'olea-bulk-review-item-actions' });

      const acceptBtn = actions.createEl('button', {
        cls: 'olea-bulk-review-action',
        text: 'Accept',
      });
      this.registerDomEvent(acceptBtn, 'click', () => {
        void this.run((controller) => controller.accept(item.draftId));
      });

      const editBtn = actions.createEl('button', {
        cls: 'olea-bulk-review-action',
        text: 'Edit before saving',
      });
      this.registerDomEvent(editBtn, 'click', () => {
        void this.run((controller) => controller.editBeforeSaving(item.draftId));
      });

      const rejectBtn = actions.createEl('button', {
        cls: 'olea-bulk-review-action',
        text: 'Reject',
      });
      this.registerDomEvent(rejectBtn, 'click', () => {
        void this.run((controller) => controller.reject(item.draftId));
      });
    }
  }
}
