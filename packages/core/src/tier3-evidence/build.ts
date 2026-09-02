/**
 * Tier-3 evidence gathering (C7.3, F4.1, source hierarchy §3 item 3, P5-T02).
 *
 * **Relocated from `../concept/evidence.ts` ([EXT-8], `ol-ac7g`) — read
 * `./types.js`'s module doc first for why.** This pass was written to feed
 * concept-identity minting (`../concept/extract.ts`'s tier-3 block), but that
 * consumer is a dying, already-off-in-production method (`[D-068]`,
 * `[EXT-2]`/`ol-468f`); the two consumers that actually survive the
 * extraction-method change — `../gap/` and `../evidence-edge/` — have
 * nothing to do with concept identity. This file's own logic is otherwise
 * **unchanged** by the move; only its address and its module doc's framing
 * changed.
 *
 * `../concept/extract.ts` extracts tiers 1 and 2 (her concept notes, her
 * `topic` properties — curated, authored identity). This module is the third
 * leg: concepts **derived from her material** — specifically the two feeds
 * F4.1 names as new for this bead, both landed as dependencies (P5-T01's
 * `../source/`, P3-T04's `../extract/`):
 *
 *  - **Past-paper clusters.** Every `role: past-paper` `Source`
 *    (`../source/register.js`), segmented into addressable questions and
 *    sub-parts (`../source/segment-past-paper.js`). Several questions across
 *    several years naming the same concept is evidence that concept is
 *    high-yield (F4.2–F4.4) — see `PastPaperCluster`, which is designed to
 *    be inspected, not just counted: it carries every member question and
 *    its exact provenance.
 *  - **Generated content.** Text extracted (`../extract/`) from non-markdown
 *    material embedded in her notes (F1.6) — a lecture PDF, a slide deck —
 *    which her own curation (`topic` properties) has no way to see, since
 *    those properties live on the markdown note, not inside the embed.
 *
 * F4.1 also names **objectives** as a feed for concept extraction, not just
 * course material and past papers — so `role: objectives` `Source`s are
 * scanned too, for the same reason generated content is: an objectives
 * document is
 * rarely `topic`-tagged, so without this pass its content is invisible to
 * concept extraction entirely.
 *
 * **How identity is found without inventing it.** This module never invents
 * a concept name from raw prose — that would need real NLP/LLM judgement,
 * which has no place in `packages/core` (INV-1's spirit: no AI dependency
 * in the client-side library) and would produce exactly the kind of
 * unfalsifiable, untestable behaviour the knowledge model's R1/R2 rules
 * out. Instead, every citation is a **verbatim, case-insensitive,
 * word-boundary match** of a name already in `options.vocabulary` (default:
 * every Zettelkasten note title) against derived-material text. A caller
 * that wants matches against tier-1/2 names too — so a concept that already
 * has curated identity picks up extra evidence rather than staying
 * invisible to this pass — passes a richer `vocabulary` (`../concept/
 * extract.ts` does exactly this for its own tier-3 minting). The concept's
 * **display name** stays whatever the vocabulary said, never the derived
 * text's own casing (R2: speak in hers).
 *
 * **Headings are the third source-hierarchy leg this module does not
 * cover.** The knowledge model puts headings in tier 3 alongside past-paper
 * clusters and generated content; this bead's acceptance criteria
 * names only the latter two, and they are exactly what P5-T01/P3-T04
 * newly made available. Naive heading-as-identity extraction is a poor fit
 * for this vault's shape besides — her lecture headings are deliberately
 * question-shaped (F2/F3's flashcard-front premise), so a heading's own
 * text is usually a full question, not a concept name, and treating it as
 * one would mint mostly noise. Reported as a discovered-from candidate in
 * the P5-T02 task report rather than implemented speculatively here.
 */

