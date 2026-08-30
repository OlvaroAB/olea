/**
 * `readConcepts` — concepts from the material, not from the filing
 * (F1.4, C7.3, C7.10, knowledge model §3, `[D-068]`, `[D-082]`, `[D-085]`).
 *
 * This is **stage one** of `[D-082]`'s reading stage: a model reads her
 * lecture notes, papers and course documents and returns the concepts inside
 * them. `./extract.js` — her `topic` properties, her Zettelkasten titles, her
 * course folders — is no longer *the* extractor. It is **one corroborating
 * source**, and this module is where that demotion actually happens.
 *
 * **The precedence rule, and it is the whole point** (scope principle 13,
 * knowledge model §3). Her conventions are *evidence, never preconditions*.
 * The read runs in full whatever she has tagged or filed, so a student with
 * no tags at all still gets a populated concept list. Where she does keep a
 * convention, it **corroborates the read and outranks it on conflict**: her
 * name wins, and the reader's wording is kept as an alias rather than
 * discarded. Where she keeps none, nothing breaks and nothing is asked of
 * her. The hierarchy is a *match precedence*, never a coverage order — it
 * decides whose naming wins, never whether a tier runs.
 *
 * **Nothing here normalises, folds or renames.** Every string that reaches a
 * `ReadConcept` is copied character-for-character from either her vault or
 * the passage the reader read it out of. There is no title-casing, no
 * trimming into a canonical form, no fuzzy dedupe and no alias expansion.
 * Corroboration is matched by **exact string equality**, deliberately
 * case-sensitive, for the same reason `./types.js`'s `ConceptRecord` is:
 * folding case would be this module inventing an identity her vault does not
 * state. The casing question is real and is tracked on its own (`ol-5y40`);
 * it is deliberately answered *the same way in both places* rather than
 * given a second, quieter answer here.
 *
 * **An empty list is never the answer to "what went wrong".** A vault this
 * stage cannot read is reported loudly — see `ConceptReadResult`, which is a
 * discriminated union precisely so a caller cannot reach `.concepts`, find
 * it empty, and carry on as though the vault were genuinely bare. That
 * distinction is contracted (F1.4: "an empty result states why it is
 * empty"), and a type is the only place it stays enforced.
 *
 * **Where it runs** (`docs/Olea_architecture_boundary.md` §1, component
 * register row 1.1, boundary `split`). Gathering passages, chunking and
 * reading files are *client*; the material-reading judgement is a model call
 * and is *service*. This module therefore owns everything except the
 * judgement, which it reaches through `ConceptReaderPort`. The port carries
 * transient context out and an artifact back, and **nothing is retained
 * server-side** — the Worker is a calculator, not a database. The prompt
 * itself is private IP (C4.3) and deliberately does not exist in this
 * repository.
 *
 * **The accepted cost, ruled rather than discovered** (`[D-068]`): finding
 * concepts is budget-bounded, desktop-only and unavailable offline, the same
 * posture as generation. Today the concept list exists regardless of
 * connectivity; after this it does not. `ConceptReaderUnavailableError` is
 * how that arrives, and it arrives as a *stated reason*, never as silence.
 */

import { buildOutline } from '../block/outline.js';
import { parseDocument } from '../block/parse.js';
import type { OutlineNode, ParsedDocument } from '../block/types.js';
import { discoverEmbeddedSources } from '../extract/embeds.js';
import { extractFromVault, formatFromExtension } from '../extract/registry.js';
import type { EmbeddedInNote, Provenance, SourceFormat } from '../extract/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList } from '../frontmatter/read.js';
import { hashContent } from '../ingestion/hash.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { DEFAULT_COURSES_FOLDER, notePathCourses } from './course.js';
import { extractConcepts } from './extract.js';
import { reconcileRelations, totalDropped } from './reconcile.js';
import type { ConceptRelation, ProposedRelation } from './relation.js';
import type { ConceptSize } from './size.js';
import { readConceptSize } from './size.js';
import type { ConceptRecord, ConceptTier } from './types.js';
import { DEFAULT_ZETTELKASTEN_FOLDER } from './zettelkasten.js';

/**
 * One passage of her material, handed to the reader as **transient context**
 * and never persisted anywhere (C6, D-005, boundary §1).
 *
 * `anchor` is the passage-grain provenance `[D-082]` requires be captured in
 * **this** stage, because the corpus-level relation stage cannot retrofit it:
 * a path to a hundred-slide deck does not put the introducing passage in
 * front of a model, and a chunk reference does. It reuses `../extract/`'s
 * `Provenance` rather than defining a second scheme — `[D-085]` rules exactly
 * one passage-identity scheme, and this is the one instrument citations,
 * past-paper segmentation and the evidence edges already use.
 */
export interface ConceptPassage {
  /** The passage's own text, verbatim from her file. */
  readonly text: string;
  readonly anchor: Provenance;
  /** The course this passage belongs to, or `undefined` — never guessed. */
  readonly course: string | undefined;
}

/**
 * One concept the reader found **inside** the material.
 *
 * `name` is the wording from the passage that explained it most fully, and
 * `aliases` holds every other wording the reader saw, verbatim. F1.4
 * contracts both halves: the fullest explanation names the concept, and the
 * other wordings are "kept as aliases, never discarded".
 */
