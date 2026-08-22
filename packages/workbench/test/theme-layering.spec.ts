/**
 * ol-itiu: **the baseline stays underneath; a community theme layers on top.**
 *
 * WHAT WENT WRONG, AND WHY IT IS NOT A COSMETIC BUG. The switcher used to load
 * exactly one stylesheet at a time, so selecting Things *disabled* the app.css
 * stand-in. Obsidian cannot do that — app.css is always loaded — and Things is
 * written on that assumption: it declares only 3 of the 8 branch-varying
 * variables `styles.css` reads, and it *reads* several it never declares. So the
 * exclusive swap pushed most of our host reads onto Olea's own fallbacks, which
 * in a real install would have resolved from app.css.
 *
 * That changed what the workbench's findings MEAN, not just how it looked:
 * "this fallback is exercised" was true here and false in the product. The fix is
 * to model both load orders and make every set say which one it is, so a Q6.1
 * claim can name its own conditions.
 *
 * WHAT THIS FILE CAN AND CANNOT ASSERT. It asserts the load model — the ordered
 * list of sheets, and the attributes that record which model a screenshot came
 * from. It cannot assert a resolved colour: that needs a browser, and it is
 * WB-2's (`ol-z6x2`) job. The value here is that a silent return to the
 * exclusive swap — one array literal away — goes red.
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HostFrame } from '../src/host-frame.js';
import {
  applyVariableSet,
  BASELINE_SHEET,
  DEFAULT_VARIABLE_SET,
  findVariableSet,
  THEME_SHEET_HREF,
  VARIABLE_SETS,
} from '../src/themes/index.js';

const WORKBENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Enough of a `HostFrame` to record what `applyVariableSet` asked for. Not a
 * mock of the cascade — there is no cascade here — just a tape of the calls, so
 * the assertions are about the switcher's decisions and nothing else.
 */
function recordingFrame(): {
  frame: HostFrame;
  sheets: string[][];
  bodyAttrs: Map<string, string>;
  elementAttrs: Map<string, string>;
  classes: Set<string>;
} {
  const sheets: string[][] = [];
  const bodyAttrs = new Map<string, string>();
  const elementAttrs = new Map<string, string>();
  const classes = new Set<string>();
  const frame = {
    body: {
      classList: {
        add: (...names: string[]) => {
          for (const name of names) classes.add(name);
        },
        remove: (...names: string[]) => {
          for (const name of names) classes.delete(name);
        },
      },
      setAttribute: (name: string, value: string) => void bodyAttrs.set(name, value),
    },
    element: {
      setAttribute: (name: string, value: string) => void elementAttrs.set(name, value),
    },
    setThemeSheets: (hrefs: readonly string[]) => {
      sheets.push([...hrefs]);
      return Promise.resolve();
    },
  } as unknown as HostFrame;
  return { frame, sheets, bodyAttrs, elementAttrs, classes };
}

