/**
 * `RegistryView` — F8.4's browsable concept-and-instrument registry
 * (`[REG-1]`, `ol-4v2l`, amended acceptance `[D-135]`).
 *
 * **Thin by design**, the same split `retrospective/view.ts`, `gap/view.ts`
 * and `today/view.ts` all draw: every fact shown here comes from
 * `olea-core`'s `RegistryModel` (`../../core/registry/build.ts`), and every
 * sentence comes from `./copy.ts`. This file is DOM only, and there is
 * deliberately no test for it — `obsidian` has no runtime outside a real
 * host, so `./copy.ts` (the words) and `../../core/registry/build.spec.ts` /
 * `../../core/registry/overrides.spec.ts` (the model and the rename/prune
 * transforms) carry the tested behaviour under Vitest instead.
 *
 * **No split, no merge, no lineage badge.** `[D-135]` scopes this view to
 * browse, per-concept mix and mastery, edit (delegated), rename and prune —
 * F8.6 defers split/merge post-v0.9 against the approved DSN-3 drawing, and
 * this file renders nothing that anticipates it: no "from ‹parent›" badge,
 * no split/merge button, no ghost affordance whose click would do nothing.
 * The same discipline `commands/register-commands.ts` states for "open
 * Olea" and "explain something back" before they had a destination.
 *
 * **Withdrawn concepts stay reachable, behind one filter chip, never hidden
 * by default into a second screen.** F8.5: nothing is deleted, and a
 * browsable inventory that silently drops withdrawn rows would read as
 * though they had been. The default (`All`) view hides them only to keep
 * the working list legible; the `Withdrawn` chip (`renderFilterChips`,
 * `RegistryFilter`) is one click away in the same chip row, not a separate
 * surface — this replaced a single "Show withdrawn concepts" checkbox
 * (`ol-l5og.18.1`, design-fidelity sweep against `docs/design/dsn3-registry/
 * registry-surface.html` frame 01) with `[D-135]`'s own chip set: All,
 * per-course, `Needs tending`, `Nothing built yet`, `Withdrawn`, each
 * carrying its own count.
 *
 * **The same bead collapsed the row to two levels**, matching frame 01
 * (closed: name, course tags, mastery pair, instrument-mix summary, one
 * `Open` action) opening into frame 02's full detail (rename, the
 * withdraw/restore action, source locations, the per-instrument list) —
 * `renderCompactRow` draws the first level always; `renderDetail` draws the
 * second only once `this.expanded` names the concept's key. Four sections
 * that are already standing, actionable facts rather than the "editing"
 * layer — `renderDuplicateTitle`, `renderThinNote`, `renderRenameProposal`,
 * `renderNoteOffer`, plus the display-only `aliasesLine`/`explainBackLine`
 * text — stay OUTSIDE that gate in `renderStandingFacts`, visible whether or
 * not the row is open: hiding a pending accept/decline behind an extra tap
 * would cost exactly the discoverability `[D-176]`'s and `[D-183]`'s own
 * clauses argue for. `[D-171]`'s one-step hand-off (`focusEntry`) expands the
 * target row itself, and resets an active filter that would otherwise hide
 * it, before scrolling — see that method's own doc.
 *
 * **F8.4b (`[D-175]`) adds one instrument-grain section: explain-back
 * history**, rendered by `renderExplainBackHistory` right on the same row
 * `[D-171]`'s one-step affordance already scrolls and highlights to — see
 * that method's own doc. No scoreboard: no total, no streak, and a
 * contested attempt shows its `[D-095]` re-review state in place rather
 * than being hidden or dropped.
 *
 * **`[D-183]` adds one more standing affordance: `renderRenameProposal`**,
 * a rank-gated rename proposal shown right where `renderNoteOffer` already
 * sits — the same accept/decline shape, reused rather than reinvented (this
 * bead's brief names that surface as the closest sibling). Present only
 * when `entry.renameProposal` is non-null; see
 * `../../core/registry/rename-proposal.ts` and `./provider.ts`'s own docs
 * for how that field is computed and the one thing (surviving a plugin
 * restart) it does not yet do. Its copy strings are declared LOCALLY in
 * this file rather than added to `./copy.ts` — that file sits outside
 * `ol-2zfj.58`'s `owns`, so this is a deliberate, flagged deviation from
 * "every sentence comes from `./copy.ts`" above, not a design choice; move
 * them there the moment that file's owner is free (Class A/B, self-ratified,
 * logged here for retroactive review).
 *
 * **`[D-203]` adds `renderDuplicateTitle`**, a row-header badge plus one
 * line, present whenever `entry.duplicateTitle` is set: two of her own
 * notes share this concept's title, the binder (`../../core/registry/
 * build.ts`) refuses to resolve which one it binds to, and this state names
 * both notes without offering a way to pick between them. No accept/decline
 * shape here — unlike the rename proposal and the note offer, there is
 * nothing for her to act on inside this view; the only thing that clears it
 * is renaming one of the notes in Obsidian, which the NEXT build reflects.
 * Its copy lives properly in `./copy.ts` (this bead owns that file, unlike
 * `[D-183]`'s bead above).
 *
 * **`[D-214]` adds `renderThinNote`**, the same badge-plus-line shape as
 * `renderDuplicateTitle` right above it, present whenever `entry.thinNote`
 * is set: the note she wrote and bound this concept to has too little
 * captured material to draft from yet (`../../core/registry/build.ts`'s
 * `thinNoteFor`). Mutually exclusive with the duplicate-title state by
 * construction. No affordance here touches the note — not even a link that
 * opens it — because the only thing that clears this state is her own next
 * edit, on her own time; its copy lives in `./copy.ts` too.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import {
  MASTERY_DISPLAY,
  type RegistryConceptEntry,
  type RegistryInstrumentSummary,
  type RegistryModel,
  type RegistrySourceLocation,
} from 'olea-core';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  aliasesLine,
  coursesLine,
  DUPLICATE_TITLE_LABEL,
  duplicateTitleLine,
  EDIT_INSTRUMENT_ACTION,
  EXPLAIN_BACK_HISTORY_HEADING,
  explainBackHistoryRowLine,
  explainBackLine,
  INSTRUMENTS_SECTION_HEADING,
  instrumentLabel,
  instrumentMixLine,
  NO_INSTRUMENTS_LINE,
  NOTE_OFFER_ACCEPT_ACTION,
  NOTE_OFFER_DECLINE_ACTION,
  NOTE_OFFER_LINE,
  NOTHING_BUILT_YET_LABEL,
  OPEN_SOURCE_LOCATION_ACTION,
  REGISTRY_ALL_FILTER_LABEL,
  REGISTRY_CLOSE_ACTION,
  REGISTRY_EMPTY_LINE,
  REGISTRY_FILTER_EMPTY_LINE,
  REGISTRY_NEEDS_TENDING_FILTER_LABEL,
  REGISTRY_NOTHING_BUILT_FILTER_LABEL,
  REGISTRY_OPEN_ACTION,
  REGISTRY_PUT_IT_BACK_ACTION,
  REGISTRY_UNAVAILABLE_LINE,
  REGISTRY_VIEW_TITLE,
  REGISTRY_WITHDRAWN_FILTER_LABEL,
  REGISTRY_WITHDRAWN_KEPT_LABEL,
  RENAME_ACTION,
  RESTORE_CONCEPT_ACTION,
  RESTORE_INSTRUMENT_ACTION,
  registryAggregateLine,
  SOURCE_LOCATIONS_HEADING,
  sourceLocationLabel,
  THIN_NOTE_LABEL,
  thinNoteLine,
  vitalityLabel,
  WITHDRAW_CONCEPT_ACTION,
  WITHDRAW_INSTRUMENT_ACTION,
  WITHDRAWN_LABEL,
  WITHDRAWN_NOTE,
} from './copy.js';

/**
 * The closed-row/open-detail split (`ol-l5og.18.1`, design-fidelity sweep against
 * `docs/design/dsn3-registry/registry-surface.html` frame 01/02, `[D-135]`) — one of five
 * possible reasons a row shows what it shows, kept as a discriminated union rather than a
 * `course: string | null` scattered across booleans so `matchesRegistryFilter` stays a single
 * exhaustive `switch`. `course` carries the exact course code a per-course chip was built for;
 * every other variant is a fixed fact about the concept.
 */
type RegistryFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'course'; readonly course: string }
  | { readonly kind: 'tending' }
  | { readonly kind: 'nothing-built' }
  | { readonly kind: 'withdrawn' };

function filtersEqual(a: RegistryFilter, b: RegistryFilter): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'course' && b.kind === 'course' ? a.course === b.course : true;
}

/** Every course code named by at least one concept, deduplicated and sorted — the per-course
 * chip set (frame 01). Computed fresh from the loaded model on every render rather than cached:
 * `RegistryModel` carries no course list of its own (`build.ts`'s own doc: "filtering by course
 * is a view concern, not a model concern"). */
function registryCourses(concepts: readonly RegistryConceptEntry[]): readonly string[] {
  return Array.from(new Set(concepts.flatMap((entry) => entry.courses))).sort();
}

function activeInstrumentCount(entry: RegistryConceptEntry): number {
  return entry.instruments.filter((instrument) => !instrument.pruned).length;
}

/** Whether `entry` belongs under `filter` — see `RegistryFilter`'s own doc for why `all`
 * excludes withdrawn concepts rather than including them the way the kit's frame 01 draws it. */
function matchesRegistryFilter(entry: RegistryConceptEntry, filter: RegistryFilter): boolean {
  switch (filter.kind) {
    case 'all':
      return !entry.pruned;
    case 'course':
      return !entry.pruned && entry.courses.includes(filter.course);
    case 'tending':
      return !entry.pruned && entry.vitality.value === 'tending';
    case 'nothing-built':
      return !entry.pruned && activeInstrumentCount(entry) === 0;
    case 'withdrawn':
      return entry.pruned;
  }
}

export const VIEW_TYPE_OLEA_REGISTRY = 'olea-registry';

/** `RegistryConceptEntry['renameProposal']`'s non-null shape — indexed access rather than a direct import, matching `./provider.ts`'s identical technique and doc for the identical reason (`RenameProposal`/`RenameProposalCandidate` are not exported from `olea-core`'s index, out of `ol-2zfj.58`'s `owns`). */
type RenameProposal = NonNullable<RegistryConceptEntry['renameProposal']>;

/**
 * `[D-183]`'s rename-proposal copy — LOCAL to this file, not `./copy.ts`
 * (see this file's module doc for why). States the fact and the evidence,
 * never a nudge — matching `NOTE_OFFER_LINE`'s own "never a claim about
 * why it changed" register one section up, and never printing the
 * `ConceptTier` number itself (R2: the internal ordering is never displayed
 * to her, only her own wording is).
 */
