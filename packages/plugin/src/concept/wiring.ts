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
  type ConceptRecord,
  type ConceptRelation,
  type ConceptsRead,
  type CorpusConcept,
  type CorpusRelationBatchTriggerReason,
  type CorpusRelationVerdictPort,
  classifyKnowledgeKind,
  deriveRelationSet,
  type ExtractConceptsOptions,
  extractConcepts,
  type KnowledgeKindClassifierPort,
  type Provenance,
  type ReadConcept,
  type RelationSet,
  readConcepts,
  runCorpusRelationBatch,
  shouldRunCorpusRelationBatch,
  type VaultPath,
  type VaultSource,
  type WorkerTaskTransport,
} from 'olea-core';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import {
  type AssessmentErrorAdjacencyOptions,
  type EmbeddingProximityOptions,
  gatherCorpusRelationVaultContext,
} from './corpusRelationSignals.js';
import type { ObsidianCorpusRelationStateStore } from './corpusRelationStateStore.js';
import { WorkerConceptReader } from './workerConceptReader.js';
import { WorkerCorpusRelationVerdict } from './workerCorpusRelationVerdict.js';
import { WorkerKnowledgeKindClassifier } from './workerKnowledgeKindClassifier.js';

/** See the module doc's "THE BUDGET" section. */
export const DEFAULT_MAX_PASSAGES_PER_READ = 60;
/** See the module doc's "THE BUDGET" section. */
export const DEFAULT_PASSAGES_PER_CALL = 20;

/**
 * The `embedding-proximity` nomination signal's cosine-similarity cutoff
 * (`EmbeddingProximityOptions.threshold`, `./corpusRelationSignals.js`) —
 * **DECLARED-adopted, not derived here.** `[D-DERIVE-EMB]` (`ol-u2uj`,
 * ratified by David 2026-08-28) adopts 0.50 on the quantised-cosine scale as
 * the provisional threshold, per the round-23 derivation
 * (`olea-service/findings/embedding-proximity-threshold.md`, zero spend):
 * 89% clean-arm positive retention, 24% background nomination, lift 3.7,
 * bracketed [0.495, 0.505] by two independent selection rules; honest
 * ceiling on record — topic-matched AUC 0.659, the verdict stage carries
 * precision, not this signal.
 *
 * Four revisit conditions, any ONE of which requires re-derivation before
 * this number may be relied on further:
 *   1. the corpus batch becomes course-scoped;
 *   2. the first 50 model verdicts land on proximity-nominated pairs;
 *   3. a real `readConcepts` run against the snapshot;
 *   4. any embedding-model change.
 *
 * **Condition 1 fires the instant `ol-2zfj.29` lands** — that bead threads
 * `courses` through `corpusConceptsFrom` above, making the corpus batch
 * course-scoped in production for the first time. The derivation this
 * constant is measured against ran on the OLD, unscoped candidate space
 * (the pre-`ol-x3qg` wiring), where the signal's discriminating power was
 * substantially a topic detector across the whole vault — most of that
 * power is expected to disappear within a single course. Re-derivation is
 * `ol-3ux7.26` (zero spend — the corpus is already embedded), running
 * concurrently with this change; until it is ratified, production runs
 * course-scoped nomination against a threshold derived under the wrong
 * scope. This is a KNOWN, recorded consequence of landing `ol-2zfj.29` —
 * course-scoped candidates are strictly narrower than unscoped ones, so the
 * signal cannot become MORE permissive than the derivation measured — but
 * its recall/volume trade-off is stale until `ol-3ux7.26` closes.
 *
 * This constant moves only via a decision bead (Class C) — never edited in
 * place on a hunch, per the run charter's numbers-are-decided-by-data rule.
 */
export const EMBEDDING_PROXIMITY_THRESHOLD = 0.5;

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

