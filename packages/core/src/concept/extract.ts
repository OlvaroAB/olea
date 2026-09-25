/**
 * `extractConcepts` — **one corroborating source, no longer the extractor**
 * (C7.2, C7.3, F1.4, F4.1, P1-T05, P5-T02, `[D-068]`).
 *
 * **Read `./read.ts` first.** `[D-068]` ruled that concepts come from the
 * material rather than from the filing: a model reads her lecture notes,
 * papers and course documents and returns the concepts inside them, and that
 * read is the floor everyone gets. This module walks her `topic` properties,
 * her Zettelkasten titles and her course folders — all of which are her
 * *filing*. Scope principle 13 is what it now serves: **conventions are
 * evidence, never preconditions.** What it produces corroborates the read and
 * outranks it on conflict; it no longer decides whether anything is found at
 * all. `./read.ts`'s `readConcepts` is the caller that applies that
 * precedence, and it is the only place the two are reconciled.
 *
 * The behaviour below is deliberately unchanged by that demotion — this is
 * the "rebased rather than deleted" half of `[D-068]`'s own accounting. What
 * changed is its *standing*, and one thing follows from that which is easy to
 * miss: **its old oracle is gone.** Asserting that this function returns an
 * expected set of concepts, against a fixture vault built to mirror one
 * student's filing, measures our assumptions rather than the product's
 * promise. Those assertions are still useful as tests of *this* source's
 * mechanics; they are no longer tests of whether concept extraction works.
 *
 * **Tier 3 here is superseded, not repaired.** The vocabulary-matching path
 * below can only surface a concept her own curation already names somewhere,
 * which is exactly the parasitism `[D-068]` removed; `[EXT-2]` (`ol-468f`)
 * separately ruled it stays off in production. It survives in the tree only
 * because `./evidence.js` still serves two consumers outside this directory
 * that have nothing to do with concept identity — see the bead filed against
 * `ol-2zfj.1` for its retirement.
 *
 * **Tier 3, on.** `includeTier3: true` was a flag scaffold only through
 * P1-T05 (threw rather than doing anything). P5-T02 turns it on: past-paper
 * clusters and generated content (`./evidence.js` — see that module's doc
 * for exactly what "derived from her material" means here and why it
 * doesn't cover heading-derived extraction) can now surface a concept
 * that has **no** `topic` property naming it anywhere, as long as it has a
 * Zettelkasten note — a concept that is otherwise completely invisible to
 * this function today, since tiers 1/2 only ever walk topic-tagged notes.
 * Such a concept is minted at **tier 3**, not tier 1, even though
 * `boundNotePath` is set: tier reflects how much of the identity is *hers*
 * (curated via `topic`, or bound via an exact note match reached that way)
 * versus *inferred by Olea from derived material* with no topic-property
 * confirmation anywhere in the vault. This is a considered call, not the
 * pre-existing tier-1 rule extended casually — see the P5-T02 report for
 * the reasoning and an invitation to revisit it.
 *
 * **Course attribution is widened, layered on top of `topic:` frontmatter,
 * never replacing it (`ol-2zfj.33`, F1.3).** `findings/embedding-proximity-
 * threshold.md` Part II §12 (`olea-service`) measured production's course
 * association — a course-folder note's `topic:` property naming a concept —
 * against a reference-based rule: a concept note acquires the course of
 * **any** note under the course folder that plainly wikilinks it. On her real
 * vault the first rule reaches 29 of 131 concept notes; the second reaches
 * 115. Both run here: the `topic:` loop below is unchanged, and a second pass
 * scans every course-folder note's own body (its frontmatter already read for
 * `topic:`, so only the rest of the note is new work) for a `[[...]]` whose
 * target matches a Zettelkasten title exactly, and folds the citing note's
 * course into that record the same way a `topic:` citation would. The two
 * sources merge into one `courses` set per name; a concept named by both
 * carries the union, never a preference between them. **This is a course
 * fact, not a concept-identity one** — it does not touch tier's meaning
 * (`tier` still means "does the name match a Zettelkasten note exactly",
 * regardless of which of the two sources supplied it), and it does not widen
 * what tier 3 is allowed to mint: a reference match still requires an exact
 * Zettelkasten title on the other end, the same precision `topic:` already
 * has, not the vocabulary-matching tier `[D-068]`/`[EXT-2]` ruled off.
 *
 * **Membership follows the link, not the folder (`[D-248]`, F1.3, knowledge
 * model §3 tier 1).** A course's reading set is its course-folder documents
 * **plus every existing in-vault markdown note directly targeted by a
 * wikilink from one of them** — one hop, outward only, never inbound and
 * never a second hop. `resolveLinkClosure` below computes exactly that, and
 * it is what tier-1 binding now resolves against: a student-authored note
 * reachable by one hop whose title matches an already-attested concept
 * supplies that concept's name and definition **wherever it sits in the
 * vault**. The old rule — bind only inside a folder identified by the name
 * `05 Zettelkasten` — was the gap this generalises: a student who keeps no
 * such folder, or calls it something else, got none of tier 1 while the
 * knowledge model promised the ladder works for her too.
 *
 * **Three properties of that rule are load-bearing, and each is easy to
 * break by accident:**
 *
 * - **Attestation stays pre-closure.** A concept enters a course's scope
 *   only if the course's own material names it — her `topic` values and the
 *   wikilinks written in her course-folder notes' own text. Linked material
 *   *enriches* an already-attested concept (its name, its definition) and
 *   never creates one. Concretely: nothing in a reachable note's body is
 *   read here for identity, so a concept present only in a reachable note
 *   enters no course by reachability alone.
 * - **No splicing** (`[D-210]`). A reachable note is its own document with
 *   its own provenance; its text is never folded into the note that linked
 *   it. This module reads a bound note only for `noteDefinition`, which is
 *   recorded against that note's own path.
 * - **No external fetch.** Only in-vault markdown resolves; a URL is a
 *   reference, not source material, and a missing or empty link target
 *   contributes nothing.
 *
 * Closure is bounded per course by `DEFAULT_CLOSURE_DOCUMENT_CAP`
 * (`ExtractConceptsOptions.closureDocumentCap`), which **degrades silently**:
 * once a course has reached the cap, further closure documents are simply not
 * added and the course still works from its folder-only material.
 *
 * **What the Zettelkasten folder is still for.** `zettelkastenFolder` /
 * `DEFAULT_ZETTELKASTEN_FOLDER` no longer decide membership or tier-1
 * binding. They survive as the **tier-3 vocabulary** source only
 * (`./evidence.js`, `../tier3-evidence/build.ts`, both off in production per
 * `[EXT-2]`), which is that module's own mechanism and outside `[D-248]`'s
 * scope.
 *
 * **Definition capture at bind time (`[DF-13]`).** Knowledge model §3 says a
 * bound concept note is canonical because it "adopts her name, her
 * definition, and binds to that note" — the name and the binding shipped
 * with tier-1's original landing, and `ConceptRecord.definition` closes the
 * remaining gap: whenever `boundNotePath` is set (tier 1 *or* tier 3 — both
 * bind by the same exact-title match), the bound note is read and its body
 * captured verbatim via `noteDefinition` below. This is still extraction,
 * not synthesis: no model call, no rendering, no consumer wired to it yet.
 * `./read.ts`'s `readConcepts` does not forward this field onto
 * `ReadConcept` today, so it does not yet reach anything past this module —
 * that plumbing, and any of F3.2/F3.3/the concept view that would read it,
 * is out of this bead's scope and unclaimed by any other bead as of this
 * writing.
 */

