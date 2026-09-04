/**
 * `GapView` — the gap and coverage panes (F4.3, F4.5, F4.9, F4.10; P5-T06a),
 * with `ol-cvsc`'s scope statement rendered rather than assumed.
 *
 * **Thin by design, and on this surface that is a safety property rather than
 * a style preference.** Everything this screen *decides* is in `olea-core`'s
 * `gap/` — which rows exist, which class each is, which affordances each may
 * carry, and whether an exhaustiveness claim is available at all. Everything it
 * *says* is in `./copy.ts`. What is left here is DOM. `ol-09kf` is the reason
 * the split is drawn this hard: product copy assembled in a DOM builder is copy
 * nothing can assert on, and every sentence on this screen is a claim about
 * what the pipeline read.
 *
 * So there is no test file for this module and none is expected — `obsidian`
 * has no runtime outside a real host (its `package.json` `main` is empty, so it
 * cannot even be imported under Vitest), which is exactly why the logic worth
 * testing is deliberately somewhere it can run. `test/gap/copy.spec.ts` is
 * where the honesty properties are asserted.
 *
 * **The one rule this file must not break.** It renders `model.scope` on every
 * path — gaps or no gaps, complete or not — and it renders
 * `coverageClosingLine`'s result only when that function returns one. It never
 * writes an exhaustiveness sentence of its own. A bare "no gaps found" is
 * unreachable through `coverageScreenCopy`, and this file's job is to not route
 * around it.
 *
 * **Layout (`[D-224]` / `ol-l5og.20`, `ol-l5og.18.3`).** This view is a
 * full-tab page (`main.ts`'s `revealGapView` opens it via
 * `workspace.getLeaf('tab')`, the same door `ReviewView`'s F2.2 uses), not a
 * sidebar list — replacing the compact single-line row this file drew before
 * this bead. It still renders no theme-dark: nothing in the contract asks
 * this surface to force dark the way F2.4 asks of the review session, so it
 * follows the host's ambient theme, same as the Today panel.
 * `packages/plugin/styles.css`'s "Gap and coverage views" section carries the
 * rules for every class below.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { GapCourseView, GapRow, GapViewModel } from 'olea-core';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  abstainedCourseSentence,
  affordanceLabel,
  COVERAGE_GAP_HEADING,
  coverageScreenCopy,
  GAP_UNAVAILABLE_BODY,
  GAP_UNAVAILABLE_EYEBROW,
  GAP_UNAVAILABLE_RETRY_LABEL,
  GAP_UNAVAILABLE_TITLE,
  GAP_VIEW_TITLE,
  gapRowLine,
  MATERIAL_GAP_HEADING,
  pastPaperChips,
  pastPapersLabel,
  rankedCourseFraming,
  readinessNote,
  scopeSourceLine,
  syllabusCounterweightBreakdown,
  syllabusCounterweightSentence,
} from './copy.js';

export const VIEW_TYPE_OLEA_GAP = 'olea-gap';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The retry mark (`docs/design/pass5-refusal-trends-shell/ui_kits/olea-
 * plugin/Pass5Kit.jsx`'s `RetryGlyph`, `olea-service`), reproduced
 * coordinate-for-coordinate, the same "copied, not reinterpreted" discipline
 * `sprig/render-sprig.ts` documents for its own SVG. Built via
 * `createElementNS` rather than Obsidian's `setIcon`: `setIcon` has no
 * export in the workbench's `obsidian-shim` (confirmed by a failed
 * `esbuild` bundle), and this view is one of the files that shim exists to
 * let run under both hosts.
 */
function renderRetryGlyph(container: HTMLElement): void {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 13 13');
  for (const d of ['M11 6.5a4.5 4.5 0 1 1-1.5-3.35', 'M11.2 1.2v2.6H8.6']) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  container.appendChild(svg);
}

/**
 * What the view was handed.
 *
 * `'unavailable'` is a state and not a `null` model, for the reason
 * `today/panel.ts` gives about its own due count: "we could not read your
 * vault" and "your materials cover everything" are different sentences, and a
 * nullable model invites a caller to render the second when it means the first.
 */
