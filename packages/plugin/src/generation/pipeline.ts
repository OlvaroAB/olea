/**
 * `runGenerationSweep` — F3.3's "generate instruments automatically when
 * material lands," the client-side trigger (`ol-p3t07a`).
 *
 * **What "material lands" means here, and the two shapes it can take.** The
 * ingestion queue (`packages/core/src/ingestion/`) only ever produces
 * `ExtractedUnit`s for non-markdown documents (PDF/PPTX/DOCX/image, C3) — a
 * markdown note's own prose is never routed through it. Every unit needs a
 * real markdown note to insert a generated MCQ into
 * (`materialize-mcq.ts` writes through `insertMcqBlock`, which needs a
 * note's own text), and there are two ways one gets resolved:
 *
 *  - `provenance.embeddedIn` set (F1.6: a source embedded in one of her
 *    notes via `![[...]]`) — that note IS the target, unchanged since this
 *    module's first version.
 *  - `provenance.embeddedIn` absent — a bare drop with no embedding note
 *    anywhere (F3.1's other case). **Before `[D-179]` this sweep silently
 *    skipped it**, a disclosed, scoped-out gap (`ol-p3t07a`'s close
 *    evidence). `[D-179]` (`ol-ho93`, `[SRC-2]`) ruled the fix: Olea creates
 *    her own home note beside the source (`home-note.ts`,
 *    `ensureHomeNoteForConcept`) — never prompting first, since the note is
 *    Olea's own layer (INV-6, D-097) — and that note is the target instead.
 *    The course for a bare drop comes from the SOURCE's own folder
 *    (`courseFromPath`), never the home note's content, matching F3.1/F3.3
 *    as amended.
 *
 * **The home note is created lazily, only when a concept for its course is
 * actually about to be cached as a pending draft** — not eagerly for every
 * bare drop this sweep sees. A source that never grounds anything (every
 * candidate concept refuses, or the course has none yet) gets no note at
 * all: an empty placeholder note for material that produced nothing would be
 * clutter, not a home. `ensureHomeNoteForConcept` is itself idempotent
 * (`vault.exists` gates creation), so calling it once per successful draft,
 * across many sweeps, reuses the same note rather than recreating it.
 *
 * **One concept per drafting call, one drafting call per (course, concept)
 * pair, ever (until the cache says otherwise).** `draftQuizCardsForConcept`
 * takes exactly one `conceptName` — there is no batch form — so "which
 * concepts does this landed material introduce" has to be answered before
 * calling it. This module answers that the coarse way, deliberately: it asks
 * `listConceptsForCourse` (normally `extractConcepts` scoped to the
 * material's course folder — see `wiring.ts`) for every concept the course
 * currently has, then drafts whichever of those the cache has never seen
 * before, up to `MAX_CONCEPTS_PER_SWEEP`. It does **not** attempt to
 * determine which concepts *this specific unit* introduced (a real NLP
 * problem, out of scope) — a course-wide "what's still undrafted" sweep,
 * re-run every tick, converges on the same set eventually and is a correct,
 * if coarse-grained, reading of F3.3's "when material lands" for a first
 * build. F3.7's mastery/yield ORDERING is not implemented here either — see
 * `constants.ts`'s `MAX_CONCEPTS_PER_SWEEP` doc for why a small cap bounds
 * that gap's cost rather than needing to close it in this bead.
 *
 * **A refused concept gets no cache entry, by construction (F4.5's
 * grounded-by-construction argument).** `draftQuizCardsForConcept` already
 * guarantees zero transport sends on refusal (`ol-odb0.3`); this module adds
 * nothing on top except "don't cache a draft for it". Whether a refused concept
 * is asked AGAIN on a later sweep depends on the KIND of refusal
 * (`ol-egov.141.89.2.17`; the paragraph below this one).
 *
 * **A refused concept is not re-asked on unchanged evidence, by kind
 * (`ol-egov.141.89.2.17`; `[D-289]`'s distinct refusal outcomes, `[D-400]`/`[D-420]`'s
 * bounded-retry shape).** Before this bead every refused concept was asked again on
 * every later sweep. When the ask reached the judge that repeated a model call for no
 * new evidence, and because the per-sweep cap counts every ask, the same first few
 * refused concepts (name order) took the whole cap every time, so the concepts after
 * them were never reached. The sweep now remembers, per (course, concept), what a
 * refusal that reached the judge was and what evidence it was made on
 * (`GenerationRefusalMemory`, below):
 *
 *  - `judge-rejected` (the judge read the material and found it not enough — the one
 *    checked verdict): held until the evidence or the demand changes, or an explicit
 *    `release`. New or changed material for the course, a changed concept source note,
 *    or a different demand (`purpose`/`registerHint`) lifts it.
 *  - `judge-unavailable` (the judge could not be consulted): retried once on unchanged
 *    evidence (`MAX_JUDGE_UNAVAILABLE_ATTEMPTS`), then held the same way; additionally
 *    lifted for one more retry whenever a judge answer (a verdict or a draft) is seen
 *    for any concept, since that is direct evidence the judge is back.
 *  - every other reason (`no-hits`, `below-relevance-threshold`,
 *    `below-composite-threshold`, `below-band`, `composite-check-unavailable`) and a
 *    thrown or unparseable drafting call: NOT held. Nothing was sent to a judge, so a
 *    re-ask costs a local retrieval, and each can be cured without any source edit (the
 *    index catching up, the connection returning). Decision-sheet row 15 asks that the
 *    threshold refusals not be read as "her notes lack this", so they are not treated as
 *    a completed judgment here either. They rotate instead: among asked concepts the
 *    one asked longest ago goes first, so retryable refusals do not starve the concepts
 *    after them of the cap.
 *
 * A held concept is not asked, does not use the cap, and is reported (`refusals`, with
 * the same copy, and `skippedRefused`) so what she sees is unchanged. The memory is
 * in-process, scoped to the draft cache instance (one plugin session in production): a
 * restart forgets it and each held concept is asked once more. Persisting it would be a
 * persisted schema and is not done here (see the bead's open question).
 *
 * **A refused concept is classified, not just counted (`[H-1.8a]` /
 * `ol-0r92.71`, component register row 1.8a, C4.7 / `[D-089]`).** Before this
 * bead the refusal was dropped after incrementing `refused` — the reason
 * string reached nowhere. Now `describeRefusal` (`draft-cards-copy.ts`)
 * runs on every refusal and the result lands in
 * `GenerationSweepReport.refusals`, still uncached (the paragraph above is
 * unchanged). **This closes the classification half of row 1.8a's
 * falsifier, not the reachability half**: no production caller reads
 * `refusals` yet — see that field's own doc for why finishing the wiring
 * sits outside this bead's owned paths.
 *
 * **Routing consultation (`ol-tz7v` / `[WIRE-7]`), opt-in via `deps.routing`.**
 * When absent, every candidate is drafted exactly as before this bead —
 * `pipeline.spec.ts`'s whole existing suite never supplies it, so nothing
 * about their expectations changes. When present, each new (not
 * cache-deduped) candidate is routed through `routing.ts`'s
 * `classifyForRouting` / `decideConceptRouting` against a **real** per-concept
 * instrument inventory (`buildConceptInstrumentInventory`, one vault walk per
 * sweep) before this sweep's one generation capability — `quiz.generate.v1`
 * MCQ drafting — is invoked: a candidate whose routed mix already has its
 * `quiz` group met or excluded (`quizDeficit === 0`) is skipped rather than
 * drafted, counted separately in `GenerationSweepReport.skippedRouting`
 * rather than `attempted`, since no transport call — not even the local
 * `retrieve()` a refusal costs — is made for it. It is re-consulted every
 * sweep, the same as a refused concept, because nothing about "routing says
 * not yet" writes a cache entry either.
 *
 * **Purpose-at-build consultation (`ol-0r92.35` / `[D-188]`), opt-in via
 * `deps.formatMatch`.** When absent — every caller today, `pipeline.spec.ts`
 * included — every `quiz.generate.v1` request this sweep sends omits
 * `purpose`/`registerHint` entirely, exactly as before this bead: the
 * service treats an absent `purpose` as `'learning'`, her own voice. When
 * present, it is consulted once per course (never per concept — see the
 * call site) and, for a course whose nearest assessment is format-matched,
 * every quiz drafted for that course this sweep carries `purpose:
 * 'readiness'` and whatever `registerHint` was supplied. See
 * `GenerationPipelineDeps.formatMatch`'s own doc for why no production
 * wiring exists yet and `draft-quiz-cards.ts`'s "PURPOSE / REGISTER" section
 * for the request-shaping half this consultation feeds.
 *
 * **`DraftRecord.sourceContentHash` (`ol-0r92.87`'s stale-input guard).**
 * Immediately before a candidate's questions are cached, this reads
 * `notePath` — already resolved above, embedding note or home note either
 * way — and hashes it (`hashText`, `olea-core`) once per candidate. Every
 * `DraftRecord` this sweep caches for that candidate carries the same hash:
 * the snapshot the drafted questions were actually grounded against, not a
 * later re-read. `accept.ts`/`materialize-mcq.ts` compare a fresh hash of
 * the same note against this one at accept time and refuse rather than
 * materialize on a mismatch — see `materialize-mcq.ts`'s module doc for the
 * accept-time half. One extra vault read per candidate that reaches this
 * point (bounded by `MAX_CONCEPTS_PER_SWEEP`, same as everything else in
 * this loop), never per question. Guarded by `vault.exists` first — this
 * module's own doc promises `runGenerationSweep` never throws, so a note
 * that vanished between resolving `notePath` and this line (a real race,
 * however unlikely) leaves `sourceContentHash` unset rather than failing
 * the whole sweep; `undefined` is exactly the "no snapshot, no gate" signal
 * `materialize-mcq.ts` already treats every other optional field on
 * `DraftRecord` as.
 *
 * **`sourceCitation.passageDigest` (`[D-446]` option (a), `ol-egov.141.89.2.5`).** The citation
 * this sweep builds names the source and page only. A passage digest is added at draft time
 * (`grounding-passage.ts`) exactly where the passage the drafted items rest on can be named
 * without guessing: the request supplied ONE chunk, and that chunk stands as exactly one passage
 * of the cited markdown note (the shared rule, `olea-core`'s `citePassage`). With several chunks
 * (the usual case) nothing in the response says which one an item used, so no digest is written
 * and the item keeps whole-note grain (or the accept-time seal's single-passage mint) — the
 * top-ranked chunk is never taken. Naming it for those drafts needs the response to cite its
 * chunk: a wire change, filed as a bead.
 *
 * **Explicit recall intent, for this sweep only (`[D-437]`, decision-sheet row 38,
 * `ol-egov.141.89.2.20`).** Every ask the sweep makes carries `intendedDemand: 'recall-a-fact'`
 * (`SWEEP_RECALL_ASK`, routed against `quiz.generate.v1` like any other ask, and sent through
 * `authoringDemandFields`), because the sweep is meant to generate recall practice. It is
 * **authoring intent only**: it does not establish recall coverage or recall evidence, no other
 * origin (a heading offer, a revision, a planner need, a paper slot) sends the constant
 * (`olea-core`'s `demand-ask-callers.spec.ts` pins the caller list), and whether the produced
 * instrument offers answer options, hence reads as recognition rather than free recall, is read
 * from the block, never stored (`instrument/demand-reading.ts`). The intent is part of the refusal
 * memory's demand key (`sweepDemandKey`) so a changed intent reads as a changed demand, and each ask
 * is counted per concept and reason (`GenerationPipelineDeps.demandCounter`). The sufficiency judge
 * is also told the operation (`intendedOperation: 'define'`), which adds one line to the judge's
 * prompt: a stratification input by the service's own account, and a change to what the judge reads
 * that the operating-point measurement should be aware of.
 *
 * **The demand travels on each cached draft (`[D-437]`, `ol-egov.141.89.2.30`).** Each record this
 * sweep caches carries `DraftRecord.demand` (origin `sweep`), stamped by {@link draftDemandForQuestion}
 * from the request the drafting call actually sent (`result.request`) and the response it returned:
 * the intent, the server's acknowledgement (absent from an older Worker) and that question's own
 * declaration, by position. A request that carried no demand stamps nothing, so the record has no
 * `demand` key and stays unspecified. `accept.ts` forwards the field and the materialisers write the
 * one target record, judging it there; the sweep decides only the one thing that is a draft-time
 * fact. **A question whose own declaration disagrees with the demand asked is an invalid draft
 * (design section 4.4; Class B, reversible):** the client sweep has no repair loop, so it is not
 * cached, is counted in {@link draftDemandRefusalCounterFor}, and the concept is revisited next
 * sweep exactly as after an unparseable reply (a concept whose every question is refused is not
 * counted as drafted). An old Worker's response is never a mismatch: with no acknowledgement the
 * draft is cached unacknowledged and materialises unspecified.
 */

