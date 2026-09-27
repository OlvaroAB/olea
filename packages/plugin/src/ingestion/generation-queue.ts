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
  type GenerationJobKeyInput,
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
 * `buildGenerationEnqueueInput`'s input: `BuildGenerationJobPayloadInput`
 * plus the same two optional version terms `GenerationJobKeyInput`
 * (`job.ts`, `olea-core`) already declares — `sourceContentHash` and
 * `promptVersion` (D-381/D-385, `ol-egov.141.89.5.24`). Both omitted (every
 * caller before this bead): behaviour is byte-identical to before these
 * fields existed.
 */
export type BuildGenerationEnqueueInputArgs = BuildGenerationJobPayloadInput &
  Pick<GenerationJobKeyInput, 'sourceContentHash' | 'promptVersion'>;

/**
 * Builds a generation call's `EnqueueInput`: `olea-core`'s
 * `generationJobContentHash` supplies D-238's idempotency key
 * (`IngestionQueueEngine.enqueue`'s own content-hash dedup does the rest,
 * for free) and `buildGenerationJobPayload` supplies the payload — this
 * function's own job is only the `EnqueueInput` wrapper (the label) neither
 * core function has a reason to know about.
 *
 * **D-381/D-385 (`ol-egov.141.89.5.24`): `contentHash` and `sourceUnitId`
 * are deliberately derived from two DIFFERENT identity strings now.**
 * `contentHash` hashes the FULL identity — `sourceContentHash`/
 * `promptVersion` folded in when the caller supplies them (`job.ts`'s own
 * module doc) — so a source or prompt-version bump produces a genuinely
 * different hash, and `IngestionQueueEngine.enqueue`'s existing content-hash
 * dedup naturally treats a bumped call as new rather than a duplicate.
 * `sourceUnitId` stays the version-BLIND (course, concept, kind) triple
 * (see the comment below for why the triple, not a coarser id): were
 * `sourceUnitId` to fold the version terms in too, a version bump would
 * change BOTH values together and the engine's supersede check (`engine.ts`,
 * "same `sourceUnitId`, different `contentHash`") would never see a match —
 * it would treat the new call as an entirely unrelated unit instead of a
 * newer revision of the same one, and the stale, still-pending job for the
 * old version would never be retired. Neither `buildGenerationJobPayload`
 * nor the returned `payload` sees these two fields — they exist only to
 * shape the identity, never to become persisted job state (`job.ts`'s own
 * `GenerationJobKeyInput` doc: "not folded into `PersistedJob`").
 */
export async function buildGenerationEnqueueInput(
  input: BuildGenerationEnqueueInputArgs,
): Promise<EnqueueInput> {
  const {
    courseCode,
    conceptKey,
    conceptName,
    instrumentKind,
    trigger,
    sourceContentHash,
    promptVersion,
  } = input;
  const contentHash = await generationJobContentHash({
    courseCode,
    conceptKey,
    instrumentKind,
    // `exactOptionalPropertyTypes`: omit the key entirely rather than set it
    // to `undefined` — matches `pipeline.ts:614`'s own convention for this
    // exact optional-field shape.
    ...(sourceContentHash !== undefined ? { sourceContentHash } : {}),
    ...(promptVersion !== undefined ? { promptVersion } : {}),
  });
  const payload = buildGenerationJobPayload({
    courseCode,
    conceptKey,
    conceptName,
    instrumentKind,
    trigger,
  });
  return {
    contentHash,
    label: `${courseCode} · ${conceptName} · ${instrumentKind}`,
    payload,
    // The source unit for a generation call is its own (course, concept,
    // kind) identity — `generationJobIdentityString`, called here WITHOUT
    // the version terms (see the module doc above for why that split
    // matters now that a caller can supply them). Deliberately the FULL
    // triple, including `instrumentKind`: a coarser id (course+concept
    // alone) would make a second call for a DIFFERENT kind on the same
    // concept — a normal, wanted thing under D-238's "further calls add
    // kinds, they never replace the primary one" — wrongly retire a
    // still-pending call for the first kind.
    sourceUnitId: generationJobIdentityString({ courseCode, conceptKey, instrumentKind }),
  };
}

