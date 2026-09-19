/**
 * The two-step "choose a file, choose its role" gesture [D-226] ruling 1
 * names once and reuses from both surfaces it authorises: F1.5's amended
 * clause — *"How she names a document, and where that naming lives"*
 * (`docs/Olea_alpha_functional_scope.md` F1.5, olea-service) —
 * (Added Sep 2026 — `[D-226]`). One control, at document grain only, never a
 * passage/whole-file split.
 *
 * `RegisterSourceFileModal` is S1's file step (the grove's evidenced
 * no-source ask, `../grove/view.ts`) — a plain `Modal` listing a
 * caller-supplied candidate set, never a vault-wide search: the ruling's own
 * words are "choose a file from the course's own folders and the F7.9
 * location," so the candidate set is scoped by the caller
 * (`../grove/provider.ts`), not by this modal. A hand-rolled list plus a
 * text filter rather than Obsidian's `FuzzySuggestModal`, deliberately: the
 * workbench's `obsidian-shim` (`ol-z6x2` [WB-2]) shims `Modal` down to
 * exactly what a real view needs and does not carry `FuzzySuggestModal` at
 * all, and this control's candidate lists are small (one course's own
 * folder plus the flat F7.9 one), where a plain filtered list costs nothing
 * a fuzzy matcher would have bought.
 *
 * `RegisterSourceRoleModal` is the second step both S1 and S2
 * (`./register-source-wiring.ts`) share verbatim — objectives or past paper,
 * the only two roles either control ever offers (`olea-contracts`'
 * `sourceRegisteredRole`, deliberately narrower than `olea-core`'s in-memory
 * `SourceRole`). Correction is the *same* two steps, run again on an
 * already-registered path — F1.5's "correcting a document's classification
 * is the same gesture as making it."
 *
 * Neither modal writes anything. Both hand their result to a caller-supplied
 * callback; `../grove/provider.ts#registerSource` and
 * `./register-source-wiring.ts#wireDocumentSourceRegistration` are what
 * actually call `olea-core#appendSourceRegisteredRecord`. Keeping the write
 * out of the modal is what lets S1 and S2 share both steps without sharing a
 * vault reference.
 */

import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import type { SourceRegisteredRole } from 'olea-contracts';
import type { VaultPath } from 'olea-core';

export const REGISTER_SOURCE_FILE_PROMPT =
  'Choose a file to register as this course’s objectives or past paper…';
export const REGISTER_SOURCE_FILE_EMPTY =
  'No files found in this course’s folder or the F7.9 source location.';
export const REGISTER_SOURCE_FILTER_PLACEHOLDER = 'Filter…';

export const REGISTER_SOURCE_ROLE_PROMPT =
  'Is this document the course’s objectives, or a past paper?';

export const REGISTER_SOURCE_ROLE_OBJECTIVES_LABEL = 'Objectives';
export const REGISTER_SOURCE_ROLE_PAST_PAPER_LABEL = 'Past paper';
export const REGISTER_SOURCE_CANCEL_LABEL = 'Cancel';

/**
 * S1's file step. `candidates` is the caller's own scoped list — this class
 * never lists the vault itself, so it cannot offer a file outside whatever
 * the caller decided counts as "the course's own folders and the F7.9
 * location" (F1.5(b), `[D-226]`).
 */
export class RegisterSourceFileModal extends Modal {
  private readonly candidates: readonly VaultPath[];
  private readonly onChoose: (path: VaultPath) => void;

  constructor(app: App, candidates: readonly VaultPath[], onChoose: (path: VaultPath) => void) {
    super(app);
    this.candidates = candidates;
    this.onChoose = onChoose;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: REGISTER_SOURCE_FILE_PROMPT });

    if (this.candidates.length === 0) {
      contentEl.createEl('p', { text: REGISTER_SOURCE_FILE_EMPTY });
      return;
    }

    const filterInput = contentEl.createEl('input', {
      type: 'text',
      attr: { placeholder: REGISTER_SOURCE_FILTER_PLACEHOLDER },
    });
    const list = contentEl.createDiv({ cls: 'olea-register-source-file-list' });

    const render = (filter: string): void => {
      list.empty();
      const normalized = filter.trim().toLowerCase();
      const matches = this.candidates.filter((path) =>
        normalized === '' ? true : path.toLowerCase().includes(normalized),
      );
      for (const path of matches) {
        const button = list.createEl('button', {
          cls: 'olea-register-source-file-item',
          text: path,
        });
        button.addEventListener('click', () => {
          this.close();
          this.onChoose(path);
        });
      }
    };

    filterInput.addEventListener('input', () => render(filterInput.value));
    render('');
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * The role step both S1 and S2 share. Two buttons, never a third — F1.5(b)'s
 * evidenced ask and the document-side control both only ever offer
 * objectives or past paper; `'course-material'` (F3.1's own default role) is
 * not a choice this control makes, so it is not a button here.
 */
export class RegisterSourceRoleModal extends Modal {
  private readonly path: VaultPath;
  private readonly onChoose: (role: SourceRegisteredRole) => void;

  constructor(app: App, path: VaultPath, onChoose: (role: SourceRegisteredRole) => void) {
    super(app);
    this.path = path;
    this.onChoose = onChoose;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: `${this.path}` });
    contentEl.createEl('p', { text: REGISTER_SOURCE_ROLE_PROMPT });

    const actions = contentEl.createDiv({ cls: 'olea-register-source-role-actions' });
    const objectivesButton = actions.createEl('button', {
      text: REGISTER_SOURCE_ROLE_OBJECTIVES_LABEL,
    });
    objectivesButton.addEventListener('click', () => this.choose('objectives'));

    const pastPaperButton = actions.createEl('button', {
      text: REGISTER_SOURCE_ROLE_PAST_PAPER_LABEL,
    });
    pastPaperButton.addEventListener('click', () => this.choose('past-paper'));

    // Dismissing (Escape/outside click) is a no-op — same posture
    // `CourseSetupModal` takes toward its own dismiss — so this button simply
    // closes rather than reporting a distinct "cancelled" outcome.
    const cancelButton = actions.createEl('button', { text: REGISTER_SOURCE_CANCEL_LABEL });
    cancelButton.addEventListener('click', () => this.close());
  }

  private choose(role: SourceRegisteredRole): void {
    this.close();
    this.onChoose(role);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
