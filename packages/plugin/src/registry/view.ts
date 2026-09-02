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
 * **Withdrawn concepts stay visible, behind one toggle, never hidden by
 * default into a second screen.** F8.5: nothing is deleted, and a browsable
 * inventory that silently drops withdrawn rows would read as though they
 * had been. The default view hides them only to keep the working list
 * legible; the toggle is one click away, not a separate surface.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import {
  MASTERY_DISPLAY,
  type RegistryConceptEntry,
  type RegistryInstrumentSummary,
  type RegistryModel,
  type RegistrySourceLocation,
} from 'olea-core';
import {
  aliasesLine,
  coursesLine,
  EDIT_INSTRUMENT_ACTION,
  explainBackLine,
  INSTRUMENTS_SECTION_HEADING,
  instrumentLabel,
  masteryStatedLine,
  NO_INSTRUMENTS_LINE,
  OPEN_SOURCE_LOCATION_ACTION,
  REGISTRY_EMPTY_LINE,
  REGISTRY_UNAVAILABLE_LINE,
  REGISTRY_VIEW_TITLE,
  RENAME_ACTION,
  RESTORE_CONCEPT_ACTION,
  RESTORE_INSTRUMENT_ACTION,
  SHOW_WITHDRAWN_LABEL,
  SOURCE_LOCATIONS_HEADING,
  sourceLocationLabel,
  WITHDRAW_CONCEPT_ACTION,
  WITHDRAW_INSTRUMENT_ACTION,
  WITHDRAWN_LABEL,
  WITHDRAWN_NOTE,
} from './copy.js';

export const VIEW_TYPE_OLEA_REGISTRY = 'olea-registry';

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
}

export class RegistryView extends ItemView {
  private readonly deps: RegistryViewDeps;
  private showWithdrawn = false;

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
   * `[D-171]`'s one-step affordance landing: scroll to and briefly highlight
   * the row `target` names. Public and separate from `refresh()` so
   * `./obsidian-ports.ts`'s `openRegistryEntryFor` can call `refresh()` then
   * this, rather than folding a target into `render()`'s own state and
   * risking a stale highlight surviving past the row it was for.
   */
  focusEntry(target: RegistryEntryTarget): void {
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

  private render(state: RegistryViewState): void {
    const root = this.contentEl;
    root.empty();

    if (state.kind === 'unavailable') {
      root.createDiv({ cls: 'olea-registry-unavailable', text: REGISTRY_UNAVAILABLE_LINE });
      return;
    }

    root.createEl('h2', { text: REGISTRY_VIEW_TITLE });

    const toggleRow = root.createDiv({ cls: 'olea-registry-toggle-row' });
    const toggleLabel = toggleRow.createEl('label');
    const toggleInput = toggleLabel.createEl('input', { type: 'checkbox' });
    toggleInput.checked = this.showWithdrawn;
    toggleLabel.appendText(` ${SHOW_WITHDRAWN_LABEL}`);
    toggleInput.addEventListener('change', () => {
      this.showWithdrawn = toggleInput.checked;
      void this.refresh();
    });

    const visible = state.model.concepts.filter((entry) => this.showWithdrawn || !entry.pruned);

    if (visible.length === 0) {
      root.createDiv({ cls: 'olea-registry-empty', text: REGISTRY_EMPTY_LINE });
      return;
    }

    const list = root.createDiv({ cls: 'olea-registry-list' });
    for (const entry of visible) this.renderConcept(list, entry);
  }

  private renderConcept(root: HTMLElement, entry: RegistryConceptEntry): void {
    const row = root.createDiv({ cls: 'olea-registry-row' });
    row.dataset.oleaConceptKey = entry.key;
    if (entry.pruned) row.addClass('olea-registry-row-withdrawn');

    const header = row.createDiv({ cls: 'olea-registry-row-header' });
    header.createEl('h3', { text: entry.displayName });
    if (entry.pruned) {
      header.createEl('span', { cls: 'olea-registry-withdrawn-badge', text: WITHDRAWN_LABEL });
    }

    row.createDiv({ cls: 'olea-registry-courses', text: coursesLine(entry.courses) });

    const aliases = aliasesLine(entry.aliases);
    if (aliases !== null) row.createDiv({ cls: 'olea-registry-aliases', text: aliases });

    row.createDiv({
      cls: 'olea-registry-mastery',
      text: masteryStatedLine(MASTERY_DISPLAY[entry.mastery.state].label, entry.vitality),
    });

    const explainBack = explainBackLine(entry.explainBack);
    if (explainBack !== null) {
      row.createDiv({ cls: 'olea-registry-explain-back', text: explainBack });
    }

    if (entry.pruned) {
      row.createDiv({ cls: 'olea-registry-withdrawn-note', text: WITHDRAWN_NOTE });
    }

    this.renderActions(row, entry);
    this.renderSourceLocations(row, entry.sourceLocations);
    this.renderInstruments(row, entry);
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

  private renderActions(root: HTMLElement, entry: RegistryConceptEntry): void {
    const actions = root.createDiv({ cls: 'olea-registry-concept-actions' });

    const renameInput = actions.createEl('input', {
      type: 'text',
      cls: 'olea-registry-rename-input',
      value: entry.displayName,
    });
    const renameButton = actions.createEl('button', { text: RENAME_ACTION });
    renameButton.addEventListener('click', () => {
      void this.deps.rename(entry, renameInput.value).then(() => this.refresh());
    });

    const withdrawButton = actions.createEl('button', {
      text: entry.pruned ? RESTORE_CONCEPT_ACTION : WITHDRAW_CONCEPT_ACTION,
    });
    withdrawButton.addEventListener('click', () => {
      const action = entry.pruned
        ? this.deps.restoreConcept(entry)
        : this.deps.withdrawConcept(entry);
      void action.then(() => this.refresh());
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

      const editButton = item.createEl('button', { text: EDIT_INSTRUMENT_ACTION });
      editButton.addEventListener('click', () => {
        void this.deps.editInstrument(instrument);
      });

      for (const location of instrument.sourceLocations) {
        const openButton = item.createEl('button', { text: OPEN_SOURCE_LOCATION_ACTION });
        openButton.addEventListener('click', () => {
          void this.deps.openSourceLocation(location);
        });
      }

      const withdrawButton = item.createEl('button', {
        text: instrument.pruned ? RESTORE_INSTRUMENT_ACTION : WITHDRAW_INSTRUMENT_ACTION,
      });
      withdrawButton.addEventListener('click', () => {
        const action = instrument.pruned
          ? this.deps.restoreInstrument(instrument)
          : this.deps.withdrawInstrument(instrument);
        void action.then(() => this.refresh());
      });
    }
  }
}
