/**
 * `ExplainBackModal` — the ONE dedicated "Explain it back" view (F5.1,
 * `[D-163]`, `ol-12gs`). Single rendering implementation: every one of the
 * four ruled entry points (on-demand F5, confusion routing F2.12, session
 * assembly F4.6, Today's suggestion F6.4) constructs and opens exactly this
 * class — there is no second inline copy of this exchange anywhere in the
 * plugin. Typed input is the ship floor (F5.1); voice is a later, second
 * input method on this SAME view, not built here.
 *
 * ===========================================================================
 * WHAT THIS VIEW DOES AND DOES NOT DO (scope, disclosed per DF-20)
 * ===========================================================================
 * Wires the two ports `ol-12gs` names as "the waiting pipeline this finally
 * makes reachable": `gradeExplainBackAttempt` and
 * `acceptExplainBackGradingWithObservation` (`../grading/wiring.ts`).
 *
 * `ol-cqz8` UPDATE: `acceptGrading` below now ALSO runs the SOLO depth
 * pipeline and appends the subject's own review-log event, via
 * `deps.recordSoloGradeAndReview` — see `./solo-review.ts`'s module doc for
 * the full chain (`gradeSoloAttempt` → `acceptSoloGrading` →
 * `recordGradedExplainBackReview`) and for why this settles as ONE review
 * event, not two. That dep is optional and best-effort (mirrors
 * `acceptWithObservation`'s own failure-isolation posture): `originReview
 * EventId` stays `null` below for the unrelated reason it already was
 * (nothing here reads a PRIOR review event's id — `recordSoloGradeAndReview`
 * writes a fresh one).
 *
 * It does NOT:
 * - Support relation-context prompts (F5.2a's neighbour-concept retrieval) —
 *   see `./request.ts`'s module doc for why this view is concept-only.
 * - Fold an accepted attempt into F4.6's session time accounting
 *   (`study-session/explain-back.ts`'s own "Reachability" section already
 *   names this as separate, unstarted work: recognising a live acceptance
 *   and durably attributing it to "this session").
 *
 * ===========================================================================
 * HAND-OFF + RESUME, NEVER A SECOND INLINE COPY
 * ===========================================================================
 * This is a `Modal`, not an `ItemView`: whatever screen was open underneath
 * it (a review session, the session builder, Today) is untouched while this
 * is open and simply still there — unfocused, not torn down — the moment it
 * closes. That IS the hand-off-and-resume `[D-163]` asks for: there is
 * nothing to "return to" because nothing else was ever replaced. `onClose`
 * calls `deps.onClosed?.()` purely so a caller can clear its own transient
 * banner/offer state (F2.12's confusion banner, specifically) — never to
 * rebuild or re-render the surface underneath, which needed no rebuilding.
 */

import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import {
  discardExplainBackGrading,
  type ExplainBackPromptContext,
  type GradeExplainBackInput,
  type PendingExplainBackGrading,
} from 'olea-core';
import type {
  AcceptExplainBackGradingWithObservationContext,
  AcceptExplainBackGradingWithObservationResult,
} from '../grading/wiring.js';
import {
  EXPLAIN_BACK_CHECK_FAILED_REFUSAL,
  EXPLAIN_WHY_UNAVAILABLE,
  explainBackFullDepthEncouragement,
  explainBackInsufficientNotesRefusal,
} from '../review/copy.js';
import type { ReviewInstrument } from '../review/types.js';
import {
  EXPLAIN_BACK_ACCEPT_LABEL,
  EXPLAIN_BACK_ANSWER_PLACEHOLDER,
  EXPLAIN_BACK_CITED_HEADING,
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_GRADING_LABEL,
  EXPLAIN_BACK_MISCONCEPTION_HEADING,
  EXPLAIN_BACK_MISSED_HEADING,
  EXPLAIN_BACK_MODAL_TITLE,
  EXPLAIN_BACK_QUESTION_LABEL,
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_TOPIC_CONTINUE_LABEL,
  EXPLAIN_BACK_TOPIC_PROMPT,
  explainBackOutcomeHeading,
} from './copy.js';
import {
  buildExplainBackPromptContextFromInstrument,
  buildExplainBackPromptContextFromTopic,
  buildGradeExplainBackInputFromTypedAnswer,
  type ExplainBackSourceBlock,
  retrieveExplainBackSourceBlocks,
} from './request.js';

/** What opened this view, and therefore whether the question is already known. */
export type ExplainBackSeed =
  | { readonly kind: 'instrument'; readonly instrument: ReviewInstrument }
  | { readonly kind: 'freeform' };

