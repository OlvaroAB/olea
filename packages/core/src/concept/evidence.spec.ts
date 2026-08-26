import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { extractTier3Evidence } from './evidence.js';
import { extractConcepts } from './extract.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');

describe('extractTier3Evidence — default vocabulary (every Zettelkasten title), against the fixture vault (F4.1, P5-T02)', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  it('clusters past-paper questions naming the same concept across both fixture years, inspectably', async () => {
    const result = await extractTier3Evidence(source);

    const imbrication = result.pastPaperClusters.find((c) => c.conceptName === 'Imbrication');
    expect(imbrication).toBeDefined();
    expect(imbrication?.course).toBe('GEOL204');
    // 2024's Question 3 plus all three of 2023's questions — the whole
    // reason the second past-paper year fixture exists (README.md).
    expect(imbrication?.questions.map((q) => `${q.sourcePath}#${q.label}`).sort()).toEqual([
      '03 Research/GEOL204 Past Paper 2023.md#1',
      '03 Research/GEOL204 Past Paper 2023.md#2',
      '03 Research/GEOL204 Past Paper 2023.md#3',
      '03 Research/GEOL204 Past Paper 2024.md#3',
    ]);
    // A cluster is evidence, not an assertion — every member question
    // carries its own verbatim text and exact provenance, not just a count.
    for (const q of imbrication?.questions ?? []) {
      expect(q.text.toLowerCase()).toContain('imbrication');
      expect(q.provenance.sourcePath).toBe(q.sourcePath);
      expect(q.provenance.location.charRange.end).toBeGreaterThan(
        q.provenance.location.charRange.start,
      );
    }

    const pump = result.pastPaperClusters.find((c) => c.conceptName === 'Hummocky stratification');
    expect(pump?.questions.map((q) => `${q.sourcePath}#${q.label}`).sort()).toEqual([
      '03 Research/GEOL204 Past Paper 2023.md#2',
      '03 Research/GEOL204 Past Paper 2024.md#2',
    ]);

    // Named in only one question each — still a real, inspectable cluster,
    // not filtered out for being size 1.
    const threshold = result.pastPaperClusters.find((c) => c.conceptName === 'Bioturbation');
    expect(threshold?.questions).toHaveLength(1);
    expect(threshold?.questions[0]?.sourcePath).toBe('03 Research/GEOL204 Past Paper 2023.md');
    expect(threshold?.questions[0]?.label).toBe('3');

    const paraconformity = result.pastPaperClusters.find((c) => c.conceptName === 'Paraconformity');
    expect(paraconformity?.questions).toHaveLength(1);

    // No MUSTH104 zettel, and no other GEOL204 zettel (Cementation,
    // Ripple lamination), is named verbatim in either past paper.
    expect(result.pastPaperClusters.map((c) => c.conceptName).sort()).toEqual([
      'Bioturbation',
      'Hummocky stratification',
      'Imbrication',
      'Paraconformity',
    ]);
  });

  it('cites the objectives document, at block-level provenance, honestly missing the plural form (R1/R2 — no fuzzy matching)', async () => {
    const result = await extractTier3Evidence(source);
    const objectivesCitations = result.citations.filter((c) => c.kind === 'objectives');

    // The objectives doc names "an Imbrication fabric" (bullet 1) and
    // "Hummocky stratification" (bullet 4) verbatim; its third bullet
    // ("imbricated fabrics") does not match "Imbrication" —
    // exactly one citation per concept, not one per bullet or bullet-1-and-3.
    expect(objectivesCitations).toHaveLength(2);
    expect(objectivesCitations.map((c) => c.conceptName).sort()).toEqual([
      'Hummocky stratification',
      'Imbrication',
    ]);
    for (const c of objectivesCitations) {
      expect(c.sourcePath).toBe('03 Research/GEOL204 Course Objectives.md');
      expect(c.course).toBe('GEOL204');
      expect(c.questionLabel).toBeUndefined();
    }
  });

  it('the generated-content leg finds nothing under the bare Zettelkasten vocabulary — the embedded PDF names a topic term, not a zettel title', async () => {
    const result = await extractTier3Evidence(source);
    expect(result.citations.filter((c) => c.kind === 'generated-content')).toEqual([]);
  });

  it('echoes the vocabulary it matched against and passes registerSources’s own report through unchanged', async () => {
    const result = await extractTier3Evidence(source);
    expect(result.vocabulary).toEqual(
      expect.arrayContaining(['Imbrication', 'Hummocky stratification']),
    );
    expect(result.sourcesReport.sourcesFolder).toBe('03 Research');
    expect(result.sourcesReport.sources.map((s) => s.path)).toEqual(
      expect.arrayContaining([
        '03 Research/GEOL204 Past Paper 2023.md',
        '03 Research/GEOL204 Past Paper 2024.md',
        '03 Research/GEOL204 Course Objectives.md',
      ]),
    );
  });

  it('is deterministic across repeated calls', async () => {
    const first = await extractTier3Evidence(source);
    const second = await extractTier3Evidence(source);
    expect(second).toEqual(first);
  });
});

