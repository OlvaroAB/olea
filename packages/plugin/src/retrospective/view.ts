/**
 * `RetrospectiveView` — F8.8's dedicated view (`[POST-1]`/`ol-r68l`, mechanics
 * ruled `[D-134]` Q10: "a DEDICATED VIEW with its own F7.7 command").
 *
 * **Thin by design**, the same split `gap/view.ts` and `today/view.ts` draw:
 * everything this screen DECIDES is in `olea-core`'s `retrospective/`
 * (groupings, the too-early count, the carries overlay) and everything it
 * SAYS is in `./copy.ts`. This file is DOM only, and there is deliberately
 * no test for it — `obsidian` has no runtime outside a real host, so the
 * honesty properties (no score, no ratio, no verdict) are asserted against
 * `./copy.ts` and `./note-writer.ts` under Vitest instead
 * (`test/retrospective/copy.spec.ts`, `test/retrospective/note-writer.spec.ts`).
 *
 * **Opening this view ends the offer (F8.8: "offered once").** `onOpen`
 * calls `deps.markOpened` with the shown assessment's path exactly once per
 * open — matching the module's own rule that opening and dismissing are the
 * offer's two endings, never re-armed by looking again.
 */

import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type { RetrospectiveReading, VaultPath } from 'olea-core';
import {
  CARRIES_SECTION_HEADING,
  carriesLine,
  conceptLine,
  emptyScopeLine,
  FADED_SECTION_HEADING,
  HELD_SECTION_HEADING,
  HONESTY_DISCLAIMER,
  OWN_WORDS_PLACEHOLDER,
  OWN_WORDS_PROMPT,
  RETROSPECTIVE_VIEW_TITLE,
  scopeFactLine,
  scopeOriginLine,
  tooEarlyCountLine,
} from './copy.js';

export const VIEW_TYPE_OLEA_RETROSPECTIVE = 'olea-retrospective';

export interface RetrospectiveLoaded {
  readonly reading: RetrospectiveReading;
}

/**
 * `'none'` — nothing has passed yet; `'unavailable'` — the vault could not
 * be read, the same "an error is not an empty answer" distinction
 * `GapViewState`/`TodayInstrumentSource` already draw for their own reads.
 */
export type RetrospectiveViewState =
  | { readonly kind: 'reading'; readonly result: RetrospectiveLoaded }
  | { readonly kind: 'none' }
  | { readonly kind: 'unavailable' };

export interface RetrospectiveViewDeps {
  readonly load: () => Promise<RetrospectiveViewState>;
  readonly markOpened: (assessmentPath: VaultPath) => Promise<void>;
  /**
   * `ownWords` is the optional line she may add at THIS gesture (`[D-190]`)
   * — `undefined` when the input was left blank. This view never inspects
   * it beyond trimming and the empty check; it is handed straight to the
   * provider and never logged (D-005).
   */
  readonly acceptToVault: (reading: RetrospectiveReading, ownWords?: string) => Promise<VaultPath>;
}

export class RetrospectiveView extends ItemView {
  private readonly deps: RetrospectiveViewDeps;
  private openedFor: VaultPath | null = null;

  constructor(leaf: WorkspaceLeaf, deps: RetrospectiveViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_RETROSPECTIVE;
  }