export interface ExplainBackModalDeps {
  readonly grade: (input: GradeExplainBackInput) => Promise<PendingExplainBackGrading | null>;
  readonly acceptWithObservation: (
    pending: PendingExplainBackGrading,
    context: AcceptExplainBackGradingWithObservationContext,
  ) => Promise<AcceptExplainBackGradingWithObservationResult | null>;
  readonly retrieveSourceBlocks: (query: string) => Promise<readonly ExplainBackSourceBlock[]>;
  readonly buildObservationContext: (params: {
    readonly subjectConceptId: string | null;
    readonly originInstrumentId: string;
    readonly sourceBlocks: readonly ExplainBackSourceBlock[];
  }) => Promise<AcceptExplainBackGradingWithObservationContext>;
  /**
   * `ol-cqz8`: runs the SOLO depth pipeline and appends the subject's own
   * review-log event — see `./solo-review.ts`'s `recordSoloGradeAndReview`,
   * which this normally wraps. Optional and best-effort, same posture as
   * `acceptWithObservation`'s own embedding step: a rejection is caught in
   * `acceptGrading` below and never fails the correctness accept it rode on.
   * `undefined` until a caller wires a real `RecordSoloGradeAndReviewDeps`
   * instance — see this file's module doc and `./solo-review.ts`'s own
   * "reachability" section for exactly what that needs and where it goes.
   */
  readonly recordSoloGradeAndReview?: (params: {
    readonly instrumentId: string;
    readonly subjectConceptId: string | null;
    readonly context: ExplainBackPromptContext;
    readonly answer: string;
  }) => Promise<void>;
  /** A stable id for this attempt (`../grading/wiring.ts`'s "distinct from any card/MCQ id space"). Injected so this view never mints its own id-generation policy. */
  readonly generateInstrumentId: () => string;
  /** Fires once, on close, however the modal was resolved — see the module doc's "hand-off" section. */
  readonly onClosed?: () => void;
}

interface ResolvedPrompt {
  readonly context: ExplainBackPromptContext;
  readonly subjectConceptId: string | null;
  readonly originInstrumentId: string;
  readonly sourceBlocks: readonly ExplainBackSourceBlock[];
}

type ModalState =
  | { readonly phase: 'topic'; readonly topic: string }
  | { readonly phase: 'loading' }
  | { readonly phase: 'answering'; readonly prompt: ResolvedPrompt; readonly answer: string }
  | { readonly phase: 'grading'; readonly prompt: ResolvedPrompt; readonly answer: string }
  | {
      readonly phase: 'graded';
      readonly prompt: ResolvedPrompt;
      readonly answer: string;
      readonly pending: PendingExplainBackGrading;
    }
  | {
      readonly phase: 'refused';
      readonly prompt: ResolvedPrompt;
      readonly answer: string;
      readonly reason: 'unavailable' | 'check-failed' | 'insufficient-notes';
    }
  | { readonly phase: 'accepted'; readonly message: string | null };

export class ExplainBackModal extends Modal {
  private readonly deps: ExplainBackModalDeps;
  private readonly seed: ExplainBackSeed;
  private state: ModalState;

  constructor(app: App, deps: ExplainBackModalDeps, seed: ExplainBackSeed) {
    super(app);
    this.deps = deps;
    this.seed = seed;
    this.state = seed.kind === 'freeform' ? { phase: 'topic', topic: '' } : { phase: 'loading' };
  }

  override onOpen(): void {
    this.titleEl.setText(EXPLAIN_BACK_MODAL_TITLE);
    if (this.seed.kind === 'instrument') {
      void this.resolveInstrumentPrompt(this.seed.instrument);
    }
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.deps.onClosed?.();
  }

  private async resolveInstrumentPrompt(instrument: ReviewInstrument): Promise<void> {
    const query = questionQuery(instrument);
    const sourceBlocks = await this.deps.retrieveSourceBlocks(query);
    const context = buildExplainBackPromptContextFromInstrument(instrument, sourceBlocks);
    const prompt: ResolvedPrompt = {
      context,
      subjectConceptId: instrument.conceptIds[0] ?? null,
      originInstrumentId: instrument.instrumentId,
      sourceBlocks,
    };
    this.state = { phase: 'answering', prompt, answer: '' };
    this.render();
  }

