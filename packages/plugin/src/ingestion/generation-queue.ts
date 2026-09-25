/**
 * `generation-queue.ts` — D-238/F3.3's client ingestion-queue generation
 * policy: on a concept's material arrival, enqueue ONE generation call of
 * the *primary* kind; a further call only on a named trigger; never at
 * session time; every call through the ingestion queue, which drains only
 * while Obsidian is open (`ol-egov.127` [D-238 / GEN-3], `ol-2zfj.63`
 * [GEN-3.1]).
 *
 * The canonical, fully-tested decision logic (`isGenerationJobPayload`,
 * `primaryKindFor`, `generationJobIdentityString`, `buildGenerationJobPayload`,
 * `createGenerationAwareJobRunner`) lives in `packages/core/src/generation/`
 * and is imported from `olea-core`'s barrel — re-exported here unchanged so
 * every existing caller of this module keeps working (`ol-2zfj.137`
 * [GEN-3.6] deleted the mirror this file used to carry while the barrel was
 * locked to concurrent lanes; see `packages/core/src/index.ts`'s own
 * `generation/` export block for the history). Everything below this file's
 * imports is the vault-walk/enqueue glue — `courseCodesForLandedUnits`,
 * `enqueuePrimaryGenerationCallsForLandedUnits`, `buildGenerationArrivalDeps`
 * — which has no core equivalent and stays here.
 *
 * **Only `'mcq'` has an execution path today.** See
 * `packages/core/src/generation/primary-kind.ts`'s module doc — "no
 * generation task produces Q&A/cloze drafts client-side at all"
 * (`packages/plugin/src/commands/create-card.ts`) — for why
 * `DEFAULT_PRIMARY_KIND_FLOOR` is `'mcq'` rather than F2.14's own listed
 * order.
 */

import {
  type BuildGenerationJobPayloadInput,
  buildGenerationJobPayload,
  type ConceptRecord,
  courseFromPath,
  createGenerationAwareJobRunner,
  DEFAULT_COURSES_FOLDER,
  DEFAULT_PRIMARY_KIND_FLOOR,
  type EnqueueInput,
  type EnqueueResult,
  type ExtractedUnit,
  extractConcepts,
  generationJobContentHash,
  generationJobIdentityString,
  isGenerationJobPayload,
  type JobEnqueuer,
  primaryKindFor,
  type SchedulableInstrumentType,
  type VaultSource,
} from 'olea-core';

// Re-exported unchanged so every existing caller (this module's own tests,
// `ingestion/wiring.ts`) keeps importing them from here rather than needing
// to know they now live in `olea-core`.
export {
  createGenerationAwareJobRunner,
  DEFAULT_PRIMARY_KIND_FLOOR,
  generationJobIdentityString,
  isGenerationJobPayload,
  primaryKindFor,
};

/**
 * Builds a generation call's `EnqueueInput`: `olea-core`'s
 * `generationJobContentHash` supplies D-238's idempotency key
 * (`IngestionQueueEngine.enqueue`'s own content-hash dedup does the rest,
 * for free) and `buildGenerationJobPayload` supplies the payload — this
 * function's own job is only the `EnqueueInput` wrapper (the label) neither
 * core function has a reason to know about.
 */
export async function buildGenerationEnqueueInput(
  input: BuildGenerationJobPayloadInput,
): Promise<EnqueueInput> {
  const contentHash = await generationJobContentHash(input);
  const payload = buildGenerationJobPayload(input);
  return {
    contentHash,
    label: `${input.courseCode} · ${input.conceptName} · ${input.instrumentKind}`,
    payload,
  };
}

/** `enqueuer` is anything structurally satisfying `JobEnqueuer` — `IngestionQueueEngine` itself in production, the same duck-typed dependency `arrival-watch.ts` already takes. */
export async function enqueueGenerationJob(
  enqueuer: JobEnqueuer,
  input: BuildGenerationJobPayloadInput,
): Promise<EnqueueResult> {
  const enqueueInput = await buildGenerationEnqueueInput(input);
  return enqueuer.enqueue(enqueueInput);
}

/** A trigger already decided elsewhere (e.g. `evaluateGenerationTriggers` once reachable) — enqueues the further call it names. */
export function enqueueTriggeredGenerationCall(
  enqueuer: JobEnqueuer,
  input: BuildGenerationJobPayloadInput,
): Promise<EnqueueResult> {
  return enqueueGenerationJob(enqueuer, input);
}

// ---------------------------------------------------------------------------
// The arrival wiring — no core equivalent; this is the vault-walk glue that
// turns "material landed" into "one primary-kind call enqueued per new
// concept," the client-side half of F3.3's "generate instruments
// automatically when material lands."
// ---------------------------------------------------------------------------

