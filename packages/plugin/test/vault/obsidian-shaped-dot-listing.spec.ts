/**
 * `ol-egov.141.89.10.52` — the plugin's dot-folder readers over a source shaped exactly like
 * `ObsidianSource`: `list()` filters a flat file map the way `vault.getFiles()` does (no
 * dot-prefixed path ever appears), and `listUnder()` is the real `listUnderViaAdapter` walk over
 * an adapter derived from the same map (the workbench shim's `VaultAdapterShim` does the same
 * grouping). It models the production composition (`main.ts` hands a plain
 * `new ObsidianSource(this.app)` to every caller below) without the class itself; the class is
 * driven directly, with `obsidian` mocked, in `obsidian-source-hidden-paths.spec.ts`
 * (`ol-egov.141.89.10.57`).
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import { discoverLogPaths } from '../../src/privacy/log-discovery.js';
import { type DotFolderAdapter, listUnderViaAdapter } from '../../src/vault/dot-folder-walk.js';

function isDotPath(path: string): boolean {
  return path.split('/')[0]?.startsWith('.') ?? false;
}

function extensionOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

class ObsidianShapedSource implements VaultSource {
  readonly files = new Map<VaultPath, string>();

  constructor(initial: Readonly<Record<VaultPath, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }

  /** `ObsidianSource.list`: built on `getFiles()`, which never returns a dot-prefixed path. */
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const under = options.under;
    const extensions = options.extensions?.map((ext) => ext.toLowerCase());
    return [...this.files.keys()]
      .filter((path) => !isDotPath(path))
      .filter((path) => under === undefined || path === under || path.startsWith(`${under}/`))
      .filter((path) => {
        if (extensions === undefined) return true;
        const ext = extensionOf(path);
        return ext !== undefined && extensions.includes(ext);
      })
      .sort();
  }

  /** `ObsidianSource.listUnder`: the real adapter walk. */
  listUnder(
    dotPath: VaultPath,
    options: { readonly extensions?: readonly string[] } = {},
  ): Promise<readonly VaultPath[]> {
    return listUnderViaAdapter(this.adapter(), dotPath, options);
  }

  private adapter(): DotFolderAdapter {
    const all = () => [...this.files.keys()];
    return {
      exists: async (path) =>
        this.files.has(path) || all().some((candidate) => candidate.startsWith(`${path}/`)),
      list: async (path) => {
        const prefix = `${path.replace(/\/+$/, '')}/`;
        const files = new Set<string>();
        const folders = new Set<string>();
        for (const candidate of all()) {
          if (!candidate.startsWith(prefix)) continue;
          const rest = candidate.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash === -1) files.add(prefix + rest);
          else folders.add(prefix + rest.slice(0, slash));
        }
        return { files: [...files].sort(), folders: [...folders].sort() };
      },
    };
  }

  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  }

  async readBinary(): Promise<Uint8Array> {
    throw new Error('not needed here');
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  async delete(path: VaultPath): Promise<void> {
    this.files.delete(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }

  conceptRecordFiles(): number {
    return [...this.files.keys()].filter((path) => path.startsWith('.olea/concepts/')).length;
  }
}

describe('dot-folder readers over an ObsidianSource-shaped host (ol-egov.141.89.10.52)', () => {
  it('the model is faithful: list() is blind to .olea, listUnder() is not', async () => {
    const vault = new ObsidianShapedSource({
      '.olea/concepts/a.json': '{}\n',
      '01 Courses/COURSEA/Note.md': '# Note\n',
    });
    expect(await vault.list({ under: '.olea/concepts' })).toEqual([]);
    expect(await vault.listUnder('.olea/concepts')).toEqual(['.olea/concepts/a.json']);
  });

  it('a second extraction through the plugin seam reuses every key and mints no new file', async () => {
    const vault = new ObsidianShapedSource({
      '05 Zettelkasten/Quartz cleavage.md':
        '---\ntype: concept\nolea-uid: uid-quartz\n---\n\n# Quartz cleavage\n\nDefinition, hers.\n',
      '01 Courses/COURSEA/Note.md':
        '---\ntopic: [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Note\n',
      '01 Courses/COURSEA/Other.md':
        '---\ntopic: [Basalt weathering]\ncourse: COURSEA\n---\n\n# Other\n',
    });

    const first = await extractConceptsFromVault(vault);
    const filesAfterFirst = vault.conceptRecordFiles();
    expect(filesAfterFirst).toBeGreaterThan(0);

    const second = await extractConceptsFromVault(vault);
    expect(new Map(second.map((c) => [c.name, c.key]))).toEqual(
      new Map(first.map((c) => [c.name, c.key])),
    );
    expect(vault.conceptRecordFiles()).toBe(filesAfterFirst);
  });

  it('log discovery finds another device file that only listUnder can see', async () => {
    const other = '.olea/reviews/2026-09-20.phone-device.jsonl';
    const vault = new ObsidianShapedSource({ [other]: '{}\n' });
    const found = await discoverLogPaths(
      vault,
      '.olea/reviews',
      (day, deviceId) => `.olea/reviews/${day}.${deviceId}.jsonl`,
      'desk-device',
      '2026-09-25',
      3,
    );
    expect(found).toEqual([other]);
  });

  it('log discovery still lists an ordinary folder through list()', async () => {
    const path = 'harness/reviews/2026-09-20.phone-device.jsonl';
    const vault = new ObsidianShapedSource({ [path]: '{}\n' });
    const found = await discoverLogPaths(
      vault,
      'harness/reviews',
      (day, deviceId) => `harness/reviews/${day}.${deviceId}.jsonl`,
      'desk-device',
      '2026-09-25',
      3,
    );
    expect(found).toEqual([path]);
  });
});
