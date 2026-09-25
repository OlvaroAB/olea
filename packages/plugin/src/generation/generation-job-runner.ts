/**
 * `runGenerationDraftJob` / `createGenerationDraftRunner` — GEN-3.4's real
 * `deps.generation.draft` implementation (`ol-2zfj.135`, `[D-238]`), the
 * production caller `ol-2zfj.63` [GEN-3.1]'s own close evidence named as
 * outstanding: `createGenerationAwareJobRunner` (`packages/core/src
 * /generation/job-runner.ts`) already dispatches a drained `'generation'`
 * job to whatever `deps.draft` a host supplies — nothing did, until this
 * file. `hasBuiltAnyKindForConcept` / `createHasAnyBuiltKind` below are the
 * matching `GenerationArrivalDeps.hasAnyBuiltKind` implementation
 * (`packages/plugin/src/ingestion/generation-queue.ts`'s own doc named this
 * the identical gap on the arrival-dedup half).
 *
 * ## Shape, mirroring `revision-job-runner.ts` one payload family over
 *
 * `packages/core/src/generation/job-runner.ts`'s own doc: "this module
 * decides WHETHER a drained job is a generation call; it never decides HOW
 * to service one." `createGenerationDraftRunner` is that HOW — the same
 * split `createRevisionAwareJobRunner` draws for `'instrument-revision'`
 * jobs, one payload family over. `runGenerationDraftJob` is exported
 * directly too, so a test can exercise the drafting logic without going
 * through `JobRunnerView` plumbing.
 *
 * ## Only `'mcq'` has an execution path (component register row 2.1)
 *
 * `packages/core/src/generation/primary-kind.ts`'s own doc: "no generation
 * task produces Q&A/cloze drafts client-side at all." A `'qa'`/`'cloze'`
 * payload — `primaryKindFor`'s own floor is `'mcq'`, so this should be rare,
 * but F2.14's recorded preference can still name either — returns an
 * honest, classified, NON-retryable failure rather than guessing or
 * crashing. Retrying would not help: no code path exists to service it yet.
 *
 * ## Resolving a note to draft into, absent an `ExtractedUnit`
 *
 * `pipeline.ts`'s sweep resolves `DraftRecord.sourcePath` from the
 * `ExtractedUnit`s a fresh ingestion tick just produced (an embedding note,
 * or a lazily-created home note for a bare drop — `[D-179]`). A drained
 * `'generation'` job carries none of that: `GenerationJobPayload` is only
 * `{courseCode, conceptKey, conceptName, instrumentKind, trigger}`
 * (`packages/core/src/generation/types.ts`) — deliberately thin, since the
 * job may drain long after the arrival event that enqueued it. This module
 * re-derives the concept's own note the same way `enqueuePrimaryGenerationCallsForLandedUnits`
 * derived `conceptKey` in the first place: a fresh `listConceptsForCourse`
 * call, matched by `key`, reading `ConceptRecord.sourcePaths[0]` — a note
 * that, by `ConceptRecord`'s own construction, already exists and already
 * names this concept (her `topic:` note, or the bound Zettelkasten note for
 * a tier-3 mint), so no `ensureHomeNoteForConcept` complexity is needed
 * here the way `pipeline.ts` needs it for a raw, note-less document drop.
 *
 * **`listConceptsForCourse`'s default stamps the permanent concept key
 * (`[D-357]`), exactly as `generation-queue.ts`'s `buildGenerationArrivalDeps`
 * default does.** The job's `conceptKey` was minted by whichever
 * `listConceptsForCourse` the arrival glue used — under `main.ts`'s current
 * composition (no `deps.generation.listConceptsForCourse` override, GEN-3.4's
 * own scope), that is `buildGenerationArrivalDeps`'s default — so both sides
 * must derive the key the same way or the draft-time lookup never finds
 * `payload.conceptKey`, a silent, permanent non-retryable failure for every
 * job. Before `[D-357]` both sides used the content-derived stand-in key for
 * that reason; both now read the `.olea/concepts/` sidecar, and a stamped
 * one-course walk keys each concept by its vault-wide identity
 * (`extractConcepts`' rule for a stamped subtree pass), so the key here is
 * also the key her review log, Today and the registry carry. A permanent key
 * survives a bound note's rename (`olea-uid`) and a topic re-wording
 * (`[D-180]`'s rename signature); a concept that genuinely left the course
 * between arrival and drain still fails this lookup honestly (see below)
 * rather than drafting into the wrong note.
 *
 * ## Composition (`packages/plugin/src/main.ts`, outside this file's `owns`
 * only in the sense that the call site lives there — GEN-3.4's own scope)
 *
 * ```ts
 * generation: {
 *   draft: createGenerationDraftRunner({
 *     vault,
 *     cache: generationWiring.cache,   // the SAME cache the F3.3 sweep fills
 *     draftDeps: () => this.draftQuizCardsDeps(),
 *   }),
 *   hasAnyBuiltKind: createHasAnyBuiltKind(generationWiring.cache),
 * },
 * ```
 */

