/**
 * Reachability of the declared-demands reader (`ol-egov.141.89.9.81`, `[D-072]`). Scenario:
 * `features/F4-oracle.md`, "the production gap view reads declared demands" (olea-service).
 *
 * `main.ts` imports `obsidian` and cannot load under Vitest, so this is a source-level assertion,
 * the technique `../main-wiring.spec.ts` documents: comments are stripped first, so a paragraph
 * describing the wiring cannot satisfy it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');

/** The object literal passed to the gap view's `createLocalGapProvider`. */
function gapProviderCall(): string {
  const start = main.search(/registerView\(\s*VIEW_TYPE_OLEA_GAP/);
  expect(start).toBeGreaterThanOrEqual(0);
  const call = main.indexOf('createLocalGapProvider({', start);
  expect(call).toBeGreaterThan(start);
  let depth = 0;
  for (let i = main.indexOf('{', call); i < main.length; i++) {
    if (main[i] === '{') depth += 1;
    if (main[i] === '}') depth -= 1;
    if (depth === 0) return main.slice(call, i + 1);
  }
  throw new Error('unterminated createLocalGapProvider call');
}

describe('the production gap view reads declared demands', () => {
  it('imports the reader factory from the scope-reading module', () => {
    expect(main).toMatch(
      /import \{ declaredDemandsReaderForVault \} from '\.\/scope-reading\/declared-demands\.js';/,
    );
  });

  it("passes it to the gap view's provider, over this vault, this device and the unit manifest", () => {
    const call = gapProviderCall();
    expect(call).toMatch(/readDeclaredDemands:\s*declaredDemandsReaderForVault\(\{/);
    expect(call).toMatch(
      /declaredDemandsReaderForVault\(\{\s*vault,\s*deviceId,\s*manifestsFor:\s*async \(paths\) =>\s*\(await this\.unitManifests\?\.manifestsFor\(paths\)\) \?\? new Map\(\),\s*\}\)/,
    );
  });
});
