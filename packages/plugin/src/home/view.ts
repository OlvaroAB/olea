/**
 * `HomeView` — the landing dashboard (F6.10, `[D-223]`, `ol-l5og.21`
 * [HOME-2]).
 *
 * **`[D-223]` supersedes this view's own predecessor scope.** `ol-0r92.17`
 * scoped `HomeView` to exactly F8.8's standing retrospective offer and
 * nothing else, because building the Pass 7 dashboard here would have
 * relitigated `[D-033]`'s front-door ruling sideways — that argument is
 * quoted in full in this bead's close evidence rather than here, since
 * `[D-223]` is the ruling that answers the question `ol-0r92.17` correctly
 * refused to answer on its own initiative: Home *is* now the landing
 * dashboard, `[D-033]`'s front-door ruling attaches to the composed session
 * as the single answer rather than to the Today panel as the single
 * surface, and F6.4's headline moves onto this view (moved, never
 * duplicated — Today keeps rendering the same composition as a worked
 * list, `ol-l5og.22` [HOME-3]'s own scope).
 *
 * **The composed-session headline is rendered, never recomputed.** `./
 * provider.ts` calls `../session-builder/provider.ts`'s own
 * `createLocalSessionBuilderProvider` — the exact module that already owns
 * F4.6/F4.7/F4.8's ranking, allocation and duration-estimate chain — and
 * this file renders its `SessionBuilderState` through
 * `../session-builder/copy.ts`'s own pure functions
 * (`sessionSummaryLine`/`sessionFraming`/`emptySessionLines`/
 * `reentryEmptyLines`/`reentryScreenCopy`), imported rather than
 * reimplemented. F6.4's "an implementation holding a single sorted list...
 * has invented [the allocation rule] and hidden it" is exactly the mistake
 * this avoids: nothing in this file ranks a concept, allocates a course
 * share, or drafts a reason sentence of its own.
 *
 * **The per-course coverage strip is a REDUCED-size read of the same grove
 * `GroveView` already renders**, not a second computation: `./provider.ts`
 * calls `../grove/provider.ts`'s own `createLocalGroveProvider` and maps its
 * `GroveCourseModel` into `HomeGroveMark`s at row scale — F6.10's own words,
 * "each carrying that course's coverage map at reduced size." Marks reuse
 * `../sprig/render-sprig.ts`'s existing stage geometry for the four
 * growth-stage states; `'ground'`/material-gap cells get their own small
 * marks, styled after `../grove/view.ts`'s own dashed-vs-dotted split
 * (`packages/plugin/styles.css`'s Home section) rather than a third visual
 * vocabulary for the same two facts. Volunteers are deliberately excluded
 * from this strip: F8.2 defines them as OUTSIDE the declared scope, and
 * F6.10's map is "every IN-SCOPE concept" — drawing them here would silently
 * widen what "the coverage map" means between this view and the grove's own.
 *
 * **Term-at-a-glance: the row of strips IS the composition, and no second,
 * merged visualisation is drawn.** F6.10's own clamp — "any arrangement the
 * eye can read as shares of one whole has manufactured the term-level figure
 * F8.3 bans... and is not drawn" — and the standing cognitive-offloading
 * check both point the same way: each course's strip is drawn at its own
 * absolute scale (the same mark size regardless of how many concepts a
 * course has), never normalised to a shared width or stacked into one bar,
 * so the eye has nothing to read as a share. This IS "the row of separate
 * maps [as] the answer" the brief itself names as the safe default when a
 * merged composition cannot be drawn honestly — see this bead's close
 * evidence for the fuller argument.
 *
 * **What F6.10 names that this view does not draw, and why**: see
 * `./copy.ts`'s own module doc for the archive-proposal and offline-
 * degradation quiet lines, and `./scope-growth-store.ts`'s for how the
 * "scope grew" line is computed. Per-course due counts and per-course exam
 * countdowns are in the Pass 7 kit's drawing but are not in F6.10's own
 * clause text (only the headline, the coverage map, and the five named
 * quiet-line kinds are) — rendering them here would mean a second read of
 * Today's/F6.3's own computation for a fact the clause never asked this row
 * to carry, so they are left out; F6.1/F6.2 remain the home of per-course
 * due counts and the cross-course mastery reading.
 *
 * **`[D-134]` Q1's retrospective offer, de-duplicated by course.** The
 * fidelity judgment that opened this bead found one course's offer card
 * repeating up to six times on the old flat-list `HomeView` — every passed,
 * unopened assessment in that course got its own card, and a course with
 * several such assessments read as broken. F6.10 already rules this out by
 * construction: "never more than one line per course" is the clause text
 * for EVERY quiet line, and the retrospective offer is one of the five named
 * kinds — so `./provider.ts` selects at most one offer card per course
 * (the earliest still-standing one) rather than rendering
 * `resolveOfferCards`'s whole per-assessment list unfiltered. This is a
 * selection made at the point Home decides what to show (`home/provider.ts`,
 * this bead's own `owns`), not an edit to `../retrospective/offer-card.ts`'s
 * shared computation, which stays exactly what F8.8 and the grove's own
 * per-course filter need it to be.
 *
 * **Widened once, deliberately, by `[D-213]` (`ol-0r92.47`), unchanged by
 * this bead.** The first-read readout — per-folder honest counts plus
 * streaming concepts, F1.4's amended clause — still needs a host that
 * survives past any one course-setup modal closing; `HomeViewState`'s
 * `'first-read'` branch is untouched here, and still takes priority over the
 * dashboard the same way it always has (`./provider.ts`'s own `load()`).
 *
 * **Styles.** `packages/plugin/styles.css` gains this view's own section as
 * part of this bead (`owns` includes `styles.css`), ported from
 * `docs/design/pass7-home-and-history` at reduced/row scale rather than
 * copied verbatim — the kit's `Pass7Kit.jsx` is React-authored JSX evidence,
 * never edited in place (`docs/design/CLAUDE.md`), so this view's classes
 * reproduce its layout, hierarchy and states using this plugin's own tokens
 * and its own existing mark vocabulary (the sprig, the grove's dashed/dotted
 * split) rather than a second component library.
 *
 * **No test file for this module and none is expected** — `obsidian` has no
 * runtime outside a real host; the honesty properties are asserted against
 * `./copy.ts` and `./provider.ts` under Vitest instead, the same convention
 * `today/view.ts`/`grove/view.ts` already document.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { GroveDeclaredState, VaultPath } from 'olea-core';
import { renderFirstReadReadout } from '../course-setup/confirmation-view.js';
import type { FirstReadFolderView } from '../ingestion/wiring.js';
import {
  emptySessionLines,
  REENTRY_STILL_AVAILABLE_LINE,
  reentryEmptyLines,
  SESSION_UNAVAILABLE_BODY,
  SESSION_UNAVAILABLE_TITLE,
  SESSION_WHY_THESE_LABEL,
  sessionFraming,
  sessionSummaryLine,
} from '../session-builder/copy.js';
import type { SessionBuilderState } from '../session-builder/view.js';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  DISMISS_OFFER_ACTION,
  HOME_COURSES_PANEL_NOTE,
  HOME_COURSES_PANEL_TITLE,
  HOME_NO_MAP_DRAWN,
  HOME_OFFER_EYEBROW,
  HOME_OPEN_TERM_ACTION,
  HOME_SCOPE_NOT_DECLARED,
  HOME_START_ACTION,
  HOME_UNAVAILABLE,
  HOME_VIEW_TITLE,
  OPEN_RETROSPECTIVE_ACTION,
} from './copy.js';

export const VIEW_TYPE_OLEA_HOME = 'olea-home';

/**
 * One mark on a course row's reduced-size coverage strip (F6.10). `'stage'`
 * covers the four growth-stage states `../sprig/render-sprig.ts` already
 * draws; `'ground'` (material here, nothing built) and `'material-gap'`
 * (the examiner named it, nothing of hers matches it yet) are F8.1's other
 * two in-scope states and get their own small marks — see `./view.ts`'s own
 * module doc for why they are not routed through `renderSprig`, which only
 * ever draws a growth stage.
 */