import { parseDocument } from '../block/parse.js';
import type { Block } from '../block/types.js';
import { DEFAULT_COURSES_FOLDER, notePathCourses } from '../concept/course.js';
import { DEFAULT_ZETTELKASTEN_FOLDER, noteTitle } from '../concept/zettelkasten.js';
import { discoverEmbeddedSources } from '../extract/embeds.js';
import { extractFromVault } from '../extract/registry.js';
import type {
  EmbeddedInNote,
  ExtractionOutcome,
  Provenance,
  SourceFormat,
} from '../extract/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList } from '../frontmatter/read.js';
import { hashContent } from '../ingestion/hash.js';
import { DEFAULT_SOURCES_FOLDER, registerSources } from '../source/register.js';
import { segmentPastPaper } from '../source/segment-past-paper.js';
import type { PlainTextPastPaperSegmentationResult } from '../source/segment-past-paper-plaintext.js';
import { segmentPlainTextPastPaper } from '../source/segment-past-paper-plaintext.js';
import type { Source, SourceKind, SourceRole } from '../source/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type {
  ConceptCitation,
  ExtractTier3EvidenceOptions,
  ExtractTier3EvidenceResult,
  PastPaperCluster,
  PastPaperClusterQuestion,
  SourceCoverage,
  SourceLimitation,
} from './types.js';

/** Escapes every regex metacharacter so a vocabulary name can be dropped into a `RegExp` literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every vocabulary name that occurs verbatim (case-insensitive, word-bounded)
 * in `text`. No stemming, no fuzzy matching — a plural or an inflected form
 * genuinely misses, which is the honest cost of R1/R2's no-fuzzy-matching
 * rule applied to derived material instead of curated names.
 */
function findMentionedTerms(text: string, vocabulary: readonly string[]): readonly string[] {
  const hits: string[] = [];
  for (const term of vocabulary) {
    if (term === '') continue;
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');
    if (pattern.test(text)) hits.push(term);
  }
  return hits;
}

async function zettelVocabulary(
  vault: VaultSource,
  zettelkastenFolder: VaultPath,
): Promise<readonly string[]> {
  const paths = await vault.list({ under: zettelkastenFolder, extensions: ['md'] });
  return paths.map(noteTitle);
}

/**
 * A note's courses, read exactly the way `../concept/extract.ts` reads a
 * lecture note's (`../concept/course.js`, F1.3, `ol-jbnu`): its own `course`
 * property when it has one — a list, so M:N course association holds for
 * generated-content citations exactly as it does for tier-2 ones — and
 * otherwise the course folder it lives under. One derivation, both call
 * sites: two subtly different answers to "which course is this?" is how a
 * concept and its own evidence end up disagreeing.
 */
async function noteCourses(
  vault: VaultSource,
  path: VaultPath,
  coursesFolder: VaultPath,
): Promise<readonly string[]> {
  const content = await vault.read(path);
  const doc = parseDocument(content);
  const first = doc.blocks[0];
  if (first?.kind !== 'frontmatter') return notePathCourses(path, [], coursesFolder);
  const fm = parseFrontmatter(first.inner);
  return notePathCourses(path, readList(fm, 'course').items, coursesFolder);
}

/** Scans one block's own searchable text for vocabulary mentions, at that block's own char range — the same granularity `../keyword-index/document.js` indexes at. */
function blockText(block: Block): string | null {
  switch (block.kind) {
    case 'heading':
      return block.text;
    case 'paragraph':
    case 'code':
    case 'callout':
      return block.raw;
    case 'list':
      return block.items.map((item) => item.text).join('\n');
    case 'frontmatter':
    case 'blank':
    case 'thematicBreak':
      return null;
  }
}

async function pastPaperCitations(
  vault: VaultSource,
  sourcePath: VaultPath,
  course: string | undefined,
  vocabulary: readonly string[],
): Promise<readonly ConceptCitation[]> {
  const text = await vault.read(sourcePath);
  const { questions } = segmentPastPaper(sourcePath, text);

  const citations: ConceptCitation[] = [];
  for (const question of questions) {
    for (const term of findMentionedTerms(question.text, vocabulary)) {
      citations.push({
        conceptName: term,
        kind: 'past-paper',
        sourcePath,
        course,
        provenance: question.provenance,
        questionLabel: question.label,
        questionText: question.text,
      });
    }
  }
  return citations;
}

