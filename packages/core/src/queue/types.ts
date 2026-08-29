/**
 * Queue composition — the shapes (F2.5, F2.14, F2.17, C5.5, P2-T07).
 *
 * The queue is the one place in the product that knows about **both**
 * instruments and concepts, and it is deliberately the only one. Scheduling
 * state is per instrument (R3) and `Scheduler` may not so much as name a
 * concept; mastery is per concept and does not know what an instrument is.
 * Per-session dedupe (F2.17) is the requirement that needs both at once — "at
 * most one instrument per concept per session" is not expressible on either
 * side alone — so the join happens here and nowhere else.
 *
 * Everything below is plain data. The queue is a pure function of
 * `(candidates, now, suspended, filter)`; it reads no clock, opens no file and
 * holds no state between sessions. What she reviewed yesterday is in the
 * review log, and the scheduler state derived from it is in `QueueCandidate`.
 *
 * ## F2.18/F2.19 (`ol-ua0i`)
 *
 * WHAT is selected and deduped is still decided by plain FSRS due order alone
 * — see `compose.ts`'s module doc. F2.18's course blocks and F2.19's
 * within-block grouping are a presentation-order layer applied strictly
 * *after* that, reusing `study-session/compose.ts`'s own scoring formulas
 * (see `block-order.ts`). `QueueCandidate.targetAssessmentPath` and
 * `ComposeQueueInput.relatedConceptKeys`/`assessmentContext` exist only to
 * feed that layer.
 */

import type { SelectionContextV4 } from 'olea-contracts';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type { SchedulerState } from '../scheduler/types.js';
import type { CalendarDay } from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';

/**
 * One instrument the queue may offer, with everything composition needs to
 * decide and nothing it does not.
 *
 * Note the absences. There is no card text, no MCQ stem, no note path: the
 * queue decides *what to offer*, and rendering reads the instrument itself.
 * There is no mastery state either — C5.4's rollup is a consumer of reviews,
 * not an input to ordering, and letting it in here would be prioritisation by
 * the back door.
 */
export interface QueueCandidate {
  /** R3: scheduling and suspension are both per instrument. */
  readonly instrumentId: string;
  /**
   * Which of the three schedulable types this is (F2.14).
   *
   * `SchedulableInstrumentType` excludes explain-back by derivation from the
   * frozen log enum, so an explain-back attempt cannot be handed to the queue
   * at all. F2.14 says explain-back is "deliberately not FSRS-scheduled"; this
   * is that sentence made unrepresentable rather than checked.
   */
  readonly instrumentType: SchedulableInstrumentType;
  /**
   * Every concept this instrument practises — the spine, and F2.17's dedupe
   * key, which is a **set** rather than a single id (`ol-t3sd`).
   *
   * A note may name several `topic:` values and the instrument is evidence for
   * all of them, so it occupies all of their session slots. That is not a new
   * rule: it is F2.17's own rule ("at most one instrument per concept in any
   * one session") applied to a membership relation that is many-to-many. The
   * predecessor field was a single `conceptId` chosen from the list, and the
   * choice was a placeholder D-031 was forced into by a review-log record that
   * could persist only one id; v3 of that record persists the list, so the
   * queue carries the list.
   *
   * Non-empty by construction — `session/enumerate.ts` reports an instrument
   * whose note names no concept rather than emitting a candidate for it — and
   * in **her** authored order, never sorted or case-folded here (R1/R2).
   */
  readonly conceptIds: readonly string[];
  /**
   * Course codes this instrument's concept belongs to (F2.5), verbatim as
   * written in her vault — `ConceptRecord.courses`, M:N, matched by exact
   * string. R1/R2: never case-folded or canonicalised here, because two
   * course strings differing by case are two courses everywhere else in this
   * package and the queue is not the place to start disagreeing.
   *
   * A **concept-level** attribute, carried on each candidate for convenience.
   * `compose.ts` evaluates the filter per concept rather than per instrument
   * precisely so that a caller who supplies inconsistent lists for one
   * concept's instruments still cannot make the filter change *which*
   * instrument wins dedupe — see the filter section there.
   */
  readonly courses: readonly string[];
  /**
   * This instrument's FSRS state, or `null` if it has never been reviewed.
   *
   * `null` is the first-exposure case, exactly as in `ScheduleInput` — a new
   * instrument is an ordinary member of the due set with `dueState: 'new'`,
   * not a separate "new cards" pool with an interleaving ratio. Ratios are
   * prioritisation and belong to C5.5, not to v1.
   */
  readonly state: SchedulerState | null;
  /**
   * F2.19 (`ol-ua0i`): the concept's own target assessment, keyed the same
   * way `gap/build.ts`'s `GapRow.targetAssessmentPath` is — the join key into
   * `ComposeQueueInput.assessmentContext`. Optional and defaults to `null`
   * ("no known target assessment"), which reads as a no-op at the grouping
   * seam exactly like an absent map entry does — see `block-order.ts`.
   */
  readonly targetAssessmentPath?: VaultPath | null;
}

