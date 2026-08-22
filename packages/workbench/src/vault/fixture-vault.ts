/**
 * Loads the synthetic fixture vault into a `MemoryVaultSource`, **as plain files
 * fetched at runtime** — never embedded, never encoded.
 *
 * ## Why not embed it in the bundle
 *
 * The first version of this file base64-encoded the whole fixture vault into a
 * generated TypeScript module. It worked, and it was wrong for a reason worth
 * writing down where the next person to add a build step over her content will
 * meet it:
 *
 * **Every INV-3 control this project has is a plaintext search.** The
 * `INV3_MARKERS` tripwire, the real-title backstop, and the tree-wide sweeps that
 * caught *both* real leaks so far are all string searches over text. A build step
 * that base64s the corpus leaks nothing by itself — it removes the corpus from
 * the reach of every control, silently, while the controls keep reporting green.
 * That is a check that cannot fail, which is worse than a check that fails: it is
 * the same failure shape as an underpowered gate, wearing a different costume.
 *
 * So the fixture vault is copied into `dist/vault/` verbatim by `build.mjs` and
 * fetched from there. **Both the source tree and the build artifact hold the same
 * greppable markdown**, and a sweep over either finds exactly what a sweep over
 * the other would. Nothing about the corpus is invisible to a grep at any point
 * in the pipeline.
 *
 * The cost is 50-odd small HTTP requests on load and a dependency on being served
 * over HTTP. Both are free here: the workbench is already an ES-module page and
 * has never worked from `file://`.
 *
 * ## Byte-exactness survives the round trip
 *
 * Files are fetched as `ArrayBuffer` and decoded with `ignoreBOM`, so CRLF, BOM
 * and trailing-newline-or-not are preserved exactly, and the fixture PDF stays a
 * PDF. `VaultSource.read`'s contract — the one INV-2 is defined over — holds.
 */

import { MemoryVaultSource } from './memory-source.js';

/** Where `build.mjs` copies `packages/core/fixtures/vault`. */
export const FIXTURE_VAULT_BASE = './vault/';

/** Written by `build.mjs`: the sorted vault-relative paths, and nothing else. */
export const FIXTURE_MANIFEST = `${FIXTURE_VAULT_BASE}manifest.json`;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`workbench: could not load ${url} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadFixtureVault(): Promise<MemoryVaultSource> {
  const manifestResponse = await fetch(FIXTURE_MANIFEST);
  if (!manifestResponse.ok) {
    throw new Error(
      `workbench: fixture manifest missing at ${FIXTURE_MANIFEST} — run the build, which copies packages/core/fixtures/vault into dist/vault/.`,
    );
  }
  const paths: unknown = await manifestResponse.json();
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
    throw new Error('workbench: fixture manifest is not a list of paths');
  }

  const entries = await Promise.all(
    (paths as string[]).map(
      async (path): Promise<readonly [string, Uint8Array]> => [
        path,
        await fetchBytes(FIXTURE_VAULT_BASE + path.split('/').map(encodeURIComponent).join('/')),
      ],
    ),
  );

  return MemoryVaultSource.fromBytes(new Map(entries));
}