async function objectivesCitations(
  vault: VaultSource,
  sourcePath: VaultPath,
  course: string | undefined,
  vocabulary: readonly string[],
): Promise<readonly ConceptCitation[]> {
  const text = await vault.read(sourcePath);
  const doc = parseDocument(text);

  const citations: ConceptCitation[] = [];
  for (const block of doc.blocks) {
    const raw = blockText(block);
    if (raw === null) continue;
    for (const term of findMentionedTerms(raw, vocabulary)) {
      citations.push({
        conceptName: term,
        kind: 'objectives',
        sourcePath,
        course,
        provenance: {
          sourcePath,
          location: { page: 1, charRange: { start: block.start, end: block.end } },
        },
      });
    }
  }
  return citations;
}

/**
 * Boilerplate detection thresholds (`ol-22zr`). See
 * `detectBoilerplateHeads` for what they mean and the measurement that set
 * them; they are threshold tunings (Class B), not contract values.
 */
const BOILERPLATE_MIN_DOCUMENTS = 4;
const BOILERPLATE_MIN_WORDS = 2;
const BOILERPLATE_MAX_WORDS = 12;

/** One page of derived text, with everything needed to cite it, before any matching happens. */
interface DerivedPage {
  readonly sourcePath: VaultPath;
  /** Content hash of the source file's bytes — the identity `ol-n0yc` de-duplicates on. */
  readonly contentId: string;
  readonly duplicateSourcePaths: readonly VaultPath[];
  readonly courses: readonly (string | undefined)[];
  readonly text: string;
  readonly provenance: Provenance;
}

/**
 * The leading words of a page, lowercased, with each word's end offset in the
 * original text. Letters and digits are separate runs, so a heading that runs
 * straight into a numbered list (`…Outcomes1.`) still tokenises as two words
 * rather than one unrepeatable blob.
 */
function leadingWords(text: string): readonly { readonly word: string; readonly end: number }[] {
  const out: { word: string; end: number }[] = [];
  const pattern = /\p{L}+|\p{N}+/gu;
  let match = pattern.exec(text);
  while (match !== null && out.length < BOILERPLATE_MAX_WORDS) {
    out.push({ word: match[0].toLowerCase(), end: match.index + match[0].length });
    match = pattern.exec(text);
  }
  return out;
}

/**
 * How far into each page the **template heading** runs, when it has one
 * (`ol-22zr`).
 *
 * The defect this closes: tier-3 minted and then top-ranked a concept whose
 * name is an ordinary English word, on citations that were almost entirely
 * the *slide template* — the header every deck of every course opens with,
 * because it is the template. Ranking by citation count therefore put the
 * least real concept in the corpus first, which is the only part of a ranking
 * anyone reads. Neither of the guards that existed catches it: it is not a
 * homonym across two domains, and it is not a same-course duplicate, because
 * the false hits span exactly the courses the true hits do.
 *
 * **Detected by repetition, not by a word list.** A phrase that opens the
 * pages of `BOILERPLATE_MIN_DOCUMENTS` or more *distinct* documents is
 * template furniture by demonstration: it says nothing about any one deck
 * precisely because it is in all of them. A hand-maintained stop-word list
 * would be a permanent maintenance liability and would encode
 * English-and-this-institution assumptions into a package that has no
 * business holding either — this needs neither, and adapts to whatever
 * template a vault actually uses.
 *
 * Distinctness is **content-addressed** (`contentId`), which is what makes
 * this compose with `ol-n0yc` rather than fight it: one deck filed twice is
 * one document, so a duplicated file cannot half-manufacture the repetition
 * that suppresses its own headings.
 *
 * Three deliberate narrownesses, so the rule stays a scalpel:
 *  - Only the **leading** phrase of a page counts. Repetition elsewhere in a
 *    page is not evidence of a heading, and a running header repeated across
 *    the pages of *one* deck is that deck's own subject — often its most real
 *    concept — so within-document repetition must not, and does not, count.
 *  - A single repeated word is not enough (`BOILERPLATE_MIN_WORDS`): one word
 *    is where a real concept name lives, and suppressing on one word is a
 *    derived stop-word list wearing a better hat.
 *  - Only the heading **span** is suppressed. The same term later on the same
 *    page still cites — the page is not discarded, its furniture is.
 *
 * Returns the end offset of the longest repeated leading phrase per page, or
 * 0 for a page with no template heading.
 */