/** Every distinct course code among `units` — the note or source path each landed unit resolves to, read the same way `pipeline.ts`'s `embeddingNotePaths`/`standaloneSourcePaths` do. */
function courseCodesForLandedUnits(
  units: readonly ExtractedUnit[],
  coursesFolder: string,
): readonly string[] {
  const codes = new Set<string>();
  for (const unit of units) {
    const path = unit.provenance.embeddedIn?.notePath ?? unit.provenance.sourcePath;
    const course = courseFromPath(path, coursesFolder);
    if (course !== undefined) codes.add(course);
  }
  return [...codes].sort();
}

export interface GenerationArrivalDeps {
  readonly enqueuer: JobEnqueuer;
  readonly coursesFolder?: string;
  /**
   * Normally `(courseCode) => extractConcepts(vault, {under:
   * `${coursesFolder}/${courseCode}`})` — the same injection seam
   * `generation/pipeline.ts`'s `GenerationPipelineDeps.listConceptsForCourse`
   * already uses, for the identical reason (`pipeline.spec.ts` never builds
   * a real vault). `buildGenerationArrivalDeps` below composes the real one.
   */
  readonly listConceptsForCourse: (courseCode: string) => Promise<readonly ConceptRecord[]>;
  /**
   * Whether this (course, concept) already has ANY generation call queued or
   * drafted — the primary-call dedup ("one call of the primary kind," not
   * one per sweep). **No production implementation is wired yet**: the
   * natural real answer reads `DraftCacheStore` (`packages/plugin/src
   * /generation/cache-store.ts`, outside this bead's owned paths) or the
   * engine's own queued-job list, and composing that is this bead's named
   * follow-up (close evidence). A caller that always returns `false` gets
   * D-238's coverage guarantee (nothing is skipped) at the cost of
   * re-enqueuing an already-serviced concept — safe, because the engine's
   * own content-hash dedup (`enqueueGenerationJob`) still treats a repeat as
   * a no-op, just not free of a wasted vault read.
   */
  readonly hasAnyBuiltKind: (courseCode: string, conceptKey: string) => Promise<boolean>;
  /** F4.8, opt-in — absent means "no known format," same posture `pipeline.ts`'s `deps.formatMatch` takes. */
  readonly formatMatchFor?: (courseCode: string) => SchedulableInstrumentType | undefined;
  /** F2.14's observed order (D7.1), opt-in — absent means nothing has been observed yet. */
  readonly recordedPreferenceFor?: (courseCode: string) => readonly SchedulableInstrumentType[];
}

/**
 * The F3.3 arrival trigger's primary-call half: for every course among
 * `units`, decides the primary kind once (F4.8 else F2.14) and enqueues it
 * for every concept that course lists which does not already have a built
 * kind. Never throws — a read/enqueue failure for one concept is logged and
 * skipped, matching every other `vault.watch`-adjacent handler in this
 * plugin (`arrival-watch.ts`'s own posture).
 */
export async function enqueuePrimaryGenerationCallsForLandedUnits(
  units: readonly ExtractedUnit[],
  deps: GenerationArrivalDeps,
): Promise<void> {
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const courseCodes = courseCodesForLandedUnits(units, coursesFolder);

  for (const courseCode of courseCodes) {
    const formatMatch = deps.formatMatchFor?.(courseCode) ?? null;
    const recordedPreference = deps.recordedPreferenceFor?.(courseCode) ?? [];
    const instrumentKind = primaryKindFor({ formatMatch, recordedPreference });

    let concepts: readonly ConceptRecord[];
    try {
      concepts = await deps.listConceptsForCourse(courseCode);
    } catch (error) {
      console.error('Olea: could not list concepts for a generation-queue arrival check', error);
      continue;
    }

    for (const concept of concepts) {
      if (!concept.courses.includes(courseCode)) continue;
      try {
        if (await deps.hasAnyBuiltKind(courseCode, concept.key)) continue;
        await enqueueGenerationJob(deps.enqueuer, {
          courseCode,
          conceptKey: concept.key,
          conceptName: concept.name,
          instrumentKind,
          trigger: 'arrival',
        });
      } catch (error) {
        console.error('Olea: could not enqueue a primary generation call', error);
      }
    }
  }
}

/**
 * Composes the real `listConceptsForCourse` from a vault when the caller
 * did not already supply one — the same shape `generation/wiring.ts`'s
 * `listConceptsForCourseFactory` already builds for `pipeline.ts`. A caller
 * that DOES supply `base.listConceptsForCourse` (tests, mainly) keeps it
 * unchanged.
 */
export function buildGenerationArrivalDeps(
  base: Omit<GenerationArrivalDeps, 'listConceptsForCourse'> & {
    readonly listConceptsForCourse?: GenerationArrivalDeps['listConceptsForCourse'];
  },
  vault: VaultSource,
): GenerationArrivalDeps {
  const coursesFolder = base.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  return {
    ...base,
    listConceptsForCourse:
      base.listConceptsForCourse ??
      ((courseCode) => extractConcepts(vault, { under: `${coursesFolder}/${courseCode}` })),
  };
}
