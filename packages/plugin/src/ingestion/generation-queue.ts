/**
 * `generation-queue.ts` — D-238/F3.3's client ingestion-queue generation
 * policy: on a concept's material arrival, enqueue ONE generation call of
 * the *primary* kind; a further call only on a named trigger; never at
 * session time; every call through the ingestion queue, which drains only
 * while Obsidian is open (`ol-egov.127` [D-238 / GEN-3], `ol-2zfj.63`
 * [GEN-3.1]).
 *
 * **A deliberate, documented mirror of `packages/core/src/generation/`.**
 * The canonical, fully-tested decision logic (`primaryKindFor`,
 * `evaluateGenerationTriggers`, `createGenerationAwareJobRunner`) lives
 * there, in this bead's other owned path. It is NOT re-exported from
 * `olea-core`'s `src/index.ts` — this run's own brief asks every concurrent
 * lane to leave that one shared barrel file alone rather than race edits
 * into it — and `olea-core`'s `package.json` resolves every cross-package
 * import through that single file (`"main"`/`"types"`: `"./src/index.ts"`),
 * so nothing in `packages/plugin` can reach the core module today. This file
 * is the minimal subset of that logic re-declared here, using only what
 * `olea-core` ALREADY exports (`SchedulableInstrumentType`, `JobEnqueuer`,
 * `JobRunner`/`JobRunnerView`/`JobRunOutcome`, `EnqueueInput`/`EnqueueResult`,
 * `hashText`) — so the client can actually run this policy today rather than
 * waiting on a barrel update. **Named follow-up:** once `core/src/index.ts`
 * exports `packages/core/src/generation/`, delete the duplicated pieces here
 * (`isGenerationJobPayload`, `primaryKindFor`,
 * `createGenerationAwareJobRunner`) and import them instead — everything
 * else in this file (the vault-walk/enqueue wiring) has no core equivalent
 * and stays.
 *
 * **Only `'mcq'` has an execution path today.** See
 * `packages/core/src/generation/primary-kind.ts`'s module doc — "no
 * generation task produces Q&A/cloze drafts client-side at all"
 * (`packages/plugin/src/commands/create-card.ts`) — for why
 * `DEFAULT_PRIMARY_KIND_FLOOR` is `'mcq'` rather than F2.14's own listed
 * order.
 */

import {
  type ConceptRecord,
  courseFromPath,
  DEFAULT_COURSES_FOLDER,
  type EnqueueInput,
  type EnqueueResult,
  type ExtractedUnit,
  extractConcepts,
  hashText,
  type JobEnqueuer,
  type JobRunner,
  type JobRunnerView,
  type JobRunOutcome,
  type SchedulableInstrumentType,
  type VaultSource,
} from 'olea-core';

// ---------------------------------------------------------------------------
// Mirrors `packages/core/src/generation/types.ts` — see this file's own doc.
// ---------------------------------------------------------------------------

export type GenerationTriggerKind =
  | 'arrival'
  | 'top-band'
  | 'format-ask'
  | 'deck-served-out-or-lapsed'
  | 'repeated-rejection';

export interface GenerationJobPayload {
  readonly kind: 'generation';
  readonly courseCode: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly instrumentKind: SchedulableInstrumentType;
  readonly trigger: GenerationTriggerKind;
}

/** Narrows `PersistedJob.payload` (`unknown` by contract) to the shape this family understands — mirrors `isExtractionJobPayload`/`isInstrumentRevisionJobPayload`, one payload family over. */
export function isGenerationJobPayload(value: unknown): value is GenerationJobPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === 'generation' &&
    typeof v.courseCode === 'string' &&
    v.courseCode.length > 0 &&
    typeof v.conceptKey === 'string' &&
    v.conceptKey.length > 0 &&
    typeof v.conceptName === 'string' &&
    v.conceptName.length > 0 &&
    typeof v.instrumentKind === 'string' &&
    typeof v.trigger === 'string'
  );
}

// ---------------------------------------------------------------------------
// Mirrors `packages/core/src/generation/primary-kind.ts` — see this file's own doc.
// ---------------------------------------------------------------------------

export const DEFAULT_PRIMARY_KIND_FLOOR: SchedulableInstrumentType = 'mcq';

export interface PrimaryKindInput {
  readonly formatMatch: SchedulableInstrumentType | null;
  readonly recordedPreference: readonly SchedulableInstrumentType[];
}

export function primaryKindFor(input: PrimaryKindInput): SchedulableInstrumentType {
  if (input.formatMatch !== null) return input.formatMatch;
  return input.recordedPreference[0] ?? DEFAULT_PRIMARY_KIND_FLOOR;
}

// ---------------------------------------------------------------------------
// Mirrors `packages/core/src/generation/job.ts` — see this file's own doc.
// ---------------------------------------------------------------------------

export interface GenerationJobKeyInput {
  readonly courseCode: string;
  readonly conceptKey: string;
  readonly instrumentKind: SchedulableInstrumentType;
}

/** D-238's idempotency key: one (course, concept, kind) triple is one call, ever — `IngestionQueueEngine.enqueue`'s own content-hash dedup does the rest, for free. */
export function generationJobIdentityString(input: GenerationJobKeyInput): string {
  return `generation:${input.courseCode}:${input.conceptKey}:${input.instrumentKind}`;
}

export interface BuildGenerationEnqueueInputArgs {
  readonly courseCode: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly instrumentKind: SchedulableInstrumentType;
  readonly trigger: GenerationTriggerKind;
}

export async function buildGenerationEnqueueInput(
  input: BuildGenerationEnqueueInputArgs,
): Promise<EnqueueInput> {
  const contentHash = await hashText(generationJobIdentityString(input));
  const payload: GenerationJobPayload = { kind: 'generation', ...input };
  return {
    contentHash,
    label: `${input.courseCode} · ${input.conceptName} · ${input.instrumentKind}`,
    payload,
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
  input: {
    readonly courseCode: string;
    readonly conceptKey: string;
    readonly conceptName: string;
    readonly trigger: GenerationTriggerKind;
    readonly instrumentKind: SchedulableInstrumentType;
  },
): Promise<EnqueueResult> {
  return enqueueGenerationJob(enqueuer, input);
}

// ---------------------------------------------------------------------------
// Mirrors `packages/core/src/generation/job-runner.ts` — see this file's own doc.
// ---------------------------------------------------------------------------

export interface GenerationAwareJobRunnerDeps {
  /** Services one drained generation job. Never called for a non-generation payload. */
  readonly draft: (job: JobRunnerView) => Promise<JobRunOutcome>;
  /** Whatever runner a host already has for every other payload kind (`createExtractionJobRunner`, optionally already wrapped by `createRevisionAwareJobRunner`). */
  readonly fallback: JobRunner;
}

/** The `'generation'` job-kind consumer — mirrors `createRevisionAwareJobRunner`'s dispatch/fallback shape one payload family over (`revision-job-runner.ts`'s own module doc). */
export function createGenerationAwareJobRunner(deps: GenerationAwareJobRunnerDeps): JobRunner {
  return async (job) => {
    if (isGenerationJobPayload(job.payload)) return deps.draft(job);
    return deps.fallback(job);
  };
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
