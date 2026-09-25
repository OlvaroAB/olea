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
 * THE BUDGET (`ConceptReadBudget.maxPassages` / `.passagesPerCall`)
 * ===========================================================================
 * `readConcepts` requires a budget with no default, on purpose: the
 * component register rules a concept-extraction threshold DERIVED once one
 * exists, and a derived constant's derivation stays private while only the
 * number ships. `DEFAULT_MAX_PASSAGES_PER_READ` is still such an unmeasured
 * placeholder — nobody has run that derivation yet:
 *
 * - `DEFAULT_MAX_PASSAGES_PER_READ` (60) keeps one full read within the same
 *   rough order of magnitude as an existing Slot G bulk-generation call
 *   (`cards.generate.v1` / `quiz.generate.v1` already send whole documents'
 *   worth of chunks per call) — roughly two to three typical lecture-note
 *   documents' worth of prose blocks, so a first end-to-end read costs
 *   about as much as one existing generation call rather than an
 *   unbounded corpus walk. Not fitted against measured cost, latency or
 *   extraction quality — that measurement is real work this module does not
 *   do, and this comment says so rather than implying otherwise.
 *
 * `DEFAULT_PASSAGES_PER_CALL` (80, was 20) is different: it is now a
 * **declared per-call ceiling**, `ol-2zfj.62` (`[D-210]`)'s constant, adopted
 * from a measured provisional baseline rather than invented placeholder.
 * Plain-English defence: 80 keeps almost every real course document — every
 * one but the rare outlier — inside a single call under the now-unconditional
 * per-document batching (`read.ts`'s `batchesByDocument`), which both
 * minimises `[D-210]`'s own `k1 = ceil(passages / ceiling)` call-count
 * multiplier and, on the sweep that measured it, cost no recall or
 * mention-weighted precision within the tested range (20-80 passages per
 * call). This is a `[D-194]`-form provisional baseline, not a fitted number
 * whose derivation stays private — the derivation (methodology, sample,
 * per-arm results) is cited by path only and never restated here:
 * `olea-service/findings/per-call-ceiling-sweep-2026-09-16.md`.
 *
 * Revisit condition (either fires it): a production model call — not the
 * frontier-oracle self-read the sweep used — is run against that same sweep
 * design and shows a measurable quality difference from 80; or a course
 * corpus is found where per-document call counts under an 80 ceiling
 * routinely exceed 2-3.
 *
 * A caller may override both via `ReadConceptOptions.budget`; these are only
 * what `readConceptsFromVault` falls back to when a caller supplies none.
 * Revising either is a Class B threshold tuning (run charter) unless it
 * crosses into a persisted schema or contract clause, not a Class C stop.
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
  conceptIdentityNormalizationIndex,
  deriveRelationSet,
  type ExtractConceptsOptions,
  extractConcepts,
  foldReadAnchors,
  type KnowledgeKindClassifierPort,
  listConceptKeyRecords,
  type Provenance,
  proposeSameAsLink,
  type ReadConcept,
  type RelationSet,
  readConcepts,
  runCorpusRelationBatch,
  type SameAsLinkRecord,
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
import { persistRelationCacheFromPass, readRelationSetWithCache } from './relation-wiring.js';
import { resolveSameAsForPass } from './same-as-wiring.js';
import { WorkerConceptReader } from './workerConceptReader.js';
import { WorkerCorpusRelationVerdict } from './workerCorpusRelationVerdict.js';
import { WorkerKnowledgeKindClassifier } from './workerKnowledgeKindClassifier.js';

/** See the module doc's "THE BUDGET" section. */
export const DEFAULT_MAX_PASSAGES_PER_READ = 60;
/**
 * The declared per-call ceiling (`[D-210]`, `ol-2zfj.62`) — see the module
 * doc's "THE BUDGET" section for the plain-English defence, the findings
 * path the derivation is cited by (never restated here), and the revisit
 * condition.
 */
export const DEFAULT_PASSAGES_PER_CALL = 80;

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
 * Reached in production via `readConceptsAndRelations` below (`ol-2zfj.12`),
 * called from `OleaPlugin.tickIngestionAndMaybeRunCorpusRelations`
 * (`packages/plugin/src/main.ts`) on the ingestion tick — `ol-5nle` [EXT-7],
 * closed, built this end to end (corrected 2026-09-25, `ol-egov.141.89.15`;
 * this paragraph previously said the production caller "exists to build").
 * Reaches `readConcepts` through whatever `ConceptReaderPort`
 * `buildConceptWiring` composed, over the real Worker transport when one is
 * configured. `null` when it is not (F7.8) — the same grey-out contract
 * every other AI-gated surface in this plugin follows, propagated one level
 * up rather than left for a caller to rediscover.
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

/**
 * `extractConceptsFromVault` plus `[D-082]`'s passage-grain fold
 * (`foldReadAnchors`, `olea-core`) in one call — the production caller
 * `foldReadAnchors`'s own doc names as still missing (`ol-2zfj.49`, second
 * half): "a caller that has both a fresh `extractConcepts` result and a
 * completed `readConcepts` result... applies this afterwards."
 *
 * **Where this is actually called from, and why that is enough.**
 * `main.ts`'s `tickIngestionAndMaybeRunCorpusRelations` already holds a
 * completed `ConceptsRead.concepts` (`pass.read.concepts`, from
 * `readConceptsAndRelations`) on every corpus-relation-batch tick — a real
 * read, over the real Worker, that already happened for the relation stage.
 * This function's `readConcepts` argument is exactly that value: no new
 * network call is made here, only a fresh, cheap, purely-local vault walk
 * (`extractConceptsFromVault`, i.e. `extractConcepts` — no transport) plus
 * the in-memory fold.
 *
 * **Reaches the registry now (`ol-2zfj.49` closing step).** `main.ts` holds
 * the folded `ConceptRecord[]` this function returns on `this.conceptRecords`
 * and hands the registry view a thunk over it (`conceptRecords: () =>
 * this.conceptRecords`); `registry/provider.ts`'s `load()` overlays
 * `anchor`/`alsoIn` from it onto its own `enumerateVaultInstruments` walk, by
 * key, so the click-through shows passage grain once a read has completed
 * and falls back to note-grain-only (unchanged) before that.
 */
export async function extractConceptsWithAnchors(
  vault: VaultSource,
  readConcepts: readonly ReadConcept[],
  options: ExtractConceptsOptions = {},
): Promise<readonly ConceptRecord[]> {
  const records = await extractConceptsFromVault(vault, options);
  return foldReadAnchors(records, readConcepts);
}

// =============================================================================
// `proposeSameAsForMovedNoteAnchors` — gap 2, `ol-egov.141.89.3.8` [ILB-CPT-B1]:
// the collision-to-proposal step for a moved-and-renamed concept note with no
// stable id.
// =============================================================================
//
// `olea-core`'s `key-store.ts` deliberately scopes its mint-time normalisation
// collision check (`findNormalizationCollisions`) to TOPIC anchors only — its
// own doc reasons that "a NoteAnchor's identity is already the stronger
// noteUid/path signal `anchorMatches` uses". That assumption fails exactly
// when a bound note carries no `olea-uid` frontmatter AND has since moved:
// `anchorMatches`'s note branch then falls back to plain `notePath` equality,
// which the move breaks, `resolveConceptKey` finds no match and mints a
// brand-new key, and — because note anchors never enter the collision index
// — no `normalizationCollisions` entry is ever recorded either. The old key
// is orphaned with no candidate collision anywhere, which is what cpt.md
// (§7, `[D-295 / CPT-D2]`) calls "the collision-to-proposal step" skipping
// this case.
//
// This closes the gap from the other side, touching neither `key-store.ts`'s
// schema nor its mint-time algorithm (both out of this bead's ownership): a
// note-bound `ConceptKeyRecord` whose `notePath` no longer exists in the
// current vault listing is treated as orphaned, and its pre-move name is
// recovered from that STALE path's own filename rather than a new persisted
// field — concept-note binding is always an exact-title match (`extract.ts`'s
// module doc, both tier 1 and tier 3), so the last path a `NoteAnchor`
// matched at IS, by construction, the note's name at that time. A freshly
// resolved candidate whose name normalises (`conceptIdentityNormalizationIndex`
// — the SAME index `key-store.ts` already uses for its own collision check)
// to that recovered name is proposed as the same concept, through
// `proposeSameAsLink`'s own bias-to-splits seam: this only ever proposes,
// never merges, and a normalisation miss proposes nothing.
//
// **No production caller yet ([D-072]).** Wiring this into the real
// ingestion tick is `[ILB-CPT-4]`'s to do — it already owns `main.ts`'s
// composition of the rest of this same step (the mint-time half in
// `key-store.ts`, and `same-as-consumer.ts`'s read-time fold), both outside
// this bead's file ownership. This function is the tested, composable unit
// that step calls.

/** The filename `notePath` binds on, stripped of its extension — `extract.ts`'s exact-title-match rule means this IS the note's bound name at the anchor's last known path. */
function noteNameFromPath(notePath: VaultPath): string {
  const base = notePath.split('/').pop() ?? notePath;
  return base.endsWith('.md') ? base.slice(0, -'.md'.length) : base;
}

/** A freshly-resolved, note-bound concept: enough to test for a normalisation match against an orphaned anchor's recovered name. */
export interface MovedNoteAnchorCandidate {
  readonly key: string;
  readonly name: string;
}

/**
 * Finds every persisted note-anchored `ConceptKeyRecord` with no stable
 * `olea-uid` whose `notePath` no longer exists in the current vault, and
 * proposes a same-as link to any `candidates` entry whose name normalises to
 * that anchor's recovered pre-move name. See this section's module doc for
 * the full argument. Returns every link this call actually proposed (a
 * caller wanting the no-op case — an existing record left unchanged — reads
 * `proposeSameAsLink`'s own return value directly).
 */
export async function proposeSameAsForMovedNoteAnchors(
  vault: VaultSource,
  candidates: readonly MovedNoteAnchorCandidate[],
): Promise<readonly SameAsLinkRecord[]> {
  const currentNotePaths = new Set(await vault.list({ extensions: ['md'] }));
  const records = await listConceptKeyRecords(vault);

  const proposed: SameAsLinkRecord[] = [];
  for (const { record } of records) {
    if (record.anchor.kind !== 'note') continue;
    if (record.anchor.noteUid !== null) continue; // a stable id means the ordinary match already tracks a move.
    if (currentNotePaths.has(record.anchor.notePath)) continue; // still there: not orphaned.

    const oldIndex = conceptIdentityNormalizationIndex(noteNameFromPath(record.anchor.notePath));
    for (const candidate of candidates) {
      if (candidate.key === record.key) continue;
      if (conceptIdentityNormalizationIndex(candidate.name) !== oldIndex) continue;
      proposed.push(await proposeSameAsLink(vault, record.key, candidate.key));
    }
  }
  return proposed;
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
 * What `corpusConceptsFrom` accepts: a `ReadConcept` whose `key` may be
 * absent.
 *
 * `ReadConcept.key` is required (`ol-282w` [REL-10]), so production input
 * always satisfies this. The looser alias exists for the two callers that
 * are not a full read — a `ConceptRecord`-shaped object, and the tests that
 * build a candidate by hand — so the "omit `key` when there is none" branch
 * below stays reachable and tested rather than unreachable by type.
 */
export type CorpusConceptSource = Omit<ReadConcept, 'key'> & { readonly key?: string };

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
 *
 * **Threads `key` through, and on the production path it is now always
 * there (`ol-l40p` [REL-9], closed by `ol-282w` [REL-10]).** `ReadConcept`
 * (`olea-core`'s `read.ts`) now carries a required `key`: the read stage
 * carries the `ConceptRecord.key` its corroborating record already holds and
 * mints through the one `[D-088]` seam only for a concept no record covers,
 * so it is a key *carrier*, never a second producer. The production caller
 * below (`readConceptsAndRelations`, passing `read.concepts`) therefore
 * emits a keyed candidate for every eligible concept, which is what lets
 * `reconcileCorpusVerdicts` and `resolveRelatedConceptKeys` (`olea-core`)
 * join by key instead of by exact name — the join `findings/
 * relations-join-2026-09.md` (`olea-service`) measured failing on most
 * endpoint mentions in production terms.
 *
 * The parameter stays `CorpusConceptSource` (key OPTIONAL) rather than
 * `ReadConcept` (key required) on purpose: it keeps accepting a
 * `ConceptRecord`-shaped or partially-built caller with no cast, and it
 * keeps the omit-when-absent branch below honest rather than dead code no
 * type could ever reach. `key` is still never emitted as `key: undefined` —
 * it is omitted entirely when absent.
 */
export function corpusConceptsFrom(
  concepts: readonly CorpusConceptSource[],
): readonly CorpusConcept[] {
  return concepts
    .filter(
      (concept): concept is CorpusConceptSource & { anchor: Provenance } =>
        concept.anchor !== undefined,
    )
    .map((concept) => ({
      name: concept.name,
      aliases: concept.aliases,
      anchor: concept.anchor,
      courses: concept.courses,
      ...(concept.key !== undefined ? { key: concept.key } : {}),
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
 * **Reachability (`[D-072]`, plan §2.7 clause 5) — UPDATED, corrects stale text.**
 * This paragraph previously said there was no production caller; that had
 * already gone stale by the time of the `[D-119]` splice below —
 * `OleaPlugin.tickIngestionAndMaybeRunCorpusRelations`
 * (`packages/plugin/src/main.ts`, the `readConceptsAndRelations(...)` call
 * inside it) calls this function in production today. Corrected here rather
 * than left to drift further, per the "every live document is current"
 * rule: a citation that resolves to overturned text is worse than no
 * citation.
 *
 * **Persistence, as of the splice below (`[D-119]`, ol-2zfj.14/.122/.124).**
 * This function now composes `relation-wiring.ts`'s cache: it persists the
 * corpus stage's own key-bearing edges via `persistRelationCacheFromPass`
 * right after the corpus batch runs, then serves `relations` from
 * `readRelationSetWithCache` rather than a bare `deriveRelationSet` over the
 * two live inputs — so a tick whose corpus trigger does not fire still folds
 * in every currently-un-disposed edge a PRIOR tick minted, with a
 * declined/expired disposition excluded at read time (INV-6 as re-drawn by
 * `[D-097]`). `[D-097]`'s gating of EDGES (not yet earning the concepts
 * treatment) is unchanged — this is a vault-side cache of derived edges, not
 * a landing in her authored layer, and remains the Class C boundary this
 * lane does not cross. See `relation-wiring.ts`'s module doc for the full
 * argument. **Because `readConceptsAndRelations` already has the production
 * caller named above, this splice is what makes `persistRelationCacheFromPass`
 * and `readRelationSetWithCache` themselves production-reachable** — see
 * those two functions' own reachability notes in `relation-wiring.ts`, now
 * superseded by this one-hop chain.
 *
 * **The confirmed same-as link's first read consumer, added here (`ol-2zfj.86` ONT-R1, F8.6).**
 * Right after `relations` is folded, `./same-as-wiring.ts`'s `resolveSameAsForPass` runs over
 * this same pass: `read.concepts` and `relations` both fold a confirmed pair to its canonical
 * key — see that file's own module doc for exactly what changes and why
 * `readRelationSetWithCache` above keeps being called with the same arguments either way, rather
 * than being replaced. A `'proposed'`, `'declined'`, or `'severed'` link changes neither field
 * (`'declined'` added by `[D-257]`/`ol-egov.141.33` [TRIAGE-5]'s fourth status).
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

  // `persistRelationCacheFromPass` and `readRelationSetWithCache` both take a
  // full `ConceptAndRelationPass`, but neither reads its `relations` field —
  // only `read` and `corpus`. Fold once here to satisfy the type, persist the
  // corpus stage's fresh edges into the vault-side cache, then re-derive
  // `relations` from the now-updated cache so an edge minted on THIS tick is
  // reflected immediately rather than lagging one tick behind its own write.
  const passSoFar: ConceptAndRelationPass = {
    read,
    corpus,
    relations: deriveRelationSet(read.relations, corpus.relations ?? []),
  };
  await persistRelationCacheFromPass(options.vault, passSoFar);
  const relations = await readRelationSetWithCache(options.vault, passSoFar);

  // The confirmed same-as link's first read consumer (`ol-2zfj.86` ONT-R1, F8.6) — see this
  // function's own doc and `./same-as-wiring.ts`'s module doc. A `'proposed'`/`'severed'` link,
  // or no link at all (the ordinary tick), returns `read.concepts`/`relations` unchanged.
  const sameAs = await resolveSameAsForPass(options.vault, { read, corpus, relations });

  return { read: { ...read, concepts: sameAs.concepts }, corpus, relations: sameAs.relations };
}
