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
 * **Styles (`ol-l5og.18.2`).** `packages/plugin/styles.css` now carries this
 * view's own section, ported from `docs/design/pass5b-mastery-ratified`'s
 * Candidate E (`Pass5bCoverage.jsx`, the ratified kit, `[D-054]`) — the
 * per-cell card treatment, the ground/material-gap dashed-vs-dotted split,
 * the papers ticks (`renderPapers` below) and the legend (`renderLegend`).
 * **Not ported: per-syllabus-unit column grouping.** The kit's primary grid
 * groups cells under syllabus-unit headings; no unit field exists anywhere
 * in this codebase's extraction pipeline (no `Source`, `ConceptRecord` or
 * `ConceptCitation` carries one), and building it means a new heading-
 * extraction pass over the objectives document — outside this bead's `owns`
 * (`packages/core/src/scope/grove.ts` plus this package's grove files) and
 * a real feature in its own right, not a styling port. `cells` therefore
 * still renders as one flat, styled grid — filed as follow-up work rather
 * than guessed at here. **Also not ported: the vitality/tending wash and
 * mark** — a disclosed `MAT-2` deferral, same as `../sprig/render-sprig.ts`
 * already states for the sprig's own `wilt` overlay.
 *
 * **No test file for this module and none is expected** — `obsidian` has no
 * runtime outside a real host; the honesty properties are asserted against
 * `./copy.ts` and `./provider.ts` under Vitest instead (same convention
 * `today/view.ts`/`gap/view.ts` document).
 *
 * **The scope-correction receipt, wired (`[D-184]`, F8.1, `ol-v7r5.32`).**
 * `./copy.ts#groveScopeCorrectionReceiptLine` existed with no production
 * caller until this bead: `./provider.ts` now computes, per `'declared'`
 * course, whether this read's `denominatorCount` fell against its own
 * persisted prior (`./prior-denominator-store.ts`) and — only when it can
 * name the document that caused the fall — attaches a
 * `GroveScopeCorrectionReceipt` to that course's `GroveCourseSection`.
 * `renderDeclared` below renders it exactly once, beside `groveSummaryLine`'s
 * own count, and never on a growth (F1.5(c) already treats a growing
 * denominator as unremarkable — `groveSummaryLine`'s own new numbers say
 * that without ceremony).
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { GroveCourseModel, UnreadableFile, VaultPath } from 'olea-core';
import type { RetrospectiveOfferCard } from '../retrospective/offer-card.js';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  DISMISS_OFFER_ACTION,
  GROVE_EMPTY_COURSE,
  GROVE_GROUND_STALL_NOTE,
  GROVE_INFERRED_DISCLAIMER,
  GROVE_LEGEND_GROUND_NOTE,
  GROVE_LEGEND_MATERIAL_GAP_NOTE,
  GROVE_LEGEND_PAPERS_NOTE,
  GROVE_MATERIAL_GAP_LABEL,
  GROVE_NO_COURSES_BODY,
  GROVE_NO_COURSES_HEADING,
  GROVE_NO_SOURCE_BODY,
  GROVE_NO_SOURCE_HEADING,
  GROVE_UNAVAILABLE,
  GROVE_UNREADABLE_HEADING,
  GROVE_VIEW_TITLE,
  GROVE_VOLUNTEER_SECTION_HEADING,
  GROVE_VOLUNTEER_SECTION_NOTE,
  grovePapersLabel,
  groveScopeCorrectionReceiptLine,
  groveStateLabel,
  groveSummaryLine,
  groveUnreadableReasonLabel,
  OPEN_RETROSPECTIVE_ACTION,
} from './copy.js';

/** The four growth-stage words, for the legend — same set `renderSprig`/`groveStateLabel` already read from `olea-core`. */
const LEGEND_STAGES = ['seed', 'sprout', 'sapling', 'tree'] as const;

export const VIEW_TYPE_OLEA_GROVE = 'olea-grove';

/**
 * `[D-184]`, F8.1, `ol-v7r5.32`: the scope-correction receipt's three
 * facts for one course's `'declared'` reading — computed once by
 * `./provider.ts` against its persisted `./prior-denominator-store.ts`
 * snapshot, and absent whenever nothing shrank this read (a growth, or the
 * very first read for this course on this install). See `./copy.ts
 * #groveScopeCorrectionReceiptLine` for the rendered sentence these three
 * facts produce.
 */
export interface GroveScopeCorrectionReceipt {
  readonly reclassifiedDocumentPath: VaultPath;
  readonly priorDenominatorCount: number;
  readonly newDenominatorCount: number;
}

