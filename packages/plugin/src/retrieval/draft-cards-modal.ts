/**
 * `DraftCardsModal` — the first ask-and-show surface for `ol-odb0`'s wired
 * retrieval → grounding → generation path (`ol-odb0.2`'s
 * `draftQuizCardsForConcept`). It is the point the product actually asks a
 * grounded question of her material: she names a course and a concept, Olea
 * either drafts quiz cards from her own notes or refuses honestly, and she
 * sees which one happened before anything is decided about her vault.
 *
 * **Thin by design, same split every other view/tab in this package holds**
 * (`session-builder/view.ts`'s module doc states it plainly for that file,
 * and it applies here identically): everything that could be wrong — the
 * copy, the refusal-reason mapping, the response shaping — lives in
 * `draft-cards-copy.ts` and `draft-cards-controller.ts`, both obsidian-free
 * and both unit-tested. This file is DOM and one small piece of state (which
 * screen is showing), and cannot itself be unit-tested: `obsidian`'s
 * `package.json` `main` is `""`, so `Modal` has no runtime outside a real
 * Obsidian host (same reasoning `commands/placeholders.ts` and
 * `settings/settings-tab.ts` both give for their own untestable files).
 * `test/main-wiring.spec.ts` is where this file's reachability from the
 * command palette is asserted at the source level.
 *
 * **INV-6.** Nothing here writes to her vault. Accept is a consent gesture
 * with an honestly-labelled seam behind it (`ACCEPT_NOT_WIRED_NOTICE`) —
 * shaping a drafted question into `McqFields`, dupe-checking it against her
 * existing instruments, and actually inserting it are `ol-p3t07a`'s
 * ("Generation: summaries + card drafts") full scope, not this bead's. Reject
 * only removes the card from this modal's own transient list; it records
 * nothing (`ol-548w`, the accept/edit/reject event log, stays separately
 * open) and touches nothing she has written.
 */

import { type App, Modal, Notice, Setting } from 'obsidian';
import { type DraftCardsOutcome, runDraftCards } from './draft-cards-controller.js';
import {
  ACCEPT_NOT_WIRED_NOTICE,
  CONCEPT_FIELD_NAME,
  CONCEPT_FIELD_PLACEHOLDER,
  COURSE_CODE_FIELD_NAME,
  COURSE_CODE_FIELD_PLACEHOLDER,
  DRAFT_CARDS_MODAL_TITLE,
  type DraftedQuestionView,
  LOADING_MESSAGE,
  SUBMIT_BUTTON_LABEL,
} from './draft-cards-copy.js';
import type { DraftQuizCardsDeps } from './draft-quiz-cards.js';

const MISSING_FIELDS_NOTICE = 'Olea: enter a course and a concept before drafting cards.';
const ZERO_QUESTIONS_MESSAGE = 'Olea drafted zero cards for this — nothing to review yet.';
const UNPARSEABLE_MESSAGE = 'Olea got back something it could not read. Nothing was drafted.';
const BACK_BUTTON_LABEL = 'Try another concept';

type ModalScreen =
  | { readonly kind: 'form' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'result'; readonly outcome: DraftCardsOutcome };

export class DraftCardsModal extends Modal {
  private courseCode: string;
  private conceptName: string;
  private screen: ModalScreen = { kind: 'form' };

  constructor(
    app: App,
    private readonly deps: DraftQuizCardsDeps,
    initialConceptName?: string,
    initialCourseCode?: string,
  ) {
    super(app);
    this.conceptName = initialConceptName ?? '';
    this.courseCode = initialCourseCode ?? '';
  }

