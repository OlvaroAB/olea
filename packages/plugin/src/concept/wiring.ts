/**
 * `buildConceptWiring` / `readConceptsFromVault` — the plugin-side
 * composition root for the concept-reading stage (EXT-7, `ol-5nle`).
 *
 * Follows exactly the pattern `retrieval/wiring.ts` and `grading/wiring.ts`
 * already establish: load the persisted Worker config, build a real
 * transport when (and only when) it is usable, and hand back `null`
 * otherwise (F7.8 — AI features grey out, never half-work) rather than a
 * caller doomed to fail on its first real request.
 *
 * ===========================================================================
 * REACHABILITY, AND WHY THIS IS THE SAME SHAPE AS `gradeExplainBackAttempt`
 * ===========================================================================
 * `readConceptsFromVault` below is a genuine, non-test call to `readConcepts`
 * — real infrastructure, wired to a real `WorkerConceptReader` when the
 * Worker is configured — and it is what `docs/dev/wiring-register.md` names
 * as `ConceptReaderPort`'s production caller. Nothing calls THIS method yet,
 * and that is the same deliberate gap `grading/wiring.ts`'s module doc
 * records for `gradeExplainBackAttempt`: there is no command, view or
 * schedule in this plugin today that decides WHEN to read her vault for
 * concepts, and building one now would be inventing a trigger this bead was
 * not asked to design. `ol-2zfj.1`'s own reachability note calls this bead
 * "the wiring bead", not the UI bead — a caller answers a different question
 * ("what invokes this, and why now") this file leaves open.
 *
 * ===========================================================================
 * THE BUDGET (`ConceptReadBudget.maxPassages`) — DECLARED, NOT DERIVED
 * ===========================================================================
 * `readConcepts` requires a budget with no default, on purpose: the
 * component register rules a concept-extraction threshold DERIVED once one
 * exists, and a derived constant's derivation stays private while only the
 * number ships. Nobody has run that derivation yet, so the two numbers below
 * are declared placeholders with a stated, plain-English defence rather than
 * a guess dressed as one:
 *
 * - `DEFAULT_MAX_PASSAGES_PER_READ` (60) keeps one full read within the same
 *   rough order of magnitude as an existing Slot G bulk-generation call
 *   (`cards.generate.v1` / `quiz.generate.v1` already send whole documents'
 *   worth of chunks per call) — roughly two to three typical lecture-note
 *   documents' worth of prose blocks, so a first end-to-end read costs
 *   about as much as one existing generation call rather than an
 *   unbounded corpus walk.
 * - `DEFAULT_PASSAGES_PER_CALL` (20) keeps each individual model call to
 *   roughly one document's worth of blocks, which is `[D-082]`'s "several
 *   calls inside one stage" read literally, and keeps any one call's
 *   anchor/alsoIn index range small enough that a client-side accounting
 *   bug (see `workerConceptReader.ts`) surfaces on a small batch rather
 *   than a sprawling one.
 *
 * Neither number is fitted against measured cost, latency or extraction
 * quality — that measurement is real work this bead does not do, and this
 * comment says so rather than implying otherwise. A caller may override both
 * via `ReadConceptOptions.budget`; these are only what `readConceptsFromVault`
 * falls back to when a caller supplies none. Revising them is a Class B
 * threshold tuning (run charter), not a Class C stop.
 */

import {
  type ClassifyKnowledgeKindOptions,
  type ClassifyKnowledgeKindRequest,
  type ClassifyKnowledgeKindResult,
  type ConceptReadBudget,
  type ConceptReaderPort,
  type ConceptReadResult,
  type ConceptRelation,
  type CorpusConcept,
  type CorpusRelationBatchTriggerReason,
  type CorpusRelationVerdictPort,
  classifyKnowledgeKind,
  type KnowledgeKindClassifierPort,
  type Provenance,
  type ReadConcept,
  readConcepts,
  runCorpusRelationBatch,
  shouldRunCorpusRelationBatch,
  type VaultPath,
  type VaultSource,
  type WorkerTaskTransport,
} from 'olea-core';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import { gatherCorpusRelationVaultContext } from './corpusRelationSignals.js';
import type { ObsidianCorpusRelationStateStore } from './corpusRelationStateStore.js';
import { WorkerConceptReader } from './workerConceptReader.js';
import { WorkerCorpusRelationVerdict } from './workerCorpusRelationVerdict.js';
import { WorkerKnowledgeKindClassifier } from './workerKnowledgeKindClassifier.js';

