/**
 * `TodayView` — the right-sidebar pane (F6.1, F7.7, P2-T09).
 *
 * Thin by design. Everything the panel *decides* is in `olea-core`'s
 * `today/panel.ts`, everything it *says* is in `./copy.ts`, and everything it
 * *reads* is in `./data-source.ts`. What is left here is DOM: build the header,
 * build the count, build the course rows, build the streak strip. Same reason
 * `review/view.ts` has no test file and none is expected — `obsidian` has no
 * runtime outside a real host, so the logic worth testing is deliberately
 * somewhere it can run.
 *
 * **This pane does not force a theme branch, and that is why it needs none of
 * `review/view.ts`'s theme machinery.** F2.4's dark-by-default is written about
 * the *review session*, which takes the whole tab and renders dark in either
 * host branch — and nothing in F6 asks a sidebar pane to fight her theme.
 * That is not a
 * convenience: `ol-ro57`'s repair (landed, `a3c49f1`) exists because a root
 * that declares one branch while the body is in the other inherits the *other*
 * branch's value for any variable the theme declares only once, giving half of
 * one palette and half of the other. The `olea-host-fallback` cascade layer in
 * `styles.css` is the floor under that, and it is exactly right for a view that
 * has to force dark. This pane sits in whichever branch her sidebar is already
 * in, so the mismatch it guards against cannot arise here, and adding a second
 * copy of the layer would put a dark floor under a pane that is often correctly
 * light. This section therefore reads the host plainly and declares no floor —
 * asserted, not just described, in `test/today/styles.spec.ts`.
 *
 * **Styles ship in `packages/plugin/styles.css`,** under its
 * "---- Today panel ----" section — the single stylesheet in the BRAT
 * artifact set (`manifest.json`, `main.js`, `styles.css`). They previously
 * lived in a separate `today.css` staged next to this file while another
 * lane owned `styles.css` for `ol-ro57`'s cascade-layer repair; that repair
 * landed (`a3c49f1`) and the styles were merged in as the sequenced change
 * the P2-T09 report named. `test/today/styles.spec.ts` still asserts every
 * class emitted here has a rule in `styles.css`.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type {
  CourseDueCount,
  CourseMastery,
  InsightsSummary,
  StreakDay,
  TodayViewModel,
} from 'olea-core';
import { MASTERY_ORDER } from 'olea-core';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  conceptCountLabel,
  courseCountLabel,
  DUE_TODAY_LABEL,
  DUE_UNAVAILABLE,
  earlyPullSentence,
  effortShareClause,
  INSIGHTS_LABEL,
  INSIGHTS_TOO_EARLY,
  insightsScopeSentence,
  MASTERY_LABEL,
  masteryCountLabel,
  NOTHING_DUE,
  newCountSentence,
  START_REVIEW,
  STREAK_LABEL,
  showsStartReviewAction,
  spacingRateSentence,
  streakValue,
  TODAY_HEADER_LABEL,
  TODAY_VIEW_TITLE,
  weekCellLabel,
  weekdayInitial,
} from './copy.js';

export const VIEW_TYPE_OLEA_TODAY = 'olea-today';

export interface TodayViewDeps {
  /** Loads the view model. Async because it reads the vault. */
  readonly load: () => Promise<TodayViewModel>;
  /** What the one primary action does. Wired to the review command in `main.ts`. */
  readonly startReview: () => void;
}

export class TodayView extends ItemView {
  private readonly deps: TodayViewDeps;

  constructor(leaf: WorkspaceLeaf, deps: TodayViewDeps) {
    super(leaf);
    this.deps = deps;
    this.navigation = false;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_TODAY;
  }

