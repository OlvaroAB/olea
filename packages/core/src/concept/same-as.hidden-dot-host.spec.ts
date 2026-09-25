/**
 * `ol-egov.141.89.10.56` — same-as links must be found on a host whose `list()` cannot see a
 * dot-prefixed folder (`.olea/same-as`), the same failure mode `ol-egov.141.89.10.52` fixed for
 * `./key-store.ts` and five other readers. `listSameAsLinkRecords` still called `vault.list`
 * directly, so on a real Obsidian host (or the workbench shim reproducing it, `ol-3ux7.64.21`)
 * it always sees zero records, and a same-as consumer that expects an already-proposed or
 * -confirmed link (`./same-as-consumer.ts`) reads the two identities as unrelated.
 *
 * `HiddenDotListSource` reproduces the split exactly as `key-store.hidden-dot-host.spec.ts`
 * does: `list()` drops every dot-prefixed path, `listUnder()` walks them, read/write/exists go
 * straight through.
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
import { listSameAsLinkRecords, sameAsLinkRecordPath } from './same-as.js';

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

describe('same-as links on a host whose list() hides dot folders (ol-egov.141.89.10.56)', () => {
  let root: string;
  let source: HiddenDotListSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-same-as-hidden-dot-'));
    source = new HiddenDotListSource(new FolderSource(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('listSameAsLinkRecords finds an existing record even though list() hides .olea/same-as', async () => {
    const path = sameAsLinkRecordPath('key-a', 'key-b');
    await source.write(
      path,
      `${JSON.stringify(
        {
          keyA: 'key-a',
          keyB: 'key-b',
          status: 'proposed',
          reason: 'normalisation-collision',
          proposedAt: '2026-09-20T00:00:00.000Z',
          schemaVersion: 1,
        },
        null,
        2,
      )}\n`,
    );

    const records = await listSameAsLinkRecords(source);

    // FAILS before the fix: listSameAsLinkRecords calls vault.list({ under: '.olea/same-as' })
    // directly, which this host answers []; expected [1 record], got [].
    expect(records).toHaveLength(1);
    expect(records[0]?.record.status).toBe('proposed');
  });
});