import type {
  ConceptRecord,
  ExtractedUnit,
  GroundingRefusalReason,
  InstrumentCitation,
  RoutingSelectionObservation,
  VaultSource,
} from 'olea-core';
import {
  type AuthoringDemandFields,
  authoringDemandFields,
  courseFromPath,
  DEFAULT_COURSES_FOLDER,
  DemandRoutingCounter,
  hashText,
  judgeDraftedDemand,
  type PaperDemand,
  routeDemandAsk,
} from 'olea-core';
// The sweep's recall constant is deliberately NOT in the `olea-core` barrel (row 38: authoring
// intent for this sweep and no other path; `packages/core/src/routing/demand-ask-callers.spec.ts`
// pins its callers by source text), so this one import stays a deliberate deep one.
import { SWEEP_RECALL_ASK } from 'olea-core/src/routing/demand-ask.js';
import { describeRefusal, type RefusalCopy } from '../retrieval/draft-cards-copy.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../retrieval/draft-quiz-cards.js';
import { draftQuizCardsForConcept } from '../retrieval/draft-quiz-cards.js';
import type { DraftCacheStore } from './cache-store.js';
import { deriveDraftId } from './cache-store.js';
import { MAX_CONCEPTS_PER_SWEEP } from './constants.js';
import {
  type DraftedDemandCarry,
  draftDemandCarriage,
  draftedDemandFactsOf,
  extractDraftedDemand,
} from './draft-demand.js';
import { CITED_CHUNK_DIGEST_ENABLED, withGroundingPassage } from './grounding-passage.js';
import { ensureHomeNoteForConcept, hashSourceRevision } from './home-note.js';
import {
  extractDraftedGroundedIn,
  extractDraftedProvenance,
  extractDraftedQuestions,
} from './response.js';
import type { GenerationRoutingDeps } from './routing.js';
import {
  buildConceptInstrumentInventory,
  classifyForRouting,
  decideConceptRouting,
  EMPTY_INVENTORY,
  quizDeficit,
} from './routing.js';
import type { DraftDemandCarriage, DraftDemandOrigin, DraftRecord } from './types.js';

export type { GenerationRoutingDeps };

