/**
 * `[D-544]` (`ol-egov.141.89.3.52`): which courses' reading sets an indexed document belongs to,
 * as the `CourseOf` resolver drafting retrieval scopes with (`./engine.ts`'s `RetrieveOptions.scope`).
 *
 * **Why drafting needs it.** The ruling: "another course's material must not silently satisfy local
 * grounding. Preserve genuine refusals where course C's material is thin." Before it, drafting
 * retrieval read the whole keyword index, so a concept a course's own material never explains could
 * be grounded in another course's notes, and the course's thin material never showed as a refusal.
 *
 * **What a course's material is.** C4's "her material" is "consistent with the reading set F1.3
 * defines", and F1.3 (`[D-248]`) defines a course's reading set as "its course folders plus every
 * existing in-vault note directly targeted by a wikilink from a course-folder document — one hop
 * outward only". This resolver builds exactly that from the index, so it needs no vault read:
 *
 *  - **Attribution.** A document belongs to the courses `../concept/course.ts`'s
 *    `notePathCourses` gives it: its own `course` (for a note, its frontmatter property; for a
 *    registered binary, the course it was registered under; for a transcript, its frontmatter),
 *    and otherwise the course folder it sits in. The index already carries the first as
 *    `IndexedDocument.courses`.
 *  - **The one-hop closure.** Every markdown note under a course folder is a link source for the
 *    courses attribution gives it, and each wikilink target it names — resolved the way
 *    `../concept/extract.ts`'s `resolveLinkClosure` resolves one, by exact path or else by title,
 *    to markdown notes only — joins those courses' reading sets, up to the same per-course cap,
 *    stopping silently. Links come from the indexed blocks (which keep wikilink markup) and, when
 *    the host supplies them, from the note's frontmatter, which the index does not carry.
 *
 * **A document in no reading set is in no course.** It is neither this course's material nor
 * another's: an unlinked note outside every course folder. Under `ownCourseScope` it is excluded,
 * because the default for drafting is the course's own material only.
 *
 * **Conservative where it is approximate.** Without frontmatter links a closure note reached only
 * through a note's frontmatter is missed, which can only narrow a course's reading set and so can
 * only turn a grounding into a refusal, never let another course's material in. Olea's own
 * instruments and home-note scaffolding are already out of the index (`[D-491]`), so they never
 * reach a reading set here either.
 */

import { courseFromPath, DEFAULT_COURSES_FOLDER, notePathCourses } from '../concept/course.js';
import { DEFAULT_CLOSURE_DOCUMENT_CAP } from '../concept/extract.js';
import { noteTitle } from '../concept/zettelkasten.js';
import { extractWikilinks } from '../frontmatter/read.js';
import type { PersistedKeywordIndex } from '../keyword-index/types.js';
import type { VaultPath } from '../vault/types.js';
import type { RetrievalScope } from './request.js';
import type { CourseOf } from './scopeFilter.js';

