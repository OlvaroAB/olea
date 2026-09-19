/**
 * `PaperView` — the practice-paper surface (F4.11, `[D-250]`/`[D-252]`/`[D-262]`, `[PAPER-8]` /
 * `ol-egov.141.6.1`, NEW-E4).
 *
 * **Thin by design, same discipline `gap/view.ts`'s own module doc states and the same reason: no
 * test file for this module, and none is expected** — `obsidian` has no runtime outside a real
 * host, so the logic worth testing (which state a course is in, what the partial statement says,
 * what an item's label reads) lives in `./provider.ts` and `./copy.ts`, both plain TypeScript,
 * both unit-tested (`test/paper/provider.spec.ts`, `test/paper/copy.spec.ts`). This file is DOM
 * only: it renders whatever `PracticePaperCourseState`/`PracticePaperReadyState` it is handed, and
 * decides nothing about wording or eligibility itself.
 *
 * **One course per open, seeded rather than picked from a list** (`setCourse`) — mirrors
 * `session-builder/view.ts`'s `setFocusConcept` seeding pattern. F4.11's own text is explicit that
 * this is "one affordance, ON THE COURSE," not a cross-course browser; a future bead adding a
 * second door (the course grove's own card, say) calls `setCourse` the same way this view's own
 * command handler does — see `wiring.ts`'s module doc for the reachability note on that second
 * door.
 *
 * **Statement placement is the one rule this file must not break** (`[D-262]` ruling 4: "before
 * she opens it"). `renderReady` always draws `state.partialStatement` first, before any item —
 * never after, never conditionally reordered.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import {
  buildLockedCopy,
  buildNoAssessmentAheadCopy,
  PRACTICE_PAPER_AI_UNAVAILABLE_COPY,
} from './copy.js';
import { VIEW_TYPE_OLEA_PAPER } from './ids.js';
import type { PracticePaperCourseState, PracticePaperViewDeps } from './provider.js';

export { VIEW_TYPE_OLEA_PAPER };

export const PAPER_VIEW_TITLE = 'Practice paper';

export class PaperView extends ItemView {
  private readonly deps: PracticePaperViewDeps;
  private course: string | undefined;

  constructor(leaf: WorkspaceLeaf, deps: PracticePaperViewDeps, initialCourse?: string) {
    super(leaf);
    this.deps = deps;
    this.course = initialCourse;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_PAPER;
  }

  override getDisplayText(): string {
    return this.course === undefined ? PAPER_VIEW_TITLE : `${PAPER_VIEW_TITLE}: ${this.course}`;
  }

  override getIcon(): string {
    return 'file-question';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-paper-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-seeds the view for a different course and redraws — same no-stack reuse `main.ts`'s `revealPracticePaperView` relies on. */
  async setCourse(course: string): Promise<void> {
    this.course = course;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    if (this.course === undefined) {
      root.createEl('p', { text: 'Open this from a course note to see its practice paper.' });
      return;
    }
    const state = await this.deps.load(this.course);
    this.render(state);
  }

  private render(state: PracticePaperCourseState): void {
    const root = this.contentEl;
    root.empty();
    root.createEl('h2', { text: this.getDisplayText() });

    if (state.kind === 'assignments-not-configured') {
      root.createEl('p', {
        text: 'Set up your assignments table in Olea settings to use practice papers.',
      });
      return;
    }
    if (state.kind === 'no-assessment-ahead') {
      root.createEl('p', { text: buildNoAssessmentAheadCopy(state.course) });
      return;
    }
    if (state.kind === 'locked') {
      root.createEl('p', {
        text: buildLockedCopy(state.course, state.daysUntilNearest, state.nearestAssessmentDue),
      });
      return;
    }
    if (state.kind === 'ai-unavailable') {
      root.createEl('p', { text: PRACTICE_PAPER_AI_UNAVAILABLE_COPY });
      return;
    }
    if (state.kind === 'unlocked-not-pulled') {
      const button = root.createEl('button', { text: 'Give me a practice paper for this course' });
      button.addEventListener('click', () => {
        void this.pullPaper(state.course);
      });
      return;
    }
    // `state.kind === 'ready'`
    this.renderReady(root, state);
  }

  private async pullPaper(course: string): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.createEl('p', { text: 'Composing your practice paper…' });
    const result = await this.deps.requestPaper(course);
    if (result.kind === 'ai-unavailable') {
      this.render(result);
      return;
    }
    this.render(result);
  }

  private renderReady(
    root: HTMLElement,
    state: Extract<PracticePaperCourseState, { readonly kind: 'ready' }>,
  ): void {
    // [D-262] ruling 4: the statement is drawn BEFORE any item, always — never reordered.
    if (state.partialStatement !== null) {
      const banner = root.createDiv({ cls: 'olea-paper-partial-banner' });
      banner.createEl('p', { text: state.partialStatement.sentence });
      if (state.partialStatement.pointerPaths.length > 0) {
        const list = banner.createEl('ul');
        for (const path of state.partialStatement.pointerPaths) {
          list.createEl('li', { text: path });
        }
      }
    }

    const list = root.createEl('ul', { cls: 'olea-paper-items' });
    for (const item of state.items) {
      const row = list.createEl('li');
      row.createEl('strong', { text: item.conceptName });
      row.createEl('span', { text: ` — ${item.groundingLabel}` });
    }

    if (state.emptySlots.length > 0) {
      const emptyList = root.createEl('ul', { cls: 'olea-paper-empty-slots' });
      for (const slot of state.emptySlots) {
        emptyList.createEl('li', { text: `${slot.conceptName}: ${slot.reason}` });
      }
    }
  }
}
