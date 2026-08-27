/**
 * The Obsidian host for `./confirmation-view.ts`'s `renderCourseSetupConfirmation`
 * (`ol-0r92.7`, C7.8/`[D-098]` point 1, F1.3). `confirmation-view.ts`'s own
 * module doc names exactly this gap: the confirmation surface renders into
 * any container it is given, but nothing in the plugin ever gave it one —
 * "no course-setup screen exists anywhere in this codebase to host an
 * `ItemView` on." This is that host, and nothing more: nothing here derives a
 * proposal, computes recognition, or persists a result. `main.ts` builds the
 * proposal (`packages/core/src/course/lifecycle.ts`'s `detectCourseProposals`)
 * and supplies it, along with `onConfirm`, exactly as
 * `CourseSetupConfirmationOptions` requires.
 *
 * A thin `Modal` subclass, not a view: this is a one-shot decision she makes
 * once per detected course, not a screen she returns to, so it does not
 * warrant a `WorkspaceLeaf`/`ItemView` the way `TodayView` or `ReviewView` do
 * — the same distinction Obsidian itself draws between its own `Modal` and
 * `ItemView` base classes.
 *
 * `onClose` empties `contentEl` on EVERY close, confirmed or dismissed — but
 * fires `onDismiss` only when it closes WITHOUT having confirmed first.
 * Dismissing this modal (the Escape key, clicking outside) is not a "no"
 * answer to anything: C7.8 names exactly one action this surface offers
 * (confirm). `main.ts`'s caller still needs to know a dismiss happened,
 * though — it is what lets the next queued proposal (if any) open rather
 * than leaving the whole detection queue stuck behind an unanswered modal.
 */

import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import {
  type CourseSetupConfirmationOptions,
  renderCourseSetupConfirmation,
} from './confirmation-view.js';

export interface CourseSetupModalOptions extends CourseSetupConfirmationOptions {
  /**
   * Fires when the modal closes WITHOUT having confirmed — Escape, clicking
   * outside, or the host calling `close()` directly. Never fires after
   * `onConfirm` has already fired for this instance (confirming calls
   * `close()` itself, which must not double-report as a dismiss).
   */
  readonly onDismiss?: () => void;
}

export class CourseSetupModal extends Modal {
  private readonly modalOptions: CourseSetupModalOptions;
  private confirmed = false;

  constructor(app: App, options: CourseSetupModalOptions) {
    super(app);
    this.modalOptions = options;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderCourseSetupConfirmation(contentEl, {
      ...this.modalOptions,
      onConfirm: (result) => {
        this.confirmed = true;
        this.modalOptions.onConfirm(result);
        this.close();
      },
    });
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.modalOptions.onDismiss?.();
  }
}
