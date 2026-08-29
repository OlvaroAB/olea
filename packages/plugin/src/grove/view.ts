/**
 * `GroveView` — the course-grove host (F8.1, `[D-134]` Q1, `ol-0r92.17`; the
 * real six-state computation, `ol-o8eo`).
 *
 * `./provider.ts` now reads `olea-core#buildGroveModel` — F8.1's six-state
 * coverage layer (`ground`/`seed`/`sprout`/`sapling`/`tree`/`volunteer`)
 * against the denominator the examiner's own registered documents declare
 * (F1.5/F4.1) — rather than the growth-stage-only stand-in this bead's
 * predecessor rendered. This module is the renderer for the resulting
 * three-way `GroveCourseModel`:
 *
 *  - `'no-registered-source'` — F8.1 scenario 2's designed empty state.
 *  - `'inferred'` — F8.1 scenario 3: Olea's own reading, presented as a
 *    guess, `grove`'s own denominator claim withheld entirely (no `cells`,
 *    no `summary` exist on this branch of the TYPE, not just the copy).
 *  - `'declared'` — the real reading: `cells` (the five in-scope states),
 *    `materialGaps` (F4.10, plain language, never a sixth cell state) and
 *    `volunteers` (F8.2, outside the count, never hidden), plus F8.3's
 *    count-and-source `summary` — never a ratio.
 *
 * **`ol-z0j9`'s naming tension is left exactly where it was filed.** This
 * view still calls itself "Grove" and still opens through the same command —
 * renaming either is David's call. What changed is that the `'inferred'`
 * branch now visibly withholds the `grove`/denominator framing (no cell grid
 * for it, no summary line) rather than rendering the full grid under a
 * disclaimer, which is the honest reading available until that naming
 * question is answered.
 *
 * **Styles.** `packages/plugin/styles.css` is not this bead's file, so this
 * view's classes have no stylesheet section yet and render on host defaults
 * meanwhile — the same honest gap `gap/view.ts` names for itself.
 *
 * **No test file for this module and none is expected** — `obsidian` has no
 * runtime outside a real host; the honesty properties are asserted against
 * `./copy.ts` and `./provider.ts` under Vitest instead (same convention
 * `today/view.ts`/`gap/view.ts` document).
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { GroveCourseModel, VaultPath } from 'olea-core';
import type { RetrospectiveOfferCard } from '../retrospective/offer-card.js';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  DISMISS_OFFER_ACTION,
  GROVE_EMPTY_COURSE,
  GROVE_GROUND_STALL_NOTE,
  GROVE_INFERRED_DISCLAIMER,
  GROVE_MATERIAL_GAP_LABEL,
  GROVE_NO_SOURCE_BODY,
  GROVE_NO_SOURCE_HEADING,
  GROVE_UNAVAILABLE,
  GROVE_VIEW_TITLE,
  GROVE_VOLUNTEER_SECTION_HEADING,
  GROVE_VOLUNTEER_SECTION_NOTE,
  groveStateLabel,
  groveSummaryLine,
  OPEN_RETROSPECTIVE_ACTION,
} from './copy.js';

export const VIEW_TYPE_OLEA_GROVE = 'olea-grove';

/** One course's grove section — the real `GroveCourseModel` (`olea-core`) plus this course's own standing offer card(s). */
export interface GroveCourseSection {
  readonly course: string;
  readonly model: GroveCourseModel;
  /** This course's own standing offer card(s), D-134 Q1's "filter to its own course" half. */
  readonly offerCards: readonly RetrospectiveOfferCard[];
}

export type GroveViewState =
  | { readonly kind: 'model'; readonly courses: readonly GroveCourseSection[] }
  | { readonly kind: 'unavailable' };

export interface GroveViewDeps {
  /** Loads the view state. Async because it reads the vault. */
  readonly load: () => Promise<GroveViewState>;
  /** Opens the retrospective's own dedicated view (F8.8, `[D-134]` Q10) — the same door `main.ts`'s F7.7 command opens. */
  readonly openRetrospective: () => void;
  /** D-134 Q1's other ending — the offer's own dismiss, without opening. */
  readonly dismiss: (assessmentPath: VaultPath) => Promise<void>;
}

export class GroveView extends ItemView {
  private readonly deps: GroveViewDeps;

  constructor(leaf: WorkspaceLeaf, deps: GroveViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_GROVE;
  }

