/**
 * The versioned-artifact envelope — the one shape every delivered result travels
 * inside (`[BND-3]`).
 *
 * The boundary ruling puts the policy layer in the private service, and this
 * envelope is the mechanism by which policy reaches the client: the Worker
 * computes, stamps and returns; the client caches, applies and renders. *The
 * client holds a result, never a policy* is only true if one envelope can carry
 * every kind of result — otherwise each surface invents its own version stamp,
 * its own staleness rule, and its own answer to "why did it say that?", and the
 * three answers drift.
 *
 * This generalises the study-plan artifact's envelope (P5-T05, `study-plan.ts`),
 * which was the first instance of it and is still the only one with a production
 * consumer. Four things it must define, and where each lives here:
 *
 * 1. **A version stamp, with defined behaviour on an unknown version.**
 *    `envelopeVersion` / `bodyVersion` / `policyVersion`, and
 *    `readArtifactEnvelope` — an unreadable artifact is *discarded and rebuilt*,
 *    never migrated and never partially rendered.
 * 2. **A cache lifetime whose expiry is shown to her.** `freshForSeconds` and
 *    `governsForSeconds`, read through `envelopeFreshness`, which returns a
 *    three-state answer and both instants so a surface can say which it is.
 *    Under one artifact she works from yesterday's plan rather than from no
 *    plan — and that has to be honest on screen rather than silent.
 * 3. **The evidentiary basis, travelling inside the artifact.** `claimBasis` and
 *    `evidenceRef`, so `F4.10`/`[D-046]`/`[D-095]` contestability survives
 *    offline: a reading is contested *through* its evidence, and the route to
 *    that evidence must not be a server round-trip.
 * 4. **What must never ride here.** See "The exclusion" below. The envelope is
 *    derived and disposable by construction; the event log in her vault is the
 *    truth.
 *
 * ## The version stamp does three different jobs, so there are three fields
 *
 * Collapsing them is the mistake this comment exists to prevent.
 *
 * - **`envelopeVersion`** — the shape of *this wrapper*. Changing it changes how
 *   every artifact is read.
 * - **`bodyVersion`** — the shape of *this kind's* payload. Independent of the
 *   wrapper: a new field in the study-plan body must not force every other
 *   delivered constant to be re-read.
 * - **`policyVersion`** — the **identity of the policy**, opaque and derived from
 *   the body's content. This is the one that crosses into her append-only review
 *   log, and it carries a load the other two do not. `[D-091]` and `[D-092]` both
 *   settle a question by leaning on it: the plan version stamped on a review pins
 *   *the fairness-window width and the composition parameters that composed it*,
 *   with no new field, so changing a declared constant changes future plans and
 *   nothing behind. That only holds if **every value the client will apply is
 *   inside `body`** and `policyVersion` is derived from all of it. A delivered
 *   constant that reaches the client outside the body — a query parameter, a
 *   header, a second endpoint — silently breaks a ruling two decisions rely on.
 *
 * `policyVersion` is **opaque**: nothing may parse it, order by it, or infer
 * recency from it. Recency is `computedAt`'s job and staleness is
 * `envelopeFreshness`'s; the moment something treats the version as a sequence,
 * the content-derivation above becomes unchangeable.
 *
 * ## Staleness is a property of a known artifact, not of an unknown one
 *
 * The two failures look alike on a cold start and must not be handled alike:
 *
 * - *Known kind, known versions, old* → **`stale`**, then **`expired`**. It keeps
 *   governing while stale, and the surface says so. This is `[D-044]`'s degrade
 *   rather than stop, made structural rather than left to each surface's mood.
 * - *Unknown version* → **unreadable**. Discard and rebuild. It is never treated
 *   as stale-but-usable, because we do not know what it said. If it cannot be
 *   rebuilt (offline, no service), the surface says the feature is unavailable
 *   and why — it never falls back to a built-in default and renders that as if it
 *   were policy, which would be the client holding a policy after all.
 *
 * ## The exclusion — what must NEVER ride in this envelope
 *
 * The envelope is a derived, disposable artifact. **The test is one question:
 * delete every cached envelope on the device; is anything lost that cannot be
 * recomputed from her vault?** If the answer is yes, something is in here that
 * must not be. Specifically:
 *
 * - **Her content.** No note text, no question or card text, no prose of hers.
 *   Evidence travels as a *locator* — a path and a label — never as a copy. The
 *   words are already in her vault and are recoverable from the path; copying
 *   them into a document that crosses the wire and then sits at rest is storing
 *   her content to save a lookup (C6, `[D-095]`: policy travels, never her
 *   content).
 * - **Authoritative state.** No mastery, no scheduling or due-ness, no review
 *   events, no counts of what she has done. Every one of those is a local
 *   projection of the log, recomputed on-device; a copy here would be a second
 *   source of truth that can disagree with the first.
 * - **Events of any kind.** Exclusion and binding events ride the `[D-087]`
 *   migration into the log (`[D-097]`), not this envelope. If a design wants an
 *   event to reach the client through a delivered artifact, that is the C6
 *   tripwire firing, not a gap in this shape.
 * - **Anything the client must keep after the artifact expires.** Exactly one
 *   value outlives an envelope: `policyVersion`, persisted into the review log as
 *   the provenance of a selection. Everything else dies with the cache entry.
 * - **Server-assigned durable identity for her concepts.** The durable-id carrier
 *   is unruled (`[IDC-1]`); until it is, identity here is the same client-side
 *   verbatim name the review log already uses, and the service mints nothing.
 */

