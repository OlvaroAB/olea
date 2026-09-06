/**
 * Loading a CARRIED world's vault out of a multi-world private dist
 * (`ol-3ux7.5.57.13` [MOM-9b], F9.S17).
 *
 * A private build asked to carry more than one world lays each extra world's
 * vault under its own base — `/worlds/<id>/vault/` — beside that world's
 * `simulator-world.json` and `simulator-seed-events.json`
 * (`olea-service/scripts/simulator-build.mjs`, and `world.ts`'s
 * `SimulatorWorldManifestEntry.base`). The dist's PRIMARY world still sits at
 * the root and is still loaded by `../vault/fixture-vault.ts`'s
 * `loadFixtureVault`, byte-for-byte the call it has always been.
 *
 * **Why a second loader rather than a `base` parameter on that one.** Two
 * reasons, and the second is the load-bearing one. `loadFixtureVault` is on
 * the public build's own hot path (`main.ts`, every non-simulator surface);
 * this feature must leave the public build's behaviour untouched, and the
 * cheapest proof of that is not editing the module it runs through at all.
 * And the file is outside this lane's declared ownership, which is the
 * project's concurrency contract rather than a formality. The duplication is
 * the fetch-the-manifest-then-fetch-each-path loop below, ~20 lines, and it
 * keeps the same two properties that module's own doc calls load-bearing:
 * files are fetched as plain static assets so every INV-3 control (all of
 * which are plaintext searches) still sees the same greppable bytes in the
 * artifact as in the source tree, and they are decoded from `ArrayBuffer` so
 * the byte-exactness INV-2 is defined over survives the round trip.
 */

import { MemoryVaultSource } from '../vault/memory-source.js';

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`workbench: could not load ${url} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Loads the vault under `base` (an absolute prefix ending in `/`, e.g.
 * `/worlds/crammer/`) into a `MemoryVaultSource`, via the sorted-paths
 * `manifest.json` the build writes beside it. Throws — never falls back to
 * another world's vault — because mounting the WRONG world's material under a
 * world badge naming this one is the exact failure `simulator-world.json`
 * exists to prevent (design doc §2a: David's first private deploy showed a
 * FIXTURE badge over the real snapshot).
 */
export async function loadWorldVault(base: string): Promise<MemoryVaultSource> {
  const vaultBase = `${base}vault/`;
  const manifestUrl = `${vaultBase}manifest.json`;
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) {
    throw new Error(
      `workbench: carried-world manifest missing at ${manifestUrl} — the dist's simulator-worlds.json lists a world whose vault was never copied.`,
    );
  }
  const paths: unknown = await manifestResponse.json();
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
    throw new Error(`workbench: carried-world manifest at ${manifestUrl} is not a list of paths`);
  }
  const entries = await Promise.all(
    (paths as string[]).map(
      async (path): Promise<readonly [string, Uint8Array]> => [
        path,
        await fetchBytes(vaultBase + path.split('/').map(encodeURIComponent).join('/')),
      ],
    ),
  );
  return MemoryVaultSource.fromBytes(new Map(entries));
}