/**
 * `extractConceptsFromVault` (`ol-2zfj.44`) — the seam that lands
 * `ConceptKeyRecord` minting (`ol-2zfj.42`, `[D-174]`) in production.
 *
 * `extractConcepts` (`olea-core`) takes `stampConceptKeys`, default `false`,
 * because `extract.spec.ts` runs extraction dozens of times over the tracked
 * fixture vault and an unconditional write would mutate it (see that
 * option's own doc in `packages/core/src/concept/types.ts`). No production
 * caller passed `true` before this bead. This wrapper is the one place that
 * default flips: every plugin-side extraction over her REAL vault should go
 * through this function, not `extractConcepts` directly, so stamping is
 * opt-OUT (pass `stampConceptKeys: false` explicitly) rather than opt-in —
 * the safer default for a capability that is invisible when it silently
 * doesn't happen.
 *
 * **Reachability, `ol-2zfj.44`'s own scope note.** This bead's ownership is
 * `packages/plugin/src/vault/` and `packages/plugin/src/concept/` only.
 * `extractConcepts(vault, {})` is called directly (not through this
 * function, and not stamping) from six sites this bead does NOT own —
 * `retrospective/provider.ts` (x2), `today/data-source.ts`,
 * `plan/provider.ts`, `generation/wiring.ts`, `gap/provider.ts` — each in a
 * live sibling lane's directory. Switching each of those six call sites to
 * `extractConceptsFromVault` is a one-line change per site (swap the import
 * and the call), left to a successor bead/lane per the run charter's
 * ownership discipline rather than reached into here.
 */