  private async resolveTopicPrompt(topic: string): Promise<void> {
    this.state = { phase: 'loading' };
    this.render();
    const sourceBlocks = await this.deps.retrieveSourceBlocks(topic);
    const context = buildExplainBackPromptContextFromTopic(topic, sourceBlocks);
    if (context.referenceAnswer.trim() === '') {
      const prompt: ResolvedPrompt = {
        context,
        subjectConceptId: null,
        originInstrumentId: this.deps.generateInstrumentId(),
        sourceBlocks,
      };
      this.state = { phase: 'refused', prompt, answer: '', reason: 'insufficient-notes' };
      this.render();
      return;
    }
    const prompt: ResolvedPrompt = {
      context,
      subjectConceptId: null,
      originInstrumentId: this.deps.generateInstrumentId(),
      sourceBlocks,
    };
    this.state = { phase: 'answering', prompt, answer: '' };
    this.render();
  }

  private async submitAnswer(prompt: ResolvedPrompt, answer: string): Promise<void> {
    this.state = { phase: 'grading', prompt, answer };
    this.render();

    const input = buildGradeExplainBackInputFromTypedAnswer(answer, prompt.context);
    try {
      const pending = await this.deps.grade(input);
      if (pending === null) {
        this.state = { phase: 'refused', prompt, answer, reason: 'unavailable' };
        this.render();
        return;
      }
      this.state = { phase: 'graded', prompt, answer, pending };
      this.render();
    } catch (error) {
      // `UnusableGradingInputError` (empty referenceAnswer) reads as
      // insufficient-notes; anything else reads as the transient
      // check-failed refusal — the same two-reason posture C4.7/`[D-089]`
      // rules for the folded path (see this file's module doc).
      const isUnusableInput = error instanceof Error && error.name === 'UnusableGradingInputError';
      this.state = {
        phase: 'refused',
        prompt,
        answer,
        reason: isUnusableInput ? 'insufficient-notes' : 'check-failed',
      };
      this.render();
    }
  }

  private async acceptGrading(
    prompt: ResolvedPrompt,
    answer: string,
    pending: PendingExplainBackGrading,
  ): Promise<void> {
    const context = await this.deps.buildObservationContext({
      subjectConceptId: prompt.subjectConceptId,
      originInstrumentId: prompt.originInstrumentId,
      sourceBlocks: prompt.sourceBlocks,
    });
    const result = await this.deps.acceptWithObservation(pending, context);
    if (this.deps.recordSoloGradeAndReview) {
      try {
        await this.deps.recordSoloGradeAndReview({
          instrumentId: prompt.originInstrumentId,
          subjectConceptId: prompt.subjectConceptId,
          context: prompt.context,
          answer,
        });
      } catch (error) {
        // Mirrors `acceptWithObservation`'s own isolation
        // (`grading/wiring.ts`'s `acceptExplainBackGradingWithObservation`
        // doc): the SOLO depth grading and its review-log write are
        // additional evidence, never a precondition for the correctness
        // accept she is already looking at. D-005: a content-free line only.
        console.error('Olea: SOLO grade/review-log write failed (grade acceptance unaffected)', {
          error,
        });
      }
    }
    const message = result === null ? null : explainBackFullDepthEncouragement(result.accepted);
    this.state = { phase: 'accepted', message };
    this.render();
  }

  private discardGrading(
    prompt: ResolvedPrompt,
    answer: string,
    pending: PendingExplainBackGrading,
  ): void {
    discardExplainBackGrading(pending);
    this.state = { phase: 'answering', prompt, answer };
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('olea-explain-back');

    switch (this.state.phase) {
      case 'topic':
        this.renderTopicPhase(root, this.state.topic);
        return;
      case 'loading':
        root.createDiv({ cls: 'olea-explain-back-loading', text: EXPLAIN_BACK_GRADING_LABEL });
        return;
      case 'answering':
        this.renderAnsweringPhase(root, this.state.prompt, this.state.answer);
        return;
      case 'grading':
        this.renderQuestion(root, this.state.prompt);
        root.createDiv({ cls: 'olea-explain-back-loading', text: EXPLAIN_BACK_GRADING_LABEL });
        return;
      case 'graded':
        this.renderGradedPhase(root, this.state.prompt, this.state.answer, this.state.pending);
        return;
      case 'refused':
        this.renderRefusedPhase(root, this.state.prompt, this.state.answer, this.state.reason);
        return;
      case 'accepted':
        this.renderAcceptedPhase(root, this.state.message);
        return;
    }
  }

