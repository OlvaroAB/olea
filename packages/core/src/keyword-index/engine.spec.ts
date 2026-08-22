import { describe, expect, it } from 'vitest';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { KeywordIndexEngine } from './engine.js';
import { createCancellationController, type YieldScheduler } from './scheduling.js';
import type { KeywordIndexStore, PersistedKeywordIndex } from './types.js';

/** Mutable in-memory vault a test can `set`/`remove` on to simulate the file changes a real vault event describes, plus a `writes` log to prove the index never touches the vault (D-006). */
class MutableVaultSource implements VaultSource {
  readonly writes: VaultPath[] = [];
  private readonly files = new Map<string, string>();

  set(path: VaultPath, content: string): void {
    this.files.set(path, content);
  }

  remove(path: VaultPath): void {
    this.files.delete(path);
  }

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
    this.writes.push(path);
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

class MemoryKeywordIndexStore implements KeywordIndexStore {
  private saved: PersistedKeywordIndex | null = null;
  saveCount = 0;

  async load(): Promise<PersistedKeywordIndex | null> {
    return this.saved;
  }

  async save(index: PersistedKeywordIndex): Promise<void> {
    this.saveCount += 1;
    this.saved = index;
  }

  /** Read what's actually persisted right now, for assertions. */
  peek(): PersistedKeywordIndex | null {
    return this.saved;
  }
}

/** No real timer, ever — resolves on the microtask queue only. */
const immediateScheduler: YieldScheduler = { yield: () => Promise.resolve() };

describe('KeywordIndexEngine — first run (D-006)', () => {
  it('starts with zero documents when nothing is persisted, and a rebuild populates it', async () => {
    const vault = new MutableVaultSource();
    vault.set('a.md', '# A\nprose\n');
    vault.set('b.md', '# B\nprose\n');
    const store = new MemoryKeywordIndexStore();

    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    expect(engine.toPersisted().documents).toEqual([]);

    const result = await engine.rebuild();
    expect(result).toBe('complete');
    expect(engine.toPersisted().documents.map((d) => d.path)).toEqual(['a.md', 'b.md']);
    expect(store.peek()?.documents.map((d) => d.path)).toEqual(['a.md', 'b.md']);
  });
});

describe('KeywordIndexEngine — never writes to the vault (C2.1, D-006)', () => {
  it('rebuild and incremental updates never call vault.write', async () => {
    const vault = new MutableVaultSource();
    vault.set('a.md', '# A\nprose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });

    await engine.rebuild();
    vault.set('b.md', '# B\nprose\n');
    await engine.applyEvent({ kind: 'create', path: 'b.md' });
    vault.set('a.md', '# A changed\nprose\n');
    await engine.applyEvent({ kind: 'modify', path: 'a.md' });
    await engine.applyEvent({ kind: 'delete', path: 'a.md' });

    expect(vault.writes).toEqual([]);
  });
});

describe('KeywordIndexEngine — incremental updates from vault events (C1.5)', () => {
  it('create adds a new document', async () => {
    const vault = new MutableVaultSource();
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });

    vault.set('new.md', '# New\nsome prose\n');
    await engine.applyEvent({ kind: 'create', path: 'new.md' });

    expect(engine.toPersisted().documents.map((d) => d.path)).toEqual(['new.md']);
  });

  it('modify replaces the indexed content, not the old', async () => {
    const vault = new MutableVaultSource();
    vault.set('note.md', '# Old\nold prose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    await engine.rebuild();

    vault.set('note.md', '# New\nnew prose\n');
    await engine.applyEvent({ kind: 'modify', path: 'note.md' });

    const doc = engine.toPersisted().documents[0];
    expect(doc?.blocks.map((b) => b.text)).toEqual(['New', 'new prose']);
  });

  it('delete removes a document from the index', async () => {
    const vault = new MutableVaultSource();
    vault.set('gone.md', '# Gone\nprose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    await engine.rebuild();
    expect(engine.toPersisted().documents).toHaveLength(1);

    vault.remove('gone.md');
    await engine.applyEvent({ kind: 'delete', path: 'gone.md' });

    expect(engine.toPersisted().documents).toEqual([]);
  });

  it('deleting a path that was never indexed is a safe no-op', async () => {
    const vault = new MutableVaultSource();
    vault.set('a.md', '# A\nprose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    await engine.rebuild();
    const before = engine.toPersisted();

    await expect(
      engine.applyEvent({ kind: 'delete', path: 'never-existed.md' }),
    ).resolves.toBeUndefined();

    expect(engine.toPersisted()).toEqual(before);
  });

  it('rename moves the entry — no duplicate, nothing left at the old path', async () => {
    const vault = new MutableVaultSource();
    vault.set('old.md', '# Title\nprose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    await engine.rebuild();

    vault.remove('old.md');
    vault.set('new.md', '# Title\nprose\n');
    await engine.applyEvent({ kind: 'rename', path: 'new.md', oldPath: 'old.md' });

    const paths = engine.toPersisted().documents.map((d) => d.path);
    expect(paths).toEqual(['new.md']);
  });

  it('a rename that changes only case is a real move, not a no-op', async () => {
    const vault = new MutableVaultSource();
    vault.set('note.md', '# Title\nprose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    await engine.rebuild();

    vault.remove('note.md');
    vault.set('Note.md', '# Title\nprose\n');
    await engine.applyEvent({ kind: 'rename', path: 'Note.md', oldPath: 'note.md' });

    const paths = engine.toPersisted().documents.map((d) => d.path);
    expect(paths).toEqual(['Note.md']);
  });

  it('a rename event is persisted through the store, not just held in memory', async () => {
    const vault = new MutableVaultSource();
    vault.set('old.md', '# T\nprose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    await engine.rebuild();

    vault.remove('old.md');
    vault.set('new.md', '# T\nprose\n');
    await engine.applyEvent({ kind: 'rename', path: 'new.md', oldPath: 'old.md' });

    expect(store.peek()?.documents.map((d) => d.path)).toEqual(['new.md']);
  });
});

describe('KeywordIndexEngine — cancelled rebuild changes nothing (C2.6, D-006)', () => {
  it('leaves the in-memory and persisted index exactly as it was before the rebuild started', async () => {
    const vault = new MutableVaultSource();
    vault.set('a.md', '# A\nprose\n');
    vault.set('b.md', '# B\nprose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    await engine.rebuild();
    const before = engine.toPersisted();
    const savesBefore = store.saveCount;

    const controller = createCancellationController();
    controller.cancel(); // already cancelled: the rebuild must not touch anything
    const result = await engine.rebuild({ signal: controller.signal });

    expect(result).toBe('cancelled');
    expect(engine.toPersisted()).toEqual(before);
    expect(store.peek()).toEqual(before);
    expect(store.saveCount).toBe(savesBefore);
  });
});

describe('KeywordIndexEngine — search over the live index (C2.2)', () => {
  it('finds a term across the currently-indexed documents', async () => {
    const vault = new MutableVaultSource();
    vault.set('a.md', '# Bioturbation\nprose\n');
    vault.set('b.md', '# Unrelated\nprose\n');
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });
    await engine.rebuild();

    const hits = engine.search('bioturbation');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('a.md');
  });
});
