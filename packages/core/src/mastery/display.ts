/**
 * The one place mastery vocabulary becomes words on a screen (F2.11, D-017).
 *
 * F2.11 requires a single mastery vocabulary on every surface that shows
 * mastery — the review view, the Today panel, the concept detail and the gap
 * view must not drift into synonyms. The enforcement mechanism is not a convention: it is that
 * this file is the only site holding display strings, so there is nowhere
 * else for a second vocabulary to come from. A view that wants to render
 * mastery imports `MASTERY_DISPLAY`; a view that hardcodes "Developing"
 * instead is visibly doing something this module already does.
 *
 * `leaves` belongs here rather than in a rendering layer because the sprig's
 * leaf count *is* the state, not a decoration of it — F2.11 defines the five
 * states as 1–5 leaves. Keeping the number next to the label means a future
 * sprig component cannot pick a different mapping by accident.
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
  /** Sprig leaf count, 1–5 (F2.11). */
  readonly leaves: 1 | 2 | 3 | 4 | 5;
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
export const MASTERY_ORDER: readonly MasteryState[] = ['new', 'shaky', 'coming', 'solid', 'yours'];

export const MASTERY_DISPLAY: Readonly<Record<MasteryState, MasteryDisplay>> = {
  new: {
    label: 'new',
    leaves: 1,
    meaning: 'No practice recorded yet.',
  },
  shaky: {
    label: 'shaky',
    leaves: 2,
    meaning: 'Recalled sometimes, missed sometimes.',
  },
  coming: {
    label: 'coming',
    leaves: 3,
    meaning: 'Recalled more often than not, and recently.',
  },
  solid: {
    label: 'solid',
    leaves: 4,
    meaning: 'Recalled reliably across spaced attempts.',
  },
  yours: {
    // R7's ceiling: recognition alone cannot reach this state, however many
    // MCQ items are answered correctly. Producing or explaining the thing is
    // the evidence that distinguishes `yours` from `solid`, and the wording
    // says so rather than leaving the difference to be inferred from a leaf.
    label: 'yours',
    leaves: 5,
    meaning: 'Produced or explained in your own words, not only recognised.',
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
