/**
 * The olive sprig — Olea's only progress indicator (F2.3, F2.11; `ol-t1hc`, `VOC-1`/`ol-7efk`).
 *
 * `docs/Olea.dc.html` (service repo) calls it "the only progress bar in the whole thing".
 * `packages/core/src/mastery/sprig.ts` computes the state; this module is the plugin's half —
 * turning that state into the actual mark.
 *
 * **Geometry is parameterised per stage, not one leaf filled out of five fixed positions.**
 * D-048/D-049 retired that five-fixed-leaf reading (it drew a demotion whenever evidence
 * weakened, exactly the reading two axes exist to remove — see `docs/Olea_vocabulary_registry.md`
 * §1). `SPRIG_GEOMETRY` below is `StageSprig`'s own `GEOM[4]` table from
 * `docs/design/pass5b-mastery-ratified/ui_kits/olea-plugin/MasteryAxes.jsx` (service repo),
 * copied coordinate-for-coordinate, not reinterpreted: `seed` draws a small ellipse and no stem;
 * `sprout` a stem to one leaf; `sapling` a taller stem to three leaves; `tree` the same three
 * leaves plus fruit — never a fourth leaf.
 *
 * **Split in two on purpose.** `sprigPlan` is pure data — no DOM, no Obsidian — and is what this
 * module's test file actually exercises: which parts a stage draws, read from `SPRIG_GEOMETRY`
 * plus the label from `MASTERY_DISPLAY` (`olea-core`), never retyped here. `renderSprig` turns a
 * plan into real SVG nodes via `container.ownerDocument.createElementNS` — Obsidian's `createEl`
 * family does not cover the SVG namespace, and its `createSvg` prototype extension only exists at
 * runtime inside a real host (same reason `today/view.ts` and `gap/view.ts` carry no test file of
 * their own: DOM building that needs a real host is exercised by running the plugin, not by
 * Vitest). Every node is created via the caller's mount-point `container`, never the ambient
 * global `document` — a popped-out Obsidian tab or an iframe-isolated host has its own `Document`,
 * exactly the shape `ol-rq23` fixed in `ReviewView` (`ol-dth1`). This repo's Vitest config has no
 * DOM environment configured — no `jsdom`/`happy-dom` dependency anywhere in the workspace — and
 * adding one mid-task would touch `pnpm-lock.yaml`, a file every lane in this run reads.
 * `renderSprig` itself is therefore left at the same untested boundary the view files already
 * accept; `sprigPlan` carries the logic actually worth asserting on, and this file's own document-
 * ownership property is asserted at the source-text level (`test/sprig/render-sprig.spec.ts`),
 * same convention as `ol-rq23`'s `view-focus-document.spec.ts`.
 *
 * **The growth transition and the vitality wilt are NOT implemented here — a deliberate
 * deferral, not an oversight.** See `ol-t1hc`'s closing report for the growth-transition
 * reasoning (unchanged by this landing: `MasterySprig.jsx` still carries only prose, no
 * animation code, for "a new leaf draws itself once, stem-side end first"). Vitality is not yet a
 * persisted field anywhere in this codebase (wiring it is `MAT-2`'s scope), so the `wilt` overlay
 * `StageSprig` also draws has nothing to read from here and is not built. `renderSprig` always
 * draws the current growth stage statically; `prefers-reduced-motion` is therefore satisfied by
 * construction — nothing ever animates, so there is nothing to gate behind the media query.
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

interface FruitGeometry {
  readonly cx: number;
  readonly cy: number;
}

interface StageGeometry {
  /** `true` only for `seed`: a small ellipse, no stem and no leaves. */
  readonly seed: boolean;
  /** Y-coordinate the stem path ends at. `null` for `seed`, which has no stem. */
  readonly stemTop: number | null;
  /** 0, 1 or 3 entries, bottom of the stem upward — never a fourth leaf. */
  readonly leaves: readonly LeafGeometry[];
  /** Present only at `tree` — the same three leaves gain fruit, never a new leaf. */
  readonly fruit: FruitGeometry | null;
}

/**
 * `StageSprig`'s `GEOM[4]` table (`MasteryAxes.jsx`), copied coordinate-for-coordinate. The
 * `wilt` overlay in that component (leaves droop 15°, fill softens to 50%, fruit stays put) is
 * vitality, which is not built here — see this module's doc.
 */
const SPRIG_GEOMETRY: Readonly<Record<MasteryState, StageGeometry>> = {
  seed: { seed: true, stemTop: null, leaves: [], fruit: null },
  sprout: {
    seed: false,
    stemTop: 13,
    leaves: [{ cx: 8.6, cy: 15.6, rotate: -42 }],
    fruit: null,
  },
  sapling: {
    seed: false,
    stemTop: 7.6,
    leaves: [
      { cx: 8.6, cy: 16, rotate: -42 },
      { cx: 15.4, cy: 12.4, rotate: 42 },
      { cx: 8.6, cy: 8.9, rotate: -42 },
    ],
    fruit: null,
  },
  tree: {
    seed: false,
    stemTop: 8.4,
    leaves: [
      { cx: 8.6, cy: 16, rotate: -42 },
      { cx: 15.4, cy: 12.4, rotate: 42 },
      { cx: 8.6, cy: 8.9, rotate: -42 },
    ],
    fruit: { cx: 12, cy: 5.4 },
  },
};

