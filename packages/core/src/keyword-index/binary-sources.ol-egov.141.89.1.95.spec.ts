/**
 * `ol-egov.141.89.1.95`, as ruled by David on 2026-10-06 (option a): the keyword index carries
 * EVERY PDF, slide deck and Word document in the vault beside her notes, registered or not, text
 * layer only, with the passage anchor the citation pipeline cites; kept current when one changes
 * and invalidated when one is deleted or renamed (into or out of a dot-folder included);
 * reconciled at load; retrievable at query time after a restart without extracting anything
 * again. A registration now supplies only a binary's course. An image and a scanned page never
 * enter the index.
 *
 * Every string written here is invented (INV-3). The slides-only course is the committed fixture
 * course under `fixtures/vault/01 Courses/ISLD140/`; its text is read at run time, never written
 * into this file.
 */

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractFromVault } from '../extract/registry.js';
import type { SourceLocation } from '../extract/types.js';
import { formatSourceCitation } from '../registry/citation.js';
import { chunksFromIndex } from '../retrieval/chunks.js';
import { EmbeddingCacheEngine } from '../retrieval/embeddingCache.js';
import { retrieve } from '../retrieval/engine.js';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
  RetrievalChunk,
} from '../retrieval/types.js';
import type { RegisteredFileSpec } from '../source/types.js';
import { FolderSource } from '../vault/folder-source.js';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { buildFullIndex } from './build.js';
import { KeywordIndexEngine } from './engine.js';
import type { IndexedDocument, KeywordIndexStore, PersistedKeywordIndex } from './types.js';

// ---------------------------------------------------------------------------------------------
// Synthetic sources
// ---------------------------------------------------------------------------------------------