export type GapViewState =
  | { readonly kind: 'model'; readonly model: GapViewModel }
  | { readonly kind: 'unavailable' };

export interface GapViewDeps {
  /** Loads the view state. Async because building it reads the vault and runs extraction. */
  readonly load: () => Promise<GapViewState>;
  /**
   * What the `'build-session'` affordance does (`ol-p5t06b`, F4.6).
   *
   * **Optional, and the optionality is the point.** `'build-session'` has been
   * a `GapAffordance` value and a copy string since P5-T06a with nothing behind
   * it — an inert label, which is the wiring defect the reachability rule
   * exists for. A host that supplies this gets a live action; one that does not
   * (the workbench mounts this view with `load` alone) renders the label
   * exactly as before rather than a dead button that looks live.
   */
  readonly buildSession?: (row: GapRow) => void;
}

export class GapView extends ItemView {
  private readonly deps: GapViewDeps;

  constructor(leaf: WorkspaceLeaf, deps: GapViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_GAP;
  }

  override getDisplayText(): string {
    return GAP_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'list-ordered';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-gap-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-reads and redraws. Public so a host can refresh the pane after her material changes. */
  async refresh(): Promise<void> {
    this.render(await this.deps.load());
  }

  private render(state: GapViewState): void {
    const root = this.contentEl;
    root.empty();

    if (state.kind === 'unavailable') {
      this.renderUnavailable(root);
      return;
    }

    const { model } = state;
    for (const course of model.courses) this.renderCourse(root, course);
    this.renderCoverage(root, model);
  }

  /**
   * [STY-0h] (`ol-l5og.18.8`): this pane's "could not check" refusal, in the
   * two-cue family `docs/design/pass5-refusal-trends-shell/ui_kits/olea-
   * plugin/Pass5Refusal.jsx` draws in `olea-service` (C4.7, `[D-089]`) — a
   * SOLID edge on the host's own wash (established shapes, nothing drawn as
   * found) and a returning-arrow mark, never the dashed "absence" edge
   * `.olea-gap-material-block` uses elsewhere on this same pane for a
   * genuinely empty result. The two are different claims: a material gap
   * says the search ran and found nothing; this says the search did not run
   * at all, which is exactly why the kit tells them apart.
   *
   * **One structural difference from the kit, disclosed rather than faked.**
   * The kit's could-not-check state is a strip ABOVE a ranking left standing
   * — there, one concept's check failed and the rest of the screen is still
   * true. Here the WHOLE view failed to build (`gap/provider.ts`'s
   * `createLocalGapProvider` doc: "a vault it could not walk, an extraction
   * pass that threw"), so there is no ranking underneath to leave intact —
   * the pane empties because there is genuinely nothing else to show, not
   * because this treatment forgot to draw it.
   *
   * The retry action is new: `GAP_UNAVAILABLE_BODY` has said "try again in a
   * moment" since before this bead with nothing behind it to press
   * (`ol-riwn`'s sibling defect on this surface) — this wires that sentence
   * to the same `refresh()` a host already calls after her material
   * changes, so a re-read costs one click rather than closing and reopening
   * the tab.
   */
  private renderUnavailable(root: HTMLElement): void {
    const box = root.createDiv({ cls: 'olea-gap-unavailable' });
    const eyebrow = box.createDiv({ cls: 'olea-gap-unavailable-eyebrow' });
    const mark = eyebrow.createSpan({ cls: 'olea-gap-unavailable-mark' });
    renderRetryGlyph(mark);
    eyebrow.createSpan({ cls: 'olea-gap-unavailable-eyebrow-text', text: GAP_UNAVAILABLE_EYEBROW });
    box.createDiv({ cls: 'olea-gap-unavailable-title', text: GAP_UNAVAILABLE_TITLE });
    box.createDiv({ cls: 'olea-gap-unavailable-body', text: GAP_UNAVAILABLE_BODY });
    const retry = box.createEl('button', {
      cls: 'olea-gap-unavailable-retry',
      text: GAP_UNAVAILABLE_RETRY_LABEL,
    });
    retry.addEventListener('click', () => {
      void this.refresh();
    });
  }

  private renderCourse(parent: HTMLElement, course: GapCourseView): void {
    const section = parent.createDiv({ cls: 'olea-gap-course' });
    section.createDiv({ cls: 'olea-gap-course-name', text: course.course });

    if (course.status === 'abstained') {
      // No ranking, so no ranking framing — the abstention states its own
      // scope in its own sentence instead.
      section.createDiv({ cls: 'olea-gap-abstain', text: abstainedCourseSentence(course) });
      return;
    }

    // F4.9, structurally: the framing (including the full-syllabus advice) is
    // produced from the ranked state, so a ranking cannot be drawn without it.
    for (const line of rankedCourseFraming(course.rows)) {
      section.createDiv({ cls: 'olea-gap-framing', text: line });
    }

    // pass5g's counterweight block (`[D-224]`): non-dismissible, so it is
    // drawn here unconditionally rather than behind a control that could
    // hide it — never a footer a caller may forget.
    this.renderSyllabusCounterweight(section, course.course, course.rows);

    const list = section.createDiv({ cls: 'olea-gap-rows' });
    for (const row of course.rows) this.renderRow(list, row);
  }

  private renderSyllabusCounterweight(
    parent: HTMLElement,
    courseName: string,
    rows: readonly GapRow[],
  ): void {
    const box = parent.createDiv({ cls: 'olea-gap-counterweight' });
    box.createDiv({ cls: 'olea-gap-counterweight-mark' });
    const body = box.createDiv({ cls: 'olea-gap-counterweight-body' });
    body.createDiv({
      cls: 'olea-gap-counterweight-text',
      text: syllabusCounterweightSentence(courseName, rows),
    });
    const breakdown = syllabusCounterweightBreakdown(rows);
    if (breakdown !== null) {
      body.createDiv({ cls: 'olea-gap-counterweight-breakdown', text: breakdown });
    }
  }

  private renderRow(parent: HTMLElement, row: GapRow): void {
    const el = parent.createDiv({ cls: `olea-gap-row olea-gap-row-${row.gapClass}` });
    const header = el.createDiv({ cls: 'olea-gap-row-header' });
    header.createSpan({ cls: 'olea-gap-rank', text: String(row.rank) });
    this.renderMasteryMark(header, row);
    header.createSpan({ cls: 'olea-gap-concept', text: row.conceptName });

    // pass5g redraws the mastery-gap and material-gap rows as the corrected
    // kit's two dense screens; coverage-gap is explicitly out of scope on
    // that sheet (`GapClasses`' own note: "designing them together is how
    // they merged the first time"), so it keeps the plain line it always had.
    const body =
      row.gapClass === 'material-gap' ? el.createDiv({ cls: 'olea-gap-material-block' }) : el;

    body.createDiv({ cls: 'olea-gap-line', text: gapRowLine(row) });

    if (row.gapClass === 'mastery-gap' || row.gapClass === 'material-gap') {
      this.renderPastPaperChips(body, row);
    }

    const note = readinessNote(row);
    if (note !== null) body.createDiv({ cls: 'olea-gap-readiness', text: note });

    const actions = body.createDiv({ cls: 'olea-gap-actions' });
    // The affordance list comes from core, which is where F4.10's
    // no-draft-on-a-material-gap rule is enforced. This loop must never add to
    // it: a button written here is a button no test can see.
    for (const affordance of row.affordances) {
      const action = actions.createSpan({
        cls: `olea-gap-action olea-gap-action-${affordance}`,
        text: affordanceLabel(affordance),
      });
      // `ol-p5t06b`: the one affordance that now does something. The others
      // stay labels until their own beads wire them — a click handler that
      // opens nothing is worse than a label that never claimed to.
      const buildSession = this.deps.buildSession;
      if (affordance === 'build-session' && buildSession !== undefined) {
        action.addEventListener('click', () => {
          buildSession(row);
        });
      }
    }
  }

  /**
   * The stage mark beside a row's rank — a sprig-and-word for a mastery gap
   * (unchanged rendering, just a larger mark for the full-tab page) or the
   * `'no stage'` dotted-and-hatched swatch pass5g draws for a material gap
   * (F4.10: there is nothing to grow yet). Coverage-gap keeps the small
   * inline mark it always had — out of scope on the corrected kit, per
   * `renderRow`'s own note.
   *
   * **No vitality/tending mark yet.** The kit draws one on a decayed
   * mastery-gap sprig; `renderSprig`'s own module doc says vitality "is not
   * yet a persisted field anywhere in this codebase" (`MAT-2`, `ol-95vv`,
   * still open) — there is nothing for this method to read, so it draws
   * none, same as `grove/view.ts` does for the identical reason.
   */
  private renderMasteryMark(parent: HTMLElement, row: GapRow): void {
    if (row.gapClass === 'material-gap') {
      const mark = parent.createSpan({ cls: 'olea-gap-mastery olea-gap-nostage' });
      mark.createSpan({ cls: 'olea-gap-nostage-swatch' });
      mark.createSpan({ text: 'no stage' });
      return;
    }

    const size = row.gapClass === 'mastery-gap' ? 20 : 12;
    const masteryEl = parent.createSpan({ cls: 'olea-gap-mastery' });
    if (row.masteryState === 'unknown') {
      // The oracle's own escape hatch (`OracleMasteryState = MasteryState | 'unknown'`) — there
      // is no `MASTERY_DISPLAY` entry for it, so no sprig, same as before this task: the word
      // alone.
      masteryEl.setText(row.masteryState);
    } else {
      masteryEl.appendChild(renderSprig({ state: row.masteryState, size, container: masteryEl }));
      masteryEl.createSpan({ text: row.masteryState });
    }
  }

  /**
   * pass5g's `PastPapers` chip row (`[D-224]`): named papers, never a bare
   * count. Renders nothing for a row with no citations — `GapRow`'s own doc
   * says citations are "never empty for a ranked entry", so this is
   * defensive rather than a reachable state.
   */
  private renderPastPaperChips(parent: HTMLElement, row: GapRow): void {
    const chips = pastPaperChips(row);
    if (chips.length === 0) return;
    const wrap = parent.createDiv({ cls: 'olea-gap-papers' });
    wrap.createSpan({
      cls: 'olea-gap-papers-label',
      text: pastPapersLabel(row.distinctSourceCount),
    });
    for (const chip of chips) {
      wrap.createSpan({ cls: 'olea-gap-paper-chip', text: chip });
    }
  }

  private renderCoverage(parent: HTMLElement, model: GapViewModel): void {
    const rows = model.courses.flatMap((c) => (c.status === 'ranked' ? c.rows : []));
    const coverage = rows.filter((r) => r.gapClass === 'coverage-gap');
    const material = rows.filter((r) => r.gapClass === 'material-gap');

    const section = parent.createDiv({ cls: 'olea-gap-coverage' });
    if (coverage.length > 0) {
      section.createDiv({ cls: 'olea-gap-heading', text: COVERAGE_GAP_HEADING });
    }
    if (material.length > 0) {
      section.createDiv({ cls: 'olea-gap-heading', text: MATERIAL_GAP_HEADING });
    }

    // The scope, always — this is the whole of ol-cvsc at the render layer, and
    // the closing line appears only if `coverageScreenCopy` produced one.
    const scopeBox = section.createDiv({ cls: 'olea-gap-scope' });
    for (const line of coverageScreenCopy({
      scope: model.scope,
      gapRowCount: coverage.length + material.length,
    })) {
      scopeBox.createDiv({ cls: 'olea-gap-scope-line', text: line });
    }

    // Every source, by name and by what happened to it: the denominator, made
    // visible. A source that yielded nothing gets a visible row of its own —
    // ol-cvsc's required surface state, verbatim.
    const list = scopeBox.createDiv({ cls: 'olea-gap-scope-sources' });
    for (const source of model.scope.sources) {
      list.createDiv({
        cls: `olea-gap-scope-source olea-gap-scope-source-${source.readState}`,
        text: scopeSourceLine(source),
      });
    }
  }
}