export interface SprigPlan {
  /** The mastery word — the sprig's accessible name, never a decorative empty alt. */
  readonly label: string;
  /** `true` only for `seed` — draw the seed ellipse instead of a stem. */
  readonly seed: boolean;
  /** Stem end y-coordinate, or `null` when `seed` (no stem is drawn). */
  readonly stemTop: number | null;
  /** 0, 1 or 3 entries — every leaf drawn is filled; there is no outline/empty leaf. */
  readonly leaves: readonly LeafGeometry[];
  /** Present only at the top stage. */
  readonly fruit: FruitGeometry | null;
}

/**
 * The sprig's draw plan for one growth stage. Geometry comes from `SPRIG_GEOMETRY`, the label
 * from `MASTERY_DISPLAY` — read live on every call, so a test that mutates either sees this
 * follow without any caching layer in between.
 */
export function sprigPlan(state: MasteryState): SprigPlan {
  const geometry = SPRIG_GEOMETRY[state];
  return {
    label: MASTERY_DISPLAY[state].label,
    seed: geometry.seed,
    stemTop: geometry.stemTop,
    leaves: geometry.leaves,
    fruit: geometry.fruit,
  };
}

export interface RenderSprigOptions {
  readonly state: MasteryState;
  /** CSS pixels; the sprig is square. Defaults to 15 — inline-with-text size. */
  readonly size?: number;
  /**
   * The element the returned SVG is about to be appended under. Every node this function
   * creates comes from `container.ownerDocument`, never the ambient global `document` — the
   * same fix shape as `ol-rq23`'s `ReviewView` (`root.ownerDocument.activeElement`): a
   * popped-out Obsidian tab or an iframe-isolated host has its own `Document`, and building
   * nodes in the wrong one leaves them unable to actually appear where the caller mounts them.
   */
  readonly container: Element;
}

/**
 * Builds one sprig as real SVG DOM — a seed ellipse (`.olea-sprig-seed`) or a stem
 * (`.olea-sprig-stem`) plus its leaves (`.olea-sprig-leaf`) and, at `tree`, fruit
 * (`.olea-sprig-fruit`) — coloured entirely by `packages/plugin/styles.css`'s "Brand: the
 * sprig" section — nothing here sets a colour directly. `role="img"` plus `aria-label` carries
 * the state word as a real accessible name.
 */
export function renderSprig(options: RenderSprigOptions): SVGSVGElement {
  const plan = sprigPlan(options.state);
  const size = options.size ?? 15;
  const doc = options.container.ownerDocument;

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', SPRIG_VIEW_BOX);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', plan.label);
  svg.classList.add('olea-sprig');

  if (plan.seed) {
    const seed = doc.createElementNS(SVG_NS, 'ellipse');
    seed.setAttribute('cx', '12');
    seed.setAttribute('cy', '16.4');
    seed.setAttribute('rx', '2.7');
    seed.setAttribute('ry', '3.6');
    seed.setAttribute('transform', 'rotate(-16 12 16.4)');
    seed.classList.add('olea-sprig-seed');
    svg.appendChild(seed);
  } else if (plan.stemTop !== null) {
    const stem = doc.createElementNS(SVG_NS, 'path');
    stem.setAttribute('d', `M12 21 C 12 17, 12 ${plan.stemTop + 3}, 12 ${plan.stemTop}`);
    stem.classList.add('olea-sprig-stem');
    svg.appendChild(stem);
  }

  for (const leaf of plan.leaves) {
    const ellipse = doc.createElementNS(SVG_NS, 'ellipse');
    ellipse.setAttribute('cx', String(leaf.cx));
    ellipse.setAttribute('cy', String(leaf.cy));
    ellipse.setAttribute('rx', '3.4');
    ellipse.setAttribute('ry', '1.9');
    ellipse.setAttribute('transform', `rotate(${leaf.rotate} ${leaf.cx} ${leaf.cy})`);
    ellipse.classList.add('olea-sprig-leaf');
    svg.appendChild(ellipse);
  }

  if (plan.fruit !== null) {
    const fruit = doc.createElementNS(SVG_NS, 'circle');
    fruit.setAttribute('cx', String(plan.fruit.cx));
    fruit.setAttribute('cy', String(plan.fruit.cy));
    fruit.setAttribute('r', '2.7');
    fruit.classList.add('olea-sprig-fruit');
    svg.appendChild(fruit);
  }

  return svg;
}
