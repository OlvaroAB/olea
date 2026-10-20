/**
 * `draftingScope` — the course scope every drafting call retrieves with (`[D-544]`,
 * `ol-egov.141.89.3.52`).
 *
 * David's ruling (2026-10-17): "another course's material must not silently satisfy local
 * grounding. Preserve genuine refusals where course C's material is thin." So a draft for a course
 * is grounded in that course's own reading set only (F1.3, `[D-248]`: its course folder, the
 * documents registered to it, and the notes its course notes link once), built from the keyword
 * index the call already holds by `olea-core`'s `courseReadingSetResolver`.
 *
 * **There is no widening path, deliberately.** Identity equivalence, assessment relevance and
 * permission to reuse another course's material are three separate decisions (David, 2026-10-17);
 * a confirmed same-as link decides only the first, so nothing here reads same-as links, and no
 * ruling yet grants the third. Both drafting functions (`./draft-quiz-cards.ts`,
 * `../generation/draft-cards.ts`) call this on every request, so no drafting caller can omit it.
 *
 * **Frontmatter links.** The index carries no frontmatter, so the host's cached frontmatter
 * (`SourceOriginFrontmatterHost`, which the composition root already supplies to both drafting
 * deps) supplies the links a note's frontmatter makes, such as a `topic: [[Concept]]` value. Without
 * a host those links are missed, which can only narrow the scope and so only turn a grounding into
 * a refusal, never admit another course's material.
 */

import {
  type CourseScopedRetrieval,
  courseReadingSetResolver,
  frontmatterWikilinkTargets,
  ownCourseScope,
  type PersistedKeywordIndex,
} from 'olea-core';
import type { SourceOriginFrontmatterHost } from '../source-origin.js';

export function draftingScope(
  keywordIndex: PersistedKeywordIndex,
  courseCode: string,
  frontmatterHost?: SourceOriginFrontmatterHost,
): CourseScopedRetrieval {
  return {
    scope: ownCourseScope(courseCode),
    courseOf: courseReadingSetResolver(
      keywordIndex,
      frontmatterHost === undefined
        ? {}
        : {
            frontmatterLinksFor: (path) =>
              frontmatterWikilinkTargets(frontmatterHost.frontmatterFor(path)),
          },
    ),
  };
}