import {
  type ConceptRecord,
  DEFAULT_COURSES_FOLDER,
  extractConcepts,
  type GenerationJobPayload,
  hashText,
  isGenerationJobPayload,
  type JobRunnerView,
  type JobRunOutcome,
  type VaultSource,
} from 'olea-core';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../retrieval/draft-quiz-cards.js';
import { draftQuizCardsForConcept } from '../retrieval/draft-quiz-cards.js';
import type { DraftCacheStore } from './cache-store.js';
import { deriveDraftId } from './cache-store.js';
import { extractDraftedProvenance, extractDraftedQuestions } from './response.js';
import type { DraftRecord } from './types.js';

/** `instrumentKind`s this runner can actually service today — see this module's doc / component register row 2.1. */
const SUPPORTED_INSTRUMENT_KINDS: ReadonlySet<string> = new Set(['mcq']);

export interface GenerationDraftJobDeps {
  readonly vault: VaultSource;
  readonly cache: DraftCacheStore;
  /**
   * Read fresh on every drained job, not captured at construction — the same
   * F7.8 posture `RevisionJobRunnerDeps.draftDeps` already documents. `null`
   * defers the job (`retryable: true`) rather than failing it: the Worker
   * being unconfigured right now is a transient session fact, not a
   * permanent property of the job.
   */
  readonly draftDeps: () => DraftQuizCardsDeps | null;
  /**
   * Defaults to a stamped `extractConcepts` scoped to the job's course — the
   * arrival glue's own derivation (see this module's doc). Injected so tests
   * never need a real vault walk.
   */
  readonly listConceptsForCourse?: (courseCode: string) => Promise<readonly ConceptRecord[]>;
  /** Injected so tests can fake grounded/refused outcomes without a real Worker — same seam `pipeline.ts`'s/`revision-job-runner.ts`'s `draftForConcept` uses. Defaults to the real `draftQuizCardsForConcept`. */
  readonly draftForConcept?: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>;
  /** Defaults to `deriveDraftId` (deterministic, `(courseCode, conceptName, sequence)` — `cache-store.ts`). */
  readonly generateDraftId?: (
    courseCode: string,
    conceptName: string,
    sequence: number,
  ) => string | Promise<string>;
  readonly now?: () => Date;
  readonly coursesFolder?: string;
}

function defaultListConceptsForCourse(
  vault: VaultSource,
  coursesFolder: string,
): (courseCode: string) => Promise<readonly ConceptRecord[]> {
  return (courseCode) =>
    extractConcepts(vault, { under: `${coursesFolder}/${courseCode}`, stampConceptKeys: true });
}

/**
 * Drafts one drained `'generation'` job (`payload.instrumentKind === 'mcq'`
 * only — see this module's doc) and caches the result as one or more
 * `pending` `DraftRecord`s, exactly the shape `pipeline.ts`'s sweep already
 * caches, so `BulkReviewView`/the review session's passive-accept path reads
 * either indistinguishably. Never throws — a drafting call's own failure
 * (network, malformed transport response) is caught and reported
 * `retryable: true`, matching `revision-job-runner.ts`'s identical catch.
 */
