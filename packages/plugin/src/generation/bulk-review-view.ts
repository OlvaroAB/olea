/**
 * `BulkReviewView` — F3.3's bulk-review triage path, DOM glue only
 * (`ol-jie3`). All the logic — grouping, resolving, accept-remainder — lives
 * in `bulk-review.ts`'s obsidian-free `BulkReviewController`; this file
 * builds the list, wires clicks and keys, and re-renders after every action,
 * the same "structure here, logic there" split `review/view.ts` uses over
 * `review/session.ts` (see that file's own module doc). No test file exists
 * for this one and none is expected, for the identical reason: `obsidian`
 * has no runtime outside a real host, so `BulkReviewController`
 * (`bulk-review.spec.ts`) and `bulk-review-keymap.ts`
 * (`bulk-review-keymap.spec.ts`) carry every scenario that doesn't need a
 * real DOM, and this file is left thin and mechanical on purpose.
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
 * **A row names its source (`[D-216]` / `ol-egov.105`).** Every item shows
 * `bulk-review-copy.ts`'s `sourceMarkerText` — a plain, always-visible
 * pointer to the reading it was drafted from — and, when `openSource` below
 * is wired, the exact same `REGISTRY_ENTRY_ACTION` button `review/view.ts`
 * renders for an ordinary instrument (imported, not re-declared, per the
 * ruling's own citation of it). `openSource` is optional and absent by
 * default for the identical reason `review/view.ts`'s own
 * `openRegistryEntry` is: a `main.ts` wiring gap greys the button out via
 * omission rather than shipping a dead click — never disabled-and-shown.
 * The passage itself never renders inline here; clicking only ever opens the
 * existing one-step affordance (`[D-171]`), same as everywhere else it
 * appears.
 *
 * **Keyboard bindings landed (`[D-216]` / `ol-egov.105`).** Move down the
 * list (`↓`), keep (`K`), fix (`F`) and bin (`B`) are real bindings now,
 * resolved by `bulk-review-keymap.ts`'s `resolveBulkReviewKey` against
 * whichever row currently holds DOM focus — the same "resolver never sees
 * `event.target`, the view decides what a key applies to" split
 * `review/keymap.ts`/`review/view.ts` already draw. This view renders the
 * on-screen hint row (`BULK_REVIEW_HINTS`) so Q6.5's "every hint is a real
 * binding" promise holds here, which is what retires the **"click-only this
 * round, disclosed (`ol-uxk9`)"** caveat this doc used to carry. The source
 * peek above stays click-only on purpose (`bulk-review-keymap.ts`'s own
 * doc) — it is not one of the four keys this list invents.
 *
 * **Dark by default, regardless of her theme (F2.4)** — same `theme-dark`
 * class on `contentEl` that `review/view.ts` applies, and the same reasoning:
 * it makes this view's own `var(--background-primary, …)` resolve through
 * the dark branch of her installed theme without fighting the rest of
 * Obsidian, and undoes itself the instant the tab closes.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { REGISTRY_ENTRY_ACTION } from '../review/copy.js';
import type { BulkReviewController } from './bulk-review.js';
import {
  BULK_REVIEW_COMPLETION_HEADING,
  BULK_REVIEW_EMPTY_TEXT,
  BULK_REVIEW_ITEM_TYPE_LABEL,
  bulkReviewCompletionTally,
  sourceMarkerText,
} from './bulk-review-copy.js';
import { BULK_REVIEW_HINTS, resolveBulkReviewKey } from './bulk-review-keymap.js';

export const VIEW_TYPE_OLEA_BULK_REVIEW = 'olea-bulk-review';

/** Marks a row's wrapper element so keyboard focus-tracking and the keep/fix/bin dispatch below can find which draft is currently focused, mirroring `review/view.ts`'s own `data-olea-focusable`-style convention. */
const ROW_DRAFT_ID_ATTR = 'data-olea-bulk-draft-id';

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
  /**
   * `[D-216]`'s click-through: opens the registry entry for the concept a
   * row's draft belongs to — the same `REGISTRY_ENTRY_ACTION` affordance
   * `review/view.ts` opens by `instrumentId`, targeted by `conceptKey` here
   * because a still-pending draft has no `instrumentId` yet. Optional and
   * unset by default (`main.ts` wires it), matching `review/view.ts`'s own
   * `openRegistryEntry` grey-out-via-omission posture — see this class's own
   * module doc.
   */
  private readonly openSource: ((conceptKey: string) => void) | undefined;
  private controller: BulkReviewController | null = null;
  /**
   * `[STY-0e]`: how many drafts she has resolved THIS OPEN of the tab, by
   * outcome — the receipt `bulkReviewCompletionTally` renders once the list
   * empties. Reset to zero only by a fresh `onOpen` (a new controller, a new
   * sitting); never persisted, because it describes this sitting only, not
   * a standing count of anything (F6.7 — see that function's own doc for why
   * this is the permitted category of count).
   */
  private counts = { accepted: 0, edited: 0, rejected: 0 };

  constructor(
    leaf: WorkspaceLeaf,
    getController: BulkReviewControllerProvider,
    openSource?: (conceptKey: string) => void,
  ) {
    super(leaf);
    this.getController = getController;
    this.openSource = openSource;
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
    // `[D-216]` keyboard bindings: same `tabindex="-1"` + root-level
    // `keydown` listener `review/view.ts`'s `onOpen` uses, so the list
    // itself can hold focus and every key reaches `handleKeydown` regardless
    // of which row (if any) currently has it.
    this.contentEl.setAttr('tabindex', '-1');
    this.registerDomEvent(this.contentEl, 'keydown', (evt) => {
      void this.handleKeydown(evt);
    });
    this.renderLoading();
    this.controller = this.getController();
    await this.controller.load();
    this.render();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  // ---- keyboard (`[D-216]` / `ol-egov.105`) ----

  /**
   * Same text-field guard `review/view.ts`'s own `handleKeydown` carries:
   * nothing under this view is a real input today, but a future inline-edit
   * affordance should not have to remember to add this itself.
   */
  private async handleKeydown(evt: KeyboardEvent): Promise<void> {
    const target = evt.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    const action = resolveBulkReviewKey({ key: evt.key });
    if (action === null) return;
    evt.preventDefault();
    if (action.kind === 'focus-move-down') {
      this.moveFocusDown();
      return;
    }
    const draftId = this.focusedDraftId();
    if (draftId === null) return;
    switch (action.kind) {
      case 'keep':
        await this.run('accepted', (controller) => controller.accept(draftId));
        break;
      case 'fix':
        await this.run('edited', (controller) => controller.editBeforeSaving(draftId));
        break;
      case 'bin':
        await this.run('rejected', (controller) => controller.reject(draftId));
        break;
    }
  }

  /** Every row's wrapper element, in the same document order they render — groups top to bottom, oldest item first within each (`buildBulkReviewGroups`'s own ordering). */
  private rowElements(): HTMLElement[] {
    return Array.from(this.contentEl.querySelectorAll<HTMLElement>(`[${ROW_DRAFT_ID_ATTR}]`));
  }

  /** Whichever row currently holds DOM focus, or `null` if none does — the one place that reads `activeElement`, so `focusedDraftId`/`focusedRowIndex`/`moveFocusDown` below all agree on what "focused" means. */
  private activeRow(): HTMLElement | null {
    const active = this.contentEl.ownerDocument.activeElement;
    return active instanceof HTMLElement
      ? active.closest<HTMLElement>(`[${ROW_DRAFT_ID_ATTR}]`)
      : null;
  }

  /** The draft id backing whichever row currently holds DOM focus, or the first row if none does — the same "no active element reads as index 0" fallback `review/view.ts`'s `moveFocus` uses, so `K`/`F`/`B` do something sensible even before she has pressed `↓` once. `null` only when the list is empty. */
  private focusedDraftId(): string | null {
    const target = this.activeRow() ?? this.rowElements()[0] ?? null;
    return target?.getAttribute(ROW_DRAFT_ID_ATTR) ?? null;
  }

  /** Moves DOM focus to the next row, wrapping past the last back to the first — mirrors `review/view.ts`'s own `moveFocus` modulo-wrap shape. A row with no `tabindex` cannot be focused at all, so every row this class builds sets one (see `renderGroup`). */
  private moveFocusDown(): void {
    const rows = this.rowElements();
    if (rows.length === 0) return;
    const activeRow = this.activeRow();
    const activeIndex = activeRow === null ? -1 : rows.indexOf(activeRow);
    const next = rows[(activeIndex + 1) % rows.length];
    next?.focus();
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

  /**
   * Runs one controller action, then reloads and re-renders — every action
   * here can change what else is still pending (an accept-remainder resolves
   * a whole group at once), so a fresh `load()` is cheaper to reason about
   * than patching the view model in place.
   *
   * `[D-216]`: also carries keyboard focus across the re-render. A resolved
   * row disappears, so re-rendering with no further care would drop focus to
   * the document — restoring it to whatever row now sits at the same
   * position is what makes `K`/`F`/`B`/`↓` read as working through a list
   * rather than losing her place after every key. A click that starts with
   * no row focused (`previousIndex` is `null`) restores nothing, which is
   * the pre-`[D-216]` behaviour unchanged for the mouse path.
   *
   * `[STY-0e]`: `kind`, when given, is this action's outcome for the
   * session-local receipt (`this.counts`) `render` reads once the list
   * empties — `undefined` for a caller with no single outcome to name
   * (`acceptRemainder`'s own click handler counts its own result instead,
   * since one call resolves many drafts at once).
   */
  private async run(
    kind: 'accepted' | 'edited' | 'rejected' | undefined,
    action: (controller: BulkReviewController) => Promise<void>,
  ): Promise<void> {
    const controller = this.controller;
    if (controller === null) return;
    const previousIndex = this.focusedRowIndex();
    await action(controller);
    if (kind !== undefined) this.counts[kind]++;
    await controller.load();
    this.render();
    this.restoreFocus(previousIndex);
  }

  /** The index, among `rowElements()`, of whichever row currently holds DOM focus — `null` if none does (nothing to restore after re-render). */
  private focusedRowIndex(): number | null {
    const activeRow = this.activeRow();
    if (activeRow === null) return null;
    const index = this.rowElements().indexOf(activeRow);
    return index === -1 ? null : index;
  }

  private restoreFocus(previousIndex: number | null): void {
    if (previousIndex === null) return;
    const rows = this.rowElements();
    if (rows.length === 0) return;
    rows[Math.min(previousIndex, rows.length - 1)]?.focus();
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
      const resolvedAnything = this.counts.accepted + this.counts.edited + this.counts.rejected > 0;
      // `[STY-0e]`: a receipt only where there is something to report — she
      // opened the tab and resolved everything in it this sitting. Opening
      // to an already-empty tab (the `bulk-review-empty` case) gets the
      // plain honest-empty text unchanged, never a "0 accepted" tally.
      if (resolvedAnything) {
        this.renderCompletion(root);
      } else {
        root.createEl('p', {
          cls: 'olea-bulk-review-empty',
          text: BULK_REVIEW_EMPTY_TEXT,
        });
      }
      return;
    }

    // `[D-216]` Q6.5: the hint row only where there is something to act
    // on — same posture `review/keymap.ts`'s `hasGlobalBindings` takes for
    // its own empty/session-complete screens.
    this.renderHints(root);

    for (const group of vm.groups) {
      this.renderGroup(
        root,
        group.sourcePath,
        group.courseCode,
        group.noteTitle,
        // `[D-214]` / `ol-ymew`: the source marker's own title and register
        // are the group's, not `noteTitle` above — see
        // `BulkReviewGroupViewModel`'s own doc for why the two diverge for
        // an authored-note origin.
        sourceMarkerText(group.sourceMarkerNoteTitle, group.sourceMarkerOrigin),
        group.items,
      );
    }
  }

  /**
   * `[STY-0e]` — Pass 2's completion state ("factual, brief, done"), as
   * `ol-2x4` narrowed it: the tally and nothing else. No promise about when
   * anything is next due (`ol-2x4` rejected the kit's own draft of that
   * sentence as a scheduling claim the queue does not back) and no link
   * back to what she rejected (rejected there too, as a pure kit addition
   * absent from the brief).
   */
  private renderCompletion(root: HTMLElement): void {
    const wrap = root.createDiv({ cls: 'olea-bulk-review-complete' });
    wrap.createEl('h3', {
      cls: 'olea-bulk-review-complete-heading',
      text: BULK_REVIEW_COMPLETION_HEADING,
    });
    wrap.createDiv({
      cls: 'olea-bulk-review-complete-tally',
      text: bulkReviewCompletionTally(this.counts),
    });
  }

  /** The on-screen hint row for `[D-216]`'s four bindings — built from `bulk-review-keymap.ts`'s own `BULK_REVIEW_HINTS` so this row and `resolveBulkReviewKey` cannot drift apart (that module's own doc). Mirrors `review/view.ts`'s `hints` method's shape (keycap span + label span per entry). */
  private renderHints(root: HTMLElement): void {
    const row = root.createDiv({ cls: 'olea-bulk-review-hints' });
    for (const hint of BULK_REVIEW_HINTS) {
      const item = row.createSpan({ cls: 'olea-bulk-review-hint' });
      item.createSpan({ cls: 'olea-bulk-review-keycap', text: hint.key });
      item.createSpan({ text: hint.label });
    }
  }

  private renderGroup(
    root: HTMLElement,
    sourcePath: string,
    courseCode: string,
    noteTitle: string,
    sourceMarker: string,
    items: readonly {
      readonly draftId: string;
      readonly stem: string;
      readonly conceptName: string;
      readonly conceptIds: readonly string[];
      readonly correctAnswer: string;
      readonly distractors: readonly string[];
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
      void this.run(undefined, async (controller) => {
        const result = await controller.acceptRemainder(sourcePath);
        // `[STY-0e]`: one call resolves many drafts, so it counts itself
        // rather than fitting `run`'s single-outcome `kind` — only the ids
        // that actually succeeded are receipted (`result.failed` stays
        // pending and is still in the list on the next render).
        this.counts.accepted += result.accepted.length;
      });
    });

    const list = section.createDiv({ cls: 'olea-bulk-review-items' });
    for (const item of items) {
      // `[D-216]`: `tabindex="0"` and the draft-id attribute make this row
      // a real keyboard focus stop, so `↓`/`K`/`F`/`B` (`handleKeydown`
      // above) can find and act on it — every row this view builds gets one,
      // never only the ones a click happens to land on.
      const row = list.createDiv({
        cls: 'olea-bulk-review-item',
        attr: { tabindex: '0', [ROW_DRAFT_ID_ATTR]: item.draftId },
      });
      const body = row.createDiv({ cls: 'olea-bulk-review-item-body' });
      // `[STY-0e]`: every real F3.3 draft is quiz-shaped today (this
      // module's own `BulkReviewItemViewModel` doc) — Q&A/cloze marks would
      // be unreachable by real data, so only the one type this cache ever
      // produces gets one.
      body.createDiv({ cls: 'olea-bulk-review-item-type', text: BULK_REVIEW_ITEM_TYPE_LABEL });
      const content = body.createDiv({ cls: 'olea-bulk-review-item-content' });
      content.createDiv({ cls: 'olea-bulk-review-item-stem', text: item.stem });
      content.createDiv({ cls: 'olea-bulk-review-item-concept', text: item.conceptName });

      // `[STY-0e]`: the pool she is actually judging — her answer isn't on
      // trial here the way it is in review (F3.3's clearing-row/practice
      // split, this file's own module doc); what she is checking is whether
      // the drafted correct answer and its distractors are worth keeping.
      // Absent, not empty, for a hypothetical draft with no distractors.
      if (item.distractors.length > 0) {
        const pool = content.createDiv({ cls: 'olea-bulk-review-item-pool' });
        const correct = pool.createDiv({
          cls: 'olea-bulk-review-item-option olea-bulk-review-item-option--correct',
        });
        correct.createSpan({ text: item.correctAnswer });
        correct.createSpan({ cls: 'olea-bulk-review-item-option-mark', text: 'correct' });
        for (const distractor of item.distractors) {
          const option = pool.createDiv({ cls: 'olea-bulk-review-item-option' });
          option.createSpan({ text: distractor });
        }
      }

      // `[D-216]` clause 2: the row's floor is a named origin in ordinary
      // words, always visible — rendered regardless of whether the
      // click-through below is wired. Clause 5: this text names the origin,
      // it never claims the draft is supported by it. `[D-214]` / `ol-ymew`:
      // `sourceMarker` already carries the right register (reading vs. a
      // note she wrote), computed once per group in `render()` above.
      const source = content.createDiv({ cls: 'olea-bulk-review-item-source' });
      source.createSpan({ text: sourceMarker });
      // `[D-216]` clause 3/4: the passage stays one step away, opened on
      // request through the SAME affordance `review/view.ts` renders for an
      // ordinary instrument (`REGISTRY_ENTRY_ACTION`, imported not
      // re-declared) — absent entirely rather than shown disabled when
      // `openSource` was never wired, the identical grey-out-via-omission
      // posture that affordance already holds elsewhere (this class's own
      // module doc). Targeted by the concept's own key: a still-pending
      // draft has no `instrumentId` yet.
      const openSource = this.openSource;
      const conceptKey = item.conceptIds[0];
      if (openSource && conceptKey !== undefined) {
        const peekBtn = source.createEl('button', {
          cls: 'olea-bulk-review-item-source-peek',
          text: REGISTRY_ENTRY_ACTION,
        });
        this.registerDomEvent(peekBtn, 'click', () => openSource(conceptKey));
      }

      const actions = content.createDiv({ cls: 'olea-bulk-review-item-actions' });

      const acceptBtn = actions.createEl('button', {
        cls: 'olea-bulk-review-action olea-bulk-review-action--accept',
        text: 'Accept',
      });
      this.registerDomEvent(acceptBtn, 'click', () => {
        void this.run('accepted', (controller) => controller.accept(item.draftId));
      });

      const editBtn = actions.createEl('button', {
        cls: 'olea-bulk-review-action olea-bulk-review-action--edit',
        text: 'Edit before saving',
      });
      this.registerDomEvent(editBtn, 'click', () => {
        void this.run('edited', (controller) => controller.editBeforeSaving(item.draftId));
      });

      const rejectBtn = actions.createEl('button', {
        cls: 'olea-bulk-review-action olea-bulk-review-action--reject',
        text: 'Reject',
      });
      this.registerDomEvent(rejectBtn, 'click', () => {
        void this.run('rejected', (controller) => controller.reject(item.draftId));
      });
    }
  }
}
