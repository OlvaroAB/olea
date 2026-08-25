/**
 * The shape every F6.5 insight answers in — and, more importantly, the three
 * answers a detector is allowed to give.
 *
 * ## Three statuses, not a boolean
 *
 * F6.5 asks for "observed-pattern insights". A detector that returns
 * `true | false` collapses two completely different statements into one:
 * *"I looked at a semester of history and this pattern is not there"* and
 * *"I have eleven reviews across four days and cannot tell you anything"*.
 * The panel renders those differently on purpose — the second is the honest
 * `too early to tell` state, and rendering it as `not-observed` would be a
 * claim the log cannot support. This is `today/panel.ts`'s `due: null` rule
 * (a surface that renders identically whether it counted nothing or read
 * nothing is making a claim it cannot support) applied to a derived pattern
 * rather than to a count, and `ol-1n1v`/`ol-cvsc` are the precedents.
 *
 * ## `measured` is separate from the sentence
 *
 * Every detector returns the numbers it decided on, not just its verdict, and
 * the user-facing sentence is built in `packages/plugin`'s `today/copy.ts`
 * from those numbers. Two reasons, and neither is style:
 *
 * - **Principle 12 is reviewable only if the phrasing is in one place.**
 *   `ol-p6t04`'s acceptance criteria require David to review every sentence
 *   before ship; sentences assembled inside a detector are sentences nobody
 *   can enumerate.
 * - **A number on screen has to be re-derivable.** `measured` is what a test,
 *   a workbench inspector and a bug report can all read.
 *
 * ## Nothing here is logged
 *
 * `InsightResult.reason` is a short machine-facing string for tests and the
 * workbench inspector. It names *why the detector answered as it did* and never
 * carries a concept id, a note title or her wording. `measured` for the effort
 * insight does carry course codes, because a per-course finding is not
 * expressible without them — it is rendered, never logged (D-005 permits task
 * id, token counts, cost, latency, model and prompt version, and nothing else).
 */

/** Every insight this module can produce. Extended only alongside a contract ref. */
export type InsightId = 'spacing' | 'effort-balance';

/**
 * - `observed` — the pattern is present in the log the detector was given.
 * - `not-observed` — there was enough history to look, and it is not there.
 * - `not-enough-history` — the detector declined to answer. **Not a negative
 *   result**: see this module's doc.
 */
export type InsightStatus = 'observed' | 'not-observed' | 'not-enough-history';

/**
 * A concept and the courses it belongs to — the join the review log cannot
 * make on its own.
 *
 * `ReviewLogRecord.conceptIds` names concepts, never courses (D7.1 logs
 * evidence, not taxonomy), so every per-course surface has to be handed this
 * map. It is the M:N shape `ConceptRecord.courses` already carries (F1.3,
 * `concept/course.ts`): a concept can sit in several courses, and a concept in
 * none is a statement rather than a failure.
 *
 * Declared structurally rather than as `ConceptRecord` so a caller with a
 * lighter source — the workbench's synthetic curriculum, a test — is not made
 * to fabricate tiers, source paths and binding targets it has no opinion
 * about. A real `ConceptRecord` maps across as
 * `{ conceptId: record.key, courses: record.courses }` — `conceptId` is the
 * opaque join key (`ol-63e1`, `[D-088]`/`[D-109]`), the same identity a
 * review-log `conceptIds` entry carries, never the display name.
 */
export interface ConceptCourses {
  readonly conceptId: string;
  readonly courses: readonly string[];
}

export interface InsightResult<M> {
  readonly id: InsightId;
  readonly status: InsightStatus;
  /**
   * What the detector measured. `null` **only** when `status` is
   * `not-enough-history` — a detector that answered at all shows its working.
   */
  readonly measured: M | null;
  /** Short, content-free, for tests and the workbench inspector. Never rendered to her, never logged. */
  readonly reason: string;
}
