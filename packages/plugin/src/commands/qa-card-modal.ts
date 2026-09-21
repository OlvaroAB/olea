/**
 * `QaCardModal` — F2.1's Q&A card entry surface, amended Sep 2026 by
 * `[D-268]` (`ol-egov.141.66` [CARD-1], build bead `ol-0r92.77`
 * [H-qa-card-modal]).
 *
 * The clause, in full: "Q&A is entered through a modal with two plain-text
 * fields, front and back, following the plugin's existing register-source
 * and setup modal pattern; the existing create-card command opens it on the
 * no-selection outcome in place of today's notice, confirms by creating the
 * card at the block anchor, and cancels with no edit written."
 * (`docs/Olea_alpha_functional_scope.md` F2.1, olea-service, private.)
 *
 * Follows `course-setup/register-source-modal.ts`'s shape (named in the
 * clause itself): a plain `Modal` subclass, `contentEl` built by hand and
 * emptied on close, a caller-supplied `onConfirm` callback, and nothing
 * written to the vault from inside the modal — `main.ts`'s
 * `handleCreateCardCommand` is what calls `commands/create-card.ts`'s
 * `createQaCardFromEntry` (which calls `olea-core#createQaCard`) and writes
 * the result back through the vault. Cancelling — the Cancel button, Escape,
 * or clicking outside — closes without ever calling `onConfirm`, the same
 * posture `RegisterSourceRoleModal`'s cancel button takes, so no edit is
 * made: the clause's "cancels with no edit written" is true by construction,
 * not by a caller remembering to check a flag.
 *
 * Two plain `<textarea>` fields, not single-line `<input>`s: her Q&A text
 * can run past one line, and `card-format.ts` defaults new cards to its
 * `'multi-line'` separator style for exactly that reason (a single-line
 * field would silently clip anything past the visible width). The Confirm
 * button stays disabled while either field is blank — `olea-core#createQaCard`
 * itself throws on a blank front or back, so this is client-side avoidance
 * of an error it would otherwise have to render, not a second source of
 * truth for the rule.
 *
 * INV-6 / cognitive-offloading: she types both sides of the card herself:
 * this modal collects her own typed text and generates, grades or schedules
 * nothing.
 */

import type { App } from 'obsidian';
import { Modal } from 'obsidian';

export const QA_CARD_MODAL_TITLE = 'Create a Q&A card';
export const QA_CARD_FRONT_LABEL = 'Front';
export const QA_CARD_BACK_LABEL = 'Back';
export const QA_CARD_CONFIRM_LABEL = 'Create card';
export const QA_CARD_CANCEL_LABEL = 'Cancel';

/** The confirmed text, handed to `commands/create-card.ts#createQaCardFromEntry`. */
export interface QaCardModalResult {
  readonly front: string;
  readonly back: string;
}

export class QaCardModal extends Modal {
  private readonly onConfirm: (result: QaCardModalResult) => void;

  constructor(app: App, onConfirm: (result: QaCardModalResult) => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: QA_CARD_MODAL_TITLE });

    contentEl.createEl('label', { text: QA_CARD_FRONT_LABEL, cls: 'olea-qa-card-label' });
    const frontInput = contentEl.createEl('textarea', { cls: 'olea-qa-card-front' });

    contentEl.createEl('label', { text: QA_CARD_BACK_LABEL, cls: 'olea-qa-card-label' });
    const backInput = contentEl.createEl('textarea', { cls: 'olea-qa-card-back' });

    const actions = contentEl.createDiv({ cls: 'olea-qa-card-actions' });
    const confirmButton = actions.createEl('button', { text: QA_CARD_CONFIRM_LABEL });

    const updateConfirmState = (): void => {
      confirmButton.disabled = frontInput.value.trim() === '' || backInput.value.trim() === '';
    };
    frontInput.addEventListener('input', updateConfirmState);
    backInput.addEventListener('input', updateConfirmState);
    updateConfirmState();

    confirmButton.addEventListener('click', () => {
      const front = frontInput.value;
      const back = backInput.value;
      if (front.trim() === '' || back.trim() === '') return;
      this.close();
      this.onConfirm({ front, back });
    });

    // Dismissing (Escape/outside click) is a no-op, same posture
    // `RegisterSourceRoleModal`'s cancel button takes — this button simply
    // closes rather than reporting a distinct "cancelled" outcome, since the
    // clause names only two endings: confirm, or no edit written.
    const cancelButton = actions.createEl('button', { text: QA_CARD_CANCEL_LABEL });
    cancelButton.addEventListener('click', () => this.close());
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