export interface GenerationPipelineDeps {
  readonly vault: VaultSource;
  readonly cache: DraftCacheStore;
  readonly draftDeps: DraftQuizCardsDeps;
  /** Normally `(courseCode) => extractConcepts(vault, { under: \`${coursesFolder}/${courseCode}\` })` — injected so `pipeline.spec.ts` never has to build a real vault to test pacing/dedupe/refusal handling. */
  readonly listConceptsForCourse: (courseCode: string) => Promise<readonly ConceptRecord[]>;
  /** Defaults to the real `draftQuizCardsForConcept` — injected so `pipeline.spec.ts` can fake grounded/refused outcomes without a real Worker or embedding cache. `wiring.ts` never overrides this. */
  readonly draftForConcept?: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>;
  readonly coursesFolder?: string;
  readonly now?: () => Date;
  /**
   * Defaults to `deriveDraftId` (`cache-store.ts`) — deterministic from
   * `(courseCode, conceptName, sequence)`, `sequence` being this question's
   * position within the current `draftForConcept` call's output. That
   * determinism is what lets `findByKey`'s path probe bypass `index.json`
   * (`ol-zbnn`); a caller overriding this loses that bypass for its own
   * drafts (nothing in this module or `findByKey` requires it — the index
   * fallback still covers a non-deterministic id).
   */
  readonly generateDraftId?: (
    courseCode: string,
    conceptName: string,
    sequence: number,
  ) => string | Promise<string>;
  /** Component 2.2's routing consultation — see the module doc's own section. Omitted preserves pre-`ol-tz7v` behaviour. */
  readonly routing?: GenerationRoutingDeps;
  /**
   * F4.8/`[D-188]`'s purpose-at-build capability (`ol-0r92.35`), opt-in the
   * same way `routing` above is — see the module doc's own section. Absent
   * because assembling this from her actual assignments table plus
   * classified past-paper/instructor material is `main.ts`'s composition-
   * root job (the same "reachability deferred, documented rather than
   * silently absent" posture `classify-passage.ts`'s own module doc records
   * for `classifyPassage`), and no such wiring exists yet. Called at most
   * once per course this sweep visits (never per concept — purpose is a
   * property of the course's nearest assessment, not of any one concept). A
   * non-`undefined` result marks every `quiz.generate.v1` build for that
   * course as format-matched: `quiz.generate.v1` always builds MCQ, and
   * `'recall-style'` is the one of the three declared classes F4.8 maps a
   * `type` to (`[D-246]` / `[VOC-7]`, `assessment/format-class.ts`'s
   * `formatClassOf`) that prefers it, so a course whose nearest assessment
   * resolves to `'recall-style'` has every quiz drafted for it built in that
   * assessment's register (F3.8's purpose clause, `[D-188]`). Absent, or
   * returning `undefined` for a given course, leaves `purpose` unset on that
   * course's requests — the service then defaults to `'learning'`, her own
   * voice, unchanged from before this bead.
   */
  readonly formatMatch?: (courseCode: string) => FormatMatchDecision | undefined;
  /**
   * What earlier sweeps learned about refusals that reached the judge
   * (`ol-egov.141.89.2.17`) — see `GenerationRefusalMemory`. Absent, the sweep uses
   * `refusalMemoryFor(deps.cache)`: one memory per draft cache instance, which is
   * exactly as long-lived as the plugin session in production (`wiring.ts` builds the
   * cache once), so no caller has to thread anything for the fix to apply. A test or a
   * caller that wants an isolated or shared memory supplies its own.
   */
  readonly refusalMemory?: GenerationRefusalMemory;
  /**
   * Where this sweep counts each ask's routing outcome, per concept and per reason
   * (`[D-437]`, design §4.1). Absent, the sweep uses `demandRoutingCounterFor(deps.cache)`: one
   * counter per draft cache instance, as long-lived as the plugin session in production, the same
   * arrangement as `refusalMemory` above. Local and in memory, keyed by the opaque concept key
   * (D-005): never persisted and never sent anywhere. No production reader of the counts exists yet
   * (an instrumentation surface is a later bead); the counter is what one would read.
   */
  readonly demandCounter?: DemandRoutingCounter;
  /**
   * `[D-446]` (`ol-egov.141.89.2.29`): whether a question's `groundedIn` citation may name the
   * passage its draft rests on (see `grounding-passage.ts`). Absent, `CITED_CHUNK_DIGEST_ENABLED`
   * decides, which is `false` until the wrong-citation rate is measured; the composition root
   * (`wiring.ts`) does not set it. A test sets it to exercise the cited path.
   */
  readonly citedChunkDigest?: boolean;
}

/**
 * What `deps.formatMatch` returns for a course whose nearest assessment is
 * format-matched (F4.8, `[D-188]`). `registerHint` mirrors
 * `DraftQuizCardsRequest`'s own field one-for-one — see that type's doc
 * (`draft-quiz-cards.ts`) for what each half means and the plain-declarative
 * fallback when `sentenceShapes` is absent.
 */
export interface FormatMatchDecision {
  readonly registerHint?: {
    readonly terminology: readonly string[];
    readonly sentenceShapes?: readonly string[];
  };
}

/**
 * `[H-1.8a]` (`ol-0r92.71`, component register row 1.8a, C4.7 / `[D-089]`)
 * — one refused concept's classification, computed by `describeRefusal`
 * (`draft-cards-copy.ts`) instead of being dropped with only a count. *Not
 * a cache entry* — a refused concept still gets none (F4.5's
 * grounded-by-construction argument, unchanged by this bead); this is
 * purely the copy a caller could render for the refusal she would otherwise
 * never see. Whether it is asked again next sweep depends on the refusal's
 * kind (module doc, `ol-egov.141.89.2.17`).
 */
export interface GenerationRefusalNotice {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly reason: string;
  readonly copy: RefusalCopy;
}

export interface GenerationSweepReport {
  /** Concepts a drafting call was actually made for this sweep — always `<= MAX_CONCEPTS_PER_SWEEP`. */
  readonly attempted: number;
  /** Of those, how many produced a cached draft. */
  readonly drafted: number;
  /** Of those, how many refused (no transport send, per `draftQuizCardsForConcept`'s own guarantee) — whether a later sweep asks again depends on the kind of refusal (module doc). */
  readonly refused: number;
  /**
   * `[H-1.8a]` (`ol-0r92.71`): one entry per concept counted in `refused`
   * above — plus, since `ol-egov.141.89.2.17`, one per concept counted in
   * `skippedRefused` below (a standing refusal carried from memory rather than
   * re-asked, so the list she sees does not lose an entry the sweep chose not to
   * pay for again) — carrying `describeRefusal`'s classified two-headline copy —
   * component register row 1.8a's own falsifier is that this classification
   * happens at all, rather than the refusal being dropped silently.
   * `BulkReviewView` (`generation/bulk-review-view.ts`) can now render this
   * list — see its own `renderRefusals` doc for the two-state, transient-
   * flagged copy it draws from this field. **Still no PRODUCTION caller
   * populates the render, though**: `main.ts`'s `onUnitsLanded` awaits
   * `GenerationWiring.sweep(...)` and discards the returned report (see that
   * method's own call site), so nothing today carries a live sweep's
   * `refusals` into the `BulkReviewView` it constructs. That capture-and-
   * thread step is a `main.ts` composition-root change outside this bead's
   * owned paths (`pipeline.ts`, `draft-cards-copy.ts`, `bulk-review-view.ts`)
   * — see this bead's close evidence for the named follow-up.
   */
  readonly refusals: readonly GenerationRefusalNotice[];
  /** Concepts skipped because the cache already has a record for that (course, concept) pair. */
  readonly skippedDuplicate: number;
  /**
   * `ol-egov.141.89.2.17`: concepts NOT asked this sweep because an earlier sweep's
   * refusal that reached the judge still stands on unchanged evidence and demand (see
   * the module doc). Not counted in `attempted` or `refused` — no ask was made — but
   * each has its notice in `refusals`. `attempted` + `skippedDuplicate` + `skippedRouting`
   * + `skippedRefused` account for every candidate the sweep reached, each once.
   */
  readonly skippedRefused: number;
  /** Concepts routing (`deps.routing`) determined do not currently warrant this sweep's one generation capability — never drafted, never cached, so re-consulted next sweep. Always `0` when `deps.routing` is absent. */
  readonly skippedRouting: number;
  /**
   * `[MOM-8.1 / BD-1]` (`ol-3ux7.5.57.9.1`) — component register row 2.2's
   * "does the classification reach selection?" health check reads this.
   * One entry per candidate that reached the selection point this sweep
   * (cache-deduped candidates never got there, so they are absent), in the
   * order selection considered them. Content-free by construction (INV-3):
   * a knowledge-kind label, a deficit, two booleans — never a concept name,
   * key, course code or path. Fed to `olea-core`'s
   * `checkRoutingReachesSelection` (`checks/routing-consumption.ts`), which
   * goes red when `consulted` is `false` (routing bypassed) or when a zero
   * deficit was generated for anyway (routing overruled). Empty when the
   * sweep considered nothing — which that check reads as red, not green.
   */
  readonly routingObservations: readonly RoutingSelectionObservation[];
}