import { z } from 'zod';
import { contracts } from './registry.js';
import { studyPlanAllocationEntry, studyPlanCourse } from './study-plan.js';
import { responseStamp } from './worker.js';

/** The envelope wrapper shape this build writes and is willing to read. */
export const ARTIFACT_ENVELOPE_VERSION = 1 as const;

/**
 * Wrapper versions this build can read. A blob outside this set is unreadable,
 * not stale — see the module doc, and `readArtifactEnvelope`.
 */
export const READABLE_ENVELOPE_VERSIONS: readonly number[] = [ARTIFACT_ENVELOPE_VERSION];

/**
 * One piece of evidence behind a delivered claim — a **locator**, never a copy.
 *
 * `[D-095]` rules that a contested reading "stands wearing her dissent, and the
 * contest routes her to the events it is computed from — readings are contested
 * THROUGH their evidence, never around it." That route has to work with the
 * network down, which makes it this envelope's problem: the basis must ride
 * along, addressed in terms the *client* can resolve locally.
 *
 * Two shapes, because Olea's claims are computed from two different places:
 * somewhere in her material, or some run of her own events.
 */
export const evidenceRef = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('source'),
    /** Vault-relative path of the material the claim was computed from. */
    sourcePath: z.string().min(1),
    /**
     * The label of the place within that source — a question label, a heading.
     * Verbatim, because it is how she finds it; a locator, not the content.
     */
    locator: z.string().min(1),
  }),
  z.object({
    kind: z.literal('events'),
    /**
     * A **selector** the client runs over her local log — not events, and not a
     * count of them. The service never sees what it selects.
     *
     * Concept identity is the verbatim display name the review log already
     * carries (knowledge model §4; `[IDC-1]` still open), which is what lets a
     * contest gesture open the events a reading was computed from without a
     * canonical-id layer neither side has.
     */
    conceptId: z.string().min(1),
    /** Log event kinds in scope, e.g. review ratings. Empty means every kind. */
    eventKinds: z.array(z.string().min(1)),
    /** Inclusive lower bound, `YYYY-MM-DD`. Absent means from the beginning. */
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'since must be a YYYY-MM-DD calendar day')
      .optional(),
  }),
]);
export type EvidenceRef = z.infer<typeof evidenceRef>;

/**
 * Why a delivered claim says what it says — G5's "every ranking cites or
 * abstains", generalised from the study plan to every claim Olea makes
 * (`[D-046]`'s four-part test, `[D-076]` round 5's generalisation of it).
 *
 * Non-empty by schema on both arms: a claim with no factors and no evidence is
 * the case that **abstains**, and an abstention is a different shape rather than
 * an empty one. Flattening it to "cited nothing" is how a surface ends up
 * rendering a considered-and-found-nothing as a bare zero.
 */