import { buildOutline } from '../block/outline.js';
import { parseDocument } from '../block/parse.js';
import type { Provenance } from '../extract/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { extractWikilinks, readList, readScalar, wikilinkTarget } from '../frontmatter/read.js';
import { OLEA_UID_KEY } from '../uid/stamp.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { provisionalConceptKey } from './concept-key.js';
import { courseFromPath, DEFAULT_COURSES_FOLDER, notePathCourses } from './course.js';
import { extractTier3Evidence } from './evidence.js';
import type { ConceptKeyAnchor, ConceptKeyRequest } from './key-store.js';
import { resolveConceptKeys } from './key-store.js';
// Type-only, and deliberately the one edge of this module that reaches into `./read.js` — see
// `foldReadAnchors`'s own doc comment for why the join lives here rather than in that module.
// `isolatedModules` erases this import entirely, so it creates no runtime cycle with `read.ts`,
// which imports `extractConcepts` from here at runtime.
import type { ReadConcept } from './read.js';
import { conceptRecordSize } from './size.js';
import type { ConceptRecord, ConceptTier, ExtractConceptsOptions } from './types.js';
import { DEFAULT_ZETTELKASTEN_FOLDER, noteTitle } from './zettelkasten.js';

export { DEFAULT_COURSES_FOLDER, DEFAULT_ZETTELKASTEN_FOLDER };

interface Accumulator {
  readonly courses: Set<string>;
  readonly sourcePaths: Set<VaultPath>;
}

/**
 * Plain code-unit ordering, the same comparator the returned records use —
 * deliberately not `localeCompare` (see the sort at the end of this module).
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What a concept name resolves to in the Zettelkasten: exactly one note
 * (`bound`), several notes sharing that title (`ambiguous`), or none.
 *
 * **More than one note is never resolved to one of them** (`ol-lzwe`). The
 * previous index was a plain `Map.set` over the path list, so a duplicated
 * title silently kept whichever path `vault.list` happened to return last —
 * a binding that is a function of directory traversal order rather than of
 * anything in her vault, invisible to her and not reproducible. Picking a
 * winner deterministically (shortest path, first alphabetically) would only
 * make the wrong answer stable, so the ambiguity is carried on the record
 * instead and the concept stays unbound.
 */
interface TitleResolution {
  readonly bound?: VaultPath;
  readonly ambiguous?: readonly VaultPath[];
}

function resolveTitle(index: ReadonlyMap<string, VaultPath[]>, name: string): TitleResolution {
  const paths = index.get(name);
  if (paths === undefined || paths.length === 0) return {};
  if (paths.length === 1) return { bound: paths[0] as VaultPath };
  return { ambiguous: paths };
}

/**
 * Per-course closure document cap (`[D-248]` item 5, F1.3).
 *
 * **Provisional, and deliberately not a fitted number.** `[D-248]` left the
 * value empirical under a `[D-194]` pre-commitment rather than ruling one;
 * `ol-3ux7.5.64` (`[LINK-4]`) is the measurement that derives it against the
 * real corpus. This default is generous on purpose — the failure it guards is
 * an index page sitting inside a course folder that links most of a vault at
 * one hop, and a cap tight enough to bite an ordinary course would be a
 * fitted number shipping in public client source before anything measured it.
 * It is **declared, not derived** (component register): defensible in plain
 * English as "far above any plausible per-course link count, still bounded",
 * which is exactly why it may live here.
 *
 * Degradation is **silent**: once a course has this many closure documents,
 * further ones are not added, the course still works from its folder-only
 * material, and nothing is reported to her.
 */
