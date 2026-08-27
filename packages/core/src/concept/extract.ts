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
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList, wikilinkTarget } from '../frontmatter/read.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { provisionalConceptKey } from './concept-key.js';
import { DEFAULT_COURSES_FOLDER, notePathCourses } from './course.js';
import { extractTier3Evidence } from './evidence.js';
import { conceptRecordSize } from './size.js';
import type { ConceptRecord, ExtractConceptsOptions } from './types.js';
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

  const [notePaths, zettelPaths] = await Promise.all([
    vault.list({
      ...(options.under !== undefined ? { under: options.under } : {}),
      extensions: ['md'],
    }),
    vault.list({ under: zettelkastenFolder, extensions: ['md'] }),
  ]);

  // Exact-match (case-sensitive, per R1/R2) title -> every note path carrying
  // that title, for tier-1 binding. A title with more than one path is an
  // ambiguity to record, never a race to resolve — see `resolveTitle`.
  const zettelByTitle = new Map<string, VaultPath[]>();
  for (const path of zettelPaths) {
    const title = noteTitle(path);
    const paths = zettelByTitle.get(title);
    if (paths === undefined) zettelByTitle.set(title, [path]);
    else paths.push(path);
  }
  for (const paths of zettelByTitle.values()) paths.sort(byCodeUnit);

  const byName = new Map<string, Accumulator>();

  for (const path of notePaths) {
    const content = await vault.read(path);
    const doc = parseDocument(content);
    const first = doc.blocks[0];
    if (first?.kind !== 'frontmatter') continue;

    const fm = parseFrontmatter(first.inner);
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
    const topics = readList(fm, 'topic').items.map((item) => wikilinkTarget(item) ?? item);
    if (topics.length === 0) continue;

    // F1.3, `ol-jbnu`: her `course` property when the note carries one,
    // otherwise the course folder it lives under. Reading only the property
    // meant every record came back with `courses: []` on a vault that does
    // not use that key — and empty is not an error anywhere downstream, so
    // the Today panel's course rows and F2.5's course filter each degraded
    // silently rather than reporting anything. See `./course.js`.
    const courses = notePathCourses(path, readList(fm, 'course').items, coursesFolder);

    // `ol-t3sd`. Every value in her list is a concept this note contributes to
    // and whose instruments it supplies — all of them, not the first one with
    // the rest recorded as losses. Her order still matters and is carried
    // through `session/enumerate.ts`; it just no longer *selects*.
    for (const topic of topics) {
      let acc = byName.get(topic);
      if (!acc) {
        acc = { courses: new Set(), sourcePaths: new Set() };
        byName.set(topic, acc);
      }
      acc.sourcePaths.add(path);
      for (const course of courses) acc.courses.add(course);
    }
  }

  // `[DF-13]`: her definition, read once per bound note regardless of how
  // many places bind to it (tier-1/2's loop below and the tier-3 mint each
  // resolve independently, so without this a note whose title is reached
  // both ways — not possible today given `resolveTitle`'s 1:1 matching, but
  // cheap to guard against regardless — would be read twice). `vault.read`
  // only, never a write: definition capture is extraction, and INV-2 holds
  // by construction because nothing here touches the vault source.
  const definitionCache = new Map<VaultPath, Promise<string | undefined>>();
  function definitionFor(path: VaultPath, title: string): Promise<string | undefined> {
    let cached = definitionCache.get(path);
    if (cached === undefined) {
      cached = vault.read(path).then((content) => noteDefinition(content, title));
      definitionCache.set(path, cached);
    }
    return cached;
  }

  const records: ConceptRecord[] = await Promise.all(
    [...byName].map(async ([name, acc]) => {
      const { bound, ambiguous } = resolveTitle(zettelByTitle, name);
      const definition = bound !== undefined ? await definitionFor(bound, name) : undefined;
      const sourcePaths = [...acc.sourcePaths].sort();
      const record: ConceptRecord = {
        key: provisionalConceptKey({ name, boundNotePath: bound ?? null }),
        name,
        tier: bound !== undefined ? 1 : 2,
        courses: [...acc.courses].sort(),
        sourcePaths,
        ...(bound !== undefined ? { boundNotePath: bound } : {}),
        ...(definition !== undefined ? { definition } : {}),
        ...(ambiguous !== undefined ? { ambiguousNotePaths: ambiguous } : {}),
        size: conceptRecordSize({ sourcePaths, boundNotePath: bound }),
      };
      return record;
    }),
  );

  if (options.includeTier3 === true) {
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
      records.push({
        key: provisionalConceptKey({ name, boundNotePath }),
        name,
        tier: 3,
        courses: [...courses].sort(),
        sourcePaths: [boundNotePath],
        boundNotePath,
        ...(definition !== undefined ? { definition } : {}),
        size: conceptRecordSize({ sourcePaths: [boundNotePath], boundNotePath }),
      });
    }
  }

  // Plain code-unit ordering (matches FolderSource.list's convention),
  // deliberately not `localeCompare` — a locale-aware sort is one more way
  // for verbatim names to be treated as "the same, roughly" (R1/R2).
  records.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return records;
}