export const claimBasis = z.object({
  /**
   * The claim's account of itself, in the computation's own words.
   *
   * Mechanically derived upstream from the very factors that produced the
   * result — never separately composed, never model-written, and never quoting
   * her material. Carried verbatim so that showing its work survives caching: an
   * explanation regenerated later would explain a *different* artifact.
   */
  reasoning: z.string().min(1),
  /**
   * The factors that produced the result, named and valued. This is what makes a
   * contest arguable offline: she can see that exam proximity, not coverage,
   * is what put a topic first.
   */
  factors: z.array(z.object({ name: z.string().min(1), value: z.number() })).min(1),
  /** Where to go and look. Non-empty — see this object's doc. */
  evidence: z.array(evidenceRef).min(1),
});
export type ClaimBasis = z.infer<typeof claimBasis>;

/**
 * The **basis slot**: wrap any claim a delivered artifact makes about her, and
 * it carries its own evidence.
 *
 * The rule the slot encodes, and the reason it is a helper rather than a
 * convention: **a body that carries a claim about her carries a `basis` for
 * every one of them; a body that carries only a constant carries none.** A
 * routing threshold is not a claim about her and has nothing to cite. A ranking
 * is, and reconstructing its basis from the server later is exactly the
 * round-trip `F4.10`/`[D-046]` contestability cannot depend on.
 */
export function claim<TShape extends z.ZodRawShape>(shape: TShape) {
  return z.object({ ...shape, basis: claimBasis });
}

/** The freshness states a cached artifact can be in. See `envelopeFreshness`. */
export const envelopeState = z.enum(['fresh', 'stale', 'expired']);
export type EnvelopeState = z.infer<typeof envelopeState>;

/**
 * Build the schema for one kind of delivered artifact.
 *
 * The wrapper fields are identical for every kind — that is the whole point —
 * and `body` is where a kind says what it delivers.
 */
export function artifactEnvelope<TKind extends string, TBody extends z.ZodTypeAny>(
  kind: TKind,
  bodyVersion: number,
  body: TBody,
) {
  return z
    .object({
      /** Wrapper discriminant. Unknown value → unreadable, not stale. */
      envelopeVersion: z.literal(ARTIFACT_ENVELOPE_VERSION),
      /** Which delivered artifact this is. */
      kind: z.literal(kind),
      /** Payload discriminant, versioned independently of the wrapper. */
      bodyVersion: z.literal(bodyVersion),
      /**
       * Opaque, content-derived identity of the policy in `body`. The only value
       * in this envelope that outlives it — see the module doc.
       */
      policyVersion: z.string().min(1),
      /**
       * When the service computed this. ISO-8601 **with offset**: "when" about
       * her study life is local, and an offsetless instant silently becomes UTC
       * somewhere downstream.
       *
       * Deliberately outside `policyVersion`'s derivation — recomputing an
       * unchanged policy moves this and nothing else.
       */
      computedAt: z.string().datetime({ offset: true }),
      /**
       * How long this artifact is **fresh**, from `computedAt`. After it, the
       * artifact keeps governing and the surface must say it is old.
       *
       * A duration rather than an absolute instant, deliberately: the client
       * evaluates it against its own clock, so a device whose clock is ahead of
       * the service's does not meet an artifact that is already expired on
       * arrival — and the delivered value stays visible *as a constant*, which is
       * what a delivered constant is supposed to be.
       */
      freshForSeconds: z.number().int().positive(),
      /**
       * How long this artifact may **govern** at all, from `computedAt`. After
       * it, the client stops applying it and says so. Always ≥ `freshForSeconds`.
       */
      governsForSeconds: z.number().int().positive(),
      /** D7.3 provenance, present when a model call contributed to this artifact. */
      stamp: responseStamp.optional(),
      /** The delivered policy itself. Per-kind shape. */
      body,
    })
    .refine((v) => v.governsForSeconds >= v.freshForSeconds, {
      message: 'governsForSeconds must be >= freshForSeconds',
      path: ['governsForSeconds'],
    });
}

/** The wrapper fields, independent of any one kind — what generic readers see. */
export interface ArtifactEnvelopeHeader {
  envelopeVersion: number;
  kind: string;
  bodyVersion: number;
  policyVersion: string;
  computedAt: string;
  freshForSeconds: number;
  governsForSeconds: number;
}