export const DEFAULT_CLOSURE_DOCUMENT_CAP = 500;

/**
 * The one-hop outward link closure of a set of source paths (`[D-248]`).
 *
 * **What is reached.** Every existing in-vault markdown note directly
 * targeted by a wikilink written in a **course-folder** document among
 * `sourcePaths`. One hop: a link found in a reached note is not followed.
 * Outward only: a note that links *to* a course note does not join by that
 * fact. No external URL is resolved, and a target that names no existing
 * markdown note contributes nothing.
 *
 * **Frontmatter links count.** Her live convention writes `topic:
 * [[Concept]]` in frontmatter, and `[D-248]` says "a wikilink from a
 * course-folder document" without qualifying where in the document it sits.
 * (This is only about *membership*; what a `topic` value *means* is still
 * read by `extractConcepts`'s own frontmatter pass, and a body link still
 * attests separately.)
 *
 * **Many-to-many is preserved.** A note reachable from two courses is in both
 * closures; no popularity ceiling is applied.
 *
 * **Resolution** is by exact vault path first (`Target` → `Target.md`), then
 * by exact note title (R1/R2 — no case folding, no normalisation). A title
 * carried by several notes resolves to all of them for *membership*; tier-1
 * *binding* still refuses to pick one (`resolveTitle`, `ol-lzwe`).
 *
 * `read` lets a caller share an already-warmed content cache rather than
 * reading her course notes twice.
 */
export interface LinkClosure {
  /** Every reachable note, sorted — the closure half of the reading set. */
  readonly paths: readonly VaultPath[];
  /** Title → every reachable path carrying it, sorted. The tier-1 binding index. */
  readonly byTitle: ReadonlyMap<string, VaultPath[]>;
  /** Course → the link targets whose resolution actually entered that course's closure. */
  readonly titlesByCourse: ReadonlyMap<string, ReadonlySet<string>>;
  /** Course → how many closure documents it reached. Equal to the cap exactly when it degraded. */
  readonly countsByCourse: ReadonlyMap<string, number>;
}

