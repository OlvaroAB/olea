/**
 * `PaperView` — the practice-paper surface (F4.11, `[D-250]`/`[D-252]`/`[D-262]`, `[PAPER-8]` /
 * `ol-egov.141.6.1`, NEW-E4).
 *
 * **Thin by design, same discipline `gap/view.ts`'s own module doc states and the same reason:**
 * `obsidian` has no runtime outside a real host, so most of the logic worth testing (which state a
 * course is in, what the partial statement says, what an item's label reads) lives in
 * `./provider.ts` and `./copy.ts`, both plain TypeScript, both unit-tested
 * (`test/paper/provider.spec.ts`, `test/paper/copy.spec.ts`). This file is otherwise DOM only: it
 * renders whatever `PracticePaperCourseState`/`PracticePaperReadyState` it is handed, and decides
 * nothing about wording or eligibility itself — **except** the per-item hand-off control below,
 * which this module doc's next paragraph explains, and which `test/paper/view.spec.ts` pins as a
 * source-text assertion.
 *
 * **One course per open, seeded rather than picked from a list** (`setCourse`) — mirrors
 * `session-builder/view.ts`'s `setFocusConcept` seeding pattern. F4.11's own text is explicit that
 * this is "one affordance, ON THE COURSE," not a cross-course browser; a future bead adding a
 * second door (the course grove's own card, say) calls `setCourse` the same way this view's own
 * command handler does — see `wiring.ts`'s module doc for the reachability note on that second
 * door.
 *
 * **Statement placement is the one rule this file must not break** (`[D-262]` ruling 4: "before
 * she opens it"). `renderReady` always draws `state.partialStatement` first, before any item —
 * never after, never conditionally reordered.
 *
 * **A group's held passage sits above its parts (`[D-562]`, `ol-egov.141.89.7.93`).** Before the
 * first item of a group the paper holds a passage for (`./provider.ts`'s `facePassagesBeforeItems`),
 * `renderPassage` draws her text exactly as held and, under it, its source's path in a list, the way
 * the partial banner lists its pointer paths. It adds no word of Olea's: no label, no heading, no
 * sentence.
 *
 * **The per-item hand-off control (`ol-0r92.135`, F4.11 ruling 1, `[D-252]`/`[D-367]`/`[D-391]`/
 * `[D-407]`) is the one exception to "no test file for this module."** `renderHandoffControl` and
 * `handOffItem` below carry real branching logic — which of three fixed strings to show, and
 * whether pressing the button does anything — that is worth pinning even though it cannot be
 * mounted (`view.spec.ts`, the same source-text-assertion technique
 * `review/view-button-activation.spec.ts` already uses for the identical `obsidian`-cannot-load
 * constraint). It renders inside a single item's own row and nowhere else: there is no sibling
 * control anywhere in this file that acts on more than one `slotId` at a time — F4.11's "never the
 * whole paper as one gesture" is a fact about which methods exist, not a runtime check bolted onto
 * a wider one.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import {
  ASSESSMENT_PASSED_SENTENCE,
  buildLockedCopy,
  buildNoAssessmentAheadCopy,
  buildPaperFaceOutline,
  buildUndatedAssessmentCopy,
  COMPOSITION_FAILED_SENTENCE,
  type FacePartOutline,
  MATERIAL_CHANGED_SENTENCE,
  omittedPartLine,
  PAPER_FACE_WORDING,
  PRACTICE_PAPER_AI_UNAVAILABLE_COPY,
} from './copy.js';
import { VIEW_TYPE_OLEA_PAPER } from './ids.js';
import type {
  OfferedAssessment,
  PracticePaperCourseState,
  PracticePaperFaceItem,
  PracticePaperFacePassage,
  PracticePaperViewDeps,
} from './provider.js';
import { facePassagesBeforeItems, unfinishedPaperNotice } from './provider.js';

export { VIEW_TYPE_OLEA_PAPER };

export const PAPER_VIEW_TITLE = 'Practice paper';

/**
 * F4.11 ruling 1's per-item hand-off control — wording signed off by David, 2026-09-27
 * (`docs/design/copy-pass-2026-09/paper-item-handoff.md`, olea-service): every candidate was
 * hand-checked against the vocabulary registry's forbidden list and voice charter, and "from a
 * practice paper" (registry §8) is used verbatim below, never paraphrased. These three strings are
 * the ratified ones — never edit them here without a corresponding update to that copy pass and
 * to the vocabulary registry's own entry (filed separately, outside this bead's `owns`).
 */