/**
 * The freshness of a cached artifact, and both instants a surface needs to say
 * so out loud.
 *
 * **The obligation this function exists to make checkable:** every surface that
 * renders something computed from a delivered artifact renders its state too
 * when it is not `fresh`. Silently reusing yesterday's plan is the failure —
 * she is entitled to know she is working from an old one, and to know when it
 * stops. (What the screen actually *says* is the vocabulary registry's business,
 * not this file's; what is settled here is that it must say something.)
 */
export function envelopeFreshness(
  header: Pick<ArtifactEnvelopeHeader, 'computedAt' | 'freshForSeconds' | 'governsForSeconds'>,
  now: Date,
): { state: EnvelopeState; freshUntil: Date; governsUntil: Date } {
  const computedAt = new Date(header.computedAt).getTime();
  const freshUntil = new Date(computedAt + header.freshForSeconds * 1000);
  const governsUntil = new Date(computedAt + header.governsForSeconds * 1000);
  const state: EnvelopeState =
    now.getTime() < freshUntil.getTime()
      ? 'fresh'
      : now.getTime() < governsUntil.getTime()
        ? 'stale'
        : 'expired';
  return { state, freshUntil, governsUntil };
}

/** Why a cached blob could not be read. Every arm means *discard and rebuild*. */
export type EnvelopeUnreadableReason =
  | 'unknown-envelope-version'
  | 'wrong-kind'
  | 'unknown-body-version'
  | 'malformed';

export type EnvelopeReadResult<T> =
  | { status: 'ok'; artifact: T }
  | { status: 'unreadable'; reason: EnvelopeUnreadableReason };

/**
 * Read a cached blob as an artifact of one kind — **the defined behaviour on
 * meeting a version this build does not know.**
 *
 * There is exactly one behaviour and it is the same for all three version
 * fields: **treat the blob as absent and rebuild.** Never migrate, never parse
 * the parts that happen to fit, never render a partial artifact, and never treat
 * it as stale-but-usable — staleness is a statement about a known thing.
 *
 * That is the right default here and *not* the right default for the review log,
 * which is the distinction worth keeping straight: the log is an un-backfillable
 * source of truth, so an unknown version there is migrated. This is a derivation
 * (C6, D-006), so an unknown version here is thrown away. `PersistedEmbeddingCache`
 * and `core/src/plan/cache.ts` already make the same choice for the same reason.
 *
 * When the rebuild cannot happen — offline, or the service is down — the caller
 * says the feature is unavailable and why. It does not substitute a built-in
 * default and present it as policy.
 */
export function readArtifactEnvelope<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  expectedKind: string,
  blob: unknown,
): EnvelopeReadResult<z.infer<TSchema>> {
  if (typeof blob !== 'object' || blob === null) {
    return { status: 'unreadable', reason: 'malformed' };
  }
  const head = blob as Partial<ArtifactEnvelopeHeader>;
  if (
    typeof head.envelopeVersion !== 'number' ||
    !READABLE_ENVELOPE_VERSIONS.includes(head.envelopeVersion)
  ) {
    return { status: 'unreadable', reason: 'unknown-envelope-version' };
  }
  if (head.kind !== expectedKind) {
    return { status: 'unreadable', reason: 'wrong-kind' };
  }
  const parsed = schema.safeParse(blob);
  if (!parsed.success) {
    // A body-version literal mismatch is the one failure that is a *known*
    // artifact this build cannot read, rather than a corrupt one. Both discard;
    // they are distinguished because the diagnostics differ and only one of them
    // means "she is running an older build than the service".
    const bodyVersionIssue = parsed.error.issues.some(
      (issue) => issue.path.length === 1 && issue.path[0] === 'bodyVersion',
    );
    return {
      status: 'unreadable',
      reason: bodyVersionIssue ? 'unknown-body-version' : 'malformed',
    };
  }
  return { status: 'ok', artifact: parsed.data as z.infer<TSchema> };
}

/* -------------------------------------------------------------------------- */
/* The two cache-lifetime classes, and their declared constants               */
/* -------------------------------------------------------------------------- */

/**
 * **Declared constants**, not derived: chosen because they are defensible in
 * plain English, never fitted against data (component register, "Declared versus
 * derived"). Every one of them is owed an argued sentence, and has one below.
 *
 * They divide into two classes, because two kinds of thing ride this envelope
 * and going stale costs them different amounts:
 *
 * - **Governing** — the artifact tells her what to do. A stale one is still
 *   worth having and a very old one is not.
 * - **Operating** — the artifact chooses between two internally correct
 *   behaviours (route this page to vision or to the text layer; merge this
 *   statement or mint a new record). A stale one costs efficiency or caution,
 *   never a wrong claim on screen.
 */

