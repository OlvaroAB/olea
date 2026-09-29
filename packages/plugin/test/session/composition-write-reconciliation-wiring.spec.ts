/**
 * `ol-egov.141.89.10.97` (row 52): reconciliation is reachable, not merely written. `main.ts`
 * imports `obsidian`, which cannot be loaded under Vitest, so reachability is asserted at the
 * source level, the technique `test/main-wiring.spec.ts` documents. The behaviour of the pass
 * itself is `composition-write-reconciliation.spec.ts`'s.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with prose removed: a comment describing the wiring must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');
const CALL = /void reconcileUnresolvedCompositionWrites\(\{ vault, deviceId \}\);/g;

describe('the plugin start reconciles unresolved composition writes (ol-egov.141.89.10.97)', () => {
  it('main.ts imports the reconciliation and calls it exactly once, with the sealed vault source and this install’s device id', () => {
    expect(main).toMatch(
      /import \{ reconcileUnresolvedCompositionWrites \} from '\.\/session\/composition-write-reconciliation\.js';/,
    );
    expect(main.match(CALL)).toHaveLength(1);
    // `vault` is the plugin's sealed source, never a second `ObsidianSource`.
    expect(main).toMatch(/const vault = this\.vaultSource;/);
  });

  it('runs inside onload, after the full-delete pause and the device id, and never blocks onload', () => {
    const onload = main.indexOf('override async onload()');
    const pause = main.indexOf('if (pausedAfterFullDelete) return;');
    const vaultBinding = main.indexOf('const vault = this.vaultSource;');
    const device = main.indexOf('const deviceId = await ensureDeviceId(this);');
    const call = main.search(CALL);
    expect(onload).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(pause);
    expect(pause).toBeGreaterThan(onload);
    expect(call).toBeGreaterThan(vaultBinding);
    expect(call).toBeGreaterThan(device);
    // Fire and forget: `void`, never awaited (the call above is matched only with `void`).
    expect(main).not.toMatch(/await reconcileUnresolvedCompositionWrites/);
  });

  it('the reconciliation module never touches her notes or the host: no obsidian import, no path outside the composition folder', () => {
    const module = codeOf('session/composition-write-reconciliation.ts');
    expect(module).not.toMatch(/from 'obsidian'/);
    // Every path it builds comes from the composition log's own folder constant and path builder.
    expect(module).not.toMatch(/['"`]\.olea/);
    expect(module).toMatch(/COMPOSITION_LOG_FOLDER/);
  });
});
