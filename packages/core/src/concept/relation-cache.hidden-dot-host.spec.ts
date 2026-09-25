/**
 * `ol-egov.141.89.10.56` — the relation cache must be read back on a host whose `list()` cannot
 * see a dot-prefixed folder (`.olea/relations`), the same failure mode `ol-egov.141.89.10.52`
 * fixed for `./key-store.ts` and five other readers. `listRelationCacheRecords` still called
 * `vault.list` directly, so on a real Obsidian host (or the workbench shim reproducing it,
 * `ol-3ux7.64.21`) it always sees zero records — and because `writeRelationCache`'s default
 * `'patch'` mode reads existing records through exactly that function (line ~269), a second
 * patch write never merges into what is already on disk: it treats every proposition as new and
 * drops the prior attestations that did not appear in this call's input.
 *
 * `HiddenDotListSource` reproduces the split exactly as `key-store.hidden-dot-host.spec.ts` and
 * `same-as.hidden-dot-host.spec.ts` do: `list()` drops every dot-prefixed path, `listUnder()`
 * walks them, read/write/exists go straight through.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from '../vault/types.js';
import {
  type KeyedConceptRelation,
  listRelationCacheRecords,
  propositionKey,
  writeRelationCache,
} from './relation-cache.js';

function isDotPath(path: VaultPath): boolean {
  return path.split('/')[0]?.startsWith('.') ?? false;
}

/** `list()` hides dot-prefixed paths as `ObsidianSource.list()` does; `listUnder()` walks them. */
class HiddenDotListSource implements VaultSource {
  constructor(private readonly inner: FolderSource) {}

  async list(options?: ListOptions): Promise<readonly VaultPath[]> {
    return (await this.inner.list(options)).filter((path) => !isDotPath(path));
  }

  listUnder(
    dotPath: VaultPath,
    options?: { readonly extensions?: readonly string[] },
  ): Promise<readonly VaultPath[]> {
    return this.inner.listUnder(dotPath, options);
  }

  read(path: VaultPath): Promise<string> {
    return this.inner.read(path);
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.inner.readBinary(path);
  }

  write(path: VaultPath, content: string): Promise<void> {
    return this.inner.write(path, content);
  }

  exists(path: VaultPath): Promise<boolean> {
    return this.inner.exists(path);
  }

  delete(path: VaultPath): Promise<void> {
    return this.inner.delete(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

const introducingPassages = {
  from: { sourcePath: 'A.md', location: { page: 1, section: 'H1' } },
  to: { sourcePath: 'B.md', location: { page: 1, section: 'H2' } },
};

function edge(overrides: Partial<KeyedConceptRelation> = {}): KeyedConceptRelation {
  return {
    type: 'prerequisite',
    from: 'Concept A',
    to: 'Concept B',
    provenance: 'model-proposed',
    confidence: 0.7,
    introducingPassages,
    fromKey: 'key-a',
    toKey: 'key-b',
    ...overrides,
  };
}

describe('relation cache on a host whose list() hides dot folders (ol-egov.141.89.10.56)', () => {
  let root: string;
  let source: HiddenDotListSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-relation-cache-hidden-dot-'));
    source = new HiddenDotListSource(new FolderSource(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('listRelationCacheRecords finds an existing record even though list() hides .olea/relations', async () => {
    const written = await writeRelationCache(new FolderSource(root), [edge()], {
      now: () => '2026-09-20T00:00:00.000Z',
    });
    expect(written.written).toBe(1);

    const records = await listRelationCacheRecords(source);

    // FAILS before the fix: listRelationCacheRecords calls vault.list({ under: '.olea/relations' })
    // directly, which this host answers []; expected [1 record], got [].
    expect(records).toHaveLength(1);
    expect(records[0]?.record.propositionKey).toBe(
      propositionKey('prerequisite', 'key-a', 'key-b'),
    );
  });

  it('patch mode reuses an existing attestation instead of losing it on a hidden-dot host', async () => {
    // First write, over a plain FolderSource (list() sees the dot folder fine) — establishes a
    // record on disk with one attestation.
    await writeRelationCache(new FolderSource(root), [edge()], {
      now: () => '2026-09-20T00:00:00.000Z',
    });

    // Second write, over the hidden-dot host, patching in a second, different edge of the SAME
    // proposition. Patch mode should merge with the first attestation it read back.
    const second = await writeRelationCache(
      source,
      [edge({ confidence: 0.9, from: 'Concept A (revised)' })],
      { now: () => '2026-09-21T00:00:00.000Z' },
    );
    expect(second.written).toBe(1);

    const records = await listRelationCacheRecords(new FolderSource(root));
    expect(records).toHaveLength(1);
    // FAILS before the fix: writeRelationCache's patch mode reads existing records through
    // listRelationCacheRecords, which this host answers [] — so the merge sees zero prior
    // attestations and the record ends up with 1 attestation (the new one only), not 2.
    expect(records[0]?.record.attestations).toHaveLength(2);
  });
});