describe('extractTier3Evidence — richer vocabulary (zettel titles + tier-1/2 names, as extractConcepts supplies internally)', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  it('a generated-content citation appears once the vocabulary includes topic names too', async () => {
    const tier12 = await extractConcepts(source);
    const vocabulary = [...new Set(tier12.map((c) => c.name))];

    const result = await extractTier3Evidence(source, { vocabulary });
    const generatedContent = result.citations.filter((c) => c.kind === 'generated-content');

    expect(generatedContent).toHaveLength(1);
    expect(generatedContent[0]).toMatchObject({
      conceptName: 'Stratigraphic succession',
      kind: 'generated-content',
      sourcePath: '01 Courses/GEOL204/WEEK 2/Geol204-Week2-Slides.pdf',
      course: 'GEOL204',
    });
    // Exact provenance from the extract/ pipeline itself, not invented here.
    expect(generatedContent[0]?.provenance.sourcePath).toBe(
      '01 Courses/GEOL204/WEEK 2/Geol204-Week2-Slides.pdf',
    );
  });
});

describe('extractTier3Evidence — C7: discovery never writes to her vault (INV-2)', () => {
  it('running extractConcepts with includeTier3 and extractTier3Evidence directly leaves every fixture file byte-identical', async () => {
    const source = new FolderSource(FIXTURE_ROOT);
    const allPaths = await source.list();
    const before = new Map(
      await Promise.all(allPaths.map(async (p) => [p, await source.read(p)] as const)),
    );

    await extractConcepts(source, { includeTier3: true });
    await extractTier3Evidence(source);

    const after = new Map(
      await Promise.all(allPaths.map(async (p) => [p, await source.read(p)] as const)),
    );
    expect(after).toEqual(before);
    // No new file appeared either — the vault's own file list is unchanged,
    // proving discovery stayed entirely in the returned in-memory records.
    expect(await source.list()).toEqual(allPaths);
  });
});

// ---------------------------------------------------------------------------
// Synthetic derived-material suites (ol-n0yc, ol-22zr).
//
// The frozen fixture vault carries exactly one embedded deck, so it can carry
// neither of the shapes below: a source filed at two paths, and a slide
// template repeated across the decks of several courses. Both were measured on
// real material — `olea-service/findings/G1-concept-review.md` §(c), private —
// and both are reproduced here as *shapes*, with every string invented.
// ---------------------------------------------------------------------------

/**
 * A minimal, valid, multi-page PDF with one `Tj` per page — the same hand-built
 * style `fixtures/vault/README.md` describes and `../extract/pdf.spec.ts` uses,
 * so these tests exercise the real parser rather than a mock of it.
 */
