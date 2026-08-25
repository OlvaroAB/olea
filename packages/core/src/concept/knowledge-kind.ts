/**
 * `classifyKnowledgeKind` — what kind of knowledge a concept is
 * (component register row 1.5, `[KCT-1]`, `ol-kxr6`).
 *
 * **Nothing built this before.** The register's row 1.5 was found unowned on
 * 2026-08-21 — three loosely related open items existed and none of them
 * produced a label. This module is the first thing that does.
 *
 * **What it is.** *In:* a concept plus its source material. *Out:* a label,
 * or explicitly `'unclassified'` — which must be **commonly reachable
 * rather than nominal**. A classifier forced to choose always chooses, and a
 * confident wrong label routes a concept to the wrong practice with nothing
 * to show it happened; the retrieval-only fallback is already the right
 * behaviour for an unclassified concept (component 2.2's floor), what
 * matters here is that the classifier can actually say so.
 *
 * **Routing is one-to-many, and this module never forgets it.** The label
 * this module returns sets *emphasis* within component 2.2's instrument
 * mix, never membership — every concept keeps a retrieval baseline
 * regardless of its label (docs/research/GLOSSARY.md's KLI Application,
 * `ol-tqd5`'s ruling notes). Nothing here, and nothing a caller does with
 * this module's output, should ever turn a label into an exclusive
 * assignment.
 *
 * **The label set is a candidate, not yet ratified.** GLOSSARY.md's KLI
 * Application states the enum is "charter-owned" and gives the candidate
 * set as `fact / category / principle / unclassified` — the three group
 * representatives of the six-way research vocabulary its own emphasis rule
 * names (fact; category/concept; rule/principle/mechanism), collapsed to
 * exactly the granularity component 2.2 actually routes on. See
 * `KnowledgeKind`'s own doc for why this module uses the three-value form
 * rather than the six-way one.
 *
 * **Where it runs** (`docs/Olea_architecture_boundary.md` §1, component
 * register row 1.5, boundary **service**). The judgement is a model call —
 * "a model classification call; label plus confidence returned to the
 * client for storage" (`ol-kxr6`'s own description) — so this module owns
 * everything except the judgement, reached through
 * `KnowledgeKindClassifierPort`, the same seam shape `./read.ts`'s
 * `ConceptReaderPort` uses. **The production adapter now exists**
 * (`WorkerKnowledgeKindClassifier`, `packages/plugin/src/concept/`,
 * `ol-fx1k` / `[KCT-2]` / `[D-114]`), composed at
 * `OleaPlugin.classifyKnowledgeKindForConcept`
 * (`packages/plugin/src/main.ts`) — but that method has **no caller of its
 * own yet**, deliberately: the named consumer is component 2.2's
 * instrument-type routing (`ol-dlr1`, gated on `ol-tqd5`'s routing policy),
 * and neither has landed. So the model call is wired end-to-end while
 * nothing in the product decides *when* to make it.
 *
 * **The confidence floor is declared as a required option with no
 * default**, the same discipline `./read.ts`'s `ConceptReadBudget
 * .maxPassages` uses and for the same reason: the component register calls
 * this constant **derived**, and a derived constant's derivation stays
 * private while only the number ships (`docs/Olea_component_register.md`'s
 * declared/derived rule). This module declines to invent one — deriving it
 * needs real classifier output against the vault snapshot (N-015: synthetic
 * never tunes a threshold), which cannot happen before the service half
 * exists at all.
 *
 * **The health check is the register's own words: "the strongest check in
 * the machinery paper."** One label on the overwhelming majority of a
 * sample is presumed silent failure; zero unclassified across a sample is
 * equally suspicious. `summariseKnowledgeKindDistribution` and
 * `assessKnowledgeKindDistribution` below are that check, made runnable —
 * see their own docs for what is declared (a sanity floor, defensible in
 * plain English) versus what stays a judgement call on the vault snapshot
 * (whether the labels usefully carve her material, per the register's own
 * "Tuning" line — not a number this module can fit).
 */

import type { Provenance } from '../extract/types.js';