/** `enqueuer` is anything structurally satisfying `JobEnqueuer` — `IngestionQueueEngine` itself in production, the same duck-typed dependency `arrival-watch.ts` already takes. */
export async function enqueueGenerationJob(
  enqueuer: JobEnqueuer,
  input: BuildGenerationEnqueueInputArgs,
): Promise<EnqueueResult> {
  const enqueueInput = await buildGenerationEnqueueInput(input);
  return enqueuer.enqueue(enqueueInput);
}

/** A trigger already decided elsewhere (e.g. `evaluateGenerationTriggers` once reachable) — enqueues the further call it names. */
export function enqueueTriggeredGenerationCall(
  enqueuer: JobEnqueuer,
  input: BuildGenerationEnqueueInputArgs,
): Promise<EnqueueResult> {
  return enqueueGenerationJob(enqueuer, input);
}

// ---------------------------------------------------------------------------
// The arrival wiring — no core equivalent; this is the vault-walk glue that
// turns "material landed" into "one primary-kind call enqueued per new
// concept," the client-side half of F3.3's "generate instruments
// automatically when material lands."
// ---------------------------------------------------------------------------

/**
 * Every distinct course code among `units` — the note or source path each
 * landed unit resolves to, read the same way `pipeline.ts`'s
 * `embeddingNotePaths`/`standaloneSourcePaths` do. Exported so
 * `further-generation-triggers.ts` (GEN-3.5, `ol-2zfj.136`) can scope its
 * own further-call trigger sweep to the same courses this file's own
 * primary-call sweep just touched, rather than re-deriving the same read a
 * second way.
 */
export function courseCodesForLandedUnits(
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
   * `${coursesFolder}/${courseCode}`, stampConceptKeys: true})` (`[D-357]`:
   * the permanent key, keyed vault-wide) — the same injection seam
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
  /**
   * D-381 (`ol-egov.141.89.5.24`): the concept's current source digest —
   * the same `sourceContentHash` shape the draft cache already keys on
   * (`hashText` of the concept's embedding-note/source content,
   * `cache-store.ts`, outside this bead's owned paths) — read from
   * whatever the caller already has in hand, never a fresh vault re-read
   * this function triggers itself. Absent (every current production
   * wiring — composing the real lookup is a named follow-up, same posture
   * `hasAnyBuiltKind`'s own doc discloses): no source term is folded into
   * the enqueued call's identity, byte-identical to before this option
   * existed.
   */
  readonly sourceContentHashFor?: (
    courseCode: string,
    conceptKey: string,
  ) => string | undefined | Promise<string | undefined>;
  /**
   * D-385 (`ol-egov.141.89.5.24`, Class B): the prompt version the given
   * kind's generation task was last seen stamped with — read from local
   * state only (e.g. the most recent `DraftRecord.provenance.promptVersion`
   * this device has already cached for that task, `generation/types.ts`),
   * **never a network probe this check triggers**: a version bump becomes
   * visible only once some later draft response stamps a new value, not by
   * asking the service what today's version is. Absent (every current
   * production wiring — composing the real lookup from the draft cache is
   * a named follow-up, outside this bead's owned paths): no version term is
   * folded in, unchanged behaviour.
   */
  readonly promptVersionFor?: (instrumentKind: SchedulableInstrumentType) => string | undefined;
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
    // D-385: resolved once per course/kind, from local state only — never a
    // network call this arrival sweep triggers (see `promptVersionFor`'s
    // own doc).
    const promptVersion = deps.promptVersionFor?.(instrumentKind);

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
        const sourceContentHash = await deps.sourceContentHashFor?.(courseCode, concept.key);
        await enqueueGenerationJob(deps.enqueuer, {
          courseCode,
          conceptKey: concept.key,
          conceptName: concept.name,
          instrumentKind,
          trigger: 'arrival',
          // `exactOptionalPropertyTypes`: same conditional-spread convention
          // as `buildGenerationEnqueueInput` above.
          ...(sourceContentHash !== undefined ? { sourceContentHash } : {}),
          ...(promptVersion !== undefined ? { promptVersion } : {}),
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
      ((courseCode) =>
        // `[D-357]`: the permanent concept key, keyed vault-wide even for this one-course walk
        // (`extractConcepts`' rule for a stamped subtree pass) — the same key the draft runner
        // finds the job's concept by, and the key every other reader holds.
        extractConcepts(vault, {
          under: `${coursesFolder}/${courseCode}`,
          stampConceptKeys: true,
        })),
  };
}