export async function extractConceptsFromVault(
  vault: VaultSource,
  options: ExtractConceptsOptions = {},
): Promise<readonly ConceptRecord[]> {
  return extractConcepts(vault, { stampConceptKeys: true, ...options });
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
 *
 * **Threads `courses` through (`ol-2zfj.29`, `ol-x3qg`).** C7.10 and
 * `[D-082]` both scope the corpus-level stage to "a course's concept set,"
 * not the whole vault at once; `nominate.ts`'s `shareACourse` check
 * (`packages/core`) was landed inert by `ol-x3qg` because this function was
 * dropping `ReadConcept.courses` on the floor, leaving every caller
 * permissive (`courses: undefined`) regardless of what the read actually
 * knew. Carrying it through is what makes that check live: `courses: []`
 * (a concept confirmed to sit in no course) excludes it from pairing on
 * either side, the same "ineligible for this stage" posture `anchor` already
 * holds here.
 */
export function corpusConceptsFrom(concepts: readonly ReadConcept[]): readonly CorpusConcept[] {
  return concepts
    .filter(
      (concept): concept is ReadConcept & { anchor: Provenance } => concept.anchor !== undefined,
    )
    .map((concept) => ({
      name: concept.name,
      aliases: concept.aliases,
      anchor: concept.anchor,
      courses: concept.courses,
    }));
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
  /**
   * Forwarded verbatim to `gatherCorpusRelationVaultContext`'s
   * `sourcesFolder` — overrides where the `assessment-cooccurrence` signal
   * looks for classified past-paper/objectives sources (`ol-2zfj.13`). Omit
   * to use `registerSources`' own default.
   */
  readonly sourcesFolder?: VaultPath;
  /**
   * Forwarded verbatim to `gatherCorpusRelationVaultContext`'s
   * `embeddingProximity` — wires the `embedding-proximity` signal against an
   * already-built local embedding cache (`ol-2zfj.13`,
   * `../retrieval/wiring.js`'s `RetrievalWiring.embeddingCache`). Omitted
   * (the default) skips that signal entirely; see
   * `corpusRelationSignals.js`'s `EmbeddingProximityOptions` for why there is
   * no default cache or threshold to fall back to.
   */
  readonly embeddingProximity?: EmbeddingProximityOptions;
  /**
   * Opt-in assessment-error-adjacency signal (`ol-2zfj.19`) — same shape as
   * `embeddingProximity`: absent means the signal contributes nothing.
   */
  readonly assessmentErrorAdjacency?: AssessmentErrorAdjacencyOptions;
}

export interface CorpusRelationBatchRunOutcome {
  readonly ran: boolean;
  /** Present only when `ran` is true — which boundary fired. */
  readonly reason?: CorpusRelationBatchTriggerReason;
  /** Present only when `ran` is true. Folded onto the per-document read's own `relations` by `readConceptsAndRelations` below (`ol-2zfj.12`) — same `ConceptRelation[]` shape, one `RelationSet`. */
  readonly relations?: readonly ConceptRelation[];
  readonly candidatesNominated?: number;
}

/**
 * The production caller `ol-kw4a` exists to build, closing `[EXT-5]`'s own
 * named gap for `runCorpusRelationBatch`. Reaches it through whatever
 * `CorpusRelationVerdictPort` `buildCorpusRelationWiring` composed, with
 * REAL nomination signals (`./corpusRelationSignals.js`'s `her-link` scan,
 * always on, plus `assessment-cooccurrence`, always on, plus
 * `embedding-proximity` when this function's own `embeddingProximity` option
 * is supplied — `ol-2zfj.13` wired the latter two; see that module's doc for
 * what each computes and does not) and a REAL, persisted "new concepts since
 * last run" count (`./corpusRelationStateStore.js`).
 *
 * **Where the resulting edges land** — answered by `ol-2zfj.12`, and no
 * longer nowhere. This function still returns them rather than persisting
 * them; `readConceptsAndRelations` below is the fold point, holding both
 * this stage's edges and the per-document stage's in one `RelationSet`.
 * Nothing in this plugin persists concepts across sessions
 * (`readConceptsFromVault`'s own doc: every call is a fresh, in-memory
 * read), and a persisted relations store ahead of a concept registry would
 * be structure with nothing to attach to — see that function's doc and
 * `olea-service/docs/dev/relation-landing-design.md` for why persistence is
 * the Class C line rather than the next commit.
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
    {
      ...(options.sourcesFolder !== undefined ? { sourcesFolder: options.sourcesFolder } : {}),
      ...(options.embeddingProximity !== undefined
        ? { embeddingProximity: options.embeddingProximity }
        : {}),
      ...(options.assessmentErrorAdjacency !== undefined
        ? { assessmentErrorAdjacency: options.assessmentErrorAdjacency }
        : {}),
    },
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

// =============================================================================
// `readConceptsAndRelations` — the landing seam for BOTH relation producers
// (`ol-2zfj.12`, C7.10, `[D-070]`, `[D-093]`, INV-6 as re-drawn by `[D-097]`).
// =============================================================================
//
// Until this function existed, both producers' edges were computed and then
// dropped: the per-document stage's `ConceptsRead.relations` was read only for
// concept size inside `readConcepts` itself, and this file's own
// `runCorpusRelationBatchIfDue` returned edges that `main.ts` discarded with a
// comment saying so. This is where they meet.
//
// **It is a fold held in memory for the duration of one pass, and NOT a
// store.** The full argument is in
// `olea-service/docs/dev/relation-landing-design.md`; the short form is that
// (a) the architecture boundary §1 makes her event log the truth and every
// knowledge state a projection, and a model's reading of her material is a
// derivation rather than something she did; (b) `ConceptRelation`'s endpoints
// are NAMES while C7.11/`[D-088]` rule concept identity an opaque key never
// derived from content, so persisting name-keyed edges would bake the exact
// fragility that clause exists to prevent into a persisted schema; and (c)
// nothing persists concepts either, so a relations store would have nothing to
// key against. Persistence is the Class C crossing this lane stops at.

/** The result of one combined concept-and-relation pass — `null` from the pass when there was nothing to read. */
export interface ConceptAndRelationPass {
  /** The per-document stage's own result, narrowed to the read case. */
  readonly read: ConceptsRead;
  /** The corpus stage's outcome, including whether its trigger even fired. */
  readonly corpus: CorpusRelationBatchRunOutcome;
  /**
   * Both stages' edges, deduplicated and provenance-ranked
   * (`deriveRelationSet`). Present on every pass — `entries: []` when neither
   * stage emitted anything, which is a measurement rather than an absence.
   */
  readonly relations: RelationSet;
}

export interface ReadConceptsAndRelationsOptions {
  readonly vault: VaultSource;
  /** Forwarded verbatim to `runCorpusRelationBatchIfDue` — see its own doc; never derived from a per-document event. */
  readonly ingestionSessionClosed: boolean;
  /** Forwarded verbatim to `runCorpusRelationBatchIfDue`; omitted leaves the concept-count boundary structurally disabled. */
  readonly n?: number;
  /** Forwarded verbatim to `readConceptsFromVault`. */
  readonly read?: ReadConceptsFromVaultOptions;
  /** Forwarded verbatim to `runCorpusRelationBatchIfDue`'s `sourcesFolder` (`ol-2zfj.13`). */
  readonly sourcesFolder?: VaultPath;
  /** Forwarded verbatim to `runCorpusRelationBatchIfDue`'s `embeddingProximity` (`ol-2zfj.13`). */
  readonly embeddingProximity?: EmbeddingProximityOptions;
  /** Forwarded verbatim to `runCorpusRelationBatchIfDue`'s `assessmentErrorAdjacency` (`ol-2zfj.19`). */
  readonly assessmentErrorAdjacency?: AssessmentErrorAdjacencyOptions;
}

/**
 * Run one per-document read, run the corpus batch if its trigger fires, and
 * fold both stages' edges into a single `RelationSet`.
 *
 * `null` when the read produced nothing to fold on: the Worker is
 * unconfigured (F7.8 grey-out, propagated one level up exactly as
 * `readConceptsFromVault` does) or the read came back `'unrecognised'`, which
 * F1.4 requires be reported rather than returned as a silent empty list. A
 * caller that wants the unrecognised reason calls `readConceptsFromVault`
 * itself; this function's contract is the fold, and a fold over a read that
 * did not happen is not a meaningful zero.
 *
 * **The corpus stage still gates itself.** This function never forces a
 * batch: it hands `runCorpusRelationBatchIfDue` the same trigger inputs it
 * would have received from the composition root, and folds `[]` when that
 * declines to run. A pass on a tick that crosses no boundary therefore yields
 * the per-document edges alone, which is the correct answer rather than a
 * degraded one.
 *
 * **Reachability (`[D-072]`, plan §2.7 clause 5).** There is deliberately no
 * production caller in this package yet: the only site holding both an
 * `ingestionSessionClosed` transition and a configured wiring is
 * `OleaPlugin.tickIngestionAndMaybeRunCorpusRelations`
 * (`packages/plugin/src/main.ts:517`), which `ol-2zfj.12`'s declared file
 * ownership does not include. The one-hop replacement of that method's body
 * is handed to the orchestrator as a patch, the same procedure `[EXT-11]`
 * (`ol-kw4a`) used to make `runCorpusRelationBatchIfDue` itself reachable.
 * Until it is applied, this function is exercised by
 * `test/concept/corpusRelationWiring.spec.ts` alone.
 *
 * **What this function deliberately does not do.** It does not persist, does
 * not surface, and does not gate. `[D-097]` re-draws INV-6 with edges
 * explicitly still *gated* — "EDGES: stay gated for now... measured precision
 * of the corpus stage's verdicts is what would earn edges the concepts
 * treatment" — so nothing here may land an edge in her layer. Nothing here
 * does: the set is returned to the caller and forgotten when the pass ends.
 */
export async function readConceptsAndRelations(
  conceptWiring: ConceptWiring,
  corpusWiring: CorpusRelationWiring,
  stateStore: ObsidianCorpusRelationStateStore,
  options: ReadConceptsAndRelationsOptions,
): Promise<ConceptAndRelationPass | null> {
  const read = await readConceptsFromVault(conceptWiring, options.vault, options.read ?? {});
  if (read === null || read.outcome !== 'read') return null;

  const corpus = await runCorpusRelationBatchIfDue(corpusWiring, stateStore, {
    vault: options.vault,
    ingestionSessionClosed: options.ingestionSessionClosed,
    allConcepts: corpusConceptsFrom(read.concepts),
    ...(options.n !== undefined ? { n: options.n } : {}),
    ...(options.sourcesFolder !== undefined ? { sourcesFolder: options.sourcesFolder } : {}),
    ...(options.embeddingProximity !== undefined
      ? { embeddingProximity: options.embeddingProximity }
      : {}),
    ...(options.assessmentErrorAdjacency !== undefined
      ? { assessmentErrorAdjacency: options.assessmentErrorAdjacency }
      : {}),
  });

  return {
    read,
    corpus,
    relations: deriveRelationSet(read.relations, corpus.relations ?? []),
  };
}