const RENAME_PROPOSAL_ACCEPT_ACTION = 'Use this wording';
const RENAME_PROPOSAL_DECLINE_ACTION = 'Keep the current wording';

/** States which source proposed the wording and, when known, where — never why the tiers are ordered the way they are (that is the contract's business, not a sentence she reads). */
function renameProposalLine(proposal: RenameProposal): string {
  const location = proposal.candidate.sourceLocation;
  const citation = location === undefined ? null : sourceLocationLabel(location);
  return citation === null
    ? `"${proposal.candidate.wording}" — a wording Olea found that may fit this concept better than "${proposal.currentDisplayName}".`
    : `"${proposal.candidate.wording}" — a wording Olea found in ${citation} that may fit this concept better than "${proposal.currentDisplayName}".`;
}

/**
 * `ol-l5og.14`: every interactive control the registry renders — every
 * button and every input — mirroring `review/view.ts`'s own
 * `data-olea-focusable`/`FOCUSABLE_ATTR` restore convention, but by tag
 * rather than a marker attribute: unlike that file's per-screen renders,
 * every control this view draws is already exactly a `<button>` or an
 * `<input>` (the rename field, every filter chip, `Open`/`Close`), so no
 * row render site needs a new attribute added to opt in.
 */
const FOCUSABLE_SELECTOR = 'button, input';

export type RegistryViewState =
  | { readonly kind: 'model'; readonly model: RegistryModel }
  | { readonly kind: 'unavailable' };

/** `[D-171]`'s one-step affordance target: which row to scroll/highlight to when a caller reveals the registry — see `./obsidian-ports.ts`'s `openRegistryEntryFor`. Exactly one of the two is set. */
export interface RegistryEntryTarget {
  readonly conceptKey?: string;
  readonly instrumentId?: string;
}

export interface RegistryViewDeps {
  readonly load: () => Promise<RegistryViewState>;
  readonly rename: (entry: RegistryConceptEntry, newDisplayName: string) => Promise<void>;
  readonly withdrawConcept: (entry: RegistryConceptEntry) => Promise<void>;
  readonly restoreConcept: (entry: RegistryConceptEntry) => Promise<void>;
  readonly withdrawInstrument: (instrument: RegistryInstrumentSummary) => Promise<void>;
  readonly restoreInstrument: (instrument: RegistryInstrumentSummary) => Promise<void>;
  readonly editInstrument: (instrument: RegistryInstrumentSummary) => Promise<void>;
  /** `[D-171]`'s click-through half — opens a source location at its known grain. */
  readonly openSourceLocation: (location: RegistrySourceLocation) => Promise<void>;
  /** F8.4a's `[D-176]` accept half — creates the new Zettelkasten note the offer promised. */
  readonly acceptNoteOffer: (entry: RegistryConceptEntry) => Promise<void>;
  /** `[D-183]`'s accept half — adopts the candidate wording, demoting the frozen current one to an alias via the existing rename mechanism (`./provider.ts`'s `acceptRenameProposal`). */
  readonly acceptRenameProposal: (
    entry: RegistryConceptEntry,
    proposal: RenameProposal,
  ) => Promise<void>;
  /** `[D-183]`'s decline half — records that this exact source-and-wording pair should not propose again (session-scoped today; see `./provider.ts`'s module doc). */
  readonly declineRenameProposal: (
    entry: RegistryConceptEntry,
    proposal: RenameProposal,
  ) => Promise<void>;
}