const ZERO_REPORT: GenerationSweepReport = {
  attempted: 0,
  drafted: 0,
  refused: 0,
  skippedDuplicate: 0,
  skippedRefused: 0,
  skippedRouting: 0,
  routingObservations: [],
  refusals: [],
};

/**
 * How many times a concept refused `judge-unavailable` is asked on unchanged evidence
 * before the sweep stops asking: the original plus one automatic retry — the same shape
 * `[D-400]` rules for a lost materiality check ("one additional automatic retry per
 * original check", then a recoverable deferred state and no further automatic retry).
 * Declared, not fitted: one retry rides out a transient outage without a second paid
 * call for the same absent evidence. (Its home by convention is `constants.ts`, which
 * this bead does not own.)
 */
export const MAX_JUDGE_UNAVAILABLE_ATTEMPTS = 2;

/** The two refusal kinds that reach the judge, and so are held rather than retried each sweep. */
type StandingKind = 'checked-insufficient' | 'judge-unavailable';

function standingKindOf(reason: GroundingRefusalReason): StandingKind | null {
  if (reason === 'judge-rejected') return 'checked-insufficient';
  if (reason === 'judge-unavailable') return 'judge-unavailable';
  return null;
}

interface StandingRefusal {
  readonly reason: GroundingRefusalReason;
  readonly kind: StandingKind;
  /** What was being asked for (`purpose`/`registerHint`); a different demand is a new question. */
  readonly demand: string;
  /** Every evidence piece present at some refusal of this kind under this demand — opaque digests, never content. */
  readonly seen: ReadonlySet<string>;
  /** Consecutive asks on unchanged evidence that ended in this kind. */
  readonly attempts: number;
  /** `GenerationRefusalMemory.judgeAnswers` when this was last recorded (`judge-unavailable`'s release signal). */
  readonly epoch: number;
}

/**
 * What the sweep has learned about refusals that reached the judge (`ol-egov.141.89.2.17`)
 * — see the module doc for the policy this carries out. In-process only: never persisted,
 * never sent anywhere, holding only opaque keys and digests (INV-3, D-005).
 *
 * The sweep is the only caller of everything except `release`. `release` is the seam for
 * an explicit retry (`[D-420]`'s shape for the materiality recheck): no surface calls it
 * today, and adding one needs its own clause (CLAUDE.md, "No user-visible affordance
 * without a clause").
 */
export class GenerationRefusalMemory {
  private readonly standing = new Map<string, StandingRefusal>();
  private readonly lastAsked = new Map<string, number>();
  private sweeps = 0;
  private judgeAnswers = 0;

  private static key(courseCode: string, conceptKey: string): string {
    return `${courseCode}\u0000${conceptKey}`;
  }

  /** Starts a sweep and returns its ordinal (1 for the first). */
  beginSweep(): number {
    this.sweeps += 1;
    return this.sweeps;
  }

  /** The sweep ordinal this concept was last asked in, `0` if never — the rotation order. */
  lastAskedAt(courseCode: string, conceptKey: string): number {
    return this.lastAsked.get(GenerationRefusalMemory.key(courseCode, conceptKey)) ?? 0;
  }

  noteAsked(courseCode: string, conceptKey: string, sweep: number): void {
    this.lastAsked.set(GenerationRefusalMemory.key(courseCode, conceptKey), sweep);
  }

  standingFor(courseCode: string, conceptKey: string): StandingRefusal | undefined {
    return this.standing.get(GenerationRefusalMemory.key(courseCode, conceptKey));
  }

  /** Whether a standing refusal still applies to this ask: same demand, no evidence piece not yet seen, and (for `judge-unavailable`) attempts spent with no judge answer since. */
  holds(
    courseCode: string,
    conceptKey: string,
    demand: string,
    pieces: readonly string[],
  ): boolean {
    const entry = this.standingFor(courseCode, conceptKey);
    if (entry === undefined) return false;
    if (entry.demand !== demand) return false;
    if (!pieces.every((piece) => entry.seen.has(piece))) return false;
    if (entry.kind === 'checked-insufficient') return true;
    return entry.attempts >= MAX_JUDGE_UNAVAILABLE_ATTEMPTS && entry.epoch === this.judgeAnswers;
  }

  /** Records how an ask ended: a standing kind is remembered, anything else clears the concept's entry. */
  recordOutcome(
    courseCode: string,
    conceptKey: string,
    outcome: { readonly reason: GroundingRefusalReason } | null,
    demand: string,
    pieces: readonly string[],
  ): void {
    const key = GenerationRefusalMemory.key(courseCode, conceptKey);
    const kind = outcome === null ? null : standingKindOf(outcome.reason);
    if (outcome === null || kind === null) {
      this.standing.delete(key);
      return;
    }
    const previous = this.standing.get(key);
    const sameDemand = previous !== undefined && previous.demand === demand;
    const unchanged =
      sameDemand && previous.kind === kind && pieces.every((piece) => previous.seen.has(piece));
    this.standing.set(key, {
      reason: outcome.reason,
      kind,
      demand,
      seen: new Set([...(sameDemand ? previous.seen : []), ...pieces]),
      attempts: unchanged ? previous.attempts + 1 : 1,
      epoch: this.judgeAnswers,
    });
  }

  /** The judge answered something (a verdict or a draft): a `judge-unavailable` concept has earned one more retry. */
  noteJudgeAnswered(): void {
    this.judgeAnswers += 1;
  }

  /**
   * Explicit retry: forgets the standing refusal for one concept (`conceptKey`), one
   * course (`courseCode` alone) or everything (no filter), so the next sweep asks again.
   * Returns how many were released.
   */
  release(filter: { readonly courseCode?: string; readonly conceptKey?: string } = {}): number {
    let released = 0;
    for (const key of [...this.standing.keys()]) {
      const [courseCode, conceptKey] = key.split('\u0000');
      if (filter.courseCode !== undefined && filter.courseCode !== courseCode) continue;
      if (filter.conceptKey !== undefined && filter.conceptKey !== conceptKey) continue;
      this.standing.delete(key);
      released += 1;
    }
    return released;
  }
}