function buildPdfBytes(pageTexts: readonly string[]): Uint8Array {
  const pageCount = pageTexts.length;
  const fontNum = 3;
  const firstPageNum = 4;
  const firstContentNum = firstPageNum + pageCount;
  const escapeLiteral = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageNum + i} 0 R`).join(' ');
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`,
    `${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  ];
  for (let i = 0; i < pageCount; i++) {
    objects.push(
      `${firstPageNum + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${firstContentNum + i} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>\nendobj\n`,
    );
  }
  for (let i = 0; i < pageCount; i++) {
    const raw = `BT /F1 12 Tf 20 150 Td (${escapeLiteral(pageTexts[i] ?? '')}) Tj ET`;
    objects.push(
      `${firstContentNum + i} 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
    );
  }
  const trailer = `trailer\n<< /Size ${firstContentNum + pageCount} /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  const text = `%PDF-1.4\n${objects.join('')}${trailer}`;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

describe('extractTier3Evidence — one source, two paths (ol-n0yc)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-dup-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeText(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async function writePdf(relPath: string, pageTexts: readonly string[]): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buildPdfBytes(pageTexts));
  }

  it('counts byte-identical content once, from the first path, and names the other copy rather than hiding it', async () => {
    await writeText('05 Zettelkasten/Basalt weathering.md', '---\ntype: concept\n---\n\n# B\n');
    const deck = ['Slide about Basalt weathering in the field and how to spot it.'];
    await writePdf('01 Courses/COURSEA/WEEK 1/deck.pdf', deck);
    await writePdf('01 Courses/COURSEA/Archive/deck copy.pdf', deck);
    await writeText(
      '01 Courses/COURSEA/WEEK 1/Lecture.md',
      '---\ntopic: [Something else]\n---\n\n![[01 Courses/COURSEA/WEEK 1/deck.pdf]]\n',
    );
    await writeText(
      '01 Courses/COURSEA/Archive/Backup.md',
      '---\ntopic: [Something else]\n---\n\n![[01 Courses/COURSEA/Archive/deck copy.pdf]]\n',
    );

    const result = await extractTier3Evidence(source);
    const cited = result.citations.filter(
      (c) => c.kind === 'generated-content' && c.conceptName === 'Basalt weathering',
    );

    // One source counted once — not two "agreeing" sources.
    expect(cited).toHaveLength(1);
    expect(cited[0]?.sourcePath).toBe('01 Courses/COURSEA/Archive/deck copy.pdf');
    // …and the copy is named, not made to disappear: filing a deck in two
    // places may be deliberate, and that is hers to decide.
    expect(cited[0]?.duplicateSourcePaths).toEqual(['01 Courses/COURSEA/WEEK 1/deck.pdf']);
  });

  it('identity is the CONTENT, not the filename — same name, different bytes, cited twice', async () => {
    await writeText('05 Zettelkasten/Basalt weathering.md', '---\ntype: concept\n---\n\n# B\n');
    await writePdf('01 Courses/COURSEA/WEEK 1/deck.pdf', [
      'First deck discussing Basalt weathering at length.',
    ]);
    await writePdf('01 Courses/COURSEB/WEEK 1/deck.pdf', [
      'A different deck that also covers Basalt weathering, differently.',
    ]);
    await writeText(
      '01 Courses/COURSEA/WEEK 1/Lecture.md',
      '---\ntopic: [Something else]\n---\n\n![[01 Courses/COURSEA/WEEK 1/deck.pdf]]\n',
    );
    await writeText(
      '01 Courses/COURSEB/WEEK 1/Lecture.md',
      '---\ntopic: [Something else]\n---\n\n![[01 Courses/COURSEB/WEEK 1/deck.pdf]]\n',
    );

    const result = await extractTier3Evidence(source);
    const cited = result.citations.filter(
      (c) => c.kind === 'generated-content' && c.conceptName === 'Basalt weathering',
    );
    expect(cited).toHaveLength(2);
    expect(cited.map((c) => c.course).sort()).toEqual(['COURSEA', 'COURSEB']);
    for (const citation of cited) expect(citation.duplicateSourcePaths).toBeUndefined();
  });

  it('the surviving citation keeps every course either copy was filed under', async () => {
    await writeText('05 Zettelkasten/Basalt weathering.md', '---\ntype: concept\n---\n\n# B\n');
    const deck = ['Cross-listed slide naming Basalt weathering once.'];
    await writePdf('01 Courses/COURSEA/WEEK 1/deck.pdf', deck);
    await writePdf('01 Courses/COURSEB/WEEK 1/deck.pdf', deck);
    await writeText(
      '01 Courses/COURSEA/WEEK 1/Lecture.md',
      '---\ntopic: [Something else]\n---\n\n![[01 Courses/COURSEA/WEEK 1/deck.pdf]]\n',
    );
    await writeText(
      '01 Courses/COURSEB/WEEK 1/Lecture.md',
      '---\ntopic: [Something else]\n---\n\n![[01 Courses/COURSEB/WEEK 1/deck.pdf]]\n',
    );

    const result = await extractTier3Evidence(source);
    const cited = result.citations.filter(
      (c) => c.kind === 'generated-content' && c.conceptName === 'Basalt weathering',
    );
    // Counted once per course it is genuinely filed under — never twice for
    // the same course because the same bytes exist twice.
    expect(cited.map((c) => c.course).sort()).toEqual(['COURSEA', 'COURSEB']);
    expect(cited.every((c) => c.sourcePath === '01 Courses/COURSEA/WEEK 1/deck.pdf')).toBe(true);
  });
});

describe('extractTier3Evidence — slide-template headings are not evidence (ol-22zr)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-boiler-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeText(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async function writePdf(relPath: string, pageTexts: readonly string[]): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buildPdfBytes(pageTexts));
  }

  async function deck(course: string, name: string, pageTexts: readonly string[]): Promise<void> {
    const pdf = `01 Courses/${course}/${name}/deck.pdf`;
    await writePdf(pdf, pageTexts);
    await writeText(
      `01 Courses/${course}/${name}/Lecture.md`,
      `---\ntopic: [Something else]\n---\n\n![[${pdf}]]\n`,
    );
  }

  it('a heading phrase that opens the pages of several distinct decks stops minting the concept it happens to contain', async () => {
    // `Overview` is a Zettelkasten note of hers AND the first word of the
    // template heading every deck in this vault opens with — the collision
    // this bead is about. Nothing here is a stop-word list: the phrase is
    // template furniture only because it demonstrably repeats.
    await writeText('05 Zettelkasten/Overview.md', '---\ntype: concept\n---\n\n# Overview\n');
    await writeText('05 Zettelkasten/Basalt weathering.md', '---\ntype: concept\n---\n\n# B\n');

    await deck('COURSEA', 'WEEK 1', ['Overview and aims for this session', 'Body slide one']);
    await deck('COURSEB', 'WEEK 1', ['Overview and aims for the module', 'Body slide two']);
    await deck('COURSEC', 'WEEK 1', ['Overview and aims of the course', 'Body slide three']);
    await deck('COURSED', 'WEEK 1', [
      'Overview and aims listed here',
      'Body slide mentioning Basalt weathering and, later, a genuine Overview of it',
    ]);

    const result = await extractTier3Evidence(source);
    const generated = result.citations.filter((c) => c.kind === 'generated-content');

    // Four template headings contributed nothing at all…
    expect(generated.filter((c) => c.conceptName === 'Overview')).toHaveLength(1);
    // …and the one that survived is the body mention, not a heading.
    expect(generated.find((c) => c.conceptName === 'Overview')?.sourcePath).toBe(
      '01 Courses/COURSED/WEEK 1/deck.pdf',
    );
    // The page was not discarded — its furniture was. The other concept on
    // that same page is untouched.
    expect(generated.filter((c) => c.conceptName === 'Basalt weathering')).toHaveLength(1);
  });

  it('a running header repeated across the pages of ONE deck is that deck’s subject, and is never suppressed', async () => {
    await writeText('05 Zettelkasten/Overview.md', '---\ntype: concept\n---\n\n# Overview\n');
    await deck('COURSEA', 'WEEK 1', [
      'Overview and aims for this session',
      'Overview and aims for this session',
      'Overview and aims for this session',
      'Overview and aims for this session',
      'Overview and aims for this session',
    ]);

    const result = await extractTier3Evidence(source);
    // Repetition WITHIN one document is not evidence of a template — it is
    // usually the deck's own title, and often its most real concept.
    expect(
      result.citations.filter(
        (c) => c.kind === 'generated-content' && c.conceptName === 'Overview',
      ),
    ).toHaveLength(5);
  });

  it('a duplicated file cannot half-manufacture the repetition that suppresses its own heading (ol-n0yc × ol-22zr)', async () => {
    await writeText('05 Zettelkasten/Overview.md', '---\ntype: concept\n---\n\n# Overview\n');
    const pages = ['Overview and aims for this session', 'Body slide'];
    // Four *paths*, but only two distinct documents — below the threshold.
    await deck('COURSEA', 'WEEK 1', pages);
    await deck('COURSEB', 'WEEK 1', ['Overview and aims for the module', 'Body slide']);
    await writePdf('01 Courses/COURSEA/Archive/copy.pdf', pages);
    await writeText(
      '01 Courses/COURSEA/Archive/Backup.md',
      '---\ntopic: [Something else]\n---\n\n![[01 Courses/COURSEA/Archive/copy.pdf]]\n',
    );

    const result = await extractTier3Evidence(source);
    const overview = result.citations.filter(
      (c) => c.kind === 'generated-content' && c.conceptName === 'Overview',
    );
    // Two distinct documents, both headings kept, and the duplicate counted once.
    expect(overview).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// F3.1 / `ol-ep3.2` — a vault file enters the pipeline with no note embedding it.
//
// R6's ruling: "sources = embeds is not acceptable for v0.9." Every fixture
// below is invented; the SHAPE being reproduced (a large, content-rich document
// that no note embeds, sitting in a course folder) was measured on real
// material and is recorded in `olea-service/findings/`, private, by path only.
// ---------------------------------------------------------------------------
describe('extractTier3Evidence — registration without an embedding note (F3.1, ol-ep3.2)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-register-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeText(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async function writePdf(relPath: string, pageTexts: readonly string[]): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buildPdfBytes(pageTexts));
  }

  /** A concept note, so the default Zettelkasten vocabulary has something to match. */
  async function zettel(title: string): Promise<void> {
    await writeText(`05 Zettelkasten/${title}.md`, `---\ntype: concept\n---\n\n# ${title}\n`);
  }

  it('a file no note embeds is invisible until it is registered, and cites once it is', async () => {
    await zettel('Sediment transport');
    // The whole point: this PDF sits in the vault and NOTHING references it.
    await writePdf('01 Courses/COURSEA/Book.pdf', [
      'Chapter one covers sediment transport in detail.',
    ]);

    const before = await extractTier3Evidence(source);
    expect(before.citations).toHaveLength(0);

    const after = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/Book.pdf' }],
    });
    expect(after.citations.map((c) => c.conceptName)).toEqual(['Sediment transport']);
  });

  it('a registered source flows through the SAME extraction path an embed uses', async () => {
    await zettel('Sediment transport');
    await writePdf('01 Courses/COURSEA/Book.pdf', ['Sediment transport, chapter one.']);

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/Book.pdf' }],
    });
    const citation = result.citations[0];
    // Same citation KIND an embedded PDF produces — not a parallel kind, which
    // is what a second-class path would have needed.
    expect(citation?.kind).toBe('generated-content');
    // Provenance produced by extract/'s own extractor: real page number, real
    // char range into the extracted text.
    expect(citation?.provenance.sourcePath).toBe('01 Courses/COURSEA/Book.pdf');
    expect(citation?.provenance.location.page).toBe(1);
    expect(citation?.provenance.location.charRange.end).toBeGreaterThan(
      citation?.provenance.location.charRange.start ?? 0,
    );
    // `embeddedIn` is absent rather than faked — no note embeds this file, and
    // inventing a block range would put a lie into every downstream citation.
    expect(citation?.provenance.embeddedIn).toBeUndefined();
  });

  it("a registered file's course comes from where it lives (F1.3), with no embedding note to ask", async () => {
    await zettel('Sediment transport');
    await writePdf('01 Courses/COURSEA/Book.pdf', ['Sediment transport, chapter one.']);

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/Book.pdf' }],
    });
    expect(result.citations[0]?.course).toBe('COURSEA');
  });

  it('a registered file outside the courses folder gets no course, rather than a guessed one', async () => {
    await zettel('Sediment transport');
    await writePdf('Inbox/Book.pdf', ['Sediment transport, chapter one.']);

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: 'Inbox/Book.pdf' }],
    });
    expect(result.citations[0]?.course).toBeUndefined();
  });

  it('a file that is both embedded AND registered is extracted once, carrying both kinds', async () => {
    await zettel('Sediment transport');
    await writePdf('01 Courses/COURSEA/WEEK 1/Deck.pdf', ['Sediment transport, week one.']);
    await writeText(
      '01 Courses/COURSEA/WEEK 1/Notes.md',
      '---\ntopic: [Something else]\n---\n\n![[01 Courses/COURSEA/WEEK 1/Deck.pdf]]\n',
    );

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/WEEK 1/Deck.pdf' }],
    });
    // Registering a file a note already embeds must not double its weight in
    // any ranking built on citation counts.
    expect(result.citations.filter((c) => c.conceptName === 'Sediment transport')).toHaveLength(1);
    const row = result.sourceCoverage.find(
      (r) => r.sourcePath === '01 Courses/COURSEA/WEEK 1/Deck.pdf',
    );
    expect(row?.kinds).toEqual(['embedded-file', 'registered-file']);
  });

  it('a registered PDF past paper whose text segments cites via kind: "past-paper", never doubling into generated-content (ol-3ux7.10)', async () => {
    await zettel('Sediment transport');
    await writePdf('Papers/2023.pdf', ['Question 1. Discuss sediment transport. (10 marks)']);

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: 'Papers/2023.pdf', role: 'past-paper' }],
    });
    // `segmentPlainTextPastPaper` recognises the single top-level anchor, so
    // this now cites exactly the way a markdown past paper does...
    const pastPaper = result.citations.filter((c) => c.kind === 'past-paper');
    expect(pastPaper.map((c) => c.conceptName)).toEqual(['Sediment transport']);
    expect(pastPaper[0]?.questionLabel).toBe('1');
    expect(pastPaper[0]?.questionText).toContain('Discuss sediment transport');
    // ...and is never ALSO counted through the generated-content leg — the
    // same exclusivity a markdown past paper gets for free by never reaching
    // `collectDerivedSources` at all.
    expect(result.citations.filter((c) => c.kind === 'generated-content')).toEqual([]);
    // The cluster is real now — the whole point of segmenting.
    expect(result.pastPaperClusters.map((c) => c.conceptName)).toEqual(['Sediment transport']);
    const row = result.sourceCoverage.find((r) => r.sourcePath === 'Papers/2023.pdf');
    expect(row?.limitations).toEqual([]);
    expect(row?.role).toBe('past-paper');
  });

  it('a registered PDF past paper with no recognisable question numbering abstains, honestly — no fabricated cluster, no lost evidence (ol-3ux7.10)', async () => {
    await zettel('Sediment transport');
    await writePdf('Papers/2024.pdf', [
      'Sediment transport is discussed at length throughout this chapter.',
    ]);

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: 'Papers/2024.pdf', role: 'past-paper' }],
    });
    // No question anchor anywhere in the text, so the segmenter abstains —
    // never a fabricated question or a guessed label.
    expect(result.citations.filter((c) => c.kind === 'past-paper')).toEqual([]);
    expect(result.pastPaperClusters).toEqual([]);
    // The text is still reached through the generated-content fallback leg —
    // an honest abstention costs the addressable question, not all evidence.
    expect(result.citations.map((c) => c.conceptName)).toEqual(['Sediment transport']);
    expect(result.citations[0]?.kind).toBe('generated-content');
    const row = result.sourceCoverage.find((r) => r.sourcePath === 'Papers/2024.pdf');
    expect(row?.limitations).toEqual(['questions-not-segmented']);
    expect(row?.role).toBe('past-paper');
  });

  it('a registered markdown past paper still segments — the binary case is the limited one', async () => {
    await zettel('Sediment transport');
    await writeText(
      'Papers/2023.md',
      '## Question 1 (10 marks)\n\nDiscuss sediment transport in braided systems.\n',
    );

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: 'Papers/2023.md', role: 'past-paper' }],
    });
    expect(result.pastPaperClusters.map((c) => c.conceptName)).toEqual(['Sediment transport']);
    const row = result.sourceCoverage.find((r) => r.sourcePath === 'Papers/2023.md');
    expect(row?.limitations).toEqual([]);
  });

  it('boilerplate suppression sees registered and embedded pages as one corpus', async () => {
    await zettel('Overview');
    // Three embedded decks plus one REGISTERED deck all open with the same
    // template phrase. The threshold is four distinct documents, so the
    // registered one is what tips it — proving the pass is not run per-route.
    const head = 'Overview and aims for this session';
    for (const course of ['COURSEA', 'COURSEB', 'COURSEC']) {
      // Distinct bodies, so these are three distinct DOCUMENTS rather than one
      // document filed three times — the `ol-n0yc` content hash would fold
      // byte-identical decks together and the repetition would never form.
      await writePdf(`01 Courses/${course}/WEEK 1/Deck.pdf`, [head, `Body slide for ${course}`]);
      await writeText(
        `01 Courses/${course}/WEEK 1/Notes.md`,
        `---\ntopic: [Something]\n---\n\n![[01 Courses/${course}/WEEK 1/Deck.pdf]]\n`,
      );
    }
    await writePdf('01 Courses/COURSED/Book.pdf', [head, 'Body slide for COURSED']);

    const withoutRegistration = await extractTier3Evidence(source);
    expect(
      withoutRegistration.citations.filter((c) => c.conceptName === 'Overview').length,
    ).toBeGreaterThan(0);

    const withRegistration = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSED/Book.pdf' }],
    });
    expect(withRegistration.citations.filter((c) => c.conceptName === 'Overview')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `ol-cvsc` [P3-T07h] — the read path states the scope it actually read.
// ---------------------------------------------------------------------------
describe('extractTier3Evidence — coverage states its own scope (ol-cvsc)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-coverage-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeText(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async function writePdf(relPath: string, pageTexts: readonly string[]): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buildPdfBytes(pageTexts));
  }

  it('a registered source that yields no citations gets its own visible row, never a silent absence', async () => {
    await writeText('05 Zettelkasten/Sediment transport.md', '---\ntype: concept\n---\n\n# S\n');
    // Real text, real pages, and not one vocabulary term in it.
    await writePdf('01 Courses/COURSEA/Book.pdf', ['Nothing in here matches the vocabulary.']);

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/Book.pdf' }],
    });
    expect(result.citations).toEqual([]);

    const row = result.sourceCoverage.find((r) => r.sourcePath === '01 Courses/COURSEA/Book.pdf');
    // The row exists, which is the whole requirement: zero citations is a
    // MEASUREMENT, and an omitted row would be a false reassurance.
    expect(row).toBeDefined();
    expect(row?.citations).toBe(0);
    expect(row?.pages).toBe(1);
    expect(row?.kinds).toEqual(['registered-file']);
    // "Read and found nothing" is distinct from "could not read", and the
    // extractor's own verdict is carried through rather than re-derived.
    expect(row?.outcome).toBe('extracted');
  });

  /**
   * Structurally a PDF — the objects parse — whose Catalog points at a `/Pages`
   * object that is not in the file, and which has no `/Type /Page` objects to
   * fall back to. That is the `'no-pages-found'` shape, and it is not
   * hypothetical: `../ingestion/extraction-runner.spec.ts` records nine real
   * lecture decks having been in exactly this state.
   */
  function buildUnreachablePagesPdfBytes(): Uint8Array {
    const text = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
  }

  /**
   * ol-i2n6's remaining clause. The bead asked for `ExtractionResult.outcome` to
   * reach the coverage row, and the code landed — but the only assertion on it
   * was `'extracted'`, which is the outcome a source gets when everything works.
   * A field that is only ever checked on the happy path is not shown to carry
   * anything: `outcome: 'extracted'` hard-coded at the call site would have
   * passed that test, and would have made the coverage screen claim every
   * unreadable deck had been read.
   *
   * The distinction this pins is the one C4.7 and ol-cvsc both turn on. Zero
   * citations from a source we READ is a measurement about the source. Zero
   * citations from a source we COULD NOT READ is a measurement about us, and
   * reporting the second as the first is a false reassurance on the exact
   * screen meant to tell her what her evidence rests on.
   */
  it('carries an unreadable source through as no-pages-found, never as a clean zero', async () => {
    await writeText('05 Zettelkasten/Sediment transport.md', '---\ntype: concept\n---\n\n# S\n');
    const full = join(root, '01 Courses', 'COURSEA', 'Unreachable.pdf');
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buildUnreachablePagesPdfBytes());

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/Unreachable.pdf' }],
    });

    const row = result.sourceCoverage.find(
      (r) => r.sourcePath === '01 Courses/COURSEA/Unreachable.pdf',
    );
    expect(row).toBeDefined();
    expect(row?.outcome).toBe('no-pages-found');
    // Same two visible numbers as a source that was read and yielded nothing —
    // which is precisely why `outcome` has to be the thing that separates them.
    expect(row?.citations).toBe(0);
    expect(row?.pages).toBe(0);
  });

  it('every derived source appears, embedded ones included, so the denominator is the whole scope', async () => {
    await writeText('05 Zettelkasten/Sediment transport.md', '---\ntype: concept\n---\n\n# S\n');
    await writePdf('01 Courses/COURSEA/WEEK 1/Deck.pdf', ['Sediment transport, week one.']);
    await writeText(
      '01 Courses/COURSEA/WEEK 1/Notes.md',
      '---\ntopic: [Something]\n---\n\n![[01 Courses/COURSEA/WEEK 1/Deck.pdf]]\n',
    );
    await writePdf('01 Courses/COURSEA/Book.pdf', ['Sediment transport, chapter one.']);

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/Book.pdf' }],
    });
    expect(result.sourceCoverage.map((r) => r.sourcePath)).toEqual([
      '01 Courses/COURSEA/Book.pdf',
      '01 Courses/COURSEA/WEEK 1/Deck.pdf',
    ]);
    // Each row says which route brought it in, so a reader never has to infer it.
    expect(result.sourceCoverage.map((r) => r.kinds)).toEqual([
      ['registered-file'],
      ['embedded-file'],
    ]);
  });

  it('the coverage citation count agrees with the citations actually built', async () => {
    await writeText('05 Zettelkasten/Sediment transport.md', '---\ntype: concept\n---\n\n# S\n');
    await writePdf('01 Courses/COURSEA/Book.pdf', [
      'Sediment transport, chapter one.',
      'More on sediment transport.',
    ]);

    const result = await extractTier3Evidence(source, {
      registeredFiles: [{ path: '01 Courses/COURSEA/Book.pdf' }],
    });
    const total = result.sourceCoverage.reduce((sum, r) => sum + r.citations, 0);
    // A denominator derived a second way is a denominator that can disagree
    // with its own numerator, so this asserts they are the same number.
    expect(total).toBe(result.citations.length);
  });
});