function detectBoilerplateHeads(pages: readonly DerivedPage[]): ReadonlyMap<DerivedPage, number> {
  const prefixDocuments = new Map<string, Set<string>>();
  const wordsOf = new Map<
    DerivedPage,
    readonly { readonly word: string; readonly end: number }[]
  >();

  for (const page of pages) {
    const words = leadingWords(page.text);
    wordsOf.set(page, words);
    for (let k = BOILERPLATE_MIN_WORDS; k <= words.length; k++) {
      const key = words
        .slice(0, k)
        .map((w) => w.word)
        .join(' ');
      let documents = prefixDocuments.get(key);
      if (documents === undefined) {
        documents = new Set();
        prefixDocuments.set(key, documents);
      }
      documents.add(page.contentId);
    }
  }

  const heads = new Map<DerivedPage, number>();
  for (const page of pages) {
    const words = wordsOf.get(page) ?? [];
    let end = 0;
    for (let k = BOILERPLATE_MIN_WORDS; k <= words.length; k++) {
      const key = words
        .slice(0, k)
        .map((w) => w.word)
        .join(' ');
      if ((prefixDocuments.get(key)?.size ?? 0) >= BOILERPLATE_MIN_DOCUMENTS) {
        end = words[k - 1]?.end ?? end;
      }
    }
    heads.set(page, end);
  }
  return heads;
}

/**
 * Every vocabulary name that occurs in `text` **outside** its first
 * `headEnd` characters. `headEnd` of 0 makes this exactly
 * `findMentionedTerms`; a non-zero one drops a term whose every occurrence on
 * the page is inside the template heading (`detectBoilerplateHeads`).
 */
function findMentionedTermsAfter(
  text: string,
  vocabulary: readonly string[],
  headEnd: number,
): readonly string[] {
  if (headEnd === 0) return findMentionedTerms(text, vocabulary);
  const hits: string[] = [];
  for (const term of vocabulary) {
    if (term === '') continue;
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi');
    let match = pattern.exec(text);
    while (match !== null) {
      if (match.index >= headEnd) {
        hits.push(term);
        break;
      }
      match = pattern.exec(text);
    }
  }
  return hits;
}

/**
 * One extractable source, before its bytes have been read — whatever route
 * brought it in.
 *
 * **This is the type that makes F3.1 an extension rather than a second path.**
 * The two producers (`discoverEmbeddedSources` for embeds, `registerSources`
 * for explicit registrations) disagree about exactly one thing — whether there
 * is an embedding note — and that difference is carried as an optional field
 * rather than as a fork in the pipeline. Everything after this point (content
 * hashing, de-duplication, the `extractFromVault` call, page routing,
 * boilerplate detection, citation building) sees one list and cannot tell the
 * two apart, which is precisely the property `ol-ep3.2` requires.
 */
interface DerivedCandidate {
  readonly path: VaultPath;
  readonly format: SourceFormat;
  /** Absent for a registered file: no note embeds it, so there is no block range to point at. */
  readonly embeddedIn?: EmbeddedInNote;
  readonly courses: readonly string[];
  readonly kind: SourceKind;
  /** Present only for a registered source — an embed carries no role. */
  readonly role?: SourceRole;
}

/** One distinct file content, with everything the citation and coverage passes need. */
interface DerivedSource {
  readonly contentId: string;
  readonly sourcePath: VaultPath;
  readonly duplicateSourcePaths: readonly VaultPath[];
  readonly courses: readonly (string | undefined)[];
  readonly kinds: readonly SourceKind[];
  readonly role: SourceRole | undefined;
  readonly format: SourceFormat;
  readonly outcome: ExtractionOutcome;
  readonly pageCount: number;
  readonly pages: readonly DerivedPage[];
  readonly limitations: readonly SourceLimitation[];
  /**
   * `segmentPlainTextPastPaper`'s own verdict for this source's extracted
   * text — present only for `role === 'past-paper'` (`ol-3ux7.10`).
   * `undefined` for every other role: the plain-text segmenter is specific to
   * past papers, the same way `segmentPastPaper` never runs against a
   * markdown objectives document.
   */
  readonly pastPaperSegmentation: PlainTextPastPaperSegmentationResult | undefined;
}

