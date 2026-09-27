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
 *
 * **`sweep`'s `formatMatch` parameter (`ol-v7r5.37`, F4.8/`[D-188]`), taken
 * at call time for the identical reason `routing` above is.** `pipeline.ts`'s
 * own `GenerationPipelineDeps.formatMatch` doc names `main.ts` as the
 * composition root for this ("assembling this from her actual assignments
 * table plus classified past-paper/instructor material"), and `main.ts`'s
 * only path into `runGenerationSweep`'s deps is this `sweep` call — so
 * without threading it through here, `generation/format-match.ts`'s
 * `buildFormatMatch` producer has no way to reach production regardless of
 * what `main.ts` composes. Omitted or `undefined` preserves the pre-
 * `ol-v7r5.37` behaviour exactly, the same as `routing` above.
 */

import type {
  ConceptRecord,
  ExtractedUnit,
  SchedulableInstrumentType,
  VaultSource,
} from 'olea-core';
import { DEFAULT_COURSES_FOLDER, hashText } from 'olea-core';
import { extractConceptsFromVault } from '../concept/wiring.js';
import type { DraftQuizCardsDeps } from '../retrieval/draft-quiz-cards.js';
import type { DraftAcceptPort } from './accept.js';
import { createDraftAcceptPort } from './accept.js';
import { createVaultDraftCacheStore, type DraftCacheStore } from './cache-store.js';
import type { FormatMatchDecision } from './pipeline.js';
import { type GenerationSweepReport, runGenerationSweep } from './pipeline.js';
import type { GenerationRoutingDeps } from './routing.js';
import type { DraftRecord } from './types.js';

export interface GenerationWiringDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly coursesFolder?: string;
  /**
   * `ol-3ux7.64.9` [WBX-8]: threaded straight into {@link createDraftAcceptPort}
   * and every {@link runGenerationSweep} call, so the plugin's one clock seam
   * (`main.ts`'s `this.now`) reaches this module too — omitted defaults to
   * each of those two functions' own `deps.now ?? (() => new Date())`,
   * unchanged from before this bead.
   */
  readonly now?: () => Date;
}

export interface GenerationWiring {
  readonly cache: DraftCacheStore;
  readonly acceptPort: DraftAcceptPort;
  /**
   * `GenerationArrivalDeps.sourceContentHashFor`'s real, local-state-only
   * implementation (`ol-egov.141.89.5.25`, D-381) — `packages/plugin/src
   * /ingestion/generation-queue.ts`'s own doc named this the disclosed gap
   * `ol-egov.141.89.5.24` left open ("composing the real lookup... is a
   * named follow-up"). Resolves `conceptKey` through this same wiring's own
   * `listConceptsForCourse` (a real vault walk, `[D-357]`'s stamped
   * permanent key — the identical derivation `buildGenerationArrivalDeps`'s
   * own default uses, so a caller composing both from the same `vault`
   * agrees on the key) and hashes `sourcePaths[0]`'s CURRENT content with
   * `hashText` — the same algorithm `cache-store.ts`'s own
   * `sourceContentHash` field and `generation-job-runner.ts`'s
   * `runGenerationDraftJob` already use for this exact "concept's current
   * source digest" shape. A vault read, never a network call. `undefined`
   * when the concept or its source cannot be resolved at call time (renamed,
   * removed, or no matching key) — absent, never thrown, matching every
   * other optional `GenerationArrivalDeps` lookup's own failure posture.
   */
  readonly sourceContentHashFor: (
    courseCode: string,
    conceptKey: string,
  ) => Promise<string | undefined>;
  /**
   * Builds `GenerationArrivalDeps.promptVersionFor`'s real, local-state-only
   * implementation (`ol-egov.141.89.5.25`, D-385) — returns a Promise
   * because the source of truth (the draft cache's stamped
   * `DraftRecord.provenance.promptVersion`, D7.3) only answers async (a
   * vault read via `cache.list()`), while `promptVersionFor` itself is
   * declared synchronous (`generation-queue.ts`). A caller `await`s this
   * ONCE per arrival sweep (one `cache.list()`, matching `hasAnyBuiltKind`'s
   * own disclosed per-sweep cost, not once per candidate concept) and hands
   * the resolved closure to `GenerationArrivalDeps.promptVersionFor`
   * directly. Never a network probe — see that field's own doc ("a version
   * bump becomes visible only once some later draft response stamps a new
   * value, not by asking the service what today's version is").
   */
  buildPromptVersionFor(): Promise<
    (instrumentKind: SchedulableInstrumentType) => string | undefined
  >;
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
    formatMatch?: (courseCode: string) => FormatMatchDecision | undefined,
  ): Promise<GenerationSweepReport | null>;
}

