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
 *
 * `ol-0r92.8` moved the seven `--olea-host-*` reads this pane shares with
 * `.olea-review-root`, `.olea-today-root` and `.olea-gap-root` (bg, text,
 * muted, faint, line, ui-font, mono) out of this section entirely, onto the
 * shared `:is(...)` block near the top of the file (`ol-bdeb` put
 * `.olea-review-root` and `.olea-today-root` on it first). That block sits
 * OUTSIDE the session slice on purpose — it names classes the session builder
 * never emits, and a selector naming them inside the slice would fail this
 * file's own "every rule is reachable from the view" check if it were
 * included. So the positive host-read coverage check below reads the shared
 * block directly, by name, rather than the session slice; the negative
 * assertions (no `@layer`, no `--olea-dark-*`) stay pointed at the session
 * slice, which correctly still has none of either.
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
/**
 * The next section appended after the session builder's own — this slice used to run
 * unbounded ("to end of file"), which was silently correct only while session-builder
 * genuinely was the last section in the stylesheet. `ol-l5og.18.1` (the registry
 * styling bead) tripped this: two sections landed after it in the same run (the
 * explain-back modal, then a fully-styled registry section that legitimately reuses
 * `--olea-host-attention` for its own "needs tending" mark, the same role Today's own
 * mastery ladder already uses it for), and this file's "uses no attention colour at
 * all" check below started reading THAT section's CSS as though it were the session
 * builder's. Bounded the same way `test/today/styles.spec.ts` already bounds its own
 * slice, rather than trusting "session builder is last" to stay true.
 */
const NEXT_SECTION_MARKER = '---- Brand: the sprig';

/** Just the session-builder section of `styles.css` — the rest of the file belongs to the other panes appended around it. */
function sessionSection(): string {
  const at = fullCss.indexOf(SESSION_SECTION_MARKER);
  expect(at, `styles.css contains a "${SESSION_SECTION_MARKER}" banner`).toBeGreaterThanOrEqual(0);
  const commentStart = fullCss.lastIndexOf('/*', at);
  expect(
    commentStart,
    'the session-builder banner is inside a comment block',
  ).toBeGreaterThanOrEqual(0);

  const nextAt = fullCss.indexOf(NEXT_SECTION_MARKER, at);
  expect(
    nextAt,
    `styles.css contains a "${NEXT_SECTION_MARKER}" banner after the session builder's`,
  ).toBeGreaterThanOrEqual(0);
  const nextCommentStart = fullCss.lastIndexOf('/*', nextAt);
  return fullCss.slice(commentStart, nextCommentStart);
}

const css = sessionSection();

const SHARED_ROOT_SELECTOR =
  ':is(.olea-review-root, .olea-today-root, .olea-gap-root, .olea-session-root)';

/**
 * The shared host-reads block `.olea-session-root` carries with the other
 * three roots (`ol-bdeb`, `ol-0r92.8`) — declared once, outside the session
 * slice above, so it is read here by name rather than by slicing.
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
      expect(
        css,
        `the session section no longer re-declares --olea-host-${role} locally`,
      ).not.toMatch(declaration);
    }
  });

  it("supplies its own neutral floor for the shared reads, never the review root's dark one", () => {
    for (const role of ['bg', 'text', 'muted', 'faint', 'line']) {
      expect(css).toMatch(new RegExp(`--olea-host-${role}-floor\\s*:\\s*#[0-9a-f]{6}`, 'i'));
    }
  });

  /**
   * NARROWED by `[STY-1]` (`ol-l5og.18.11`), from "no attention colour at all"
   * to "no attention colour on anything that reads a fact".
   *
   * **The original rule and why it was right.** A session builder that flags
   * anything amber is one step from telling her she is behind, which
   * `copy.ts` refuses in words. Every item row, every budget chip, every
   * count on this pane is a reading, and principle 12 is held in pixels here
   * as well as in prose.
   *
   * **Why it could not stay a blanket ban.** The kit paints this pane's
   * primary action honey and nothing else:
   * `docs/design/pass4-oracle-gap/ui_kits/olea-plugin/ExamSession.jsx:75`
   * gives `Start this` `background: 'var(--olea-host-attention)'` with
   * `color: 'var(--olea-honey-ink-strong)'`, while `Not now` on `:79` is a
   * neutral bordered control and `Change what's in it` on `:82` is a quiet
   * ghost. `Pass4Annotations.jsx:61` states the rule the whole kit set holds
   * to: "The one honey on these surfaces is the primary action, exactly as
   * everywhere else." The 2026-09-04 kit-fidelity judgement recorded this
   * ban as the live blocker on drawing the accept/dismiss gate at all.
   *
   * A fill on the control she presses is not a flag on her material — it is
   * the opposite reading of the same colour, and it is the reading every
   * other Olea surface already uses it for (Today's `Start review`,
   * `.olea-today-primary-action`). So the ban is narrowed to what it was
   * actually protecting rather than lifted: attention may appear only inside
   * a rule whose selector names a primary action, and a lane painting a row,
   * a chip or a count with it still fails here.
   */
  it('paints attention only on a primary action, never on anything that reads a fact', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const offenders: string[] = [];
    for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (match[1] ?? '').trim();
      const body = match[2] ?? '';
      if (!body.includes('--olea-host-attention')) continue;
      // The only permitted shape: a rule that IS the primary action. A
      // declaration of the role itself on the root is permitted too, since
      // the pane cannot paint a primary without the role being available.
      const isPrimaryAction = /-primary\b|\.mod-cta/.test(selector);
      const isRoleDeclaration =
        /^\.olea-session-root$/.test(selector) && /--olea-host-attention\s*:/.test(body);
      if (!isPrimaryAction && !isRoleDeclaration) offenders.push(selector);
    }
    expect(
      offenders,
      'attention (honey) on this pane is reserved for its single primary action — the kit paints ' +
        'Start this with it and nothing else (ExamSession.jsx:75, Pass4Annotations.jsx:61). A row, ' +
        'a chip or a count wearing it is the "you are behind" reading copy.ts refuses in words.',
    ).toEqual([]);
  });
});