export const PAPER_HANDOFF_BUTTON_LABEL = 'Add to review';
/** Shown once, immediately after the act succeeds — states only the filing fact, never a review, mark or mastery claim. */
export const PAPER_HANDOFF_CONFIRMATION = 'Added to your ordinary review, from a practice paper.';
/**
 * `[D-391]`'s idempotence made real: reachable whenever a row renders for a `slotId` already on
 * `state.record.handoffs` that THIS view instance did not itself just hand off in the render pass
 * that put it there (a repeat press after the button was already replaced is not reachable through
 * the DOM at all — see `renderHandoffControl` — but a later re-render of the same in-memory ready
 * state is). Same fact as the confirmation above, told in the past tense — never a second, richer
 * claim about what happened.
 */
export const PAPER_HANDOFF_ALREADY_DONE =
  'Already added to your ordinary review, from a practice paper.';

export class PaperView extends ItemView {
  private readonly deps: PracticePaperViewDeps;
  private course: string | undefined;
  /**
   * `slotId`s this view instance has itself handed off during the CURRENT ready state's lifetime —
   * distinguishes `PAPER_HANDOFF_CONFIRMATION` (this render is the direct result of the act) from
   * `PAPER_HANDOFF_ALREADY_DONE` (this render finds the fact already true, for any other reason).
   * Cleared whenever a fresh ready state replaces the current one — `refresh()`/`pullPaper()` — so
   * a stale entry from an earlier paper can never leak a "just now" confirmation onto a slot id
   * that happens to collide across two different `PaperRecord`s.
   */
  private readonly justHandedOff = new Set<string>();
  /**
   * `[D-622]`: the assessment the request on screen was offered for, from the last
   * `unlocked-not-pulled` state rendered. Kept while "ask again" re-offers the same request, and
   * handed back with it so the provider can tell that assessment has passed.
   */
  private offeredFor: OfferedAssessment | undefined;

  constructor(leaf: WorkspaceLeaf, deps: PracticePaperViewDeps, initialCourse?: string) {
    super(leaf);
    this.deps = deps;
    this.course = initialCourse;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_PAPER;
  }

  override getDisplayText(): string {
    return this.course === undefined ? PAPER_VIEW_TITLE : `${PAPER_VIEW_TITLE}: ${this.course}`;
  }

