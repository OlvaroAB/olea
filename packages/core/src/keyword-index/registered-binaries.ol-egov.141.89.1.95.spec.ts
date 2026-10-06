/**
 * `ol-egov.141.89.1.95`: the keyword index carries her registered binary sources (a PDF, a deck,
 * a document) beside her notes, with the passage anchor the citation pipeline cites, kept current
 * when a registered file changes and invalidated when it is deleted, renamed or unregistered, and
 * retrievable at query time after a restart without extracting anything again.
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

// ---------------------------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------------------------

/** An in-memory vault holding bytes, with `extensions` honoured as `VaultSource.list` documents. */
class BinaryVault implements VaultSource {
  readonly binaryReads: VaultPath[] = [];
  /** When set, every `readBinary` waits on it after taking the bytes (the race test). */
  gate: Promise<void> | null = null;
  /** When set, `readBinary` throws: proves a reload extracts nothing. */
  refuseBinaryReads = false;
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
    const bytes = this.files.get(path);
    if (bytes === undefined) throw new Error('not found');
    return new TextDecoder().decode(bytes);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    if (this.refuseBinaryReads) throw new Error('a reload must not read a binary');
    this.binaryReads.push(path);
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
  return {
    read: async (): Promise<readonly RegisteredFileSpec[]> => specs,
    set(next: readonly RegisteredFileSpec[]) {
      specs = [...next];
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

function docOf(index: PersistedKeywordIndex, path: VaultPath): IndexedDocument | undefined {
  return index.documents.find((d) => d.path === path);
}

function texts(index: PersistedKeywordIndex, path: VaultPath): readonly string[] {
  return docOf(index, path)?.blocks.map((b) => b.text) ?? [];
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

async function engineOver(
  vault: VaultSource,
  store: KeywordIndexStore,
  registered?: () => Promise<readonly RegisteredFileSpec[]>,
): Promise<KeywordIndexEngine> {
  return KeywordIndexEngine.create({
    vault,
    store,
    scheduler,
    ...(registered !== undefined ? { registeredFiles: registered } : {}),
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

// ---------------------------------------------------------------------------------------------
// The slides-only course (the committed fixture)
// ---------------------------------------------------------------------------------------------

describe('a slides-only course yields retrievable source chunks (ol-egov.141.89.1.95)', () => {
  const fixtureRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const COURSE = '01 Courses/ISLD140';

  it('the fixture course ISLD140 holds slide PDFs and nothing else', async () => {
    const files = await new FolderSource(fixtureRoot).list({ under: COURSE });
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((p) => p.toLowerCase().endsWith('.pdf'))).toBe(true);
  });

  it('unregistered, its decks are absent from the index; registered, every deck is indexed with page anchors and retrieved', async () => {
    const vault = new FolderSource(fixtureRoot);
    const decks = await vault.list({ under: COURSE });

    const before = await engineOver(vault, new JsonStore());
    await before.rebuild();
    expect(before.toPersisted().documents.some((d) => d.path.startsWith(`${COURSE}/`))).toBe(false);

    const engine = await engineOver(vault, new JsonStore(), async () =>
      decks.map((path) => ({ path, role: 'objectives' as const, course: 'ISLD140' })),
    );
    await engine.rebuild();
    const index = engine.toPersisted();
    for (const deck of decks) {
      const doc = docOf(index, deck);
      expect(doc?.courses).toEqual(['ISLD140']);
      expect(doc?.evidenceScope).toBe(1);
      expect(doc?.blocks.length).toBeGreaterThan(0);
      // The anchor is the citation pipeline's own, unit for unit.
      const cited = await citedUnits(vault, deck, 'pdf');
      expect(doc?.blocks.map((b) => ({ text: b.text, location: b.location }))).toEqual(cited);
    }

    // Retrieved at query time, by the word of the deck's own extracted text that the fewest
    // indexed blocks share (read at run time; no fixture text is written into this file).
    const firstDeck = decks[0] as VaultPath;
    const words = [
      ...new Set(
        texts(index, firstDeck)
          .join(' ')
          .match(/[A-Za-z]{4,}/g) ?? [],
      ),
    ];
    const word = words
      .map((w) => ({ w, hits: engine.search(w).length }))
      .sort((a, b) => a.hits - b.hits || b.w.length - a.w.length)[0]?.w;
    expect(word).toBeDefined();
    const result = await retrieveOver(index, word ?? '');
    expect(result.status).toBe('grounded');
    if (result.status !== 'grounded') return;
    const hit = result.chunks.find((c) => c.path === firstDeck);
    expect(hit).toBeDefined();
    if (hit === undefined) return;
    const location = chunkAt(await chunksFromIndex(index), hit)?.location;
    expect(location?.page).toBe(1);
    expect(
      formatSourceCitation(
        { sourcePath: hit.path, page: location?.page ?? 0 },
        { grainOnly: true },
      ),
    ).toBe('p. 1');
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
    expect(reloaded.toPersisted().documents.map((d) => d.path)).toEqual(
      [DOC, PDF, DECK, NOTE].sort(),
    );

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
    await expect(reloaded.syncRegisteredSources()).resolves.toEqual({
      indexed: 0,
      removed: 0,
      textless: 0,
      failed: 0,
    });
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

  it('a changed registered file has its old chunks replaced', async () => {
    const { vault, engine } = await liveEngine();
    const before = docOf(engine.toPersisted(), PDF);
    vault.bytes(PDF, pdfBytes(['Mirepine needles drop in a single night.']));
    await engine.applyEvent({ kind: 'modify', path: PDF });

    const after = engine.toPersisted();
    expect(texts(after, PDF)).toHaveLength(1);
    expect(texts(after, PDF)[0]).toContain('Mirepine');
    expect(docOf(after, PDF)?.contentHash).not.toBe(before?.contentHash);
    expect(engine.search('quillmoss').some((h) => h.path === PDF)).toBe(false);
    expect(engine.search('mirepine').map((h) => h.path)).toEqual([PDF]);
  });

  it('a modify event that leaves the bytes as they were keeps the document as it was', async () => {
    const { engine } = await liveEngine();
    const before = docOf(engine.toPersisted(), DECK);
    await engine.applyEvent({ kind: 'modify', path: DECK });
    expect(docOf(engine.toPersisted(), DECK)).toBe(before);
  });

  it('a deleted registered file leaves the index', async () => {
    const { vault, store, engine } = await liveEngine();
    vault.remove(DECK);
    await engine.applyEvent({ kind: 'delete', path: DECK });
    expect(docOf(engine.toPersisted(), DECK)).toBeUndefined();
    expect(engine.search('fenlarks')).toEqual([]);
    expect(docOf(JSON.parse(store.blob ?? '{}') as PersistedKeywordIndex, DECK)).toBeUndefined();
  });

  it('a renamed registered file leaves the index under its old path, and is not indexed under a new path nobody registered', async () => {
    const { vault, engine } = await liveEngine();
    const moved = 'Courses/SYN101/archive/handout.pdf' as VaultPath;
    vault.bytes(moved, pdfBytes(PDF_PAGES));
    vault.remove(PDF);
    await engine.applyEvent({ kind: 'rename', path: moved, oldPath: PDF });
    const paths = engine.toPersisted().documents.map((d) => d.path);
    expect(paths).not.toContain(PDF);
    expect(paths).not.toContain(moved);
    expect(engine.search('brindlecap')).toEqual([]);
  });

  it('a rename onto a registered path is indexed there', async () => {
    const moved = 'Courses/SYN101/archive/handout.pdf' as VaultPath;
    const registered = registrations([...ALL_REGISTERED, { path: moved, course: 'SYN101' }]);
    const { vault, engine } = await liveEngine(registered);
    vault.bytes(moved, pdfBytes(PDF_PAGES));
    vault.remove(PDF);
    await engine.applyEvent({ kind: 'rename', path: moved, oldPath: PDF });
    const paths = engine.toPersisted().documents.map((d) => d.path);
    expect(paths).not.toContain(PDF);
    expect(paths).toContain(moved);
  });

  it('an unregistered file leaves the index at the next sync; her note stays', async () => {
    const registered = registrations(ALL_REGISTERED);
    const { engine, store } = await liveEngine(registered);
    const note = docOf(engine.toPersisted(), NOTE);
    registered.set(ALL_REGISTERED.filter((s) => s.path !== DOC));
    await expect(engine.syncRegisteredSources()).resolves.toEqual({
      indexed: 0,
      removed: 1,
      textless: 0,
      failed: 0,
    });
    expect(docOf(engine.toPersisted(), DOC)).toBeUndefined();
    expect(docOf(engine.toPersisted(), NOTE)).toBe(note);
    expect(docOf(JSON.parse(store.blob ?? '{}') as PersistedKeywordIndex, DOC)).toBeUndefined();
  });

  it('a newly registered file is indexed at the next sync, and a corrected course reaches its document', async () => {
    const registered = registrations([]);
    const { engine } = await liveEngine(registered);
    expect(docOf(engine.toPersisted(), PDF)).toBeUndefined();

    registered.set([{ path: PDF, course: 'SYN101' }]);
    await expect(engine.syncRegisteredSources()).resolves.toMatchObject({ indexed: 1, failed: 0 });
    expect(docOf(engine.toPersisted(), PDF)?.courses).toEqual(['SYN101']);

    registered.set([{ path: PDF, course: 'SYN102' }]);
    await engine.syncRegisteredSources();
    expect(docOf(engine.toPersisted(), PDF)?.courses).toEqual(['SYN102']);
  });

  it('a binary nobody registered never becomes a document, by event or by rebuild', async () => {
    const { vault, engine } = await liveEngine(registrations([]));
    vault.bytes(
      'Courses/SYN101/loose.pdf' as VaultPath,
      pdfBytes(['Loose sheet about marsh reeds.']),
    );
    await engine.applyEvent({ kind: 'create', path: 'Courses/SYN101/loose.pdf' as VaultPath });
    await engine.rebuild();
    expect(engine.toPersisted().documents.map((d) => d.path)).toEqual([NOTE]);
  });

  it('a registered file that yields no text is left out, and not extracted again for the same bytes', async () => {
    const empty = 'Courses/SYN101/scan.pdf' as VaultPath;
    const registered = registrations([{ path: empty, course: 'SYN101' }]);
    const { vault, engine } = await liveEngine(registered);
    vault.bytes(empty, pdfBytes(['']));
    await expect(engine.syncRegisteredSources()).resolves.toMatchObject({
      indexed: 0,
      textless: 1,
    });
    const reads = vault.binaryReads.filter((p) => p === empty).length;
    await engine.syncRegisteredSources();
    // Read once to hash, never extracted: the hash matches the bytes that yielded nothing.
    expect(vault.binaryReads.filter((p) => p === empty).length).toBe(reads + 1);
    expect(docOf(engine.toPersisted(), empty)).toBeUndefined();
  });

  it('incremental events reach the same index a rebuild does (C2.4, binaries included)', async () => {
    const vault = vaultWithSources();
    const registered = registrations(ALL_REGISTERED);
    const live = await engineOver(vault, new JsonStore(), registered.read);
    await live.syncRegisteredSources();
    for (const path of [NOTE]) await live.applyEvent({ kind: 'create', path });
    vault.bytes(PDF, pdfBytes(['Mirepine needles drop in a single night.']));
    await live.applyEvent({ kind: 'modify', path: PDF });
    vault.remove(DOC);
    await live.applyEvent({ kind: 'delete', path: DOC });

    const rebuilt = await engineOver(vault, new JsonStore(), registered.read);
    await rebuilt.rebuild();
    expect(live.toPersisted()).toEqual(rebuilt.toPersisted());

    const direct = await buildFullIndex({ vault, scheduler, registeredFiles: ALL_REGISTERED });
    expect(direct.status === 'complete' && direct.index).toEqual(rebuilt.toPersisted());
  });
});

// ---------------------------------------------------------------------------------------------
// One change at a time
// ---------------------------------------------------------------------------------------------

describe('a delete during a registered file’s extraction leaves no stale document', () => {
  it('the delete is applied after the extraction it raced, so the file stays out', async () => {
    const vault = vaultWithSources();
    const engine = await engineOver(vault, new JsonStore(), async () => ALL_REGISTERED);
    let release = (): void => {};
    vault.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = engine.syncRegisteredSources();
    // Let the sync reach the (held) binary read before the file is deleted.
    await new Promise((resolve) => setTimeout(resolve, 0));
    vault.remove(PDF);
    const deleted = engine.applyEvent({ kind: 'delete', path: PDF });
    vault.gate = null;
    release();
    await Promise.all([sync, deleted]);
    expect(docOf(engine.toPersisted(), PDF)).toBeUndefined();
  });
});
