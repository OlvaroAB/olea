import { describe, expect, it } from 'vitest';
import { hashText } from '../ingestion/hash.js';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { indexDocument } from './document.js';

/** Minimal in-memory `VaultSource` — this suite only needs `read`/`exists`. */
class MemoryVaultSource implements VaultSource {
  constructor(private readonly files: Map<string, string>) {}

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    let paths = [...this.files.keys()];
    if (options.under !== undefined) {
      const under = options.under;
      paths = paths.filter((p) => p === under || p.startsWith(`${under}/`));
    }
    return paths.sort();
  }

  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }

  async readBinary(): Promise<Uint8Array> {
    throw new Error('not used');
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

describe('indexDocument (C2.1)', () => {
  it('groups a document under its course(s) and indexes one entry per searchable block', async () => {
    const vault = new MemoryVaultSource(
      new Map([
        [
          'note.md',
          '---\ncourse: GEOL204\n---\n\n# Heading one\n\nA paragraph of prose.\n\n- item one\n- item two\n',
        ],
      ]),
    );

    const doc = await indexDocument(vault, 'note.md');

    expect(doc.path).toBe('note.md');
    expect(doc.courses).toEqual(['GEOL204']);
    expect(doc.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list']);
    expect(doc.blocks[0]).toMatchObject({ kind: 'heading', text: 'Heading one' });
    expect(doc.blocks[1]?.text).toContain('A paragraph of prose.');
    expect(doc.blocks[2]?.text).toBe('item one\nitem two');
  });

  it('reads course as an M:N list, sorted, the same meaning path extractConcepts uses', async () => {
    const vault = new MemoryVaultSource(
      new Map([['both.md', '---\ncourse: [MUSTH104, GEOL204]\n---\n\n# X\nbody\n']]),
    );
    const doc = await indexDocument(vault, 'both.md');
    expect(doc.courses).toEqual(['GEOL204', 'MUSTH104']);
  });

  it('indexes a document with no course frontmatter as ungrouped, not an error', async () => {
    const vault = new MemoryVaultSource(new Map([['loose.md', '# X\nbody text\n']]));
    const doc = await indexDocument(vault, 'loose.md');
    expect(doc.courses).toEqual([]);
    expect(doc.blocks.length).toBeGreaterThan(0);
  });

  it('produces no block entry for frontmatter, blank runs or thematic breaks', async () => {
    const vault = new MemoryVaultSource(
      new Map([
        ['note.md', '---\ncourse: GEOL204\n---\n\n# Heading\n\n\n---\n\nprose after the rule\n'],
      ]),
    );
    const doc = await indexDocument(vault, 'note.md');
    expect(doc.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph']);
  });

  it('blockIndex refers back to the position in the parsed document, non-contiguous once excluded kinds are skipped', async () => {
    const vault = new MemoryVaultSource(new Map([['note.md', '# H\n\nprose\n']]));
    const doc = await indexDocument(vault, 'note.md');
    // blocks: [0] heading, [1] blank, [2] paragraph — blank contributes nothing.
    expect(doc.blocks.map((b) => b.blockIndex)).toEqual([0, 2]);
  });

  it('carries the SHA-256 of the exact current content, matching hashText directly', async () => {
    const content = '# H\nprose\n';
    const vault = new MemoryVaultSource(new Map([['note.md', content]]));
    const doc = await indexDocument(vault, 'note.md');
    expect(doc.contentHash).toBe(await hashText(content));
  });

  it('two documents with byte-identical content hash identically', async () => {
    const content = '# H\nprose\n';
    const vault = new MemoryVaultSource(
      new Map([
        ['a.md', content],
        ['b.md', content],
      ]),
    );
    const a = await indexDocument(vault, 'a.md');
    const b = await indexDocument(vault, 'b.md');
    expect(a.contentHash).toBe(b.contentHash);
  });
});
