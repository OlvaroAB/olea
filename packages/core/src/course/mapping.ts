/**
 * C7.8's course lifecycle, MAPPING half (`[D-098]`, `ol-0r92.7`):
 * *"the course↔location mapping is root paths with per-document exceptions —
 * her filing bends the mapping, never the reverse. On reorganisation, a
 * coherent folder move re-maps silently: files are keyed by stable uid
 * (C1.3), so the new root is computable from where the uid set went — the
 * same posture as the exact-match citation heal; only genuine scatter
 * surfaces a question, arriving with candidates pre-filled."*
 * `features/F1-sources.md`'s `core/course/mapping.spec` is this module's BDD.
 *
 * ## Two separate jobs, kept apart
 *
 * `CourseMapping` is the settled shape — a root plus whatever documents she
 * has attached from elsewhere — and is deliberately inert: nothing here
 * derives exceptions from path structure, because the whole point of the
 * clause is that her filing is the fact and the mapping's job is to record
 * it, never to second-guess it.
 *
 * `recomputeCourseRoot` is the reorganisation check: given where a course's
 * files sat at some earlier snapshot (by stable uid) and where the live uid
 * table says they sit now, decide whether the move is coherent (one new root
 * explains all of them — re-map silently) or scattered (more than one root
 * does — surface a question with the candidates it found, never a blank one).
 *
 * ## Why this stays core-only this round
 *
 * Both functions need a *before* snapshot to compare against — `CourseMapping`
 * and a per-uid relative-path table recorded at some earlier moment. Nothing
 * in this codebase persists a `CourseMapping` yet (that is the same
 * `CourseRecord`-shaped, Class C schema addition `./lifecycle.ts`'s module doc
 * names), so there is no live "earlier snapshot" for `packages/plugin` to feed
 * this from today. These functions are complete and tested against
 * constructed fixtures; wiring a real trigger for the "coherent move" and
 * "scatter" scenarios is future work gated on that same seam, not a defect in
 * what is built here.
 */

import type { VaultPath } from '../vault/types.js';

/**
 * A confirmed course's location: a root folder, plus documents she has
 * explicitly attached from elsewhere. Both fields are facts a caller
 * supplies — nothing here inspects a path to decide whether it belongs.
 */
export interface CourseMapping {
  readonly root: VaultPath;
  /** Documents outside `root` she has attached to this course. Never derived — always her explicit act. */
  readonly exceptions: readonly VaultPath[];
}

export function buildCourseMapping(
  root: VaultPath,
  exceptions: readonly VaultPath[] = [],
): CourseMapping {
  return { root, exceptions };
}

/** Whether `path` is inside the mapping — under `root`, or one of its per-document exceptions. */
export function pathInCourseMapping(mapping: CourseMapping, path: VaultPath): boolean {
  if (path === mapping.root || path.startsWith(`${mapping.root}/`)) return true;
  return mapping.exceptions.includes(path);
}

/**
 * A snapshot of where a course's files sat, keyed by stable uid (C1.3), so a
 * later reorganisation can be checked against it. `relativePaths` holds each
 * uid's path *relative to `root`* at snapshot time — e.g. `WEEK 2/Lecture.md`
 * for a file at `<root>/WEEK 2/Lecture.md`.
 */
export interface CourseRootSnapshot {
  readonly root: VaultPath;
  readonly relativePaths: ReadonlyMap<string, VaultPath>;
}

export type CourseRemapResult =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'silent'; readonly newRoot: VaultPath }
  | { readonly kind: 'scatter'; readonly candidates: readonly VaultPath[] };

/**
 * Compares `snapshot` against `currentLocations` (the live uid → path table,
 * e.g. `../uid/table.ts`'s `buildUidTable` output) and decides which of the
 * three C7.8 outcomes applies. A uid absent from `currentLocations` (the file
 * was deleted, or was never stamped) is skipped — its absence is not evidence
 * either way, matching `buildUidTable`'s own "duplicates are reported, not
 * guessed at" posture: this function never treats a missing signal as a
 * positive one.
 *
 * - Every found uid's current location still ends in its snapshot-relative
 *   path, under the SAME root as before → `'unchanged'`.
 * - Every found uid agrees on exactly one new root (all still end in their
 *   relative path, just under a different prefix) → `'silent'`, naming that
 *   root — nothing is surfaced for this case, per the clause.
 *   - A uid whose current path does not end in its snapshot-relative
 *     suffix at all did not move as part of a coherent folder rename (she
 *     renamed the file itself, say) — the whole point of "coherent" is that
 *     the relative shape held, so this counts as its own candidate root
 *     rather than being silently folded into the majority's.
 * - More than one root is implicated → `'scatter'`, carrying every implicated
 *   root as a pre-filled candidate, sorted — never a blank question.
 */
export function recomputeCourseRoot(
  snapshot: CourseRootSnapshot,
  currentLocations: ReadonlyMap<string, VaultPath>,
): CourseRemapResult {
  const roots = new Set<VaultPath>();

  for (const [uid, relativePath] of snapshot.relativePaths) {
    const current = currentLocations.get(uid);
    if (current === undefined) continue;

    const suffix = `/${relativePath}`;
    if (current.endsWith(suffix)) {
      roots.add(current.slice(0, current.length - suffix.length));
    } else {
      // Its relative shape did not hold — a coherent root cannot be read off
      // this file, so its own current location is the only honest candidate
      // to offer rather than guessing at a root for it.
      roots.add(current);
    }
  }

  const distinctRoots = [...roots];
  if (distinctRoots.length === 0) return { kind: 'unchanged' };
  if (distinctRoots.length === 1) {
    const only = distinctRoots[0] as VaultPath;
    return only === snapshot.root ? { kind: 'unchanged' } : { kind: 'silent', newRoot: only };
  }
  return { kind: 'scatter', candidates: distinctRoots.sort() };
}
