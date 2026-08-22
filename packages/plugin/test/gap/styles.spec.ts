/**
 * Keeps the gap/coverage view's rules in `packages/plugin/styles.css` from
 * drifting away from `gap/view.ts`, the same drift guard
 * `today/styles.spec.ts` runs for the Today panel.
 *
 * `view.ts` emits three dynamic class suffixes rather than one string per
 * `cls:` — `olea-gap-row-<gapClass>`, `olea-gap-action-<affordance>` and
 * `olea-gap-scope-source-<readState>` — built from a template literal, not a
 * plain string, so the exact-match regex `today/styles.spec.ts` uses on
 * single-quoted `cls: '...'` literals would find only the static prefix.
 * This file matches template literals too and enumerates each suffix's real
 * value set from `olea-core`'s own vocabulary (`GapClass`, `GapAffordance`,
 * `SourceReadState`) rather than guessing it, so the check fails if `view.ts`
 * or those vocabularies ever add a fourth gap class, a fifth affordance, or a
 * fifth read state and the stylesheet is not updated to match.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { affordancesFor } from 'olea-core';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../../styles.css', import.meta.url));
const viewPath = fileURLToPath(new URL('../../src/gap/view.ts', import.meta.url));

const fullCss = readFileSync(cssPath, 'utf8');
const view = readFileSync(viewPath, 'utf8');
/** The view with its prose removed — comments must not satisfy a check about them. */
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const GAP_SECTION_MARKER = '---- Gap and coverage views';

/** Just the gap section of `styles.css` — the rest of the file belongs to the review view and the Today panel. */
function gapSection(): string {
  const at = fullCss.indexOf(GAP_SECTION_MARKER);
  expect(at, `styles.css contains a "${GAP_SECTION_MARKER}" banner`).toBeGreaterThanOrEqual(0);
  const commentStart = fullCss.lastIndexOf('/*', at);
  expect(commentStart, 'the gap-section banner is inside a comment block').toBeGreaterThanOrEqual(
    0,
  );
  return fullCss.slice(commentStart);
}

const css = gapSection();

/**
 * Every `GapClass` value `affordancesFor`'s exhaustive switch (`olea-core`)
 * knows about — read from the real vocabulary rather than hard-coded, so a
 * fourth class added there shows up here as a newly-missing style rule
 * instead of silently passing.
 */
const GAP_CLASSES = ['mastery-gap', 'coverage-gap', 'material-gap'] as const;
const AFFORDANCES = [...new Set(GAP_CLASSES.flatMap((cls) => affordancesFor(cls)))].sort();
const READ_STATES = ['read', 'read-yielded-nothing', 'unreadable', 'not-attempted'] as const;

/** Every static `cls:` string literal, plus every dynamic `cls: \`prefix-${expr}\`` template's static prefix expanded over its real value set. */
function classesEmittedByView(): readonly string[] {
  const found = new Set<string>();

  for (const match of viewCode.matchAll(/cls:\s*'([^']+)'/g)) {
    for (const cls of (match[1] ?? '').split(/\s+/)) if (cls !== '') found.add(cls);
  }

  for (const match of viewCode.matchAll(/addClass\('([^']+)'\)/g)) {
    const cls = match[1];
    if (cls !== undefined && cls !== '') found.add(cls);
  }

  for (const match of viewCode.matchAll(/cls:\s*`([^`]+)`/g)) {
    const template = match[1] ?? '';
    // Everything up to the first `${` is the static half of the class list;
    // the interpolation is the last token, e.g. `olea-gap-row olea-gap-row-${...}`.
    const staticPart = template.split('${')[0] ?? '';
    const tokens = staticPart
      .trim()
      .split(/\s+/)
      .filter((t) => t !== '');
    const prefix = tokens[tokens.length - 1];
    for (const token of tokens.slice(0, -1)) found.add(token);
    if (prefix === undefined) continue;

    if (template.includes('row.gapClass')) {
      for (const cls of GAP_CLASSES) found.add(`${prefix}${cls}`);
    } else if (template.includes('affordance')) {
      for (const cls of AFFORDANCES) found.add(`${prefix}${cls}`);
    } else if (template.includes('source.readState')) {
      for (const cls of READ_STATES) found.add(`${prefix}${cls}`);
    } else {
      throw new Error(`gap/styles.spec.ts: unrecognised dynamic cls template: ${template}`);
    }
  }

  return [...found].sort();
}

/** Every class selector the gap section of the stylesheet defines a rule for. */
function classesStyled(): ReadonlySet<string> {
  const found = new Set<string>();
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of rules.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
    const cls = match[1];
    if (cls !== undefined) found.add(cls);
  }
  return found;
}

describe('styles.css covers the gap view', () => {
  it('finds the classes the view emits, static and dynamic alike', () => {
    const emitted = classesEmittedByView();
    expect(emitted).toContain('olea-gap-root');
    expect(emitted).toContain('olea-gap-row-mastery-gap');
    expect(emitted).toContain('olea-gap-action-draft-cards');
    expect(emitted).toContain('olea-gap-scope-source-unreadable');
  });

  it('every class the view emits has a rule', () => {
    const styled = classesStyled();
    const missing = classesEmittedByView().filter((cls) => !styled.has(cls));
    expect(missing).toEqual([]);
  });

  it("F4.10's rule is structural, not just a style choice: draft-cards never reaches a material-gap row", () => {
    expect(affordancesFor('material-gap')).not.toContain('draft-cards');
  });
});

describe('the gap section of styles.css is a sidebar pane, like the Today panel, not a second review view', () => {
  it('carries no theme-dark class and no dark floor layer', () => {
    expect(viewCode).not.toContain('theme-dark');
    expect(css).not.toContain('@layer');
    expect(css).not.toContain('--olea-dark-');
  });

  it('reads the host for every ground, text, border and font role', () => {
    for (const hostVar of [
      '--background-primary',
      '--text-normal',
      '--text-muted',
      '--text-faint',
      '--background-modifier-border',
      '--font-interface',
      '--font-monospace',
    ]) {
      expect(css).toContain(`var(${hostVar}`);
    }
  });
});