/**
 * F2.19's per-assessment date and resolved scope, restated rather than
 * imported from `study-session/compose.ts`'s `AssessmentGroupingContext` —
 * the same "restate a structurally identical shape across a layer boundary"
 * convention `assessment/scope-concept-keys.ts`'s own `AssessmentConceptContext`
 * doc states for the identical situation one layer down. `ReadonlyMap`'s
 * value position is covariant, so `resolveAssessmentGroupingContext`'s result
 * is assignable straight into `ComposeQueueInput.assessmentContext` with no
 * cast.
 */
export interface QueueAssessmentContext {
  /** F4.7's dated arithmetic input. `null` reads as "no known deadline". */
  readonly dueDay: CalendarDay | null;
  /** F1.7's resolved scope, already turned into concept keys by the caller. */
  readonly scopeConceptKeys: ReadonlySet<string>;
}

/**
 * F2.5's filter — **the shed floor** (`shed:F2.5`).
 *
 * Two structural predicates over fields the queue already has, both
 * `undefined` by default meaning "no restriction", combined with AND. That is
 * the whole feature. Saved filters, multi-select UI, exclusion filters,
 * free-text search and "everything except this course" are the shed: none is
 * in F2.5, each is a plausible capability nobody asked for, and CLAUDE.md is
 * explicit that a plausible capability invented mid-build is adopted
 * deliberately or not at all.
 *
 * "Topic" in F2.5's wording is the concept: her `topic:` property is where
 * tier-2 concepts come from (knowledge model §3), so filtering to one topic
 * and filtering to one concept are the same operation, and the field is named
 * for the spine rather than for the property that feeds it.
 */
export interface QueueFilter {
  /** Offer only instruments whose concept belongs to one of these courses. */
  readonly courses?: readonly string[];
  /** Offer only instruments on one of these concepts (F2.5's "topic"). */
  readonly conceptIds?: readonly string[];
}

/**
 * The part of D7.1's `selectionContext` the **queue** decides, derived from the
 * frozen contract type by `Pick` so it cannot drift from it.
 *
 * The one context field that is not the queue's to know is deliberately not
 * guessed at here: `planVersion` comes from the published study plan (C7.6,
 * null until P5). The caller assembling a `ReviewLogRecord` completes the
 * object; splitting it this way means neither half has to invent the other's
 * values.
 *
 * `masteryAtTime` is no longer in this object at all: with `ol-g6zg` it moved
 * out of `selectionContext` onto the record, keyed by `conceptIds`. It is still
 * not the queue's to know — it is C5.4's rollup (`ol-p4t06`), which does not
 * exist yet — and the caller now omits it rather than stating a null.
 *
 * `yieldRank` and `examProximity` are the queue's, and in v1 the queue's
 * answer is `null` for both — *stated*, not omitted. D7.1's doc is explicit
 * that recording them as explicit nulls is what makes the Phase A baseline and
 * the Phase B comparison the same shape.
 */
export type QueueSelectionContext = Pick<
  SelectionContextV4,
  'dueState' | 'examProximity' | 'yieldRank' | 'instrumentTypesOffered'
>;

/** One instrument the queue is offering this session, in presentation order. */
export interface QueueItem {
  readonly instrumentId: string;
  readonly instrumentType: SchedulableInstrumentType;
  /**
   * Every concept this instrument is evidence for, in her order — passed
   * straight through from the candidate, and exactly what the v3 review-log
   * record persists when she rates it (`ol-t3sd`).
   */
  readonly conceptIds: readonly string[];
  /**
   * This instrument's scheduling state *before* today's review, or `null`
   * before its first-ever review — passed straight through from the candidate.
   *
   * Carried on the offered item because the review view needs it (interval
   * preview, and the `ScheduleInput.state` it hands the scheduler when she
   * rates), and because the alternative is every caller keeping its own
   * id→state map alongside the queue and the two drifting. The queue does not
   * read it beyond ordering and never writes it: composition is not a review.
   */
  readonly priorState: SchedulerState | null;
  /** What the queue knew when it chose this item (D7.1). */
  readonly selectionContext: QueueSelectionContext;
}

