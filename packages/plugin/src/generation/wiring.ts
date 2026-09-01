/**
 * `buildGenerationWiring` — composes the F3.3 automatic generation pipeline
 * for `main.ts` (`ol-p3t07a`): the vault-backed draft cache, the
 * `DraftAcceptPort` the review session calls, and the sweep function the
 * ingestion tick drives.
 *
 * Obsidian-free, the same split every other `wiring.ts` in this package
 * uses — `main.ts` supplies the real `VaultSource`/transport/deviceId; this
 * module and `pipeline.spec.ts` exercise the composition against fakes.
 *
 * **`sweep`'s routing parameter (`ol-tz7v` / `[WIRE-7]`), and why it is
 * accepted here rather than at `buildGenerationWiring` construction time.**
 * Component 2.2's routing consultation needs a `KnowledgeKindClassifierPort`
 * (`concept/wiring.ts`'s `KnowledgeKindWiring.classifier`), and `main.ts`
 * builds that wiring — `this.knowledgeKind` — well after it builds this one:
 * `buildGenerationWiring` runs early in `onload` (before `this.review` even
 * exists, so `this.generation.acceptPort` is ready for it), while
 * `buildKnowledgeKindWiring` is one of the later `await`ed Worker-config
 * reads. Taking the classifier as a construction-time dependency here would
 * force a `null` placeholder at exactly the point it is needed, or would
 * force `buildGenerationWiring` itself later in `onload` for no other
 * reason. Taking it as a `sweep()` call-time parameter instead means the one
 * caller (`onUnitsLanded`, `main.ts`) reads `this.knowledgeKind?.classifier`
 * fresh on every tick — the same "read whatever is current, not a value
 * captured at construction" posture `composeReviewSession` already uses for
 * `this.review.plan` and the draft cache.
 */

import type { ConceptRecord, ExtractedUnit, VaultSource } from 'olea-core';
import { DEFAULT_COURSES_FOLDER } from 'olea-core';
import { extractConceptsFromVault } from '../concept/wiring.js';
import type { DraftQuizCardsDeps } from '../retrieval/draft-quiz-cards.js';
import type { DraftAcceptPort } from './accept.js';
import { createDraftAcceptPort } from './accept.js';
import { createVaultDraftCacheStore, type DraftCacheStore } from './cache-store.js';
import { type GenerationSweepReport, runGenerationSweep } from './pipeline.js';
import type { GenerationRoutingDeps } from './routing.js';

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
   *
   * `routing` is component 2.2's consultation (`pipeline.ts`'s module doc) —
   * omitted or `undefined` preserves the pre-`ol-tz7v` unconditional-draft
   * behaviour; a caller opts in by passing `{ classifier }`, where
   * `classifier` is `null` when the Worker isn't configured (F7.8) and
   * routing then degrades to `UNCLASSIFIED_MIX`'s retrieval-baseline-only
   * reading rather than skipping consultation entirely — see `routing.ts`'s
   * module doc for why those are different things.
   */
  sweep(
    units: readonly ExtractedUnit[],
    draftDeps: DraftQuizCardsDeps | null,
    routing?: GenerationRoutingDeps,
  ): Promise<GenerationSweepReport | null>;
}

function listConceptsForCourseFactory(
  vault: VaultSource,
  coursesFolder: string,
): (courseCode: string) => Promise<readonly ConceptRecord[]> {
  return (courseCode) =>
    extractConceptsFromVault(vault, { under: `${coursesFolder}/${courseCode}` });
}

export function buildGenerationWiring(deps: GenerationWiringDeps): GenerationWiring {
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const cache = createVaultDraftCacheStore(deps.vault);
  const acceptPort = createDraftAcceptPort({ vault: deps.vault, cache, deviceId: deps.deviceId });
  const listConceptsForCourse = listConceptsForCourseFactory(deps.vault, coursesFolder);

  return {
    cache,
    acceptPort,
    async sweep(units, draftDeps, routing) {
      if (draftDeps === null) return null;
      if (units.length === 0) return null;
      return runGenerationSweep(units, {
        vault: deps.vault,
        cache,
        draftDeps,
        listConceptsForCourse,
        coursesFolder,
        ...(routing !== undefined ? { routing } : {}),
      });
    },
  };
}
