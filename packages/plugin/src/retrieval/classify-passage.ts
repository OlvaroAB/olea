/**
 * `buildClassifyPassageHook` — the production `DraftQuizCardsDeps.classifyPassage`
 * hook (`ol-2zfj.36`, `[D-101]`). Closes `olea-core`'s
 * `classifyMateriality` (`source/materiality.ts`) over whatever this plugin
 * can answer about a vault-relative path WITHOUT a fresh async vault read
 * per chunk — `draft-quiz-cards.ts`'s own hook seam.
 *
 * **Why this hook stays synchronous.** `DraftQuizCardsDeps.classifyPassage`
 * is a plain function, not a `Promise` — `draftQuizCardsForConcept` maps it
 * over every grounded chunk with a plain `.map()`, and every existing
 * `classifyPassage` fixture in `draft-quiz-cards.spec.ts` is synchronous.
 * Widening that to async would ripple into that call site and every test
 * built against it, for no real gain: Obsidian's own
 * `metadataCache.getCache(path)` already answers "what frontmatter did this
 * file parse to" synchronously, from the cache Obsidian maintains as she
 * edits, so there is no async boundary this hook actually needs to cross.
 *
 * **Narrow port, not an `obsidian` import (INV-1).** `FrontmatterRoleHost`
 * below is the one method this file needs — the same narrow-port discipline
 * `wiring.ts`'s `ObsidianDataHost` already uses for `{loadData, saveData}`.
 * `main.ts` is meant to supply the real closure over
 * `this.app.metadataCache.getCache(path)?.frontmatter`.
 *
 * **What is NOT wired here, named rather than silently absent:**
 *  - `arrivalDeclaredRole` (C3.1's drop-flow declaration, `[D-101]`) has no
 *    production source yet — `features/C3-ingestion.md`'s
 *    `plugin/ingestion/drop-kind.spec` scenario is a separate, unbuilt bead
 *    in `packages/plugin/src/ingestion/`, outside this file's owned
 *    directory. This hook always classifies with `arrivalDeclaredRole:
 *    undefined`, which `classifyMateriality` already handles correctly —
 *    it falls through to the folder prior.
 *  - Her explicit correction (the repair badge, second wave per the
 *    ruling) has no store or UI yet, so `resolveMateriality`'s `correction`
 *    argument is never supplied here. Building either is a different bead's
 *    job, not an invented surface of this one (see the project's "no
 *    user-visible affordance without a clause" rule).
 *  - **Reachability**: nothing in this package calls `buildClassifyPassageHook`
 *    yet. `main.ts`'s `draftQuizCardsDeps()` (private method, ~line 1283) is
 *    the one production call site that assembles `DraftQuizCardsDeps` for
 *    the live F3.3 generation sweep, and `main.ts` is owned by a different
 *    lane this round — the exact diff that call site needs is recorded on
 *    `ol-2zfj.36`'s close notes rather than applied here.
 */

import {
  classifyMateriality,
  formatFromExtension,
  type SourceRole,
  type VaultPath,
} from 'olea-core';
import type { DraftQuizCardsDeps } from './draft-quiz-cards.js';

/**
 * The one piece of Obsidian state this hook reads: whatever frontmatter is
 * already cached for a path. Never triggers a fresh disk/vault read —
 * `main.ts` supplies `(path) => this.app.metadataCache.getCache(path)?.frontmatter`.
 */
export interface FrontmatterRoleHost {
  /** Raw frontmatter for `path`, or `undefined` when nothing is cached for it (never yet indexed, or genuinely no frontmatter). Reads exactly one key (`role`) out of whatever is returned. */
  frontmatterFor(path: VaultPath): Record<string, unknown> | undefined;
}

/**
 * Aliases `../../../core/src/source/register.ts`'s `ROLE_ALIASES` table is
 * not exported, so this is a small, independent normaliser rather than an
 * edit to that file (owned by a different lane's `source/` work this
 * round). Deliberately narrower than that table: this hook only needs to
 * recognise the exact `SourceRole` values, tolerant of case and separators,
 * the same way F1.5's frontmatter posture is "honoured, never required" —
 * an unrecognised or absent `role` value simply supplies no cue, exactly
 * like a missing one.
 */
const ROLE_BY_NORMALIZED_VALUE: ReadonlyMap<string, SourceRole> = new Map([
  ['past paper', 'past-paper'],
  ['past-paper', 'past-paper'],
  ['pastpaper', 'past-paper'],
  ['exam paper', 'past-paper'],
  ['objectives', 'objectives'],
  ['learning objectives', 'objectives'],
  ['course objectives', 'objectives'],
  ['course material', 'course-material'],
  ['course-material', 'course-material'],
  ['coursematerial', 'course-material'],
  ['coursebook', 'course-material'],
  ['textbook', 'course-material'],
  ['lecture notes', 'course-material'],
]);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function roleFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
): SourceRole | undefined {
  const raw = frontmatter?.role;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return ROLE_BY_NORMALIZED_VALUE.get(normalize(raw));
}

export interface BuildClassifyPassageHookDeps {
  readonly frontmatterHost: FrontmatterRoleHost;
}

/**
 * Builds the real `classifyPassage` hook `draft-quiz-cards.ts` reads. No
 * caching layer of its own: `deps.frontmatterHost.frontmatterFor` is
 * already an O(1) read against Obsidian's own metadata cache (see this
 * file's module doc), so there is nothing expensive here to memoise.
 * `classifyMateriality` runs once per chunk, which is exactly what lets its
 * passage-grain overrides (an embedded fragment, a stylometric demotion)
 * apply against that chunk's own text — see its module doc.
 */
export function buildClassifyPassageHook(
  deps: BuildClassifyPassageHookDeps,
): NonNullable<DraftQuizCardsDeps['classifyPassage']> {
  return (chunk) => {
    const format = formatFromExtension(chunk.path);
    const declaredRole = roleFromFrontmatter(deps.frontmatterHost.frontmatterFor(chunk.path));
    const classified = classifyMateriality({
      path: chunk.path,
      format,
      // `exactOptionalPropertyTypes`: omit the key entirely rather than
      // assign `undefined` to it, same discipline `main.ts`'s own
      // `draftQuizCardsDeps()` already uses for its optional `keywordIndex`.
      ...(declaredRole === undefined ? {} : { declaredRole }),
      text: chunk.text,
    });
    return classified.fact;
  };
}
