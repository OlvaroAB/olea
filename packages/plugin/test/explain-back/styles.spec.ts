/**
 * Drift guard for the explain-back modal's CSS (`[STY-0d]`, `ol-l5og.18.4`) — same shape as
 * `test/gap/styles.spec.ts`, but self-contained: `.olea-explain-back` declares its own host
 * reads locally rather than joining the shared `:is(.olea-review-root, .olea-today-root,
 * .olea-gap-root, .olea-session-root)` block (a modal's `contentEl` sits outside all four of
 * those roots — see `styles.css`'s own banner comment on this section for the full argument,
 * and the epic's brief for why this bead does not edit that shared selector).
 *
 * `modal.ts`'s one dynamic class site is `` `olea-explain-back-region olea-explain-back-region-${kind}` ``
 * — expanded here over the real `ExplainBackRegionKind` value set (read from the source text
 * rather than hard-coded, so a fourth kind added there shows up as a newly-missing style rule).
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
 * `ExplainBackRegionKind` (`modal.ts`) — read from its own type-literal source text rather than
 * retyped, so a value added there and never styled here fails this file instead of passing
 * silently.
 */
function regionKinds(): readonly string[] {
  const m = /type ExplainBackRegionKind = ([^;]+);/.exec(view);
  expect(m, 'modal.ts declares ExplainBackRegionKind as a union of string literals').not.toBeNull();
  const literals = [...(m?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  expect(literals.length).toBeGreaterThan(0);
  return literals as readonly string[];
}

const REGION_KINDS = regionKinds();

/** Every static `cls:` string literal, plus the one dynamic template's prefix expanded over `REGION_KINDS`. */
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
    // biome-ignore lint/suspicious/noTemplateCurlyInString: matching modal.ts's literal source text, not building a template string here.
    if (!template.includes('${kind}')) {
      throw new Error(
        `explain-back/styles.spec.ts: unrecognised dynamic cls template: ${template}`,
      );
    }
    for (const kind of REGION_KINDS) found.add(`${prefix}${kind}`);
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
  it('finds the classes the view emits, static and dynamic alike', () => {
    const emitted = classesEmittedByView();
    expect(emitted).toContain('olea-explain-back');
    expect(emitted).toContain('olea-explain-back-region-omission');
    expect(emitted).toContain('olea-explain-back-region-confusion');
    expect(emitted).toContain('olea-explain-back-mastery');
    expect(emitted).toContain('olea-explain-back-cite');
  });

  it('every class the view emits has a rule', () => {
    const styled = classesStyled();
    const missing = classesEmittedByView().filter((cls) => !styled.has(cls));
    expect(missing).toEqual([]);
  });

  it('the three region kinds are all reflected in ExplainBackRegionKind, covered included even though it has no live caller yet', () => {
    expect([...REGION_KINDS].sort()).toEqual(['confusion', 'covered', 'omission']);
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
