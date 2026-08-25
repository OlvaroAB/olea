/**
 * The task-id catalogue — a closed vocabulary, by design (C4.1–C4.3).
 *
 * "FROZEN (P3-T02, ... D-011)" used to stand here. That was a
 * lane-coordination device from when P3-T01/P3-T02 forked in parallel; those
 * lanes finished long ago, and D-011 governs the envelope's version discipline
 * in `worker.ts`, not this file's vocabulary (ol-jnt0). What actually keeps
 * this catalogue closed is the argument below, and it is a real, ongoing
 * design rule rather than a lane-era leftover.
 *
 * `worker.ts` fixes the *envelope*: how every call is versioned, stamped and
 * refused. This file fixes the *vocabulary*: which task ids exist at all.
 * They are separate rules because they fail differently — an envelope change
 * breaks every call at once, while a task-id change breaks exactly the feature
 * that owns it.
 *
 * **Why a closed catalogue rather than an open string.** A task id is the join
 * key between four things that live in four different places: the client call
 * site, the Worker's routing table, the versioned prompt directory (C4.3), and
 * the telemetry record that D-005 permits (task id is one of the few fields it
 * *does* permit, precisely because it carries no content). If the id is a free
 * string, those four drift silently — a typo becomes a 404 in production, and
 * a renamed prompt directory becomes an un-joinable gap in a semester of cost
 * data. Freezing the vocabulary makes all four provably the same set.
 *
 * **What is deliberately NOT here: slot routing.** Which model slot serves a
 * task is config, swappable without touching a call site (C4.6), and it lives
 * server-side in `olea-service/src/slots.ts`. Putting it in a client-visible
 * contract would create a second source of truth for a value designed to be
 * changed. The slot named in each comment below is documentation of intent,
 * not a binding.
 *
 * **Naming.** `<domain>.<verb>.v<N>` — three parts, always. The trailing
 * version is per *task*, not the contract version: a task whose payload shape
 * changes incompatibly gets `.v2` and both are served during the overlap,
 * which is a smaller and cheaper migration than bumping `CONTRACT_VERSION` for
 * every feature that evolves. `CONTRACT_VERSION` moves only when the envelope
 * moves.
 *
 * **Registration is still per-bead.** Appearing here means the id is reserved
 * and spelled correctly; it does NOT mean the Worker serves it yet. Each task's
 * request/response payload shape lands in the bead that owns the feature, so
 * the shape is designed against a real caller rather than guessed in advance.
 * `registeredTaskIds()` on the Worker is the truth about what is live; this is
 * the truth about what is spellable.
 */

import { z } from 'zod';

/**
 * Every task id v0.9 will ever route, keyed by the workload shape it belongs to
 * (cost model §1) and the contract clause that demands it.
 *
 * Derived from the functional scope's feature set rather than invented: each
 * entry below is a feature the contract already names, not a capability added
 * because it seemed useful. F2.14's extensibility rule applies — adding a
 * schedulable instrument type later must not require a new task id here.
 */
export const TASK_IDS = {
  /** W1 · Slot E — embed note/section text for retrieval (C2, C3). */
  RETRIEVAL_EMBED: 'retrieval.embed.v1',
  /** W3 · Slot G — section summaries (F3.2). */
  SECTIONS_SUMMARIZE: 'sections.summarize.v1',
  /**
   * W4 · Slot G — concepts read out of her material, corroborated (never
   * overridden) by her filing conventions (F1.4, C7.3, `[D-068]`, `[D-082]`).
   * The client-side stage is `packages/core/src/concept/read.ts`'s
   * `readConcepts`, reached through the `ConceptReaderPort` seam; this id is
   * that port's join key, added by EXT-7 (`ol-5nle`) per the reservation this
   * catalogue's own test carried since P3-T02.
   */
  CONCEPTS_EXTRACT: 'concepts.extract.v1',
  /** W3 · Slot G — Q&A and cloze card drafts, INV-6 accept step downstream (F3.3). */
  CARDS_GENERATE: 'cards.generate.v1',
  /** W3 · Slot G — MCQ generation incl. distractors (F3.10, amendment F2.14–F2.17). */
  QUIZ_GENERATE: 'quiz.generate.v1',
  /** W5 · Slot J — "explain why I got this wrong", mid-review, strict latency (F2.7, F2.10). */
  EXPLAIN_WHY_GENERATE: 'explain-why.generate.v1',
  /** W6 · Slot J — grade an explain-back attempt (F5, F4.6, R7). */
  EXPLAIN_BACK_JUDGE: 'explain-back.judge.v1',
  /** W7 · Slot O — the exam oracle's yield ranking (F4.2–F4.4). */
  ORACLE_RANK: 'oracle.rank.v1',
  /**
   * W1 · Slot R — cross-encoder rerank of the hybrid retrieval candidate set;
   * scores (query, chunk) pairs together rather than comparing independent
   * embeddings (C2.5's "reranked", Run 13 Ruling 1).
   */
  RETRIEVAL_RERANK: 'retrieval.rerank.v1',
  /**
   * W6 · Slot J — the explicit support check: given the query and the
   * assembled context, does that context actually support answering it
   * (C4.7's grounding-refusal path; Run 13 Ruling 1). Echoes
   * `explain-back.judge.v1`'s shape because it is the same kind of act — a
   * verdict over material that already exists, not a generation.
   */
  GROUNDING_JUDGE: 'grounding.judge.v1',
} as const;

/** The closed catalogue as a value, sorted for stable diffs and golden output. */
export const ALL_TASK_IDS = Object.values(TASK_IDS).slice().sort() as readonly KnownTaskId[];

export type KnownTaskId = (typeof TASK_IDS)[keyof typeof TASK_IDS];

/**
 * Validator for a task id drawn from the closed catalogue.
 *
 * Deliberately **not** substituted into `requestEnvelope.taskId`, which stays a
 * permissive string. The distinction is worth keeping: a malformed envelope is
 * `invalid-request`, while a well-formed request naming an id this build does
 * not serve is a routing miss the Worker can answer precisely. Collapsing the
 * two would tell a client with a newer plugin that its JSON was broken, when in
 * fact its Worker is simply older — which is exactly the confusion D-011's
 * version floor exists to prevent.
 */
export const knownTaskId = z.enum(ALL_TASK_IDS as unknown as [KnownTaskId, ...KnownTaskId[]]);

/** Is this id in the closed catalogue? Cheap guard for routing tables. */
export function isKnownTaskId(id: string): id is KnownTaskId {
  return (ALL_TASK_IDS as readonly string[]).includes(id);
}

/**
 * The one endpoint. Every task goes through it, discriminated by task id in the
 * envelope rather than by URL path.
 *
 * A path per task would put the task vocabulary in two places — the router and
 * this file — and would make adding a task a deploy-shaped change rather than a
 * registration. It would also leak the feature set to anyone watching request
 * URLs, which is a small thing, but free to avoid.
 */
export const TASK_ENDPOINT_PATH = '/v1/task' as const;