export async function resolveLinkClosure(
  vault: VaultSource,
  sourcePaths: readonly VaultPath[],
  options: {
    readonly coursesFolder?: VaultPath;
    readonly closureDocumentCap?: number;
    readonly read?: (path: VaultPath) => Promise<string>;
  } = {},
): Promise<LinkClosure> {
  const coursesFolder = options.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const cap = options.closureDocumentCap ?? DEFAULT_CLOSURE_DOCUMENT_CAP;
  const read = options.read ?? ((path: VaultPath) => vault.read(path));

  // Vault-wide, deliberately not restricted by the caller's `under`: a link
  // out of a course folder lands "wherever it sits in the vault", which is
  // the whole point of binding by link rather than by folder.
  const allPaths = await vault.list({ extensions: ['md'] });
  const allPathSet = new Set<VaultPath>(allPaths);
  const allByTitle = new Map<string, VaultPath[]>();
  for (const path of allPaths) {
    const title = noteTitle(path);
    const paths = allByTitle.get(title);
    if (paths === undefined) allByTitle.set(title, [path]);
    else paths.push(path);
  }
  for (const paths of allByTitle.values()) paths.sort(byCodeUnit);

  function resolveTarget(target: string): readonly VaultPath[] {
    if (target.length === 0) return [];
    const asPath = (target.toLowerCase().endsWith('.md') ? target : `${target}.md`) as VaultPath;
    if (allPathSet.has(asPath)) return [asPath];
    return allByTitle.get(target) ?? [];
  }

  const pathsByCourse = new Map<string, Set<VaultPath>>();
  const titlesByCourse = new Map<string, Set<string>>();
  const reached = new Set<VaultPath>();

  // Deterministic order, which is what makes silent degradation reproducible
  // rather than a function of traversal luck: source paths in the caller's
  // (sorted) order, link targets in the order she wrote them.
  for (const path of [...sourcePaths].sort(byCodeUnit)) {
    if (courseFromPath(path, coursesFolder) === undefined) continue;
    const content = await read(path);
    const doc = parseDocument(content);
    const first = doc.blocks[0];
    const explicit =
      first?.kind === 'frontmatter' ? readList(parseFrontmatter(first.inner), 'course').items : [];
    const courses = notePathCourses(path, explicit, coursesFolder);
    if (courses.length === 0) continue;

    const targets: string[] = [];
    const seen = new Set<string>();
    for (const link of extractWikilinks(content)) {
      // A link may carry a pipe alias or a heading anchor
      // (`[[Suspension|the returning held notes]]`, `[[Target#Heading]]`);
      // neither is part of what it points at.
      const target = link.replace(/\|.*$/s, '').replace(/#.*$/s, '').trim();
      if (target.length === 0 || seen.has(target)) continue;
      seen.add(target);
      targets.push(target);
    }

    for (const target of targets) {
      const resolved = resolveTarget(target).filter((candidate) => candidate !== path);
      if (resolved.length === 0) continue; // missing target — contributes nothing
      for (const course of courses) {
        let coursePaths = pathsByCourse.get(course);
        if (coursePaths === undefined) {
          coursePaths = new Set();
          pathsByCourse.set(course, coursePaths);
        }
        let courseTitles = titlesByCourse.get(course);
        if (courseTitles === undefined) {
          courseTitles = new Set();
          titlesByCourse.set(course, courseTitles);
        }
        for (const candidate of resolved) {
          if (coursePaths.has(candidate)) {
            courseTitles.add(target);
            continue;
          }
          // The cap, degrading silently: stop adding, never throw, never warn.
          if (coursePaths.size >= cap) continue;
          coursePaths.add(candidate);
          courseTitles.add(target);
          reached.add(candidate);
        }
      }
    }
  }

  const byTitle = new Map<string, VaultPath[]>();
  for (const path of [...reached].sort(byCodeUnit)) {
    const title = noteTitle(path);
    const paths = byTitle.get(title);
    if (paths === undefined) byTitle.set(title, [path]);
    else paths.push(path);
  }

  const countsByCourse = new Map<string, number>();
  for (const [course, paths] of pathsByCourse) countsByCourse.set(course, paths.size);

  return {
    paths: [...reached].sort(byCodeUnit),
    byTitle,
    titlesByCourse,
    countsByCourse,
  };
}

/**
 * Her definition, read verbatim from a bound note's own content (`[DF-13]`,
 * knowledge model §3). Extraction, not synthesis: no model call, no
 * paraphrase, no markup stripped — the exact prose she wrote, trimmed only
 * of the surrounding blank lines every one of her notes carries.
 *
 * "The note's body" means: the content directly under the outline root whose
 * heading text matches `title` exactly (her convention — one note, one H1
 * naming the concept, e.g. `# Imbrication` — see the fixture Zettelkasten).
 * A sub-heading's content is not included; the concept's own defining prose
 * sits before its first sub-heading, and pulling everything under every
 * nested section would fold worked examples and asides into "the
 * definition" rather than just it.
 *
 * Two fallbacks, both honest about being approximations rather than a
 * second rule: a note with exactly one heading uses it regardless of
 * whether its text matches `title` (a title-cased or punctuated heading
 * still names one concept); a note with no heading at all uses its whole
 * body, since there is no structure to select from. Neither fallback fires
 * for the fixture and synthetic corpora today — both name their heading
 * after the bound title, per the convention above — so they exist for a
 * real vault's rougher edges rather than to satisfy a shape seen here.
 */
export function noteDefinition(content: string, title: string): string | undefined {
  const doc = parseDocument(content);
  const outline = buildOutline(doc);

  let contentIndices: readonly number[];
  if (outline.length === 0) {
    // No heading anywhere in the note — the whole body, less its
    // frontmatter, is the closest thing to "her definition" there is.
    contentIndices = doc.blocks
      .map((_, index) => index)
      .filter((index) => doc.blocks[index]?.kind !== 'frontmatter');
  } else {
    const root =
      outline.find((node) => node.heading.text === title) ??
      (outline.length === 1 ? outline[0] : undefined);
    if (root === undefined) return undefined; // several headings, none matching `title` — ambiguous, not guessed.
    contentIndices = root.contentIndices;
  }

  const text = contentIndices
    .map((index) => doc.blocks[index]?.raw ?? '')
    .join('')
    .trim();
  return text.length > 0 ? text : undefined;
}

export async function extractConcepts(
  vault: VaultSource,
  options: ExtractConceptsOptions = {},
): Promise<readonly ConceptRecord[]> {
  const zettelkastenFolder = options.zettelkastenFolder ?? DEFAULT_ZETTELKASTEN_FOLDER;
  const coursesFolder = options.coursesFolder ?? DEFAULT_COURSES_FOLDER;

  const notePaths = await vault.list({
    ...(options.under !== undefined ? { under: options.under } : {}),
    extensions: ['md'],
  });

  // `[DF-13]`: her definition, read once per bound note regardless of how
  // many places bind to it (tier-1/2's loop below and the tier-3 mint each
  // resolve independently, so without this a note whose title is reached
  // both ways — not possible today given `resolveTitle`'s 1:1 matching, but
  // cheap to guard against regardless — would be read twice). `vault.read`
  // only, never a write: definition capture is extraction, and INV-2 holds
  // by construction because nothing here touches the vault source. Declared
  // here rather than after the walk so the closure pass below and the walk
  // itself read each course-folder note exactly once between them.
  const noteContentCache = new Map<VaultPath, Promise<string>>();
  function contentFor(path: VaultPath): Promise<string> {
    let cached = noteContentCache.get(path);
    if (cached === undefined) {
      cached = vault.read(path);
      noteContentCache.set(path, cached);
    }
    return cached;
  }

  // `[D-248]`: the course reading set's closure half — one hop outward from
  // her course-folder notes. This, not a folder name, is what tier-1 binding
  // resolves against below, and what gates the body-wikilink course pass.
  const closure = await resolveLinkClosure(vault, notePaths, {
    coursesFolder,
    ...(options.closureDocumentCap !== undefined
      ? { closureDocumentCap: options.closureDocumentCap }
      : {}),
    read: contentFor,
  });
  // Exact-match (case-sensitive, per R1/R2) title -> every reachable note
  // path carrying that title, for tier-1 binding. A title with more than one
  // path is an ambiguity to record, never a race to resolve — `resolveTitle`.
  const reachableByTitle = closure.byTitle;

  const byName = new Map<string, Accumulator>();

  function accumulatorFor(name: string): Accumulator {
    let acc = byName.get(name);
    if (acc === undefined) {
      acc = { courses: new Set(), sourcePaths: new Set() };
      byName.set(name, acc);
    }
    return acc;
  }

  for (const path of notePaths) {
    const content = await contentFor(path);
    const doc = parseDocument(content);
    const first = doc.blocks[0];
    // A note with no frontmatter at all (a scratch note, say) contributes no
    // `topic:` citation — nothing to read — but it can still be a
    // course-folder note whose body wikilinks a concept, so this no longer
    // `continue`s past it; see the reference-based pass below.
    const fm = first?.kind === 'frontmatter' ? parseFrontmatter(first.inner) : undefined;

    // Her live convention writes `topic` values as wikilinks pointing at the
    // Zettelkasten note — `topic: [[Quartz cleavage]]` — so a `topic` item
    // that is entirely one link is read as that link's target and a bare
    // string is read verbatim, exactly as before (`ol-aq2p`; census in
    // `olea-service/findings/G1-concept-review.md` §(f)). Following an
    // explicit, user-authored pointer is *stricter* than the string compare
    // it replaces, not looser: nothing here folds case, trims, expands an
    // alias, or normalises punctuation, and a value that is not wholly a
    // link keeps its own text (see `wikilinkTarget`). Read per item rather
    // than per property so a property mixing both conventions loses neither.
    const topics =
      fm !== undefined
        ? readList(fm, 'topic').items.map((item) => wikilinkTarget(item) ?? item)
        : [];

    // F1.3, `ol-jbnu`: her `course` property when the note carries one,
    // otherwise the course folder it lives under. Reading only the property
    // meant every record came back with `courses: []` on a vault that does
    // not use that key — and empty is not an error anywhere downstream, so
    // the Today panel's course rows and F2.5's course filter each degraded
    // silently rather than reporting anything. See `./course.js`. Computed
    // once per note regardless of `topics`, because the reference-based pass
    // below needs the same answer.
    const courses = notePathCourses(
      path,
      fm !== undefined ? readList(fm, 'course').items : [],
      coursesFolder,
    );

    // `ol-t3sd`. Every value in her list is a concept this note contributes to
    // and whose instruments it supplies — all of them, not the first one with
    // the rest recorded as losses. Her order still matters and is carried
    // through `session/enumerate.ts`; it just no longer *selects*.
    for (const topic of topics) {
      const acc = accumulatorFor(topic);
      acc.sourcePaths.add(path);
      for (const course of courses) acc.courses.add(course);
    }

    // F1.3 widened — course-reference (`ol-2zfj.33`, module doc above).
    // Eligibility is path-based, same test `./course.js`'s `courseFromPath`
    // already makes for "is this a course-folder note at all": a note loose
    // in `coursesFolder` itself, or outside it entirely, contributes nothing
    // here, same as it always has for `notePathCourses`'s fallback.
    if (courseFromPath(path, coursesFolder) !== undefined) {
      // Every non-frontmatter block, concatenated — reusing the same parsed
      // `doc` rather than re-reading or re-parsing the note a second time.
      // Frontmatter is excluded because its wikilinks are `topic:`'s (and any
      // other property's) to interpret, not this pass's.
      const body = doc.blocks
        .filter((block) => block.kind !== 'frontmatter')
        .map((block) => block.raw)
        .join('');
      // A body link may carry a pipe alias or a heading anchor
      // (`[[Suspension|the returning held notes]]`, `[[Target#Heading]]`);
      // neither is part of the title a Zettelkasten note is matched against.
      const targets = new Set(
        extractWikilinks(body).map((link) =>
          link.replace(/\|.*$/s, '').replace(/#.*$/s, '').trim(),
        ),
      );
      for (const target of targets) {
        // `[D-248]`: only a link that lands on a note actually in this
        // course's one-hop closure counts — the same precision `topic:`
        // already has, deliberately not the vocabulary-matching tier-3 pass
        // mines free text for (module doc), and no longer conditional on the
        // target sitting in a folder with one particular name. The course is
        // taken per course rather than for the whole note, so a course whose
        // closure the cap already stopped does not inherit a target its own
        // closure never reached.
        const reaching = courses.filter(
          (course) => closure.titlesByCourse.get(course)?.has(target) === true,
        );
        if (reaching.length === 0) continue;
        const acc = accumulatorFor(target);
        acc.sourcePaths.add(path);
        for (const course of reaching) acc.courses.add(course);
      }
    }
  }

  function definitionFor(path: VaultPath, title: string): Promise<string | undefined> {
    return contentFor(path).then((content) => noteDefinition(content, title));
  }
  // `[D-174]`, `ol-2zfj.42`: the same `olea-uid` frontmatter `../uid/stamp.ts` already stamps and
  // `../session/instrument-id.ts` already reads as its identity root — used here, unchanged, as
  // the bound-note anchor's `noteUid` (design doc §7, "a real, small widening of the seam").
  // Never written here: this module only reads it.
  function noteUidFor(path: VaultPath): Promise<string | null> {
    return contentFor(path).then((content) => {
      const doc = parseDocument(content);
      const first = doc.blocks[0];
      if (first?.kind !== 'frontmatter') return null;
      const fm = parseFrontmatter(first.inner);
      const uid = readScalar(fm, OLEA_UID_KEY).scalar;
      return uid === '' ? null : uid;
    });
  }

  // `[D-180 / KEY-2]`'s rename-signature test (`key-store.ts`'s `resolveConceptKey`) needs to
  // know whether a matched record's OLD wording is genuinely absent from this run, to tell a
  // rename apart from two distinct concepts sharing one introducing note. `byName`'s keys are
  // exactly this run's candidate names, before any minting happens, so this is captured once
  // here — not per-candidate — and passed through unchanged to every `keysFor` call below.
  const runTopicNames = new Set(byName.keys());

  /** What `keysFor` needs to know about one candidate to derive or resolve its key. */
  interface KeyCandidate {
    readonly tier: ConceptTier;
    readonly name: string;
    readonly boundNotePath: VaultPath | undefined;
    readonly courses: readonly string[];
    readonly sourcePaths: readonly VaultPath[];
  }

  /**
   * `[D-174]` read-back (design doc §7): look up an existing `ConceptKeyRecord` by each
   * candidate's anchor before minting anything, so a re-extraction resolves to the key already
   * on file rather than deriving a fresh one. `courses` picks the first (sorted) course as the
   * topic anchor's single `course` field — a concept may belong to several (M:N, see
   * `ConceptRecord.courses`'s doc), and the anchor is a lookup signal, not identity, so this is a
   * deliberate simplification rather than a claim that only one course applies.
   *
   * `sourcePaths` (`[D-180]`) becomes the topic anchor's `introducingPaths`, sorted — the
   * candidate's own introducing material, threaded through so a topic-only concept surviving a
   * display-string edit has something honest to match a rename on (see `key-store.ts`'s
   * `isRenameSignatureMatch`). Unused when `boundNotePath` is set: a bound concept anchors on the
   * note itself, not on introducing material.
   *
   * **One store turn per call (`ol-egov.141.89.9.52`).** Every candidate of the call goes to
   * `resolveConceptKeys` together, which lists the store once and resolves them in order inside
   * the store's queue — so a second pass running at the same time waits, then finds what this one
   * minted, instead of minting its own key for the same brand-new concept.
   *
   * Gated on `options.stampConceptKeys` (see `ExtractConceptsOptions`'s doc) — off by default so
   * a call against a shared, tracked fixture vault never writes into it; falls back to the
   * pre-`[D-174]` `provisionalConceptKey` derivation when off.
   */
  async function keysFor(candidates: readonly KeyCandidate[]): Promise<readonly string[]> {
    if (options.stampConceptKeys !== true) {
      return candidates.map(({ name, boundNotePath }) =>
        provisionalConceptKey({ name, boundNotePath: boundNotePath ?? null }),
      );
    }
    // A subtree pass takes each concept's key from the vault-wide pass (see `vaultWideKeyByName`)
    // and resolves its own anchor only for a name that pass did not produce — never minting a
    // second record for a concept the vault-wide pass already keyed.
    const keys: (string | undefined)[] = candidates.map(({ name }) =>
      vaultWideKeyByName?.get(name),
    );
    const unresolved = candidates.flatMap((candidate, i) =>
      keys[i] === undefined ? [{ candidate, i }] : [],
    );
    if (unresolved.length === 0) return keys as string[];
    const requests: ConceptKeyRequest[] = [];
    for (const { candidate } of unresolved) {
      const anchor: ConceptKeyAnchor =
        candidate.boundNotePath !== undefined
          ? {
              kind: 'note',
              noteUid: await noteUidFor(candidate.boundNotePath),
              notePath: candidate.boundNotePath,
            }
          : {
              kind: 'topic',
              course: [...candidate.courses].sort()[0] ?? '',
              name: candidate.name,
              aliases: [],
              introducingPaths: [...candidate.sourcePaths].sort(),
            };
      requests.push({ tier: candidate.tier, anchor });
    }
    const resolved = await resolveConceptKeys(vault, requests, { runTopicNames });
    unresolved.forEach(({ i }, j) => {
      keys[i] = resolved[j];
    });
    return keys as string[];
  }

  /**
   * **A subtree pass keys by the vault-wide identity (`[D-357]`, `ol-egov.141.89.9.30`).** With
   * `under` set, this walk sees only part of a concept's evidence: a topic-only concept named in
   * two courses anchors on the first of its courses vault-wide, but on the subtree's own course
   * here, and a note reachable from another course may bind (or turn ambiguous) differently. A
   * stamped subtree pass that resolved its own anchors would therefore mint a second permanent key
   * for a concept the whole-vault readers (Today, the registry, the plan) already key — two keys
   * for one concept, the split `[D-357]` closes. So a stamped subtree pass first runs the same
   * extraction over the whole vault (stamped, every other option unchanged) and takes each
   * concept's key from there by name, the identity `byName` itself uses; everything else on the
   * returned records (`courses`, `sourcePaths`, `tier`, binding) stays this subtree's own.
   */
  let vaultWideKeyByName: ReadonlyMap<string, string> | undefined;
  if (options.stampConceptKeys === true && options.under !== undefined) {
    const { under: _subtree, ...vaultWideOptions } = options;
    const vaultWide = await extractConcepts(vault, vaultWideOptions);
    vaultWideKeyByName = new Map(vaultWide.map((record) => [record.name, record.key]));
  }

  const drafts = await Promise.all(
    [...byName].map(async ([name, acc]) => {
      const { bound, ambiguous } = resolveTitle(reachableByTitle, name);
      const definition = bound !== undefined ? await definitionFor(bound, name) : undefined;
      const sourcePaths = [...acc.sourcePaths].sort();
      const tier: ConceptTier = bound !== undefined ? 1 : 2;
      return { name, acc, bound, ambiguous, definition, sourcePaths, tier };
    }),
  );
  const draftKeys = await keysFor(
    drafts.map((draft) => ({
      tier: draft.tier,
      name: draft.name,
      boundNotePath: draft.bound,
      courses: [...draft.acc.courses],
      sourcePaths: draft.sourcePaths,
    })),
  );
  const records: ConceptRecord[] = drafts.map(
    ({ name, acc, bound, ambiguous, definition, sourcePaths, tier }, i) => ({
      key: draftKeys[i] as string,
      name,
      tier,
      courses: [...acc.courses].sort(),
      sourcePaths,
      ...(bound !== undefined ? { boundNotePath: bound } : {}),
      ...(definition !== undefined ? { definition } : {}),
      ...(ambiguous !== undefined ? { ambiguousNotePaths: ambiguous } : {}),
      size: conceptRecordSize({ sourcePaths, boundNotePath: bound }),
    }),
  );

  if (options.includeTier3 === true) {
    // The Zettelkasten-folder index, built **only** for tier 3 and only when
    // tier 3 runs. `[D-248]` took this folder out of membership and out of
    // tier-1 binding entirely (module doc); what remains is tier-3's own
    // vocabulary mechanism, which `../tier3-evidence/build.ts` owns and which
    // that ruling does not touch. Nothing above this line reads it.
    const zettelPaths = await vault.list({ under: zettelkastenFolder, extensions: ['md'] });
    const zettelByTitle = new Map<string, VaultPath[]>();
    for (const path of zettelPaths) {
      const title = noteTitle(path);
      const paths = zettelByTitle.get(title);
      if (paths === undefined) zettelByTitle.set(title, [path]);
      else paths.push(path);
    }
    for (const paths of zettelByTitle.values()) paths.sort(byCodeUnit);

    // Vocabulary = every Zettelkasten title *plus* every tier-1/2 name
    // already found, so tier-3 material that mentions an already-curated
    // concept attaches evidence to it rather than being invisible to this
    // pass — see ./evidence.js's module doc ("identity without inventing
    // it"). A name that matches only because it's in `byName` already has
    // a record above; only a name reachable purely through the
    // zettel-title half of the vocabulary is genuinely new here.
    const vocabulary = [...new Set([...zettelByTitle.keys(), ...byName.keys()])];
    const tier3 = await extractTier3Evidence(vault, {
      zettelkastenFolder,
      coursesFolder,
      ...(options.sourcesFolder !== undefined ? { sourcesFolder: options.sourcesFolder } : {}),
      // F3.1 (`ol-ep3.2`): threaded through so tier-3 MINTING sees explicitly
      // registered material too. Passing it only to the evidence pass and not
      // to this one would produce the confusing half-state where a registered
      // source can cite a concept but can never surface one.
      ...(options.registeredFiles !== undefined
        ? { registeredFiles: options.registeredFiles }
        : {}),
      vocabulary,
    });

    const newNames = new Map<string, Set<string>>(); // name -> courses seen citing it
    for (const citation of tier3.citations) {
      if (byName.has(citation.conceptName)) continue; // enrichment only — evidence lives in extractTier3Evidence's own output
      let courses = newNames.get(citation.conceptName);
      if (!courses) {
        courses = new Set();
        newNames.set(citation.conceptName, courses);
      }
      if (citation.course !== undefined) courses.add(citation.course);
    }

    const tier3Drafts: {
      readonly name: string;
      readonly courses: ReadonlySet<string>;
      readonly boundNotePath: VaultPath;
      readonly definition: string | undefined;
    }[] = [];
    for (const [name, courses] of newNames) {
      const { bound: boundNotePath } = resolveTitle(zettelByTitle, name);
      // By construction every name in `newNames` came from `vocabulary` and
      // is absent from `byName`, so it can only have reached
      // `extractTier3Evidence`'s matcher via the zettel-title half of the
      // vocabulary — `boundNotePath` is therefore always defined *unless* the
      // title is duplicated in the Zettelkasten, which `resolveTitle` refuses
      // to resolve (`ol-lzwe`). Both cases skip: a tier-3-only record's whole
      // identity *is* its bound note (`sourcePaths` is `[boundNotePath]`), so
      // unlike a tier-1/2 record there is nothing left to hang the ambiguity
      // on. Recorded as a known limitation on `ol-lzwe` rather than resolved
      // by traversal order.
      if (boundNotePath === undefined) continue;
      // Same fact as tier 1's: this record's whole identity is a note she
      // wrote, matched by exact title, so its definition is captured the
      // same way (`[DF-13]`) even though nothing tagged it as a `topic`.
      const definition = await definitionFor(boundNotePath, name);
      tier3Drafts.push({ name, courses, boundNotePath, definition });
    }
    // Resolved after, and apart from, tiers 1/2 — the order this pass has always minted in.
    const tier3Keys = await keysFor(
      tier3Drafts.map(({ name, courses, boundNotePath }) => ({
        tier: 3 as const,
        name,
        boundNotePath,
        courses: [...courses],
        sourcePaths: [boundNotePath],
      })),
    );
    tier3Drafts.forEach(({ name, courses, boundNotePath, definition }, i) => {
      records.push({
        key: tier3Keys[i] as string,
        name,
        tier: 3,
        courses: [...courses].sort(),
        sourcePaths: [boundNotePath],
        boundNotePath,
        ...(definition !== undefined ? { definition } : {}),
        size: conceptRecordSize({ sourcePaths: [boundNotePath], boundNotePath }),
      });
    });
  }

  // Plain code-unit ordering (matches FolderSource.list's convention),
  // deliberately not `localeCompare` — a locale-aware sort is one more way
  // for verbatim names to be treated as "the same, roughly" (R1/R2).
  records.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return records;
}

/**
 * A `Provenance`'s identity for de-duplication purposes: same file, same page, same span, same
 * section. Two anchors this function calls equal are the *same passage*, not merely similar ones
 * — `[D-085]`'s single passage-identity scheme is exact by construction (a `charRange` names one
 * span), so string equality on its parts is sufficient and no fuzzier compare is invented here.
 */
function provenanceKey(provenance: Provenance): string {
  const { sourcePath, location } = provenance;
  // `charRange` is optional (`../extract/types.js`, `ol-2zfj.54`) — every anchor this module
  // actually mints still carries one (see the module doc above), but the key stays honest for a
  // `Provenance` with none: absence renders as `-`/`-`, distinct from any real numeric offset
  // (including 0), never a fabricated 0/0 that would collide with a real zero-length span.
  const start = location.charRange?.start ?? '-';
  const end = location.charRange?.end ?? '-';
  return `${sourcePath} ${location.page} ${start} ${end} ${location.section ?? ''}`;
}

/** Order-preserving de-duplication by `provenanceKey` — the first occurrence of a location wins. */
function dedupeProvenance(passages: readonly Provenance[]): readonly Provenance[] {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const passage of passages) {
    const key = provenanceKey(passage);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(passage);
  }
  return out;
}

/**
 * Fold `[D-082]`'s passage-grain provenance from a completed `./read.js` `readConcepts` pass onto
 * the `ConceptRecord`s this module minted for the same names — the gap `ConceptRecord.anchor`'s
 * own doc comment names, and `../registry/build.ts`'s module doc points at: "nothing yet folds a
 * `ReadConcept.anchor` back onto the `ConceptRecord` for the same concept." This is that fold.
 * (`ol-2zfj.49`, the first half — carrying a generation-time citation onto `VaultInstrumentRecord`
 * is the second, deliberately separate, half; see `session/enumerate.ts`.)
 *
 * **Why this lives here, not in `read.ts` or at a call site.** `ConceptRecord` is this module's
 * type to mint, and the join needs nothing `read.ts` owns beyond the already-public `ReadConcept`
 * shape — pulling the fold into a third location would be the "intermediate document between a
 * clause and its owner" mistake at code scale. A caller that has both a fresh `extractConcepts`
 * result and a completed `readConcepts` result (none exists in production yet — that wiring is
 * `ol-2zfj.49`'s second half) applies this afterwards: `foldReadAnchors(records, readConcepts)`.
 *
 * **Matched by exact `name` — R1/R2's verbatim-string identity, the same one `ConceptRecord` and
 * `ReadConcept` both already use.** A `ReadConcept`'s `name` is `hers` when her convention won the
 * match (`./read.js`'s `corroborate`) — exactly the `ConceptRecord.name` this function receives —
 * so the join needs no fuzzy matching, casing fold or alias expansion of its own; those are R1/R2
 * violations this module refuses everywhere else and would not become correct here.
 *
 * **Omit-never-fabricate.** A `ReadConcept` with no `anchor` — her convention named it, but no
 * passage in this read introduced it (`./read.js`'s own doc on `ReadConcept.anchor`) — contributes
 * nothing: the matching `ConceptRecord`'s `anchor`/`alsoIn` stay absent, exactly as every mint site
 * in this module already leaves them. A record with no matching `ReadConcept` at all comes back
 * unchanged (the same object reference, no new allocation) — most callers of `extractConcepts`
 * pass no `readConcepts` at all, and this function must be a no-op for every record in that case.
 *
 * **Every passage counted once.** More than one `ReadConcept` can carry the same `name` — two
 * distinct proposals across separate reader calls, both corroborating to the same convention. This
 * function pools every anchor and `alsoIn` entry across all of them, de-duplicates identical
 * locations (`dedupeProvenance`, above), and takes the first survivor as `anchor` with the rest as
 * `alsoIn` — so a passage the read encountered twice never lands twice on the folded record.
 */
export function foldReadAnchors(
  records: readonly ConceptRecord[],
  readConcepts: readonly ReadConcept[],
): readonly ConceptRecord[] {
  const passagesByName = new Map<string, Provenance[]>();
  for (const concept of readConcepts) {
    if (concept.anchor === undefined) continue; // honestly un-anchored — nothing to fold
    const passages = passagesByName.get(concept.name);
    if (passages === undefined)
      passagesByName.set(concept.name, [concept.anchor, ...concept.alsoIn]);
    else passages.push(concept.anchor, ...concept.alsoIn);
  }
  if (passagesByName.size === 0) return records;

  return records.map((record) => {
    const passages = passagesByName.get(record.name);
    if (passages === undefined) return record;
    const [anchor, ...alsoIn] = dedupeProvenance(passages);
    if (anchor === undefined) return record; // unreachable given the `continue` above, kept honest
    return { ...record, anchor, ...(alsoIn.length > 0 ? { alsoIn } : {}) };
  });
}