  override getIcon(): string {
    return 'file-question';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-paper-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-seeds the view for a different course and redraws — same no-stack reuse `main.ts`'s `revealPracticePaperView` relies on. */
  async setCourse(course: string): Promise<void> {
    this.course = course;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    if (this.course === undefined) {
      root.createEl('p', { text: 'Open this from a course note to see its practice paper.' });
      return;
    }
    const state = await this.deps.load(this.course);
    this.justHandedOff.clear();
    this.render(state);
  }

  /** `notice`, when given, is shown above the state: `[D-622]`'s passed sentence, over the course's current state. */
  private render(state: PracticePaperCourseState, notice?: string): void {
    const root = this.contentEl;
    root.empty();
    this.offeredFor = undefined;
    root.createEl('h2', { text: this.getDisplayText() });
    if (notice !== undefined) {
      root.createEl('p', { cls: 'olea-paper-assessment-passed', text: notice });
    }

    if (state.kind === 'assignments-not-configured') {
      root.createEl('p', {
        text: 'Set up your assignments table in Olea settings to use practice papers.',
      });
      return;
    }
    if (state.kind === 'no-assessment-ahead') {
      root.createEl('p', {
        text: state.undatedAssessment
          ? buildUndatedAssessmentCopy(state.course)
          : buildNoAssessmentAheadCopy(state.course),
      });
      return;
    }
    if (state.kind === 'locked') {
      root.createEl('p', {
        text: buildLockedCopy({
          course: state.course,
          daysUntilNearest: state.daysUntilNearest,
          nearestAssessmentDue: state.nearestAssessmentDue,
          coverage: state.coverage,
          topicsNeeded: state.topicsNeeded ?? 0,
          windowDays: state.windowDays,
        }),
      });
      return;
    }
    if (state.kind === 'ai-unavailable') {
      root.createEl('p', { text: PRACTICE_PAPER_AI_UNAVAILABLE_COPY });
      return;
    }
    if (state.kind === 'unlocked-not-pulled') {
      this.offeredFor = state.offeredFor;
      this.renderRequestButton(root, state.course);
      return;
    }
    // `state.kind === 'ready'`
    this.renderReady(root, state);
  }

  private renderRequestButton(root: HTMLElement, course: string): void {
    const button = root.createEl('button', { text: 'Give me a practice paper for this course' });
    button.addEventListener('click', () => {
      void this.pullPaper(course);
    });
  }

  private async pullPaper(course: string): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.createEl('p', { text: 'Composing your practice paper…' });
    let result: Awaited<ReturnType<PracticePaperViewDeps['requestPaper']>>;
    try {
      result = await this.deps.requestPaper(course, this.offeredFor);
    } catch (error) {
      // `[D-457]`/`[D-532]`: an unfinished paper reads its ruled sentence (outage, or Olea updated)
      // and the same request she already used is offered again ("Ask again"). Any other failure has
      // no other ruled wording: sheet v59's short notice shows, the request is offered again, and the
      // failure still surfaces. The composing message never outlives the composition (ol-egov.141.89.7.63).
      const notice = unfinishedPaperNotice(error);
      root.empty();
      root.createEl('h2', { text: this.getDisplayText() });
      root.createEl('p', {
        cls: 'olea-paper-unfinished',
        text: notice ?? COMPOSITION_FAILED_SENTENCE,
      });
      this.renderRequestButton(root, course);
      if (notice === null) throw error;
      return;
    }
    this.justHandedOff.clear();
    if (result.kind === 'assessment-passed') {
      // `[D-622]`: the view refreshes to the course's current state, never keeping the stale offer.
      this.render(result.current, ASSESSMENT_PASSED_SENTENCE);
      return;
    }
    this.render(result);
  }

