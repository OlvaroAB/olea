/**
 * `SessionBuilderView` — F4.6's three steering inputs (`ol-p5t06b` [P5-T06b];
 * STEER-2 `ol-ijms`), rendered as a panel rather than a screen since
 * `[D-243]` (`ol-egov.135`, `ol-egov.132.7` [SESS-8.7]).
 *
 * **`[D-243]` supersedes this view's own prior scope.** Before this bead the
 * whole session — the headline, the ranked item list, the countdown, F4.9's
 * "why these" reasoning, F6.7's by-source lines and the explain-back door —
 * rendered here, and Home opened this screen to show any of it. F4.6 as
 * amended reads: *"The entry is Home. The three steering inputs sit inline
 * on Home, beside the composed session ... and Start on Home sits that
 * session — there is no builder screen to pass through ... The session
 * builder is therefore a panel, not a destination: what was a view of its
 * own is the steering panel Home embeds."* F6.10 as amended says the same
 * thing from Home's side: "Home carries F4.6's three steering inputs inline,
 * beside that headline, and Start sits the composed session directly rather
 * than opening a builder." So every rendering decision below follows one
 * rule: if it is one of the three steering inputs (the time she has, a
 * course or topic, a stated interest), it stays; if it is part of the
 * SESSION itself (what F6.4's "one answer" renders), it moved to
 * `../home/view.ts`, which is the only place F6.4's headline is drawn now.
 *
 * **Reachability: this view is no longer a navigation target.** `main.ts`'s
 * palette command and the gap view's `build-session` affordance (F4.4) used
 * to call `revealSessionBuilderView`; both now call `revealHomeView`
 * instead (the gap view's call seeds Home's own `setFocusConcept`, the
 * pre-fill F4.6 still names: "the gap view may still hand a course or topic
 * into those inputs — that is a pre-fill of a steering input on Home, never
 * a second entry"). `VIEW_TYPE_OLEA_SESSION` stays registered so a saved
 * Obsidian workspace layout that still references it does not error on
 * reopen; nothing in this plugin chooses to open it any more.
 * `features/F6-today.md`'s "The start gate" section carries the scenario set
 * for both halves of this change.
 *
 * **What is shared with Home, and why it lives here rather than in a third
 * file.** {@link renderSteeringControls} is the one rendering of F4.6's
 * budget buttons and course-or-topic select — `../home/view.ts` calls it
 * directly rather than re-typing the same DOM/class vocabulary a second
 * time, which is exactly the "two wordings of one promise drift; one string
 * cannot" argument `./copy.ts` already makes for its own strings, applied to
 * markup. It stays a plain, `obsidian`-free DOM builder (parent element in,
 * nothing out) so both this view's own `render()` and Home's `renderOffer`
 * can call it against their own `contentEl` subtree.
 *
 * **Still thin, still untestable directly, for the same reason as before.**
 * `obsidian` has no runtime outside a real host, so there is no test file
 * for this module and none is expected; `test/session-builder/copy.spec.ts`
 * covers the strings `renderSteeringControls` renders verbatim, and
 * `test/session-builder/wiring.spec.ts`/`test/home/provider.spec.ts` cover
 * this bead's own reachability and composition claims (see the feature
 * file's scenario tags).
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { ReentryStudySessionView, StudySessionModel } from 'olea-core';
import {
  budgetOptionLabel,
  COURSE_OR_TOPIC_ALL_LABEL,
  COURSE_OR_TOPIC_COURSE_GROUP_LABEL,
  COURSE_OR_TOPIC_LABEL,
  COURSE_OR_TOPIC_TOPIC_GROUP_LABEL,
  type CourseOrTopicOption,
  courseOrTopicNotFoundLine,
  DEFAULT_SESSION_BUDGET_MINUTES,
  SESSION_BUDGET_OPTIONS,
  SESSION_VIEW_TITLE,
} from './copy.js';

export const VIEW_TYPE_OLEA_SESSION = 'olea-session-builder';

/**
 * What a caller's `load()` reports. Still carries the full composed session
 * shape (`'model'`/`'reentry'`) rather than being narrowed to just
 * `courseOrTopicOptions`, because `../home/provider.ts` — the one production
 * caller left that actually reads the session, not just the options — is
 * this exact type. This view now reads only `courseOrTopicOptions` off it
 * (see {@link SessionBuilderView.render}'s own comment for why).
 */
export type SessionBuilderState =
  | {
      readonly kind: 'model';
      readonly model: StudySessionModel;
      readonly courseOrTopicOptions?: readonly CourseOrTopicOption[];
      readonly staleReasonLine?: string;
    }
  | {
      readonly kind: 'reentry';
      readonly view: ReentryStudySessionView;
      readonly courseOrTopicOptions?: readonly CourseOrTopicOption[];
      readonly staleReasonLine?: string;
    }
  | { readonly kind: 'unavailable' };

