import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { extractFromVault, formatFromExtension } from './registry.js';

class MemoryVaultSource implements VaultSource {
  private readonly files = new Map<string, Uint8Array>();

  constructor(entries: Record<string, Uint8Array>) {
    for (const [path, bytes] of Object.entries(entries)) this.files.set(path, bytes);
  }

  async list(_options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return [...this.files.keys()].sort();
  }

  async read(path: VaultPath): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
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

describe('formatFromExtension', () => {
  it.each([
    ['deck.pdf', 'pdf'],
    ['slides.PPTX', 'pptx'],
    ['essay.docx', 'docx'],
    ['scan.png', 'image'],
    ['photo.JPG', 'image'],
    ['scan.jpeg', 'image'],
    ['heic-photo.heic', 'image'],
  ] as const)('%s -> %s', (path, expected) => {
    expect(formatFromExtension(path)).toBe(expected);
  });

  it.each(['note.md', 'audio.mp3', 'board.canvas', 'no-extension', 'archive.svg'])(
    '%s -> null (not a C3 ingestion format)',
    (path) => {
      expect(formatFromExtension(path)).toBeNull();
    },
  );
});

describe('extractFromVault — dispatches to the right extractor per format', () => {
  it('image', async () => {
    const vault = new MemoryVaultSource({ 'photo.jpg': new Uint8Array([1, 2, 3]) });
    const result = await extractFromVault(vault, 'photo.jpg', 'image');
    expect(result.format).toBe('image');
    expect(result.pages[0]?.route).toBe('vision');
  });

  it('docx', async () => {
    const documentXml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Hello from a docx</w:t></w:r></w:p></w:body></w:document>';
    const bytes = zipSync({ 'word/document.xml': strToU8(documentXml) });
    const vault = new MemoryVaultSource({ 'essay.docx': bytes });
    const result = await extractFromVault(vault, 'essay.docx', 'docx');
    expect(result.format).toBe('docx');
    expect(result.pages[0]?.units[0]?.text).toBe('Hello from a docx');
  });

  it('pptx', async () => {
    const slideXml =
      '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello from a slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
    const bytes = zipSync({ 'ppt/slides/slide1.xml': strToU8(slideXml) });
    const vault = new MemoryVaultSource({ 'deck.pptx': bytes });
    const result = await extractFromVault(vault, 'deck.pptx', 'pptx');
    expect(result.format).toBe('pptx');
    expect(result.pages[0]?.units[0]?.text).toBe('Hello from a slide');
  });

  it('threads embeddedIn through to the extractor call', async () => {
    const vault = new MemoryVaultSource({ 'photo.jpg': new Uint8Array([1]) });
    const embeddedIn = { notePath: 'note.md', blockStart: 0, blockEnd: 5 };
    const result = await extractFromVault(vault, 'photo.jpg', 'image', undefined, embeddedIn);
    // image always yields no units, but the dispatch path itself must not
    // throw or drop the argument — pdf/pptx/docx unit tests already cover
    // that embeddedIn reaches provenance when a unit *is* produced.
    expect(result.pages[0]?.units).toEqual([]);
  });
});