/** See the module doc's "THE BUDGET" section. */
export const DEFAULT_MAX_PASSAGES_PER_READ = 60;
/** See the module doc's "THE BUDGET" section. */
export const DEFAULT_PASSAGES_PER_CALL = 20;

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every other store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface ConceptWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
}

export interface ConceptWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — see the module doc.
   * A caller checks this exactly once, the same shape `main.ts` already uses
   * for `this.retrieval`/`this.grading`.
   */
  readonly conceptReader: ConceptReaderPort | null;
}

export async function buildConceptWiring(deps: ConceptWiringDeps): Promise<ConceptWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { conceptReader: null };

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return { conceptReader: new WorkerConceptReader({ transport }) };
}

export interface ReadConceptsFromVaultOptions {
  readonly under?: VaultPath;
  readonly zettelkastenFolder?: VaultPath;
  readonly coursesFolder?: VaultPath;
  /** Overrides the declared defaults above — see the module doc. */
  readonly budget?: ConceptReadBudget;
}

/**
 * The production caller `ol-5nle` exists to build: reaches `readConcepts`
 * through whatever `ConceptReaderPort` `buildConceptWiring` composed, over
 * the real Worker transport when one is configured. `null` when it is not
 * (F7.8) — the same grey-out contract every other AI-gated surface in this
 * plugin follows, propagated one level up rather than left for a caller to
 * rediscover.
 */
export async function readConceptsFromVault(
  wiring: ConceptWiring,
  vault: VaultSource,
  options: ReadConceptsFromVaultOptions = {},
): Promise<ConceptReadResult | null> {
  if (wiring.conceptReader === null) return null;

  const budget: ConceptReadBudget = options.budget ?? {
    maxPassages: DEFAULT_MAX_PASSAGES_PER_READ,
    passagesPerCall: DEFAULT_PASSAGES_PER_CALL,
  };

  return readConcepts(vault, wiring.conceptReader, {
    budget,
    ...(options.under !== undefined ? { under: options.under } : {}),
    ...(options.zettelkastenFolder !== undefined
      ? { zettelkastenFolder: options.zettelkastenFolder }
      : {}),
    ...(options.coursesFolder !== undefined ? { coursesFolder: options.coursesFolder } : {}),
  });
}

// =============================================================================
// `buildKnowledgeKindWiring` / `classifyConceptKnowledgeKind` — component
// register row 1.5 (`[KCT-1]` `ol-kxr6`, `[KCT-2]` `ol-fx1k`, `[D-114]`).
// =============================================================================
//
// Same composition-root shape as `buildConceptWiring` above, one seam over:
// load the persisted Worker config, build a real `WorkerKnowledgeKindClassifier`
// when (and only when) it is usable, `null` otherwise (F7.8).
//
// **Reachability, same caveat as `readConceptsFromVault`'s own doc.**
// `classifyConceptKnowledgeKind` below is a genuine, non-test call to
// `classifyKnowledgeKind` (`olea-core`), wired to a real
// `WorkerKnowledgeKindClassifier` when the Worker is configured. Nothing in
// this package calls THIS method yet — there is no command, view or schedule
// that decides WHEN to classify a concept's knowledge kind, and the named
// consumer (component 2.2, instrument-type routing, `ol-dlr1`) has no code in
// the tree at all yet (per `ol-kxr6`'s own close notes). Building a trigger
// now would be inventing one this bead was not asked to design.
//
// **The confidence floor is NOT declared here, unlike the read budget above.**
// `ClassifyKnowledgeKindOptions.confidenceFloor` stays a caller-supplied,
// required value all the way through this wiring layer — component register
// row 1.5 rules it DERIVED (not merely un-measured, like the read budget),
// and its derivation needs real classifier output scored against the vault
// snapshot (N-015: synthetic never tunes a threshold), which is real work
// this bead does not do. Inventing even a declared placeholder here would
// blur that line; `classifyConceptKnowledgeKind`'s caller must supply one.
export interface KnowledgeKindWiring {
  /** `null` when the Worker isn't configured yet (F7.8) — see the module doc. */
  readonly classifier: KnowledgeKindClassifierPort | null;
}