/**
 * A plan is **fresh for one day** because the quantity it ranks by is measured
 * in whole days — exam proximity decays in days, not minutes (boundary §1.6) —
 * and a plan cannot honestly claim more precision than its own unit.
 */
export const GOVERNING_FRESH_FOR_SECONDS = 24 * 60 * 60;

/**
 * **A cached governing artifact may keep governing for seven days offline, and
 * is labelled old from the moment it stops being fresh.**
 *
 * The argued sentence: a week is about the longest stretch over which the thing
 * a ranking is mostly made of — her assessment calendar and which courses are
 * running — reliably does not change, and it is short enough that a plan cannot
 * quietly outlive the shape of the term it was computed for. Under it she works
 * from Tuesday's plan rather than from no plan, which is the honest form of
 * `[D-044]`'s "degrade rather than stop"; past it, a ranking is no longer
 * evidence about this week and continuing to apply it would be the tool
 * pretending to know something it does not.
 *
 * Not fitted against anything, and deliberately not coupled to the fairness
 * window or the session clustering gap — `[D-092]` rules that windows are tuned
 * independently and that agreement by coupling is fake coherence.
 */
export const GOVERNING_GOVERNS_FOR_SECONDS = 7 * 24 * 60 * 60;

/**
 * An operating constant is **fresh for thirty days**: it is a tuning, and a
 * month is the cadence at which re-tuning against a corpus is worth her client
 * asking for a new one.
 */
export const OPERATING_FRESH_FOR_SECONDS = 30 * 24 * 60 * 60;

/**
 * An operating constant **governs for a year**, which is a deliberately long
 * horizon rather than a permanent one.
 *
 * The argued sentence: an old routing or merge threshold picks between two
 * behaviours that are both correct, so the cost of a stale one is an unnecessary
 * upload or an over-cautious mint — never something false said to her — and
 * expiring it would disable a feature offline to avoid a cost she cannot see.
 * It expires eventually anyway, because a value nobody has refreshed in a year
 * is a value nobody is tuning, and the client should have to ask again rather
 * than carry it forever.
 */
export const OPERATING_GOVERNS_FOR_SECONDS = 365 * 24 * 60 * 60;

/* -------------------------------------------------------------------------- */
/* The delivered surfaces, expressed against the shared envelope              */
/* -------------------------------------------------------------------------- */

/**
 * **1.6 — decide if a PDF needs vision.** The register's first delivered
 * threshold: the derivation stays service-side and the number is delivered,
 * because the client must decide *before* it uploads anything, and shipping
 * every page image to be safe is the waste the component exists to prevent.
 */
export const visionRouteBody = z.object({
  /** Text-layer characters at or above which the page is routed to the text layer. */
  minTextLayerChars: z.number().int().nonnegative(),
});
export type VisionRouteBody = z.infer<typeof visionRouteBody>;

export const VISION_ROUTE_KIND = 'vision-route';
export const VISION_ROUTE_BODY_VERSION = 1;
export const VISION_ROUTE_CONTRACT_ID = 'vision-route-envelope.v1';
export const visionRouteEnvelope = artifactEnvelope(
  VISION_ROUTE_KIND,
  VISION_ROUTE_BODY_VERSION,
  visionRouteBody,
);
export type VisionRouteEnvelope = z.infer<typeof visionRouteEnvelope>;

/**
 * **2.5 — spot and merge repeated misconceptions.** The register's second
 * delivered threshold. The store is client-side and carries a fitness test
 * asserting no network primitive appears anywhere in its source — a privacy
 * control, not an accident — so the threshold must arrive *at* it rather than be
 * fetched *by* it.
 */
export const misconceptionMergeBody = z.object({
  /**
   * Cosine similarity at or above which a new statement merges into an existing
   * record. Deliberately high on a stated principle: creating two records for one
   * misunderstanding is a much smaller harm than merging two distinct ones and
   * telling her she keeps making a mistake she has made once.
   */
  minSimilarity: z.number().min(0).max(1),
});
export type MisconceptionMergeBody = z.infer<typeof misconceptionMergeBody>;