  override getDisplayText(): string {
    return GROVE_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'trees';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-grove-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-reads and redraws. Public so a host can refresh after her material changes, or after a dismiss on this screen — same convention `GapView.refresh`/`RegistryView.refresh` already set. */
  async refresh(): Promise<void> {
    this.render(await this.deps.load());
  }

  private render(state: GroveViewState): void {
    const root = this.contentEl;
    root.empty();
    root.createEl('h2', { text: GROVE_VIEW_TITLE });

    if (state.kind === 'unavailable') {
      root.createDiv({ cls: 'olea-grove-unavailable', text: GROVE_UNAVAILABLE });
      return;
    }

    for (const section of state.courses) this.renderCourse(root, section);
  }

  private renderCourse(parent: HTMLElement, section: GroveCourseSection): void {
    const box = parent.createDiv({ cls: 'olea-grove-course' });
    box.createDiv({ cls: 'olea-grove-course-name', text: section.course });

    switch (section.model.status) {
      case 'no-registered-source':
        box.createDiv({ cls: 'olea-grove-course-heading', text: GROVE_NO_SOURCE_HEADING });
        box.createDiv({ cls: 'olea-grove-no-source-body', text: GROVE_NO_SOURCE_BODY });
        break;
      case 'inferred':
        // F8.1 scenario 3: the `grove` label and its denominator claim are
        // withheld entirely for this course — no cell grid, no summary line,
        // only the disclaimer and what Olea has actually found.
        box.createDiv({ cls: 'olea-grove-disclaimer', text: GROVE_INFERRED_DISCLAIMER });
        if (section.model.concepts.length === 0) {
          box.createDiv({ cls: 'olea-grove-empty', text: GROVE_EMPTY_COURSE });
        } else {
          const list = box.createDiv({ cls: 'olea-grove-concepts' });
          for (const concept of section.model.concepts) {
            const el = list.createDiv({ cls: 'olea-grove-concept' });
            el.createSpan({ cls: 'olea-grove-concept-name', text: concept.conceptName });
          }
        }
        break;
      case 'declared':
        this.renderDeclared(box, section.model);
        break;
    }

    for (const card of section.offerCards) this.renderOfferCard(box, card);
  }

  private renderDeclared(
    parent: HTMLElement,
    model: Extract<GroveCourseModel, { readonly status: 'declared' }>,
  ): void {
    // F8.3: the count and the denominator's source, shown separately — never
    // their ratio, and no percentage anywhere on this line.
    const summaryEl = parent.createDiv({ cls: 'olea-grove-summary' });
    summaryEl.createSpan({
      cls: 'olea-grove-summary-line',
      text: groveSummaryLine(model.summary),
    });

    if (model.cells.length === 0 && model.materialGaps.length === 0) {
      parent.createDiv({ cls: 'olea-grove-empty', text: GROVE_EMPTY_COURSE });
    } else {
      const list = parent.createDiv({ cls: 'olea-grove-concepts' });
      for (const cell of model.cells) {
        const el = list.createDiv({ cls: 'olea-grove-concept' });
        if (cell.state !== 'ground') {
          el.appendChild(renderSprig({ state: cell.state, size: 12, container: el }));
        } else {
          el.createSpan({ cls: 'olea-grove-ground-mark', text: groveStateLabel('ground') });
        }
        el.createSpan({ cls: 'olea-grove-concept-name', text: cell.conceptName });
        if (cell.stall) {
          el.createSpan({ cls: 'olea-grove-ground-stall', text: GROVE_GROUND_STALL_NOTE });
        }
      }
      for (const gap of model.materialGaps) {
        const el = list.createDiv({ cls: 'olea-grove-material-gap' });
        el.createSpan({ cls: 'olea-grove-concept-name', text: gap.conceptName });
        el.createSpan({ cls: 'olea-grove-material-gap-label', text: GROVE_MATERIAL_GAP_LABEL });
      }
    }

    if (model.volunteers.length > 0) {
      const volunteerBox = parent.createDiv({ cls: 'olea-grove-volunteers' });
      volunteerBox.createDiv({
        cls: 'olea-grove-volunteer-heading',
        text: GROVE_VOLUNTEER_SECTION_HEADING,
      });
      volunteerBox.createDiv({
        cls: 'olea-grove-volunteer-note',
        text: GROVE_VOLUNTEER_SECTION_NOTE,
      });
      for (const volunteer of model.volunteers) {
        volunteerBox.createDiv({
          cls: 'olea-grove-concept',
          text: volunteer.conceptName,
        });
      }
    }
  }

  private renderOfferCard(parent: HTMLElement, card: RetrospectiveOfferCard): void {
    const el = parent.createDiv({ cls: 'olea-grove-offer' });
    el.createDiv({ cls: 'olea-grove-offer-line', text: card.line });

    const actions = el.createDiv({ cls: 'olea-grove-offer-actions' });
    const openButton = actions.createEl('button', {
      cls: 'olea-grove-offer-open',
      text: OPEN_RETROSPECTIVE_ACTION,
    });
    openButton.addEventListener('click', () => {
      this.deps.openRetrospective();
    });

    const dismissButton = actions.createEl('button', {
      cls: 'olea-grove-offer-dismiss',
      text: DISMISS_OFFER_ACTION,
    });
    dismissButton.addEventListener('click', () => {
      void this.deps.dismiss(card.assessmentPath).then(() => this.refresh());
    });
  }
}
