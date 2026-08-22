/**
 * Course association from folder structure (F1.3, `ol-jbnu`).
 *
 * F1.3 is explicit that course association is a property of **where a note
 * lives**: "map course folders to courses, tolerating inconsistent
 * structures". Concept extraction did not do that — it read a `course`
 * frontmatter key and nothing else, so on a vault that does not carry that
 * key every `ConceptRecord.courses` came back empty and every downstream
 * course surface (the Today panel's per-course rows, F2.5's course filter)
 * silently had nothing to work with. Empty is not an error anywhere in that
 * chain, which is why it went unnoticed: see
 * `olea-service/findings/G1-concept-review.md` §(c), which measured the
 * frontmatter key's coverage on real material and derived course from the
 * path itself for exactly this reason.
 *
 * **The frontmatter key stays authoritative where it is present.** Her
 * convention outranks ours (R1/R2's spirit applied to association rather
 * than naming): a note that names its own course is believed, and the path
 * is consulted only when the note says nothing. So this is a *fallback*,
 * never an override, and a note filed in the "wrong" folder keeps whatever
 * it says about itself.
 *
 * **The rule, and its blind spot, stated rather than discovered later.** The
 * course is the path segment directly under `coursesFolder`, and it must be
 * a **directory** — never the file itself. A note sitting loose in
 * `01 Courses/` therefore has no course under this rule, and neither does
 * anything outside that folder. Nothing is guessed in either case: `courses`
 * stays empty, which is exactly what it means. `../source/register.ts`
 * deliberately does *not* do this for `role:` sources, because its own
 * folder (`03 Research`) is flat and carries no course structure to read.
 *
 * The derivation matches the one `olea-service`'s controls already use on
 * the same vault shape (`scripts/harness/evals.mjs`, and
 * `scripts/check-eval-data.mjs`, which cites F1.3 while matching on path
 * segments for the same reason). One rule, two repos — a second, subtly
 * different derivation is how two answers to "which course is this?" get
 * shipped at once.
 */

import type { VaultPath } from '../vault/types.js';

/**
 * F1.3's course folder. The vault-shape default, alongside
 * `DEFAULT_ZETTELKASTEN_FOLDER` and `../source/register.ts`'s
 * `DEFAULT_SOURCES_FOLDER`; overridable wherever those are.
 */
export const DEFAULT_COURSES_FOLDER = '01 Courses' as VaultPath;

/**
 * The course code `path` sits under, or `undefined` when the path is outside
 * `coursesFolder` or names a file directly inside it. Returns the segment
 * **verbatim** — no case folding, no normalisation (R1/R2).
 *
 * F1.3's "tolerating inconsistent structures" is why only the *first* segment
 * is read: `<COURSE>/WEEK 2/…` and `<COURSE>/<text name>/…` are both simply
 * `<COURSE>`, and nothing here assumes what comes after it.
 */
export function courseFromPath(
  path: VaultPath,
  coursesFolder: VaultPath = DEFAULT_COURSES_FOLDER,
): string | undefined {
  const prefix = `${coursesFolder}/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf('/');
  // No further separator means `rest` is the file itself, sitting loose in
  // the course folder — a file is not a course code, so this is `undefined`
  // rather than a course named after a note.
  if (slash <= 0) return undefined;
  return rest.slice(0, slash);
}

/**
 * The courses a note contributes, F1.3's way: what it says about itself if it
 * says anything, otherwise where it lives. `explicit` is the note's own
 * `course` frontmatter list, already read by the caller.
 */
export function notePathCourses(
  path: VaultPath,
  explicit: readonly string[],
  coursesFolder: VaultPath = DEFAULT_COURSES_FOLDER,
): readonly string[] {
  if (explicit.length > 0) return explicit;
  const derived = courseFromPath(path, coursesFolder);
  return derived === undefined ? [] : [derived];
}
