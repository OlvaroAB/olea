import { describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { discoverEmbeddedSources } from './embeds.js';
import { extractFromVault } from './registry.js';

/** Minimal in-memory `VaultSource` for embed-resolution edge cases that don't need real files on disk. */
class MemoryVaultSource implements VaultSource {
  private readonly files = new Map<string, Uint8Array>();

  constructor(entries: Record<string, string>) {
    for (const [path, content] of Object.entries(entries)) {
      this.files.set(path, new TextEncoder().encode(content));
    }
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
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`not found: ${path}`);
    return new TextDecoder().decode(bytes);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`not found: ${path}`);
    return bytes;
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, new TextEncoder().encode(content));
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

describe('discoverEmbeddedSources — against the real fixture vault (F1.6 acceptance)', () => {
  const vaultRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const vault = new FolderSource(vaultRoot);
  const notePath = '01 Courses/GEOL204/WEEK 2/Lecture - Deposition & Bedform Stratification.md';

  it('resolves the embedded PDF (![[Geol204-Week2-Slides.pdf]]) to its vault path', async () => {
    const result = await discoverEmbeddedSources(vault, notePath);

    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    const embed = result.resolved[0];
    expect(embed?.rawTarget).toBe('Geol204-Week2-Slides.pdf');
    expect(embed?.format).toBe('pdf');
    expect(embed?.path).toBe('01 Courses/GEOL204/WEEK 2/Geol204-Week2-Slides.pdf');
    expect(embed?.embeddedIn.notePath).toBe(notePath);

    const source = await vault.read(notePath);
    expect(
      source.slice(embed?.embeddedIn.blockStart ?? -1, embed?.embeddedIn.blockEnd ?? -1),
    ).toContain('![[Geol204-Week2-Slides.pdf]]');
  });

  it('the resolved embed extracts end-to-end through extractFromVault, with embeddedIn provenance intact', async () => {
    const result = await discoverEmbeddedSources(vault, notePath);
    const embed = result.resolved[0];
    if (!embed) throw new Error('expected a resolved embed');

    const extraction = await extractFromVault(
      vault,
      embed.path,
      embed.format,
      undefined,
      embed.embeddedIn,
    );

    expect(extraction.pages[0]?.route).toBe('text-layer');
    const unit = extraction.pages[0]?.units[0];
    expect(unit?.text).toBe('GEOL204 Week 2 - Stratigraphic succession');
    expect(unit?.provenance.sourcePath).toBe(embed.path);
    expect(unit?.provenance.embeddedIn).toEqual(embed.embeddedIn);
    expect(unit?.provenance.embeddedIn?.notePath).toBe(notePath);
  });
});

