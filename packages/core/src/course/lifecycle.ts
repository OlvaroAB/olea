/**
 * C7.8's course lifecycle, BEGINNING point (`[D-098]`, `ol-0r92.7`): *"detection
 * proposes ('this looks like a course'), she confirms and names."*
 * `features/F1-sources.md`'s `core/course/lifecycle.spec` is this module's
 * BDD — see that file's C7.8 block for every scenario, and this module's doc
 * for which of them a pure, unpersisted function can actually discharge.
 *
 * ## What "detection runs" means here
 *
 * Course association is already derived from folder structure by
 * `../concept/course.ts`'s `courseFromPath` (F1.3) — this module does not
 * re-derive that rule, it reads its output. `detectCourseProposals` walks a
 * vault's paths, collects every distinct course code `courseFromPath` finds
 * under the courses folder, and proposes the ones a caller does not already
 * consider known. **It never creates anything**: the return value is a plain
 * array of proposals, there is no course record anywhere for this function to
 * write, and calling it twice with the same inputs is side-effect-free —
 * `features/F1-sources.md`'s "detection proposes a course and never creates
 * one" scenario in full.
 *
 * ## "Already known" is a caller-supplied fact, not a store this module owns
 *
 * A real installation needs to stop re-proposing a course once she has
 * confirmed it — but *persisting* that confirmation is exactly the
 * Class C schema addition `ol-0r92.7`'s brief stops short of (a `CourseRecord`
 * store is David's ratification to make, not a lane's). So `knownCourseCodes`
 * is taken as an explicit input, the same "caller supplies the fact" split
 * `../today/earlier-course-recognition.ts` uses for `newCourse`: whoever
 * eventually persists confirmed courses is what populates this set for real,
 * across restarts. Until that lands, `packages/plugin/src/main.ts` holds it
 * in memory for the process lifetime only — an honest, documented gap, not a
 * silent one (see that file's own comment at the call site).
 *
 * ## Kinship: nothing here compares names, and that is not an oversight
 *
 * `features/F1-sources.md`'s "kinship is never inferred from names" scenario
 * asks for a negative — no string-similarity grouping exists anywhere in the
 * lifecycle. This module has no function that takes two course names or codes
 * and returns a relationship between them; `lifecycle.spec.ts` asserts that
 * property directly against this file's own source text, the same corpus
 * discipline `course-setup/kinship-copy.spec.ts` uses for forbidden words.
 * The one kinship-bearing surface that exists (`course-setup/kinship-view.ts`)
 * takes its candidate course as an explicit parameter it never computes.
 *
 * ## What this module deliberately does NOT build
 *
 * Every other C7.8 scenario — the running flip, the archive proposal, the
 * residue question, retake-is-a-new-record, the leaving-reason enum, and
 * enforcing kinship is asked only once — reads or writes an existing course
 * record. None of them has anywhere to live until a `CourseRecord` schema is
 * ratified, so none of them is built here; `lifecycle.spec.ts` carries
 * `it.todo` markers naming each, not silent omissions. This module's whole
 * job is the one slice of C7.8 that is genuinely persistence-free: turning
 * "what does the vault's structure suggest" into a proposal.
 */

import { courseFromPath, DEFAULT_COURSES_FOLDER } from '../concept/course.js';
import type { VaultPath } from '../vault/types.js';

/**
 * What detection proposes for one not-yet-known course — shaped to feed
 * `packages/plugin/src/course-setup/confirmation-view.ts`'s
 * `CourseSetupProposal` directly (`suggestedName`/`rootPath`), without this
 * module importing anything Obsidian-shaped.
 */
export interface CourseDetectionProposal {
  /** The path segment `courseFromPath` read, verbatim — no case folding, no normalisation (R1/R2). */
  readonly code: string;
  /** `<coursesFolder>/<code>` — the root path detection proposes, as information, never yet a mapping (`mapping.ts` owns the mapping shape). */
  readonly rootPath: VaultPath;
}

/**
 * Every course code `courseFromPath` reads under `coursesFolder` that is not
 * already in `knownCourseCodes`, sorted, one proposal per code. Pure: reads
 * only its arguments, writes nothing, and returns `[]` rather than guessing
 * when nothing new is found — an empty result is not an error here any more
 * than it is for `notePathCourses`.
 */
export function detectCourseProposals(
  paths: readonly VaultPath[],
  knownCourseCodes: ReadonlySet<string>,
  coursesFolder: VaultPath = DEFAULT_COURSES_FOLDER,
): readonly CourseDetectionProposal[] {
  const codes = new Set<string>();
  for (const path of paths) {
    const code = courseFromPath(path, coursesFolder);
    if (code !== undefined) codes.add(code);
  }

  const proposals: CourseDetectionProposal[] = [];
  for (const code of codes) {
    if (knownCourseCodes.has(code)) continue;
    proposals.push({ code, rootPath: `${coursesFolder}/${code}` });
  }

  return proposals.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
