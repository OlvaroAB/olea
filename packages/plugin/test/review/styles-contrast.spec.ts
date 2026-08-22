/**
 * The regression guard for `ol-nrrm` (Q6.5).
 *
 * **What the bug was.** `.olea-review-hint`, `.olea-review-meta-note` and
 * `.olea-review-rating-interval` painted their text with
 * `var(--olea-host-faint)` — i.e. the host's own `--text-faint`. Real WCAG
 * contrast measurement (relative luminance, composited through
 * `--olea-host-wash`/`--olea-host-elev` where relevant) put all three at
 * 2.6–3.1:1 against their ground in *every* measured variable set —
 * both Obsidian's default light and dark themes and Things 2.2.4's light and
 * dark branches, and under both the "theme replaces the baseline" and the
 * "app.css always underneath" load-order models. That is below the 4.5:1
 * WCAG AA text floor Q6.5's "accessibility and quality floor" language is
 * read against here, and uniformly so — not a branch-mixing defect
 * (`ol-ro57`), the faint role's own value. Two of the three are not
 * decorative: `.olea-review-hint` is the keyboard-hint row Q6.5 exists to
 * keep discoverable, and `.olea-review-rating-interval` is "the
 * information" under each rating button.
 *
 * **The fix.** All three now read `var(--olea-host-muted)` instead —
 * already the tier used for equivalent secondary text elsewhere in this
 * file (the progress counter, the ghost actions, the course label) — which
 * measured 5.8–9.7:1 in every variable set. This is a pure token swap, not a
 * new palette: `--olea-host-muted` already exists and is already painted at
 * this visual weight throughout `.olea-review-root`.
 *
 * **What this test asserts, and what it deliberately does not.** Contrast is
 * pixels and needs a browser and real host CSS to measure — this file does
 * not do that (see the contrast sweep run and reported on ol-nrrm's bead
 * instead). What regresses silently, and is a static property of this
 * file's text, is the token choice itself: nothing repaints one of these
 * three roles back onto `--olea-host-faint`, and no *other* role gains a
 * text (`color`) read of `--olea-host-faint` without a documented argument,
 * because every such read measured sub-floor in this sweep. The one
 * remaining reader, `.olea-review-meta-dot`, is a 3px decorative separator
 * with no text content — `background`, not `color` — and is explicitly
 * exempted below rather than silently ignored.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');

/** These roles carry text and must not be painted with the sub-floor faint tier (ol-nrrm). */
const MUST_NOT_BE_FAINT_TEXT = [
  '.olea-review-hint',
  '.olea-review-meta-note',
  '.olea-review-rating-interval',
];

/**
 * `--olea-host-faint` roles NOT covered by `MUST_NOT_BE_FAINT_TEXT` above,
 * with the argument for why each is exempt from the 4.5:1 text floor.
 * `.olea-review-loading` is deliberately absent — it measured the same
 * sub-floor ratio as the fixed three and was filed separately (`ol-n2yx`)
 * rather than folded into this bead's scope.
 */
const KNOWN_NON_TEXT_FAINT_READERS: Readonly<Record<string, string>> = {
  '.olea-review-meta-dot': 'a 3px decorative separator with no text content; background, not color',
};

/** Extracts a rule body: the text between the first `{` after `selector {` and its matching `}`. */
function extractRuleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{`);
  const m = re.exec(css);
  expect(m, `styles.css declares a ${selector} rule`).not.toBeNull();
  if (m === null) throw new Error(`unreachable: ${selector}`);
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated rule for ${selector}`);
}

describe('styles.css text-faint contrast floor (ol-nrrm)', () => {
  it.each(MUST_NOT_BE_FAINT_TEXT)('%s does not paint text with --olea-host-faint', (selector) => {
    const body = extractRuleBody(CSS, selector);
    expect(body).not.toMatch(/color:\s*var\(--olea-host-faint\)/);
  });

  it.each(MUST_NOT_BE_FAINT_TEXT)('%s paints text with --olea-host-muted instead', (selector) => {
    const body = extractRuleBody(CSS, selector);
    expect(body).toMatch(/color:\s*var\(--olea-host-muted\)/);
  });

  it('every remaining color: var(--olea-host-faint) reader is on the documented exemption list', () => {
    const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    const offenders: string[] = [];
    for (const match of withoutComments.matchAll(rulePattern)) {
      const selector = (match[1] ?? '').trim();
      const body = match[2] ?? '';
      if (!/color:\s*var\(--olea-host-faint\)/.test(body)) continue;
      const isExempt = Object.keys(KNOWN_NON_TEXT_FAINT_READERS).some((exempt) =>
        selector.includes(exempt),
      );
      if (!isExempt) offenders.push(selector);
    }
    expect(
      offenders,
      'a new reader of color: var(--olea-host-faint) was added without checking it against the ' +
        '4.5:1 floor (ol-nrrm) — either redirect it to --olea-host-muted or add it to ' +
        'KNOWN_NON_TEXT_FAINT_READERS here with the argument for why it is exempt',
    ).toEqual([]);
  });

  it('the documented exemption still exists and is still non-text', () => {
    for (const selector of Object.keys(KNOWN_NON_TEXT_FAINT_READERS)) {
      const body = extractRuleBody(CSS, selector);
      // A decorative element painted with `color` (not `background`) would mean
      // the exemption argument on the line above no longer holds.
      expect(body).not.toMatch(/color:\s*var\(--olea-host-faint\)/);
      expect(body).toMatch(/background:\s*var\(--olea-host-faint\)/);
    }
  });
});