export interface ProposedConcept {
  readonly name: string;
  readonly aliases: readonly string[];
  /** The passage the name was drawn from — the one that explained it most fully. */
  readonly anchor: Provenance;
  /** Every other passage that named it, in the order the reader reported them. */
  readonly alsoIn: readonly Provenance[];
}

export interface ConceptReadRequest {
  /**
   * Never empty. This stage refuses to ask a model to read nothing — see
   * `readConcepts`, and `INV-5` in the accompanying spec: a reader handed an
   * empty context has nothing to be faithful to, so anything it returns is
   * invention by construction.
   */
  readonly passages: readonly ConceptPassage[];
}

export interface ConceptReadResponse {
  readonly concepts: readonly ProposedConcept[];
  /**
   * `is-a` and `part-of` proposals — the two relation types C7.10 rules
   * visible inside a single document (`./relation.js`'s
   * `PER_DOCUMENT_EMITTABLE_TYPES`). **Optional, not defaulted to empty by
   * this type** — an absent field and an empty array mean the same thing
   * to `readConcepts`, and both are real: `WorkerConceptReader`
   * (`packages/plugin/src/concept/workerConceptReader.ts`), the production
   * `ConceptReaderPort`, has read `concepts.extract.v1` relation proposals
   * since `[EXT-10]` (C7.10's per-document half, `[D-070]`) — corrected
   * 2026-08-26, `ol-2zfj.16`: this doc previously said no production port
   * emitted the field at all, which stopped being true once that bead
   * landed. Kept optional regardless, because a port implementation that
   * predates `[EXT-10]`, or one running against an older contract version,
   * still has no way to populate it and should not be forced to fabricate
   * an empty array to satisfy the type.
   */
  readonly relations?: readonly ProposedRelation[];
}

/**
 * The service seam. The implementation POSTs to the Worker's `/v1/task` and
 * returns the parsed artifact; the prompt that does the reading lives
 * service-side and is private IP (C4.3), so nothing in this repository
 * describes it.
 *
 * **There is no production implementation yet, deliberately.** The task id
 * this port will call has to be added to the frozen catalogue in
 * `packages/contracts`, re-vendored into the service and registered there
 * with its prompt directory — none of which is this module's to do. See the
 * bead filed against `ol-2zfj.1` for that half.
 */
export interface ConceptReaderPort {
  read(request: ConceptReadRequest): Promise<ConceptReadResponse>;
}

/** Why the reader could not be reached at all — the accepted cost of `[D-068]`, named. */
export type ConceptReaderUnavailableReason =
  | 'offline'
  | 'budget-exhausted'
  | 'not-on-this-device'
  | 'not-configured';

/**
 * Thrown by a `ConceptReaderPort` that cannot run *at all*, as distinct from
 * one that ran and found nothing. `readConcepts` turns this into an
 * `unrecognised` result carrying the reason, so the difference survives all
 * the way to whatever renders it.
 */
export class ConceptReaderUnavailableError extends Error {
  readonly reason: ConceptReaderUnavailableReason;

  constructor(reason: ConceptReaderUnavailableReason, message?: string) {
    super(message ?? `concept reader unavailable: ${reason}`);
    this.name = 'ConceptReaderUnavailableError';
    this.reason = reason;
  }
}

/**
 * A concept, after the read and her conventions have been reconciled.
 *
 * This is the *instance* layer, which is where `[D-085]` places the passage
 * anchor — C7.11's closed five-field list governs the **identity** layer and
 * is untouched by anything here.
 */
export interface ReadConcept {
  /**
   * Verbatim. Hers wherever she named it, otherwise the wording from the
   * passage that explained it most fully.
   */
  readonly name: string;
  /**
   * Every other wording seen, verbatim and deduplicated, never discarded.
   * When her convention won the name, the reader's own wording is here.
   */
  readonly aliases: readonly string[];
  /**
   * Which method named it: 1 her concept note, 2 her `topic` property, 3 the
   * material itself. **This is not the passage anchor** and does not
   * discharge it — `[D-085]` calls reading one as the other "the mistake a
   * reader will make next". Tier records *which method found it*; `anchor`
   * records *which passage introduced it*.
   */
  readonly provenanceTier: ConceptTier;
  /** Courses this concept was seen in, M:N, sorted. Empty is a statement, not a failure. */
  readonly courses: readonly string[];
  /**
   * The passage that introduced it — `[D-082]`'s retrievable provenance at
   * passage grain.
   *
   * `undefined` **only** for a concept that exists purely as one of her
   * conventions and that the read did not find in any passage. Such a
   * concept is honestly un-anchored rather than anchored at file grain, and
   * the consequence is deliberate and load-bearing: it is **ineligible for
   * the corpus-level relation stage**, which may only emit an edge when the
   * introducing passages of *both* endpoints were in context. Giving it a
   * file path here would let that stage silently fall back to inferring from
   * names, which is the exact failure `[D-082]`'s amended clause exists to
   * prevent.
   */
  readonly anchor: Provenance | undefined;
  /** Every other passage that named it. */
  readonly alsoIn: readonly Provenance[];
  /** Her concept note, when one corroborated this concept. */
  readonly boundNotePath?: VaultPath;
  /** Notes of hers whose `topic` property named it, sorted. Empty when only the material did. */
  readonly sourcePaths: readonly VaultPath[];
  /**
   * How much of her material grounds this concept (`[D-066]`, component
   * register row 1.3, `./size.js`). Derived at passage grain from `anchor`
   * and `alsoIn`, unioned with `sourcePaths` — the finer version of the
   * proxy `./types.js`'s `ConceptRecord.size` computes from whole-note
   * grounding alone. Read by the two consumers `[D-066]` named: honest scope
   * counting (F8.1, F8.3) and session composition (F2.17).
   */
  readonly size: ConceptSize;
}