export const MISCONCEPTION_MERGE_KIND = 'misconception-merge';
export const MISCONCEPTION_MERGE_BODY_VERSION = 1;
export const MISCONCEPTION_MERGE_CONTRACT_ID = 'misconception-merge-envelope.v1';
export const misconceptionMergeEnvelope = artifactEnvelope(
  MISCONCEPTION_MERGE_KIND,
  MISCONCEPTION_MERGE_BODY_VERSION,
  misconceptionMergeBody,
);
export type MisconceptionMergeEnvelope = z.infer<typeof misconceptionMergeEnvelope>;

/**
 * **3.3 — rank by exam likelihood.** `[D-110]` (`ol-egov.28`): the component
 * register's four ranking-weight factors (proximity half-life, assessment
 * weight divisor, five-rung-plus-neutral mastery-need ladder) are DERIVED
 * per the register, and the register's own boundary column names them
 * service — so, per the declared/derived rule, only the numbers ship, never
 * the fitting. This is the third delivered threshold, and — unlike 1.6 and
 * 2.5, which pick between two internally-correct behaviours — a stale
 * weight set here costs *precision in a ranking*, never a false claim on
 * screen, which is the same operating-not-governing argument 1.6 and 2.5
 * already make, so this uses the same `OPERATING_*` pair.
 *
 * Promoted from `olea-service`'s `src/tasks/oracleRank.ts` scaffold
 * (`ol-v7r5.2`), which built this shape by hand because this file was
 * vendored and out of that bead's ownership — `ol-v7r5.3` is that
 * promotion. The service module re-vendors this export rather than
 * redefining it once `scripts/vendor-contracts.sh` runs.
 */
export const rankWeightsBody = z.object({
  /** Days at which exam proximity's contribution decays to half its value. */
  proximityHalfLifeDays: z.number().positive(),
  /** Divides an assessment's weight onto `[0, 1]` before it composes with proximity. */
  assessmentWeightDivisor: z.number().positive(),
  /** One multiplier per growth stage (`VOC-1`'s four-stage vocabulary, plus `unknown` for a skipped mastery join). */
  masteryNeedWeight: z.object({
    seed: z.number().min(0),
    sprout: z.number().min(0),
    sapling: z.number().min(0),
    tree: z.number().min(0),
    unknown: z.number().min(0),
  }),
});
export type RankWeightsBody = z.infer<typeof rankWeightsBody>;

export const RANK_WEIGHTS_KIND = 'rank-weights';
export const RANK_WEIGHTS_BODY_VERSION = 1;
export const RANK_WEIGHTS_CONTRACT_ID = 'rank-weights-envelope.v1';

/**
 * The Worker route that serves this artifact. A GET with no request
 * payload — `rank-weights` names no request-specific variable, so it does
 * not fit `POST /v1/task`'s generative-envelope shape (`tasks.ts`'s
 * `TASK_ENDPOINT_PATH`), the same reason `embedDispatch.ts`/
 * `rerankDispatch.ts` are additive branches rather than a body shape forced
 * through that endpoint. This is the first delivered-artifact kind with a
 * production route; `ol-v7r5.3`'s close evidence names the caller.
 */
export const RANK_WEIGHTS_ENDPOINT_PATH = '/v1/rank-weights';

export const rankWeightsEnvelope = artifactEnvelope(
  RANK_WEIGHTS_KIND,
  RANK_WEIGHTS_BODY_VERSION,
  rankWeightsBody,
);
export type RankWeightsEnvelope = z.infer<typeof rankWeightsEnvelope>;

/**
 * **The study plan, expressed against the shared envelope** — the surface the
 * envelope was generalised *from*.
 *
 * The mapping is total and mechanical, which is the evidence that the
 * generalisation is real rather than a second shape sitting beside the first:
 * `formatVersion` → `bodyVersion`, `planVersion` → `policyVersion`, `computedAt`
 * and `stamp` unchanged, and everything else is body. `study-plan.spec.ts`'s
 * companion test pins that mapping at compile time.
 *
 * The basis slot generalises what this artifact already had: `plannedConcept`'s
 * `reasoning`, `citations` and its two scores are the three parts of
 * `claimBasis` written out inline, before there was a shared name for them.
 * `plannedConceptBasis` below is that mapping, and it is what makes "the slot
 * generalises the study plan's" a checkable statement rather than a claim in a
 * comment.
 *
 * **This does not migrate the cache.** `studyPlanArtifact` is a persisted shape
 * with live consumers, so moving them onto this is a Class C change with its own
 * bead; what is settled here is the target shape, so the next delivered surface
 * has one to instantiate rather than one to invent.
 */