export async function buildKnowledgeKindWiring(
  deps: ConceptWiringDeps,
): Promise<KnowledgeKindWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { classifier: null };

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return { classifier: new WorkerKnowledgeKindClassifier({ transport }) };
}

/**
 * The production caller `ol-fx1k` exists to build: reaches
 * `classifyKnowledgeKind` through whatever `KnowledgeKindClassifierPort`
 * `buildKnowledgeKindWiring` composed, over the real Worker transport when
 * one is configured. `null` when it is not (F7.8) — the same grey-out
 * contract `readConceptsFromVault` follows, propagated one level up.
 */
export async function classifyConceptKnowledgeKind(
  wiring: KnowledgeKindWiring,
  request: ClassifyKnowledgeKindRequest,
  options: ClassifyKnowledgeKindOptions,
): Promise<ClassifyKnowledgeKindResult | null> {
  if (wiring.classifier === null) return null;
  return classifyKnowledgeKind(wiring.classifier, request, options);
}

// =============================================================================
// `buildCorpusRelationWiring` / `runCorpusRelationBatchIfDue` — the
// corpus-level relation stage's production seam (`[D-082]`, component
// register row 1.2a, `[EXT-5]` `ol-2zfj.7`, `[EXT-11]` `ol-kw4a`, `[D-118]`).
// =============================================================================
//
// Same composition-root shape as `buildConceptWiring`/`buildKnowledgeKindWiring`
// above: load the persisted Worker config, build a real
// `WorkerCorpusRelationVerdict` when (and only when) it is usable, `null`
// otherwise (F7.8).
//
// **Unlike `readConceptsFromVault`/`classifyConceptKnowledgeKind`, this bead's
// own charge is to close the "nothing calls this yet" gap for the corpus
// stage specifically** (EXT-11's acceptance criteria: "a real production
// caller exists for `runCorpusRelationBatch`... that never fires on a
// per-document event"). `runCorpusRelationBatchIfDue` below is that caller —
// see its own doc for the trigger it is wired to and what it deliberately
// still leaves to the composition root in `main.ts` (which this bead's own
// file ownership does not include; the wiring is a patch handed to the
// orchestrator).

export interface CorpusRelationWiring {
  /** `null` when the Worker isn't configured yet (F7.8) — see the module doc. */
  readonly verdictPort: CorpusRelationVerdictPort | null;
}

export async function buildCorpusRelationWiring(
  deps: ConceptWiringDeps,
): Promise<CorpusRelationWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { verdictPort: null };

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return { verdictPort: new WorkerCorpusRelationVerdict({ transport }) };
}

/**
 * `ReadConcept[]` (a full concept READ, per-document relations included) ->
 * `CorpusConcept[]` (this stage's own narrower input) — dropping every
 * concept with no `anchor`, exactly as `ReadConcept.anchor`'s own doc says
 * such a concept must be: "ineligible for the corpus-level relation stage."
 */
export function corpusConceptsFrom(concepts: readonly ReadConcept[]): readonly CorpusConcept[] {
  return concepts
    .filter(
      (concept): concept is ReadConcept & { anchor: Provenance } => concept.anchor !== undefined,
    )
    .map((concept) => ({ name: concept.name, aliases: concept.aliases, anchor: concept.anchor }));
}

export interface RunCorpusRelationBatchIfDueOptions {
  readonly vault: VaultSource;
  /**
   * True the instant `main.ts`'s ingestion tick loop observes the queue
   * transition from doing work to fully idle
   * (`./corpusRelationTrigger.js`'s `ingestionSessionJustClosed`) — the
   * FIRST of `shouldRunCorpusRelationBatch`'s two boundaries, and the one
   * this function is wired to for real. Never derived from a single
   * document or job landing (F1-sources.md's "the corpus stage fires on
   * batch boundaries, never on document arrival").
   */
  readonly ingestionSessionClosed: boolean;
  /** This run's full, current concept set — `corpusConceptsFrom(readConceptsFromVault(...))`'s `concepts`, for whichever course(s) the caller scopes this to. */
  readonly allConcepts: readonly CorpusConcept[];
  /**
   * Component register row 1.2a's derived threshold
   * (`packages/core/src/concept/corpus-relations/trigger.ts`'s `n`) —
   * undefaulted deliberately (EXT-11, `ol-kw4a`, item 4: no tuning pass has
   * run, the same posture `ClassifyKnowledgeKindOptions.confidenceFloor`
   * held before KCT-3). Omit it to run this stage on the
   * ingestion-session-close boundary alone: the concept-count boundary is
   * then structurally disabled (an infinite threshold, never a guessed
   * number) rather than silently defaulted to one this module invented.
   */
  readonly n?: number;
}

