/**
 * The one place mastery vocabulary becomes words on a screen (F2.11, D-049).
 *
 * F2.11 requires a single growth-stage vocabulary on every surface that shows
 * mastery — the review view, the Today panel, the concept detail and the gap
 * view must not drift into synonyms. The enforcement mechanism is not a convention: it is that
 * this file is the only site holding display strings, so there is nowhere
 * else for a second vocabulary to come from. A view that wants to render
 * mastery imports `MASTERY_DISPLAY`; a view that hardcodes "Developing"
 * instead is visibly doing something this module already does.
 *
 * **This module carries the growth-stage axis only.** Vitality — `holding` /
 * `needs tending` / `too early to say`, the fluctuating overlay
 * (`docs/Olea_vocabulary_registry.md` §1 axis 2) — is not modelled here and
 * is not yet a persisted field anywhere in this codebase; wiring it to a real
 * retrievability reading is `MAT-2`'s (`ol-95vv`) job, not this file's.
 *
 * `leaves` and `fruit` belong here rather than in a rendering layer because
 * the sprig's geometry *is* the state, not a decoration of it. **The sprig is
 * parameterised geometry, not one leaf per stage at a fixed position** — the
 * reference implementation is `StageSprig` in
 * `docs/design/pass5b-mastery-ratified/ui_kits/olea-plugin/MasteryAxes.jsx`:
 * `seed` draws no stem and no leaves, `sprout` adds one leaf, `sapling` adds
 * two more (three total), and `tree` adds fruit to the same three leaves —
 * never a fourth leaf. Keeping the shape next to the label means a future
 * sprig component cannot pick a different mapping by accident, and cannot
 * regress to the retired "one leaf per stage, four fixed positions" reading
 * a naive stage-count edit would otherwise produce (`VOC-1`, `ol-7efk`).
 *
 * This module holds no Obsidian dependency and no styling. It is deliberately
 * in core rather than in the plugin: the vocabulary is a contract-adjacent
 * fact that P4-T06's rollup, the design system's copy review, and every view
 * must all agree on, and only one of those lives in the plugin.
 */

import type { MasteryState } from 'olea-contracts';

export interface MasteryDisplay {
  /** The user-facing word, exactly as F2.11 writes it. Lowercase is intentional — see `Title`. */
  readonly label: string;
  /** Sprig leaf count at this stage — 0, 1 or 3. The top stage adds fruit, never a fourth leaf (F2.11, D-049). */
  readonly leaves: 0 | 1 | 3;
  /** Whether the sprig bears fruit at this stage — true only for `tree` (F2.11, D-049). */
  readonly fruit: boolean;
  /**
   * What this state means, in the product's voice. Information and
   * consequence, never verdict (principle 12) — every line below describes
   * the *evidence*, not the student.
   */
  readonly meaning: string;
}

/**
 * Ordered least to most evidence. The order is load-bearing for any view that
 * renders a distribution strip (F2.11's Today rollup), so it is fixed here
 * rather than re-derived from `Object.keys` at each call site.
 */
export const MASTERY_ORDER: readonly MasteryState[] = ['seed', 'sprout', 'sapling', 'tree'];

export const MASTERY_DISPLAY: Readonly<Record<MasteryState, MasteryDisplay>> = {
  seed: {
    label: 'seed',
    leaves: 0,
    fruit: false,
    meaning: 'Not practised yet.',
  },
  sprout: {
    label: 'sprout',
    leaves: 1,
    fruit: false,
    meaning: 'Practised. Recall is not holding yet.',
  },
  sapling: {
    label: 'sapling',
    leaves: 3,
    fruit: false,
    meaning: 'Recalled reliably across spaced attempts.',
  },
  tree: {
    // R7's ceiling: recognition alone cannot reach this state, however many
    // MCQ items are answered correctly. Producing or explaining the thing is
    // the evidence that distinguishes `tree` from `sapling`, and the wording
    // says so rather than leaving the difference to be inferred from a leaf.
    label: 'tree',
    leaves: 3,
    fruit: true,
    meaning: 'Explained back in your own words, not only recognised.',
  },
};

/**
 * Sentence-case form for headings and standalone chips. The stored labels are
 * lowercase because they read as her words mid-sentence ("this one's coming"),
 * and a view that needs a capital should ask for one rather than keep a second
 * capitalised copy of the vocabulary.
 */
export function masteryTitle(state: MasteryState): string {
  const label = MASTERY_DISPLAY[state].label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