/** One course's grove section — the real `GroveCourseModel` (`olea-core`) plus this course's own standing offer card(s). */
export interface GroveCourseSection {
  readonly course: string;
  readonly model: GroveCourseModel;
  /** This course's own standing offer card(s), D-134 Q1's "filter to its own course" half. */
  readonly offerCards: readonly RetrospectiveOfferCard[];
  /**
   * `[D-196]`, F1.5(b), F8.1: files in this course's F7.9 source location
   * the pipeline reached but could not read — path and one of exactly three
   * structural reasons, computed by `./provider.ts`
   * (`olea-core#findUnreadableFiles`, `ol-2zfj.56`). Rendered beside the
   * no-registered-source designed state and the `'declared'` readiness
   * reading (`renderCourse`/`renderDeclared` below) — never on the
   * `'inferred'` branch, matching F8.1's amendment naming exactly those two
   * surfaces.
   */
  readonly unreadableFiles: readonly UnreadableFile[];
  /**
   * `[D-184]`, F8.1, `ol-v7r5.32`: present only when `./provider.ts` found
   * both a shrink AND a document to name for it this read — see
   * `GroveScopeCorrectionReceipt`'s own doc. Only ever set alongside
   * `model.status === 'declared'`.
   */
  readonly scopeCorrectionReceipt?: GroveScopeCorrectionReceipt;
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

    if (state.courses.length === 0) {
      // WBX-18 (`ol-qm6u`): never a bare title with nothing under it — same principle F8.1's
      // per-course `'no-registered-source'` empty state already applies, one level up.
      root.createDiv({ cls: 'olea-grove-no-courses-heading', text: GROVE_NO_COURSES_HEADING });
      root.createDiv({ cls: 'olea-grove-no-courses-body', text: GROVE_NO_COURSES_BODY });
      return;
    }

    for (const section of state.courses) this.renderCourse(root, section);

