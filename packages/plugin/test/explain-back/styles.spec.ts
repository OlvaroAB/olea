/**
 * Drift guard for the explain-back modal's CSS (`[STY-0d]`, `ol-l5og.18.4`) — same shape as
 * `test/gap/styles.spec.ts`, but self-contained: `.olea-explain-back` declares its own host
 * reads locally rather than joining the shared `:is(.olea-review-root, .olea-today-root,
 * .olea-gap-root, .olea-session-root)` block (a modal's `contentEl` sits outside all four of
 * those roots — see `styles.css`'s own banner comment on this section for the full argument,
 * and the epic's brief for why this bead does not edit that shared selector).
 *
 * `[D-603]` (`ol-egov.141.89.6.129`): the v0.9 practice view draws its passages and controls with
 * classes this section already styles, and no graded region; the region rules stay in
 * `styles.css` (not this bead's file) for when findings return.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../../styles.css', import.meta.url));
const viewPath = fileURLToPath(new URL('../../src/explain-back/modal.ts', import.meta.url));

const fullCss = readFileSync(cssPath, 'utf8');
const view = readFileSync(viewPath, 'utf8');
/** Comments stripped — a doc paragraph must not satisfy a check about the CSS actually existing. */
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SECTION_MARKER = '---- Explain-back modal (F5.1, [D-163]; [STY-0d] ol-l5og.18.4) ----';

/** Just this section of `styles.css` — from its own banner to the next one. */
function explainBackSection(): string {
  const at = fullCss.indexOf(SECTION_MARKER);
  expect(at, `styles.css contains a "${SECTION_MARKER}" banner`).toBeGreaterThanOrEqual(0);
  const commentStart = fullCss.lastIndexOf('/*', at);
  expect(commentStart, 'the explain-back banner is inside a comment block').toBeGreaterThanOrEqual(
    0,
  );
  const nextBannerCommentStart = fullCss.indexOf('/* ============', commentStart + 1);
  return nextBannerCommentStart === -1
    ? fullCss.slice(commentStart)
    : fullCss.slice(commentStart, nextBannerCommentStart);
}

const css = explainBackSection();

/**
 * Every static `cls:` string literal and `addClass` argument in the view. `[D-603]`
 * (`ol-egov.141.89.6.129`) removed the graded regions and with them the view's one dynamic class
 * template; a dynamic template reintroduced here is refused rather than guessed at, so it cannot
 * slip past this guard unstyled.
 */
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
    throw new Error(`explain-back/styles.spec.ts: unrecognised dynamic cls template: ${match[1]}`);
  }

  return [...found].sort();
}

/** Every class selector this section of the stylesheet defines a rule for. */
function classesStyled(): ReadonlySet<string> {
  const found = new Set<string>();
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of rules.matchAll(/\.([a-z][a-z0-9-]*)/gi)) {
    const cls = match[1];
    if (cls !== undefined) found.add(cls);
  }
  return found;
}

describe('styles.css covers the explain-back modal', () => {
  it('finds the classes the view emits, the practice view’s included', () => {
    const emitted = classesEmittedByView();
    for (const cls of [
      'olea-explain-back',
      'olea-explain-back-mastery',
      'olea-explain-back-heading',
      'olea-explain-back-region-items',
      'olea-explain-back-item',
      'olea-explain-back-item-text',
      'olea-explain-back-cite',
      'olea-explain-back-actions',
    ]) {
      expect(emitted).toContain(cls);
    }
  });

  it('every class the view emits has a rule', () => {
    const styled = classesStyled();
    const missing = classesEmittedByView().filter((cls) => !styled.has(cls));
    expect(missing).toEqual([]);
  });

  it('v0.9 ([D-603]): the view draws no graded region — covered, omission or confusion — and no outcome line', () => {
    const emitted = classesEmittedByView();
    for (const cls of [
      'olea-explain-back-region',
      'olea-explain-back-region-covered',
      'olea-explain-back-region-omission',
      'olea-explain-back-region-confusion',
      'olea-explain-back-outcome',
      'olea-explain-back-encouragement',
      'olea-explain-back-feedback',
    ]) {
      expect(emitted).not.toContain(cls);
    }
    expect(viewCode).not.toMatch(/ExplainBackRegionKind/);
  });
});

describe('the explain-back section of styles.css does not force a theme branch, like the gap/session panes', () => {
  it('carries no theme-dark class and no dark-floor cascade layer', () => {
    expect(viewCode).not.toContain('theme-dark');
    expect(css).not.toContain('@layer');
    expect(css).not.toContain('--olea-dark-');
  });

  it('reads the host for every ground, text, border and font role, locally rather than via the shared :is(...) block', () => {
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

  it("declares a neutral (light) literal floor for those reads, never the review root's dark one", () => {
    expect(css).toMatch(/--olea-host-bg:\s*var\(--background-primary,\s*#ffffff\)/);
    expect(css).toMatch(/--olea-host-text:\s*var\(--text-normal,\s*#202020\)/);
  });

  it('declares --olea-host-covered/-confusion/-cite for both theme branches, copied from the Pass-3 tokens', () => {
    expect(css).toMatch(/\.olea-explain-back\s*\{[\s\S]*?--olea-host-covered:\s*#8a9a63/i);
    expect(css).toMatch(/\.olea-explain-back\s*\{[\s\S]*?--olea-host-confusion:\s*#df917f/i);
    expect(css).toMatch(
      /\.theme-light \.olea-explain-back\s*\{[\s\S]*?--olea-host-covered:\s*#5a6b3b/i,
    );
    expect(css).toMatch(
      /\.theme-light \.olea-explain-back\s*\{[\s\S]*?--olea-host-confusion:\s*#a34a37/i,
    );
  });
});