  override getDisplayText(): string {
    return RETROSPECTIVE_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'history';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-retrospective-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-reads and redraws. Public so a host can refresh after her material changes, matching `GapView.refresh`/`TodayView`'s own convention. */
  async refresh(): Promise<void> {
    const state = await this.deps.load();
    if (state.kind === 'reading' && this.openedFor !== state.result.reading.assessmentPath) {
      this.openedFor = state.result.reading.assessmentPath;
      await this.deps.markOpened(state.result.reading.assessmentPath);
    }
    this.render(state);
  }

  private render(state: RetrospectiveViewState): void {
    const root = this.contentEl;
    root.empty();

    if (state.kind === 'unavailable') {
      root.createDiv({
        cls: 'olea-retrospective-unavailable',
        text: 'Olea could not read your vault just now.',
      });
      return;
    }
    if (state.kind === 'none') {
      root.createDiv({
        cls: 'olea-retrospective-none',
        text: 'No assessment has passed yet — there is nothing to retrospect on.',
      });
      return;
    }

    this.renderReading(root, state.result.reading);
  }

  private renderReading(root: HTMLElement, reading: RetrospectiveReading): void {
    root.createEl('h2', { text: RETROSPECTIVE_VIEW_TITLE });
    root.createDiv({ cls: 'olea-retrospective-scope-fact', text: scopeFactLine(reading) });
    root.createDiv({
      cls: 'olea-retrospective-scope-origin',
      text: scopeOriginLine(reading.scopeOrigin),
    });
    root.createDiv({ cls: 'olea-retrospective-disclaimer', text: HONESTY_DISCLAIMER });

    if (reading.scopeCount === 0) {
      root.createDiv({ cls: 'olea-retrospective-empty', text: emptyScopeLine() });
      return;
    }

    this.renderSection(root, HELD_SECTION_HEADING, reading.held, conceptLine);
    this.renderSection(root, FADED_SECTION_HEADING, reading.faded, conceptLine);

    const tooEarly = tooEarlyCountLine(reading);
    if (tooEarly !== null) {
      root.createDiv({ cls: 'olea-retrospective-too-early', text: tooEarly });
    }

    if (reading.carries.length > 0) {
      this.renderSection(root, CARRIES_SECTION_HEADING, reading.carries, carriesLine);
    }

    // `[D-190]`: the optional line lives HERE, beside the keep gesture —
    // never among the computed sections above, and never shown until she has
    // already reached the point of deciding to keep the reading. This is the
    // one place F8.8's "nothing to do" screen already has a decision to make.
    const acceptArea = root.createDiv({ cls: 'olea-retrospective-accept-area' });
    acceptArea.createDiv({
      cls: 'olea-retrospective-own-words-prompt',
      text: OWN_WORDS_PROMPT,
    });
    const ownWordsInput = acceptArea.createEl('input', {
      cls: 'olea-retrospective-own-words-input',
      type: 'text',
      attr: { placeholder: OWN_WORDS_PLACEHOLDER },
    });

    const acceptButton = acceptArea.createEl('button', {
      cls: 'olea-retrospective-accept',
      text: 'Save this retrospective to my vault',
    });
    acceptButton.addEventListener('click', () => {
      void this.handleAccept(reading, acceptButton, ownWordsInput.value);
    });
  }

  private renderSection<T>(
    root: HTMLElement,
    heading: string,
    rows: readonly T[],
    lineFor: (row: T) => string,
  ): void {
    if (rows.length === 0) return;
    const section = root.createDiv({ cls: 'olea-retrospective-section' });
    section.createEl('h3', { text: heading });
    const list = section.createEl('ul');
    for (const row of rows) list.createEl('li', { text: lineFor(row) });
  }

  /**
   * D-134 Q5/Q7: acceptance is a distinct gesture from opening — opening
   * shows the reading, this writes it into her vault as the durable
   * generated-record. Disabled during the write so a double-click cannot
   * produce two notes for one acceptance.
   */
  private async handleAccept(
    reading: RetrospectiveReading,
    button: HTMLButtonElement,
    ownWordsRaw: string,
  ): Promise<void> {
    button.disabled = true;
    try {
      // Blank input means nothing is added (`[D-190]`) — `undefined`, never
      // an empty-string section for `note-writer.ts` to have to special-case
      // a second time.
      const trimmed = ownWordsRaw.trim();
      const path = await this.deps.acceptToVault(reading, trimmed === '' ? undefined : trimmed);
      new Notice(`Saved to ${path}`);
    } catch {
      new Notice('Olea could not save this to your vault just now.');
      button.disabled = false;
    }
  }
}