export const studyPlanBody = z.object({
  /**
   * The calendar day exam proximity was measured from, carried through so the
   * proximities are interpretable later rather than only at the instant they
   * were computed.
   */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf must be a YYYY-MM-DD calendar day'),
  /** One entry per course, ascending by `course`. */
  courses: z.array(studyPlanCourse),
  /**
   * A2.5's cross-course allocation (component 3.5) — one entry per running
   * course, alongside `courses`' per-course ranking. **Optional, added
   * `ol-v7r5.17` [ALLOC-2]**: `bodyVersion` stays `1` because this is
   * additive, not a shape change — a plan cached before this field existed
   * has no `allocation` key at all and must keep parsing exactly as it did
   * (see `study-plan.ts`'s own module doc on `formatVersion`/rebuild-not-
   * migrate, which this envelope inherits via `readArtifactEnvelope`).
   * Absence here is a statement about WHEN a plan was computed, never an
   * empty allocation — a caller reading `undefined` must not treat it as
   * "every course got zero", only as "no allocation policy travelled with
   * this plan". See `studyPlanAllocationEntry`'s own doc for the field
   * shape and the share-to-seconds conversion it contracts.
   */
  allocation: z.array(studyPlanAllocationEntry).optional(),
});
export type StudyPlanBody = z.infer<typeof studyPlanBody>;

/**
 * The study plan's inline evidence, read as the shared basis slot.
 *
 * Pure and total: every `plannedConcept` yields a valid `ClaimBasis`, which is
 * the evidence that the slot is a generalisation of what P5-T05 already built
 * rather than a second, parallel way of citing work.
 */
export function plannedConceptBasis(concept: {
  rank: number;
  weight: number;
  examProximityDays: number | null;
  reasoning: string;
  citations: readonly { sourcePath: string; questionLabel: string }[];
}): ClaimBasis {
  return {
    reasoning: concept.reasoning,
    factors: [
      { name: 'weight', value: concept.weight },
      { name: 'rank', value: concept.rank },
      ...(concept.examProximityDays === null
        ? []
        : [{ name: 'examProximityDays', value: concept.examProximityDays }]),
    ],
    evidence: concept.citations.map((citation) => ({
      kind: 'source' as const,
      sourcePath: citation.sourcePath,
      locator: citation.questionLabel,
    })),
  };
}

export const STUDY_PLAN_KIND = 'study-plan';
export const STUDY_PLAN_BODY_VERSION = 1;
export const STUDY_PLAN_ENVELOPE_CONTRACT_ID = 'study-plan-envelope.v1';
export const studyPlanEnvelope = artifactEnvelope(
  STUDY_PLAN_KIND,
  STUDY_PLAN_BODY_VERSION,
  studyPlanBody,
);
export type StudyPlanEnvelope = z.infer<typeof studyPlanEnvelope>;

contracts.register({
  id: VISION_ROUTE_CONTRACT_ID,
  schema: visionRouteEnvelope,
  description:
    'Delivered vision-routing threshold (register 1.6) in the versioned-artifact envelope',
});
contracts.register({
  id: MISCONCEPTION_MERGE_CONTRACT_ID,
  schema: misconceptionMergeEnvelope,
  description:
    'Delivered misconception-merge threshold (register 2.5) in the versioned-artifact envelope',
});
contracts.register({
  id: RANK_WEIGHTS_CONTRACT_ID,
  schema: rankWeightsEnvelope,
  description:
    'Delivered ranking-weights policy (register 3.3, [D-110]) in the versioned-artifact envelope',
});
contracts.register({
  id: STUDY_PLAN_ENVELOPE_CONTRACT_ID,
  schema: studyPlanEnvelope,
  description: 'The study-plan policy (A2.5, C7.6) in the versioned-artifact envelope',
});
