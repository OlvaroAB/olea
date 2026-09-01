/**
 * The versioned study-plan artifact — A2.5, C7.6 (P5-T05).
 *
 * A2.5 fixes the architecture in one sentence: *"The Worker computes priority
 * weights and topic rankings per course periodically (daily, or on material
 * change). The client caches the plan and runs review against it."* C5.5 says
 * what that split buys — the Worker supplies the **policy**, core **executes**
 * it against due instruments and local mastery, and it *"works offline from the
 * cached plan"*. C7.6 adds the one property this file exists for: *"Study plans
 * are versioned (A2.5), so review events can record which plan selected them,
 * as D7.1 requires."*
 *
 * So this is a **policy document, not a knowledge store.** It is the fast-update
 * channel D-011 names ("policy ships as data"), and it is the only artifact in
 * the product whose version is persisted into her append-only review log. Its
 * field list is the knowledge model's study-plan entity: weights, rankings,
 * computed-at, evidence, versioned.
 *
 * ## Why the schema lives here and not in core
 *
 * Because it crosses the wire. A2.5's Worker computes it; the client caches it;
 * `packages/core/src/plan/` builds, caches and executes it. `olea-service`
 * vendors this package (plan §2.4), so one schema is what stops the two halves
 * from disagreeing about a document that gets written into her plugin data
 * folder and quoted into an un-backfillable log.
 *
 * ## `formatVersion` is a discriminant from day one (P5-T05, Class B)
 *
 * Nothing has shipped that writes a plan, so there are zero instances in the
 * field and this shape can still be changed freely. That is exactly why the
 * discriminant goes in **now**: D-017's argument is that the last cheap moment
 * to version a persisted shape is before the first real instance of it exists,
 * and the review log has already paid for learning that lesson three times.
 * With `formatVersion` present, a later change is a migration; without it, a
 * later change is a guess about what an untagged blob on disk meant.
 *
 * Unlike the review log, though, this artifact is **rebuildable** (D-006): the
 * cache is a derivation, not a source of truth, so a reader that meets an
 * unknown `formatVersion` treats the blob as absent and rebuilds rather than
 * migrating. `core/src/plan/cache.ts` is where that happens, and it is the same
 * choice `PersistedEmbeddingCache` already makes.
 *
 * ## What is deliberately NOT in here
 *
 * - **No question text.** A citation carries the source path and the question
 *   label — enough to point at the evidence, which is what G5 asks for. The
 *   question's words are already in her vault and are recoverable from the path;
 *   copying them into a document that crosses the wire and then sits at rest in
 *   the plugin data folder would be storing her content to save a lookup (C6).
 * - **No instrument ids, no scheduling state, no due dates.** The plan is
 *   policy; due-ness is computed locally and stays exact offline (plan §7.1.6).
 *   A plan that carried her schedule would go stale the moment she reviewed.
 * - **No mastery.** Mastery is a local projection of her review log and never
 *   leaves the device as state. The oracle *consumes* it when ranking; the plan
 *   records the resulting weight, not the mastery that produced it.
 */

import { z } from 'zod';
import { contracts } from './registry.js';
import { responseStamp } from './worker.js';

/**
 * The `formatVersion` this build writes and is willing to read.
 *
 * Anything else on disk is treated as absent, not migrated — see this file's
 * module doc, and `core/src/plan/cache.ts` for the code that does it.
 */
export const STUDY_PLAN_FORMAT_VERSION = 1 as const;

/** The contract id this artifact registers under in the shared `SchemaRegistry`. */
export const STUDY_PLAN_CONTRACT_ID = 'study-plan.v1';

/**
 * One piece of evidence behind a planned concept — the knowledge model's
 * "evidence" field on the study-plan entity, and G5's "every ranking cites or
 * abstains" made structural.
 *
 * Path plus label, and nothing else. See the module doc for why the question's
 * text is not here.
 */
export const studyPlanCitation = z.object({
  /** Vault path of the past paper the citation came from. */
  sourcePath: z.string().min(1),
  /** The question's own label within that paper, verbatim (R1/R2). */
  questionLabel: z.string().min(1),
});
export type StudyPlanCitation = z.infer<typeof studyPlanCitation>;

/**
 * One concept the plan ranks, within one course.
 *
 * `rank` and `weight` are A2.5's "topic rankings" and "priority weights"
 * respectively, and they are **not** interchangeable: `rank` is the ordinal the
 * D7.1 record persists as `yieldRank`, while `weight` is the cardinal score
 * execution orders by. Carrying both means a later reader can tell "second"
 * from "second by a hair" — which is the difference between a prioritisation
 * that mattered and one that did not, and the Phase A→B checkpoint is going to
 * ask.
 */