const memoryByCache = new WeakMap<DraftCacheStore, GenerationRefusalMemory>();

/**
 * The refusal memory a sweep uses when `deps.refusalMemory` is absent: one per draft
 * cache instance. `wiring.ts` builds the cache once per plugin session, so every sweep
 * of a session shares it without any caller threading it through.
 */
export function refusalMemoryFor(cache: DraftCacheStore): GenerationRefusalMemory {
  let memory = memoryByCache.get(cache);
  if (memory === undefined) {
    memory = new GenerationRefusalMemory();
    memoryByCache.set(cache, memory);
  }
  return memory;
}

const demandCounterByCache = new WeakMap<DraftCacheStore, DemandRoutingCounter>();

/**
 * The demand-routing counter an origin uses when it has none injected: one per draft cache
 * instance. `wiring.ts` builds the cache once per plugin session, so the sweep and the heading offer
 * (which is handed the same cache) share one count without any caller threading it through. The
 * same lifetime argument as `refusalMemoryFor`.
 */
export function demandRoutingCounterFor(cache: DraftCacheStore): DemandRoutingCounter {
  let counter = demandCounterByCache.get(cache);
  if (counter === undefined) {
    counter = new DemandRoutingCounter();
    demandCounterByCache.set(cache, counter);
  }
  return counter;
}

/**
 * How many drafted questions were refused at draft time for declaring a different demand than the
 * one asked (`[D-437]`, design section 4.4), per opaque concept key. Local and in memory, like
 * `DemandRoutingCounter` (D-005: keys only, never content); nothing is persisted or sent, and nothing
 * reads it yet beyond the tests, exactly as the routing counter's own doc says of that one. A
 * question is counted where it is refused, once, by whichever origin drafted it.
 */
export class DraftDemandRefusalCounter {
  private readonly counts_ = new Map<string, number>();

  /** Counts one refused question against `conceptKey`. */
  record(conceptKey: string): void {
    this.counts_.set(conceptKey, (this.counts_.get(conceptKey) ?? 0) + 1);
  }

  /** Every non-zero count, ordered by concept key. */
  counts(): readonly { readonly conceptKey: string; readonly count: number }[] {
    return [...this.counts_.keys()].sort().map((conceptKey) => ({
      conceptKey,
      count: this.counts_.get(conceptKey) ?? 0,
    }));
  }

  /** The count across every concept. */
  total(): number {
    let total = 0;
    for (const count of this.counts_.values()) total += count;
    return total;
  }
}

const draftDemandRefusalCounterByCache = new WeakMap<DraftCacheStore, DraftDemandRefusalCounter>();

/**
 * The refusal counter every origin uses: one per draft cache instance, so the sweep, the heading
 * offer and the revision runner (each handed the one cache `wiring.ts` builds per plugin session)
 * count into one place with no caller threading it through. The same lifetime argument as
 * `demandRoutingCounterFor`.
 */
export function draftDemandRefusalCounterFor(cache: DraftCacheStore): DraftDemandRefusalCounter {
  let counter = draftDemandRefusalCounterByCache.get(cache);
  if (counter === undefined) {
    counter = new DraftDemandRefusalCounter();
    draftDemandRefusalCounterByCache.set(cache, counter);
  }
  return counter;
}

/**
 * The demand members of a drafting request payload as the payload types them: the authoring wire's
 * optional members can be present-and-`undefined`, which `extractDraftedDemand`'s stricter reader
 * (`exactOptionalPropertyTypes`) does not accept.
 */
export interface SentDemandFields {
  readonly intendedDemand?: PaperDemand | undefined;
  readonly requestedAsk?:
    | { readonly heading: string; readonly questionWord?: string | undefined }
    | undefined;
}

/**
 * What one drafting call carried and returned about demand (`[D-437]`, `ol-egov.141.89.2.30`):
 * `extractDraftedDemand` over the request payload the call actually sent (`result.request`) and the
 * raw response, with the payload's members copied only where present. The one adapter all three
 * builders read through, so none of them types the request twice.
 */
export function draftedDemandCarryOf(
  request: SentDemandFields,
  response: unknown,
): DraftedDemandCarry {
  const ask = request.requestedAsk;
  return extractDraftedDemand(
    {
      ...(request.intendedDemand === undefined ? {} : { intendedDemand: request.intendedDemand }),
      ...(ask === undefined
        ? {}
        : {
            requestedAsk: {
              heading: ask.heading,
              ...(ask.questionWord === undefined ? {} : { questionWord: ask.questionWord }),
            },
          }),
    },
    response,
  );
}

/**
 * What a draft builder does with the question at `questionIndex` of one drafting call (`[D-437]`,
 * `ol-egov.141.89.2.30`): cache it, with the demand it carries when the request carried one, or
 * refuse it at draft time.
 *
 * `questionIndex` is the question's POSITION in the response (the same order `extractDraftedQuestions`
 * walks), never a count of records cached so far, because a refused question earlier in the list
 * must not shift the declaration read for a later one.
 *
 * The only refusal is `olea-core`'s own check, `judgeDraftedDemand`: an acknowledged demand whose
 * question declared a different one, or none. A request with no demand, and a response with no
 * acknowledgement (an older Worker), are never refused; the first stamps nothing and the second
 * stamps the carriage unacknowledged, which the materialiser reads as unspecified. This function
 * only moves facts and applies that one check; it records nothing as delivered (row 36).
 */
export function draftDemandForQuestion(
  carry: DraftedDemandCarry,
  questionIndex: number,
  origin: DraftDemandOrigin,
):
  | { readonly kind: 'cache'; readonly demand?: DraftDemandCarriage }
  | { readonly kind: 'refused' } {
  const demand = draftDemandCarriage(carry, questionIndex, origin);
  if (demand === undefined) return { kind: 'cache' };
  if (judgeDraftedDemand(draftedDemandFactsOf(demand)).kind === 'refused') {
    return { kind: 'refused' };
  }
  return { kind: 'cache', demand };
}

/**
 * The refusal memory's demand key for a sweep ask: what is being asked for, so a refusal is held
 * only while the ask is unchanged. `purpose` and `registerHint` as before (`learning`, or
 * `readiness:` and the hint), plus the intended demand now that the sweep sends one, so a changed
 * intent reads as a changed demand and is not held. With no intent the key is exactly what it was
 * before the sweep carried one.
 */
export function sweepDemandKey(
  courseFormatMatch: FormatMatchDecision | undefined,
  fields: AuthoringDemandFields,
): string {
  const purposeKey =
    courseFormatMatch === undefined
      ? 'learning'
      : `readiness:${JSON.stringify(courseFormatMatch.registerHint ?? null)}`;
  return fields.intendedDemand === undefined
    ? purposeKey
    : `${purposeKey}|intended:${fields.intendedDemand}`;
}

function defaultGenerateDraftId(
  courseCode: string,
  conceptName: string,
  sequence: number,
): Promise<string> {
  return deriveDraftId(courseCode, conceptName, sequence);
}

/** Every distinct note path that embedded at least one of `units` (F1.6). */
function embeddingNotePaths(units: readonly ExtractedUnit[]): readonly string[] {
  const seen = new Set<string>();
  for (const unit of units) {
    const notePath = unit.provenance.embeddedIn?.notePath;
    if (notePath !== undefined) seen.add(notePath);
  }
  return [...seen].sort();
}