export interface CorpusRelationBatchRunOutcome {
  readonly ran: boolean;
  /** Present only when `ran` is true — which boundary fired. */
  readonly reason?: CorpusRelationBatchTriggerReason;
  /** Present only when `ran` is true. Fold onto `ConceptReadResult.relations` (same `ConceptRelation[]` shape) — see the module doc for why this bead does not introduce a second store for them. */
  readonly relations?: readonly ConceptRelation[];
  readonly candidatesNominated?: number;
}

/**
 * The production caller `ol-kw4a` exists to build, closing `[EXT-5]`'s own
 * named gap for `runCorpusRelationBatch`. Reaches it through whatever
 * `CorpusRelationVerdictPort` `buildCorpusRelationWiring` composed, with
 * REAL nomination signals (`./corpusRelationSignals.js`'s `her-link` scan —
 * see that module's doc for why `assessment-cooccurrence` and
 * `embedding-proximity` are named, deferred follow-on work rather than
 * built here) and a REAL, persisted "new concepts since last run" count
 * (`./corpusRelationStateStore.js`).
 *
 * **Where the resulting edges land.** This function returns them; it does
 * not persist or surface them itself. Nothing in this plugin persists
 * concepts across sessions yet either (`readConceptsFromVault`'s own doc:
 * every call is a fresh, in-memory read) — building a dedicated relations
 * store ahead of a concept registry would be structure with nothing to
 * attach to. The natural fold point that already exists is
 * `ConceptReadResult.relations`: both this function's `relations` and a
 * per-document read's `relations` are the identical `ConceptRelation[]`
 * shape, so a caller holding both concatenates them into one list rather
 * than this bead inventing a second representation.
 *
 * **`n`'s absence never blocks the ingestion-session-close boundary.** See
 * `RunCorpusRelationBatchIfDueOptions.n`'s own doc — the concept-count
 * boundary is what stays unreachable without a derived value, not this
 * whole function.
 *
 * The persisted "known concept names" set is updated only when this
 * function actually runs a batch — never on a call that declines to run —
 * so "new concepts since last run" keeps accumulating correctly across
 * every tick that does not cross a boundary.
 */
export async function runCorpusRelationBatchIfDue(
  wiring: CorpusRelationWiring,
  stateStore: ObsidianCorpusRelationStateStore,
  options: RunCorpusRelationBatchIfDueOptions,
): Promise<CorpusRelationBatchRunOutcome> {
  if (wiring.verdictPort === null) return { ran: false };

  const state = await stateStore.load();
  const known = new Set(state.knownConceptNames);
  const newConcepts = options.allConcepts.filter((concept) => !known.has(concept.name));

  const trigger = shouldRunCorpusRelationBatch({
    ingestionSessionClosed: options.ingestionSessionClosed,
    newConceptsSinceLastRun: newConcepts.length,
    n: options.n ?? Number.POSITIVE_INFINITY,
  });
  if (!trigger.shouldRun) return { ran: false };
  // A boundary crossed with nothing new to nominate against is an honest
  // no-op, not an error — `nominateCorpusRelationCandidates` would return
  // `[]` anyway (every candidate needs at least one NEW endpoint), so this
  // short-circuits before the vault scan below rather than doing it for
  // nothing.
  if (newConcepts.length === 0) {
    return { ran: false, ...(trigger.reason !== undefined ? { reason: trigger.reason } : {}) };
  }

  const { signals, passageTextByName } = await gatherCorpusRelationVaultContext(
    options.vault,
    options.allConcepts,
  );

  const result = await runCorpusRelationBatch(wiring.verdictPort, {
    newConcepts,
    allConcepts: options.allConcepts,
    signals,
    passageText: (concept) => passageTextByName.get(concept.name) ?? '',
  });

  await stateStore.save({
    knownConceptNames: [...new Set(options.allConcepts.map((concept) => concept.name))],
  });

  return {
    ran: true,
    ...(trigger.reason !== undefined ? { reason: trigger.reason } : {}),
    relations: result.relations,
    candidatesNominated: result.candidatesNominated,
  };
}
