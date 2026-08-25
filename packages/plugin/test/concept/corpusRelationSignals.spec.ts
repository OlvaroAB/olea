/**
 * `gatherCorpusRelationVaultContext` tests (`[EXT-11]`, `ol-kw4a`).
 *
 * A minimal `VaultSource` fake — no `obsidian` import.
 */
import type {
  CorpusConcept,
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { gatherCorpusRelationVaultContext } from '../../src/concept/corpusRelationSignals.js';

class MemoryVault implements VaultSource {
  constructor(private readonly files: Record<string, string>) {}
  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const { under } = options;
    return Promise.resolve(
      Object.keys(this.files)
        .filter((p) => under === undefined || p.startsWith(under))
        .sort(),
    );
  }
  read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    if (content === undefined) return Promise.reject(new Error(`no such file ${path}`));
    return Promise.resolve(content);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('read-only'));
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

function concept(name: string, sourcePath: VaultPath, range: [number, number]): CorpusConcept {
  return {
    name,
    aliases: [],
    anchor: { sourcePath, location: { page: 1, charRange: { start: range[0], end: range[1] } } },
  };
}

describe('gatherCorpusRelationVaultContext — passage text', () => {
  it('resolves each concept passage text by slicing its anchor sourcePath at charRange', async () => {
    const vault = new MemoryVault({ 'Note.md': '0123456789Type I error is a false positive.' });
    const c = concept('Type I error', 'Note.md', [10, 43]);

    const { passageTextByName } = await gatherCorpusRelationVaultContext(vault, [c]);

    expect(passageTextByName.get('Type I error')).toBe('Type I error is a false positive.');
  });

  it('reads each unique file only once, even when several concepts share an anchor path', async () => {
    let reads = 0;
    const vault = new MemoryVault({ 'Note.md': 'AAAA BBBB' });
    class CountingVault implements VaultSource {
      list = vault.list.bind(vault);
      readBinary = vault.readBinary.bind(vault);
      write = vault.write.bind(vault);
      exists = vault.exists.bind(vault);
      watch = vault.watch.bind(vault);
      read(path: VaultPath): Promise<string> {
        reads++;
        return vault.read(path);
      }
    }
    const concepts = [concept('A', 'Note.md', [0, 4]), concept('B', 'Note.md', [5, 9])];

    await gatherCorpusRelationVaultContext(new CountingVault(), concepts);

    expect(reads).toBe(1);
  });

  it('degrades to empty passage text (not a thrown error) when the anchor file cannot be read', async () => {
    const vault = new MemoryVault({});
    const c = concept('Ghost concept', 'Missing.md', [0, 5]);

    const { passageTextByName } = await gatherCorpusRelationVaultContext(vault, [c]);

    expect(passageTextByName.get('Ghost concept')).toBe('');
  });
});

describe('gatherCorpusRelationVaultContext — her-link nomination signal', () => {
  it("nominates a pair when one concept's introducing passage wikilinks the other", async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error occurs when... see also [[Type II error]] for the converse.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 76]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([{ kind: 'her-link', a: 'Type I error', b: 'Type II error' }]);
  });

  it('strips a heading or alias suffix before matching the target', async () => {
    const vault = new MemoryVault({
      'A.md': 'See [[Type II error#Definition|the converse]] for contrast.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 61]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([{ kind: 'her-link', a: 'Type I error', b: 'Type II error' }]);
  });

  it('never nominates a self-link', async () => {
    const vault = new MemoryVault({ 'A.md': 'A Type I error, see also [[Type I error]].' });
    const concepts = [concept('Type I error', 'A.md', [0, 43])];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([]);
  });

  it('a wikilink to something outside the concept set nominates nothing', async () => {
    const vault = new MemoryVault({ 'A.md': 'See [[Some Unrelated Note]] for background.' });
    const concepts = [concept('Type I error', 'A.md', [0, 44])];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([]);
  });

  it('deduplicates a pair nominated from both directions into one signal', async () => {
    const vault = new MemoryVault({
      'A.md': 'See also [[Type II error]].',
      'B.md': 'See also [[Type I error]].',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 28]),
      concept('Type II error', 'B.md', [0, 28]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toHaveLength(1);
  });

  it('matches against an alias, not only the canonical name', async () => {
    const vault = new MemoryVault({ 'A.md': 'See also [[Beta error]].' });
    const concepts: CorpusConcept[] = [
      { ...concept('Type I error', 'A.md', [0, 25]) },
      {
        name: 'Type II error',
        aliases: ['Beta error'],
        anchor: { sourcePath: 'B.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
      },
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([{ kind: 'her-link', a: 'Type I error', b: 'Type II error' }]);
  });
});
