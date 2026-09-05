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
 * **Three densities, one list (`[STY-6]` / `ol-l5og.18.15`).** The kit's
 * argument for this surface is velocity, and it spends the screen
 * accordingly: `TriageParts.jsx` draws a *settled* row (dimmed, one line,
 * the outcome she chose), a *pending* row (one line, waiting its turn) and
 * a *focused* row (the only one with body detail, an olive draft gutter and
 * a full action row). `[STY-0e]` built every row at focused density and
 * disclosed the settled tier as a follow-up; this is it.
 *
 * Two properties of how it is built matter more than the CSS:
 *
 * - **The tier is a class, never a re-render.** Every row's full content is
 *   always in the DOM and the density is CSS; `focusin` only moves the
 *   `--focused` class. Re-rendering on focus would destroy the button under
 *   a click between `mousedown` and `mouseup`, which is the mouse path the
 *   workbench e2e spec exercises — a density model that silently breaks
 *   clicking is not the kit's design, it is a regression wearing it.
 * - **A pending row keeps its controls, where the kit's has none.** The one
 *   deliberate departure. A mouse user must not have to focus a row before
 *   she can act on it (`ol-p6t03`'s reachability posture, and the reason
 *   `[STY-0e]` gave for not attempting the tiers at all). What collapses on
 *   a pending row is the distractor pool, the concept line and the action
 *   row's weight — never `[D-216]`'s named origin, which clause 2 makes
 *   always-visible on every live row regardless of tier.
 *
 * **The header reports what she resolved, never what is left (F6.7).** The
 * kit's `12 of 34` and `Accept remaining 22` both name a denominator of
 * material she has built and not yet met, which principle 7 forbids as "a
 * counter nobody drives to zero… harder to see because it looks like
 * information". The header's progress slot therefore carries the same
 * already-ruled category `bulkReviewCompletionTally` reports at the end of a
 * sitting (`ol-2x4`) — what she has met and resolved — and, before she has
 * resolved anything, F3.3's own guarantee that nothing is in her deck yet.
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
  BULK_REVIEW_DECK_REASSURANCE,
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

/**
 * One row of `[STY-6]`'s settled tier — what she decided, still legible,
 * still reversible (a rejected draft is "retained in full, never deleted",
 * F3.3). `sourcePath` is the group it belongs under, so the history sits
 * with its own document rather than in one undifferentiated pile.
 */