describe('variable sets model a load order, not a single stylesheet (ol-itiu)', () => {
  it('gives every set a unique id and a sheet list that is never empty', () => {
    const ids = VARIABLE_SETS.map((set) => set.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const set of VARIABLE_SETS) {
      expect(set.sheets.length, set.id).toBeGreaterThan(0);
      expect(new Set(set.sheets).size, set.id).toBe(set.sheets.length);
    }
    expect(findVariableSet(DEFAULT_VARIABLE_SET)).toBeDefined();
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. A community theme over a baseline is
   * two sheets with the baseline FIRST — first because CSS resolves a tie on
   * source order, and every interesting collision here is a tie: Obsidian's
   * `.theme-dark` and Things' `.theme-dark` are both (0,1,0). Baseline second
   * would invert the override direction and look almost right.
   */
  it('puts the baseline first in every set that claims to model Obsidian', () => {
    const layered = VARIABLE_SETS.filter((set) => set.baseline === 'present');
    expect(layered.length).toBeGreaterThan(0);
    for (const set of layered) {
      expect(set.sheets[0], set.id).toBe(BASELINE_SHEET);
      expect(
        set.sheets.filter((sheet) => sheet === BASELINE_SHEET),
        set.id,
      ).toHaveLength(1);
    }
  });

  it('strips the baseline only where a set says so, and says so in its note', () => {
    const stripped = VARIABLE_SETS.filter((set) => set.baseline === 'stripped');
    // Both branches: the light one is where ol-ro57 lived, and the dark one is
    // its control. A single stripped set would make the comparison one-sided.
    expect(stripped).toHaveLength(2);
    expect(stripped.map((set) => set.mode).sort()).toEqual(['dark', 'light']);
    for (const set of stripped) {
      expect(set.sheets, set.id).not.toContain(BASELINE_SHEET);
      // A set that silently strips the baseline is the original defect wearing a
      // different name, so the id and the note both have to give it away.
      expect(set.id, set.id).toContain('no-baseline');
      expect(set.note, set.id).toMatch(/NOT a model of Obsidian/);
    }
  });

  it('carries the community theme in both branches over the baseline', () => {
    const overBaseline = VARIABLE_SETS.filter(
      (set) => set.baseline === 'present' && set.sheets.length > 1,
    );
    expect(overBaseline.map((set) => set.mode).sort()).toEqual(['dark', 'light']);
    for (const set of overBaseline) {
      expect(set.sheets.at(-1), set.id).not.toBe(BASELINE_SHEET);
    }
  });

  it('references only stylesheets the build actually ships', () => {
    const build = readFileSync(join(WORKBENCH_ROOT, 'build.mjs'), 'utf8');
    const used = new Set(VARIABLE_SETS.flatMap((set) => set.sheets));
    expect(used.size).toBeGreaterThan(1);
    for (const sheet of used) {
      const href = THEME_SHEET_HREF[sheet];
      expect(href, sheet).toMatch(/^\.\/themes\//);
      // The build writes each of these into `dist/themes/`; a set pointing at a
      // sheet nobody copies would 404 in the frame and render as a missing
      // baseline — i.e. as this bug, silently.
      expect(build, sheet).toContain(basename(href));
    }
  });
});

describe('applying a set (ol-itiu)', () => {
  it('loads the whole stack in cascade order, not just the top sheet', async () => {
    const things = findVariableSet('things-light');
    expect(things).toBeDefined();
    if (things === undefined) return;

    const { frame, sheets } = recordingFrame();
    await applyVariableSet(things, frame);

    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toEqual([
      THEME_SHEET_HREF[BASELINE_SHEET],
      THEME_SHEET_HREF.things,
      // Guard against the fix being half-applied: a one-element array here is
      // the exclusive swap, which is exactly what ol-itiu describes.
    ]);
  });

  it('loads the theme alone when the set strips the baseline', async () => {
    const stripped = findVariableSet('things-light-no-baseline');
    expect(stripped).toBeDefined();
    if (stripped === undefined) return;

    const { frame, sheets } = recordingFrame();
    await applyVariableSet(stripped, frame);
    expect(sheets[0]).toEqual([THEME_SHEET_HREF.things]);
  });

  /**
   * ol-itiu's acceptance criterion: evidence produced from the workbench has to
   * say which of the two load models it came from. `data-wb-baseline` is that,
   * on both sides of the frame boundary so a screenshot pass gets it without
   * entering the frame.
   */
  it('stamps the load model on both the frame element and the frame body', async () => {
    for (const set of VARIABLE_SETS) {
      const { frame, bodyAttrs, elementAttrs, classes } = recordingFrame();
      await applyVariableSet(set, frame);

      expect(bodyAttrs.get('data-wb-variable-set'), set.id).toBe(set.id);
      expect(elementAttrs.get('data-wb-variable-set'), set.id).toBe(set.id);
      expect(bodyAttrs.get('data-wb-baseline'), set.id).toBe(set.baseline);
      expect(elementAttrs.get('data-wb-baseline'), set.id).toBe(set.baseline);
      expect([...classes], set.id).toEqual([set.mode === 'dark' ? 'theme-dark' : 'theme-light']);
    }
  });
});