/**
 * Every extractable source reachable from the vault, **whether a note embeds
 * it or not** (F1.6 for the embedded case, F3.1 for the registered one).
 *
 * A registered file's courses come from F1.3's path rule when the caller gave
 * no explicit course — the same `notePathCourses` derivation an embedding
 * note's own courses go through, called with an empty explicit list. That is
 * deliberate: a registered file has no embedding note to ask, and inventing a
 * second course derivation for it is exactly how a concept and its evidence
 * end up disagreeing about which course they belong to.
 */
async function collectCandidates(
  vault: VaultSource,
  coursesFolder: VaultPath,
  registered: readonly Source[],
): Promise<readonly DerivedCandidate[]> {
  const notePaths = await vault.list({ extensions: ['md'] });
  // Listed once and threaded through, rather than re-walked inside every
  // `discoverEmbeddedSources` call — see that function's `knownPaths` note.
  const allPaths = await vault.list();

  const candidates: DerivedCandidate[] = [];
  for (const notePath of notePaths) {
    const { resolved } = await discoverEmbeddedSources(vault, notePath, allPaths);
    if (resolved.length === 0) continue;
    const courses = await noteCourses(vault, notePath, coursesFolder);
    for (const embed of resolved) {
      candidates.push({
        path: embed.path,
        format: embed.format,
        embeddedIn: embed.embeddedIn,
        courses,
        kind: 'embedded-file',
      });
    }
  }

  for (const source of registered) {
    // Markdown registered sources are read by the block parser on the
    // past-paper/objectives routes, not by an extractor — they are not
    // candidates here.
    if (source.format === null) continue;
    candidates.push({
      path: source.path,
      format: source.format,
      courses:
        source.course !== undefined
          ? [source.course]
          : notePathCourses(source.path, [], coursesFolder),
      kind: source.kind,
      ...(source.role !== undefined ? { role: source.role } : {}),
    });
  }
  return candidates;
}

/**
 * Every derived source's pages, **one entry per distinct file content**
 * (`ol-n0yc`).
 *
 * Sources are keyed by the SHA-256 of their bytes — `../ingestion/hash.js`,
 * the same function ingestion idempotency uses, for the same reason: bytes
 * are the only thing two copies actually share. Filename and title are
 * explicitly *not* the key. The two paths differ (that is what makes them two
 * paths), and a title-based rule would additionally fold together two
 * genuinely different documents that happen to be named alike.
 *
 * The first path in code-unit order cites; the rest ride along on
 * `duplicateSourcePaths`, and their notes' courses are unioned in, so
 * de-duplicating loses no association — it only stops counting the same
 * bytes twice.
 *
 * **Registration joins this de-duplication rather than bypassing it.** A file
 * that is both embedded and explicitly registered hashes to one group and is
 * extracted once, contributing one set of pages and carrying both kinds. The
 * alternative — registering a file a note already embeds and getting its
 * citations twice — would silently double that document's weight in every
 * ranking built on citation counts.
 */
