/**
 * Keeps the session builder's rules in `packages/plugin/styles.css` from
 * drifting away from `session-builder/view.ts` — the same drift guard
 * `test/gap/styles.spec.ts` and `test/today/styles.spec.ts` run for their own
 * panes.
 *
 * `view.ts` emits one dynamic class suffix, `olea-session-item-<formatMatch>`,
 * built from a template literal, so the exact-match regex on single-quoted
 * `cls: '...'` literals would find only the static prefix. This file matches
 * template literals too and enumerates that suffix's real value set from
 * `olea-core`'s own `SessionFormatMatch` vocabulary rather than guessing it, so
 * the check fails if a fourth match state is ever added and the stylesheet is
 * not updated to match.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SessionFormatMatch } from 'olea-core';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../../styles.css', import.meta.url));
const viewPath = fileURLToPath(new URL('../../src/session-builder/view.ts', import.meta.url));

const fullCss = readFileSync(cssPath, 'utf8');
const view = readFileSync(viewPath, 'utf8');
/** The view with its prose removed — comments must not satisfy a check about them. */
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SESSION_SECTION_MARKER = '---- Session builder';

/** Just the session-builder section of `styles.css` — the rest of the file belongs to the other three panes. */
function sessionSection(): string {
  const at = fullCss.indexOf(SESSION_SECTION_MARKER);
  expect(at, `styles.css contains a "${SESSION_SECTION_MARKER}" banner`).toBeGreaterThanOrEqual(0);
  const commentStart = fullCss.lastIndexOf('/*', at);
  expect(
    commentStart,
    'the session-builder banner is inside a comment block',
  ).toBeGreaterThanOrEqual(0);
  return fullCss.slice(commentStart);
}

const css = sessionSection();

/** Every `SessionFormatMatch` value, read from the real vocabulary rather than hard-coded. */
const FORMAT_MATCHES: readonly SessionFormatMatch[] = [
  'preferred-format',
  'other-format',
  'no-preference',
];

/** Every static `cls:`/`addClass` string, plus every dynamic template's static prefix expanded over its real value set. */
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
    const staticPart = template.split('${')[0] ?? '';
    const tokens = staticPart
      .trim()
      .split(/\s+/)
      .filter((t) => t !== '');
    const prefix = tokens[tokens.length - 1];
    for (const token of tokens.slice(0, -1)) found.add(token);
    if (prefix === undefined) continue;

    if (template.includes('item.formatMatch')) {
      for (const cls of FORMAT_MATCHES) found.add(`${prefix}${cls}`);
    } else {
      throw new Error(
        `session-builder/styles.spec.ts: unrecognised dynamic cls template: ${template}`,
      );
    }
  }

  return [...found].sort();
}

/** Every class selector the session section of the stylesheet defines a rule for. */
function classesStyled(): ReadonlySet<string> {
  const found = new Set<string>();
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of rules.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
    const cls = match[1];
    if (cls !== undefined) found.add(cls);
  }
  return found;
}

describe('styles.css covers the session builder', () => {
  it('finds the classes the view emits, static and dynamic alike', () => {
    const emitted = classesEmittedByView();
    expect(emitted).toContain('olea-session-root');
    expect(emitted).toContain('olea-session-item-preferred-format');
    expect(emitted).toContain('olea-session-budget-active');
  });

  it('every class the view emits has a rule', () => {
    const styled = classesStyled();
    const missing = classesEmittedByView().filter((cls) => !styled.has(cls));
    expect(missing).toEqual([]);
  });
});

describe('the session section is a sidebar pane, like the gap view and the Today panel', () => {
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
      '--background-modifier-border',
      '--font-interface',
      '--font-monospace',
    ]) {
      expect(css).toContain(`var(${hostVar}`);
    }
  });

  it('uses no attention colour at all — principle 12 held in pixels, not only in prose', () => {
    // A session builder that flags anything amber is one step from telling her
    // she is behind, which `copy.ts` refuses in words.
    expect(css).not.toContain('--olea-host-attention');
  });
});