/** What a caller asks for when it (re)builds — F4.6's three steering inputs, unchanged in shape by `[D-243]`: only where they render moved. */
export interface SessionBuilderRequest {
  readonly budgetMinutes: number;
  /** The concept the gap view's `build-session` affordance named, if any — F4.6's "stated interest". Omitted means "build from the whole ranking". */
  readonly focusConceptName?: string;
  /** F4.6's "course or topic to work on", chosen from the PREVIOUS `load()`'s `courseOrTopicOptions` (or unset, on the very first call). Omitted means no restriction. */
  readonly courseOrTopic?: CourseOrTopicOption;
}

export interface SessionBuilderViewDeps {
  /** Builds a session. Async because it reads the vault and runs the oracle chain. This view only reads `courseOrTopicOptions` off the result — the composed session itself is Home's to render. */
  readonly load: (request: SessionBuilderRequest) => Promise<SessionBuilderState>;
  /** Overrides `SESSION_BUDGET_OPTIONS` — the budgets are a Class B default, reversible from the outside. */
  readonly budgetOptions?: readonly number[];
  readonly defaultBudgetMinutes?: number;
  /**
   * RBLD-2 (`ol-e228`), component register row 3.6: tells `load`'s own
   * rebuild controller that she finished or navigated away, so the freeze it
   * holds across `load` calls (`./provider.js`'s `SittingState`) releases.
   * Kept even though this view no longer shows a session, because
   * `./provider.js`'s per-leaf sitting is unchanged by `[D-243]` — only what
   * this view DRAWS from it did.
   */
  readonly endSitting?: () => void;
  /**
   * `[D-163]` (`ol-12gs`)'s "session assembly F4.6" door onto
   * `ExplainBackModal`, forwarded (never called) by
   * `../session-builder/provider.ts` from its own
   * `CreateLocalSessionBuilderProviderDeps.openExplainBack` — kept on this
   * interface purely so that pass-through still typechecks. **`[D-243]`
   * moved the actual affordance to `../home/view.ts`'s own
   * `HomeViewDeps.openExplainBack`**, since this view no longer renders the
   * composed session that door explains; this field is unused by
   * `SessionBuilderView.render` below.
   */
  readonly openExplainBack?: () => void;
}

/**
 * F4.6's three steering inputs (`[D-243]`), rendered against `parent`.
 * Shared verbatim by this view's own {@link SessionBuilderView.render} and
 * by `../home/view.ts`'s inline embed — see this module's own doc, "What is
 * shared with Home". Pure DOM: no `this`, no `obsidian` type beyond the
 * `HTMLElement`/`HTMLSelectElement` globals every `.js` runtime already has.
 *
 * The "stated interest" input (F4.6's third) is read-only here on purpose —
 * it is a PRE-FILL the gap view hands in (`SessionBuilderRequest.
 * focusConceptName`), never a free-text control this panel itself offers,
 * so this function only ever needs a way to show it and a way to clear it.
 * `deps.focusConceptName`/`deps.onClearFocusConcept` are both optional so a
 * caller with nothing to show renders no chip, never an empty one.
 */
export interface SteeringControlsDeps {
  readonly budgetMinutes: number;
  readonly budgetOptions?: readonly number[];
  readonly onBudgetChange: (minutes: number) => void;
  readonly courseOrTopicOptions?: readonly CourseOrTopicOption[];
  readonly courseOrTopic: CourseOrTopicOption | undefined;
  readonly onCourseOrTopicChange: (option: CourseOrTopicOption | undefined) => void;
}