async function collectDerivedSources(
  vault: VaultSource,
  coursesFolder: VaultPath,
  registered: readonly Source[],
): Promise<readonly DerivedSource[]> {
  const candidates = await collectCandidates(vault, coursesFolder, registered);

  const byContent = new Map<string, DerivedCandidate[]>();
  const contentIdOf = new Map<VaultPath, string>();
  for (const candidate of candidates) {
    let contentId = contentIdOf.get(candidate.path);
    if (contentId === undefined) {
      contentId = await hashContent(await vault.readBinary(candidate.path));
      contentIdOf.set(candidate.path, contentId);
    }
    const group = byContent.get(contentId);
    if (group === undefined) byContent.set(contentId, [candidate]);
    else group.push(candidate);
  }

  const sources: DerivedSource[] = [];
  for (const [contentId, group] of byContent) {
    const sorted = [...group].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const citing = sorted[0];
    if (citing === undefined) continue;
    const duplicateSourcePaths = [...new Set(sorted.slice(1).map((e) => e.path))].filter(
      (path) => path !== citing.path,
    );
    const courses = [...new Set(sorted.flatMap((e) => e.courses))].sort();
    const courseValues: readonly (string | undefined)[] =
      courses.length > 0 ? courses : [undefined];
    const kinds = [...new Set(sorted.map((e) => e.kind))].sort();
    const role = sorted.find((e) => e.role !== undefined)?.role;

    // The one and only extraction call, for embedded and registered alike.
    // `embeddedIn` is optional on `ExtractorInput` and threads straight through
    // to `Provenance.embeddedIn`, so a registered source's provenance simply
    // omits it — it is not faked, and no caller has to special-case it.
    const result = await extractFromVault(
      vault,
      citing.path,
      citing.format,
      undefined,
      citing.embeddedIn,
    );
    const pages: DerivedPage[] = [];
    for (const page of result.pages) {
      for (const unit of page.units) {
        pages.push({
          sourcePath: citing.path,
          contentId,
          duplicateSourcePaths,
          courses: courseValues,
          text: unit.text,
          provenance: unit.provenance,
        });
      }
    }

    // `ol-3ux7.10`: a registered `role: 'past-paper'` source gets one attempt
    // at question segmentation from its own already-extracted result — the
    // plain-text sibling of `segmentPastPaper`, honouring the same
    // honest-degrade contract (`status: 'unsegmented'`, never a fabricated
    // question). Every other role leaves this `undefined`: the segmenter is
    // past-paper-specific, and running it against, say, an objectives PDF
    // would be inventing a question structure nothing asked for.
    const pastPaperSegmentation =
      role === 'past-paper' ? segmentPlainTextPastPaper(result) : undefined;

    sources.push({
      contentId,
      sourcePath: citing.path,
      duplicateSourcePaths,
      courses: courseValues,
      kinds,
      role,
      format: citing.format,
      outcome: result.outcome,
      pageCount: result.pages.length,
      pages,
      pastPaperSegmentation,
      // A past paper that arrived as a binary extracts but did not
      // confidently segment. Said here, on the row, rather than left for a
      // reader to notice from a missing cluster. Absent once
      // `pastPaperSegmentation.status === 'segmented'` — see
      // `binaryPastPaperCitations`.
      limitations:
        role === 'past-paper' && pastPaperSegmentation?.status !== 'segmented'
          ? ['questions-not-segmented']
          : [],
    });
  }
  return sources;
}

function generatedContentCitations(
  derived: readonly DerivedSource[],
  vocabulary: readonly string[],
): readonly ConceptCitation[] {
  const pages = derived.flatMap((s) => s.pages);
  // Boilerplate detection runs across ALL derived pages at once, embedded and
  // registered together. It has to: the rule is "a leading phrase shared by
  // four or more distinct documents is template furniture", and running it
  // separately per route would let a registered deck escape a template its
  // embedded siblings established. This corpus is untouched by the
  // past-paper exemption below — a segmented past paper's pages still count
  // toward what OTHER documents' headings look like template furniture
  // against; only its own citations are routed elsewhere.
  const heads = detectBoilerplateHeads(pages);

  // `ol-3ux7.10`: a past paper whose questions segmented is cited exclusively
  // through `binaryPastPaperCitations`'s `kind: 'past-paper'` route below —
  // mirroring the markdown past-paper route, which never reaches `derived` at
  // all (`collectCandidates` excludes `format === null`) and therefore never
  // double-cites through this generated-content leg either. A past paper the
  // segmenter could not confidently split keeps falling through to this leg
  // unchanged: some evidence beats the none a stricter exclusion would leave.
  const exemptSourcePaths = new Set(
    derived
      .filter((s) => s.role === 'past-paper' && s.pastPaperSegmentation?.status === 'segmented')
      .map((s) => s.sourcePath),
  );

  const citations: ConceptCitation[] = [];
  for (const page of pages) {
    if (exemptSourcePaths.has(page.sourcePath)) continue;
    const terms = findMentionedTermsAfter(page.text, vocabulary, heads.get(page) ?? 0);
    for (const term of terms) {
      for (const course of page.courses) {
        citations.push({
          conceptName: term,
          kind: 'generated-content',
          sourcePath: page.sourcePath,
          course,
          provenance: page.provenance,
          ...(page.duplicateSourcePaths.length > 0
            ? { duplicateSourcePaths: page.duplicateSourcePaths }
            : {}),
        });
      }
    }
  }
  return citations;
}

