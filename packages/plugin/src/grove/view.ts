/**
 * `GroveView` — the course-grove host (F8.1, `[D-134]` Q1, `ol-0r92.17`).
 *
 * **What this bead can honestly build, and what it cannot — read before
 * touching this file.** F8.1's grove is a six-state coverage layer —
 * `ground` / `seed` / `sprout` / `sapling` / `tree` / `volunteer` — read
 * against a denominator the examiner's own registered documents declare
 * (F1.5/F4.1), never Olea's own count (`features/F8-concepts-scope.md`'s
 * F8.1/F8.2 scenarios). **None of that computation exists in
 * `packages/core` yet** — there is no `GroveState` type, no `ground` or
 * `volunteer` value anywhere in the codebase, and no module builds a
 * per-course scope-vs-material read (confirmed by grep; the component
 * register has no row for it, only the note at
 * `docs/Olea_component_register.md`'s retrospective row that "neither ruled
 * host — Home or the course grove — is built"). Building it is real core
 * work — a new component, its own health check, its own register row — and
 * `packages/core` sits outside this bead's `owns` set
 * (`packages/plugin/src/home/`, `packages/plugin/src/grove/`,
 * `packages/plugin/src/main.ts`).
 *
 * So `./provider.ts` reuses the ONE per-course, per-concept reading that
 * already exists and is already exported for reuse — growth stage (F2.11's
 * four-value `MasteryState`), via the same `buildRegistryModel` projection
 * `registry/provider.ts` reads for F8.4's browse screen. This is honestly
 * **Olea's own reading of her material**, never the examiner's declared
 * scope, and `GROVE_INFERRED_DISCLAIMER` (`./copy.ts`) says so on every
 * course section, every render — F8.1's own escape hatch for exactly this
 * case ("scope Olea inferred alone is a guess and must be labelled one").
 * A real F8.1 build (the six states, the registered-source denominator, the
 * growing-mid-course story) is a follow-up bead with `packages/core`
 * ownership; this is the host the standing offer card needed, not that
 * computation — see `ol-0r92.17`'s close evidence for the finding this
 * files as follow-up work.
 *
 * **The standing offer, filtered to its own course** — `retrospective/
 * offer-card.ts`'s own module doc names this exact shape: "a future grove
 * view would filter to its own course." `./provider.ts` computes every
 * card once and keeps, per course section, only the cards for that course.
 *
 * **Thin by design**, the same split every other view in this plugin draws
 * (`today/view.ts`, `gap/view.ts`, `registry/view.ts`, `retrospective/
 * view.ts`): everything this screen decides is in `./provider.ts`,
 * everything it says is in `./copy.ts`. No test file for this module and
 * none is expected — `obsidian` has no runtime outside a real host, so the
 * honesty properties are asserted against `./copy.ts` and `./provider.ts`
 * under Vitest instead.
 *
 * **Styles.** `packages/plugin/styles.css` is not this bead's file (not in
 * its `owns` set), so this view's classes have no stylesheet section yet
 * and render on host defaults meanwhile — the same honest gap `gap/view.ts`
 * names for itself.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { MasteryState } from 'olea-contracts';
import type { VaultPath } from 'olea-core';
import type { RetrospectiveOfferCard } from '../retrospective/offer-card.js';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  DISMISS_OFFER_ACTION,
  GROVE_EMPTY_COURSE,
  GROVE_INFERRED_DISCLAIMER,
  GROVE_UNAVAILABLE,
  GROVE_VIEW_TITLE,
  OPEN_RETROSPECTIVE_ACTION,
} from './copy.js';

export const VIEW_TYPE_OLEA_GROVE = 'olea-grove';

/** One concept row in a course's grove section — position only (growth stage), never a score. */
export interface GroveConceptRow {
  readonly conceptId: string;
  readonly name: string;
  readonly mastery: MasteryState;
}

/** One course's grove — see this module's doc for why `concepts` is Olea's own reading, not F8.1's examiner-declared scope. */
export interface GroveCourseSection {
  readonly course: string;
  readonly concepts: readonly GroveConceptRow[];
  /** This course's own standing offer card(s), D-134 Q1's "filter to its own course" half. */
  readonly offerCards: readonly RetrospectiveOfferCard[];
}

export type GroveViewState =
  | { readonly kind: 'model'; readonly courses: readonly GroveCourseSection[] }
  | { readonly kind: 'unavailable' };

export interface GroveViewDeps {
  /** Loads the view state. Async because it reads the vault. */
  readonly load: () => Promise<GroveViewState>;
  /** Opens the retrospective's own dedicated view (F8.8, `[D-134]` Q10) — the same door `main.ts`'s F7.7 command opens. */
  readonly openRetrospective: () => void;
  /** D-134 Q1's other ending — the offer's own dismiss, without opening. */
  readonly dismiss: (assessmentPath: VaultPath) => Promise<void>;
}

export class GroveView extends ItemView {
  private readonly deps: GroveViewDeps;

  constructor(leaf: WorkspaceLeaf, deps: GroveViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_GROVE;
  }

  override getDisplayText(): string {
    return GROVE_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'trees';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-grove-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-reads and redraws. Public so a host can refresh after her material changes, or after a dismiss on this screen — same convention `GapView.refresh`/`RegistryView.refresh` already set. */
  async refresh(): Promise<void> {
    this.render(await this.deps.load());
  }

  private render(state: GroveViewState): void {
    const root = this.contentEl;
    root.empty();
    root.createEl('h2', { text: GROVE_VIEW_TITLE });

    if (state.kind === 'unavailable') {
      root.createDiv({ cls: 'olea-grove-unavailable', text: GROVE_UNAVAILABLE });
      return;
    }

    for (const section of state.courses) this.renderCourse(root, section);
  }

  private renderCourse(parent: HTMLElement, section: GroveCourseSection): void {
    const box = parent.createDiv({ cls: 'olea-grove-course' });
    box.createDiv({ cls: 'olea-grove-course-name', text: section.course });
    box.createDiv({ cls: 'olea-grove-disclaimer', text: GROVE_INFERRED_DISCLAIMER });

    if (section.concepts.length === 0) {
      box.createDiv({ cls: 'olea-grove-empty', text: GROVE_EMPTY_COURSE });
    } else {
      const list = box.createDiv({ cls: 'olea-grove-concepts' });
      for (const row of section.concepts) this.renderConcept(list, row);
    }

    for (const card of section.offerCards) this.renderOfferCard(box, card);
  }

  private renderConcept(parent: HTMLElement, row: GroveConceptRow): void {
    const el = parent.createDiv({ cls: 'olea-grove-concept' });
    el.appendChild(renderSprig({ state: row.mastery, size: 12 }));
    el.createSpan({ cls: 'olea-grove-concept-name', text: row.name });
  }

  private renderOfferCard(parent: HTMLElement, card: RetrospectiveOfferCard): void {
    const el = parent.createDiv({ cls: 'olea-grove-offer' });
    el.createDiv({ cls: 'olea-grove-offer-line', text: card.line });

    const actions = el.createDiv({ cls: 'olea-grove-offer-actions' });
    const openButton = actions.createEl('button', {
      cls: 'olea-grove-offer-open',
      text: OPEN_RETROSPECTIVE_ACTION,
    });
    openButton.addEventListener('click', () => {
      this.deps.openRetrospective();
    });

    const dismissButton = actions.createEl('button', {
      cls: 'olea-grove-offer-dismiss',
      text: DISMISS_OFFER_ACTION,
    });
    dismissButton.addEventListener('click', () => {
      void this.deps.dismiss(card.assessmentPath).then(() => this.refresh());
    });
  }
}
