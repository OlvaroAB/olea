/**
 * Keeps Home's rules in `packages/plugin/styles.css` from drifting away from
 * `home/view.ts` (F6.10, `[D-223]`, `ol-l5og.21` [HOME-2]) — the same drift
 * guard `test/grove/styles.spec.ts`/`test/today/styles.spec.ts` run for their
 * own panes.
 *
 * **One difference from those two, and it is deliberate.** Home is the
 * first view in this plugin to reuse the shared design-system primitives
 * directly (`.olea-panel`, `.olea-card`, `.olea-eyebrow`, `.olea-button`,
 * `.olea-fine`/`.olea-prose`/`.olea-meta`) rather than a second, view-owned
 * vocabulary for the same shapes — `home/view.ts`'s own module doc explains
 * why. Those primitive classes have no rule inside Home's OWN bounded
 * section (they are declared in the earlier "design system" section this
 * file appends after), so — the same split `test/session-builder/
 * styles.spec.ts` already documents for its own shared-block reads — the
 * POSITIVE "does every emitted class have a rule" check reads the WHOLE
 * stylesheet, not a bounded slice; only the NEGATIVE assertions (no dark
 * floor, no cascade layer, no host-var read this pane should not need) are
 * pointed at Home's own bounded section.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../../styles.css', import.meta.url));
const viewPath = fileURLToPath(new URL('../../src/home/view.ts', import.meta.url));

const fullCss = readFileSync(cssPath, 'utf8');
const view = readFileSync(viewPath, 'utf8');
/** The view with its prose removed — comments must not satisfy a check about them. */
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const HOME_SECTION_MARKER = '---- Home: the landing screen';

/** Home's own section of `styles.css` — from its own banner to the end of the file (it is the last section appended as of this bead). */
function homeSection(): string {
  const at = fullCss.indexOf(HOME_SECTION_MARKER);
  expect(at, `styles.css contains a "${HOME_SECTION_MARKER}" banner`).toBeGreaterThanOrEqual(0);
  const commentStart = fullCss.lastIndexOf('/*', at);
  expect(commentStart, 'the Home-section banner is inside a comment block').toBeGreaterThanOrEqual(
    0,
  );
  return fullCss.slice(commentStart);
}

const homeCss = homeSection();

/** Every static `cls: '...'`/`cls: `...`` literal, plus `addClass`, plus the two dynamic suffixes this view emits. */
function classesEmittedByView(): readonly string[] {
  const found = new Set<string>();

  for (const match of viewCode.matchAll(/cls:\s*'([^']+)'/g)) {
    for (const cls of (match[1] ?? '').split(/\s+/)) if (cls !== '') found.add(cls);
  }
  for (const match of viewCode.matchAll(/addClass\('([^']+)'\)/g)) {
    const cls = match[1];
    if (cls !== undefined && cls !== '') found.add(cls);
  }

  // `renderCourseRow`'s first-row template literal.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: matching the literal source text, not building a template.
  const firstRowTemplate = "`olea-home-course-row${first ? ' olea-home-course-row-first' : ''}`";
  expect(
    viewCode.includes(firstRowTemplate),
    'view.ts still spells out the first-row modifier this test enumerates',
  ).toBe(true);
  found.add('olea-home-course-row');
  found.add('olea-home-course-row-first');

  // `renderMark`'s kind-suffix template literal — `mark.kind` is only ever
  // `'ground'`/`'material-gap'` on this branch (the `'stage'` branch returns
  // earlier with its own static `cls: 'olea-home-mark'`).
  // biome-ignore lint/suspicious/noTemplateCurlyInString: matching the literal source text, not building a template.
  const markKindTemplate = '`olea-home-mark olea-home-mark-${mark.kind}`';
  expect(
    viewCode.includes(markKindTemplate),
    'view.ts still spells out the mark-kind suffix this test enumerates',
  ).toBe(true);
  found.add('olea-home-mark');
  found.add('olea-home-mark-ground');
  found.add('olea-home-mark-material-gap');

  return [...found].sort();
}

/** Every class selector the WHOLE stylesheet defines a rule for — see this file's own module doc for why this reads the full file, not a bounded slice. */
function classesStyledAnywhere(): ReadonlySet<string> {
  const found = new Set<string>();
  const rules = fullCss.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of rules.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
    const cls = match[1];
    if (cls !== undefined) found.add(cls);
  }
  return found;
}

describe('styles.css covers the Home view', () => {
  it('finds the classes the view emits, static and dynamic alike', () => {
    const emitted = classesEmittedByView();
    expect(emitted).toContain('olea-home-root');
    expect(emitted).toContain('olea-home-course-row-first');
    expect(emitted).toContain('olea-home-mark-ground');
    expect(emitted).toContain('olea-home-mark-material-gap');
    // The shared primitives this view reuses rather than duplicates.
    expect(emitted).toContain('olea-panel');
    expect(emitted).toContain('olea-card');
    expect(emitted).toContain('olea-button');
    expect(emitted).toContain('olea-button-primary');
  });

  it('every class the view emits has a rule somewhere in styles.css', () => {
    const styled = classesStyledAnywhere();
    const missing = classesEmittedByView().filter((cls) => !styled.has(cls));
    expect(missing).toEqual([]);
  });
});

describe("Home's own section is a main-pane tab, host-adaptive like Grove/Registry, not the forced-dark review view", () => {
  it('carries no theme-dark class and no dark floor layer', () => {
    expect(viewCode).not.toContain('theme-dark');
    expect(homeCss).not.toContain('@layer');
    expect(homeCss).not.toContain('--olea-dark-');
  });

  it('reads the host for every ground, text, border and font role, on its own (self-contained) root', () => {
    for (const hostVar of [
      '--background-primary',
      '--text-normal',
      '--text-muted',
      '--text-faint',
      '--background-modifier-border',
      '--font-interface',
      '--font-monospace',
    ]) {
      expect(homeCss).toContain(`var(${hostVar}`);
    }
  });

  it("supplies its own neutral floor for the host reads, never the review root's dark one", () => {
    for (const role of ['bg', 'text', 'muted', 'faint', 'line']) {
      expect(homeCss).toMatch(new RegExp(`--olea-host-${role}-floor\\s*:\\s*#[0-9a-f]{6}`, 'i'));
    }
  });

  it('never reads --olea-host-faint as text colour — only as a border/hatch/dot tint (ol-nrrm)', () => {
    expect(homeCss).not.toMatch(/(?<![\w-])color:\s*var\(--olea-host-faint/);
  });
});