describe('discoverEmbeddedSources — resolution rules', () => {
  it('resolves a bare filename to its one match in the vault', async () => {
    const vault = new MemoryVaultSource({
      'note.md': 'See ![[deck.pptx]] for slides.',
      'Course/deck.pptx': 'stand-in',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.path).toBe('Course/deck.pptx');
    expect(result.resolved[0]?.format).toBe('pptx');
  });

  it('resolves an embed target written as a full vault-relative path', async () => {
    const vault = new MemoryVaultSource({
      'note.md': '![[Course/Sub/handout.docx]]',
      'Course/Sub/handout.docx': 'stand-in',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved[0]?.path).toBe('Course/Sub/handout.docx');
  });

  it("reports ambiguous when multiple files share a basename and none is in the note's own folder", async () => {
    const vault = new MemoryVaultSource({
      'Notes/note.md': '![[scan.png]]',
      'A/scan.png': 'x',
      'B/scan.png': 'x',
    });
    const result = await discoverEmbeddedSources(vault, 'Notes/note.md');
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.reason).toBe('ambiguous');
    expect([...(result.unresolved[0]?.candidates ?? [])].sort()).toEqual([
      'A/scan.png',
      'B/scan.png',
    ]);
  });

  it('breaks a basename tie in favour of a file in the same folder as the embedding note', async () => {
    const vault = new MemoryVaultSource({
      'Course/note.md': '![[scan.png]]',
      'Course/scan.png': 'right one',
      'Other/scan.png': 'wrong one',
    });
    const result = await discoverEmbeddedSources(vault, 'Course/note.md');
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.path).toBe('Course/scan.png');
  });

  it('reports not-found when nothing in the vault matches', async () => {
    const source = '![[missing.pdf]]';
    const vault = new MemoryVaultSource({ 'note.md': source });
    const result = await discoverEmbeddedSources(vault, 'note.md');

    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    const entry = result.unresolved[0];
    expect(entry?.rawTarget).toBe('missing.pdf');
    expect(entry?.reason).toBe('not-found');
    expect(entry?.candidates).toEqual([]);
  });

  it('ignores embeds whose target is not a C3 format (note embeds, audio, etc.)', async () => {
    const vault = new MemoryVaultSource({
      'note.md': '![[Some Other Note]] and ![[recording.mp3]]',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('resolves the correct target when the embed carries an alias or a heading anchor', async () => {
    const vault = new MemoryVaultSource({
      'note.md': '![[deck.pdf|My Lecture]] and ![[deck.pdf#Slide 3]]',
      'deck.pdf': 'x',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved).toHaveLength(2);
    expect(result.resolved.every((e) => e.path === 'deck.pdf')).toBe(true);
    expect(result.resolved.map((e) => e.rawTarget)).toEqual(['deck.pdf', 'deck.pdf']);
  });

  it('assigns distinct, correct block ranges to embeds found in different blocks', async () => {
    const source = '# Heading\n\n![[a.pdf]]\n\nSome paragraph.\n\n![[b.pdf]]\n';
    const vault = new MemoryVaultSource({ 'note.md': source, 'a.pdf': 'x', 'b.pdf': 'x' });
    const result = await discoverEmbeddedSources(vault, 'note.md');

    expect(result.resolved).toHaveLength(2);
    const [first, second] = result.resolved;
    expect(first?.embeddedIn.blockStart).not.toBe(second?.embeddedIn.blockStart);
    expect(
      source.slice(first?.embeddedIn.blockStart ?? -1, first?.embeddedIn.blockEnd ?? -1),
    ).toContain('![[a.pdf]]');
    expect(
      source.slice(second?.embeddedIn.blockStart ?? -1, second?.embeddedIn.blockEnd ?? -1),
    ).toContain('![[b.pdf]]');
  });
});

describe('discoverEmbeddedSources — embed syntax quoted as code is not a real embed (DF-23, ol-embedcodespan)', () => {
  // A note explaining Obsidian's embed syntax quotes it in backticks. The
  // quoted target names a file that genuinely exists in the vault, so if the
  // parser mistakes the quoted syntax for a real embed it would *resolve*
  // rather than merely misfire as 'not-found' — the strongest possible proof
  // that the code span, not the target's existence, is what suppresses it.

  it('does not match embed syntax inside a single-backtick inline code span', async () => {
    const vault = new MemoryVaultSource({
      'note.md': 'Type `![[Geol204-Week2-Slides.pdf]]` to embed a PDF.',
      'Geol204-Week2-Slides.pdf': 'stand-in',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('does not match embed syntax inside a double-backtick inline code span (which may itself contain a backtick)', async () => {
    const vault = new MemoryVaultSource({
      'note.md': 'The syntax is `` ![[deck.pdf]] `` — note the literal backtick ` earlier.',
      'deck.pdf': 'stand-in',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('does not match embed syntax inside a fenced code block', async () => {
    const source = ['Some prose.', '', '```', '![[deck.pdf]]', '```', ''].join('\n');
    const vault = new MemoryVaultSource({ 'note.md': source, 'deck.pdf': 'stand-in' });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('treats an unterminated backtick conservatively, suppressing rather than falsely matching what follows it', async () => {
    const vault = new MemoryVaultSource({
      'note.md': 'A stray ` backtick with no partner, then ![[deck.pdf]] later in the block.',
      'deck.pdf': 'stand-in',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    // Conservative: the dangling backtick's scope is treated as running to
    // the end of the block, so the embed that follows it is skipped (a false
    // negative) rather than risk the opposite mistake elsewhere.
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('still resolves a genuine embed on the same line as a closed, unrelated code span', async () => {
    const vault = new MemoryVaultSource({
      'note.md': 'See `inline code` and then ![[deck.pdf]] for slides.',
      'deck.pdf': 'stand-in',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.path).toBe('deck.pdf');
    expect(result.unresolved).toEqual([]);
  });

  it('still resolves a genuine embed that sits in its own paragraph, unaffected by an unrelated fenced block elsewhere in the note', async () => {
    const source = ['```', 'not an embed: ![[fake.pdf]]', '```', '', '![[real.pdf]]', ''].join(
      '\n',
    );
    const vault = new MemoryVaultSource({
      'note.md': source,
      'real.pdf': 'stand-in',
    });
    const result = await discoverEmbeddedSources(vault, 'note.md');
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.rawTarget).toBe('real.pdf');
    expect(result.unresolved).toEqual([]);
  });
});