  private renderReady(
    root: HTMLElement,
    state: Extract<PracticePaperCourseState, { readonly kind: 'ready' }>,
  ): void {
    // `[D-532]`: shown once, only when saved progress was discarded because her material changed.
    if (state.materialChanged) {
      root.createEl('p', { text: MATERIAL_CHANGED_SENTENCE, cls: 'olea-paper-material-changed' });
    }

    // [D-262] ruling 4: the statement is drawn BEFORE any item, always — never reordered.
    if (state.partialStatement !== null) {
      const banner = root.createDiv({ cls: 'olea-paper-partial-banner' });
      banner.createEl('p', { text: state.partialStatement.sentence });
      if (state.partialStatement.pointerPaths.length > 0) {
        const list = banner.createEl('ul');
        for (const path of state.partialStatement.pointerPaths) {
          list.createEl('li', { text: path });
        }
      }
    }

    // `[D-457]`: the partial paper's sentence and its omitted parts, also before any item.
    if (state.incompleteStatement !== null) {
      const incomplete = root.createDiv({ cls: 'olea-paper-incomplete' });
      incomplete.createEl('p', { text: state.incompleteStatement.sentence });
      if (state.incompleteStatement.omittedParts.length > 0) {
        const omitted = incomplete.createEl('ul');
        for (const part of state.incompleteStatement.omittedParts) {
          // Its ruled reason (`[D-519]`), never the recorded reason, which is developer prose.
          omitted.createEl('li', { text: omittedPartLine(part) });
        }
      }
    }

    // `[D-586]` (F4.11): the stored paper's sections, numbering and allocations, where it holds them.
    // `flat` is today's single list, unchanged.
    const outline = buildPaperFaceOutline(
      state.record.structure,
      state.items.map((item) => item.slotId),
    );
    const passagesBefore = facePassagesBeforeItems(state);
    if (outline.kind === 'flat') {
      const list = root.createEl('ul', { cls: 'olea-paper-items' });
      for (const item of state.items) this.renderItemRow(list, state, item, passagesBefore);
    } else {
      this.renderStructured(root, state, outline, passagesBefore);
    }

    // A partial paper's omitted parts are its statement above (`[D-457]`), so they are not listed
    // twice. Names only: a slot's recorded reason is developer prose, never her wording, and no
    // wording per reason is ruled yet (ol-egov.141.89.7.44).
    if (state.incompleteStatement === null && state.emptySlots.length > 0) {
      const emptyList = root.createEl('ul', { cls: 'olea-paper-empty-slots' });
      for (const slot of state.emptySlots) {
        emptyList.createEl('li', { text: slot.conceptName });
      }
    }
  }

  /** One item's row — the same row on the flat and the structured face; `numbering` and `marks` are only given on the latter. */
  private renderItemRow(
    list: HTMLElement,
    state: Extract<PracticePaperCourseState, { readonly kind: 'ready' }>,
    item: PracticePaperFaceItem,
    passagesBefore: ReadonlyMap<string, readonly PracticePaperFacePassage[]>,
    part?: FacePartOutline,
  ): void {
    // `[D-562]`: a group's held passage, above the first of its parts.
    for (const passage of passagesBefore.get(item.slotId) ?? []) {
      this.renderPassage(list, passage);
    }
    const row = list.createEl('li');
    if (part?.number != null)
      row.createEl('span', { cls: 'olea-paper-part-number', text: `${part.number} ` });
    row.createEl('strong', { text: item.conceptName });
    row.createEl('span', { text: ` — ${item.groundingLabel}` });
    if (part?.marks != null) {
      row.createEl('span', { cls: 'olea-paper-allocation', text: ` ${part.marks}` });
    }
    this.renderHandoffControl(row, state, item);
  }

  /**
   * `[D-586]`: sections as headings, each top-level question numbered where the stored paper supports
   * a number, each part under its stored number, every stated allocation beside what it covers.
   * An unknown allocation arrives as `null` and draws nothing.
   */
  private renderStructured(
    root: HTMLElement,
    state: Extract<PracticePaperCourseState, { readonly kind: 'ready' }>,
    outline: Extract<ReturnType<typeof buildPaperFaceOutline>, { readonly kind: 'structured' }>,
    passagesBefore: ReadonlyMap<string, readonly PracticePaperFacePassage[]>,
  ): void {
    const itemBySlot = new Map(state.items.map((item) => [item.slotId, item] as const));
    if (outline.wholePaperMarks !== null) {
      root.createEl('p', {
        cls: 'olea-paper-whole-allocation',
        text: `${PAPER_FACE_WORDING.WHOLE_PAPER_LABEL} ${outline.wholePaperMarks}`,
      });
    }
    for (const section of outline.sections) {
      const block = root.createDiv({ cls: 'olea-paper-section' });
      if (section.heading !== null) {
        const heading = block.createEl('h3', { text: section.heading });
        if (section.marks !== null) {
          heading.createEl('span', { cls: 'olea-paper-allocation', text: ` ${section.marks}` });
        }
      }
      const list = block.createEl('ul', { cls: 'olea-paper-items' });
      for (const question of section.questions) {
        let target = list;
        if (question.number !== null) {
          const header = list.createEl('li', { cls: 'olea-paper-question' });
          header.createEl('strong', { text: question.number });
          target = header.createEl('ul', { cls: 'olea-paper-items' });
        }
        for (const part of question.parts) {
          const item = itemBySlot.get(part.slotId);
          if (item !== undefined) this.renderItemRow(target, state, item, passagesBefore, part);
        }
      }
    }
    if (outline.unplacedSlotIds.length > 0) {
      const list = root.createEl('ul', { cls: 'olea-paper-items' });
      for (const slotId of outline.unplacedSlotIds) {
        const item = itemBySlot.get(slotId);
        if (item !== undefined) this.renderItemRow(list, state, item, passagesBefore);
      }
    }
  }