/** One row per document the stage looked at, **including the ones that yielded nothing**. */
export interface ConceptReadCoverage {
  readonly sourcePath: VaultPath;
  readonly passagesOffered: number;
  /** How many of them the budget actually allowed through to the reader. */
  readonly passagesRead: number;
  readonly conceptsFound: number;
}

/** Why a read produced no concepts, when the cause was the run rather than the vault. */
export type ConceptReadFailure =
  /** No document in scope yielded a single readable passage. */
  | 'no-readable-material'
  /** The reader could not be reached — see `ConceptReaderUnavailableError`. */
  | 'reader-unavailable'
  /** The reader was reached and errored. */
  | 'reader-failed';

interface ConceptReadBase {
  readonly coverage: readonly ConceptReadCoverage[];
  readonly passagesOffered: number;
  readonly passagesRead: number;
  /** True when the budget stopped this run short of the material available. */
  readonly truncatedByBudget: boolean;
}

/** The vault was read. `concepts` may still be empty — that is a measurement, and it is not the same thing as `unrecognised`. */
export interface ConceptsRead extends ConceptReadBase {
  readonly outcome: 'read';
  readonly concepts: readonly ReadConcept[];
  /**
   * `is-a` / `part-of` edges reconciled against `concepts` (`./reconcile.js`
   * — `[EXT-6]`). Always present, always `[]` when the port supplied no
   * `relations` or every proposal was dropped — never absent, so a caller
   * cannot mistake "the port emits none yet" for "this field does not
   * exist." `contrasts-with` and `prerequisite` never appear here: C7.10
   * scopes them to the corpus-level stage (`[EXT-5]`, `ol-2zfj.7`), which
   * this stage is not. `causes` and `related` never appear here either — not
   * emitted in v0.9 per `./relation.js`'s emission table.
   */
  readonly relations: readonly ConceptRelation[];
  /**
   * How many proposed relations this read dropped, summed across every
   * reason (`./reconcile.js`'s `totalDropped`) — the health signal D-005
   * permits: a count, never a name. `0` when the port supplied no
   * `relations` at all, same as an empty `relations` field above.
   */
  readonly relationsDropped: number;
}

/** The vault was **not** read. F1.4: reported, never returned as a silent empty list. */
export interface ConceptsUnrecognised extends ConceptReadBase {
  readonly outcome: 'unrecognised';
  /** Always empty, and typed so — the reason is the payload here, not the list. */
  readonly concepts: readonly [];
  readonly reason: ConceptReadFailure;
  /** Plain English, safe to show: what was met and why nothing could be read from it. */
  readonly detail: string;
  /** Present when `reason` is `'reader-unavailable'`. */
  readonly unavailableBecause?: ConceptReaderUnavailableReason;
}

/**
 * A discriminated union on purpose.
 *
 * F1.4 requires that meeting an unreadable vault is "reported, never
 * returned as a silent empty list", and that an empty result "states why it
 * is empty". A caller cannot satisfy that by convention — it has to be
 * impossible to get it wrong. Narrowing on `outcome` is the only way to
 * reach `concepts`, so the "silently empty" path this contract forbids does
 * not typecheck.
 */
export type ConceptReadResult = ConceptsRead | ConceptsUnrecognised;

/**
 * The budget bound `[D-068]` accepted and `[D-082]` scoped to a frequency
 * rather than a lesser design.
 *
 * `maxPassages` is **required and has no default**, which is deliberate.
 * Any number this module invented would be a constant fitted to nothing,
 * shipping in public client source, and the component register is explicit
 * that extraction's forthcoming thresholds are *derived* — their derivation
 * stays private and only the number ships. So this module declines to have
 * an opinion: the caller states its budget, and the result reports honestly
 * whether that budget truncated the run.
 */
export interface ConceptReadBudget {
  readonly maxPassages: number;
  /**
   * Passages per model call. `[D-082]` rules that "the same pass" means one
   * *stage* with the material in working context, and that several calls
   * inside that stage are permitted. Defaults to one call for the whole
   * budgeted set.
   */
  readonly passagesPerCall?: number;
}