export type HomeGroveMark =
  | { readonly kind: 'stage'; readonly state: Exclude<GroveDeclaredState, 'ground'> }
  | { readonly kind: 'ground' }
  | { readonly kind: 'material-gap' };

/** One course row's own quiet line — F6.10: "never more than one line per course." */
export type HomeQuietLine =
  | {
      readonly kind: 'retrospective-offer';
      readonly text: string;
      readonly assessmentPath: VaultPath;
    }
  | { readonly kind: 'scope-grew'; readonly text: string }
  | { readonly kind: 'set-up-waiting'; readonly text: string };

/**
 * One running course's row (F6.10). `marks` is `undefined` exactly when no
 * examiner-declared denominator exists yet (`GroveCourseModel.status` is
 * `'inferred'` or `'no-registered-source'`) — the clause's own "draws no map
 * and says so"; an empty array (declared, zero concepts) is a different,
 * real state and renders its own honest line.
 */
export interface HomeCourseRow {
  readonly course: string;
  readonly marks?: readonly HomeGroveMark[];
  readonly quiet?: HomeQuietLine;
}

export type HomeViewState =
  | { readonly kind: 'first-read'; readonly folders: readonly FirstReadFolderView[] }
  | {
      readonly kind: 'dashboard';
      readonly session: SessionBuilderState;
      readonly courses: readonly HomeCourseRow[];
    }
  | { readonly kind: 'unavailable' };

