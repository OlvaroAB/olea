/**
 * `buildGenerationWiring` — composes the F3.3 automatic generation pipeline
 * for `main.ts` (`ol-p3t07a`): the vault-backed draft cache, the
 * `DraftAcceptPort` the review session calls, and the sweep function the
 * ingestion tick drives.
 *
 * Obsidian-free, the same split every other `wiring.ts` in this package
 * uses — `main.ts` supplies the real `VaultSource`/transport/deviceId; this
 * module and `pipeline.spec.ts` exercise the composition against fakes.
 */

import type { ConceptRecord, ExtractedUnit, VaultSource } from 'olea-core';
import { DEFAULT_COURSES_FOLDER, extractConcepts } from 'olea-core';
import type { DraftQuizCardsDeps } from '../retrieval/draft-quiz-cards.js';
import type { DraftAcceptPort } from './accept.js';
import { createDraftAcceptPort } from './accept.js';
import { createVaultDraftCacheStore, type DraftCacheStore } from './cache-store.js';
import { type GenerationSweepReport, runGenerationSweep } from './pipeline.js';

export interface GenerationWiringDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly coursesFolder?: string;
}

export interface GenerationWiring {
  readonly cache: DraftCacheStore;
  readonly acceptPort: DraftAcceptPort;
  /**
   * Runs one sweep over `units` against `draftDeps` (assembled by the caller
   * from `RetrievalWiring`, `null` when the Worker isn't configured — F7.8;
   * a `null` here means the sweep is skipped, same "grey out, don't crash"
   * posture the rest of the retrieval-adjacent wiring uses).
   */
  sweep(
    units: readonly ExtractedUnit[],
    draftDeps: DraftQuizCardsDeps | null,
  ): Promise<GenerationSweepReport | null>;
}

function listConceptsForCourseFactory(
  vault: VaultSource,
  coursesFolder: string,
): (courseCode: string) => Promise<readonly ConceptRecord[]> {
  return (courseCode) => extractConcepts(vault, { under: `${coursesFolder}/${courseCode}` });
}

export function buildGenerationWiring(deps: GenerationWiringDeps): GenerationWiring {
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const cache = createVaultDraftCacheStore(deps.vault);
  const acceptPort = createDraftAcceptPort({ vault: deps.vault, cache, deviceId: deps.deviceId });
  const listConceptsForCourse = listConceptsForCourseFactory(deps.vault, coursesFolder);

  return {
    cache,
    acceptPort,
    async sweep(units, draftDeps) {
      if (draftDeps === null) return null;
      if (units.length === 0) return null;
      return runGenerationSweep(units, {
        vault: deps.vault,
        cache,
        draftDeps,
        listConceptsForCourse,
        coursesFolder,
      });
    },
  };
}
