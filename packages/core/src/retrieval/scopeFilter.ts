/**
 * The scope filter stage (`docs/dev/intelligence-build/evd.md` §2,
 * `[ILB-EVD-4]`) — pure, and deliberately the first stage in the target
 * pipeline, before keyword or vector candidates are ever gathered.
 *
 * **Default policy, from the spec:** keep a candidate whose source belongs
 * to one of the scope's courses, or has no course at all when
 * `scope.includeUncoursed` is set; when `scope.courses` is empty, keep
 * everything (the spec's "widen to the vault only when the concept has no
 * course" case). `evd.md` §2 records this default as reversible and flagged
 * for review with the benchmark, not a decision bead — a caller is free to
 * assemble a different `RetrievalScope` to get different behaviour; this
 * function only fixes what one `RetrievalScope` means.
 *
 * **`courseOf` is an injected resolver, not something this module reads
 * from a store.** `applyScope` has no vault or index access of its own
 * (this package never imports `obsidian`, INV-1) and does not import
 * `../concept/course.ts`'s `courseFromPath`/`notePathCourses` — the shape it
 * asks for (`(path) => readonly string[]`) matches `notePathCourses`'s own
 * return shape so a caller CAN wire that resolver in, but nothing here does:
 * per this bead's scope, the filter is built and tested, not wired.
 */

import type { VaultPath } from '../vault/types.js';
import type { RetrievalScope } from './request.js';

/**
 * Resolves a source path to the course codes it belongs to — possibly none.
 * Shaped like `../concept/course.ts`'s `notePathCourses` return value
 * (`readonly string[]`, empty meaning "no course"), so an existing resolver
 * fits without adaptation.
 */
export type CourseOf = (path: VaultPath) => readonly string[];

/**
 * Filters `candidates` down to the ones `scope` admits, per the policy in
 * this module's doc. Generic over anything carrying a `path` — the same
 * shape `RetrievalChunk` and `HybridHit` both already have — so this can run
 * either before fusion (over `RetrievalChunk[]`) or after (over
 * `HybridHit[]`) without a second implementation.
 */
export function applyScope<T extends { readonly path: VaultPath }>(
  candidates: readonly T[],
  scope: RetrievalScope,
  courseOf: CourseOf,
): readonly T[] {
  if (scope.courses.length === 0) return candidates;

  const scopeCourses = new Set(scope.courses);
  return candidates.filter((candidate) => {
    const courses = courseOf(candidate.path);
    if (courses.length === 0) return scope.includeUncoursed;
    return courses.some((course) => scopeCourses.has(course));
  });
}
