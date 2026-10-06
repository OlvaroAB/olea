/**
 * ol-egov.141.89.7.63 (F4.11, `[D-457]`): the view never stays on its composing message after a
 * composition ends in an error. Scenarios: features/F4-oracle.md, F4.11. Source-text assertions,
 * for the reason `view.spec.ts` gives (`view.ts` imports `obsidian`, which cannot load here).
 *
 * No new wording: the case with no ruled sentence returns to the ruled request button alone.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(__dirname, '../../src/paper/view.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const start = SOURCE.indexOf('private async pullPaper(');
const PULL_PAPER = SOURCE.slice(start, SOURCE.indexOf('private renderReady(', start));
const CATCH = PULL_PAPER.slice(
  PULL_PAPER.indexOf('catch (error)'),
  PULL_PAPER.indexOf('this.justHandedOff.clear()'),
);

describe('pullPaper after a composition error', () => {
  it('offers the request again before any rethrow, so the composing message never stays', () => {
    const offer = CATCH.indexOf('this.renderRequestButton(root, course)');
    const rethrow = CATCH.indexOf('throw error');
    expect(offer).toBeGreaterThan(-1);
    // Either no rethrow, or the button is drawn first.
    if (rethrow !== -1) expect(offer).toBeLessThan(rethrow);
  });

  it('replaces the composing message in every error path (the root is emptied before the button)', () => {
    const empty = CATCH.indexOf('root.empty()');
    expect(empty).toBeGreaterThan(-1);
    expect(empty).toBeLessThan(CATCH.indexOf('this.renderRequestButton(root, course)'));
  });

  it('shows the outage sentence only for the outage notice, never for another error', () => {
    expect(CATCH).toMatch(/notice !== null/);
    expect(CATCH).not.toMatch(/Composing/);
    // No string literal is added to the catch: no new wording.
    expect(CATCH).not.toMatch(/text:\s*['"`]/);
  });
});
