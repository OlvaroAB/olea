/**
 * The runtime variable-set switcher.
 *
 * Each set supplies **Obsidian's own CSS variables** — `--background-*`,
 * `--text-*`, `--interactive-accent`, `--font-*`. Nothing here supplies an
 * `--olea-host-*` role: that mapping already exists, once, in
 * `packages/plugin/styles.css` (ported from the approved
 * `docs/design/pass1/tokens/theme-host.css`), and the workbench loads that file
 * unmodified. A second copy of the role layer here would be a second thing to
 * keep in sync and a place for the two to disagree silently.
 *
 * So the switcher's job is deliberately small: pick which stylesheets define
 * Obsidian's variables and in what order, and put `theme-dark` or `theme-light`
 * on the host pane. Everything downstream — role mapping, owned colours, the
 * review view's own `theme-dark` (F2.4) — is the product's real CSS doing its
 * real job.
 *
 * Since `ol-mioe` the host pane is its own document (`../host-frame.ts`), so
 * "the host pane" below means the frame's `<body>` and the stylesheets are
 * loaded into the frame rather than into the page.
 *
 * ## `ol-itiu` — a community theme LAYERS, it does not replace
 *
 * This switcher used to load exactly one stylesheet at a time: selecting Things
 * *disabled* `obsidian-default.css`. Obsidian never does that. `app.css` is
 * always loaded and cannot be turned off; a community theme is layered on top of
 * it and overrides selectively. Things is written on that assumption — it
 * declares only 3 of the 8 branch-varying variables `styles.css` reads
 * (`--text-muted` and `--text-faint` in both branches, `--background-modifier-hover`
 * in its light branch only) and none of `--background-primary`,
 * `--background-primary-alt`, `--text-normal`, `--background-modifier-border`,
 * `--background-modifier-border-hover`, because app.css already has them. It
 * also *reads* several of those without declaring them, which is the plainest
 * possible evidence that it expects a baseline underneath.
 *
 * **So the exclusive swap was not a small infidelity: it changed which of our own
 * fallbacks the workbench exercises,** and therefore what its findings mean. Any
 * Q6.1 claim of the form "this fallback is reached" has to name which kind of set
 * it was measured under. Both kinds are informative; conflating them is the bug.
 *
 * Layering also does more than fill gaps with Obsidian's colours. `obsidian-default.css`
 * writes its semantic roles as `var(--color-base-NN)`, and Things redeclares those
 * base steps in **both** branches — so with the baseline underneath, a role Things
 * never mentions still resolves to *Things'* palette through the baseline's mapping.
 * That is the behaviour a community theme is designed to produce.
 *
 * ## The limit of the model, stated here rather than discovered later
 *
 * `obsidian-default.css`'s semantic mapping is a **reconstruction** (its own
 * header says so), and one part of that reconstruction is load-bearing for
 * exactly this question: it scopes the semantic roles under bare
 * `.theme-dark` / `.theme-light` selectors. Real `app.css` might instead alias
 * them in a `body` block from per-branch `--color-base-*`. **Which one it does is
 * not published, and nobody on this project has checked.** It matters because
 * F2.4 nests a `theme-dark` review root inside a `theme-light` body:
 *
 * - under the bare-`.theme-dark` model the root matches the baseline's dark block
 *   directly and gets dark values for everything the theme is silent about;
 * - under the `body`-alias model the baseline declares nothing that matches the
 *   root at all, so the root falls to `styles.css`'s own
 *   `@layer olea-host-fallback` floor — which is also dark.
 *
 * Both land dark, which is why `ol-ro57`'s fix does not depend on the answer (see
 * the README). But the *colours* differ between the two models, so a `things-light`
 * screenshot is faithful only under the model this reconstruction commits to. A
 * second reconstruction modelling the other scoping is deliberately **not** shipped
 * here: it would be a second unverified guess presented as an option, which is
 * worse than one guess that says out loud what it is.
 */

import type { HostFrame } from '../host-frame.js';

/** The stylesheets this package can load into the host document. */
export type ThemeSheetId = 'obsidian-default' | 'things';

/**
 * Whether the baseline (`obsidian-default.css`, standing in for `app.css`) is
 * underneath the selected theme.
 *
 * - `present` — models a real Obsidian install.
 * - `stripped` — deliberately does not. The host supplies only what the theme
 *   itself declares, so every read the theme is silent about lands on
 *   `styles.css`'s own fallback. That is a useful thing to be able to render on
 *   purpose; it is not a thing to render by accident, which is what `ol-itiu`
 *   was.
 */
export type BaselineMode = 'present' | 'stripped';

