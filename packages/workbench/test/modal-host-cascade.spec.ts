/**
 * `ol-96hn` [WBX-20]: the top document (`[data-wb-modal-host]`'s home) never
 * loaded `plugin-styles.css` or a theme, so a Modal-based view (`ExplainBackModal`,
 * `CourseSetupModal`) rendered with only `workbench.css`'s own generic fallback
 * chrome — a golden could never show whether the view's OWN CSS actually applies.
 * `loadModalHostCascade` (`../src/host-frame.ts`) fixes that; this file exercises
 * it the same way `theme-layering.spec.ts` exercises `applyVariableSet` — a
 * fake recording the DOM calls, no real browser needed (this package's vitest
 * config runs under plain Node with no DOM — see
 * `test/obsidian-shim-whole-plugin.spec.ts`'s own scope note).
 *
 * ONE THING THIS FILE EXISTS SPECIFICALLY TO GUARD, because it is the whole
 * safety argument the fix depends on: `loadModalHostCascade` loads the Obsidian
 * BASELINE (`obsidian-default.css`) into the TOP document UNSCOPED — safe only
 * because that file carries no bare-element selector. A community theme
 * (`vendor/things/theme.css`) does — `body:not(.default-font-color) strong` is
 * the one that hit the sidebar's own `<strong>` before `ol-mioe` put the
 * product in its own iframe document — which is exactly why this function
 * never loads one. The second `it` below re-derives that invariant from the
 * real file on disk, so a rule added to `obsidian-default.css` later that
 * breaks the "every selector is class-scoped" property goes red here rather
 * than silently reopening the sidebar leak the iframe boundary was built to
 * stop.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadModalHostCascade } from '../src/host-frame.js';

const WORKBENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BASELINE_HREF = './themes/obsidian-default.css';
const PLUGIN_HREF = './plugin-styles.css';
const BASELINE_CSS =
  '.theme-dark{--background-primary:#1c1c1c}.theme-light{--background-primary:#fff}';
const PLUGIN_CSS = '.olea-explain-back{color:var(--olea-host-text)}';

/**
 * A `styleNode`-compatible fake: `host.ownerDocument.createElement('style')`
 * plus `.head.appendChild`, and a `classList` recorder. Forcing the single-file
 * bundler's `__OLEA_WB_INLINE_CSS__` global (see `host-frame.ts`'s own doc on
 * `inlineCssFor`) makes `styleNode` take its synchronous `<style>` branch, so
 * this fake never needs a real `<link>` element's `load`/`error` events.
 */
function fakeModalHost(): {
  host: HTMLElement;
  headChildren: Array<{ tagName: string; textContent: string }>;
  classes: Set<string>;
} {
  const headChildren: Array<{ tagName: string; textContent: string }> = [];
  const classes = new Set<string>();
  const doc = {
    createElement: (tag: string) => {
      const el = {
        tagName: tag.toUpperCase(),
        textContent: '',
        dataset: {} as Record<string, string>,
      };
      return el;
    },
    head: {
      appendChild: (node: { tagName: string; textContent: string }) => {
        headChildren.push(node);
      },
    },
  };
  const host = {
    ownerDocument: doc,
    classList: {
      add: (...names: string[]) => {
        for (const name of names) classes.add(name);
      },
      remove: (...names: string[]) => {
        for (const name of names) classes.delete(name);
      },
    },
  };
  return { host: host as unknown as HTMLElement, headChildren, classes };
}

describe('loadModalHostCascade (ol-96hn)', () => {
  afterEach(() => {
    delete (globalThis as { __OLEA_WB_INLINE_CSS__?: unknown }).__OLEA_WB_INLINE_CSS__;
  });

  it('loads exactly the baseline then the plugin stylesheet, never a third (community-theme) sheet', async () => {
    (globalThis as { __OLEA_WB_INLINE_CSS__?: Record<string, string> }).__OLEA_WB_INLINE_CSS__ = {
      [BASELINE_HREF]: BASELINE_CSS,
      [PLUGIN_HREF]: PLUGIN_CSS,
    };
    const { host, headChildren } = fakeModalHost();

    await loadModalHostCascade(host, PLUGIN_HREF, BASELINE_HREF);

    // Order matters: the baseline supplies Obsidian's own variables, the
    // plugin's stylesheet maps them to `--olea-host-*` second — same cascade
    // order `createHostFrame` uses for the iframe.
    expect(headChildren).toHaveLength(2);
    expect(headChildren[0]?.textContent).toBe(BASELINE_CSS);
    expect(headChildren[1]?.textContent).toBe(PLUGIN_CSS);
  });

  it('puts theme-dark/theme-light on the host itself, mutually exclusively', async () => {
    (globalThis as { __OLEA_WB_INLINE_CSS__?: Record<string, string> }).__OLEA_WB_INLINE_CSS__ = {
      [BASELINE_HREF]: BASELINE_CSS,
      [PLUGIN_HREF]: PLUGIN_CSS,
    };
    const { host, classes } = fakeModalHost();
    const cascade = await loadModalHostCascade(host, PLUGIN_HREF, BASELINE_HREF);

    cascade.setMode('dark');
    expect([...classes]).toEqual(['theme-dark']);

    cascade.setMode('light');
    expect([...classes]).toEqual(['theme-light']);
  });

  /**
   * The safety invariant `loadModalHostCascade`'s own module doc argues for:
   * every rule in the sheet it loads unscoped into the top document must
   * require a class match before it can apply to anything, so it can never
   * reach `workbench.css`'s `.wb-*`-named chrome the way a community theme's
   * bare-element rules would (this file's own header explains the incident).
   */
  it('obsidian-default.css scopes every rule under a class — never a bare element', () => {
    const css = readFileSync(join(WORKBENCH_ROOT, 'src', 'themes', 'obsidian-default.css'), 'utf8');
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const preludes = [...stripped.matchAll(/([^{}]+)\{/g)]
      .map((match) => match[1]?.trim() ?? '')
      .filter((prelude) => prelude.length > 0);
    expect(preludes.length).toBeGreaterThan(0);

    for (const prelude of preludes) {
      if (prelude.startsWith('@')) continue; // an at-rule prelude, not a selector list
      for (const rawSelector of prelude.split(',')) {
        const selector = rawSelector.trim();
        expect(
          selector.startsWith('.') || selector.startsWith(':'),
          `bare-element selector found in obsidian-default.css: "${selector}" — this file is loaded ` +
            'unscoped into the top document by loadModalHostCascade precisely because it was verified ' +
            "to have none; a rule like this reopens the sidebar-leak ol-mioe fixed (see this file's " +
            'own module doc)',
        ).toBe(true);
      }
    }
  });
});