  private renderTopicPhase(root: HTMLElement, topic: string): void {
    root.createEl('p', { text: EXPLAIN_BACK_TOPIC_PROMPT });
    const input = root.createEl('input', { type: 'text', cls: 'olea-explain-back-topic' });
    input.value = topic;
    const button = root.createEl('button', { text: EXPLAIN_BACK_TOPIC_CONTINUE_LABEL });
    button.addEventListener('click', () => {
      const value = input.value.trim();
      if (value.length === 0) return;
      void this.resolveTopicPrompt(value);
    });
  }

  private renderQuestion(root: HTMLElement, prompt: ResolvedPrompt): void {
    root.createDiv({ cls: 'olea-explain-back-question-label', text: EXPLAIN_BACK_QUESTION_LABEL });
    root.createDiv({ cls: 'olea-explain-back-question', text: prompt.context.question });
  }

  private renderAnsweringPhase(root: HTMLElement, prompt: ResolvedPrompt, answer: string): void {
    this.renderQuestion(root, prompt);
    const textarea = root.createEl('textarea', {
      cls: 'olea-explain-back-answer',
      attr: { placeholder: EXPLAIN_BACK_ANSWER_PLACEHOLDER },
    });
    textarea.value = answer;
    const button = root.createEl('button', { text: EXPLAIN_BACK_SUBMIT_LABEL });
    button.addEventListener('click', () => {
      void this.submitAnswer(prompt, textarea.value);
    });
  }

  private renderGradedPhase(
    root: HTMLElement,
    prompt: ResolvedPrompt,
    answer: string,
    pending: PendingExplainBackGrading,
  ): void {
    this.renderQuestion(root, prompt);
    const grading = pending.grading;

    root.createDiv({
      cls: 'olea-explain-back-outcome',
      text: explainBackOutcomeHeading(grading.verdict),
    });
    root.createEl('p', { cls: 'olea-explain-back-feedback', text: grading.feedback });

    if (grading.missedPoints.length > 0) {
      root.createDiv({ cls: 'olea-explain-back-heading', text: EXPLAIN_BACK_MISSED_HEADING });
      const list = root.createEl('ul');
      for (const point of grading.missedPoints) list.createEl('li', { text: point });
    }

    if (grading.citedIssues.length > 0) {
      root.createDiv({ cls: 'olea-explain-back-heading', text: EXPLAIN_BACK_CITED_HEADING });
      const list = root.createEl('ul');
      for (const issue of grading.citedIssues) list.createEl('li', { text: issue.description });
    }

    if (grading.misconceptionCandidates.length > 0) {
      root.createDiv({
        cls: 'olea-explain-back-heading',
        text: EXPLAIN_BACK_MISCONCEPTION_HEADING,
      });
      const list = root.createEl('ul');
      for (const candidate of grading.misconceptionCandidates) {
        list.createEl('li', { text: candidate.correction });
      }
    }

    const actions = root.createDiv({ cls: 'olea-explain-back-actions' });
    const accept = actions.createEl('button', { text: EXPLAIN_BACK_ACCEPT_LABEL });
    accept.addEventListener('click', () => void this.acceptGrading(prompt, answer, pending));
    const discard = actions.createEl('button', { text: EXPLAIN_BACK_DISCARD_LABEL });
    discard.addEventListener('click', () => this.discardGrading(prompt, answer, pending));
  }

  private renderRefusedPhase(
    root: HTMLElement,
    prompt: ResolvedPrompt,
    answer: string,
    reason: 'unavailable' | 'check-failed' | 'insufficient-notes',
  ): void {
    this.renderQuestion(root, prompt);
    const text =
      reason === 'unavailable'
        ? EXPLAIN_WHY_UNAVAILABLE
        : reason === 'check-failed'
          ? EXPLAIN_BACK_CHECK_FAILED_REFUSAL
          : explainBackInsufficientNotesRefusal(prompt.sourceBlocks.length);
    root.createEl('p', { cls: 'olea-explain-back-refusal', text });
    if (reason === 'check-failed') {
      const button = root.createEl('button', { text: EXPLAIN_BACK_SUBMIT_LABEL });
      button.addEventListener('click', () => void this.submitAnswer(prompt, answer));
    }
  }

  private renderAcceptedPhase(root: HTMLElement, message: string | null): void {
    if (message !== null)
      root.createEl('p', { cls: 'olea-explain-back-encouragement', text: message });
    const button = root.createEl('button', { text: 'Done' });
    button.addEventListener('click', () => this.close());
  }
}

function questionQuery(instrument: ReviewInstrument): string {
  switch (instrument.type) {
    case 'qa':
      return instrument.question;
    case 'cloze':
      return `${instrument.before} ${instrument.after}`;
    case 'mcq':
      return instrument.stem;
  }
}