export interface HomeViewDeps {
  /** Loads the view state. Async because it reads the vault. */
  readonly load: () => Promise<HomeViewState>;
  /** Opens the retrospective's own dedicated view (F8.8, `[D-134]` Q10). */
  readonly openRetrospective: () => void;
  /** F4.6/F6.4: opens the session builder, where the full reasoning lives. */
  readonly openSessionBuilder: () => void;
  /** F8.1: opens the course grove — F6.10's "Open the term" link. */
  readonly openGrove: () => void;
  /** `[D-134]` Q1's other ending — the offer's own dismiss, without opening. */
  readonly dismiss: (assessmentPath: VaultPath) => Promise<void>;
}

export class HomeView extends ItemView {
  private readonly deps: HomeViewDeps;

  constructor(leaf: WorkspaceLeaf, deps: HomeViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_HOME;
  }

  override getDisplayText(): string {
    return HOME_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'home';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-home-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-reads and redraws. Public so a host can refresh after a dismiss, or after her material changes — same convention every other view in this plugin sets. */
  async refresh(): Promise<void> {
    this.render(await this.deps.load());
  }

  private render(state: HomeViewState): void {
    const root = this.contentEl;
    root.empty();

    if (state.kind === 'unavailable') {
      root.createDiv({ cls: 'olea-home-unavailable', text: HOME_UNAVAILABLE });
      return;
    }

    if (state.kind === 'first-read') {
      renderFirstReadReadout(root, state.folders);
      return;
    }

    this.renderOffer(root, state.session);
    this.renderCourses(root, state.courses);
  }

  /**
   * F6.4/F6.10's headline. Every sentence here comes from `../session-
   * builder/copy.ts` — see this file's own module doc for why. `Start` and
   * `Why these` both open the same session-builder view (F4.6's own ruled
   * destination): two doors onto one screen, the same shape
   * `commands/register-commands.ts` already documents for "Open Today" and
   * "Open Olea".
   */
  private renderOffer(root: HTMLElement, session: SessionBuilderState): void {
    // `.olea-card`: the shared panel primitive (border, radius, elevated
    // ground, padding) — see this file's own module doc for why this reuses
    // the design-system section rather than a second card treatment. No
    // extra `olea-home-*` modifier class here: the primitive fully
    // determines this card's chrome, and a class with no rule of its own is
    // exactly the drift `test/home/styles.spec.ts` exists to catch.
    const card = root.createDiv({ cls: 'olea-card' });
    card.createDiv({
      cls: 'olea-eyebrow olea-eyebrow-brand olea-home-offer-eyebrow',
      text: HOME_OFFER_EYEBROW,
    });

    if (session.kind === 'unavailable') {
      card.createDiv({ cls: 'olea-home-offer-title', text: SESSION_UNAVAILABLE_TITLE });
      card.createDiv({
        cls: 'olea-prose olea-home-offer-reason-line',
        text: SESSION_UNAVAILABLE_BODY,
      });
      return;
    }

    const items = session.kind === 'reentry' ? session.view.items : session.model.items;
    const modelLike = session.kind === 'reentry' ? session.view : session.model;

    if (items.length === 0) {
      // F6.10: "content is never manufactured to avoid [reading empty]" — when
      // the real composition genuinely has nothing (not merely nothing due),
      // this renders that honest pair verbatim, never a placeholder sentence
      // of this view's own invention.
      const emptyLines =
        session.kind === 'reentry'
          ? reentryEmptyLines(session.view)
          : emptySessionLines(session.model);
      for (const line of emptyLines) {
        card.createDiv({ cls: 'olea-prose olea-home-offer-reason-line', text: line });
      }
      return;
    }

    card.createDiv({ cls: 'olea-home-offer-title', text: sessionSummaryLine(modelLike) });

    const reason = card.createDiv({ cls: 'olea-home-offer-reason' });
    for (const line of sessionFraming()) {
      reason.createDiv({ cls: 'olea-prose olea-home-offer-reason-line', text: line });
    }
    if (session.kind === 'reentry') {
      // F6.6: "no remark about the gap" — this line states only that
      // everything else is still scheduled, never how long she was away.
      reason.createDiv({
        cls: 'olea-prose olea-home-offer-reason-line',
        text: REENTRY_STILL_AVAILABLE_LINE,
      });
    }

    const actions = card.createDiv({ cls: 'olea-home-offer-actions' });
    // `.olea-button-primary`/`.olea-button-quiet` alone fully determine each
    // button's chrome — no `-start`/`-why` modifier class, same reasoning as
    // the card above.
    const start = actions.createEl('button', {
      cls: 'olea-button olea-button-primary',
      text: HOME_START_ACTION,
    });
    start.addEventListener('click', () => this.deps.openSessionBuilder());
    const why = actions.createEl('button', {
      cls: 'olea-button olea-button-quiet',
      text: SESSION_WHY_THESE_LABEL,
    });
    why.addEventListener('click', () => this.deps.openSessionBuilder());
  }

  /** F6.10's "one row per running course... term-at-a-glance" — see this file's own module doc for why the row of strips is the whole composition. */
  private renderCourses(root: HTMLElement, courses: readonly HomeCourseRow[]): void {
    if (courses.length === 0) return;

    // `.olea-panel`/`.olea-panel-head`: the shared panel primitive, the same
    // bordered-radius-elevated-with-a-head-bar treatment `registry`/`bulk-
    // review` already reuse — see this file's own module doc. `.olea-home-
    // panel-head` is the one modifier this pane needs (wrapping the note
    // onto its own line on a narrow pane); the rest is the primitive alone.
    const panel = root.createDiv({ cls: 'olea-panel' });
    const head = panel.createDiv({ cls: 'olea-panel-head olea-home-panel-head' });
    head.createSpan({ cls: 'olea-panel-title', text: HOME_COURSES_PANEL_TITLE });
    head.createSpan({ cls: 'olea-meta', text: HOME_COURSES_PANEL_NOTE });
    const openTerm = head.createEl('button', {
      cls: 'olea-button olea-button-quiet olea-home-panel-action',
      text: HOME_OPEN_TERM_ACTION,
    });
    openTerm.addEventListener('click', () => this.deps.openGrove());

    const list = panel.createDiv();
    courses.forEach((row, i) => {
      this.renderCourseRow(list, row, i === 0);
    });
  }

  private renderCourseRow(parent: HTMLElement, row: HomeCourseRow, first: boolean): void {
    const el = parent.createDiv({
      cls: `olea-home-course-row${first ? ' olea-home-course-row-first' : ''}`,
    });
    el.createDiv({ cls: 'olea-home-course-name', text: row.course });

    const mapEl = el.createDiv({ cls: 'olea-home-course-map' });
    if (row.marks === undefined) {
      mapEl.createSpan({ cls: 'olea-meta olea-home-course-no-map', text: HOME_SCOPE_NOT_DECLARED });
    } else if (row.marks.length === 0) {
      mapEl.createSpan({ cls: 'olea-meta olea-home-course-no-map', text: HOME_NO_MAP_DRAWN });
    } else {
      for (const mark of row.marks) this.renderMark(mapEl, mark);
    }

    if (row.quiet !== undefined) this.renderQuiet(el, row.quiet);
  }

  private renderMark(parent: HTMLElement, mark: HomeGroveMark): void {
    if (mark.kind === 'stage') {
      const span = parent.createSpan({ cls: 'olea-home-mark' });
      span.appendChild(renderSprig({ state: mark.state, size: 9, container: span }));
      return;
    }
    parent.createSpan({ cls: `olea-home-mark olea-home-mark-${mark.kind}` });
  }

  private renderQuiet(parent: HTMLElement, quiet: HomeQuietLine): void {
    const el = parent.createDiv({ cls: 'olea-home-quiet' });
    el.createSpan({ cls: 'olea-home-quiet-dot' });
    el.createSpan({ cls: 'olea-fine', text: quiet.text });

    if (quiet.kind !== 'retrospective-offer') return;
    // `.olea-button-quiet` alone fully determines each action's chrome — no
    // `-open`/`-dismiss` modifier class, same reasoning as the offer card's
    // own actions above.
    const actions = el.createDiv({ cls: 'olea-home-quiet-actions' });
    const open = actions.createEl('button', {
      cls: 'olea-button olea-button-quiet',
      text: OPEN_RETROSPECTIVE_ACTION,
    });
    open.addEventListener('click', () => {
      this.deps.openRetrospective();
    });
    const dismiss = actions.createEl('button', {
      cls: 'olea-button olea-button-quiet',
      text: DISMISS_OFFER_ACTION,
    });
    dismiss.addEventListener('click', () => {
      void this.deps.dismiss(quiet.assessmentPath).then(() => this.refresh());
    });
  }
}