  override getDisplayText(): string {
    return TODAY_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'sprout';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-today-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-reads the log and redraws. Called on open and by `main.ts` after a session. */
  async refresh(): Promise<void> {
    const vm = await this.deps.load();
    this.render(vm);
  }

  private render(vm: TodayViewModel): void {
    const root = this.contentEl;
    root.empty();

    const header = root.createDiv({ cls: 'olea-today-header' });
    header.createSpan({ cls: 'olea-today-header-label', text: TODAY_HEADER_LABEL });

    const body = root.createDiv({ cls: 'olea-today-body' });
    this.renderDue(body, vm);
    // Before the streak, not after: `.olea-today-streak` carries
    // `margin-top: auto`, so it is pinned to the bottom of the pane by
    // construction and anything appended after it would sit below the thing
    // that is meant to be last.
    this.renderMastery(body, vm);
    this.renderInsights(body, vm);
    this.renderStreak(body, vm.streak.currentDays, vm.streak.atWindowEdge, vm.streak.week);
  }

  /**
   * F6.2 (`ol-lohq`) — one distribution strip per course.
   *
   * **`mastery === null` renders nothing at all**, and that is a decision
   * rather than a shortcut: `null` means the panel was never handed a concept
   * set (see `olea-core`'s `TodayPanelInput.concepts`), so there is no question
   * it was asked and declined to answer. `DUE_UNAVAILABLE`'s sibling treatment
   * would be wrong here — that string exists because a *read failed*, and a
   * caller that never asked has not had a read fail.
   *
   * A course whose concepts are every one of them `new` still renders, showing
   * that. It is a fact about a course she has not opened, not an empty state.
   */
  private renderMastery(parent: HTMLElement, vm: TodayViewModel): void {
    const overview = vm.mastery;
    if (overview === null || overview.courses.length === 0) return;

    const section = parent.createDiv({ cls: 'olea-today-mastery' });
    section.createDiv({ cls: 'olea-today-mastery-label', text: MASTERY_LABEL });
    for (const course of overview.courses) {
      this.renderMasteryCourse(section, course);
    }
  }

  private renderMasteryCourse(parent: HTMLElement, course: CourseMastery): void {
    const row = parent.createDiv({ cls: 'olea-today-mastery-course' });

    const head = row.createDiv({ cls: 'olea-today-mastery-head' });
    // From her vault, never from `copy.ts` — same rule as the due course rows.
    head.createSpan({ cls: 'olea-today-mastery-code', text: course.course });
    head.createSpan({
      cls: 'olea-today-mastery-total',
      text: conceptCountLabel(course.distribution.total),
    });

    // The strip is decorative and says so. Everything it encodes is stated as
    // text in the counts row below it, so a screen reader gets the numbers and
    // the five words rather than a row of unlabelled boxes — and the bar is
    // free to fade its segments without a contrast question, because no
    // meaning rides on the colour alone.
    const strip = row.createDiv({ cls: 'olea-today-mastery-strip' });
    strip.setAttr('aria-hidden', 'true');
    const counts = row.createDiv({ cls: 'olea-today-mastery-counts' });

    for (const state of MASTERY_ORDER) {
      const count = course.distribution.counts[state];
      if (count === 0) continue;
      const segment = strip.createDiv({ cls: 'olea-today-mastery-seg' });
      // `data-stage-index` (ordinal position in `MASTERY_ORDER`) rather than an
      // `is-<state>` class or leaf count: `sapling` and `tree` share the same
      // three-leaf geometry (D-049), so leaf count stopped being monotonic with
      // stage the moment vitality moved off the leaf scale onto fruit. Ordinal
      // position is still exactly one attribute carrying the whole ordering,
      // and the stylesheet still needs no branch that could drift from
      // `MASTERY_ORDER`.
      segment.setAttr('data-stage-index', String(MASTERY_ORDER.indexOf(state)));
      segment.setAttr('style', `flex-grow:${count}`);

      // The sprig here is one representative icon per occupied state bucket, not
      // one per concept — `course.distribution` is a count, not a set of concept
      // ids (see `olea-core`'s `MasteryDistribution`), so there is no per-concept
      // evidence for a growth transition to react to at this surface. `renderRow`
      // in `gap/view.ts` is where a sprig stands for one concept's own state.
      const countEl = counts.createSpan({ cls: 'olea-today-mastery-count' });
      countEl.appendChild(renderSprig({ state, size: 12 }));
      countEl.createSpan({ text: masteryCountLabel(state, count) });
    }
  }

  /**
   * F6.5 (`ol-p6t04`) — what the log shows, when it shows anything.
   *
   * Three renderings for three statuses, and the middle one is the reason the
   * status is not a boolean:
   *
   * - **observed** → the sentences, from `copy.ts`.
   * - **not-observed** → nothing. She was measured and the pattern is not
   *   there; a line saying so every day is noise on a panel F6.1 keeps to four
   *   things.
   * - **not-enough-history**, for *every* detector → `INSIGHTS_TOO_EARLY`. A
   *   confident empty chart here would be the exact claim the log cannot
   *   support.
   */
  private renderInsights(parent: HTMLElement, vm: TodayViewModel): void {
    const insights = vm.insights;
    if (insights === null) return;

    const lines = this.insightLines(insights);
    const allDeclined =
      insights.spacing.status === 'not-enough-history' &&
      insights.effort.status === 'not-enough-history';
    if (lines.length === 0 && !allDeclined) return;

    const section = parent.createDiv({ cls: 'olea-today-insights' });
    section.createDiv({ cls: 'olea-today-insights-label', text: INSIGHTS_LABEL });

    if (lines.length === 0) {
      section.createDiv({ cls: 'olea-today-note', text: INSIGHTS_TOO_EARLY });
      return;
    }

    for (const line of lines) {
      const insight = section.createDiv({ cls: 'olea-today-insight' });
      if (line.course !== null) {
        insight.createSpan({ cls: 'olea-today-mastery-code', text: line.course });
      }
      insight.createSpan({ cls: 'olea-today-insight-text', text: line.text });
    }
    section.createDiv({
      cls: 'olea-today-insight-scope',
      text: insightsScopeSentence(vm.windowDays),
    });
  }

  /** Every sentence the insights section will draw, in order. All of them come from `copy.ts`. */
  private insightLines(
    insights: InsightsSummary,
  ): readonly { readonly course: string | null; readonly text: string }[] {
    const lines: { course: string | null; text: string }[] = [];

    const spacing = insights.spacing;
    if (spacing.status === 'observed' && spacing.measured !== null) {
      lines.push({
        course: null,
        text: spacingRateSentence(
          spacing.measured.nearReviewsPerDay,
          spacing.measured.farReviewsPerDay,
          spacing.measured.windowDays,
        ),
      });
      const early = earlyPullSentence(spacing.measured.earlyShare);
      if (early !== null) lines.push({ course: null, text: early });
    }

    const effort = insights.effort;
    if (effort.status === 'observed' && effort.measured !== null) {
      const course = effort.measured.courses.find(
        (row) => row.course === effort.measured?.widestGapCourse,
      );
      if (course !== undefined) {
        lines.push({
          course: course.course,
          text: effortShareClause(course.weightShare, course.timeShare),
        });
      }
    }

    return lines;
  }

  private renderDue(parent: HTMLElement, vm: TodayViewModel): void {
    // `due === null` is "we cannot count yet", never a zero — see
    // olea-core's today/panel.ts. The two states render differently on
    // purpose, because they are different statements.
    if (vm.due === null) {
      parent.createDiv({ cls: 'olea-today-note', text: DUE_UNAVAILABLE });
      return;
    }

    if (vm.due.total === 0) {
      parent.createDiv({ cls: 'olea-today-note', text: NOTHING_DUE });
    } else {
      const headline = parent.createDiv({ cls: 'olea-today-headline' });
      headline.createSpan({ cls: 'olea-today-count', text: String(vm.due.total) });
      headline.createSpan({ cls: 'olea-today-count-label', text: DUE_TODAY_LABEL });

      // How many of that count she has never seen (F6.1). Absent, not zeroed,
      // when none are — see `newCountSentence`.
      const newLine = newCountSentence(vm.due.newCount);
      if (newLine !== null) {
        parent.createDiv({ cls: 'olea-today-new', text: newLine });
      }

      const list = parent.createDiv({ cls: 'olea-today-courses' });
      for (const course of vm.due.courses) {
        this.renderCourseRow(list, course);
      }
    }

    // Kept even at zero due (ol-h3wy): this panel is Olea's front door
    // (David's ruling, `ol-f77commands`) — "the review view is reached
    // through it, not around it" — and a front door with no action when
    // nothing is due is a front door that disappears. `showsStartReviewAction`
    // is the tested decision; see `copy.ts`.
    if (showsStartReviewAction(vm.due)) {
      const action = parent.createEl('button', {
        cls: 'olea-today-primary-action',
        text: START_REVIEW,
      });
      action.addEventListener('click', () => {
        this.deps.startReview();
      });
    }
  }

  private renderCourseRow(parent: HTMLElement, course: CourseDueCount): void {
    const row = parent.createDiv({ cls: 'olea-today-course' });
    row.createSpan({ cls: 'olea-today-course-dot' });
    row.createSpan({ cls: 'olea-today-course-code', text: course.courseCode });
    row.createSpan({ cls: 'olea-today-course-name', text: course.courseName });
    row.createSpan({
      cls: 'olea-today-course-count',
      text: courseCountLabel(course.count),
    });
  }

  private renderStreak(
    parent: HTMLElement,
    currentDays: number,
    atWindowEdge: boolean,
    week: readonly StreakDay[],
  ): void {
    const section = parent.createDiv({ cls: 'olea-today-streak' });

    const head = section.createDiv({ cls: 'olea-today-streak-head' });
    head.createSpan({ cls: 'olea-today-streak-label', text: STREAK_LABEL });
    head.createSpan({
      cls: 'olea-today-streak-value',
      text: streakValue(currentDays, atWindowEdge),
    });

    const strip = section.createDiv({ cls: 'olea-today-week' });
    for (const day of week) {
      const cell = strip.createDiv({ cls: 'olea-today-week-cell' });
      // A missed day and a day that has not happened yet get the same mark.
      // `StreakDay` carries no flag that separates them (F6.1, and the Pass 1
      // kit, whose streak strip gives a missed day no colour of its own).
      const mark = cell.createSpan({ cls: 'olea-today-week-mark' });
      if (day.studied) mark.addClass('is-studied');
      if (day.isToday) mark.addClass('is-today');
      mark.setAttr('aria-label', weekCellLabel(day.day, day.studied));
      cell.createSpan({
        cls: 'olea-today-week-day',
        text: weekdayInitial(day.day),
      });
    }
  }
}