/**
 * The KC-type enum. **Candidate set, charter-owned and not yet ratified**
 * (`docs/research/GLOSSARY.md`'s KLI Application: "Enum values
 * charter-owned; candidate set: fact / category / principle /
 * unclassified"). `'unclassified'` is not a member of this type — it is a
 * distinct `status` on `KnowledgeKindClassification` below, deliberately,
 * so "no real label fit" cannot be confused with "the label is the string
 * `'unclassified'`" the way a flat string enum would allow.
 *
 * These three are the label component 2.2's emphasis table actually reads
 * (docs/research/GLOSSARY.md: fact -> retrieval-dominant; category/concept
 * -> quiz-weighted; rule/principle/mechanism -> explain-back-weighted) — the
 * six-way research vocabulary the same rule names collapses to exactly
 * these three groups, because 2.2 never routes finer than emphasis. If a
 * later ruling widens the set (or renames a member), this type is the one
 * place that changes; nothing downstream in this module switches on the
 * literal beyond `KNOWLEDGE_KINDS`.
 */
export type KnowledgeKind = 'fact' | 'category' | 'principle';

/** Every real (non-`'unclassified'`) label, for iteration and validation. */
export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = ['fact', 'category', 'principle'];

/** Cheap guard: is this string one of the ratified-candidate labels? */
export function isKnowledgeKind(value: string): value is KnowledgeKind {
  return (KNOWLEDGE_KINDS as readonly string[]).includes(value);
}

/**
 * One passage of a concept's source material, handed to the classifier as
 * **transient context** and never persisted server-side (C6, D-005,
 * boundary §1) — same posture as `./read.ts`'s `ConceptPassage`.
 *
 * Reuses `../extract/`'s `Provenance` for the anchor rather than defining a
 * second passage-identity scheme (`[D-085]`'s one-scheme-not-two rule,
 * already followed by `./read.ts` and `./size.ts`).
 */
export interface KnowledgeKindSourcePassage {
  readonly text: string;
  readonly anchor: Provenance;
}

/**
 * A committed label. `confidence` is carried through even on the classified
 * path so a distribution health check (or a later re-gate against a
 * different floor) never has to trust the commit decision blindly.
 */
export interface ConceptKindClassified {
  readonly status: 'classified';
  readonly kind: KnowledgeKind;
  readonly confidence: number;
  readonly method: 'model';
}

/**
 * The **first-class**, commonly-reachable output the register requires. A
 * concept is unclassified either because the model itself said so, or
 * because it named a label but the confidence floor this module applies
 * (`ClassifyKnowledgeKindOptions.confidenceFloor`) was not met — both are
 * "this module declined to commit," and neither is a failure to run (see
 * `ClassifyKnowledgeKindResult`'s `'not-run'` branch for that).
 */
export interface ConceptKindUnclassified {
  readonly status: 'unclassified';
  /**
   * The raw confidence behind the decline, when the classifier offered one —
   * `undefined` only when the classifier itself returned `'unclassified'`
   * with no number attached. Kept for the distribution health check and for
   * diagnosing *why* a concept did not commit, never to imply a commitment
   * that did not happen.
   */
  readonly confidence: number | undefined;
  readonly method: 'model';
}

/**
 * A concept's knowledge-kind classification: a label, or explicitly
 * unclassified. Discriminated on `status` for the same reason
 * `./read.ts`'s `ConceptReadResult` is a union — a caller narrowing on
 * `status` cannot reach `.kind` without handling the unclassified case, so
 * "silently treat unclassified as a label" does not typecheck.
 */
export type KnowledgeKindClassification = ConceptKindClassified | ConceptKindUnclassified;

export interface ClassifyKnowledgeKindRequest {
  /** Verbatim, for the classifier's context only — never used to match or fold. */
  readonly conceptName: string;
  /**
   * Never empty by the time it reaches the port — see `classifyKnowledgeKind`,
   * and INV-5: a classifier handed no material to classify from has nothing
   * to be faithful to, so any label it returns is invention by construction.
   */
  readonly sourceMaterial: readonly KnowledgeKindSourcePassage[];
}

/**
 * The port's raw response, before this module's confidence gate runs.
 * `kind` may itself be `'unclassified'` — the model is allowed to decline
 * directly, and this module's gate only ever *adds* declines, never removes
 * one the model already made.
 */
export interface ClassifyKnowledgeKindResponse {
  readonly kind: KnowledgeKind | 'unclassified';
  readonly confidence: number;
}

/**
 * The service seam (component register row 1.5, boundary **service**). The
 * implementation POSTs to the Worker's `/v1/task` and returns the parsed
 * artifact; the prompt that does the classifying is private IP (C4.3) and
 * does not exist in this repository.
 *
 * **There is no production implementation, deliberately** — see this
 * module's own doc for why: the task id this port will call has to be
 * added to the frozen catalogue in `packages/contracts`, which is not this
 * module's — or this bead's — to do.
 */
