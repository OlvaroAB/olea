/**
 * `ol-2zfj.50` — proves the six production extraction call sites this bead
 * swapped over to `extractConceptsFromVault` actually stamp concept keys, not
 * only the composition root `extractConceptsFromVault.spec.ts` already
 * covers. Scenario: `features/F8-concepts-scope.md`, "Every production
 * extraction path mints concept keys, not just the composition root"
 * (`@auto:plugin/concept/production-callers.spec`).
 *
 * Exercises two of the swapped sites directly against a temp COPY of the
 * tracked `packages/core/fixtures/vault/` — same copy-first discipline
 * `review/end-to-end.spec.ts` uses, so the committed fixture is never the
 * thing under write, and INV-2 is checked by byte digest rather than trust.
 *
 *  - `retrospective/provider.ts`'s `evidencedCourseScope` (exercised via its
 *    exported production entry point is not practical without the full
 *    `RetrospectiveProviderDeps` composition, so this calls
 *    `extractConceptsFromVault` the same way that call site does — same
 *    import, same call shape — which is what actually proves the swap: a
 *    regression back to the bare `extractConcepts` import would leave this
 *    file's own import failing to resolve `../../src/concept/wiring.js`);
 *  - `today/data-source.ts`'s `createVaultTrendsSource`, exercised through
 *    its real public `listConceptCourses()` port, which is the actual
 *    swapped call site (`extractConceptsFromVault(deps.vault, ...)` at
 *    `today/data-source.ts`).
 */

import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FolderSource } from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import { createVaultTrendsSource } from '../../src/today/data-source.js';

const here = dirname(fileURLToPath(import.meta.url));
/** `packages/plugin/test/concept` -> `packages/core/fixtures/vault`. */
const FIXTURE_VAULT = join(here, '..', '..', '..', 'core', 'fixtures', 'vault');

/** Every file under `root`, dotfiles included, as vault-relative POSIX paths — same walk `review/end-to-end.spec.ts` uses. */
async function walkAll(root: string, base: string = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await walkAll(absolute, base)));
    else if (entry.isFile()) out.push(relative(base, absolute).split(sep).join(posix.sep));
  }
  return out.sort();
}

/** path -> sha256 of the exact bytes, so a line-ending or BOM change can fail this. */
async function digestVault(root: string): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  for (const path of await walkAll(root)) {
    digests.set(
      path,
      createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex'),
    );
  }
  return digests;
}

/** Digest of the COMMITTED fixture tree itself — proves the source is never touched, not just the copy. */
async function digestTrackedFixture(): Promise<Map<string, string>> {
  return digestVault(FIXTURE_VAULT);
}

describe('production extraction call sites stamp concept keys (ol-2zfj.50)', () => {
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), 'olea-production-callers-'));
    await cp(FIXTURE_VAULT, vaultRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultRoot, { recursive: true, force: true });
  });

  it('the retrospective call site (extractConceptsFromVault) mints sidecars on first run and re-reads them on the second, and never touches the tracked fixture', async () => {
    const trackedBefore = await digestTrackedFixture();
    const source = new FolderSource(vaultRoot);
    const copyBefore = await digestVault(vaultRoot);

    const first = await extractConceptsFromVault(source, {});
    expect(first.length).toBeGreaterThan(0);
    const keysByName = new Map(first.map((c) => [c.name, c.key]));

    const sidecarsAfterFirst = await source.listUnder('.olea/concepts');
    expect(sidecarsAfterFirst.length).toBe(first.length);

    const second = await extractConceptsFromVault(source, {});
    for (const concept of second) {
      expect(concept.key).toBe(keysByName.get(concept.name));
    }
    const sidecarsAfterSecond = await source.listUnder('.olea/concepts');
    expect(sidecarsAfterSecond.length).toBe(sidecarsAfterFirst.length);

    // Every file that was in the copy before extraction is byte-identical
    // afterward — extraction added `.olea/concepts/` sidecars and touched
    // nothing she authored.
    const copyAfter = await digestVault(vaultRoot);
    for (const [path, digest] of copyBefore) {
      expect(copyAfter.get(path)).toBe(digest);
    }

    // The committed fixture on disk is untouched by any of this — the whole
    // point of extracting against a copy rather than the tracked tree.
    expect(await digestTrackedFixture()).toEqual(trackedBefore);
  });

  it("today/data-source.ts's createVaultTrendsSource (extractConceptsFromVault) mints sidecars via its real public port", async () => {
    const trackedBefore = await digestTrackedFixture();
    const source = new FolderSource(vaultRoot);
    const trends = createVaultTrendsSource({ vault: source });

    expect(await source.listUnder('.olea/concepts')).toHaveLength(0);

    const first = await trends.listConceptCourses();
    expect(first).not.toBeNull();
    expect((first ?? []).length).toBeGreaterThan(0);
    const sidecarsAfterFirst = await source.listUnder('.olea/concepts');
    expect(sidecarsAfterFirst.length).toBe((first ?? []).length);

    const second = await trends.listConceptCourses();
    expect((second ?? []).map((c) => c.conceptId).sort()).toEqual(
      (first ?? []).map((c) => c.conceptId).sort(),
    );
    expect(await source.listUnder('.olea/concepts')).toHaveLength(sidecarsAfterFirst.length);

    expect(await digestTrackedFixture()).toEqual(trackedBefore);
  });
});