  override onOpen(): void {
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: DRAFT_CARDS_MODAL_TITLE });

    if (this.screen.kind === 'form') this.renderForm(contentEl);
    else if (this.screen.kind === 'loading') contentEl.createEl('p', { text: LOADING_MESSAGE });
    else this.renderOutcome(contentEl, this.screen.outcome);
  }

  private renderForm(container: HTMLElement): void {
    new Setting(container).setName(COURSE_CODE_FIELD_NAME).addText((text) => {
      text.setPlaceholder(COURSE_CODE_FIELD_PLACEHOLDER);
      text.setValue(this.courseCode);
      text.onChange((value) => {
        this.courseCode = value;
      });
    });
    new Setting(container).setName(CONCEPT_FIELD_NAME).addText((text) => {
      text.setPlaceholder(CONCEPT_FIELD_PLACEHOLDER);
      text.setValue(this.conceptName);
      text.onChange((value) => {
        this.conceptName = value;
      });
    });

    new Setting(container).addButton((button) => {
      button.setButtonText(SUBMIT_BUTTON_LABEL);
      button.setCta();
      button.onClick(() => {
        void this.submit();
      });
    });
  }

  private async submit(): Promise<void> {
    const courseCode = this.courseCode.trim();
    const conceptName = this.conceptName.trim();
    if (courseCode.length === 0 || conceptName.length === 0) {
      new Notice(MISSING_FIELDS_NOTICE);
      return;
    }

    this.screen = { kind: 'loading' };
    this.render();

    // Never throws past this call — `retrieve()` degrades rather than
    // rejecting (`engine.ts`'s own module doc), and `runDraftCards` narrows
    // every remaining failure mode (refusal, a well-formed Worker error, an
    // unparseable body) into `DraftCardsOutcome` rather than a rejection this
    // modal would otherwise have to guard against separately.
    const outcome = await runDraftCards(this.deps, { courseCode, conceptName });
    this.screen = { kind: 'result', outcome };
    this.render();
  }

  private renderOutcome(container: HTMLElement, outcome: DraftCardsOutcome): void {
    if (outcome.kind === 'refused') {
      container.createEl('p', { cls: 'olea-draft-cards-refusal', text: outcome.copy.headline });
    } else if (outcome.kind === 'worker-error') {
      container.createEl('p', { cls: 'olea-draft-cards-error', text: outcome.message });
    } else if (outcome.kind === 'unparseable') {
      container.createEl('p', { cls: 'olea-draft-cards-error', text: UNPARSEABLE_MESSAGE });
    } else if (outcome.questions.length === 0) {
      container.createEl('p', { text: ZERO_QUESTIONS_MESSAGE });
    } else {
      const list = container.createDiv({ cls: 'olea-draft-cards-list' });
      for (const question of outcome.questions) this.renderQuestion(list, question);
    }

    new Setting(container).addButton((button) => {
      button.setButtonText(BACK_BUTTON_LABEL);
      button.onClick(() => {
        this.screen = { kind: 'form' };
        this.render();
      });
    });
  }

  private renderQuestion(container: HTMLElement, question: DraftedQuestionView): void {
    const card = container.createDiv({ cls: 'olea-draft-card' });
    card.createEl('p', { cls: 'olea-draft-card-stem', text: question.stem });
    card.createEl('p', { cls: 'olea-draft-card-answer', text: question.correctAnswer });
    if (question.distractors.length > 0) {
      const list = card.createEl('ul', { cls: 'olea-draft-card-distractors' });
      for (const distractor of question.distractors) list.createEl('li', { text: distractor });
    }
    card.createEl('p', { cls: 'olea-draft-card-feedback', text: question.feedback });

    const actions = card.createDiv({ cls: 'olea-draft-card-actions' });
    const accept = actions.createEl('button', { cls: 'mod-cta', text: 'Accept' });
    accept.addEventListener('click', () => {
      // INV-6's consent gesture — see the module doc for why nothing lands
      // in her vault from here yet.
      new Notice(ACCEPT_NOT_WIRED_NOTICE);
    });
    const reject = actions.createEl('button', { text: 'Reject' });
    reject.addEventListener('click', () => {
      // Prunes this modal's own transient list only — no event is recorded
      // (`ol-548w`), and nothing that was ever written to her vault is
      // touched, because nothing here has written to it.
      card.remove();
    });
  }
}