/**
 * An instrument that was due and is **not being offered this session**, and why.
 *
 * This type exists because a dedupe that silently discards is indistinguishable
 * from a scheduling bug. F2.17 rules that a deferred instrument is reviewed
 * later than it wanted and that FSRS is built to absorb exactly that —
 * *late*, not *lost*. Naming each
 * deferral, with the instrument that took its concept's slot, is what makes the
 * difference observable to a test, to a log, and to anyone debugging "why
 * didn't that card come up".
 */
export interface DeferredInstrument {
  readonly instrumentId: string;
  /** Every concept this instrument would have been evidence for, in her order. */
  readonly conceptIds: readonly string[];
  /**
   * The instrument that occupied a slot this one needed.
   *
   * With a set-valued key an instrument can be blocked by more than one
   * incumbent at once, and this names **the incumbent of the first of its own
   * `conceptIds` that was already taken** — first in her order, which is the
   * only ordering in the data. One name rather than a list because the field's
   * job is to answer "why didn't that card come up" with something a person can
   * follow; the full picture is recoverable from `items` and `conceptIds`.
   */
  readonly deferredBehind: string;
}

/** What `composeQueue` needs. Pure inputs only — `now` is passed, never read. */
export interface ComposeQueueInput {
  /** Every schedulable instrument in scope, in whatever order the caller has. */
  readonly candidates: readonly QueueCandidate[];
  /**
   * The instant the session is being composed. Always the caller's value —
   * same discipline as `ScheduleInput.now`, so composition is deterministic
   * and a review-log replay is trustworthy.
   */
  readonly now: Date;
  /**
   * The projected suspended set (F2.6, `review-log/suspension.ts`), or omitted
   * when nothing is suspended. The queue excludes it; it never writes it.
   */
  readonly suspended?: ReadonlySet<string>;
  /** F2.5. Omitted means no filter. */
  readonly filter?: QueueFilter;
  /**
   * Preferred instrument types, most preferred first. F2.17 asks the queue to
   * favour whichever instrument matches the format of the nearest assessment
   * (F4.8).
   *
   * **Injected, not computed.** Working out which format the nearest
   * assessment wants is F4.8's job and the assessment register's data; the
   * queue's job is to honour the preference once something else has decided
   * it. Omitted (the v1 default, since F4.8 has not shipped) means no
   * preference, and dedupe keeps whichever instrument plain FSRS order put
   * first — never a hidden preference for one type, which would be exactly the
   * prioritisation heuristic C5.5 and the oracle own.
   */
  readonly formatPreference?: readonly SchedulableInstrumentType[];
  /**
   * F2.17's per-session concept dedupe. Defaults to `true`, which is F2.17's
   * own default: at most one instrument per concept in any one session.
   *
   * The seam exists because F2.17's own last sentence names the one case that
   * lifts the cap: with an assessment close, working a concept through both of
   * its instruments is the intent rather than waste. Exam-proximity
   * mode itself is not built, so nothing in v1 passes `false`; the flag is the
   * named relaxation and nothing more.
   */
  readonly dedupeByConcept?: boolean;
  /**
   * F2.19 (`ol-ua0i`): C7.10 relation adjacency, keyed by `conceptKey`, each
   * value the set of OTHER `conceptKey`s it connects to — the identical shape
   * `study-session/compose.ts`'s `ComposeSessionRowsInput.relatedConceptKeys`
   * takes, produced by the same `resolveRelatedConceptKeys` resolver.
   * **Optional and safe to omit entirely**: see `block-order.ts`'s no-op
   * proof.
   */
  readonly relatedConceptKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * F2.19 (`ol-ua0i`): F1.7's per-assessment date and resolved scope, keyed
   * by the exact `VaultPath` a candidate's own `targetAssessmentPath` names
   * — see {@link QueueAssessmentContext}. **Optional and safe to omit
   * entirely.**
   */
  readonly assessmentContext?: ReadonlyMap<VaultPath, QueueAssessmentContext>;
}

/**
 * A composed session: what is offered, and what was due but deferred.
 *
 * Both halves are returned because only one of them is visible to her. The
 * deferred list is how the queue stays accountable for every due instrument it
 * did not show — see `DeferredInstrument`.
 */
export interface ComposedQueue {
  readonly items: readonly QueueItem[];
  readonly deferred: readonly DeferredInstrument[];
}
