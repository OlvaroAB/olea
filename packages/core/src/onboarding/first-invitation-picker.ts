/**
 * F5.1 — the first-suggestion picker (`ol-0r92.22`, private-repo bead; the
 * clause itself, F5.1, is "prompt her to explain a topic in her own words" —
 * this module adds HOW the first (and, generalised, each subsequent) concept
 * is chosen, not a new surface).
 *
 * **Where this comes from.** `olea-service/eval/explainback/SEEDING.md`
 * (private — real course names and note titles, INV-3) is a mastery-aware
 * seeding artifact: real per-concept mastery data does not exist yet, so it
 * proxies mastery with a note-depth judgement (`thorough`/`moderate`/`thin`)
 * and relabels that as a three-level `invitationTier` (`first`/`mid`/`last`).
 * The reasoning, in brief (full argument on decision bead `ol-qbbb`): grading
 * failures are NOT symmetric. A well-known concept mostly risks the loud,
 * arguable "invented fault" direction; a shaky one risks the silent "false
 * praise" direction the grader's calibration evidence has not yet
 * accumulated for. So her earliest invitations are weighted toward
 * concepts she already knows well, and shaky ones enter later, once
 * calibration evidence exists.
 *
 * **This module is the consumer of that schema, not of that data.** It knows
 * nothing about courses, concepts or vault content — it operates on whatever
 * tier-labelled candidate list a caller supplies, matching SEEDING.md's shape
 * generalised to `{ id, invitationTier }`. That is what makes it safe to ship
 * in this public repo: the *rule* (tier order, tie-break) is a declared,
 * non-fitted label ordering (N-015 — no number here was tuned against a
 * corpus or eval set), never real content. The actual seeded rows for the
 * real alpha vault stay in the private repo, as SEEDING.md already states.
 *
 * **What this module does NOT do.** It does not compute `invitationTier` (or
 * a depth proxy) from a vault — no code anywhere in this package's
 * `extract/` or `tier3-evidence/` derives an automatic depth signal for an
 * arbitrary concept today; SEEDING.md's depth column was a one-off human
 * judgement over one real extraction run, not a pipeline output. Building
 * that detector is a separate, larger task. Nor does it read real
 * per-concept mastery state — SEEDING.md is explicit that its tier ordering
 * is a cold-start fallback, superseded the moment real mastery data exists;
 * wiring that substitution is future work for whichever caller composes this
 * function against a real mastery source.
 */

/**
 * SEEDING.md's own three-level scale. Order matters: index position IS tier
 * priority (`first` before `mid` before `last`) — see {@link TIER_ORDER}.
 */
export type InvitationTier = 'first' | 'mid' | 'last';

/**
 * Declared (see module doc), never derived: a fixed priority ordering over
 * the three tier labels, matching SEEDING.md's own `tierOrder` field
 * verbatim. Exported so a caller can render or reason about tier priority
 * without re-stating this list.
 */
export const TIER_ORDER: readonly InvitationTier[] = ['first', 'mid', 'last'];

/**
 * The minimal shape this module needs from a candidate — generic on purpose,
 * so a caller's richer record (course, concept id, depth, tierRationale —
 * whatever SEEDING.md or a future real source attaches) flows through
 * untouched via the `T` type parameter on {@link pickNextExplainBackInvitation}.
 */
export interface FirstInvitationCandidate {
  /** A stable identifier for this candidate, opaque to this module. */
  readonly id: string;
  /** SEEDING.md's tier label for this candidate. */
  readonly invitationTier: InvitationTier;
}

/**
 * Picks the next explain-back invitation from a tier-labelled candidate
 * list: the earliest tier (`TIER_ORDER`) that still has an un-invited
 * candidate, honouring the caller's own array order as the (declared, not
 * fitted) tie-break within that tier — SEEDING.md itself supplies no
 * within-tier ordering, so this is the one place that gap is closed, and it
 * is closed by a stated rule rather than left implicit.
 *
 * Calling this with an empty `alreadyInvitedIds` picks the very first
 * invitation she is ever offered (this bead's own title); calling it again
 * with every prior id folded in picks the next one, so the same function
 * serves the whole onboarding sequence SEEDING.md describes, not just its
 * first call.
 *
 * Total over its inputs: an empty candidate list, or a candidate list that
 * is entirely already-invited, both return `null` rather than throwing.
 */
export function pickNextExplainBackInvitation<T extends FirstInvitationCandidate>(
  candidates: readonly T[],
  alreadyInvitedIds: ReadonlySet<string> | readonly string[] = [],
): T | null {
  const invited = alreadyInvitedIds instanceof Set ? alreadyInvitedIds : new Set(alreadyInvitedIds);
  const remaining = candidates.filter((candidate) => !invited.has(candidate.id));
  for (const tier of TIER_ORDER) {
    const match = remaining.find((candidate) => candidate.invitationTier === tier);
    if (match !== undefined) return match;
  }
  return null;
}