export interface CourseReadingSetOptions {
  /** Defaults to `DEFAULT_COURSES_FOLDER`, the folder every production caller uses. */
  readonly coursesFolder?: VaultPath;
  /** Defaults to `DEFAULT_CLOSURE_DOCUMENT_CAP`, the cap `resolveLinkClosure` applies. */
  readonly closureDocumentCap?: number;
  /**
   * The wikilink targets a note's frontmatter names (a `topic: [[Concept]]` value, say), which the
   * index does not carry. Omitted, only body links reach the closure (see the module doc).
   */
  readonly frontmatterLinksFor?: (path: VaultPath) => readonly string[];
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isMarkdown(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** A link's target without its pipe alias or heading anchor, as `resolveLinkClosure` reads it. */
function linkTarget(link: string): string {
  return link.replace(/\|.*$/s, '').replace(/#.*$/s, '').trim();
}

/**
 * The reading-set resolver for every document in `index` (module doc). Pure; reads only `index`
 * and whatever `options.frontmatterLinksFor` returns. A path the index does not carry resolves by
 * attribution from its path alone, plus any closure that reached it.
 */
export function courseReadingSetResolver(
  index: PersistedKeywordIndex,
  options: CourseReadingSetOptions = {},
): CourseOf {
  const coursesFolder = options.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const cap = options.closureDocumentCap ?? DEFAULT_CLOSURE_DOCUMENT_CAP;

  const explicitCourses = new Map<VaultPath, readonly string[]>();
  for (const doc of index.documents) explicitCourses.set(doc.path, doc.courses);
  const attributed = (path: VaultPath): readonly string[] =>
    notePathCourses(path, explicitCourses.get(path) ?? [], coursesFolder);

  const markdownPaths = new Set<VaultPath>();
  const markdownByTitle = new Map<string, VaultPath[]>();
  for (const doc of index.documents) {
    if (!isMarkdown(doc.path)) continue;
    markdownPaths.add(doc.path);
    const title = noteTitle(doc.path);
    const paths = markdownByTitle.get(title);
    if (paths === undefined) markdownByTitle.set(title, [doc.path]);
    else paths.push(doc.path);
  }
  for (const paths of markdownByTitle.values()) paths.sort(byCodeUnit);

  const resolveTarget = (target: string): readonly VaultPath[] => {
    if (target.length === 0) return [];
    const asPath = (target.toLowerCase().endsWith('.md') ? target : `${target}.md`) as VaultPath;
    if (markdownPaths.has(asPath)) return [asPath];
    return markdownByTitle.get(target) ?? [];
  };

  const closurePathsByCourse = new Map<string, Set<VaultPath>>();
  const closureCourses = new Map<VaultPath, Set<string>>();
  const sources = [...index.documents]
    .filter((doc) => isMarkdown(doc.path) && courseFromPath(doc.path, coursesFolder) !== undefined)
    .sort((a, b) => byCodeUnit(a.path, b.path));
  for (const doc of sources) {
    const courses = attributed(doc.path);
    if (courses.length === 0) continue;
    const links = [
      ...(options.frontmatterLinksFor?.(doc.path) ?? []),
      ...doc.blocks.flatMap((block) => extractWikilinks(block.text)),
    ];
    const targets: string[] = [];
    const seen = new Set<string>();
    for (const link of links) {
      const target = linkTarget(link);
      if (target.length === 0 || seen.has(target)) continue;
      seen.add(target);
      targets.push(target);
    }
    for (const target of targets) {
      const resolved = resolveTarget(target).filter((candidate) => candidate !== doc.path);
      for (const course of courses) {
        let coursePaths = closurePathsByCourse.get(course);
        if (coursePaths === undefined) {
          coursePaths = new Set();
          closurePathsByCourse.set(course, coursePaths);
        }
        for (const candidate of resolved) {
          if (coursePaths.has(candidate)) continue;
          if (coursePaths.size >= cap) continue; // the cap, stopping silently, as in the closure
          coursePaths.add(candidate);
          let reached = closureCourses.get(candidate);
          if (reached === undefined) {
            reached = new Set();
            closureCourses.set(candidate, reached);
          }
          reached.add(course);
        }
      }
    }
  }

  return (path) => {
    const courses = new Set<string>(attributed(path));
    for (const course of closureCourses.get(path) ?? []) courses.add(course);
    return [...courses].sort(byCodeUnit);
  };
}

/**
 * `[D-544]`'s default scope for drafting: `courseCode`'s own reading set and nothing else. A
 * document in no course is excluded too (`includeUncoursed: false`), so the default admits only
 * material the course itself holds. There is deliberately no widening option here: whether one
 * course's material may serve another's drafting is a separate decision from identity equivalence
 * (David, 2026-10-17), and no ruling grants it, so no confirmed same-as link widens this scope.
 */
export function ownCourseScope(courseCode: string): RetrievalScope {
  return { courses: [courseCode], includeUncoursed: false };
}

/**
 * The wikilink targets a frontmatter value names, for `CourseReadingSetOptions.frontmatterLinksFor`
 * over a host's parsed frontmatter. A string contributes every `[[...]]` it carries; a list
 * contributes each item's. An unquoted `topic: [[Concept]]` reaches a YAML parser as a one-item
 * list nested in a list, so a list holding exactly one string inside a list is read as that link,
 * the same pointer her own convention writes. Anything else contributes nothing.
 */
export function frontmatterWikilinkTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') return extractWikilinks(value);
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (Array.isArray(item) && item.length === 1 && typeof item[0] === 'string') {
        out.push(item[0]);
        continue;
      }
      out.push(...frontmatterWikilinkTargets(item));
    }
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).flatMap(frontmatterWikilinkTargets);
  }
  return [];
}