export const plannedConcept = z.object({
  /**
   * The concept, by the only identity a concept has in v0.9: its verbatim
   * display name (knowledge model §4; R1/R2). This is the same string the
   * review log's `conceptIds` carries, which is what lets execution join a
   * queue item to its planned rank without a canonical-id layer neither side
   * has. Inherited from P5-T04's stated Class B reading, not re-decided here.
   */
  conceptId: z.string().min(1),
  /** 1-based ordinal within this course. Lands in D7.1 as `selectionContext.yieldRank`. */
  rank: z.number().int().positive(),
  /** The priority score that produced `rank`. Non-negative; never compared across courses. */
  weight: z.number().nonnegative(),
  /**
   * Whole days from the plan's `asOf` to the nearest still-future assessment
   * evidencing this concept; `null` when no contributing assessment had a
   * readable future due date. Lands in D7.1 as `selectionContext.examProximity`,
   * whose own doc reads "days to the nearest relevant assessment; null when
   * unknown or none" — the same sentence, which is why the shape matches.
   */
  examProximityDays: z.number().int().nullable(),
  /**
   * Why this concept is here, in the ranking's own words.
   *
   * Mechanically derived upstream (`core/src/oracle/rank.ts`'s `buildReasoning`)
   * from the very factors that produced the score, never separately composed
   * and never model-written. The artifact carries it verbatim so that "the
   * oracle shows its work" (G5) survives caching — an explanation regenerated
   * later would be an explanation of a *different* plan.
   */
  reasoning: z.string().min(1),
  /** Non-empty by schema: a ranked concept with no evidence is the case that abstains. */
  citations: z.array(studyPlanCitation).min(1),
});
export type PlannedConcept = z.infer<typeof plannedConcept>;

/**
 * One running course's slice of attention (A2.5's own allocation clause,
 * `docs/Olea_alpha_functional_scope.md` line ~247; component 3.5,
 * `computeAttentionShares` in `olea-service`'s `src/plan/allocation.ts`;
 * ratified alongside `[D-076]` round 4 and `[D-081]`).
 *
 * **Share, not seconds** — the plan is computed before any session's budget
 * is known, so the plan carries a fraction and the conversion to seconds is
 * contracted onto the SAME artifact (A2.5) rather than left for a client to
 * invent: multiply by the session budget in seconds; drop any course below
 * its own `minBlockSeconds` and redistribute its time across the remainder
 * in proportion; assign whole seconds by largest remainder, ties broken by
 * the nearer next assessment (this entry's own `examProximityDays`
 * contribution, when present) and then by `courseId`. Session composition
 * (C5.5) is the sole consumer of that conversion — see
 * `packages/core/src/study-session`.
 *
 * `courseId` matches `studyPlanCourse.course` verbatim (R1/R2) — the same
 * join key, not a second identity for the same course.
 */
export const studyPlanAllocationEntry = z.object({
  /** Opaque course identifier — matches `studyPlanCourse.course` (R1/R2). */
  courseId: z.string().min(1),
  /** Fraction of attention this course receives this computation, `0..1`. Shares across `courses` (plus any maintenance bucket, not carried here) sum to 1 at the source (`computeAttentionShares`'s own `shareSumIsValid`) — not re-asserted by this schema, which validates one entry at a time. */
  share: z.number().min(0).max(1),
  /**
   * Below this many seconds, this course's share cannot fund one usable
   * study block. A2.5's own redistribution rule reads this at session
   * composition — never derived from `share` itself.
   */
  minBlockSeconds: z.number().int().positive(),
  /**
   * The named lifts that produced `share`, so a contest is arguable offline
   * without re-deriving the formula — the same "named factors" idiom
   * `claimBasis.factors` uses in `artifact-envelope.ts`, reused here rather
   * than re-invented. Mirrors `computeAttentionShares`'s own
   * `CourseAllocationContribution` (risk, tempo, steeringMultiplier,
   * rawDesire, floor, cap), plus an `examProximityDays` entry when this
   * course has a known next assessment (omitted, never a fabricated number,
   * when it does not — the same absence-not-zero convention
   * `plannedConcept.examProximityDays` already uses). Non-empty: a share
   * with nothing that produced it is not explainable, and F6.4's own scenario
   * refuses to ship one.
   */
  contributions: z.array(z.object({ name: z.string().min(1), value: z.number() })).min(1),
  /** One sentence naming why this course got what it got (F6.4). */
  reason: z.string().min(1),
});
export type StudyPlanAllocationEntry = z.infer<typeof studyPlanAllocationEntry>;

