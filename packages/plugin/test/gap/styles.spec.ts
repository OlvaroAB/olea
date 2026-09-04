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
 *
 * `ol-0r92.8` moved the seven `--olea-host-*` reads this pane shares with
 * `.olea-review-root`, `.olea-today-root` and `.olea-session-root` (bg, text,
 * muted, faint, line, ui-font, mono) out of this section entirely, onto the
 * shared `:is(...)` block near the top of the file (`ol-bdeb` put
 * `.olea-review-root` and `.olea-today-root` on it first). That block sits
 * OUTSIDE the gap slice on purpose — it names classes the gap view never
 * emits, and a selector naming them inside the slice would fail this file's
 * own "every rule is reachable from the view" check if it were included. So
 * the positive host-read coverage check below reads the shared block
 * directly, by name, rather than the gap slice; the negative assertions (no
 * `@layer`, no `--olea-dark-*`) stay pointed at the gap slice, which
 * correctly still has none of either.
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
/**
 * The next section appended after the gap view's own — this slice used to run
 * unbounded ("to end of file"), which was silently correct only while the gap
 * section genuinely was the last one in the stylesheet. `ol-l5og.18.1` (the
 * registry styling bead) tripped this the same way it tripped
 * `test/session-builder/styles.spec.ts`'s own unbounded slice (see that
 * file's identical fix and doc): several sections landed after the gap
 * section in the same run, and one of them (a fully-styled registry section
 * that legitimately declares its OWN local `--olea-host-*` reads rather than
 * joining the shared `:is(...)` block — see `styles.css`'s Registry section
 * header for why) was being read here as though it were the gap view's own
 * "no local `--olea-host-*` declaration" case. Bounded the same way
 * `test/today/styles.spec.ts` already bounds its own slice.
 */
const NEXT_SECTION_MARKER = '---- Session builder';

/** Just the gap section of `styles.css` — the rest of the file belongs to the other panes appended around it. */
function gapSection(): string {
  const at = fullCss.indexOf(GAP_SECTION_MARKER);
  expect(at, `styles.css contains a "${GAP_SECTION_MARKER}" banner`).toBeGreaterThanOrEqual(0);
  const commentStart = fullCss.lastIndexOf('/*', at);
  expect(commentStart, 'the gap-section banner is inside a comment block').toBeGreaterThanOrEqual(
    0,
  );

  const nextAt = fullCss.indexOf(NEXT_SECTION_MARKER, at);
  expect(
    nextAt,
    `styles.css contains a "${NEXT_SECTION_MARKER}" banner after the gap section's`,
  ).toBeGreaterThanOrEqual(0);
  const nextCommentStart = fullCss.lastIndexOf('/*', nextAt);
  return fullCss.slice(commentStart, nextCommentStart);
}

const css = gapSection();

const SHARED_ROOT_SELECTOR =
  ':is(.olea-review-root, .olea-today-root, .olea-gap-root, .olea-session-root)';

/**
 * The shared host-reads block `.olea-gap-root` carries with the other three
 * roots (`ol-bdeb`, `ol-0r92.8`) — declared once, outside the gap slice
 * above, so it is read here by name rather than by slicing.
 */
function sharedHostReadsBlock(): string {
  const start = fullCss.indexOf(`${SHARED_ROOT_SELECTOR} {`);
  expect(
    start,
    `styles.css declares a "${SHARED_ROOT_SELECTOR}" rule for the shared host reads`,
  ).toBeGreaterThanOrEqual(0);
  const open = fullCss.indexOf('{', start);
  const close = fullCss.indexOf('}', open);
  expect(close, 'the shared host-reads rule is terminated').toBeGreaterThan(open);
  return fullCss.slice(open + 1, close);
}

const sharedCss = sharedHostReadsBlock();

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
    expect(emitted).toContain('olea-gap-action-open-concept');
    expect(emitted).toContain('olea-gap-scope-source-unreadable');
  });

  it('every class the view emits has a rule', () => {
    const styled = classesStyled();
    const missing = classesEmittedByView().filter((cls) => !styled.has(cls));
    expect(missing).toEqual([]);
  });

  it("F4.5 and F4.10's rules are structural, not just a style choice: no gap class offers a commissioning affordance", () => {
    // The full affordance vocabulary across all three classes, derived from
    // olea-core rather than hard-coded here — a commissioning affordance
    // reappearing anywhere (coverage-gap's withdrawn draft verb included)
    // would show up in this set.
    expect(AFFORDANCES).toEqual(['build-session', 'find-source', 'open-concept']);
  });
});

describe('the gap section of styles.css is a full-tab pane that follows the host theme, not a forced-dark second review view', () => {
  it('carries no theme-dark class and no dark floor layer', () => {
    expect(viewCode).not.toContain('theme-dark');
    expect(css).not.toContain('@layer');
    expect(css).not.toContain('--olea-dark-');
  });

  it('reads the host for every ground, text, border and font role, via the shared block it carries with the other three roots', () => {
    for (const hostVar of [
      '--background-primary',
      '--text-normal',
      '--text-muted',
      '--text-faint',
      '--background-modifier-border',
      '--font-interface',
      '--font-monospace',
    ]) {
      expect(sharedCss).toContain(`var(${hostVar}`);
    }
  });

  it('declares the --olea-host-* role reads it shares with the other three roots once, on the shared block, not locally', () => {
    const SHARED_ROLES = ['bg', 'text', 'muted', 'faint', 'line', 'ui-font', 'mono'];
    for (const role of SHARED_ROLES) {
      const declaration = new RegExp(`--olea-host-${role}\\s*:`, 'g');
      expect(
        sharedCss.match(declaration),
        `--olea-host-${role} is declared on the shared :is(...) block`,
      ).toHaveLength(1);
      expect(css, `the gap section no longer re-declares --olea-host-${role} locally`).not.toMatch(
        declaration,
      );
    }
  });

  it("supplies its own neutral floor for the shared reads, never the review root's dark one", () => {
    for (const role of ['bg', 'text', 'muted', 'faint', 'line']) {
      expect(css).toMatch(new RegExp(`--olea-host-${role}-floor\\s*:\\s*#[0-9a-f]{6}`, 'i'));
    }
  });
});