export interface KnowledgeKindClassifierPort {
  classify(request: ClassifyKnowledgeKindRequest): Promise<ClassifyKnowledgeKindResponse>;
}

/** Why the classifier could not be reached at all — mirrors `./read.ts`'s `ConceptReaderUnavailableReason`. */
export type KnowledgeKindClassifierUnavailableReason =
  | 'offline'
  | 'budget-exhausted'
  | 'not-on-this-device'
  | 'not-configured';

/**
 * Thrown by a `KnowledgeKindClassifierPort` that cannot run *at all*, as
 * distinct from one that ran and returned `'unclassified'`.
 * `classifyKnowledgeKind` turns this into a `'not-run'` result carrying the
 * reason, so the difference survives all the way to whatever renders it.
 */
export class KnowledgeKindClassifierUnavailableError extends Error {
  readonly reason: KnowledgeKindClassifierUnavailableReason;

  constructor(reason: KnowledgeKindClassifierUnavailableReason, message?: string) {
    super(message ?? `knowledge-kind classifier unavailable: ${reason}`);
    this.name = 'KnowledgeKindClassifierUnavailableError';
    this.reason = reason;
  }
}

export interface ClassifyKnowledgeKindOptions {
  /**
   * **Required, no default.** DERIVED (component register row 1.5): its
   * derivation needs real classifier output scored against the vault
   * snapshot, which cannot happen before a production classifier exists.
   * The caller states its floor; this module applies it honestly and
   * reports which side of it a response fell on.
   */
  readonly confidenceFloor: number;
}

/**
 * The one piece of judgement in this module below the port call: response
 * in, classification out. Pure and total — mirrors `./size.ts`'s
 * `deriveConceptSize`. A response that already says `'unclassified'` passes
 * through unchanged; a response naming a real label is downgraded to
 * unclassified when its confidence does not clear the floor.
 */
export function gateKnowledgeKindConfidence(
  response: ClassifyKnowledgeKindResponse,
  options: ClassifyKnowledgeKindOptions,
): KnowledgeKindClassification {
  if (response.kind === 'unclassified' || response.confidence < options.confidenceFloor) {
    return {
      status: 'unclassified',
      confidence: response.confidence,
      method: 'model',
    };
  }
  return {
    status: 'classified',
    kind: response.kind,
    confidence: response.confidence,
    method: 'model',
  };
}

/** Why a classification did not run at all, when the cause was the run rather than the concept. */
export type ClassifyKnowledgeKindFailure =
  /** `sourceMaterial` was empty — the port was never reached (INV-5). */
  | 'no-source-material'
  /** The classifier could not be reached — see `KnowledgeKindClassifierUnavailableError`. */
  | 'classifier-unavailable'
  /** The classifier was reached and errored. */
  | 'classifier-failed';

/** The classifier ran. `classification` may itself carry `status: 'unclassified'` — that is a measurement, not a failure to run. */
export interface KnowledgeKindClassified {
  readonly outcome: 'classified';
  readonly classification: KnowledgeKindClassification;
}

/** The classifier did **not** run. Reported, never silently treated as unclassified — those are different facts. */
export interface KnowledgeKindNotRun {
  readonly outcome: 'not-run';
  readonly reason: ClassifyKnowledgeKindFailure;
  /** Plain English, safe to show: what was met and why nothing was classified. */
  readonly detail: string;
  /** Present when `reason` is `'classifier-unavailable'`. */
  readonly unavailableBecause?: KnowledgeKindClassifierUnavailableReason;
}

/**
 * A discriminated union on purpose, the same shape as `./read.ts`'s
 * `ConceptReadResult` and for the same reason: "the classifier declined to
 * commit" (`classification.status === 'unclassified'`) and "the classifier
 * never ran" (`outcome === 'not-run'`) are different facts, and a caller
 * cannot conflate them without narrowing on `outcome` first.
 */
export type ClassifyKnowledgeKindResult = KnowledgeKindClassified | KnowledgeKindNotRun;

/**
 * Classify one concept's knowledge kind, given its source material.
 *
 * INV-5: a classifier handed an empty context has nothing to be faithful
 * to, so this refuses before reaching the port rather than sending an empty
 * request and trusting the port not to invent — the port is never called on
 * that path.
 */