export class RegistryView extends ItemView {
  private readonly deps: RegistryViewDeps;
  /** The active chip (`RegistryFilter`) — `all` on first render, same default the retired
   * "Show withdrawn concepts" checkbox drew. */
  private filter: RegistryFilter = { kind: 'all' };
  /** Concept keys whose detail panel (frame 02) is open — `renderConcept` reads this to decide
   * whether to draw `renderDetail` below the always-drawn `renderCompactRow`. Persists across a
   * `refresh()` so a rename/withdraw/edit round-trip does not silently re-collapse the row she
   * was just looking at. */
  private readonly expanded = new Set<string>();
  /** The last state `render()` drew, so a pure UI action (toggling a filter or a row's open
   * state) can redraw without a real `deps.load()` round-trip — mirrors `RegistryEntryTarget`'s
   * own need to inspect the loaded model in `focusEntry` below. `null` until the first
   * `refresh()` completes. */
  private lastState: RegistryViewState | null = null;
  /**
   * `ol-l5og.14`'s aria-live confirmation — a single stable node, created
   * once in `onOpen` as a sibling of `contentEl` rather than inside it, so
   * `render()`'s `root.empty()` never tears it down between refreshes (an
   * aria-live region has to stay put for a text change inside it to be the
   * thing announced). Visually hidden: this is an announcement channel for
   * assistive tech, not a second copy of the row's own visible text.
   */
  private liveRegion!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, deps: RegistryViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_REGISTRY;
  }

  override getDisplayText(): string {
    return REGISTRY_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'library';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-registry-root');
    this.liveRegion = this.containerEl.createDiv({
      cls: 'olea-registry-live-region',
      attr: { 'aria-live': 'polite', 'aria-atomic': 'true' },
    });
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-reads and redraws — public so a rename/prune/edit round-trip, or her material changing, can be reflected without closing the tab (same convention `GapView.refresh`/`RetrospectiveView.refresh` already set). */
  async refresh(): Promise<void> {
    const state = await this.deps.load();
    this.render(state);
  }

  /**
   * `ol-l5og.14`'s aria-live confirmation — announces `text` (an EXISTING
   * copy string this view already shows somewhere, never new wording coined
   * for the announcement alone) by writing it into `liveRegion`. Only wired
   * for withdraw so far (`WITHDRAWN_NOTE`/`WITHDRAWN_LABEL`, both already
   * rendered on the row) — rename and restore have no existing copy string
   * that states completion ("Renamed" / "Restored"), so no announcement is
   * added for either; that needs new, ratified copy, which is a clause this
   * bead does not have.
   */
  private announce(text: string): void {
    this.liveRegion.setText(text);
  }

  private focusableControls(): HTMLElement[] {
    return Array.from(this.contentEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  /** The concept a given instrument id belongs to, read from `lastState` — used only by
   * `focusEntry` below to know which row to expand for an instrument-grain hand-off target. */
  private conceptOwning(instrumentId: string): RegistryConceptEntry | null {
    if (this.lastState === null || this.lastState.kind !== 'model') return null;
    return (
      this.lastState.model.concepts.find((entry) =>
        entry.instruments.some((instrument) => instrument.instrumentId === instrumentId),
      ) ?? null
    );
  }

  private conceptByKey(key: string): RegistryConceptEntry | null {
    if (this.lastState === null || this.lastState.kind !== 'model') return null;
    return this.lastState.model.concepts.find((entry) => entry.key === key) ?? null;
  }

  /**
   * `[D-171]`'s one-step affordance landing: scroll to and briefly highlight
   * the row `target` names. Public and separate from `refresh()` so
   * `./obsidian-ports.ts`'s `openRegistryEntryFor` can call `refresh()` then
   * this, rather than folding a target into `render()`'s own state and
   * risking a stale highlight surviving past the row it was for.
   *
   * **`ol-l5og.18.1` adds two pre-conditions the two-level browse/detail split
   * introduced**: the target's row must be OPEN for an instrument-grain
   * target to exist in the DOM at all (an instrument only ever renders inside
   * `renderDetail`), and the target's concept must pass the ACTIVE filter or
   * the compact row itself is never drawn. Both are corrected here, before
   * the scroll/highlight below, rather than leaving the hand-off silently
   * land on nothing — the same reachability guarantee this method already
   * carried, just extended to cover state this bead's own UI change added.
   */
  focusEntry(target: RegistryEntryTarget): void {
    const owner =
      target.conceptKey !== undefined
        ? this.conceptByKey(target.conceptKey)
        : target.instrumentId !== undefined
          ? this.conceptOwning(target.instrumentId)
          : null;

    let needsRedraw = false;
    if (owner !== null) {
      if (!this.expanded.has(owner.key)) {
        this.expanded.add(owner.key);
        needsRedraw = true;
      }
      if (!matchesRegistryFilter(owner, this.filter)) {
        this.filter = { kind: 'all' };
        needsRedraw = true;
      }
    }
    if (needsRedraw && this.lastState !== null) this.render(this.lastState);

    const selector = target.instrumentId
      ? `[data-olea-instrument-id="${CSS.escape(target.instrumentId)}"]`
      : target.conceptKey
        ? `[data-olea-concept-key="${CSS.escape(target.conceptKey)}"]`
        : null;
    if (selector === null) return;
    const el = this.contentEl.querySelector<HTMLElement>(selector);
    if (el === null) return;
    el.scrollIntoView({ block: 'center' });
    el.addClass('olea-registry-focused');
    setTimeout(() => el.removeClass('olea-registry-focused'), 2000);
  }

  /** Redraws from the last loaded state — for a pure UI action (a filter chip, an `Open`/`Close`
   * toggle) that changes nothing `deps.load()` would re-fetch, so a full round-trip would only
   * add latency and risk racing a concurrent mutation's own `refresh()`. No-op before the first
   * `refresh()` completes (`lastState` is still `null`). */
  private rerender(): void {
    if (this.lastState !== null) this.render(this.lastState);
  }

  /**
   * `ol-l5og.14`: focus is not restored to a sensible element after this
   * view refreshes (e.g. after an accept/withdraw/restore action), which
   * strands keyboard focus outside the view entirely once `root.empty()`
   * below discards whatever held it. Mirrors `review/view.ts`'s own
   * `render()` — capture whether focus was somewhere inside this view
   * BEFORE emptying it, and if so, focus the first focusable control after
   * redrawing, at every exit path (`review/view.ts` restores at its
   * `renderUnavailable`-equivalent early return and again at the end; this
   * view's two early returns — unavailable, empty — and its normal
   * fall-through all do the same here).
   */
  private render(state: RegistryViewState): void {
    const root = this.contentEl;
    const hadFocus = root.contains(root.ownerDocument.activeElement);
    root.empty();
    this.lastState = state;

    if (state.kind === 'unavailable') {
      root.createDiv({ cls: 'olea-registry-unavailable', text: REGISTRY_UNAVAILABLE_LINE });
      if (hadFocus) this.focusableControls()[0]?.focus();
      return;
    }

    root.createEl('h2', { text: REGISTRY_VIEW_TITLE });

    const concepts = state.model.concepts;

    if (concepts.length === 0) {
      root.createDiv({ cls: 'olea-registry-empty', text: REGISTRY_EMPTY_LINE });
      if (hadFocus) this.focusableControls()[0]?.focus();
      return;
    }

    root.createDiv({
      cls: 'olea-registry-summary',
      text: registryAggregateLine(concepts.length, registryCourses(concepts).length),
    });

    this.renderFilterChips(root, concepts);

    const visible = concepts.filter((entry) => matchesRegistryFilter(entry, this.filter));

    if (visible.length === 0) {
      root.createDiv({ cls: 'olea-registry-empty', text: REGISTRY_FILTER_EMPTY_LINE });
      if (hadFocus) this.focusableControls()[0]?.focus();
      return;
    }

    const list = root.createDiv({ cls: 'olea-registry-list' });
    for (const entry of visible) this.renderConcept(list, entry);

    if (hadFocus) this.focusableControls()[0]?.focus();
  }

  /**
   * Frame 01's chip bar — All, one per course, `Needs tending`, `Nothing built yet`,
   * `Withdrawn` — each carrying its own count computed over the WHOLE inventory (`concepts`),
   * never the currently-filtered subset, so switching chips never changes another chip's number.
   * Single-select: clicking a chip replaces `this.filter` outright, matching frame 01's own
   * mutually-exclusive `chip.on` reading (only one chip carries the `on` class in the kit).
   */
  private renderFilterChips(root: HTMLElement, concepts: readonly RegistryConceptEntry[]): void {
    const chips = root.createDiv({ cls: 'olea-registry-chips' });

    const addChip = (filter: RegistryFilter, label: string, count: number): void => {
      const chip = chips.createEl('button', { cls: 'olea-registry-chip' });
      if (filtersEqual(filter, this.filter)) chip.addClass('olea-registry-chip-on');
      chip.createSpan({ text: label });
      chip.createSpan({ cls: 'olea-registry-chip-count', text: String(count) });
      chip.addEventListener('click', () => {
        this.filter = filter;
        // A real `deps.load()` round-trip, same as the retired "Show withdrawn concepts"
        // checkbox's own `change` handler — a filter switch is a plausible moment for her
        // material to have changed too, and this keeps `refresh()` the one place a stale
        // model could go unnoticed for. `focusEntry`'s own filter correction below is the
        // one place a cheap synchronous `rerender()` is used instead, because it runs right
        // after a caller's own fresh `refresh()`.
        void this.refresh();
      });
    };

    addChip({ kind: 'all' }, REGISTRY_ALL_FILTER_LABEL, concepts.filter((e) => !e.pruned).length);
    for (const course of registryCourses(concepts)) {
      addChip(
        { kind: 'course', course },
        course,
        concepts.filter((e) => !e.pruned && e.courses.includes(course)).length,
      );
    }
    addChip(
      { kind: 'tending' },
      REGISTRY_NEEDS_TENDING_FILTER_LABEL,
      concepts.filter((e) => !e.pruned && e.vitality.value === 'tending').length,
    );
    addChip(
      { kind: 'nothing-built' },
      REGISTRY_NOTHING_BUILT_FILTER_LABEL,
      concepts.filter((e) => !e.pruned && activeInstrumentCount(e) === 0).length,
    );
    addChip(
      { kind: 'withdrawn' },
      REGISTRY_WITHDRAWN_FILTER_LABEL,
      concepts.filter((e) => e.pruned).length,
    );
  }

  private renderConcept(root: HTMLElement, entry: RegistryConceptEntry): void {
    const row = root.createDiv({ cls: 'olea-registry-row' });
    row.dataset.oleaConceptKey = entry.key;
    if (entry.pruned) row.addClass('olea-registry-row-withdrawn');

    this.renderCompactRow(row, entry);
    this.renderStandingFacts(row, entry);

    if (this.expanded.has(entry.key)) {
      const detail = row.createDiv({ cls: 'olea-registry-detail' });
      this.renderActions(detail, entry);
      this.renderSourceLocations(detail, entry.sourceLocations);
      this.renderInstruments(detail, entry);
    }
  }

  /**
   * Frame 01's closed row: name (plus its state badges), course tags, the mastery pair as a
   * sprig icon beside its stage/vitality words (the sweep's "mastery icon" fix — `render-sprig.ts`
   * is the same mark `today/view.ts` already draws, reused rather than a second glyph), the
   * instrument-mix one-liner (`instrumentMixLine`), and one action: `Open`/`Close` toggles
   * `this.expanded`; a withdrawn row also gets `Put it back` right here, matching frame 04's own
   * "the way back is on the row" note rather than making her open the row first to find it.
   */
  private renderCompactRow(root: HTMLElement, entry: RegistryConceptEntry): void {
    const compact = root.createDiv({ cls: 'olea-registry-row-compact' });

    const nameCell = compact.createDiv({ cls: 'olea-registry-row-name' });
    const nameLine = nameCell.createDiv({ cls: 'olea-registry-row-name-line' });
    nameLine.createEl('h3', { text: entry.displayName });
    if (entry.pruned) {
      nameLine.createEl('span', { cls: 'olea-registry-withdrawn-badge', text: WITHDRAWN_LABEL });
    }
    if (entry.duplicateTitle !== undefined) {
      nameLine.createEl('span', {
        cls: 'olea-registry-duplicate-title-badge',
        text: DUPLICATE_TITLE_LABEL,
      });
    }
    if (entry.thinNote !== undefined) {
      nameLine.createEl('span', {
        cls: 'olea-registry-thin-note-badge',
        text: THIN_NOTE_LABEL,
      });
    }
    nameCell.createDiv({ cls: 'olea-registry-courses', text: coursesLine(entry.courses) });

    const masteryCell = compact.createDiv({ cls: 'olea-registry-row-mastery' });
    masteryCell.appendChild(
      renderSprig({ state: entry.mastery.state, size: 16, container: masteryCell }),
    );
    const masteryText = masteryCell.createDiv({ cls: 'olea-registry-row-mastery-text' });
    masteryText.createSpan({
      cls: 'olea-registry-row-mastery-stage',
      text: MASTERY_DISPLAY[entry.mastery.state].label,
    });
    const vitalitySpan = masteryText.createSpan({
      cls: 'olea-registry-row-mastery-vitality',
      text: vitalityLabel(entry.vitality.value),
    });
    if (entry.vitality.value === 'tending') vitalitySpan.addClass('is-tending');

    const mixCell = compact.createDiv({ cls: 'olea-registry-row-mix' });
    const mixText = entry.pruned
      ? REGISTRY_WITHDRAWN_KEPT_LABEL
      : instrumentMixLine(entry.instruments);
    mixCell.setText(mixText);
    if (entry.pruned || mixText === NOTHING_BUILT_YET_LABEL) {
      mixCell.addClass('olea-registry-row-mix-quiet');
    }

    const actionCell = compact.createDiv({ cls: 'olea-registry-row-action' });
    const isOpen = this.expanded.has(entry.key);
    const openButton = actionCell.createEl('button', {
      text: isOpen ? REGISTRY_CLOSE_ACTION : REGISTRY_OPEN_ACTION,
    });
    openButton.addEventListener('click', () => {
      if (this.expanded.has(entry.key)) this.expanded.delete(entry.key);
      else this.expanded.add(entry.key);
      this.rerender();
    });
    if (entry.pruned) {
      const restoreButton = actionCell.createEl('button', {
        cls: 'olea-registry-row-restore',
        text: REGISTRY_PUT_IT_BACK_ACTION,
      });
      restoreButton.addEventListener('click', () => {
        void this.deps.restoreConcept(entry).then(() => this.refresh());
      });
    }
  }

  /**
   * Facts and standing accept/decline affordances that stay visible whether or not the row is
   * open — see this file's module doc for why these four (plus the display-only alias/
   * explain-back lines) sit outside `renderDetail`'s gate.
   */
  private renderStandingFacts(root: HTMLElement, entry: RegistryConceptEntry): void {
    this.renderDuplicateTitle(root, entry);
    this.renderThinNote(root, entry);

    const aliases = aliasesLine(entry.aliases);
    if (aliases !== null) root.createDiv({ cls: 'olea-registry-aliases', text: aliases });

    const explainBack = explainBackLine(entry.explainBack);
    if (explainBack !== null) {
      root.createDiv({ cls: 'olea-registry-explain-back', text: explainBack });
    }

    if (entry.pruned) {
      root.createDiv({ cls: 'olea-registry-withdrawn-note', text: WITHDRAWN_NOTE });
    }

    this.renderRenameProposal(root, entry);
    this.renderNoteOffer(root, entry);
  }

  /**
   * `[D-203]`'s duplicate-title state — the badge (in `renderCompactRow`'s
   * name line, mirroring `WITHDRAWN_LABEL`'s own badge shape) plus this one
   * line naming the two notes and what would clear it. **No chooser is
   * rendered anywhere here**: no button, no dropdown, no way to pick between
   * `entry.duplicateTitle.notePaths` — the binder's refusal (`../../core/
   * registry/build.ts`'s `duplicateTitleFor`, an unmodified read of
   * `ConceptRecord.ambiguousNotePaths`) stands exactly as it is, matching the
   * ratified clause's own "nothing is chosen for her". Rendered by
   * `renderStandingFacts`, so it stays visible whether or not the row is
   * open — the same reasoning as `renderRenameProposal`/`renderNoteOffer`.
   */
  private renderDuplicateTitle(root: HTMLElement, entry: RegistryConceptEntry): void {
    const duplicateTitle = entry.duplicateTitle;
    if (duplicateTitle === undefined) return;
    root.createDiv({
      cls: 'olea-registry-duplicate-title',
      text: duplicateTitleLine(duplicateTitle.notePaths),
    });
  }

  /**
   * `[D-214]`'s thin-note structural-reason state (`ol-2zfj.61`) — the badge
   * (in `renderCompactRow`'s name line, mirroring `WITHDRAWN_LABEL`'s/
   * `DUPLICATE_TITLE_LABEL`'s own badge shape) plus this one line stating the
   * measured word count and what would clear it. **No affordance that edits
   * her note anywhere here**: no button, no "open note" link, nothing that
   * touches the note itself — the only thing that clears this state is her
   * writing more into it in Obsidian, on her own, which the NEXT build
   * reflects (`../../core/registry/build.ts`'s `thinNoteFor`). Mutually
   * exclusive with `entry.duplicateTitle` by construction (see that field's
   * own doc), so both never render for the same row. Rendered by
   * `renderStandingFacts` right beside `renderDuplicateTitle`, staying
   * visible whether or not the row is open, for the same reason that section
   * gives.
   */
  private renderThinNote(root: HTMLElement, entry: RegistryConceptEntry): void {
    const thinNote = entry.thinNote;
    if (thinNote === undefined) return;
    root.createDiv({
      cls: 'olea-registry-thin-note',
      text: thinNoteLine(thinNote.wordCount),
    });
  }

  /**
   * `[D-183]`'s rank-gated rename proposal — never a silent rewrite. Present
   * only when `entry.renameProposal` is non-null (`./provider.ts` computes
   * it; `../../core/registry/rename-proposal.ts` is the tested decision
   * function it mirrors). Routed through the same accept/decline shape as
   * `renderNoteOffer` right below, per this bead's brief naming that surface
   * as the closest sibling — one line stating the fact and its evidence, one
   * accept, one decline, no urgency language.
   *
   * **Decline is NOT purely local here, unlike `renderNoteOffer`'s.**
   * `[D-176]`'s note-offer states no re-offer condition, so that decline
   * only ever removes the section from THIS render. `[D-183]`'s own ruling
   * is explicit that "a declined proposal does not fire again for the same
   * source and wording" — so declining here also calls
   * `deps.declineRenameProposal` (session-scoped memory in `./provider.ts`)
   * before removing the section, rather than only removing it.
   */
  private renderRenameProposal(root: HTMLElement, entry: RegistryConceptEntry): void {
    const proposal = entry.renameProposal;
    if (proposal === null || proposal === undefined) return;

    const section = root.createDiv({ cls: 'olea-registry-rename-proposal' });
    section.createEl('p', { text: renameProposalLine(proposal) });

    const acceptButton = section.createEl('button', { text: RENAME_PROPOSAL_ACCEPT_ACTION });
    acceptButton.addEventListener('click', () => {
      void this.deps.acceptRenameProposal(entry, proposal).then(() => this.refresh());
    });

    const declineButton = section.createEl('button', { text: RENAME_PROPOSAL_DECLINE_ACTION });
    declineButton.addEventListener('click', () => {
      void this.deps.declineRenameProposal(entry, proposal).then(() => section.remove());
    });
  }

  /**
   * F8.4a's `[D-176]` standing note-offer affordance — "the offer lives on
   * the concept's own view, never a queue or notification" is exactly why
   * this renders inline on the concept row rather than anywhere else.
   *
   * **Gated on `entry.noteOffer.eligible` AND `tier !== 1`.**
   * `../../core/registry/build.ts`'s `noteOfferFor` already reads `false`
   * unconditionally for a tier-1 concept (it already has an authored note —
   * offering to create a second one makes no sense), so the `tier !== 1`
   * check here is redundant with the model today; it stays as an explicit
   * belt-and-braces surface-level gate rather than trusting a single
   * upstream computation to be the only thing standing between an authored
   * concept and an offer that would make no sense for it.
   *
   * **Decline is local and mechanical, never a port call.** `[D-176]`'s own
   * words: declining "creates nothing, records nothing," and states no
   * re-offer condition — there is nothing to persist, so "Not now" simply
   * removes this section from the current render; nothing is saved, and the
   * offer is free to appear again on a later refresh (unspecified either
   * way, per the clause).
   */
  private renderNoteOffer(root: HTMLElement, entry: RegistryConceptEntry): void {
    if (entry.tier === 1 || !entry.noteOffer.eligible) return;

    const section = root.createDiv({ cls: 'olea-registry-note-offer' });
    section.createEl('p', { text: NOTE_OFFER_LINE });

    const acceptButton = section.createEl('button', { text: NOTE_OFFER_ACCEPT_ACTION });
    acceptButton.addEventListener('click', () => {
      void this.deps.acceptNoteOffer(entry).then(() => this.refresh());
    });

    const declineButton = section.createEl('button', { text: NOTE_OFFER_DECLINE_ACTION });
    declineButton.addEventListener('click', () => {
      section.remove();
    });
  }

  /**
   * `[D-171]`: the vault location(s) a concept or instrument was derived
   * from, each opening at its known grain — always a place to go, and now
   * (`ol-2zfj.25`) labelled with that grain too via `./copy.js`'s
   * `sourceLocationLabel`, rather than note name and heading alone.
   */
  private renderSourceLocations(
    root: HTMLElement,
    locations: readonly RegistrySourceLocation[],
  ): void {
    if (locations.length === 0) return;
    const section = root.createDiv({ cls: 'olea-registry-source-locations' });
    section.createEl('h4', { text: SOURCE_LOCATIONS_HEADING });
    const list = section.createEl('ul');
    for (const location of locations) {
      const item = list.createEl('li');
      const button = item.createEl('button', { text: sourceLocationLabel(location) });
      button.addEventListener('click', () => {
        void this.deps.openSourceLocation(location);
      });
    }
  }

  /**
   * F8.4b (`[D-175]`): an instrument's explain-back history, rendered right
   * on its registry row — the same row `[D-171]`'s `openRegistryEntryFor`
   * (`./obsidian-ports.ts`) already scrolls and highlights via
   * `focusEntry`'s `data-olea-instrument-id` selector, so the explain-back
   * modal's existing "See in registry" affordance lands here with history
   * already visible, no second call needed. Omitted entirely when empty —
   * matching `explainBackLine`'s own convention at the concept grain, since
   * "never attempted" is the common case for a plain qa/cloze/mcq card and
   * an explicit "not explained back yet" note on every such row would be
   * noise, not information. Oldest first, exactly the order `./copy.js`'s
   * `explainBackHistoryRowLine` and the underlying projection both use —
   * never re-sorted here.
   */
  private renderExplainBackHistory(
    root: HTMLElement,
    history: RegistryInstrumentSummary['explainBackHistory'],
  ): void {
    if (history.length === 0) return;
    const section = root.createDiv({ cls: 'olea-registry-explain-back-history' });
    section.createEl('h5', { text: EXPLAIN_BACK_HISTORY_HEADING });
    const list = section.createEl('ul');
    for (const row of history) {
      const item = list.createEl('li', { text: explainBackHistoryRowLine(row) });
      if (row.contested) item.addClass('olea-registry-explain-back-contested');
    }
  }

  private renderActions(root: HTMLElement, entry: RegistryConceptEntry): void {
    const actions = root.createDiv({ cls: 'olea-registry-concept-actions' });

    const renameInput = actions.createEl('input', {
      type: 'text',
      cls: 'olea-registry-rename-input',
      value: entry.displayName,
      attr: { 'aria-label': RENAME_ACTION },
    });
    const renameButton = actions.createEl('button', { text: RENAME_ACTION });
    renameButton.addEventListener('click', () => {
      void this.deps.rename(entry, renameInput.value).then(() => this.refresh());
    });

    const withdrawButton = actions.createEl('button', {
      text: entry.pruned ? RESTORE_CONCEPT_ACTION : WITHDRAW_CONCEPT_ACTION,
    });
    withdrawButton.addEventListener('click', () => {
      // `ol-l5og.14`'s aria-live confirmation: only the withdraw direction
      // has an existing copy string that states completion (`WITHDRAWN_NOTE`,
      // already rendered on the row above once `entry.pruned` is true) — see
      // `announce`'s own doc for why restore is not announced here.
      const wasPruned = entry.pruned;
      const action = entry.pruned
        ? this.deps.restoreConcept(entry)
        : this.deps.withdrawConcept(entry);
      void action.then(() => {
        void this.refresh();
        if (!wasPruned) this.announce(WITHDRAWN_NOTE);
      });
    });
  }

  private renderInstruments(root: HTMLElement, entry: RegistryConceptEntry): void {
    const section = root.createDiv({ cls: 'olea-registry-instruments' });
    section.createEl('h4', { text: INSTRUMENTS_SECTION_HEADING });

    if (entry.instruments.length === 0) {
      section.createDiv({ cls: 'olea-registry-no-instruments', text: NO_INSTRUMENTS_LINE });
      return;
    }

    const list = section.createEl('ul');
    for (const instrument of entry.instruments) {
      const item = list.createEl('li', { cls: 'olea-registry-instrument-row' });
      item.dataset.oleaInstrumentId = instrument.instrumentId;
      if (instrument.pruned) item.addClass('olea-registry-instrument-withdrawn');

      const label = instrument.heading
        ? `${instrumentLabel(instrument.instrumentType)} — ${instrument.noteTitle} (${instrument.heading})`
        : `${instrumentLabel(instrument.instrumentType)} — ${instrument.noteTitle}`;
      item.createSpan({ text: label });
      if (instrument.pruned) {
        item.createSpan({ cls: 'olea-registry-withdrawn-badge', text: ` ${WITHDRAWN_LABEL}` });
      }

      this.renderExplainBackHistory(item, instrument.explainBackHistory);

      const editButton = item.createEl('button', { text: EDIT_INSTRUMENT_ACTION });
      editButton.addEventListener('click', () => {
        void this.deps.editInstrument(instrument);
      });

      for (const location of instrument.sourceLocations) {
        const openButton = item.createEl('button', {
          text: OPEN_SOURCE_LOCATION_ACTION,
          // Every button in this loop shares the same visible text, which
          // collapses to one indistinguishable accessible name when an
          // instrument has more than one source location (`sourceLocations`
          // is `readonly RegistrySourceLocation[]`, `../../core/registry/types.ts`).
          // `sourceLocationLabel` — already used verbatim as the concept-level
          // button's own text a few lines up in `renderSourceLocations` — says
          // which location this one opens without adding any new copy.
          attr: {
            'aria-label': `${OPEN_SOURCE_LOCATION_ACTION}: ${sourceLocationLabel(location)}`,
          },
        });
        openButton.addEventListener('click', () => {
          void this.deps.openSourceLocation(location);
        });
      }

      const withdrawButton = item.createEl('button', {
        text: instrument.pruned ? RESTORE_INSTRUMENT_ACTION : WITHDRAW_INSTRUMENT_ACTION,
      });
      withdrawButton.addEventListener('click', () => {
        // `ol-l5og.14`: same withdraw-only announcement as the concept-grain
        // action above, reusing `WITHDRAWN_LABEL` (already rendered as this
        // row's badge once `instrument.pruned` is true) — no new copy coined.
        const wasPruned = instrument.pruned;
        const action = instrument.pruned
          ? this.deps.restoreInstrument(instrument)
          : this.deps.withdrawInstrument(instrument);
        void action.then(() => {
          void this.refresh();
          if (!wasPruned) this.announce(WITHDRAWN_LABEL);
        });
      });
    }
  }
}