export function renderSteeringControls(parent: HTMLElement, deps: SteeringControlsDeps): void {
  const bar = parent.createDiv({ cls: 'olea-session-budgets' });
  for (const minutes of deps.budgetOptions ?? SESSION_BUDGET_OPTIONS) {
    const button = bar.createSpan({
      cls: 'olea-session-budget',
      text: budgetOptionLabel(minutes),
    });
    // `addClass` rather than a ternary inside `cls:` — `test/session-builder/
    // styles.spec.ts` reads the class names out of this file's source, and a
    // class hidden inside a conditional expression is one the drift guard
    // cannot see.
    if (minutes === deps.budgetMinutes) button.addClass('olea-session-budget-active');
    button.addEventListener('click', () => deps.onBudgetChange(minutes));
  }

  const options = deps.courseOrTopicOptions;
  // A caller that never offers options (see `SessionBuilderState`'s own doc)
  // gets no control at all, rather than an empty, useless select.
  if (options === undefined || options.length === 0) return;

  const notFound = courseOrTopicNotFoundLine(deps.courseOrTopic, options);
  if (notFound !== null) parent.createDiv({ text: notFound });

  // `value` is set as a plain DOM property below rather than through
  // `createEl`'s own info object — `packages/workbench`'s
  // `OleaShimDomElementInfo` (its own stand-in for Obsidian's real
  // `DomElementInfo`) does not declare one, and `HTMLOptionElement.value` is
  // a standard lib.dom property either shim leaves untouched.
  const select = parent.createEl('select', {
    cls: 'olea-session-select',
    attr: { 'aria-label': COURSE_OR_TOPIC_LABEL },
  });
  const allOption = select.createEl('option', { text: COURSE_OR_TOPIC_ALL_LABEL });
  allOption.value = '';

  const courses = options.filter((option) => option.kind === 'course');
  if (courses.length > 0) {
    const group = select.createEl('optgroup', {
      attr: { label: COURSE_OR_TOPIC_COURSE_GROUP_LABEL },
    });
    for (const option of courses) {
      const el = group.createEl('option', { text: option.label });
      el.value = JSON.stringify(option);
    }
  }

  const topics = options.filter((option) => option.kind === 'topic');
  if (topics.length > 0) {
    const group = select.createEl('optgroup', {
      attr: { label: COURSE_OR_TOPIC_TOPIC_GROUP_LABEL },
    });
    for (const option of topics) {
      const el = group.createEl('option', { text: option.label });
      el.value = JSON.stringify(option);
    }
  }

  // Matches an option's `value` only when the current choice is still among
  // the options just built; a stale choice (the vault changed under her)
  // leaves the select on "everything" — `notFound` above is what says so.
  select.value = deps.courseOrTopic === undefined ? '' : JSON.stringify(deps.courseOrTopic);

  select.addEventListener('change', () => {
    deps.onCourseOrTopicChange(
      select.value === '' ? undefined : (JSON.parse(select.value) as CourseOrTopicOption),
    );
  });
}

export class SessionBuilderView extends ItemView {
  private readonly deps: SessionBuilderViewDeps;
  private budgetMinutes: number;
  private focusConceptName: string | undefined;
  private courseOrTopic: CourseOrTopicOption | undefined;
  private courseOrTopicOptions: readonly CourseOrTopicOption[] | undefined;

  constructor(leaf: WorkspaceLeaf, deps: SessionBuilderViewDeps) {
    super(leaf);
    this.deps = deps;
    this.budgetMinutes = deps.defaultBudgetMinutes ?? DEFAULT_SESSION_BUDGET_MINUTES;
    this.focusConceptName = undefined;
    this.courseOrTopic = undefined;
    this.courseOrTopicOptions = undefined;
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
   * Rebuilds `courseOrTopicOptions` and redraws. Still calls `deps.load`
   * with the full `SessionBuilderRequest` (a course/topic choice may change
   * which options a later composition should offer), even though this view
   * only reads `courseOrTopicOptions` off what comes back — the composed
   * session itself is Home's to render (`[D-243]`).
   */
  async refresh(): Promise<void> {
    const request: SessionBuilderRequest = {
      budgetMinutes: this.budgetMinutes,
      ...(this.focusConceptName !== undefined ? { focusConceptName: this.focusConceptName } : {}),
      ...(this.courseOrTopic !== undefined ? { courseOrTopic: this.courseOrTopic } : {}),
    };
    const state = await this.deps.load(request);
    this.courseOrTopicOptions =
      state.kind === 'unavailable' ? undefined : state.courseOrTopicOptions;
    this.render();
  }

  /** Points this panel at one concept — the gap view's `build-session` affordance used to seed this view directly; `main.ts` now seeds `../home/view.ts`'s own `setFocusConcept` instead (`[D-243]`). Kept here so a caller that still holds a leaf of this type (a saved workspace layout) does not break. */
  async setFocusConcept(conceptName: string | undefined): Promise<void> {
    this.focusConceptName = conceptName;
    await this.refresh();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    renderSteeringControls(root, {
      budgetMinutes: this.budgetMinutes,
      ...(this.deps.budgetOptions !== undefined ? { budgetOptions: this.deps.budgetOptions } : {}),
      onBudgetChange: (minutes) => {
        this.budgetMinutes = minutes;
        void this.refresh();
      },
      ...(this.courseOrTopicOptions !== undefined
        ? { courseOrTopicOptions: this.courseOrTopicOptions }
        : {}),
      courseOrTopic: this.courseOrTopic,
      onCourseOrTopicChange: (option) => {
        this.courseOrTopic = option;
        void this.refresh();
      },
    });
  }
}
