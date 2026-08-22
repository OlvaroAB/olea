/**
 * `extractConcepts` — tiers 1, 2 and 3 (C7.2, C7.3, F1.4, F4.1, P1-T05,
 * P5-T02). See ./types.ts for the tier model and the R1/R2 verbatim-name
 * rule this module must not violate.
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
 */

import { parseDocument } from '../block/parse.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList, wikilinkTarget } from '../frontmatter/read.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { DEFAULT_COURSES_FOLDER, notePathCourses } from './course.js';
import { extractTier3Evidence } from './evidence.js';
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

  const records: ConceptRecord[] = [];
  for (const [name, acc] of byName) {
    const { bound, ambiguous } = resolveTitle(zettelByTitle, name);
    const record: ConceptRecord = {
      name,
      tier: bound !== undefined ? 1 : 2,
      courses: [...acc.courses].sort(),
      sourcePaths: [...acc.sourcePaths].sort(),
      ...(bound !== undefined ? { boundNotePath: bound } : {}),
      ...(ambiguous !== undefined ? { ambiguousNotePaths: ambiguous } : {}),
    };
    records.push(record);
  }

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
      records.push({
        name,
        tier: 3,
        courses: [...courses].sort(),
        sourcePaths: [boundNotePath],
        boundNotePath,
      });
    }
  }

  // Plain code-unit ordering (matches FolderSource.list's convention),
  // deliberately not `localeCompare` — a locale-aware sort is one more way
  // for verbatim names to be treated as "the same, roughly" (R1/R2).
  records.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return records;
}
