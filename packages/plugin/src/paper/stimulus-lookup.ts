/**
 * `createHeldMaterialStimulusLookup` — the production shared-passage lookup a structured practice
 * paper asks for each group whose template shares a scenario, extract, table or data set (`[D-562]`,
 * `ol-egov.141.89.7.93`; F4.11).
 *
 * It is an adapter, and decides nothing itself. The rule that picks a passage, says none is held, or
 * says it did not look is `olea-core`'s `lookUpPaperGroupStimulus` (`oracle/paper-stimulus.ts`,
 * `ol-egov.141.89.7.98`, whose module doc states it in full), and the passage's text is that rule's
 * `heldStimulusText`: her chunk exactly as held, never trimmed, rewritten or generated. This file
 * only hands it the right material:
 *
 * - **Which sources.** The held sources of the group's concepts, in the order the composition names
 *   the concepts (`PaperStimulusLookupRequest.conceptKeys`: the concepts the group's parts are
 *   written on, in printed order) and, within a concept, in the order the blueprint read them
 *   (`./assemble.ts`'s `buildHeldSourceForConcept`). The same held sources ground the parts, so a
 *   passage is always her own material for the group's concepts. A concept with none adds nothing.
 * - **Which are assessment papers.** A source is an assessment paper (`isAssessmentPaper: true`,
 *   never searched or chosen) when its id is the path of a document registered now as a past paper,
 *   of ANY course, or of any resolved assessment record's note. It is known not to be one (`false`)
 *   only when both were read and its id is a vault path in neither. When the registrations could not
 *   be read, or the source's id is not a path (`buildHeldSourceForConcept`'s concept-key fallback),
 *   its status is unknown (`null`): the core rule then neither searches it nor claims none is held.
 *   No production fact records which papers are sealed, so no past paper may be a stimulus source.
 *
 * Nothing is logged (D-005): the text travels to the request and the face, and is forgotten.
 */

import {
  heldStimulusText,
  lookUpPaperGroupStimulus,
  type PaperScopeConcept,
  type PaperStimulusSource,
} from 'olea-core';
import type { PaperStimulusLookup, PaperStimulusLookupOutcome } from './journal-composition.js';

export interface HeldMaterialStimulusLookupDeps {
  /** The course's concepts as the blueprint read them (`BuildPaperBlueprintInput.concepts`): each one's held sources, in order. */
  readonly concepts: readonly Pick<PaperScopeConcept, 'conceptKey' | 'heldSources'>[];
  /**
   * The vault paths of every assessment paper Olea knows of: every document registered now as a
   * past paper, of any course, and every resolved assessment record's note. Resolves `null` when
   * they could not be read, so no source's status can be told. Asked at most once per lookup, and
   * only when a group is looked for.
   */
  readonly assessmentPaperPaths: () => Promise<ReadonlySet<string> | null>;
}

/** Whether one held source is an assessment paper: `true`, `false` only when known, otherwise `null` (module doc). */
function assessmentPaperStatus(
  sourceId: string,
  conceptKey: string,
  assessmentPaperPaths: ReadonlySet<string> | null,
): boolean | null {
  if (assessmentPaperPaths === null) return null;
  if (assessmentPaperPaths.has(sourceId)) return true;
  // `buildHeldSourceForConcept`'s concept-key fallback is not a path: its document is not known.
  if (sourceId === conceptKey) return null;
  return false;
}

/** The lookup's sources for `conceptKeys`, in order: each concept's held sources with its assessment-paper status. */
export function stimulusSourcesFor(
  concepts: HeldMaterialStimulusLookupDeps['concepts'],
  conceptKeys: readonly string[],
  assessmentPaperPaths: ReadonlySet<string> | null,
): readonly PaperStimulusSource[] {
  const byKey = new Map(concepts.map((concept) => [concept.conceptKey, concept] as const));
  const out: PaperStimulusSource[] = [];
  for (const key of conceptKeys) {
    const concept = byKey.get(key);
    if (concept === undefined) continue;
    for (const held of concept.heldSources) {
      out.push({
        sourceId: held.sourceId,
        kind: held.kind,
        chunks: held.chunks,
        isAssessmentPaper: assessmentPaperStatus(held.sourceId, key, assessmentPaperPaths),
      });
    }
  }
  return out;
}

/** The production `PaperStimulusLookup` over the held sources of a group's concepts (module doc). */
export function createHeldMaterialStimulusLookup(
  deps: HeldMaterialStimulusLookupDeps,
): PaperStimulusLookup {
  let paths: Promise<ReadonlySet<string> | null> | undefined;
  const assessmentPaperPaths = (): Promise<ReadonlySet<string> | null> => {
    paths ??= deps.assessmentPaperPaths().catch(() => null);
    return paths;
  };
  return async (request): Promise<PaperStimulusLookupOutcome> => {
    const sources = stimulusSourcesFor(
      deps.concepts,
      request.conceptKeys,
      await assessmentPaperPaths(),
    );
    const found = lookUpPaperGroupStimulus({ need: request.need, sources });
    if (found.status === 'none-held') return { status: 'none-held' };
    if (found.status === 'not-looked') return { status: 'not-looked', reason: found.reason };
    const text = heldStimulusText(sources, found.stimulus);
    // The core rule resolves its own pick; a pointer that did not resolve is not a passage.
    if (text === null) return { status: 'not-looked', reason: 'text-unresolved' };
    return { status: 'held', stimulus: found.stimulus, text };
  };
}