export async function classifyKnowledgeKind(
  port: KnowledgeKindClassifierPort,
  request: ClassifyKnowledgeKindRequest,
  options: ClassifyKnowledgeKindOptions,
): Promise<ClassifyKnowledgeKindResult> {
  if (request.sourceMaterial.length === 0) {
    return {
      outcome: 'not-run',
      reason: 'no-source-material',
      detail: `"${request.conceptName}" was offered no source material, so nothing was sent to be classified.`,
    };
  }

  try {
    const response = await port.classify(request);
    return {
      outcome: 'classified',
      classification: gateKnowledgeKindConfidence(response, options),
    };
  } catch (error) {
    if (error instanceof KnowledgeKindClassifierUnavailableError) {
      return {
        outcome: 'not-run',
        reason: 'classifier-unavailable',
        detail: `Knowledge kind is classified by a model, so this needs a connection, a budget and a desktop. ${error.message}`,
        unavailableBecause: error.reason,
      };
    }
    return {
      outcome: 'not-run',
      reason: 'classifier-failed',
      detail: `The classifier was reached and failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// The health check — component register row 1.5's own words: "the strongest
// check in the machinery paper... written down as an obligation and never
// implemented."
// ---------------------------------------------------------------------------

/**
 * Any of the four buckets `DOMINANT_KIND_SHARE_CEILING`'s defence argues
 * from: the three real labels, or `'unclassified'` itself. Named so
 * `dominantKind` below can say in its type what the defence already says in
 * prose — a classifier that collapses onto declining everything has still
 * collapsed onto *one bucket*, and that bucket must be nominatable
 * (`ol-byw0`: before this type existed, `dominantKind` could only ever be a
 * real label, so a decline-everything collapse drove `dominantShare` toward
 * zero and the ceiling below could never fire on it).
 */
export type DominantKnowledgeBucket = KnowledgeKind | 'unclassified';

/** One row per real label, plus the totals a health check needs. */
export interface KnowledgeKindDistribution {
  readonly total: number;
  readonly unclassifiedCount: number;
  readonly countsByKind: Readonly<Record<KnowledgeKind, number>>;
  /**
   * The largest of the four buckets — one of the three real labels, or
   * `'unclassified'` when unclassified itself is the largest. `undefined`
   * only when `total` is `0`, the one case with nothing to be dominant.
   */
  readonly dominantKind: DominantKnowledgeBucket | undefined;
  /** The dominant bucket's count divided by `total` — share of *every* classification, matching `ol-m5wp`'s "exceeds a stated share of all classifications." `0` when `total` is `0`. */
  readonly dominantShare: number;
  /** `unclassifiedCount / total`. `0` when `total` is `0`. */
  readonly unclassifiedShare: number;
}

const EMPTY_COUNTS: Readonly<Record<KnowledgeKind, number>> = {
  fact: 0,
  category: 0,
  principle: 0,
};

/** Pure tally — no judgement about whether the shape is healthy lives here, only the counting. */
export function summariseKnowledgeKindDistribution(
  classifications: readonly KnowledgeKindClassification[],
): KnowledgeKindDistribution {
  const countsByKind: Record<KnowledgeKind, number> = { ...EMPTY_COUNTS };
  let unclassifiedCount = 0;
  for (const c of classifications) {
    if (c.status === 'unclassified') {
      unclassifiedCount += 1;
    } else {
      countsByKind[c.kind] += 1;
    }
  }

  const total = classifications.length;
  let dominantKind: DominantKnowledgeBucket | undefined;
  let dominantCount = 0;
  for (const kind of KNOWLEDGE_KINDS) {
    const count = countsByKind[kind];
    if (count > dominantCount) {
      dominantCount = count;
      dominantKind = kind;
    }
  }
  // Unclassified is the fourth bucket the ceiling's defence argues from
  // (ol-byw0) — nominate it too, on equal footing with the three real
  // labels, so a classifier that collapses onto declining everything
  // nominates a dominant bucket instead of silently driving dominantShare
  // toward zero. Ties go to whichever real label was seen first, same as
  // ties among the real labels themselves — the tie-break never changes
  // dominantCount, only which name is attached to it, so it never changes
  // whether the ceiling fires.
  if (unclassifiedCount > dominantCount) {
    dominantCount = unclassifiedCount;
    dominantKind = 'unclassified';
  }

  return {
    total,
    unclassifiedCount,
    countsByKind,
    dominantKind,
    dominantShare: total > 0 ? dominantCount / total : 0,
    unclassifiedShare: total > 0 ? unclassifiedCount / total : 0,
  };
}

/**
 * DECLARED (not derived — `docs/Olea_component_register.md`'s declared/
 * derived rule), and never tuned against the real vault or synthetic
 * fixtures (N-015): `knowledge-kind.spec.ts` fixes this constant's
 * behaviour, it does not fit its value.
 *
 * **Plain-English defence.** There are four buckets total (three real
 * labels plus unclassified). If one bucket alone holds 90% or more of a
 * sample large enough to judge at all, the other three combined hold at
 * most a tenth — indistinguishable, at that skew, from a classifier that
 * has collapsed onto one answer rather than one that is reading her
 * material. This is the coarse, unambiguous half of the register's health
 * check; the finer question — *whether the labels usefully carve her
 * particular material* — is explicitly a judgement on the vault snapshot
 * per the register's own "Tuning" line, not a number this module fits.
 *
 * **The nomination now matches this defence** (`ol-byw0`): all four buckets,
 * unclassified included, are candidates for `dominantKind` in
 * `summariseKnowledgeKindDistribution` above, so a classifier that
 * collapses onto declining everything is caught the same way one that
 * collapses onto a real label is — the two are the same failure with
 * different symptoms, not two different failures needing two different
 * flags. The value itself is unchanged: KCT-3 measured real classifier
 * output against the vault snapshot and found this ceiling would not have
 * fired anywhere at any confidence floor tried, and kept it as declared
 * rather than deriving a replacement (`findings/KCT-3-confidence-floor.md`
 * in olea-service).
 */
export const DOMINANT_KIND_SHARE_CEILING = 0.9;

/**
 * DECLARED, same discipline as `DOMINANT_KIND_SHARE_CEILING`.
 *
 * **Plain-English defence.** Below this many classifications, "zero
 * unclassified" is not yet a signal — a handful of concepts genuinely
 * mapping onto real labels is unremarkable. The register's "zero
 * unclassified is equally suspicious" reading only bites once the sample is
 * large enough that a floor doing any work at all would be expected to
 * decline at least one of them.
 */
export const MIN_SAMPLE_FOR_DISTRIBUTION_CHECK = 20;

/** The health check, made runnable — a test that can actually fail (this module's own `.spec.ts` does exactly that). */
export interface KnowledgeKindHealthCheck {
  readonly distribution: KnowledgeKindDistribution;
  /** `true` when the sample is too small for either flag below to mean anything. Neither flag is ever `true` while this is. */
  readonly sampleTooSmall: boolean;
  /** One bucket — a real label, or unclassified itself — captured `>= DOMINANT_KIND_SHARE_CEILING` of the sample. */
  readonly dominantKindTooHigh: boolean;
  /** Zero unclassified across a sample large enough that a working floor would be expected to decline at least one. */
  readonly zeroUnclassifiedSuspicious: boolean;
  /** `false` when either flag above is `true`; `true` otherwise (including when the sample is too small to say anything, which is a "cannot judge" state, not an unhealthy one). */
  readonly healthy: boolean;
}

/**
 * Run the register's health check over a sample of classifications.
 *
 * A sample below `MIN_SAMPLE_FOR_DISTRIBUTION_CHECK` is reported as
 * `sampleTooSmall: true` with both flags `false` and `healthy: true` — "not
 * enough evidence to fail" is a different fact from "passed," and this
 * function never conflates them by silently declaring a tiny sample
 * healthy on a load-bearing flag.
 */
export function assessKnowledgeKindDistribution(
  classifications: readonly KnowledgeKindClassification[],
): KnowledgeKindHealthCheck {
  const distribution = summariseKnowledgeKindDistribution(classifications);
  const sampleTooSmall = distribution.total < MIN_SAMPLE_FOR_DISTRIBUTION_CHECK;

  const dominantKindTooHigh =
    !sampleTooSmall && distribution.dominantShare >= DOMINANT_KIND_SHARE_CEILING;
  const zeroUnclassifiedSuspicious = !sampleTooSmall && distribution.unclassifiedCount === 0;

  return {
    distribution,
    sampleTooSmall,
    dominantKindTooHigh,
    zeroUnclassifiedSuspicious,
    healthy: !dominantKindTooHigh && !zeroUnclassifiedSuspicious,
  };
}