/**
 * Every distinct source path among `units` that landed with no embedding
 * note (F3.1's bare-drop case, `[D-179]`) — each is a candidate for its own
 * Olea-owned home note, created or reused by `ensureHomeNoteForConcept`.
 */
function standaloneSourcePaths(units: readonly ExtractedUnit[]): readonly string[] {
  const seen = new Set<string>();
  for (const unit of units) {
    if (unit.provenance.embeddedIn === undefined) seen.add(unit.provenance.sourcePath);
  }
  return [...seen].sort();
}

/**
 * `[D-181]`/`ol-2zfj.52`: `ExtractedUnit.provenance` at `InstrumentCitation`'s grain — the source
 * document's own `sourcePath` plus `location.page`/`.section`, never `location.charRange` (the
 * sidecar this feeds has nowhere to keep a char offset — see `citation-store.ts`'s module doc) and
 * never the unit's `embeddedIn` note (that is the *destination* `DraftRecord.sourcePath` already
 * names, not the cited passage).
 */
function citationFromUnit(unit: ExtractedUnit): InstrumentCitation {
  const { location } = unit.provenance;
  return {
    sourcePath: unit.provenance.sourcePath,
    page: location.page,
    ...(location.section !== undefined ? { section: location.section } : {}),
  };
}

/**
 * `ol-egov.141.89.2.17`: one opaque digest per unit that landed for `courseCode` in this
 * sweep — its source, page and extracted text — so new or changed material (and only
 * that) reads as new evidence. Never the text itself (INV-3, D-005).
 */
async function unitEvidencePieces(
  units: readonly ExtractedUnit[],
  courseCode: string,
  coursesFolder: string,
): Promise<readonly string[]> {
  const pieces: string[] = [];
  for (const unit of units) {
    const home = unit.provenance.embeddedIn?.notePath ?? unit.provenance.sourcePath;
    if (courseFromPath(home, coursesFolder) !== courseCode) continue;
    const { sourcePath, location } = unit.provenance;
    pieces.push(`unit:${await hashText(`${sourcePath}\u0000${location.page}\u0000${unit.text}`)}`);
  }
  return pieces;
}

/** A content digest of one vault path, `absent` when it cannot be read — never throws ("never throws" holds for the whole sweep). */
async function digestOfPath(vault: VaultSource, path: string): Promise<string> {
  try {
    return (await vault.exists(path)) ? await hashText(await vault.read(path)) : 'absent';
  } catch {
    return 'absent';
  }
}

/**
 * Runs one sweep over the units one ingestion job just produced (or, when a
 * caller wants a course-wide catch-up, any batch of previously-accumulated
 * units — see `wiring.ts`). Never throws: a drafting call's own failure
 * (a Worker error, a malformed response) is caught per-concept so one bad
 * concept cannot stop the rest of the sweep or the ingestion tick it rides
 * on.
 */