/** A text-layer PDF, one content stream per page, in the shape `../extract/pdf.ts` reads. */
function pdfBytes(pages: readonly string[]): Uint8Array {
  const escapePdf = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  pages.forEach((text, i) => {
    const raw = `BT /F1 12 Tf 20 150 Td (${escapePdf(text)}) Tj ET`;
    objects.push(
      `${4 + i * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
      `${5 + i * 2} 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
    );
  });
  const text = `%PDF-1.4\n${objects.join('')}trailer\n<< /Size ${4 + pages.length * 2} /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** A deck whose every slide has a title placeholder and a body, in presentation order. */
function pptxBytes(
  slides: readonly { readonly title: string; readonly body: string }[],
): Uint8Array {
  const slideXml = (title: string, body: string): string =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
    `<p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    `<p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '</p:spTree></p:cSld></p:sld>';
  const ids = slides.map((_, i) => `rId${i + 2}`);
  const files: Record<string, Uint8Array> = {
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<p:sldIdLst>${ids.map((id, i) => `<p:sldId id="${256 + i}" r:id="${id}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        ids
          .map(
            (id, i) =>
              `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
          )
          .join('') +
        '</Relationships>',
    ),
  };
  slides.forEach((slide, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(slideXml(slide.title, slide.body));
  });
  return zipSync(files);
}

/** A document: one Heading1 paragraph, then body paragraphs. */
function docxBytes(heading: string, paragraphs: readonly string[]): Uint8Array {
  const p = (text: string, style?: string): string =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${p(heading, 'Heading1')}${paragraphs.map((t) => p(t)).join('')}<w:sectPr/></w:body></w:document>`;
  return zipSync({ 'word/document.xml': strToU8(xml) });
}

const PDF = 'Courses/SYN101/handout.pdf' as VaultPath;
const DECK = 'Courses/SYN101/week-3-deck.pptx' as VaultPath;
const DOC = 'Courses/SYN101/reading.docx' as VaultPath;
const NOTE = 'Courses/SYN101/my-note.md' as VaultPath;

const PDF_PAGES = [
  'Quillmoss colonies spread along damp limestone ledges.',
  'Brindlecap spores travel only in still autumn air.',
];
const DECK_SLIDES = [
  { title: 'Tarnweed basics', body: 'Tarnweed roots anchor in cold shallow water.' },
  { title: 'Fenlark habits', body: 'Fenlarks nest low among the reed margins.' },
];
const DOC_HEADING = 'Reading on glimmerfern';
const DOC_PARAGRAPHS = ['Glimmerfern fronds fold shut at dusk every evening.'];

const SCAN = 'Courses/SYN101/scanned-handout.pdf' as VaultPath;
const MIXED = 'Courses/SYN101/half-scanned.pdf' as VaultPath;
const IMAGE = 'Courses/SYN101/whiteboard.png' as VaultPath;
/** The first bytes of a PNG; never read, which is the point. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

// ---------------------------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------------------------

/** An in-memory vault holding bytes, with `extensions` honoured as `VaultSource.list` documents. */
class BinaryVault implements VaultSource {
  readonly binaryReads: VaultPath[] = [];
  /** Every read in order, `text:` or `binary:` (the interleaving test). */
  readonly readLog: string[] = [];
  /** When set, every `readBinary` waits on it after taking the bytes (the race tests). */
  gate: Promise<void> | null = null;
  /** When set, `readBinary` throws: proves a reload extracts nothing. */
  refuseBinaryReads = false;
  /** Paths whose `readBinary` throws, as an unreadable file's would. */
  readonly unreadable = new Set<VaultPath>();
  private readonly files = new Map<string, Uint8Array>();

  text(path: VaultPath, content: string): void {
    this.files.set(path, strToU8(content));
  }

  bytes(path: VaultPath, content: Uint8Array): void {
    this.files.set(path, content);
  }

  remove(path: VaultPath): void {
    this.files.delete(path);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const under = options.under;
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter((p) => under === undefined || p === under || p.startsWith(`${under}/`))
      .filter((p) => {
        if (extensions === undefined) return true;
        const dot = p.lastIndexOf('.');
        return dot > 0 && extensions.includes(p.slice(dot + 1).toLowerCase());
      })
      .sort();
  }

  async read(path: VaultPath): Promise<string> {
    this.readLog.push(`text:${path}`);
    const bytes = this.files.get(path);
    if (bytes === undefined) throw new Error('not found');
    return new TextDecoder().decode(bytes);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    if (this.refuseBinaryReads) throw new Error('a reload must not read a binary');
    if (this.unreadable.has(path)) throw new Error('unreadable');
    this.binaryReads.push(path);
    this.readLog.push(`binary:${path}`);
    const bytes = this.files.get(path);
    if (bytes === undefined) throw new Error('not found');
    if (this.gate !== null) await this.gate;
    return bytes;
  }

  async write(): Promise<void> {
    throw new Error('the index never writes to the vault');
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

/** Delegates to another vault (the fixture folder); counts binary reads and can refuse them. */
class GuardedVault implements VaultSource {
  readonly binaryReads: VaultPath[] = [];
  refuseBinaryReads = false;
  constructor(private readonly inner: VaultSource) {}
  list(options?: ListOptions): Promise<readonly VaultPath[]> {
    return this.inner.list(options);
  }
  read(path: VaultPath): Promise<string> {
    return this.inner.read(path);
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    if (this.refuseBinaryReads) throw new Error('a reload must not read a binary');
    this.binaryReads.push(path);
    return this.inner.readBinary(path);
  }
  async write(): Promise<void> {
    throw new Error('the index never writes to the vault');
  }
  exists(path: VaultPath): Promise<boolean> {
    return this.inner.exists(path);
  }
  watch(): Unsubscribe {
    return () => {};
  }
}

/** Persists the way the plugin's `data.json` does: as JSON text, so a reload sees only what survives it. */
class JsonStore implements KeywordIndexStore {
  blob: string | null = null;
  saves = 0;
  async load(): Promise<PersistedKeywordIndex | null> {
    return this.blob === null ? null : (JSON.parse(this.blob) as PersistedKeywordIndex);
  }
  async save(index: PersistedKeywordIndex): Promise<void> {
    this.saves += 1;
    this.blob = JSON.stringify(index);
  }
}

class MemoryEmbeddingStore implements EmbeddingCacheStore {
  saved: PersistedEmbeddingCache | null = null;
  async load() {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache) {
    this.saved = cache;
  }
}

/**
 * A text containing `word` (any case) embeds to one direction and every other text to an
 * orthogonal one, so the semantic leg agrees with the keyword leg and what is retrieved is decided
 * by what the index holds.
 */
class WordProvider implements EmbeddingProvider {
  constructor(private readonly word: string) {}
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const word = this.word.toLowerCase();
    return {
      vectors: request.texts.map((t) => (t.toLowerCase().includes(word) ? [1, 0] : [0, 1])),
    };
  }
}

const scheduler = { yield: async () => {} };

/** A registration source the test can change, the way her event log changes. */
function registrations(initial: readonly RegisteredFileSpec[]) {
  let specs = [...initial];
  let reads = 0;
  return {
    read: async (): Promise<readonly RegisteredFileSpec[]> => {
      reads += 1;
      return specs;
    },
    set(next: readonly RegisteredFileSpec[]) {
      specs = [...next];
    },
    get reads() {
      return reads;
    },
  };
}

function vaultWithSources(): BinaryVault {
  const vault = new BinaryVault();
  vault.text(NOTE, '---\ncourse: SYN101\n---\n\n# My note\n\nHer own words about quillmoss.\n');
  vault.bytes(PDF, pdfBytes(PDF_PAGES));
  vault.bytes(DECK, pptxBytes(DECK_SLIDES));
  vault.bytes(DOC, docxBytes(DOC_HEADING, DOC_PARAGRAPHS));
  return vault;
}

const ALL_REGISTERED: readonly RegisteredFileSpec[] = [
  { path: PDF, role: 'past-paper', course: 'SYN101' },
  { path: DECK, role: 'objectives', course: 'SYN101' },
  { path: DOC, role: 'objectives', course: 'SYN101' },
];

const NOTHING_DONE = { indexed: 0, textless: 0, removed: 0, regrouped: 0, failed: 0 };

function docOf(index: PersistedKeywordIndex, path: VaultPath): IndexedDocument | undefined {
  return index.documents.find((d) => d.path === path);
}

function texts(index: PersistedKeywordIndex, path: VaultPath): readonly string[] {
  return docOf(index, path)?.blocks.map((b) => b.text) ?? [];
}

function paths(index: PersistedKeywordIndex): readonly VaultPath[] {
  return index.documents.map((d) => d.path);
}

/** What the citation pipeline extracts for `path`: every unit's text and `Provenance.location`. */
async function citedUnits(
  vault: VaultSource,
  path: VaultPath,
  format: 'pdf' | 'pptx' | 'docx',
): Promise<readonly { readonly text: string; readonly location: SourceLocation }[]> {
  const result = await extractFromVault(vault, path, format);
  return result.pages.flatMap((page) =>
    page.units.map((u) => ({ text: u.text.trim(), location: u.provenance.location })),
  );
}

/**
 * An engine over `vault` and `store` with binaries on (`binarySources`), her registrations read
 * from `registered` when given. `binaries: false` builds the notes-only engine every caller had
 * before this bead.
 */
async function engineOver(
  vault: VaultSource,
  store: KeywordIndexStore,
  registered?: () => Promise<readonly RegisteredFileSpec[]>,
  options: { readonly binaries?: boolean; readonly chunkSize?: number } = {},
): Promise<KeywordIndexEngine> {
  return KeywordIndexEngine.create({
    vault,
    store,
    scheduler,
    ...(options.chunkSize !== undefined ? { chunkSize: options.chunkSize } : {}),
    ...(options.binaries === false
      ? {}
      : { binarySources: registered !== undefined ? { registeredFiles: registered } : {} }),
  });
}

async function retrieveOver(index: PersistedKeywordIndex, query: string) {
  const provider = new WordProvider(query);
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingStore(),
    provider,
    model: 'fake-model-v1',
  });
  return retrieve({ keywordIndex: index, embeddingCache, embeddingProvider: provider }, query, {
    topK: 8,
  });
}