/**
 * `kind: 'past-paper'` citations for one binary `role: 'past-paper'`
 * `DerivedSource` that `segmentPlainTextPastPaper` confidently segmented
 * (`ol-3ux7.10`) — the exact shape `pastPaperCitations` produces for a
 * markdown past paper, so `buildPastPaperClusters` and
 * `../evidence-edge/build.js`'s `buildConceptAssessmentEdges` need no
 * kind-specific branch to consume either. Returns `[]` for a source that
 * degraded to `'unsegmented'` — the segmenter's own abstention propagates
 * here as "no past-paper citations", never a guess.
 */
function binaryPastPaperCitations(
  source: DerivedSource,
  vocabulary: readonly string[],
): readonly ConceptCitation[] {
  if (source.pastPaperSegmentation?.status !== 'segmented') return [];

  const citations: ConceptCitation[] = [];
  for (const question of source.pastPaperSegmentation.questions) {
    for (const term of findMentionedTerms(question.text, vocabulary)) {
      for (const course of source.courses) {
        citations.push({
          conceptName: term,
          kind: 'past-paper',
          sourcePath: source.sourcePath,
          course,
          provenance: question.provenance,
          questionLabel: question.label,
          questionText: question.text,
          ...(source.duplicateSourcePaths.length > 0
            ? { duplicateSourcePaths: source.duplicateSourcePaths }
            : {}),
        });
      }
    }
  }
  return citations;
}

/** Exported solely for `build.spec.ts`'s direct unit coverage of the absent-`charRange` ordering rule below. */
export function sortCitations(citations: readonly ConceptCitation[]): ConceptCitation[] {
  return [...citations].sort((a, b) => {
    if (a.conceptName !== b.conceptName) return a.conceptName < b.conceptName ? -1 : 1;
    if (a.sourcePath !== b.sourcePath) return a.sourcePath < b.sourcePath ? -1 : 1;
    // `charRange` is optional (`../extract/types.js`) — a citation with no char-level
    // precision (e.g. `[D-181]`'s instrument-citation grain) sorts after every citation that
    // has one, and ties among no-range citations keep their incoming order: `Array.sort` is
    // stable, so returning `0` here is enough, never a fabricated position.
    const aStart = a.provenance.location.charRange?.start;
    const bStart = b.provenance.location.charRange?.start;
    if (aStart === undefined && bStart === undefined) return 0;
    if (aStart === undefined) return 1;
    if (bStart === undefined) return -1;
    return aStart - bStart;
  });
}

function buildPastPaperClusters(
  citations: readonly ConceptCitation[],
): readonly PastPaperCluster[] {
  const byName = new Map<string, ConceptCitation[]>();
  for (const citation of citations) {
    if (citation.kind !== 'past-paper') continue;
    const list = byName.get(citation.conceptName);
    if (list) {
      list.push(citation);
    } else {
      byName.set(citation.conceptName, [citation]);
    }
  }

  const clusters: PastPaperCluster[] = [];
  for (const [conceptName, members] of byName) {
    const courses = new Set(members.map((m) => m.course));
    const course = courses.size === 1 ? [...courses][0] : undefined;
    const questions: PastPaperClusterQuestion[] = members
      .map((m) => ({
        sourcePath: m.sourcePath,
        // questionLabel/questionText are present by construction for every
        // `kind: 'past-paper'` citation — pastPaperCitations always sets both.
        label: m.questionLabel ?? '',
        text: m.questionText ?? '',
        provenance: m.provenance,
      }))
      .sort((a, b) =>
        a.sourcePath !== b.sourcePath
          ? a.sourcePath < b.sourcePath
            ? -1
            : 1
          : a.label < b.label
            ? -1
            : a.label > b.label
              ? 1
              : 0,
      );
    clusters.push({ conceptName, course, questions });
  }

  clusters.sort((a, b) =>
    a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0,
  );
  return clusters;
}

