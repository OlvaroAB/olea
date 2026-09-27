/**
 * `[D-406]` (`ol-egov.141.8.11`): the pause is only as good as its place in `main.ts`. `onload` has
 * no runtime under Vitest, so these pins read its source: the pause check is the first statement of
 * `onload`, and `onload` returns when it holds, before any store, view, tick or transport is built.
 * `full-delete-pause.spec.ts` proves what the check does once it runs.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with prose removed, so a comment describing the guard cannot satisfy a pin on it. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');
const ONLOAD = 'override async onload(): Promise<void> {';

describe('main.ts holds at the full-delete pause before anything else ([D-406], ol-egov.141.8.11)', () => {
  it('the first statement of onload is the pause check, and onload returns when it holds', () => {
    const start = main.indexOf(ONLOAD);
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start + ONLOAD.length).trimStart();
    expect(
      body.startsWith('const pausedAfterFullDelete = await holdIfPausedAfterFullDelete({'),
    ).toBe(true);
    const guardEnd = body.indexOf('if (pausedAfterFullDelete) return;');
    expect(guardEnd).toBeGreaterThan(-1);
    // Nothing between the check and its return builds anything: no store, transport or registration
    // other than the one Start command the paused instance offers.
    const guard = body.slice(0, guardEnd);
    expect(guard).not.toMatch(/\bnew (?!Notice\b)[A-Z]\w*\(/);
    expect(
      guard.match(
        /this\.(addCommand|registerView|registerInterval|addSettingTab|addRibbonIcon|registerEvent)\(/g,
      ),
    ).toEqual(['this.addCommand(']);
  });

  it('the paused instance seals through the same host the delete seals, and reloads through the delete path', () => {
    const start = main.indexOf(ONLOAD);
    const body = main.slice(start, main.indexOf('if (pausedAfterFullDelete) return;', start));
    expect(body).toMatch(/sealForFullDelete: \(\) => this\.sealForFullDelete\(\)/);
    expect(body).toMatch(/reload: \(\) => reloadPluginAfterFullDelete\(this\.app\)/);
    expect(body).toMatch(/id: OLEA_COMMAND_START_AFTER_FULL_DELETE/);
  });
});