function chunkAt(
  chunks: readonly RetrievalChunk[],
  ref: { readonly path: VaultPath; readonly blockIndex: number },
): RetrievalChunk | undefined {
  return chunks.find((c) => c.path === ref.path && c.blockIndex === ref.blockIndex);
}

/** The word of `path`'s own indexed text that the fewest indexed blocks share (read at run time). */
function rarestWord(engine: KeywordIndexEngine, path: VaultPath): string | undefined {
  const words = [
    ...new Set(
      texts(engine.toPersisted(), path)
        .join(' ')
        .match(/[A-Za-z]{4,}/g) ?? [],
    ),
  ];
  return words
    .map((w) => ({ w, hits: engine.search(w).length }))
    .sort((a, b) => a.hits - b.hits || b.w.length - a.w.length)[0]?.w;
}

// ---------------------------------------------------------------------------------------------
// The slides-only course (the committed fixture), with no registration at all
// ---------------------------------------------------------------------------------------------

describe('a slides-only course is retrieved with no registration (ol-egov.141.89.1.95)', () => {
  const fixtureRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const COURSE = '01 Courses/ISLD140';

  it('the fixture course ISLD140 holds slide PDFs and nothing else', async () => {
    const files = await new FolderSource(fixtureRoot).list({ under: COURSE });
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((p) => p.toLowerCase().endsWith('.pdf'))).toBe(true);
  });

  it('nothing registered: every deck is indexed with its page anchors and retrieved, and again after a restart with nothing extracted', async () => {
    const vault = new GuardedVault(new FolderSource(fixtureRoot));
    const decks = await vault.list({ under: COURSE });
    const store = new JsonStore();

    const engine = await engineOver(vault, store);
    await engine.rebuild();
    const index = engine.toPersisted();
    for (const deck of decks) {
      const doc = docOf(index, deck);
      // No registration names a course, and the index reads none from a folder (see `binaryCourses`).
      expect(doc?.courses).toEqual([]);
      expect(doc?.evidenceScope).toBe(1);
      expect(doc?.blocks.length).toBeGreaterThan(0);
      // The anchor is the citation pipeline's own, unit for unit.
      const cited = await citedUnits(vault, deck, 'pdf');
      expect(doc?.blocks.map((b) => ({ text: b.text, location: b.location }))).toEqual(cited);
    }

    const firstDeck = decks[0] as VaultPath;
    const word = rarestWord(engine, firstDeck);
    expect(word).toBeDefined();

    // Restart: a new engine over the same stored JSON; any binary read now throws.
    vault.refuseBinaryReads = true;
    const reloaded = await engineOver(vault, store);
    expect(reloaded.toPersisted()).toEqual(index);
    // The load-time sync trusts every persisted binary: a read would have been counted as failed.
    await expect(reloaded.syncBinarySources()).resolves.toEqual(NOTHING_DONE);

    for (const held of [index, reloaded.toPersisted()]) {
      const result = await retrieveOver(held, word ?? '');
      expect(result.status).toBe('grounded');
      if (result.status !== 'grounded') return;
      const hit = result.chunks.find((c) => c.path === firstDeck);
      expect(hit).toBeDefined();
      if (hit === undefined) return;
      const location = chunkAt(await chunksFromIndex(held), hit)?.location;
      expect(location?.page).toBe(1);
      expect(
        formatSourceCitation(
          { sourcePath: hit.path, page: location?.page ?? 0 },
          { grainOnly: true },
        ),
      ).toBe('p. 1');
    }
  });

  it('a registration still gives a deck its course; the deck it does not name stays in the index, ungrouped', async () => {
    const vault = new FolderSource(fixtureRoot);
    const [named, other] = (await vault.list({ under: COURSE })) as [VaultPath, VaultPath];
    const engine = await engineOver(vault, new JsonStore(), async () => [
      { path: named, role: 'objectives', course: 'ISLD140' },
    ]);
    await engine.rebuild();
    expect(docOf(engine.toPersisted(), named)?.courses).toEqual(['ISLD140']);
    expect(docOf(engine.toPersisted(), other)?.courses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------------------------

describe('each binary chunk carries the citation pipeline’s passage anchor', () => {
  it('a PDF by page, a deck by slide and title, a document by section, equal to what extraction cites', async () => {
    const vault = vaultWithSources();
    const engine = await engineOver(vault, new JsonStore(), async () => ALL_REGISTERED);
    await engine.rebuild();
    const index = engine.toPersisted();

    for (const [path, format] of [
      [PDF, 'pdf'],
      [DECK, 'pptx'],
      [DOC, 'docx'],
    ] as const) {
      const doc = docOf(index, path);
      expect(doc?.blocks.map((b) => ({ text: b.text, location: b.location }))).toEqual(
        await citedUnits(vault, path, format),
      );
    }
    expect(docOf(index, PDF)?.blocks.map((b) => b.location?.page)).toEqual([1, 2]);
    expect(docOf(index, DECK)?.blocks.map((b) => b.location?.page)).toEqual([1, 2]);
    expect(docOf(index, DECK)?.blocks.map((b) => b.location?.section)).toEqual(
      DECK_SLIDES.map((s) => s.title),
    );
    expect(docOf(index, DOC)?.blocks.at(-1)?.location?.section).toBe(DOC_HEADING);

    // The chunk a hit names carries the same anchor, so it formats as the registry cites it:
    // the slide's title when it has one, otherwise the slide number.
    const chunks = await chunksFromIndex(index);
    const slide2 = chunks.find((c) => c.path === DECK && c.location?.page === 2);
    const page = slide2?.location?.page ?? 0;
    const section = slide2?.location?.section ?? '';
    expect(formatSourceCitation({ sourcePath: DECK, page, section }, { grainOnly: true })).toBe(
      DECK_SLIDES[1]?.title,
    );
    expect(formatSourceCitation({ sourcePath: DECK, page }, { grainOnly: true })).toBe('slide 2');

    // Her note is indexed exactly as before: no anchor key on its blocks or chunks.
    expect(docOf(index, NOTE)?.blocks.some((b) => 'location' in b)).toBe(false);
    expect(chunks.filter((c) => c.path === NOTE).some((c) => 'location' in c)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The acceptance: retrieved after a restart, nothing extracted again
// ---------------------------------------------------------------------------------------------

describe('acceptance: a PDF, slide or document source is retrieved as a source chunk after a restart', () => {
  it('indexes, persists as JSON, reloads without reading a binary, and retrieves each with its anchor', async () => {
    const vault = vaultWithSources();
    const store = new JsonStore();
    const first = await engineOver(vault, store, async () => ALL_REGISTERED);
    await first.rebuild();
    const persisted = first.toPersisted();

    // Restart: a new engine over the same stored JSON; any binary read now throws.
    vault.refuseBinaryReads = true;
    const reloaded = await engineOver(vault, store, async () => ALL_REGISTERED);
    expect(reloaded.toPersisted()).toEqual(persisted);
    // [D-491]'s guard did not discard the cache (every binary document carries evidenceScope).
    expect(paths(reloaded.toPersisted())).toEqual([DOC, PDF, DECK, NOTE].sort());

    const index = reloaded.toPersisted();
    const chunks = await chunksFromIndex(index);
    for (const [query, path, page] of [
      ['brindlecap', PDF, 2],
      ['fenlarks', DECK, 2],
      ['glimmerfern', DOC, 1],
    ] as const) {
      const result = await retrieveOver(index, query);
      expect(result.status).toBe('grounded');
      if (result.status !== 'grounded') return;
      const hit = result.chunks.find((c) => c.path === path);
      expect(hit?.text.toLowerCase()).toContain(query);
      expect(hit !== undefined && chunkAt(chunks, hit)?.location?.page).toBe(page);
    }
    // A sync on the reloaded engine trusts what is persisted: still no binary read.
    await expect(reloaded.syncBinarySources()).resolves.toEqual(NOTHING_DONE);
  });
});

// ---------------------------------------------------------------------------------------------
// Which files: every PDF, deck and document; text layer only; never a dot-folder
// ---------------------------------------------------------------------------------------------

describe('the index carries every PDF, deck and document in the vault, text layer only', () => {
  it('a binary nobody registered is indexed, by event and by rebuild, ungrouped', async () => {
    const vault = vaultWithSources();
    const engine = await engineOver(vault, new JsonStore());
    const loose = 'Courses/SYN101/loose.pdf' as VaultPath;
    vault.bytes(loose, pdfBytes(['Loose sheet about marsh reeds.']));
    await engine.applyEvent({ kind: 'create', path: loose });
    expect(docOf(engine.toPersisted(), loose)?.courses).toEqual([]);
    expect(engine.search('reeds').map((h) => h.path)).toEqual([loose]);

    await engine.rebuild();
    expect(paths(engine.toPersisted())).toEqual([DOC, loose, PDF, DECK, NOTE].sort());
    for (const path of [PDF, DECK, DOC, loose]) {
      expect(docOf(engine.toPersisted(), path)?.courses).toEqual([]);
    }
  });

  it('an image is never read or indexed, and a scanned page contributes no text', async () => {
    const vault = vaultWithSources();
    vault.bytes(MIXED, pdfBytes(['Sedgewren calls carry across open water.', '']));
    vault.bytes(SCAN, pdfBytes(['']));
    vault.bytes(IMAGE, PNG_BYTES);
    // The precondition, from the extractor itself: the empty page routes to vision.
    const mixed = await extractFromVault(vault, MIXED, 'pdf');
    expect(mixed.pages.map((p) => p.route)).toEqual(['text-layer', 'vision']);
    vault.binaryReads.length = 0;

    const engine = await engineOver(vault, new JsonStore());
    await engine.rebuild();
    await engine.applyEvent({ kind: 'create', path: IMAGE });
    await engine.applyEvent({ kind: 'modify', path: IMAGE });
    const index = engine.toPersisted();

    expect(docOf(index, IMAGE)).toBeUndefined();
    expect(vault.binaryReads).not.toContain(IMAGE);
    expect(docOf(index, MIXED)?.blocks.map((b) => b.location?.page)).toEqual([1]);
    expect(texts(index, MIXED)).toEqual(['Sedgewren calls carry across open water.']);
    // A wholly scanned file holds no block, so nothing of it is searched, embedded or retrieved.
    expect(docOf(index, SCAN)?.blocks).toEqual([]);
    const chunks = await chunksFromIndex(index);
    expect(chunks.some((c) => c.path === SCAN || c.path === IMAGE)).toBe(false);
    expect(chunks.some((c) => c.path === MIXED && c.location?.page === 2)).toBe(false);
  });

  it('a binary inside a dot-folder is never read or indexed, by rebuild or by event', async () => {
    const vault = vaultWithSources();
    const hidden = ['.trash/old-handout.pdf', '.olea/cache/deck.pptx'] as VaultPath[];
    for (const path of hidden) vault.bytes(path, pdfBytes(['Hidden sheet about bog cotton.']));
    const engine = await engineOver(vault, new JsonStore());
    await engine.rebuild();
    for (const path of hidden) await engine.applyEvent({ kind: 'create', path });
    expect(paths(engine.toPersisted())).toEqual([DOC, PDF, DECK, NOTE].sort());
    expect(vault.binaryReads.some((p) => hidden.includes(p))).toBe(false);
    await expect(engine.syncBinarySources()).resolves.toEqual(NOTHING_DONE);
  });

  it('a file that cannot be read is left out without failing the rebuild, and counted at the sync', async () => {
    const vault = vaultWithSources();
    vault.unreadable.add(DECK);
    const engine = await engineOver(vault, new JsonStore());
    await expect(engine.rebuild()).resolves.toBe('complete');
    expect(paths(engine.toPersisted())).toEqual([DOC, PDF, NOTE].sort());
    await expect(engine.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, failed: 1 });

    vault.unreadable.delete(DECK);
    await expect(engine.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, indexed: 1 });
    expect(engine.search('fenlarks').map((h) => h.path)).toEqual([DECK]);
  });

  it('without binarySources the index is notes and transcripts only, exactly as before', async () => {
    const vault = vaultWithSources();
    const engine = await engineOver(vault, new JsonStore(), undefined, { binaries: false });
    await engine.rebuild();
    await engine.applyEvent({ kind: 'modify', path: PDF });
    expect(paths(engine.toPersisted())).toEqual([NOTE]);
    expect(vault.binaryReads).toEqual([]);
    await expect(engine.syncBinarySources()).resolves.toEqual(NOTHING_DONE);
  });
});

// ---------------------------------------------------------------------------------------------
// Course: a registration names it, nothing else does
// ---------------------------------------------------------------------------------------------

describe('a binary’s course comes from her registration, and only from it', () => {
  it('a registered binary carries its registration’s course; one unregistered, or registered without a course, carries none', async () => {
    const vault = vaultWithSources();
    const engine = await engineOver(vault, new JsonStore(), async () => [
      { path: PDF, role: 'past-paper', course: 'SYN101' },
      { path: DOC, role: 'objectives' },
    ]);
    await engine.rebuild();
    const index = engine.toPersisted();
    expect(docOf(index, PDF)?.courses).toEqual(['SYN101']);
    expect(docOf(index, DOC)?.courses).toEqual([]);
    expect(docOf(index, DECK)?.courses).toEqual([]);
    // Her note keeps its own frontmatter course, as before.
    expect(docOf(index, NOTE)?.courses).toEqual(['SYN101']);
  });

  it('a later registration regroups the document at the next sync with nothing read; unregistering ungroups it and keeps it', async () => {
    const vault = vaultWithSources();
    const registered = registrations([]);
    const engine = await engineOver(vault, new JsonStore(), registered.read);
    await engine.rebuild();
    const blocks = docOf(engine.toPersisted(), PDF)?.blocks;
    expect(docOf(engine.toPersisted(), PDF)?.courses).toEqual([]);
    const reads = vault.binaryReads.length;

    registered.set([{ path: PDF, course: 'SYN101' }]);
    await expect(engine.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, regrouped: 1 });
    expect(docOf(engine.toPersisted(), PDF)?.courses).toEqual(['SYN101']);

    registered.set([{ path: PDF, course: 'SYN102' }]);
    await engine.syncBinarySources();
    expect(docOf(engine.toPersisted(), PDF)?.courses).toEqual(['SYN102']);

    registered.set([]);
    await expect(engine.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, regrouped: 1 });
    expect(docOf(engine.toPersisted(), PDF)?.courses).toEqual([]);
    expect(docOf(engine.toPersisted(), PDF)?.blocks).toBe(blocks);
    expect(vault.binaryReads.length).toBe(reads);
  });

  it('a log that cannot be read leaves every binary indexed, ungrouped, never failed', async () => {
    const vault = vaultWithSources();
    const engine = await engineOver(vault, new JsonStore(), async () => {
      throw new Error('log unreadable');
    });
    await expect(engine.rebuild()).resolves.toBe('complete');
    expect(paths(engine.toPersisted())).toEqual([DOC, PDF, DECK, NOTE].sort());
    expect(docOf(engine.toPersisted(), PDF)?.courses).toEqual([]);
    await expect(engine.syncBinarySources()).resolves.toEqual(NOTHING_DONE);
  });
});

// ---------------------------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------------------------

describe('obsolete binary chunks are invalidated', () => {
  async function liveEngine(registered = registrations(ALL_REGISTERED)) {
    const vault = vaultWithSources();
    const store = new JsonStore();
    const engine = await engineOver(vault, store, registered.read);
    await engine.rebuild();
    return { vault, store, engine, registered };
  }

  it('a changed file has its old chunks replaced', async () => {
    const { vault, engine } = await liveEngine();
    const before = docOf(engine.toPersisted(), PDF);
    vault.bytes(PDF, pdfBytes(['Mirepine needles drop in a single night.']));
    await engine.applyEvent({ kind: 'modify', path: PDF });

    const after = engine.toPersisted();
    expect(texts(after, PDF)).toHaveLength(1);
    expect(texts(after, PDF)[0]).toContain('Mirepine');
    expect(docOf(after, PDF)?.contentHash).not.toBe(before?.contentHash);
    expect(docOf(after, PDF)?.courses).toEqual(['SYN101']);
    expect(engine.search('quillmoss').some((h) => h.path === PDF)).toBe(false);
    expect(engine.search('mirepine').map((h) => h.path)).toEqual([PDF]);
  });

  it('a modify event that leaves the bytes as they were keeps the document as it was', async () => {
    const { engine } = await liveEngine();
    const before = docOf(engine.toPersisted(), DECK);
    await engine.applyEvent({ kind: 'modify', path: DECK });
    expect(docOf(engine.toPersisted(), DECK)).toBe(before);
  });

  it('a deleted file leaves the index', async () => {
    const { vault, store, engine } = await liveEngine();
    vault.remove(DECK);
    await engine.applyEvent({ kind: 'delete', path: DECK });
    expect(docOf(engine.toPersisted(), DECK)).toBeUndefined();
    expect(engine.search('fenlarks')).toEqual([]);
    expect(docOf(JSON.parse(store.blob ?? '{}') as PersistedKeywordIndex, DECK)).toBeUndefined();
  });

  it('a renamed file leaves its old path and is indexed at the new one, moved without extracting again', async () => {
    const { vault, engine } = await liveEngine();
    const before = docOf(engine.toPersisted(), PDF);
    const moved = 'Courses/SYN101/archive/handout.pdf' as VaultPath;
    vault.bytes(moved, pdfBytes(PDF_PAGES));
    vault.remove(PDF);
    await engine.applyEvent({ kind: 'rename', path: moved, oldPath: PDF });
    const after = docOf(engine.toPersisted(), moved);
    expect(paths(engine.toPersisted())).not.toContain(PDF);
    // The same block objects: carried across, not extracted again. Unregistered at the new path,
    // so ungrouped.
    expect(after?.blocks).toBe(before?.blocks);
    expect(after?.courses).toEqual([]);
    expect(engine.search('brindlecap').map((h) => h.path)).toEqual([moved]);
  });

  it('a rename into a dot-folder leaves the index; a rename back out enters it again', async () => {
    const { vault, engine } = await liveEngine();
    const trashed = '.trash/handout.pdf' as VaultPath;
    vault.bytes(trashed, pdfBytes(PDF_PAGES));
    vault.remove(PDF);
    await engine.applyEvent({ kind: 'rename', path: trashed, oldPath: PDF });
    expect(paths(engine.toPersisted())).toEqual([DOC, DECK, NOTE].sort());
    expect(engine.search('brindlecap')).toEqual([]);

    vault.bytes(PDF, pdfBytes(PDF_PAGES));
    vault.remove(trashed);
    await engine.applyEvent({ kind: 'rename', path: PDF, oldPath: trashed });
    expect(engine.search('brindlecap').map((h) => h.path)).toEqual([PDF]);
    expect(docOf(engine.toPersisted(), PDF)?.courses).toEqual(['SYN101']);
    expect(vault.binaryReads).not.toContain(trashed);
  });

  it('incremental events reach the same index a rebuild does (C2.4, every binary included)', async () => {
    const vault = vaultWithSources();
    const registered = registrations(ALL_REGISTERED);
    const live = await engineOver(vault, new JsonStore(), registered.read);
    await live.syncBinarySources();
    await live.applyEvent({ kind: 'create', path: NOTE });
    vault.bytes(PDF, pdfBytes(['Mirepine needles drop in a single night.']));
    await live.applyEvent({ kind: 'modify', path: PDF });
    vault.remove(DOC);
    await live.applyEvent({ kind: 'delete', path: DOC });
    const loose = 'Courses/SYN101/loose.docx' as VaultPath;
    vault.bytes(loose, docxBytes('Loose heading', ['Loose paragraph about sundew traps.']));
    await live.applyEvent({ kind: 'create', path: loose });
    const moved = 'Courses/SYN101/slides/week-3-deck.pptx' as VaultPath;
    vault.bytes(moved, pptxBytes(DECK_SLIDES));
    vault.remove(DECK);
    await live.applyEvent({ kind: 'rename', path: moved, oldPath: DECK });

    const rebuilt = await engineOver(vault, new JsonStore(), registered.read);
    await rebuilt.rebuild();
    expect(live.toPersisted()).toEqual(rebuilt.toPersisted());

    const direct = await buildFullIndex({
      vault,
      scheduler,
      binarySources: { registeredFiles: ALL_REGISTERED },
    });
    expect(direct.status === 'complete' && direct.index).toEqual(rebuilt.toPersisted());
  });
});

// ---------------------------------------------------------------------------------------------
// The load-time sync
// ---------------------------------------------------------------------------------------------

describe('the load-time sync reconciles the vault’s binaries against the index', () => {
  it('a populated notes-only index gains every binary; a file gone while closed leaves; what is held is trusted', async () => {
    const vault = vaultWithSources();
    const store = new JsonStore();
    const before = await engineOver(vault, store, undefined, { binaries: false });
    await before.rebuild();
    expect(paths(before.toPersisted())).toEqual([NOTE]);

    const first = await engineOver(vault, store);
    await expect(first.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, indexed: 3 });
    expect(paths(first.toPersisted())).toEqual([DOC, PDF, DECK, NOTE].sort());

    // Closed; the deck is deleted outside Obsidian; opened again.
    vault.remove(DECK);
    const reads = vault.binaryReads.length;
    const second = await engineOver(vault, store);
    await expect(second.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, removed: 1 });
    expect(paths(second.toPersisted())).toEqual([DOC, PDF, NOTE].sort());
    expect(vault.binaryReads.length).toBe(reads);
  });

  it('a file whose text layer is empty is held with no blocks, and is not read again after a restart', async () => {
    const vault = vaultWithSources();
    vault.bytes(SCAN, pdfBytes(['']));
    const store = new JsonStore();
    const first = await engineOver(vault, store);
    await expect(first.syncBinarySources()).resolves.toEqual({
      ...NOTHING_DONE,
      indexed: 3,
      textless: 1,
    });
    expect(docOf(first.toPersisted(), SCAN)?.blocks).toEqual([]);

    vault.refuseBinaryReads = true;
    const reloaded = await engineOver(vault, store);
    await expect(reloaded.syncBinarySources()).resolves.toEqual(NOTHING_DONE);
    expect(docOf(reloaded.toPersisted(), SCAN)?.blocks).toEqual([]);
  });

  it('a rebuild that defers binaries reads none, and the sync after it reaches the full rebuild (C2.4)', async () => {
    const vault = vaultWithSources();
    const registered = registrations(ALL_REGISTERED);
    const engine = await engineOver(vault, new JsonStore(), registered.read);
    await engine.rebuild({ deferBinaries: true });
    expect(paths(engine.toPersisted())).toEqual([NOTE]);
    expect(vault.binaryReads).toEqual([]);

    await expect(engine.syncBinarySources()).resolves.toEqual({ ...NOTHING_DONE, indexed: 3 });
    const full = await engineOver(vault, new JsonStore(), registered.read);
    await full.rebuild();
    expect(engine.toPersisted()).toEqual(full.toPersisted());
  });

  it('progress is saved as the sync goes, not only at its end', async () => {
    const vault = vaultWithSources();
    const store = new JsonStore();
    const engine = await engineOver(vault, store, undefined, { chunkSize: 1 });
    await engine.syncBinarySources();
    // One save per extracted binary at chunk size one.
    expect(store.saves).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
// One change at a time
// ---------------------------------------------------------------------------------------------

describe('a sync and vault events take turns', () => {
  it('a delete during a binary’s extraction is applied after it, so the file stays out', async () => {
    const vault = vaultWithSources();
    const engine = await engineOver(vault, new JsonStore(), async () => ALL_REGISTERED);
    let release = (): void => {};
    vault.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = engine.syncBinarySources();
    // Let the sync reach the (held) binary read before the file is deleted.
    await new Promise((resolve) => setTimeout(resolve, 0));
    vault.remove(PDF);
    const deleted = engine.applyEvent({ kind: 'delete', path: PDF });
    vault.gate = null;
    release();
    await Promise.all([sync, deleted]);
    expect(docOf(engine.toPersisted(), PDF)).toBeUndefined();
  });

  it('a note edited during a sync is indexed after the binary being extracted, not after the whole sync', async () => {
    const vault = vaultWithSources();
    const engine = await engineOver(vault, new JsonStore());
    let release = (): void => {};
    vault.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = engine.syncBinarySources();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const edited = engine.applyEvent({ kind: 'create', path: NOTE });
    vault.gate = null;
    release();
    await Promise.all([sync, edited]);
    const order = vault.readLog;
    const binaries = order.filter((r) => r.startsWith('binary:'));
    expect(binaries).toHaveLength(3);
    // Her note was read after the first binary and before the last.
    expect(order.indexOf(`text:${NOTE}`)).toBeGreaterThan(order.indexOf(binaries[0] ?? ''));
    expect(order.indexOf(`text:${NOTE}`)).toBeLessThan(order.indexOf(binaries[2] ?? ''));
  });
});