export async function extractTier3Evidence(
  vault: VaultSource,
  options: ExtractTier3EvidenceOptions = {},
): Promise<ExtractTier3EvidenceResult> {
  const zettelkastenFolder = options.zettelkastenFolder ?? DEFAULT_ZETTELKASTEN_FOLDER;
  const coursesFolder = options.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const vocabulary = options.vocabulary ?? (await zettelVocabulary(vault, zettelkastenFolder));

  const sourcesReport = await registerSources(vault, {
    sourcesFolder: options.sourcesFolder ?? DEFAULT_SOURCES_FOLDER,
    ...(options.registeredFiles !== undefined ? { registeredFiles: options.registeredFiles } : {}),
  });

  // Markdown sources keep their role-specific readers: a markdown past paper
  // segments into addressable questions via the block parser
  // (`segmentPastPaper`), a markdown objectives document is read
  // block-by-block. A binary objectives document has neither reader
  // available and goes to the derived-text route below instead — a real
  // difference in what can be read, so it is reported on the coverage row
  // rather than papered over. A binary past paper gets its OWN addressable-
  // question route below too now (`ol-3ux7.10`,
  // `segmentPlainTextPastPaper`) — see `collectDerivedSources` and
  // `binaryPastPaperCitations` — so this markdown-only loop is not the whole
  // past-paper story.
  const markdownSources = sourcesReport.sources.filter((s) => s.format === null);
  const citationLists: (readonly ConceptCitation[])[] = [];
  for (const source of markdownSources) {
    if (source.role === 'past-paper') {
      citationLists.push(await pastPaperCitations(vault, source.path, source.course, vocabulary));
    } else if (source.role === 'objectives') {
      citationLists.push(await objectivesCitations(vault, source.path, source.course, vocabulary));
    }
  }

  const derived = await collectDerivedSources(vault, coursesFolder, sourcesReport.sources);
  citationLists.push(generatedContentCitations(derived, vocabulary));
  for (const source of derived) {
    if (source.role === 'past-paper') {
      citationLists.push(binaryPastPaperCitations(source, vocabulary));
    }
  }

  const citations = sortCitations(citationLists.flat());
  const pastPaperClusters = buildPastPaperClusters(citations);

  // Coverage. Counted from the citations that were actually built, never
  // recomputed — a denominator derived a second way is a denominator that can
  // disagree with its own numerator.
  const citationsByPath = new Map<VaultPath, number>();
  for (const citation of citations) {
    citationsByPath.set(citation.sourcePath, (citationsByPath.get(citation.sourcePath) ?? 0) + 1);
  }

  const sourceCoverage: SourceCoverage[] = [
    ...markdownSources.map((source) => ({
      sourcePath: source.path,
      kinds: [source.kind],
      role: source.role,
      format: source.format,
      duplicateSourcePaths: [],
      courses: [source.course],
      // No extractor ran, so there is no extractor verdict to report. `null`
      // says that, where a borrowed `'extracted'` would claim a check that
      // never happened.
      outcome: null,
      // A markdown document is one page and one unit by construction: that is
      // exactly the granularity the past-paper and objectives readers emit in
      // their own provenance (`page: 1`), so this agrees with the citations
      // rather than inventing a second pagination for the same file.
      pages: 1,
      units: 1,
      citations: citationsByPath.get(source.path) ?? 0,
      limitations:
        source.role === 'course-material' ? (['no-tier3-reader-for-role'] as const) : ([] as const),
    })),
    ...derived.map((s) => ({
      sourcePath: s.sourcePath,
      kinds: s.kinds,
      role: s.role,
      format: s.format,
      duplicateSourcePaths: s.duplicateSourcePaths,
      courses: s.courses,
      outcome: s.outcome,
      pages: s.pageCount,
      units: s.pages.length,
      citations: citationsByPath.get(s.sourcePath) ?? 0,
      limitations: s.limitations,
    })),
  ].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0));

  return { vocabulary, citations, pastPaperClusters, sourcesReport, sourceCoverage };
}
