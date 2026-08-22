/**
 * The olive sprig — Olea's only progress indicator (F2.3, F2.11; `ol-t1hc`).
 *
 * `docs/Olea.dc.html` (service repo) calls it "the only progress bar in the whole thing".
 * `packages/core/src/mastery/sprig.ts` computes the state; this module is the plugin's half —
 * turning that state into the actual mark, which nothing in this plugin drew before `ol-t1hc`.
 *
 * Geometry, the fill/stroke rule and the two colour roles are
 * `docs/design/components/brand/SPRIG-GEOMETRY.md` (service repo), restated from the design
 * system's own `Sprig.jsx` — `SPRIG_LEAVES` below is that component's own `LEAVES` table,
 * copied, not reinterpreted.
 *
 * **Split in two on purpose.** `sprigPlan` is pure data — no DOM, no Obsidian — and is what this
 * module's test file actually exercises: leaf count and per-leaf fill state, both derived from
 * `MASTERY_DISPLAY` (`olea-core`) and never retyped here. F2.11's "one vocabulary used
 * everywhere" covers the leaf count exactly as much as it covers the word. `renderSprig` turns a
 * plan into real SVG nodes via `document.createElementNS` — Obsidian's `createEl` family does not
 * cover the SVG namespace, and its `createSvg` prototype extension only exists at runtime inside a
 * real host (same reason `today/view.ts` and `gap/view.ts` carry no test file of their own: DOM
 * building that needs a real host is exercised by running the plugin, not by Vitest). This repo's
 * Vitest config has no DOM environment configured — no `jsdom`/`happy-dom` dependency anywhere in
 * the workspace — and adding one mid-task would touch `pnpm-lock.yaml`, a file every lane in this
 * run reads. `renderSprig` itself is therefore left at the same untested boundary the view files
 * already accept; `sprigPlan` carries the logic actually worth asserting on.
 *
 * **The growth transition is NOT implemented here — a deliberate deferral, not an oversight.**
 * See `ol-t1hc`'s closing report for the full reasoning: neither `Sprig.jsx` nor
 * `MasterySprig.jsx` (the design system's own component sheet for this transition) carries any
 * animation code, only prose — "a new leaf draws itself once, the stem-side end first, eased
 * out". Inventing the per-leaf stem-side anchor geometry for five independently rotated, filled
 * ellipses from that prose alone, with no visual round-trip available to check it against, risks
 * shipping a leaf that visibly grows from the wrong point — worse than no motion at all, which is
 * exactly the trade the task brief itself sanctioned taking. `renderSprig` always draws the
 * current state statically; `prefers-reduced-motion` is therefore satisfied by construction —
 * nothing ever animates, so there is nothing to gate behind the media query.
 */

import type { MasteryState } from 'olea-contracts';
import { MASTERY_DISPLAY } from 'olea-core';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const SPRIG_VIEW_BOX = '0 0 24 24';

interface LeafGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly rotate: number;
}

/**
 * Bottom of the stem upward — fixed positions, `SPRIG-GEOMETRY.md` / `Sprig.jsx`'s own `LEAVES`
 * table. The order never changes; only how many are filled (`sprigPlan`'s job) does.
 */
const SPRIG_LEAVES: readonly LeafGeometry[] = [
  { cx: 9, cy: 17.5, rotate: -42 },
  { cx: 15, cy: 14.5, rotate: 42 },
  { cx: 9, cy: 11, rotate: -42 },
  { cx: 15, cy: 8, rotate: 42 },
  { cx: 12, cy: 5, rotate: 0 },
];

export interface SprigLeafPlan extends LeafGeometry {
  /** `true` → filled (olive, no stroke). `false` → outline only, never omitted. */
  readonly filled: boolean;
}

export interface SprigPlan {
  /** The mastery word — the sprig's accessible name, never a decorative empty alt. */
  readonly label: string;
  /** Always exactly 5 entries — one per fixed leaf position (`SPRIG-GEOMETRY.md`). */
  readonly leaves: readonly SprigLeafPlan[];
}

/**
 * The sprig's draw plan for one mastery state. Leaf count comes from `MASTERY_DISPLAY[state]
 * .leaves` — read live on every call, so a test that mutates `MASTERY_DISPLAY` sees this follow
 * without any caching layer in between.
 */
export function sprigPlan(state: MasteryState): SprigPlan {
  const display = MASTERY_DISPLAY[state];
  return {
    label: display.label,
    leaves: SPRIG_LEAVES.map((leaf, index) => ({ ...leaf, filled: index < display.leaves })),
  };
}

export interface RenderSprigOptions {
  readonly state: MasteryState;
  /** CSS pixels; the sprig is square. Defaults to 15 — inline-with-text size. */
  readonly size?: number;
}

/**
 * Builds one sprig as real SVG DOM: a stem (`.olea-sprig-stem`) and five fixed leaf positions
 * (`.olea-sprig-leaf-filled` / `.olea-sprig-leaf-empty`), coloured entirely by
 * `packages/plugin/styles.css`'s "Brand: the sprig" section — nothing here sets a colour
 * directly. `role="img"` plus `aria-label` carries the state word as a real accessible name.
 */
export function renderSprig(options: RenderSprigOptions): SVGSVGElement {
  const plan = sprigPlan(options.state);
  const size = options.size ?? 15;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', SPRIG_VIEW_BOX);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', plan.label);
  svg.classList.add('olea-sprig');

  const stem = document.createElementNS(SVG_NS, 'path');
  stem.setAttribute('d', 'M12 21 C 12 15, 12 9, 12 4');
  stem.classList.add('olea-sprig-stem');
  svg.appendChild(stem);

  for (const leaf of plan.leaves) {
    const ellipse = document.createElementNS(SVG_NS, 'ellipse');
    ellipse.setAttribute('cx', String(leaf.cx));
    ellipse.setAttribute('cy', String(leaf.cy));
    ellipse.setAttribute('rx', '3.4');
    ellipse.setAttribute('ry', '1.9');
    ellipse.setAttribute('transform', `rotate(${leaf.rotate} ${leaf.cx} ${leaf.cy})`);
    ellipse.classList.add(
      'olea-sprig-leaf',
      leaf.filled ? 'olea-sprig-leaf-filled' : 'olea-sprig-leaf-empty',
    );
    svg.appendChild(ellipse);
  }

  return svg;
}