/**
 * One course's policy — a ranking or an abstention, never both and never
 * neither.
 *
 * The union is preserved from `CourseOracleRanking` deliberately. P5-T04's
 * whole abstain path exists so that a course with no evidence is never rendered
 * as a course that simply came back empty; flattening it to an empty `concepts`
 * array here would undo that at the one layer that persists, and the emptiness
 * would then look like a plan that had considered the course and found nothing.
 */
export const studyPlanCourse = z.discriminatedUnion('status', [
  z.object({
    course: z.string().min(1),
    status: z.literal('ranked'),
    /** Ascending by `rank`, which is also descending by `weight`. Non-empty — an empty ranking abstains instead. */
    concepts: z.array(plannedConcept).min(1),
  }),
  z.object({
    course: z.string().min(1),
    status: z.literal('abstained'),
    reason: z.literal('no-evidence'),
    /** The abstention's own account of itself, carried verbatim from the ranking. */
    detail: z.string().min(1),
    /** The assessment paths abstained over. Non-empty: an abstention with nothing to cite is not an abstention. */
    assessmentPaths: z.array(z.string().min(1)).min(1),
  }),
]);
export type StudyPlanCourse = z.infer<typeof studyPlanCourse>;

/**
 * The whole artifact — what the client caches and executes review against.
 *
 * **`planVersion` is the field this schema exists for.** It is what C7.6 asks
 * for and what D7.1's `selectionContext.planVersion` persists into her review
 * log, forever, for every item a plan selected. Two consequences follow and both
 * are load-bearing:
 *
 * 1. It must be **derived from the plan's content**, not from a counter or a
 *    clock. `core/src/plan/build.ts` hashes the policy body — everything below
 *    except `computedAt` and `stamp` — so two plans that would rank her queue
 *    identically share a version and two that would not, do not. A clock-based
 *    version would make "the plan changed" indistinguishable from "the plan was
 *    recomputed", and the A→B checkpoint's central question is exactly which of
 *    those happened.
 * 2. It must be **opaque to consumers**. Nothing may parse it, order by it, or
 *    infer recency from it; it is an identity, and the moment something treats
 *    it as a sequence the derivation above becomes unchangeable.
 */
export const studyPlanArtifact = z.object({
  /** Schema discriminant. See the module doc — present from the first version, on purpose. */
  formatVersion: z.literal(STUDY_PLAN_FORMAT_VERSION),
  /** C7.6's version. Opaque, content-derived — see this object's doc. */
  planVersion: z.string().min(1),
  /**
   * When this plan was computed. ISO-8601 with offset, the same discipline the
   * review log uses and for the same reason: "when" about her study life is
   * local, and an offsetless instant silently becomes UTC somewhere downstream.
   *
   * Deliberately **outside** `planVersion`'s derivation: recomputing an
   * unchanged plan moves this and nothing else.
   */
  computedAt: z.string().datetime({ offset: true }),
  /**
   * The calendar day (`YYYY-MM-DD`) exam proximity was measured from — the
   * oracle's `asOf`, carried through so `examProximityDays` is interpretable
   * later rather than only at the instant it was computed. Plan §7.1.6's
   * "exam-yield decays in days, not minutes" is only checkable if the artifact
   * says which day it decayed from.
   */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf must be a YYYY-MM-DD calendar day'),
  /**
   * D7.3 provenance, present only when a Worker call contributed to this plan.
   *
   * Absent for a plan core computed locally from `rankOracle` — which is every
   * plan today, since `rankOracle` needs no model and Slot O is unpinned. The
   * field is optional rather than nullable because absence here means "no Worker
   * was involved", which is a statement about provenance, not a missing value.
   */
  stamp: responseStamp.optional(),
  /** One entry per course, ascending by `course`. Deterministic output, meaningful equality in tests. */
  courses: z.array(studyPlanCourse),
});
export type StudyPlanArtifact = z.infer<typeof studyPlanArtifact>;

/**
 * Registered into the shared registry at import, because `registry.ts`'s own
 * doc names this artifact as one of the two that belong there ("the
 * study-plan/review-log artifacts register into this instance"). The registry
 * is what gives `olea-service`'s vendored-copy drift check something to compare
 * by id rather than by file, so a schema that exists but never registers is
 * invisible to it.
 */
contracts.register({
  id: STUDY_PLAN_CONTRACT_ID,
  schema: studyPlanArtifact,
  description: 'Versioned study-plan artifact (A2.5, C7.6) — Worker-computed policy, client-cached',
});
