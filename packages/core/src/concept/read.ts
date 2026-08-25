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

import { parseDocument } from '../block/parse.js';
import type { Provenance } from '../extract/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList } from '../frontmatter/read.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { DEFAULT_COURSES_FOLDER, notePathCourses } from './course.js';
import { extractConcepts } from './extract.js';
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
 * Passages from her markdown, one per prose-bearing block, each carrying the
 * character range that produced it so a citation can quote the exact span.
 *
 * Frontmatter and blank blocks are skipped — frontmatter is her filing, which
 * this stage is specifically not reading for identity, and a blank block has
 * no text to read. Everything else is offered, including headings: her
 * lecture headings are question-shaped, and it is the *reader* that decides
 * whether a passage names a concept. That judgement is the thing this module
 * does not make.
 *
 * **Documents that are not markdown are not gathered here yet.** Embedded
 * decks and PDFs reach concepts today through `../extract/`'s extracted
 * units, and routing those into this stage is real work with its own
 * provenance questions rather than a line of glue. It is filed rather than
 * half-built, and `coverage` reports what was actually looked at so the
 * absence is visible instead of implied.
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
    const first = doc.blocks[0];
    const explicitCourses =
      first?.kind === 'frontmatter' ? readList(parseFrontmatter(first.inner), 'course').items : [];
    const courses = notePathCourses(path, explicitCourses, coursesFolder);
    const course = courses.length === 1 ? courses[0] : undefined;

    for (const block of doc.blocks) {
      if (block.kind === 'frontmatter' || block.kind === 'blank') continue;
      if (block.raw.trim() === '') continue;
      passages.push({
        text: block.raw,
        anchor: {
          sourcePath: path,
          // Markdown has no pages; page 1 is the whole-document convention
          // `../extract/types.js` already documents for single-page formats.
          location: { page: 1, charRange: { start: block.start, end: block.end } },
        },
        course,
      });
    }
  }
  return passages;
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
    return {
      name: proposal.name,
      aliases: dedupe(proposal.aliases, proposal.name),
      // Tier 3 is not a fallback awaiting her confirmation (F1.4): nothing
      // here marks it provisional or lowers its confidence for that reason.
      provenanceTier: 3,
      courses: [...coursesFromPassages].sort(byCodeUnit),
      anchor: proposal.anchor,
      alsoIn: proposal.alsoIn,
      sourcePaths: [],
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

  const budgeted = budget.maxPassages > 0 ? all.slice(0, budget.maxPassages) : [];
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
  try {
    for (let i = 0; i < budgeted.length; i += perCall) {
      const batch = budgeted.slice(i, i + perCall);
      const response = await reader.read({ passages: batch });
      proposals.push(...response.concepts);
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
    });
  }

  const found = new Map<VaultPath, number>();
  for (const concept of concepts) {
    if (concept.anchor === undefined) continue;
    const path = concept.anchor.sourcePath;
    found.set(path, (found.get(path) ?? 0) + 1);
  }

  concepts.sort((a, b) => byCodeUnit(a.name, b.name));
  return { outcome: 'read', concepts, coverage: buildCoverage(all, budgeted, found), ...base };
}