    // `ol-l5og.18.2`: one legend for the whole screen, not one per course —
    // only when at least one course actually reached the real grid (the
    // marks it explains do not exist on the `'inferred'`/`'no-registered-
    // source'` branches).
    if (state.courses.some((section) => section.model.status === 'declared')) {
      this.renderLegend(root);
    }
  }

  private renderCourse(parent: HTMLElement, section: GroveCourseSection): void {
    const box = parent.createDiv({ cls: 'olea-grove-course' });
    box.createDiv({ cls: 'olea-grove-course-name', text: section.course });

    switch (section.model.status) {
      case 'no-registered-source':
        box.createDiv({ cls: 'olea-grove-course-heading', text: GROVE_NO_SOURCE_HEADING });
        box.createDiv({ cls: 'olea-grove-no-source-body', text: GROVE_NO_SOURCE_BODY });
        // F1.5(b): the same evidenced ask also lists unreadable files —
        // this IS the "grove unable to answer its own question" surface.
        this.renderUnreadableFiles(box, section.unreadableFiles);
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
        this.renderDeclared(
          box,
          section.model,
          section.unreadableFiles,
          section.scopeCorrectionReceipt,
        );
        break;
    }

    for (const card of section.offerCards) this.renderOfferCard(box, card);
  }

  private renderDeclared(
    parent: HTMLElement,
    model: Extract<GroveCourseModel, { readonly status: 'declared' }>,
    unreadableFiles: readonly UnreadableFile[],
    scopeCorrectionReceipt: GroveScopeCorrectionReceipt | undefined,
  ): void {
    // F8.3: the count and the denominator's source, shown separately — never
    // their ratio, and no percentage anywhere on this line.
    const summaryEl = parent.createDiv({ cls: 'olea-grove-summary' });
    summaryEl.createSpan({
      cls: 'olea-grove-summary-line',
      text: groveSummaryLine(model.summary),
    });
    // `[D-184]`, F8.1, `ol-v7r5.32`: "the same honesty runs in reverse" —
    // rendered ONCE, beside the count above, only when `./provider.ts`
    // found an actual shrink with a document to name for it. Never on a
    // growth: F1.5(c) already treats that as unremarkable.
    if (scopeCorrectionReceipt !== undefined) {
      summaryEl.createSpan({
        cls: 'olea-grove-scope-correction-receipt',
        text: groveScopeCorrectionReceiptLine(
          scopeCorrectionReceipt.reclassifiedDocumentPath,
          scopeCorrectionReceipt.priorDenominatorCount,
          scopeCorrectionReceipt.newDenominatorCount,
        ),
      });
    }
    // F8.1: "the readiness view" — the same list F1.5(b)'s designed-state
    // ask carries, shown here beside the count and its source.
    this.renderUnreadableFiles(parent, unreadableFiles);

    if (model.cells.length === 0 && model.materialGaps.length === 0) {
      parent.createDiv({ cls: 'olea-grove-empty', text: GROVE_EMPTY_COURSE });
    } else {
      // `ol-l5og.18.2`: the papers denominator is per-COURSE (how many
      // past papers are registered for it, not how many cite any given
      // concept) — zero means no past paper is registered at all, in
      // which case no cell draws a papers mark (`GroveCourseSummary
      // .pastPaperSourcePaths`'s own doc: an objectives document alone
      // can still make a course `'declared'`).
      const papersTotal = model.summary.pastPaperSourcePaths.length;
      const list = parent.createDiv({ cls: 'olea-grove-concepts' });
      for (const cell of model.cells) {
        const el = list.createDiv({
          cls:
            cell.state === 'ground'
              ? 'olea-grove-cell olea-grove-cell-ground'
              : 'olea-grove-cell olea-grove-cell-planted',
        });
        const header = el.createDiv({ cls: 'olea-grove-cell-header' });
        if (cell.state !== 'ground') {
          header.appendChild(renderSprig({ state: cell.state, size: 16, container: header }));
        }
        header.createSpan({ cls: 'olea-grove-concept-name', text: cell.conceptName });
        const footer = el.createDiv({ cls: 'olea-grove-cell-footer' });
        footer.createSpan({ cls: 'olea-grove-stage-label', text: groveStateLabel(cell.state) });
        if (papersTotal > 0) {
          this.renderPapers(footer, cell.pastPaperCitationCount, papersTotal);
        }
        if (cell.stall) {
          el.createSpan({ cls: 'olea-grove-ground-stall', text: GROVE_GROUND_STALL_NOTE });
        }
      }
      for (const gap of model.materialGaps) {
        const el = list.createDiv({ cls: 'olea-grove-cell olea-grove-cell-material-gap' });
        el.createSpan({ cls: 'olea-grove-concept-name', text: gap.conceptName });
        const footer = el.createDiv({ cls: 'olea-grove-cell-footer' });
        footer.createSpan({ cls: 'olea-grove-material-gap-label', text: GROVE_MATERIAL_GAP_LABEL });
        if (papersTotal > 0) {
          this.renderPapers(footer, gap.pastPaperCitationCount, papersTotal);
        }
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

  /**
   * `ol-l5og.18.2`: the kit's `Papers` mark (`Pass5bCoverage.jsx`) — one
   * tick per registered past paper, filled for the ones that asked this
   * concept. Decorative marks with a real accessible name, same posture
   * `renderSprig` already takes toward its own `role="img"`/`aria-label`
   * pair — `grovePapersLabel` states the count and the denominator exactly
   * once, on the group, never per tick.
   */
  private renderPapers(parent: HTMLElement, citedIn: number, total: number): void {
    const el = parent.createDiv({ cls: 'olea-grove-papers' });
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', grovePapersLabel(citedIn, total));
    for (let i = 0; i < total; i += 1) {
      el.createSpan({
        cls: i < citedIn ? 'olea-grove-papers-tick is-asked' : 'olea-grove-papers-tick',
      });
    }
  }

  /**
   * `ol-l5og.18.2`: one legend for the whole screen (`render` calls this
   * once, after every course, only when at least one reached `'declared'`)
   * — spells out every mark the grid can draw, same purpose the kit's own
   * `GroveLegend` serves. Vitality/tending is not in this legend: it is a
   * disclosed `MAT-2` deferral (see `../sprig/render-sprig.ts`'s own module
   * doc), not a mark this build can draw yet.
   */
  private renderLegend(parent: HTMLElement): void {
    const el = parent.createDiv({ cls: 'olea-grove-legend' });
    for (const state of LEGEND_STAGES) {
      const item = el.createDiv({ cls: 'olea-grove-legend-item' });
      item.appendChild(renderSprig({ state, size: 14, container: item }));
      item.createSpan({ text: groveStateLabel(state) });
    }
    const groundItem = el.createDiv({ cls: 'olea-grove-legend-item' });
    groundItem.createDiv({ cls: 'olea-grove-legend-swatch olea-grove-legend-swatch-ground' });
    groundItem.createSpan({ text: GROVE_LEGEND_GROUND_NOTE });
    const gapItem = el.createDiv({ cls: 'olea-grove-legend-item' });
    gapItem.createDiv({
      cls: 'olea-grove-legend-swatch olea-grove-legend-swatch-material-gap',
    });
    gapItem.createSpan({ text: GROVE_LEGEND_MATERIAL_GAP_NOTE });
    const papersItem = el.createDiv({ cls: 'olea-grove-legend-item' });
    papersItem.createSpan({ text: GROVE_LEGEND_PAPERS_NOTE });
  }

  /**
   * `[D-196]`, F1.5(b), F8.1: the unreadable-file list, shown beside the
   * designed-state ask and the readiness reading — never on its own
   * surface (the ruling explicitly rejects a standing page). Renders
   * nothing when there is nothing to say, matching this view's own
   * convention of never drawing an empty section header.
   */
  private renderUnreadableFiles(parent: HTMLElement, files: readonly UnreadableFile[]): void {
    if (files.length === 0) return;
    const box = parent.createDiv({ cls: 'olea-grove-unreadable' });
    box.createDiv({ cls: 'olea-grove-unreadable-heading', text: GROVE_UNREADABLE_HEADING });
    for (const file of files) {
      const row = box.createDiv({ cls: 'olea-grove-unreadable-row' });
      row.createSpan({ cls: 'olea-grove-unreadable-path', text: file.path });
      row.createSpan({
        cls: 'olea-grove-unreadable-reason',
        text: groveUnreadableReasonLabel(file.reason),
      });
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