export interface ReadConceptsOptions {
  readonly budget: ConceptReadBudget;
  /** Restrict the read to this subtree. Defaults to the whole vault. */
  readonly under?: VaultPath;
  /** Folder holding her concept notes, for corroboration. Defaults to `05 Zettelkasten`. */
  readonly zettelkastenFolder?: VaultPath;
  /** Folder whose immediate subdirectories are course codes (F1.3). Defaults to `01 Courses`. */
  readonly coursesFolder?: VaultPath;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A note's courses, F1.3's way: what it says about itself if it says
 * anything (its own `course` frontmatter list), otherwise the course folder
 * it lives under. One derivation, every call site in this module — `./course.js`'s
 * own doc names the risk of a second, subtly different answer to "which
 * course is this?" existing anywhere else.
 */
async function noteCourses(
  vault: VaultSource,
  path: VaultPath,
  coursesFolder: VaultPath,
): Promise<readonly string[]> {
  const content = await vault.read(path);
  const doc = parseDocument(content);
  const first = doc.blocks[0];
  const explicit =
    first?.kind === 'frontmatter' ? readList(parseFrontmatter(first.inner), 'course').items : [];
  return notePathCourses(path, explicit, coursesFolder);
}

/**
 * One non-markdown vault file this stage could try to read — before content
 * hashing has decided whether it duplicates another. `embeddedIn` is present
 * only when discovery found this file via a note's `![[...]]` (F1.6); a file
 * found by the flat extension sweep below (F3.1: dropped straight into the
 * vault, embedded in nothing) carries no such note to point at.
 */
interface DerivedCandidate {
  readonly path: VaultPath;
  readonly format: SourceFormat;
  readonly embeddedIn?: EmbeddedInNote;
  readonly courses: readonly string[];
}

/**
 * Every extractable file reachable in scope, embedded or not (F1.6 + F3.1),
 * before de-duplication.
 *
 * **Why this stage does not go through `../source/register.ts`.** That
 * module's F3.1 route needs `options.registeredFiles`, because it is
 * classifying a file's *evidentiary role* (past paper vs. objectives vs.
 * course material) — a binary cannot say that about itself, so a caller must.
 * This stage asks no such question: it wants her material's text, the same
 * unconditional way it wants every `.md` file's, and a role-blind sweep of
 * every extractable extension in scope answers that without inventing a
 * second registration mechanism this module does not own.
 */
async function collectDerivedCandidates(
  vault: VaultSource,
  notePaths: readonly VaultPath[],
  coursesFolder: VaultPath,
  under: VaultPath | undefined,
): Promise<readonly DerivedCandidate[]> {
  // Listed once and threaded through `discoverEmbeddedSources`, rather than
  // re-walked per note — see that function's own `knownPaths` note: an
  // unscoped re-walk per note is O(notes x files) in the one dimension that
  // grows with a real vault.
  const allPaths = await vault.list(under !== undefined ? { under } : {});

  const candidates: DerivedCandidate[] = [];
  const embeddedPaths = new Set<VaultPath>();
  for (const notePath of notePaths) {
    const { resolved } = await discoverEmbeddedSources(vault, notePath, allPaths);
    if (resolved.length === 0) continue;
    const courses = await noteCourses(vault, notePath, coursesFolder);
    for (const embed of resolved) {
      embeddedPaths.add(embed.path);
      candidates.push({
        path: embed.path,
        format: embed.format,
        embeddedIn: embed.embeddedIn,
        courses,
      });
    }
  }

  // F3.1: a PDF, deck or document sitting directly in the vault, embedded in
  // no note. A file already found above is not added twice here — see
  // `collectDerivedSources`'s content-hash de-duplication for the case that
  // matters more, the same bytes filed at two *different* paths.
  for (const path of allPaths) {
    if (embeddedPaths.has(path)) continue;
    const format = formatFromExtension(path);
    if (format === null) continue;
    candidates.push({ path, format, courses: notePathCourses(path, [], coursesFolder) });
  }

  return candidates;
}

/** One distinct file content, ready to extract — the `ol-n0yc` identity. */
interface DerivedGroup {
  readonly canonicalPath: VaultPath;
  readonly format: SourceFormat;
  readonly embeddedIn?: EmbeddedInNote;
  readonly course: string | undefined;
}

/**
 * Groups `candidates` by the SHA-256 of their bytes (`../ingestion/hash.js` —
 * the same function ingestion idempotency uses), so a deck filed at two paths
 * — embedded twice, or embedded and also dropped loose — is extracted
 * **once** (`ol-n0yc`). The first path in code-unit order is canonical and is
 * the only one that ever reaches `ConceptPassage.anchor.sourcePath`; the
 * others simply never produce a second copy of the same passages, which is
 * the whole of what "counted once" needs to mean at this stage — unlike
 * `../concept/evidence.js`'s citation counting, nothing here names the
 * duplicate paths, because nothing here counts occurrences across them.
 */
async function collectDerivedGroups(
  vault: VaultSource,
  candidates: readonly DerivedCandidate[],
): Promise<readonly DerivedGroup[]> {
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

  const groups: DerivedGroup[] = [];
  for (const group of byContent.values()) {
    const sorted = [...group].sort((a, b) => byCodeUnit(a.path, b.path));
    const canonical = sorted[0];
    if (canonical === undefined) continue;
    const courses = [...new Set(sorted.flatMap((c) => c.courses))];
    groups.push({
      canonicalPath: canonical.path,
      format: canonical.format,
      ...(canonical.embeddedIn !== undefined ? { embeddedIn: canonical.embeddedIn } : {}),
      course: courses.length === 1 ? courses[0] : undefined,
    });
  }
  return groups;
}

/**
 * Passages from her non-markdown material — PDFs, slide decks, documents
 * (F1.6, F3.1) — reusing `../extract/`'s `extractFromVault` and the exact
 * `Provenance` type markdown passages already carry (`[D-082]`, `[D-085]`).
 *
 * **Granularity is page/slide, not block (DF-22), and that is a real,
 * flagged choice rather than an oversight.** A markdown passage is one
 * prose-bearing block; an extracted passage here is one whole page or slide,
 * because that is the grain `../extract/` produces and sub-splitting it is
 * not this stage's job. A page-sized anchor is coarser than a markdown
 * block, and whether it always puts a concept's *introducing* passage in
 * front of the reader as precisely as `[D-082]` intends is genuinely
 * undecided rather than assumed here — logged for retroactive review
 * (`ol-fkya`) rather than blocking this wiring on a design question this
 * bead's material does not by itself resolve.
 *
 * **Honest degrade, not an invented one.** A source this stage cannot read
 * simply contributes no passages: `extract/types.js`'s `ExtractionResult`
 * guarantees `pages: []` for every outcome except `'extracted'` and
 * `'reached-but-unreadable'`, and a `'vision'`-routed page's `units` is `[]`
 * by the same contract — flattening every page's `units` therefore already
 * *is* the honest-empty behaviour, with nothing here inventing text or
 * catching an exception to paper over one. `extract/guard.ts`'s
 * `SilentExtractionError` — a claim of success the source did not earn — is
 * deliberately left to propagate rather than swallowed: it names a genuine
 * extractor defect, and silencing it here would be the exact anti-pattern
 * that guard exists to end.
 *
 * **No document metadata reaches a passage.** `ExtractedUnit` has no field
 * for it (`ol-pdfmeta`) — there is no code path here that could surface a
 * PDF's Author/Title/Producer even by accident, because nothing this
 * function reads carries one.
 */
async function gatherDerivedPassages(
  vault: VaultSource,
  notePaths: readonly VaultPath[],
  coursesFolder: VaultPath,
  under: VaultPath | undefined,
): Promise<readonly ConceptPassage[]> {
  const candidates = await collectDerivedCandidates(vault, notePaths, coursesFolder, under);
  const groups = await collectDerivedGroups(vault, candidates);

  const passages: ConceptPassage[] = [];
  for (const group of groups) {
    const result = await extractFromVault(
      vault,
      group.canonicalPath,
      group.format,
      undefined,
      group.embeddedIn,
    );
    for (const page of result.pages) {
      for (const unit of page.units) {
        passages.push({ text: unit.text, anchor: unit.provenance, course: group.course });
      }
    }
  }
  return passages;
}

/**
 * Nearest-enclosing-heading text for every block in `doc`, keyed by index
 * into `doc.blocks` — the section-grain citation label C3.2 wants and DF-22
 * flagged as missing for markdown (`ol-2zfj.26`). `../block/outline.ts`
 * already groups a heading with the blocks that belong to it; this walks
 * that tree once per note and flattens it to "which heading's content is
 * this block part of", the same reading `../extract/docx.ts` gives
 * `SourceLocation.section` for Word headings.
 *
 * **A heading's own block is tagged with its PARENT's heading text, not its
 * own** — `docx.ts`'s convention for the identical case ("the heading's own
 * unit carries its parent section, not itself"), kept identical here so a
 * citation never reads a heading as if it were content one level inside
 * itself. A block above the first heading, or in a note with no headings at
 * all, is simply absent from the map — `undefined` at the call site, the
 * same honest-absence rule `SourceLocation.section`'s own doc comment states
 * rather than a fabricated top-level label.
 */
function sectionsByBlockIndex(doc: ParsedDocument): ReadonlyMap<number, string> {
  const index = new Map<number, string>();

  function visit(nodes: readonly OutlineNode[], enclosing: string | undefined): void {
    for (const node of nodes) {
      if (enclosing !== undefined) index.set(node.index, enclosing);
      for (const contentIndex of node.contentIndices) index.set(contentIndex, node.heading.text);
      visit(node.children, node.heading.text);
    }
  }
  visit(buildOutline(doc), undefined);

  return index;
}

/**
 * Passages from her material, markdown blocks and extracted non-markdown
 * units alike, each carrying the anchor that produced it so a citation can
 * quote the exact span.
 *
 * Frontmatter and blank blocks are skipped — frontmatter is her filing, which
 * this stage is specifically not reading for identity, and a blank block has
 * no text to read. Everything else markdown is offered, including headings:
 * her lecture headings are question-shaped, and it is the *reader* that
 * decides whether a passage names a concept. That judgement is the thing
 * this module does not make.
 *
 * **Non-markdown material** — embedded decks and PDFs (F1.6), and documents
 * dropped straight into the vault (F3.1) — is gathered too, via
 * `gatherDerivedPassages` above, reusing `../extract/`'s already-anchored
 * units rather than this function inventing a second reading of the same
 * bytes.
 */
export async function gatherPassages(
  vault: VaultSource,
  options: { readonly under?: VaultPath; readonly coursesFolder?: VaultPath } = {},
): Promise<readonly ConceptPassage[]> {
  const coursesFolder = options.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const paths = await vault.list({
    ...(options.under !== undefined ? { under: options.under } : {}),
    extensions: ['md'],
  });

  const passages: ConceptPassage[] = [];
  for (const path of paths) {
    const content = await vault.read(path);
    const doc = parseDocument(content);

    // Her `course` property when the note carries one, otherwise the course
    // folder it lives under (F1.3) — the same rule `./extract.js` uses, so a
    // passage and a corroborating record never disagree about the course.
    // (`noteCourses` below re-derives this from a fresh read for the
    // non-markdown gathering path, which has no already-parsed `doc` to
    // reuse; inlined here to avoid reading and parsing this note twice.)
    const first = doc.blocks[0];
    const explicitCourses =
      first?.kind === 'frontmatter' ? readList(parseFrontmatter(first.inner), 'course').items : [];
    const courses = notePathCourses(path, explicitCourses, coursesFolder);
    const course = courses.length === 1 ? courses[0] : undefined;
    const sections = sectionsByBlockIndex(doc);

    doc.blocks.forEach((block, index) => {
      if (block.kind === 'frontmatter' || block.kind === 'blank') return;
      if (block.raw.trim() === '') return;
      const section = sections.get(index);
      passages.push({
        text: block.raw,
        anchor: {
          sourcePath: path,
          // Markdown has no pages; page 1 is the whole-document convention
          // `../extract/types.js` already documents for single-page formats.
          location: {
            page: 1,
            charRange: { start: block.start, end: block.end },
            ...(section !== undefined ? { section } : {}),
          },
        },
        course,
      });
    });
  }

  const derived = await gatherDerivedPassages(vault, paths, coursesFolder, options.under);
  return [...passages, ...derived];
}

/** Her wording, indexed for exact-match corroboration. */
function conventionIndex(records: readonly ConceptRecord[]): ReadonlyMap<string, ConceptRecord> {
  const index = new Map<string, ConceptRecord>();
  for (const record of records) {
    // Tier 1 (her concept note) outranks tier 2 (her `topic` property) on the
    // same wording — knowledge model §3's match precedence.
    const existing = index.get(record.name);
    if (existing === undefined || record.tier < existing.tier) index.set(record.name, record);
  }
  return index;
}

/** Order-stable dedupe that also drops `exclude` — never sorted, so her ordering survives. */
function dedupe(values: readonly string[], exclude: string): readonly string[] {
  const seen = new Set<string>([exclude]);
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Merge one proposal with her conventions, hers outranking on conflict.
 *
 * Matching is exact and case-sensitive against her wording, tried first
 * against the proposal's own name and then against each alias — an alias
 * match is what lets her name win when the reader called the concept
 * something else in the passage it read.
 */
function corroborate(
  proposal: ProposedConcept,
  conventions: ReadonlyMap<string, ConceptRecord>,
  coursesFromPassages: ReadonlySet<string>,
): ReadConcept {
  const wordings = [proposal.name, ...proposal.aliases];
  const hers = wordings.map((w) => conventions.get(w)).find((r) => r !== undefined);

  if (hers === undefined) {
    const sourcePaths: readonly VaultPath[] = [];
    return {
      name: proposal.name,
      aliases: dedupe(proposal.aliases, proposal.name),
      // Tier 3 is not a fallback awaiting her confirmation (F1.4): nothing
      // here marks it provisional or lowers its confidence for that reason.
      provenanceTier: 3,
      courses: [...coursesFromPassages].sort(byCodeUnit),
      anchor: proposal.anchor,
      alsoIn: proposal.alsoIn,
      sourcePaths,
      size: readConceptSize({ anchor: proposal.anchor, alsoIn: proposal.alsoIn, sourcePaths }),
    };
  }

  // Her name wins; every wording the reader used is kept as an alias.
  const courses = new Set<string>([...hers.courses, ...coursesFromPassages]);
  return {
    name: hers.name,
    aliases: dedupe(wordings, hers.name),
    provenanceTier: hers.tier,
    courses: [...courses].sort(byCodeUnit),
    anchor: proposal.anchor,
    alsoIn: proposal.alsoIn,
    ...(hers.boundNotePath !== undefined ? { boundNotePath: hers.boundNotePath } : {}),
    sourcePaths: hers.sourcePaths,
    size: readConceptSize({
      anchor: proposal.anchor,
      alsoIn: proposal.alsoIn,
      sourcePaths: hers.sourcePaths,
      ...(hers.boundNotePath !== undefined ? { boundNotePath: hers.boundNotePath } : {}),
    }),
  };
}

/**
 * One row per document that was *looked at*, zero-yield rows included.
 *
 * Every document offered gets a row even when it contributed nothing, for
 * the reason `./evidence.js`'s `SourceCoverage` already gives: a surface
 * renders identically whether it found nothing or read nothing, so
 * `passagesRead: 0` has to be a visible measurement rather than an absent
 * row. An omitted row is a false reassurance.
 */
function buildCoverage(
  offered: readonly ConceptPassage[],
  read: readonly ConceptPassage[],
  found: ReadonlyMap<VaultPath, number>,
): readonly ConceptReadCoverage[] {
  const rows = new Map<VaultPath, { offered: number; read: number }>();
  for (const passage of offered) {
    const row = rows.get(passage.anchor.sourcePath) ?? { offered: 0, read: 0 };
    row.offered += 1;
    rows.set(passage.anchor.sourcePath, row);
  }
  for (const passage of read) {
    const row = rows.get(passage.anchor.sourcePath) ?? { offered: 0, read: 0 };
    row.read += 1;
    rows.set(passage.anchor.sourcePath, row);
  }
  return [...rows.entries()]
    .map(([sourcePath, row]) => ({
      sourcePath,
      passagesOffered: row.offered,
      passagesRead: row.read,
      conceptsFound: found.get(sourcePath) ?? 0,
    }))
    .sort((a, b) => byCodeUnit(a.sourcePath, b.sourcePath));
}

const NO_CONCEPTS: ReadonlyMap<VaultPath, number> = new Map();

/**
 * `is-a` and `part-of`'s named reader (C7.10): concept size (`./size.js`).
 * A concept named as the broader side of either edge — `is-a`'s target (the
 * kind-of it names, evidence for containment, "not a substitute for it") or
 * `part-of`'s target (what it is made of) — gets that fact folded into its
 * `size` as `containmentEvidence`, which only ever pushes the band toward
 * `'coarse'` (`./size.js`'s `deriveConceptSize`), never the reverse — the
 * same merge-upward asymmetry C7.9 rules for size generally. A concept named
 * on neither edge's broader side is returned unchanged.
 */
function applyContainmentEvidence(
  concepts: readonly ReadConcept[],
  relations: readonly ConceptRelation[],
): readonly ReadConcept[] {
  const containers = new Set<string>();
  for (const relation of relations) containers.add(relation.to);
  if (containers.size === 0) return concepts;

  return concepts.map((concept) => {
    if (!containers.has(concept.name) || concept.size.extent.containmentEvidence === true) {
      return concept;
    }
    return {
      ...concept,
      size: readConceptSize({
        anchor: concept.anchor,
        alsoIn: concept.alsoIn,
        sourcePaths: concept.sourcePaths,
        ...(concept.boundNotePath !== undefined ? { boundNotePath: concept.boundNotePath } : {}),
        containmentEvidence: true,
      }),
    };
  });
}

/**
 * Bounds `all` to `maxPassages` by round-robin across distinct source
 * documents, rather than the positional `slice` this replaced.
 *
 * **Why positional truncation is a silent quality cliff once decks are in
 * the mix (DF-22, `ol-fkya`).** A markdown note contributes on the order of
 * one passage per prose block; an extracted deck contributes one per
 * page/slide, which can outnumber every other document in scope by an order
 * of magnitude. A plain `all.slice(0, maxPassages)` would let one large deck
 * — or one document that happens to sort first — consume the whole budget
 * before any other document is represented at all, and nothing in the
 * result would say so: `truncatedByBudget` reports *that* the run was cut
 * short, never *whose* material was cut.
 *
 * Round-robin fixes the failure mode this bead names without inventing a
 * fitted weighting the component register would call undeclared: every
 * document in scope gets a turn before any one document gets a second
 * passage, so a budget that covers even a fraction of the corpus still
 * touches every document rather than exhausting itself on the first. It is
 * deliberately not a claim of *fairness* beyond that — a document with more
 * passages than its round-robin share still gets truncated, honestly,
 * exactly as `truncatedByBudget` already reports.
 *
 * Sorted by source path first so the result is deterministic and
 * independent of `gatherPassages`'s own internal ordering (markdown blocks
 * before extracted units, currently — an implementation detail this
 * function does not rely on).
 */
function allocateByBudget(
  all: readonly ConceptPassage[],
  maxPassages: number,
): readonly ConceptPassage[] {
  if (maxPassages <= 0) return [];
  if (all.length <= maxPassages) return all;

  const bySource = new Map<VaultPath, ConceptPassage[]>();
  for (const passage of all) {
    const list = bySource.get(passage.anchor.sourcePath);
    if (list === undefined) bySource.set(passage.anchor.sourcePath, [passage]);
    else list.push(passage);
  }
  const sources = [...bySource.keys()].sort(byCodeUnit);
  const cursors = new Map<VaultPath, number>(sources.map((s) => [s, 0]));

  const budgeted: ConceptPassage[] = [];
  let progressed = true;
  while (budgeted.length < maxPassages && progressed) {
    progressed = false;
    for (const source of sources) {
      if (budgeted.length >= maxPassages) break;
      const cursor = cursors.get(source) ?? 0;
      // biome-ignore lint/style/noNonNullAssertion: `source` came from `bySource`'s own keys.
      const list = bySource.get(source)!;
      if (cursor >= list.length) continue;
      // biome-ignore lint/style/noNonNullAssertion: `cursor < list.length` checked above.
      budgeted.push(list[cursor]!);
      cursors.set(source, cursor + 1);
      progressed = true;
    }
  }
  return budgeted;
}

/**
 * Read her material and return the concepts inside it, corroborated by her
 * conventions where she keeps any.
 *
 * The order of operations is the ruling's order, not an implementation
 * convenience: the material is read first and in full, and her filing is
 * consulted afterwards to decide whose naming wins. Reading her conventions
 * first and then asking the model to fill gaps would reintroduce exactly the
 * dependency `[D-068]` removed.
 */
export async function readConcepts(
  vault: VaultSource,
  reader: ConceptReaderPort,
  options: ReadConceptsOptions,
): Promise<ConceptReadResult> {
  const { budget } = options;
  const all = await gatherPassages(vault, {
    ...(options.under !== undefined ? { under: options.under } : {}),
    ...(options.coursesFolder !== undefined ? { coursesFolder: options.coursesFolder } : {}),
  });

  const budgeted = allocateByBudget(all, budget.maxPassages);
  const base = {
    passagesOffered: all.length,
    passagesRead: budgeted.length,
    truncatedByBudget: budgeted.length < all.length,
  };

  // INV-5, and the reason it is a *refusal* rather than a call that happens
  // to return nothing: a reader handed an empty context has no material to
  // be faithful to, so anything it returns is invention by construction. The
  // port is never reached on this path — which is what the adversarial test
  // asserts, using a reader that fabricates when asked for nothing.
  if (budgeted.length === 0) {
    return {
      outcome: 'unrecognised',
      concepts: [],
      reason: 'no-readable-material',
      detail:
        all.length === 0
          ? 'No document in scope yielded a readable passage, so nothing was sent to be read. This is a statement about what was found, not a concept list.'
          : `A budget of ${budget.maxPassages} passages allowed nothing through, so nothing was sent to be read.`,
      coverage: buildCoverage(all, [], NO_CONCEPTS),
      ...base,
    };
  }

  const perCall = Math.max(budget.passagesPerCall ?? budgeted.length, 1);
  const proposals: ProposedConcept[] = [];
  const proposedRelations: ProposedRelation[] = [];
  try {
    for (let i = 0; i < budgeted.length; i += perCall) {
      const batch = budgeted.slice(i, i + perCall);
      const response = await reader.read({ passages: batch });
      proposals.push(...response.concepts);
      if (response.relations !== undefined) proposedRelations.push(...response.relations);
    }
  } catch (error) {
    if (error instanceof ConceptReaderUnavailableError) {
      return {
        outcome: 'unrecognised',
        concepts: [],
        reason: 'reader-unavailable',
        detail: `Concepts are read by a model, so this needs a connection, a budget and a desktop. ${error.message}`,
        unavailableBecause: error.reason,
        coverage: buildCoverage(all, [], NO_CONCEPTS),
        ...base,
      };
    }
    return {
      outcome: 'unrecognised',
      concepts: [],
      reason: 'reader-failed',
      detail: `The reader was reached and failed: ${error instanceof Error ? error.message : String(error)}`,
      coverage: buildCoverage(all, [], NO_CONCEPTS),
      ...base,
    };
  }

  // Her conventions, gathered afterwards and used only to decide whose
  // naming wins. `extractConcepts` is one corroborating source now, and this
  // is its only remaining caller inside this stage.
  const records = await extractConcepts(vault, {
    ...(options.under !== undefined ? { under: options.under } : {}),
    zettelkastenFolder: options.zettelkastenFolder ?? DEFAULT_ZETTELKASTEN_FOLDER,
    coursesFolder: options.coursesFolder ?? DEFAULT_COURSES_FOLDER,
  });
  const conventions = conventionIndex(records);

  const courseByPath = new Map<VaultPath, string>();
  for (const passage of budgeted) {
    if (passage.course !== undefined) courseByPath.set(passage.anchor.sourcePath, passage.course);
  }

  const concepts: ReadConcept[] = [];
  const claimed = new Set<string>();
  for (const proposal of proposals) {
    const courses = new Set<string>();
    for (const anchor of [proposal.anchor, ...proposal.alsoIn]) {
      const course = courseByPath.get(anchor.sourcePath);
      if (course !== undefined) courses.add(course);
    }
    const concept = corroborate(proposal, conventions, courses);
    claimed.add(concept.name);
    concepts.push(concept);
  }

  // Her conventions never *lose* a concept either. One she named that the
  // read did not surface is still hers and is still returned — with no
  // anchor, because there is honestly no passage behind it. See
  // `ReadConcept.anchor` for why an un-anchored concept is the correct
  // answer here rather than a file path.
  for (const record of records) {
    if (claimed.has(record.name)) continue;
    concepts.push({
      name: record.name,
      aliases: [],
      provenanceTier: record.tier,
      courses: record.courses,
      anchor: undefined,
      alsoIn: [],
      ...(record.boundNotePath !== undefined ? { boundNotePath: record.boundNotePath } : {}),
      sourcePaths: record.sourcePaths,
      // No passage anchored it — honestly zero passage evidence, not "not
      // tracked" (`./size.js`'s `passageCount` doc) — so this falls back to
      // whole-note grounding, same floor as an un-corroborated `ConceptRecord`.
      size: readConceptSize({
        anchor: undefined,
        alsoIn: [],
        sourcePaths: record.sourcePaths,
        ...(record.boundNotePath !== undefined ? { boundNotePath: record.boundNotePath } : {}),
      }),
    });
  }

  const found = new Map<VaultPath, number>();
  for (const concept of concepts) {
    if (concept.anchor === undefined) continue;
    const path = concept.anchor.sourcePath;
    found.set(path, (found.get(path) ?? 0) + 1);
  }

  // [EXT-6] / ol-2zfj.8: reconcile every proposed relation against the
  // concepts this same read actually returned. The concept set is
  // authoritative — a relation naming one it did not return is dropped and
  // counted, never used to mint one.
  const reconciled = reconcileRelations(proposedRelations, concepts);
  const withContainment = applyContainmentEvidence(concepts, reconciled.relations);

  const sorted = [...withContainment].sort((a, b) => byCodeUnit(a.name, b.name));
  return {
    outcome: 'read',
    concepts: sorted,
    relations: reconciled.relations,
    relationsDropped: totalDropped(reconciled.dropped),
    coverage: buildCoverage(all, budgeted, found),
    ...base,
  };
}