export async function runGenerationDraftJob(
  deps: GenerationDraftJobDeps,
  payload: GenerationJobPayload,
): Promise<JobRunOutcome> {
  if (!SUPPORTED_INSTRUMENT_KINDS.has(payload.instrumentKind)) {
    // Honest, classified, NON-retryable: component register row 2.1 — no
    // client generation task exists for 'qa'/'cloze' yet, and retrying
    // cannot change that.
    return {
      ok: false,
      retryable: false,
      reason: `generation job: no client generation task exists yet for instrumentKind '${payload.instrumentKind}' (component register row 2.1)`,
    };
  }

  const draftDeps = deps.draftDeps();
  if (draftDeps === null) {
    // F7.8's "grey out, don't crash" posture, same as revision-job-runner.ts.
    return { ok: false, retryable: true };
  }

  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const listConceptsForCourse =
    deps.listConceptsForCourse ?? defaultListConceptsForCourse(deps.vault, coursesFolder);

  let concepts: readonly ConceptRecord[];
  try {
    concepts = await listConceptsForCourse(payload.courseCode);
  } catch {
    // A transient read failure — worth retrying, same posture as a transport throw below.
    return { ok: false, retryable: true };
  }

  const concept = concepts.find((c) => c.key === payload.conceptKey);
  const sourcePath = concept?.sourcePaths[0];
  if (concept === undefined || sourcePath === undefined) {
    // Not found (renamed, or the key derivation moved — see this module's
    // doc on `ConceptRecord.key`'s disclosed instability) or resolved with
    // no note to draft into. Non-retryable: a later drain of the SAME
    // content hash would hit the identical lookup and fail the identical
    // way, so retrying spends queue attempts for no gain. A later ARRIVAL
    // (a fresh sweep, once the concept is extractable again) enqueues a
    // fresh job under its own content hash instead.
    return {
      ok: false,
      retryable: false,
      reason: `generation job: concept ${payload.conceptKey} was not found in course ${payload.courseCode} at drain time, or resolved with no source note`,
    };
  }

  const draftForConcept = deps.draftForConcept ?? draftQuizCardsForConcept;
  let result: DraftQuizCardsResult;
  try {
    result = await draftForConcept(draftDeps, {
      courseCode: payload.courseCode,
      conceptName: payload.conceptName,
    });
  } catch {
    return { ok: false, retryable: true };
  }

  if (result.status === 'refused') {
    // F4.5's grounded-by-construction argument (`pipeline.ts`'s own doc):
    // not an error, nothing to cache. D-238's "one call... ever" for the
    // primary kind means this refusal SPENDS that one call — the job is
    // done, not retried; a further call for this concept only happens on
    // one of the four named triggers, never automatically because the
    // first one refused.
    return { ok: true };
  }

  const questions = extractDraftedQuestions(result.response);
  const provenance = extractDraftedProvenance(result.response);
  if (questions === null || provenance === null || questions.length === 0) {
    // Unparseable or empty — nothing content-bearing to cache. Not an error,
    // same posture `revision-job-runner.ts` takes for the identical case.
    return { ok: true };
  }

  const generateDraftId = deps.generateDraftId ?? deriveDraftId;
  const now = deps.now ?? (() => new Date());
  // `ol-0r92.87`'s stale-input guard, the same snapshot-at-draft-time
  // `pipeline.ts` takes — see that module's own doc.
  const sourceContentHash = (await deps.vault.exists(sourcePath))
    ? await hashText(await deps.vault.read(sourcePath))
    : undefined;

  const createdAt = now().toISOString();
  let sequence = 0;
  for (const question of questions) {
    const record: DraftRecord = {
      draftId: await generateDraftId(payload.courseCode, payload.conceptName, sequence),
      status: 'pending',
      courseCode: payload.courseCode,
      conceptName: payload.conceptName,
      conceptIds: [payload.conceptKey],
      sourcePath,
      ...(sourceContentHash !== undefined ? { sourceContentHash } : {}),
      createdAt,
      question,
      provenance,
      firstServedAt: null,
    };
    await deps.cache.put(record);
    sequence += 1;
  }

  return { ok: true };
}