export interface VariableSet {
  readonly id: string;
  readonly label: string;
  /**
   * Which stylesheets define Obsidian's variables, **in cascade order**: the
   * baseline first, the community theme on top of it. Last wins on a tie, which
   * is how a theme overrides selectively.
   */
  readonly sheets: readonly ThemeSheetId[];
  /** Whether this set models Obsidian's always-present baseline. */
  readonly baseline: BaselineMode;
  /** Which branch of it the host is in. */
  readonly mode: 'dark' | 'light';
  readonly note: string;
}

/** Where `build.mjs` puts each stylesheet. */
export const THEME_SHEET_HREF: Readonly<Record<ThemeSheetId, string>> = {
  'obsidian-default': './themes/obsidian-default.css',
  things: './themes/things.css',
};

/** The stand-in for `app.css`: always underneath, unless a set strips it on purpose. */
export const BASELINE_SHEET: ThemeSheetId = 'obsidian-default';

export const VARIABLE_SETS: readonly VariableSet[] = [
  {
    id: 'obsidian-dark',
    label: 'Obsidian default · dark',
    sheets: [BASELINE_SHEET],
    baseline: 'present',
    mode: 'dark',
    note: 'Obsidian default theme, dark — the baseline with no community theme over it. Base colours from the official CSS-variables reference; semantic mapping reconstructed — see the stylesheet header.',
  },
  {
    id: 'obsidian-light',
    label: 'Obsidian default · light',
    sheets: [BASELINE_SHEET],
    baseline: 'present',
    mode: 'light',
    note: 'Obsidian default theme, light. The review surface stays dark: F2.4 puts `theme-dark` on the view root regardless of the host.',
  },
  {
    id: 'things-dark',
    label: 'Things (community) · dark',
    sheets: [BASELINE_SHEET, 'things'],
    baseline: 'present',
    mode: 'dark',
    note: 'Models a real install: the baseline underneath, Things 2.2.4 layered on top, as Obsidian loads app.css then a theme. Things is vendored verbatim under MIT — see vendor/things/PROVENANCE.md.',
  },
  {
    id: 'things-light',
    label: 'Things (community) · light',
    sheets: [BASELINE_SHEET, 'things'],
    baseline: 'present',
    mode: 'light',
    note: 'Things 2.2.4 over the baseline, light branch. Same F2.4 behaviour as the light default. This is where ol-ro57 was found.',
  },
  {
    id: 'things-dark-no-baseline',
    label: 'Things · dark · baseline stripped',
    sheets: ['things'],
    baseline: 'stripped',
    mode: 'dark',
    note: 'NOT a model of Obsidian. Things alone, with no app.css stand-in underneath, so every host read Things does not declare falls to styles.css’s own fallback. For exercising those fallbacks deliberately (ol-itiu).',
  },
  {
    id: 'things-light-no-baseline',
    label: 'Things · light · baseline stripped',
    sheets: ['things'],
    baseline: 'stripped',
    mode: 'light',
    note: 'NOT a model of Obsidian. The exclusive-swap behaviour every workbench finding before ol-itiu was measured under — kept addressable so those findings stay reproducible.',
  },
];

export const DEFAULT_VARIABLE_SET = 'obsidian-dark';

export function findVariableSet(id: string): VariableSet | undefined {
  return VARIABLE_SETS.find((set) => set.id === id);
}

/**
 * Applies a set inside the host frame: loads that set's stylesheets in cascade
 * order into the frame's document and puts `theme-dark`/`theme-light` on the
 * frame's `<body>`, exactly where Obsidian puts one of those.
 *
 * **The chrome is not themed and now cannot be** (`ol-mioe`). Before the frame,
 * the theme was loaded into the same document as the sidebar and inspector and
 * its bare-element rules reached them; the chrome's defence was a
 * zero-specificity reset that a higher-specificity theme rule beat. The
 * stylesheet now lives in a document the chrome is not in, so the boundary is a
 * property of the document rather than of a CSS reset.
 *
 * `data-wb-variable-set` and `data-wb-baseline` are set on **both** the
 * `<iframe>` element (readable from the top document, so WB-2 can read the
 * matrix without entering the frame) and the frame's `<body>`.
 * `data-wb-baseline` is not decoration: `ol-itiu`'s acceptance criterion is that
 * evidence produced here says which of the two load models it came from, and an
 * attribute a screenshot pass already reads is the only version of that which
 * cannot be forgotten.
 */
export async function applyVariableSet(set: VariableSet, frame: HostFrame): Promise<void> {
  await frame.setThemeSheets(set.sheets.map((sheet) => THEME_SHEET_HREF[sheet]));
  frame.body.classList.remove('theme-dark', 'theme-light');
  frame.body.classList.add(set.mode === 'dark' ? 'theme-dark' : 'theme-light');
  frame.body.setAttribute('data-wb-variable-set', set.id);
  frame.body.setAttribute('data-wb-baseline', set.baseline);
  frame.element.setAttribute('data-wb-variable-set', set.id);
  frame.element.setAttribute('data-wb-baseline', set.baseline);
}
