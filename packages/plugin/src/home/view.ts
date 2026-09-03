/**
 * `HomeView` — the Home host for the retrospective standing offer (F8.8,
 * `[D-134]` Q1, `ol-0r92.17`).
 *
 * **What "Home" means here, and why it is not the Pass 6/7 dashboard.**
 * `[D-134]`'s own ruling names the offer's two hosts as "Home and grove."
 * `docs/design/pass6-walkthrough/` and `docs/design/pass7-home-and-history/`
 * draw an ambitious "Olea Home" — session composition, per-course due rows,
 * mastery overview, quiet lines — but `docs/design/` kits are DP-1
 * evidence, never contract authority (see `docs/design/CLAUDE.md` and the
 * repo's own authority order): nothing in the functional scope grants that
 * dashboard its own clause, and building it here would mean new core
 * computation (`packages/core`) this bead does not own. Worse, Olea already
 * has a ruled, single front door — `TodayView` (F6.1/F7.7), settled by
 * David's own ruling (`ol-f77commands`, `[D-033]`): "the Today panel is the
 * front door... Pointing [a second command] at Today gives one action two
 * chords... which surface is Olea's front door... is David's, not a
 * lane's." A second, competing "landing" view here would relitigate that
 * exact question the wrong way — by building rather than asking. `today/`
 * is also outside this bead's `owns` set, so mounting the card there is not
 * an option regardless.
 *
 * So `HomeView` was scoped to exactly what F8.8/`[D-134]` Q1 requires and no
 * further: it hosted the standing offer, and nothing else. This matches
 * `retrospective/offer-card.ts`'s own module doc almost verbatim — "a
 * future Home view would render all of them [every card]; a future grove
 * view would filter to its own course" — this is that Home view, at
 * exactly that scope. The wider dashboard question (does "Home" ever
 * become `TodayView` renamed, or a real third surface with its own clause)
 * is recorded as a finding on `ol-0r92.17`'s close evidence rather than
 * decided here.
 *
 * **Widened once, deliberately, by `[D-213]` (`ol-0r92.47`).** The
 * first-read readout — per-folder honest counts plus streaming concepts,
 * F1.4's amended clause — needs a host that survives past any one
 * course-setup modal closing (`../course-setup/confirmation-view.ts`'s own
 * module doc explains why the modal alone cannot carry a forty-second-plus
 * moment). `[D-213]`'s own ruling names this "the F1.4 extraction pass made
 * visible where the course-setup confirmation already lives", and the
 * semester narrative's E2 ("she clicks into the Olea tab expecting something
 * to have happened") describes exactly this surface, not the modal. This is
 * therefore a second, decision-authorised addition to "and nothing else"
 * above, not a lane relitigating `[D-033]`'s front-door ruling on its own
 * initiative — `'first-read'` is one more `HomeViewState` variant beside
 * `'offers'`/`'unavailable'`, not a new dashboard.
 *
 * **Thin by design**, the same split every other view in this plugin draws.
 * No test file for this module and none is expected — see `today/view.ts`'s
 * module doc for why (`obsidian` has no runtime under Vitest); the honesty
 * properties are asserted against `./copy.ts`, `./provider.ts` and
 * `../course-setup/confirmation-copy.ts` instead.
 *
 * **Styles.** `packages/plugin/styles.css` is outside this bead's `owns`
 * set — this view's classes render on host defaults meanwhile, the same
 * honest gap `gap/view.ts` and `grove/view.ts` both name for themselves.
 *
 * **Reachability gap.** `HomeViewDeps.load`'s real, production implementation
 * (`createLocalHomeProvider`, `./provider.ts`, not owned by `ol-0r92.47`) has
 * no course-folder concept to ever return `{ kind: 'first-read' }` from —
 * wiring that in is a `main.ts`/`provider.ts` change outside this bead's
 * `owns` set. See `../course-setup/confirmation-view.ts`'s module doc for the
 * matching gap on the modal side, and this bead's close evidence for the
 * follow-up.
 */

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { VaultPath } from 'olea-core';
import { renderFirstReadReadout } from '../course-setup/confirmation-view.js';
import type { FirstReadFolderView } from '../ingestion/wiring.js';
import type { RetrospectiveOfferCard } from '../retrospective/offer-card.js';
import {
  DISMISS_OFFER_ACTION,
  HOME_NOTHING_STANDING,
  HOME_UNAVAILABLE,
  HOME_VIEW_TITLE,
  OPEN_RETROSPECTIVE_ACTION,
} from './copy.js';

export const VIEW_TYPE_OLEA_HOME = 'olea-home';

export type HomeViewState =
  | { readonly kind: 'offers'; readonly cards: readonly RetrospectiveOfferCard[] }
  | { readonly kind: 'first-read'; readonly folders: readonly FirstReadFolderView[] }
  | { readonly kind: 'unavailable' };

export interface HomeViewDeps {
  /** Loads the view state. Async because it reads the vault. */
  readonly load: () => Promise<HomeViewState>;
  /** Opens the retrospective's own dedicated view (F8.8, `[D-134]` Q10). */
  readonly openRetrospective: () => void;
  /** D-134 Q1's other ending — the offer's own dismiss, without opening. */
  readonly dismiss: (assessmentPath: VaultPath) => Promise<void>;
}

export class HomeView extends ItemView {
  private readonly deps: HomeViewDeps;

  constructor(leaf: WorkspaceLeaf, deps: HomeViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  override getViewType(): string {
    return VIEW_TYPE_OLEA_HOME;
  }

  override getDisplayText(): string {
    return HOME_VIEW_TITLE;
  }

  override getIcon(): string {
    return 'home';
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass('olea-home-root');
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Re-reads and redraws. Public so a host can refresh after a dismiss, or after her material changes — same convention every other view in this plugin sets. */
  async refresh(): Promise<void> {
    this.render(await this.deps.load());
  }

  private render(state: HomeViewState): void {
    const root = this.contentEl;
    root.empty();
    root.createEl('h2', { text: HOME_VIEW_TITLE });

    if (state.kind === 'unavailable') {
      root.createDiv({ cls: 'olea-home-unavailable', text: HOME_UNAVAILABLE });
      return;
    }

    if (state.kind === 'first-read') {
      renderFirstReadReadout(root, state.folders);
      return;
    }

    if (state.cards.length === 0) {
      root.createDiv({ cls: 'olea-home-empty', text: HOME_NOTHING_STANDING });
      return;
    }

    const list = root.createDiv({ cls: 'olea-home-offers' });
    for (const card of state.cards) this.renderCard(list, card);
  }

  private renderCard(parent: HTMLElement, card: RetrospectiveOfferCard): void {
    const el = parent.createDiv({ cls: 'olea-home-offer' });
    el.createDiv({ cls: 'olea-home-offer-course', text: card.course });
    el.createDiv({ cls: 'olea-home-offer-line', text: card.line });

    const actions = el.createDiv({ cls: 'olea-home-offer-actions' });
    const openButton = actions.createEl('button', {
      cls: 'olea-home-offer-open',
      text: OPEN_RETROSPECTIVE_ACTION,
    });
    openButton.addEventListener('click', () => {
      this.deps.openRetrospective();
    });

    const dismissButton = actions.createEl('button', {
      cls: 'olea-home-offer-dismiss',
      text: DISMISS_OFFER_ACTION,
    });
    dismissButton.addEventListener('click', () => {
      void this.deps.dismiss(card.assessmentPath).then(() => this.refresh());
    });
  }
}