/**
 * The `IngestionWiringDeps.generation.draft` shape directly
 * (`packages/plugin/src/ingestion/wiring.ts`) — `createGenerationAwareJobRunner`
 * (`olea-core`) already guarantees `job.payload` satisfies
 * `isGenerationJobPayload` before calling this, but the check is repeated
 * here rather than assumed: `deps.draft`'s own type is `(job: JobRunnerView)
 * => Promise<JobRunOutcome>`, `job.payload` is `unknown` by that type's own
 * contract, and a caller that ever wires this function directly (a test, or
 * a future composition root) should get the same honest failure rather than
 * a runtime crash on an unexpected shape.
 */
export function createGenerationDraftRunner(
  deps: GenerationDraftJobDeps,
): (job: JobRunnerView) => Promise<JobRunOutcome> {
  return async (job) => {
    if (!isGenerationJobPayload(job.payload)) {
      return {
        ok: false,
        retryable: false,
        reason: 'generation job: payload was not a recognised GenerationJobPayload',
      };
    }
    return runGenerationDraftJob(deps, job.payload);
  };
}

/**
 * `GenerationArrivalDeps.hasAnyBuiltKind`'s real implementation
 * (`packages/plugin/src/ingestion/generation-queue.ts`'s own doc named this
 * the missing half of the primary-call dedup: "one call of the primary
 * kind," not one per sweep). Reads `cache.list()` — every draft record this
 * device knows about, ANY status — and answers whether one already names
 * this `(courseCode, conceptKey)` pair.
 *
 * **Every status counts, not only `pending`.** D-238's "one call... ever"
 * is about whether a call was already MADE, not whether it was accepted:
 * `cache-store.ts`'s own module doc is explicit that a record is "never
 * deleted" once written, `accepted`/`edited`/`rejected` included, so any
 * status here is proof a primary call already happened for this concept.
 *
 * **Cache-only, not also a vault walk over materialized instruments
 * (this module's own deliverable named both as acceptable).** Every
 * instrument this pipeline itself materializes reaches the vault only via
 * `accept.ts`'s forwarding of a cached `DraftRecord` — so the cache alone
 * already reflects every kind THIS pipeline built. What it does NOT reflect
 * is a kind she hand-authored outside this pipeline (F2.1's manual card
 * creation) for the same concept: `routing.ts`'s `buildConceptInstrumentInventory`
 * exists for exactly that broader "what does she already have" question,
 * but is not composed into arrival-time dedup anywhere in `main.ts` today
 * (`deps.routing` stays opt-in and unwired — `pipeline.ts`'s own module
 * doc), and wiring a second, more expensive vault walk into every arrival
 * dedup check is outside this bead's scope. The disclosed consequence is
 * bounded and cheap: a concept she already built a hand-authored kind for
 * gets one redundant primary-kind draft — a spent generation call, at most
 * once, never a duplicate materialized instrument (F3.3's own review step
 * still requires her accept). Named as a follow-up rather than built here.
 *
 * **Cost, disclosed rather than hidden.** `cache.list()` reads every
 * per-record file under `.olea/drafts/` — O(existing drafts) per call, and
 * this is called once per candidate concept in
 * `enqueuePrimaryGenerationCallsForLandedUnits`'s loop, so a large draft
 * cache makes a big arrival batch more expensive than a cache-aware index
 * lookup would. `generation-queue.ts`'s own module doc already accepts this
 * trade for a caller that "always returns false" (an unconditional
 * re-enqueue, backstopped by the engine's own content-hash dedup); this
 * implementation is strictly cheaper than that unconditional baseline while
 * staying correctness-conservative, not a performance-optimized index.
 */
export async function hasBuiltAnyKindForConcept(
  cache: DraftCacheStore,
  courseCode: string,
  conceptKey: string,
): Promise<boolean> {
  const records = await cache.list();
  return records.some(
    (record) => record.courseCode === courseCode && record.conceptIds.includes(conceptKey),
  );
}

/** `GenerationArrivalDeps.hasAnyBuiltKind`'s shape directly. */
export function createHasAnyBuiltKind(
  cache: DraftCacheStore,
): (courseCode: string, conceptKey: string) => Promise<boolean> {
  return (courseCode, conceptKey) => hasBuiltAnyKindForConcept(cache, courseCode, conceptKey);
}