interface SettledRow {
  readonly sourcePath: string;
  readonly stem: string;
  readonly outcome: 'accepted' | 'edited' | 'rejected';
}

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
   * `[STY-6]`: the settled tier's own backing list — one entry per draft she
   * resolved THIS OPEN of the tab, in the order she resolved them, carrying
   * the stem the row showed and the outcome she chose. `BulkReviewController`
   * drops a resolved draft from its view model entirely (that is what
   * "leaves the list" means for the cache), so the kit's dimmed history has
   * no source but this: captured from the view model immediately before the
   * action that resolves it, never re-read afterwards. Session-local and
   * never persisted, for the same F6.7 reason `tally` below states.
   */
  private settled: readonly SettledRow[] = [];
  /**
   * `[STY-6]`: which draft currently holds the focused tier. Kept here rather
   * than read from `activeElement` so the tier survives a re-render (an
   * action rebuilds the whole list) and so the list opens with a focused row
   * before she has pressed a key or clicked anything — the same "no active
   * element reads as index 0" fallback `focusedDraftId` already applied to
   * the keyboard path, promoted to something the CSS can see.
   */
  private focusedDraft: string | null = null;
  /**
   * `[STY-6]`: every document this sitting has shown, in the order it first
   * appeared, with the identity its header needs. `BulkReviewController`
   * drops a group entirely once its last draft resolves, so without this a
   * document she has just finished clearing would take its own settled
   * history off the screen with it while a half-cleared sibling kept
   * hers — the record would be inconsistent about the same act.
   */
  private readonly documents = new Map<
    string,
    { courseCode: string; noteTitle: string; sourceMarker: string }
  >();

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
    // `[STY-6]`: the focused tier follows real DOM focus (a click, a Tab, a
    // `↓`), and it moves a CLASS rather than re-rendering — see this class's
    // own module doc for why re-rendering here would break the mouse path.
    this.registerDomEvent(this.contentEl, 'focusin', (evt) => {
      const target = evt.target;
      // Only the ROW itself opening — never a button inside one. A button
      // that grew a distractor pool above it between `mousedown` and
      // `mouseup` would move out from under the cursor and the click would
      // never fire; the row is the focus stop `↓` moves and the one a click
      // on the row body lands on, so tiering on it alone costs nothing and
      // keeps every control clickable where it was drawn.
      const row = target instanceof HTMLElement ? target : null;
      const draftId = row === null ? null : (row.getAttribute(ROW_DRAFT_ID_ATTR) ?? null);
      if (draftId === null || draftId === this.focusedDraft) return;
      this.focusedDraft = draftId;
      this.applyFocusedTier();
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
        await this.resolveOne(draftId, 'accepted', (controller) => controller.accept(draftId));
        break;
      case 'fix':
        await this.resolveOne(draftId, 'edited', (controller) =>
          controller.editBeforeSaving(draftId),
        );
        break;
      case 'bin':
        await this.resolveOne(draftId, 'rejected', (controller) => controller.reject(draftId));
        break;
    }
  }

  /** Every row's wrapper element, in the same document order they render — groups top to bottom, oldest item first within each (`buildBulkReviewGroups`'s own ordering). */
  private rowElements(): HTMLElement[] {
    return Array.from(this.contentEl.querySelectorAll<HTMLElement>(`[${ROW_DRAFT_ID_ATTR}]`));
  }

  /** The draft id backing whichever row currently holds the focused tier — `this.focusedDraft` if it survived the last render, otherwise the list's first row, the same "no active element reads as index 0" fallback `review/view.ts`'s `moveFocus` uses so `K`/`F`/`B` do something sensible before she has pressed `↓` once. `null` only when nothing is pending. */
  private focusedDraftId(): string | null {
    return this.focusedDraft ?? this.pendingDraftIds()[0] ?? null;
  }

  /** Every still-pending draft id in the order the rows render — groups top to bottom, oldest item first within each (`buildBulkReviewGroups`'s own ordering). Read from the view model rather than the DOM so `[STY-6]`'s focused tier can be resolved before a render rather than after one. */
  private pendingDraftIds(): string[] {
    const vm = this.controller?.getViewModel();
    return vm === undefined ? [] : vm.groups.flatMap((g) => g.items.map((i) => i.draftId));
  }

  /** The group path and stem behind one still-pending draft — `[STY-6]` captures this immediately BEFORE the action that resolves it, because the controller drops a resolved draft from its view model and the settled row has nowhere else to read its own text from. */
  private pendingRowFacts(draftId: string): { sourcePath: string; stem: string } | null {
    const vm = this.controller?.getViewModel();
    if (vm === undefined) return null;
    for (const group of vm.groups) {
      for (const item of group.items) {
        if (item.draftId === draftId) return { sourcePath: group.sourcePath, stem: item.stem };
      }
    }
    return null;
  }

  private rowElementFor(draftId: string): HTMLElement | null {
    return this.contentEl.querySelector<HTMLElement>(`[${ROW_DRAFT_ID_ATTR}="${draftId}"]`);
  }

  /**
   * `[STY-6]`: moves the focused tier's own class, and nothing else. This is
   * deliberately not a re-render — see this class's module doc: rebuilding
   * the list from a `focusin` handler destroys the button between a click's
   * `mousedown` and its `mouseup`, so the mouse path stops working while
   * every unit test still passes.
   */
  private applyFocusedTier(): void {
    for (const row of this.rowElements()) {
      const isFocused = row.getAttribute(ROW_DRAFT_ID_ATTR) === this.focusedDraft;
      row.toggleClass('olea-bulk-review-item--focused', isFocused);
      row.toggleClass('olea-bulk-review-item--pending', !isFocused);
    }
  }

  /** Moves the focused tier to the next row, wrapping past the last back to the first — mirrors `review/view.ts`'s own `moveFocus` modulo-wrap shape, over the view model's order rather than the DOM's so it agrees with what `render` drew. A row with no `tabindex` cannot be focused at all, so every row this class builds sets one (see `renderGroup`). */
  private moveFocusDown(): void {
    const ids = this.pendingDraftIds();
    if (ids.length === 0) return;
    const current = this.focusedDraft === null ? -1 : ids.indexOf(this.focusedDraft);
    const next = ids[(current + 1) % ids.length];
    if (next === undefined) return;
    this.focusedDraft = next;
    this.applyFocusedTier();
    this.rowElementFor(next)?.focus();
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
   * One draft, one outcome — the shape every per-row action takes. Captures
   * the row's own facts before the action runs (`[STY-6]`: the settled tier
   * has no other source for them) and hands `run` the settled row to append.
   */
  private async resolveOne(
    draftId: string,
    outcome: 'accepted' | 'edited' | 'rejected',
    action: (controller: BulkReviewController) => Promise<void>,
  ): Promise<void> {
    const facts = this.pendingRowFacts(draftId);
    await this.run(async (controller) => {
      await action(controller);
      return facts === null ? [] : [{ ...facts, outcome }];
    });
  }

  /**
   * Runs one controller action, then reloads and re-renders — every action
   * here can change what else is still pending (an accept-remainder resolves
   * a whole group at once), so a fresh `load()` is cheaper to reason about
   * than patching the view model in place.
   *
   * `[D-216]`: also carries keyboard focus across the re-render. A resolved
   * row disappears, so re-rendering with no further care would drop focus to
   * the document — moving the focused tier to whatever row now sits at the
   * same position is what makes `K`/`F`/`B`/`↓` read as working through a
   * list rather than losing her place after every key. `[STY-6]` moved that
   * bookkeeping off `activeElement` and onto `focusedDraft`, so it now holds
   * for the mouse path too: clicking Accept on a row leaves the tier where
   * the list continues, rather than nowhere.
   *
   * `[STY-6]`: `action` returns the settled rows this call produced — one for
   * a per-row verdict, many for `acceptRemainder`, none when the draft had
   * already gone. They are appended in the order she resolved them and read
   * back by `renderGroup`'s settled tier and by `renderCompletion`'s tally.
   */
  private async run(
    action: (controller: BulkReviewController) => Promise<readonly SettledRow[]>,
  ): Promise<void> {
    const controller = this.controller;
    if (controller === null) return;
    const previousIndex = this.focusedIndex();
    const resolved = await action(controller);
    this.settled = [...this.settled, ...resolved];
    await controller.load();
    const ids = this.pendingDraftIds();
    this.focusedDraft =
      previousIndex === null ? null : (ids[Math.min(previousIndex, ids.length - 1)] ?? null);
    this.render();
    if (this.focusedDraft !== null) this.rowElementFor(this.focusedDraft)?.focus();
  }

  /** The focused tier's index in `pendingDraftIds()` order — `null` when nothing is focused, which is what makes `run` above leave focus alone rather than seizing it. */
  private focusedIndex(): number | null {
    if (this.focusedDraft === null) return null;
    const index = this.pendingDraftIds().indexOf(this.focusedDraft);
    return index === -1 ? null : index;
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
      const resolvedAnything = this.settled.length > 0;
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

    // `[STY-6]`: exactly one row carries the focused tier, always. A draft
    // that has since resolved (or a first render, where nothing has been
    // focused yet) falls back to the top of the list rather than leaving the
    // whole list collapsed with nothing open.
    const pending = this.pendingDraftIds();
    if (this.focusedDraft === null || !pending.includes(this.focusedDraft)) {
      this.focusedDraft = pending[0] ?? null;
    }

    for (const group of vm.groups) {
      this.documents.set(group.sourcePath, {
        courseCode: group.courseCode,
        noteTitle: group.noteTitle,
        // `[D-214]` / `ol-ymew`: the source marker's own title and register
        // are the group's, not `noteTitle` above — see
        // `BulkReviewGroupViewModel`'s own doc for why the two diverge for
        // an authored-note origin.
        sourceMarker: sourceMarkerText(group.sourceMarkerNoteTitle, group.sourceMarkerOrigin),
      });
    }

    for (const [sourcePath, document] of this.documents) {
      const items = vm.groups.find((g) => g.sourcePath === sourcePath)?.items ?? [];
      // A document with neither pending drafts nor a history this sitting has
      // nothing to say; one she has finished clearing keeps its settled rows.
      if (items.length === 0 && !this.settled.some((row) => row.sourcePath === sourcePath)) {
        continue;
      }
      this.renderGroup(
        root,
        sourcePath,
        document.courseCode,
        document.noteTitle,
        document.sourceMarker,
        items,
      );
    }
  }

  /**
   * `[STY-6]`'s settled tier — the kit's `TriageSettled`: what she already
   * decided in this document, this sitting, dimmed and one line high, above
   * the rows still waiting. It is not a control and nothing here is
   * clickable: F3.3's "retained in full, never deleted" is what makes a
   * decision reversible, and it is reversible in the log rather than by a
   * button this list would have to invent. Absent entirely for a document
   * she has not touched yet, so an untouched list opens exactly as
   * `[STY-0e]` drew it.
   */
  private renderSettled(section: HTMLElement, sourcePath: string): void {
    const rows = this.settled.filter((row) => row.sourcePath === sourcePath);
    if (rows.length === 0) return;
    const list = section.createDiv({ cls: 'olea-bulk-review-settled' });
    for (const row of rows) {
      const settled = list.createDiv({ cls: 'olea-bulk-review-settled-row' });
      settled.createSpan({ cls: 'olea-bulk-review-settled-stem', text: row.stem });
      settled.createSpan({
        cls: `olea-bulk-review-settled-state olea-bulk-review-settled-state--${row.outcome}`,
        // The state a draft is now IN, in the vocabulary `ol-2x4` already
        // ruled for the receipt at the end of the same sitting — not
        // `[D-216]` clause 4's keep/fix/bin, which name an action she takes.
        text: row.outcome,
      });
    }
  }

  /**
   * `[STY-0e]`, re-based on `[STY-6]`'s settled list: what she resolved THIS
   * OPEN of the tab, by outcome — the receipt `bulkReviewCompletionTally`
   * renders once the list empties, and (per group) the header's own progress
   * slot. Derived rather than counted separately so the dimmed rows on
   * screen and the tally under them can never disagree. Reset only by a
   * fresh `onOpen` (a new controller, a new sitting); never persisted,
   * because it describes this sitting only, not a standing count of anything
   * (F6.7 — see `bulkReviewCompletionTally`'s own doc for why this is the
   * permitted category of count).
   */
  private tally(rows: readonly SettledRow[]): {
    accepted: number;
    edited: number;
    rejected: number;
  } {
    return {
      accepted: rows.filter((r) => r.outcome === 'accepted').length,
      edited: rows.filter((r) => r.outcome === 'edited').length,
      rejected: rows.filter((r) => r.outcome === 'rejected').length,
    };
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
      text: bulkReviewCompletionTally(this.tally(this.settled)),
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
    // A document with nothing left pending is no longer a GROUP of drafts
    // awaiting review — it is the record of one she finished. It carries its
    // own class so it reads (and can be counted) as what it is; the shared
    // header and settled-row classes below style both alike.
    const section = root.createDiv({
      cls: items.length === 0 ? 'olea-bulk-review-cleared' : 'olea-bulk-review-group',
    });
    // `[STY-6]`: the kit's `TriageHeader` — the document this sitting is
    // about, its course above it, and one statement of where its drafts
    // stand on the right. F3.3 makes the DOCUMENT the unit of this surface
    // ("clear a document's drafts in one sitting"), which is why the
    // identity belongs at the head of the group rather than only inside
    // each row's source marker.
    const header = section.createDiv({ cls: 'olea-bulk-review-group-header' });
    const identity = header.createDiv({ cls: 'olea-bulk-review-group-identity' });
    identity.createSpan({ cls: 'olea-bulk-review-group-course', text: courseCode });
    // `[STY-6]`: the kit stacks the course eyebrow above the document title,
    // so the inline dot that used to separate them on one line has nothing
    // left to separate and is gone with its rule.
    identity.createSpan({ cls: 'olea-bulk-review-group-note', text: noteTitle });

    const settledHere = this.settled.filter((row) => row.sourcePath === sourcePath);
    // `[STY-6]` / F6.7: what she has met and resolved, never a total and
    // never a remainder. Before she has resolved anything, F3.3's own
    // guarantee — acceptance is the only thing that moves a draft out of
    // the cache — stands in its place. The kit's `12 of 34` is not built:
    // see this class's module doc.
    header.createDiv({
      cls: 'olea-bulk-review-group-progress',
      text:
        settledHere.length === 0
          ? BULK_REVIEW_DECK_REASSURANCE
          : bulkReviewCompletionTally(this.tally(settledHere)),
    });

    // `[STY-6]`: a finished document keeps its header and its settled rows,
    // but the batch action has nothing left to resolve — absent, never shown
    // disabled, the same posture the source peek already holds.
    const remainderBtn =
      items.length === 0
        ? null
        : header.createEl('button', {
            cls: 'olea-bulk-review-remainder',
            text: 'Accept the rest',
          });
    if (remainderBtn !== null) {
      this.registerDomEvent(remainderBtn, 'click', () => {
        // `[STY-6]`: one call resolves many drafts, so the settled rows are
        // snapshotted from the view model BEFORE the call and then filtered
        // down to the ids that actually succeeded — `result.failed` stays
        // pending and is still in the list on the next render.
        const before = items.map((item) => ({ draftId: item.draftId, stem: item.stem }));
        void this.run(async (controller) => {
          const result = await controller.acceptRemainder(sourcePath);
          const accepted = new Set(result.accepted);
          return before
            .filter((item) => accepted.has(item.draftId))
            .map((item) => ({ sourcePath, stem: item.stem, outcome: 'accepted' as const }));
        });
      });
    }

    this.renderSettled(section, sourcePath);

    const list = section.createDiv({ cls: 'olea-bulk-review-items' });
    for (const item of items) {
      // `[D-216]`: `tabindex="0"` and the draft-id attribute make this row
      // a real keyboard focus stop, so `↓`/`K`/`F`/`B` (`handleKeydown`
      // above) can find and act on it — every row this view builds gets one,
      // never only the ones a click happens to land on.
      // `[STY-6]`: the tier is a class on an otherwise identical row —
      // every row's full content is always in the DOM and the density is
      // CSS, so moving the tier costs one class toggle and never a
      // re-render (this class's own module doc says why that matters).
      const focused = item.draftId === this.focusedDraft;
      const row = list.createDiv({
        cls: `olea-bulk-review-item ${
          focused ? 'olea-bulk-review-item--focused' : 'olea-bulk-review-item--pending'
        }`,
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
        void this.resolveOne(item.draftId, 'accepted', (controller) =>
          controller.accept(item.draftId),
        );
      });

      const editBtn = actions.createEl('button', {
        cls: 'olea-bulk-review-action olea-bulk-review-action--edit',
        text: 'Edit before saving',
      });
      this.registerDomEvent(editBtn, 'click', () => {
        void this.resolveOne(item.draftId, 'edited', (controller) =>
          controller.editBeforeSaving(item.draftId),
        );
      });

      const rejectBtn = actions.createEl('button', {
        cls: 'olea-bulk-review-action olea-bulk-review-action--reject',
        text: 'Reject',
      });
      this.registerDomEvent(rejectBtn, 'click', () => {
        void this.resolveOne(item.draftId, 'rejected', (controller) =>
          controller.reject(item.draftId),
        );
      });
    }
  }
}