function listConceptsForCourseFactory(
  vault: VaultSource,
  coursesFolder: string,
): (courseCode: string) => Promise<readonly ConceptRecord[]> {
  return (courseCode) =>
    extractConceptsFromVault(vault, { under: `${coursesFolder}/${courseCode}` });
}

/** `GenerationWiring.sourceContentHashFor`'s implementation — see that field's own doc. */
function createSourceContentHashFor(
  vault: VaultSource,
  listConceptsForCourse: (courseCode: string) => Promise<readonly ConceptRecord[]>,
): (courseCode: string, conceptKey: string) => Promise<string | undefined> {
  return async (courseCode, conceptKey) => {
    let concepts: readonly ConceptRecord[];
    try {
      concepts = await listConceptsForCourse(courseCode);
    } catch {
      return undefined;
    }
    const concept = concepts.find((c) => c.key === conceptKey);
    const sourcePath = concept?.sourcePaths[0];
    if (sourcePath === undefined) return undefined;
    try {
      if (!(await vault.exists(sourcePath))) return undefined;
      return await hashText(await vault.read(sourcePath));
    } catch {
      return undefined;
    }
  };
}

/**
 * `GenerationWiring.buildPromptVersionFor`'s implementation — snapshots
 * `cache.list()` once and answers, per `instrumentKind`, the most recently
 * CREATED matching `DraftRecord`'s `provenance.promptVersion` ("the version
 * last seen stamped," `GenerationArrivalDeps.promptVersionFor`'s own doc) —
 * never the most recently resolved one, so a rejected-but-newer draft still
 * counts (a reject reflects on the drafted CONTENT, not on which prompt
 * version produced it). `record.instrumentType` is matched directly:
 * `undefined` reads as `'mcq'` (`types.ts`'s own documented default, every
 * draft cached before that field existed). `undefined` when no cached draft
 * of that kind exists yet.
 */
async function createPromptVersionFor(
  cache: DraftCacheStore,
): Promise<(instrumentKind: SchedulableInstrumentType) => string | undefined> {
  const records = await cache.list();
  const latestByKind = new Map<string, DraftRecord>();
  for (const record of records) {
    const kind = record.instrumentType ?? 'mcq';
    const existing = latestByKind.get(kind);
    if (existing === undefined || record.createdAt > existing.createdAt) {
      latestByKind.set(kind, record);
    }
  }
  return (instrumentKind) => latestByKind.get(instrumentKind)?.provenance.promptVersion;
}

export function buildGenerationWiring(deps: GenerationWiringDeps): GenerationWiring {
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const cache = createVaultDraftCacheStore(deps.vault);
  const acceptPort = createDraftAcceptPort({
    vault: deps.vault,
    cache,
    deviceId: deps.deviceId,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
  const listConceptsForCourse = listConceptsForCourseFactory(deps.vault, coursesFolder);

  return {
    cache,
    acceptPort,
    sourceContentHashFor: createSourceContentHashFor(deps.vault, listConceptsForCourse),
    buildPromptVersionFor: () => createPromptVersionFor(cache),
    async sweep(units, draftDeps, routing, formatMatch) {
      if (draftDeps === null) return null;
      if (units.length === 0) return null;
      return runGenerationSweep(units, {
        vault: deps.vault,
        cache,
        draftDeps,
        listConceptsForCourse,
        coursesFolder,
        ...(routing !== undefined ? { routing } : {}),
        ...(formatMatch !== undefined ? { formatMatch } : {}),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      });
    },
  };
}
