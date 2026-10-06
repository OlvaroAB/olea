/**
 * `buildClosedList` — one course's closed concept list for an alignment call (`ol-egov.141.89.7.52`,
 * scp.md S.3), read on her device from her own vault.
 *
 * **What it is.** The concepts whose `courses` include the course, each with the facts the plan
 * needs: its permanent key (a `concept-key1:` key is stable; a provisional one is not and is never
 * sent), the name as she wrote it, and the sources a description may come from. The names and
 * descriptions travel to the Worker transiently inside one call and are never stored beyond a hash
 * (boundary document 2.1: storage in her layer, processing remote).
 *
 * **Description sources.** Her own definition, accepted only when it is found in the note it was
 * read from (normalised containment) and that note is not an assessment document. The introducing
 * passage is not offered in this build: `ConceptRecord.anchor` is a location, and the text it points
 * at is not kept, so there is nothing to check a span against without re-reading the document. A
 * concept with no usable source carries a reason from the declared list and is still sent.
 *
 * **Membership.** This course's concepts only. S.3's second half (this course's ranking candidates
 * attributed elsewhere) has no cheap client source yet, so the frozen configuration records
 * `course-only` and results read unverified once the full membership lands.
 *
 * **Reads her vault; writes only Olea's layer.** `enumerateVaultInstruments` with
 * `stampConceptKeys` may mint `.olea/concepts/` records (never her notes), the same read the grove
 * provider makes. No `obsidian` import (INV-1).
 */

import {
  type AlignDescriptionSource,
  containsNormalised,
  enumerateVaultInstruments,
  OPAQUE_CONCEPT_KEY_PREFIX,
  type VaultSource,
} from 'olea-core';

export interface ClosedListConcept {
  /** The concept's persisted key; also its identity inside a plan. */
  readonly conceptId: string;
  readonly key: string;
  readonly stableKey: boolean;
  readonly name: string;
  readonly attribution: { readonly courseId: string; readonly courseName: string };
  readonly source: AlignDescriptionSource;
}

export interface ClosedListOptions {
  /** Vault paths of registered assessment documents: a definition bound to one is excluded as a description source. */
  readonly assessmentPaths?: ReadonlySet<string>;
}

/** The membership rule recorded in the frozen configuration. */
export const CLOSED_LIST_MEMBERSHIP = 'course-only';

export async function buildClosedList(
  vault: VaultSource,
  course: string,
  options: ClosedListOptions = {},
): Promise<readonly ClosedListConcept[]> {
  const { concepts } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const mine = concepts
    .filter((concept) => concept.courses.includes(course))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out: ClosedListConcept[] = [];
  for (const concept of mine) {
    let found: boolean | null = null;
    if (concept.definition !== undefined && concept.boundNotePath !== undefined) {
      try {
        found = containsNormalised(await vault.read(concept.boundNotePath), concept.definition);
      } catch {
        found = false;
      }
    }
    out.push({
      conceptId: concept.key,
      key: concept.key,
      stableKey: concept.key.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`),
      name: concept.name,
      attribution: { courseId: course, courseName: course },
      source: {
        definition: concept.definition ?? null,
        definitionSourceIsAssessment:
          concept.boundNotePath !== undefined &&
          options.assessmentPaths?.has(concept.boundNotePath) === true,
        definitionFoundInSource: found,
        anchor: null,
      },
    });
  }
  return out;
}