export async function runGenerationSweep(
  units: readonly ExtractedUnit[],
  deps: GenerationPipelineDeps,
): Promise<GenerationSweepReport> {
  const notePaths = embeddingNotePaths(units);
  const sourcePaths = standaloneSourcePaths(units);
  if (notePaths.length === 0 && sourcePaths.length === 0) return ZERO_REPORT;

  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const courseCodes = new Set<string>();
  for (const notePath of notePaths) {
    const course = courseFromPath(notePath, coursesFolder);
    if (course !== undefined) courseCodes.add(course);
  }
  for (const sourcePath of sourcePaths) {
    const course = courseFromPath(sourcePath, coursesFolder);
    if (course !== undefined) courseCodes.add(course);
  }
  if (courseCodes.size === 0) return ZERO_REPORT;

  const generateDraftId = deps.generateDraftId ?? defaultGenerateDraftId;
  const now = deps.now ?? (() => new Date());
  const draftForConcept = deps.draftForConcept ?? draftQuizCardsForConcept;
  const routing = deps.routing;
  const formatMatch = deps.formatMatch;
  const memory = deps.refusalMemory ?? refusalMemoryFor(deps.cache);
  const citedChunkDigest = deps.citedChunkDigest ?? CITED_CHUNK_DIGEST_ENABLED;
  const sweepOrdinal = memory.beginSweep();
  // `[D-437]` row 38: the sweep's explicit recall intent, routed like any other ask. Routed once:
  // the constant and the generator are both fixed for the whole sweep.
  const demandCounter = deps.demandCounter ?? demandRoutingCounterFor(deps.cache);
  const sweepRouting = routeDemandAsk(SWEEP_RECALL_ASK, 'quiz.generate.v1');
  const sweepDemandFields = authoringDemandFields(sweepRouting);

  // Built at most once per sweep, and only if routing was actually opted
  // into — a real vault walk (`enumerateVaultInstruments`) is not worth
  // paying when every candidate ends up cache-deduped anyway, or when no
  // caller asked for routing at all.
  let inventoryPromise: ReturnType<typeof buildConceptInstrumentInventory> | null = null;
  const getInventory = (): ReturnType<typeof buildConceptInstrumentInventory> => {
    inventoryPromise ??= buildConceptInstrumentInventory(deps.vault, { under: coursesFolder });
    return inventoryPromise;
  };

  // `[MOM-8.1 / BD-1]`: what selection actually did, one entry per candidate
  // that reached the routing consultation point — see
  // `GenerationSweepReport.routingObservations`.
  const routingObservations: RoutingSelectionObservation[] = [];

  let attempted = 0;
  let drafted = 0;
  let refused = 0;
  let skippedDuplicate = 0;
  let skippedRefused = 0;
  let skippedRouting = 0;
  // `[H-1.8a]`: one classified entry per refusal — see `GenerationSweepReport.refusals`' own doc.
  const refusals: GenerationRefusalNotice[] = [];

  for (const courseCode of [...courseCodes].sort()) {
    if (attempted >= MAX_CONCEPTS_PER_SWEEP) break;

    const candidates = await deps.listConceptsForCourse(courseCode);
    // Stable order (by name) so which concepts win the per-sweep cap does
    // not depend on `extractConcepts`' own internal iteration order.
    const sorted = [...candidates].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // `ol-egov.141.89.2.17`: among concepts asked before, the one asked longest ago goes
    // first (never-asked concepts, name order, before all of them), so refusals that stay
    // retryable rotate through the cap instead of the same first few taking it every
    // sweep. With no memory of earlier asks this is exactly the name order above.
    const rotated = sorted
      .map((candidate, index) => ({
        candidate,
        index,
        askedAt: memory.lastAskedAt(courseCode, candidate.key),
      }))
      .sort((a, b) => a.askedAt - b.askedAt || a.index - b.index)
      .map((entry) => entry.candidate);

    // F4.8/`[D-188]`'s purpose-at-build capability (`ol-0r92.35`), opt-in —
    // see the module doc's own section on `deps.formatMatch`. Called once
    // per course, not per concept: purpose is a property of the course's
    // nearest assessment, never of any one concept's material.
    const courseFormatMatch = formatMatch?.(courseCode);

    // D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit): this
    // course's embedding-note path and its CURRENT content digest, computed
    // once per course (not per candidate — every candidate in the embedded
    // case shares one note) and passed as `findByKey`'s version expectation
    // below, so a materiality-confirmed change to the note is never masked
    // by an older, now-stale cached draft. Deliberately NOT the same read as
    // the per-candidate `sourceContentHash` further down (`ol-0r92.87`'s
    // stale-input guard) — that one is taken immediately before caching, as
    // fresh as possible; this one is only a dedup-time comparison and an
    // extra, harmless vault read here costs nothing this module doesn't
    // already spend elsewhere.
    //
    // Bare drops (no embedding note for this course — `[D-179]`'s home-note
    // case) get no digest here: the home note that WOULD ground the
    // comparison is itself created lazily, only once a draft is actually
    // about to be cached (this module's own doc) — hashing it early would
    // force that creation eagerly for a candidate that turns out to be a
    // duplicate, which this bead does not change. `expected` stays
    // version-blind for `promptVersion` for every candidate, embedded or
    // not: the client has no way to know `quiz.generate`/`cards.generate`'s
    // currently-configured prompt version ahead of a live response
    // (`DraftRecord.provenance.promptVersion` is server-stamped, D7.3, and
    // the private service repo's `prompts/quiz.generate/VERSION` is not
    // reachable from this repo) — see this bead's report for the proposed
    // follow-up rather than a guessed value that could silently mislead a
    // spend decision either direction.
    const courseNotePath = notePaths.find(
      (path) => courseFromPath(path, coursesFolder) === courseCode,
    );
    const courseSourceContentHash =
      courseNotePath !== undefined && (await deps.vault.exists(courseNotePath))
        ? await hashText(await deps.vault.read(courseNotePath))
        : undefined;
    const courseVersionExpectation =
      courseSourceContentHash === undefined
        ? undefined
        : { sourceContentHash: courseSourceContentHash };

    // `ol-egov.141.89.2.17`: what this ask would be made on, as opaque digests — the
    // material that landed for this course this sweep, the embedding note, and the
    // concept's own source notes — and what is being asked for. A refusal that reached
    // the judge is held only while nothing here is new (`GenerationRefusalMemory.holds`).
    // The demand is `purpose`/`registerHint` and, since decision-sheet row 38, the sweep's
    // explicit recall intent (`ol-egov.141.89.2.20`): an intent that joined the ask must join
    // this key, or a changed demand would read as unchanged and stay held.
    const demand = sweepDemandKey(courseFormatMatch, sweepDemandFields);
    let courseUnitPieces: Promise<readonly string[]> | null = null;
    const evidencePieces = async (candidate: ConceptRecord): Promise<readonly string[]> => {
      courseUnitPieces ??= unitEvidencePieces(units, courseCode, coursesFolder);
      const pieces = [...(await courseUnitPieces), `note:${courseSourceContentHash ?? 'absent'}`];
      for (const path of candidate.sourcePaths) {
        pieces.push(`source:${await hashText(path)}:${await digestOfPath(deps.vault, path)}`);
      }
      return pieces;
    };

    // Held first, for the whole course and before the cap: a held concept costs no ask and
    // uses no cap, and reporting all of them here keeps the refusal list she sees the same
    // whichever concepts the cap then reaches.
    const held = new Set<string>();
    for (const candidate of sorted) {
      if (!candidate.courses.includes(courseCode)) continue;
      const standing = memory.standingFor(courseCode, candidate.key);
      if (standing === undefined) continue;
      // A cached draft wins over any memory of a refusal — the loop below counts it as a duplicate.
      if (
        (await deps.cache.findByKey(courseCode, candidate.name, courseVersionExpectation)) !== null
      ) {
        continue;
      }
      if (!memory.holds(courseCode, candidate.key, demand, await evidencePieces(candidate)))
        continue;
      held.add(candidate.key);
      skippedRefused += 1;
      refusals.push({
        courseCode,
        conceptName: candidate.name,
        reason: standing.reason,
        copy: describeRefusal(standing.reason),
      });
    }

    for (const candidate of rotated) {
      if (attempted >= MAX_CONCEPTS_PER_SWEEP) break;
      if (!candidate.courses.includes(courseCode)) continue;
      if (held.has(candidate.key)) continue;

      const existing = await deps.cache.findByKey(
        courseCode,
        candidate.name,
        courseVersionExpectation,
      );
      if (existing !== null) {
        skippedDuplicate += 1;
        continue;
      }
      // D-381's clarification: `existing === null` above means either
      // genuinely nothing cached yet, or a stale record `findByKey` just
      // declined to treat as blocking. The two cases MUST draft under
      // different ids — see `staleRecordExists`'s use below and
      // `deriveDraftId`'s own doc for why, and INV-2/D-381: an existing
      // draft record (accepted or not) is never silently overwritten by a
      // fresh one landing on the same deterministic path.
      const staleRecordExists =
        courseVersionExpectation === undefined
          ? false
          : (await deps.cache.findByKey(courseCode, candidate.name)) !== null;

      // Component 2.2's routing consultation (`ol-tz7v` / `[WIRE-7]`),
      // opt-in — see the module doc. Costs a classify call (only when a
      // classifier is actually configured; `classifyForRouting` short-
      // circuits to unclassified otherwise) plus one shared inventory walk,
      // never a `quiz.generate.v1` send: a candidate this routes away from
      // is cheaper to discover here than as a refusal.
      if (routing !== undefined) {
        const classification = await classifyForRouting(routing, deps.vault, candidate);
        const inventory = (await getInventory()).get(candidate.key) ?? EMPTY_INVENTORY;
        const decision = decideConceptRouting(classification, inventory);
        const deficit = quizDeficit(decision);
        // `[MOM-8.1 / BD-1]`: the label only, never `candidate.name`/`.key`
        // (INV-3) — `checkRoutingReachesSelection`'s own doc states the same
        // constraint from the reading end.
        routingObservations.push({
          consulted: true,
          kind:
            decision.classification.status === 'classified' ? decision.classification.kind : null,
          deficit,
          generated: deficit !== 0,
        });
        if (deficit === 0) {
          skippedRouting += 1;
          continue;
        }
      } else {
        // Routing bypassed for this candidate — the sweep is about to spend
        // its generative capability without consulting component 2.2 at all.
        // Recorded rather than left absent, so the health check can go RED on
        // it instead of merely seeing a shorter list.
        routingObservations.push({ consulted: false, kind: null, deficit: null, generated: true });
      }

      attempted += 1;
      memory.noteAsked(courseCode, candidate.key, sweepOrdinal);
      // Counted where the ask is made: a concept skipped as a duplicate, as held or by routing
      // makes no ask and is not counted. Whether the ask then drafts or refuses is another fact.
      demandCounter.record(candidate.key, sweepRouting);
      // Taken BEFORE the ask, so a refusal is remembered against the evidence it was
      // actually made on, never against something that changed while the call was out.
      const pieces = await evidencePieces(candidate);
      let result: Awaited<ReturnType<typeof draftQuizCardsForConcept>>;
      try {
        result = await draftForConcept(deps.draftDeps, {
          courseCode,
          conceptName: candidate.name,
          // `[D-437]` row 38: the sweep's recall intent, authoring intent only — see the module
          // doc. No heading is sent: the sweep's ask has no source.
          ...sweepDemandFields,
          // F4.8/`[D-188]`: `purpose`/`registerHint` are set together, only
          // when this course's nearest assessment is format-matched — see
          // `deps.formatMatch`'s doc. Every other course omits both, so
          // `quiz.generate.v1` sees exactly the request it saw before this
          // bead (`ol-0r92.35`).
          ...(courseFormatMatch === undefined
            ? {}
            : {
                purpose: 'readiness' as const,
                ...(courseFormatMatch.registerHint === undefined
                  ? {}
                  : { registerHint: courseFormatMatch.registerHint }),
              }),
        });
      } catch {
        // A generative call failing outright (network, malformed transport
        // response) is not a refusal (which never throws) and not cached —
        // the concept is simply revisited next sweep. Not held: see the module doc.
        memory.recordOutcome(courseCode, candidate.key, null, demand, pieces);
        continue;
      }

      if (result.status === 'refused') {
        refused += 1;
        memory.recordOutcome(courseCode, candidate.key, result, demand, pieces);
        // A verdict from the judge is proof it answered; `judge-unavailable` is the opposite.
        if (result.reason === 'judge-rejected') memory.noteJudgeAnswered();
        // `[H-1.8a]`: classify rather than drop — see `GenerationRefusalNotice`'s own doc.
        refusals.push({
          courseCode,
          conceptName: candidate.name,
          reason: result.reason,
          copy: describeRefusal(result.reason),
        });
        continue;
      }

      // A draft came back, so the judge was consulted (or not needed) and nothing is held for this concept.
      memory.recordOutcome(courseCode, candidate.key, null, demand, pieces);
      memory.noteJudgeAnswered();

      const questions = extractDraftedQuestions(result.response);
      const provenance = extractDraftedProvenance(result.response);
      if (questions === null || provenance === null) continue; // unparseable — nothing content-bearing to cache; revisited next sweep
      // `[D-437]` (`ol-egov.141.89.2.30`): what the request carried and the response returned about
      // demand, read once per candidate and split per question below.
      const demandCarry = draftedDemandCarryOf(result.request, result.response);

      let notePath = courseNotePath;
      // `[D-181]`: the unit that resolved this course's drafting target for this sweep — the same
      // approximation `notePath`/`sourcePath` above already make at the concept level (this sweep
      // never determines which unit introduced which concept — see the module doc). `undefined`
      // only if no unit actually matches, which should not happen given how `notePaths`/
      // `sourcePaths` were built from `units` above — guarded rather than assumed, and the citation
      // is simply omitted rather than fabricated when it doesn't.
      let sourceUnit: ExtractedUnit | undefined;
      if (notePath === undefined) {
        // No embedding note named this course among this sweep's units —
        // the bare-drop case (`[D-179]`, F3.1/F3.3's amendment). A
        // standalone source in this course gets (or already has) its own
        // Olea-owned home note beside it, created lazily right here, only
        // now that a draft for it is actually about to be cached.
        const sourcePath = sourcePaths.find(
          (path) => courseFromPath(path, coursesFolder) === courseCode,
        );
        if (sourcePath === undefined) continue; // unreachable given how courseCodes was built, guarded rather than assumed
        const homeNote = await ensureHomeNoteForConcept(deps.vault, sourcePath, candidate.name);
        if (homeNote === null) continue; // a non-Olea file already sits at that path (INV-6) — nothing safe to write into this sweep
        notePath = homeNote;
        sourceUnit = units.find((unit) => unit.provenance.sourcePath === sourcePath);
      } else {
        const embeddingNotePath = notePath;
        sourceUnit = units.find(
          (unit) => unit.provenance.embeddedIn?.notePath === embeddingNotePath,
        );
      }
      // `[D-446]` option (a) (`ol-egov.141.89.2.5`): the passage digest, recorded only where the
      // passage this draft rests on can be named without guessing — see `grounding-passage.ts`.
      // Here, for every question: the request supplying exactly one chunk. Per question below
      // (`ol-egov.141.89.2.29`): the response citing exactly one chunk for that question, while
      // `citedChunkDigest` holds (off until measured). Otherwise no digest: the accept-time seal
      // then mints one only for a source with a single body passage, and everything else keeps
      // whole-note grain.
      const sourceCitation =
        sourceUnit === undefined
          ? undefined
          : await withGroundingPassage(
              deps.vault,
              citationFromUnit(sourceUnit),
              notePath,
              result.request.sourceChunks,
            );
      // Read parallel to `questions` (each question is its own record, so each is resolved on its
      // own citation); `undefined` when citations are not trusted, so nothing below reads them.
      const groundedIn = citedChunkDigest
        ? extractDraftedGroundedIn(result.response, 'questions', result.request.sourceChunks.length)
        : undefined;

      // `ol-0r92.87`: the snapshot the drafted questions were actually
      // grounded against — see the module doc's own section. Read once per
      // candidate, not per question, since nothing between here and the
      // cache writes below touches the vault. `exists` guards the "never
      // throws" promise above; `undefined` (no hash) is the same "no
      // signal" this record already uses for `sourceCitation`.
      const sourceContentHash = (await deps.vault.exists(notePath))
        ? await hashSourceRevision(await deps.vault.read(notePath))
        : undefined;

      const createdAt = now().toISOString();
      let sequence = 0;
      let refusedForDemand = 0;
      for (const [questionIndex, question] of questions.entries()) {
        // `[D-437]`: an invalid draft (a declaration that disagrees with the demand asked) is
        // counted and not cached; the concept is then revisited next sweep. `sequence` counts only
        // the records cached, so ids stay consecutive; the declaration was read by `questionIndex`.
        const stamped = draftDemandForQuestion(demandCarry, questionIndex, 'sweep');
        if (stamped.kind === 'refused') {
          draftDemandRefusalCounterFor(deps.cache).record(candidate.key);
          refusedForDemand += 1;
          continue;
        }
        // D-381: a genuinely-first-ever draft keeps the plain, probeable
        // 3-argument id (`deps.generateDraftId`, unchanged — every caller
        // before this bead, and every first-time draft this bead's own
        // caller still makes, land exactly where they always did). Only a
        // redo superseding a stale record (`staleRecordExists`, above) uses
        // `deriveDraftId`'s D-381 4-argument form directly — a disjoint id
        // space by construction (`deriveDraftId`'s own doc) — so this write
        // can never land on the path the stale record already occupies.
        const draftId = staleRecordExists
          ? await deriveDraftId(courseCode, candidate.name, sequence, courseSourceContentHash)
          : await generateDraftId(courseCode, candidate.name, sequence);
        // `[D-446]` (`ol-egov.141.89.2.29`): this question's own citation, when trusted. Returns
        // `sourceCitation` unchanged when it already names a passage (the sole-chunk case), when
        // the question cites no single chunk, or when that chunk is not exactly one passage of the
        // cited note.
        const questionCitation =
          sourceCitation === undefined || groundedIn?.[questionIndex] === undefined
            ? sourceCitation
            : await withGroundingPassage(
                deps.vault,
                sourceCitation,
                notePath,
                result.request.sourceChunks,
                groundedIn[questionIndex],
              );
        const record: DraftRecord = {
          draftId,
          status: 'pending',
          courseCode,
          conceptName: candidate.name,
          // The opaque key, matching `session/enumerate.ts`'s `ol-63e1` flip
          // — see `types.ts`'s doc on `DraftRecord.conceptIds`.
          conceptIds: [candidate.key],
          sourcePath: notePath,
          ...(questionCitation !== undefined ? { sourceCitation: questionCitation } : {}),
          ...(sourceContentHash !== undefined ? { sourceContentHash } : {}),
          createdAt,
          question,
          provenance,
          firstServedAt: null,
          // `[D-437]`: present exactly when the request carried a demand; a draft with none has no
          // key at all and reads unspecified for ever (design section 3.1).
          ...(stamped.demand === undefined ? {} : { demand: stamped.demand }),
        };
        await deps.cache.put(record);
        sequence += 1;
      }
      // A concept whose every question was refused for its demand cached nothing, so it is not
      // drafted. (A response with no questions at all is counted as before this bead.)
      if (sequence > 0 || refusedForDemand === 0) drafted += 1;
    }
  }

  return {
    attempted,
    drafted,
    refused,
    skippedDuplicate,
    skippedRefused,
    skippedRouting,
    routingObservations,
    refusals,
  };
}