  /**
   * `[D-562]`: one group's held passage — her text exactly as held, then its source's path, listed
   * as the partial banner lists its pointer paths. Nothing else: no label or sentence of Olea's.
   */
  private renderPassage(list: HTMLElement, passage: PracticePaperFacePassage): void {
    const block = list.createEl('li', { cls: 'olea-paper-passage' });
    block.createEl('p', { cls: 'olea-paper-passage-text', text: passage.text });
    block.createEl('ul', { cls: 'olea-paper-passage-source' }).createEl('li', {
      text: passage.sourceId,
    });
  }

  /**
   * ONE item's own hand-off control (F4.11 ruling 1, `[D-252]`) — never called for more than one
   * `item` at a time, and there is no caller of this method anywhere but `renderReady`'s own
   * per-item loop above. Branches on `state.record.handoffs` (`[D-391]`'s durable fact), never a
   * separate view-local flag, so a row for an already-handed-off slot reads back the same true
   * state whether that hand-off happened on THIS render pass or an earlier one.
   */
  private renderHandoffControl(
    row: HTMLElement,
    state: Extract<PracticePaperCourseState, { readonly kind: 'ready' }>,
    item: PracticePaperFaceItem,
  ): void {
    const alreadyHandedOff = state.record.handoffs.some((h) => h.slotId === item.slotId);
    if (alreadyHandedOff) {
      row.createEl('p', {
        cls: 'olea-paper-handoff-confirmation',
        text: this.justHandedOff.has(item.slotId)
          ? PAPER_HANDOFF_CONFIRMATION
          : PAPER_HANDOFF_ALREADY_DONE,
      });
      return;
    }

    const button = row.createEl('button', { text: PAPER_HANDOFF_BUTTON_LABEL });
    button.addEventListener('click', () => {
      void this.handOffItem(state, item, button);
    });
  }

  /**
   * Calls `olea-core`'s `handOffPaperItem` (via `deps.handOffItem`) for exactly ONE item, then
   * redraws from the returned `PaperHandoffResult.record` — never by re-`load`ing the course,
   * because `load` never returns a `'ready'` state (ruling 5: every pull composes a fresh paper).
   * `button.disabled` is set before the `await` so a fast double-click cannot fire this twice
   * before the row is replaced by the confirmation text; `[D-391]`'s own idempotence in
   * `handOffPaperItem` means a second call would change nothing durable either way, but this keeps
   * the view from issuing a redundant vault write at all.
   */
  private async handOffItem(
    state: Extract<PracticePaperCourseState, { readonly kind: 'ready' }>,
    item: PracticePaperFaceItem,
    button: HTMLButtonElement,
  ): Promise<void> {
    button.disabled = true;
    const result = await this.deps.handOffItem(
      state.course,
      state.record.id,
      item.slotId,
      item.conceptName,
    );
    this.justHandedOff.add(item.slotId);
    // Only `record` changes on a hand-off — `items`/`partialStatement`/`emptySlots` were fixed at
    // generation time (`buildReadyStateFromRecord`'s own doc: "never recomposes") and stay valid.
    this.render({ ...state, record: result.record });
  }
}
