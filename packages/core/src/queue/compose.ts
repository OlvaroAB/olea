/**
 * Queue composition v1 (F2.5, F2.14, F2.17, C5.5, P2-T07).
 *
 * **Retired from production, `[SESS-8.6]` (`ol-egov.132.6`,
 * `docs/dev/one-assembly-path.md` §2/§4).** `composeQueue` was the review
 * tab's second, competing composition — F4.6/F6.4's own defect, "two doors,
 * two compositions, one of them answered." `../study-session/compose.ts`'s
 * `buildComposedStudySession` is now the one composition the student
 * actually sits; `session/build.ts` no longer calls this function at all (see
 * that module's own doc), and the review tab's own former call
 * (`review/open-session.ts`) was removed at `[SESS-8.4]` (row 4), before this
 * row deleted the composeQueue call it had already stopped reading.
 *
 * **Everything below is unchanged and still real** — this module is pinned
 * by its two remaining, non-production callers, both of which compose
 * exactly the shape this doc describes over a real vault's enumeration:
 * `packages/workbench/src/queue/derive.ts` (the design workbench's scripted
 * `#/today/*`/`#/review/*` states) and
 * `packages/workbench/src/simulator/live-queue.ts` (the simulator's live,
 * persisted-vault "rate one item" affordance). Neither reaches
 * `session/build.ts`'s `queue` field — both already called `composeQueue`
 * directly over `buildReviewSession`'s enumerated `candidates`, which is why
 * neither needed to change for this row. `packages/core/src/session/build.spec.ts`
 * and `packages/core/test/session/fixture-vault.spec.ts` exercise this exact
 * same real-vault-to-`composeQueue` shape, for the identical reason.
 *
 * Six steps, in this order, each of which exists for a stated reason:
 *
 *   1. **Filter** (F2.5) — narrow to a course or a concept, if she asked.
 *   2. **Exclude suspended** (F2.6) — the queue's half of suspension.
 *   3. **Keep only what is due** — nothing is ever drawn early in v1.
 *   4. **Order** — plain FSRS due order, and nothing else.
 *   5. **Dedupe by concept** (F2.17) — at most one per concept, the rest
 *      deferred *and named*.
 *   6. **Block and group** (F2.18/F2.19, `ol-ua0i`) — the already-decided
 *      offer list is reordered into course blocks, refined by within-block
 *      grouping. See "F2.18/F2.19" below.
 *
 * ## Plain FSRS order decides WHAT is selected and deduped
 *
 * There is still no priority heuristic in steps 1–5, and adding one there
 * would be a mistake with a cost: C5.5 and the oracle (F2.8, F4.3) own
 * prioritisation, and nothing here reaches into it. Due date ascending, ties
 * keep the caller's order, never-reviewed instruments last — that is the
 * whole ordering these steps use to decide which instrument wins a dedupe
 * tie, and `yieldRank`/`examProximity` still come out null, stating that no
 * prioritisation ran rather than leaving the question open.
 *
 * (This section used to ground the "no heuristic" rule in a Phase A→B
 * checkpoint measuring whether prioritisation changed what she studied — spec
 * §8's own Phase A/B distinction, which `[D-071]` has since withdrawn. The
 * checkpoint is gone; the ordering discipline it argued for is kept on its
 * own merits, for step 4/5's purposes only — see the next section for what
 * changed downstream of them.)
 *
 * ## F2.18/F2.19 — course blocks and within-block grouping, applied after selection
 *
 * Step 6 (`ol-ua0i`) reorders the offer list steps 1–5 already decided into
 * F2.18's course blocks, refined by F2.19's within-tie-band grouping —
 * exactly the shape `study-session/compose.ts` already ships for the Today
 * session (`blockByCoursePresentation`). `./block-order.ts` reuses that
 * module's own scoring formulas rather than restating them; its own doc has
 * the full account, including why `[D-113]`'s overdue-first primacy is
 * unaffected (grouping only ever moves an item within an exact tie band,
 * never across one, and never changes which instrument was selected or won a
 * dedupe tie in steps 1–5 above). `relatedConceptKeys`, `assessmentContext`,
 * and (`[D-149]`, `ol-v7r5.22`) `arrivalDays`/`conceptSourcePaths` — the
 * material-arrival cohort, blended into relatedness — are all optional,
 * caller-resolved, and a no-op when omitted — see that module's doc.
 *
 * ## The dedupe key is a set (`ol-t3sd`)
 *
 * A note may name several `topic:` values, and its instruments are evidence for
 * every one of them — that is the ruled semantics, and v3 of the review-log
 * record persists it. So an instrument occupies **every** one of its concepts'
 * session slots, and an instrument is offered only when none of its concepts
 * has already been claimed. F2.17's rule is unchanged ("at most one instrument
 * per concept in any one session"); what changed is that concept membership is
 * many-to-many, so the rule now has to be enforced over a set.
 *
 * This is visible to her, and only in one place: a note listing several topics.
 * Before, such an instrument bound to her first topic alone, so a second
 * instrument on a co-listed topic could be offered in the same session — two
 * instruments for a concept the log was about to say she had practised twice.
 * That is what F2.17 forbids. For a corpus where every note names one topic —
 * every case the previous behaviour was actually right for — composition is
 * unchanged, candidate for candidate, and `compose.spec.ts` is the untouched
 * evidence.
 *
 * ## Dedupe defers, it never drops
 *
 * F2.17's dedupe is a UX decision: repeat hits on a single concept inside one
 * sitting are, per the amendment, the quickest route to a queue that feels like
 * padding. The failure mode of implementing it carelessly is a scheduling bug that looks
 * like a UX feature: an instrument that stops being offered and nobody
 * notices, because the thing that dropped it also decides what she sees. Every
 * deferral is therefore returned in `ComposedQueue.deferred` with the
 * instrument that took its slot, and the deferred instrument's scheduler state
 * is untouched, so the next session offers it as an ordinary due item — later
 * than it wanted, which is exactly what F2.17 says FSRS tolerates by design.
 *
 * ## `[D-240]` item 2 — format preference may not defer a recall instrument past its own interval
 *
 * Amendment, ruled on brief 62 (`ol-egov.130`): format preference may still
 * prefer the assessment-matched instrument (F4.8), but it may not defer a
 * concept's recall-tier instrument (`qa`/`cloze`, R3's tier filter,
 * `isRecallTier`) once THAT instrument is overdue by at least
 * {@link DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER} times its own scheduled
 * interval. Past that bound, the recall-tier instrument takes the concept's
 * slot outright and the matched (e.g. `mcq`) kind is the one that reviews
 * late instead — the same "defers, never drops" accounting, with the roles
 * swapped. Concept-level, and it needs no new number of its own: the bound is
 * `SchedulerState.scheduledDays`, the interval the scheduler already computed
 * for that instrument — or, for an instrument never yet reviewed, the
 * interval the scheduler would assign after a first good answer, measured
 * from the day its concept's material arrived (`[D-240]` item 2's ratified
 * null-state reading).
 *
 * **The rule itself is not in this file.** It lives in
 * `../scheduler/serving.ts` (`recallOutranksFormatPreference`,
 * `hasWaitedItsOwnInterval`, `firstIntervalDaysAfterGood` and
 * {@link DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER}) — this module's own
 * `dedupeRank` calls it, and so does `../study-session/build.ts`'s
 * `orderedForFormat`, the ONE production composer's own serving step
 * (`[SESS-8.6]`, this file's retirement note above). One rule shared by both
 * rather than restated in each, so a workbench/simulator screenshot composed
 * through this file still honours the identical `[D-240]` item 2 arbitration
 * the student actually gets. `ol-2zfj.71` [SESS-7] is the bead that shared
 * it; that module's doc carries the C5.7 argument for why a second
 * implementation was the defect rather than a convenience.
 *
 * This only ever fires where a preference exists to defer against
 * (`formatPreference.length > 0`) — with no preference, dedupe already runs
 * on plain FSRS order (the un-amended base rule above), which `[D-240]` item
 * 2 does not touch. It is also gated on `ComposeQueueInput.servingPolicy`:
 * `'interval-bound'` (the default) is this amended rule; `'today'` is the
 * pre-amendment behaviour, kept so the harness's three-arm sweep
 * (`[D-240]` item 4) can replay the un-amended arm on the real composer;
 * `'preference-off'` ignores `formatPreference` entirely (as if it were
 * omitted), which makes the override moot for the same reason an empty
 * preference does. The final-week relaxation (`dedupeByConcept: false`) is
 * untouched by any of this — with dedupe off, nothing is deferred by
 * anything, preference or interval, and both instruments are offered.
 *
 * ## `[D-240]` item 5 — the reason a winning item's own dedupe decision goes on `QueueItem.dedupeReason`
 *
 * When a preference-in-force dedupe decided a concept's winner over a real
 * competitor, the winning `QueueItem` carries which side of that decision it
 * was on — `'format-match'` (F2.17/F4.8's base rule) or `'recall-overdue'`
 * (item 2's override, above) — computed by {@link dedupeReasonFor} from what
 * the finished `deferred` list actually lost to it, never by re-running
 * {@link dedupeRank}. `undefined` for the ordinary case (no preference in
 * force, or nothing lost a slot to this instrument). Non-persisted:
 * `packages/plugin/src/review/copy.ts`'s `dedupeReasonLine` is the reason
 * surface that turns `'recall-overdue'` into the sentence
 * `ol-egov.130` item 5 asks for.
 */

import { daysBetween } from '../dates.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import { isRecallTier } from '../mastery/vitality.js';
import { isInstrumentSuspended } from '../review-log/suspension.js';
import { recallOutranksFormatPreference } from '../scheduler/serving.js';
import type { CalendarDay } from '../today/calendar-day.js';
import { applyCourseBlocking } from './block-order.js';
import type {
  ComposedQueue,
  ComposeQueueInput,
  DeferredInstrument,
  QueueCandidate,
  QueueFilter,
  QueueItem,
  QueueItemReason,
  QueueSelectionContext,
  QueueServingPolicy,
} from './types.js';

/**
 * `[D-240]` item 3's multiplier, re-exported under the name `[SESS-3]` gave
 * it and the specs and harness cite it by. It is **defined once**, in
 * `../scheduler/serving.ts` alongside the rule it bounds — see that module's
 * own doc for the declared-not-derived argument and the pre-commitment, and
 * this file's `[D-240]` section below for why the rule left this file.
 */
export { DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER } from '../scheduler/serving.js';

/** `dueState` for an instrument the queue is offering. Never `'early'` in v1 — see `dueStateOf`. */
type OfferedDueState = Exclude<QueueSelectionContext['dueState'], 'early'>;

/**
 * Whether an instrument is due, and how, at `now`.
 *
 * `null` means "not due" — the caller excludes it.
 *
 * **Calendar days, not instants.** `daysBetween` normalises both sides to UTC
 * midnight, so an instrument due later today is due *today*: she should not
 * have to wait until 18:04 for the item FSRS scheduled at 18:04 yesterday, and
 * a queue that made her would be unusable as a daily habit. That is the same
 * day-granularity every spaced-repetition tool uses, and it is why `dates.ts`
 * exists in this package at all.
 *
 * `'early'` is deliberately unreachable. The frozen enum has the value because
 * exam-proximity mode and the oracle may one day draw an item before its due
 * date; v1 never does, and the return type says so rather than a comment.
 */
function dueStateOf(candidate: QueueCandidate, now: Date): OfferedDueState | null {
  if (candidate.state === null) return 'new';
  const daysLate = daysBetween(new Date(candidate.state.due), now);
  if (daysLate < 0) return null;
  return daysLate === 0 ? 'due' : 'overdue';
}

/**
 * Sort key for plain FSRS order. Never-reviewed instruments sort after every
 * due one.
 *
 * Not a priority score: it is the due instant and nothing else.
 * `Number.POSITIVE_INFINITY` for a new instrument is not "lowest priority", it
 * is "has no due date", and the two happen to sort the same way. New material
 * going last is the conservative reading of "due instruments in plain FSRS
 * order" — what is already in her rotation comes before what is not — and it
 * is a position, not a ratio: v1 has no new-item interleaving policy because
 * that is prioritisation.
 */
function dueInstant(candidate: QueueCandidate): number {
  return candidate.state === null ? Number.POSITIVE_INFINITY : Date.parse(candidate.state.due);
}

/**
 * F2.5, evaluated **per concept** rather than per instrument.
 *
 * Both of F2.5's predicates are properties of the concept (its course, its own
 * identity), so a concept is either wholly in the filtered session or wholly
 * out. Deciding it once per concept rather than once per instrument is what
 * makes the filter unable to change *which* instrument wins dedupe — it can
 * only remove whole concepts — and that is the property the "a filtered
 * session is a subsequence of the unfiltered one" test asserts. Evaluating it
 * per instrument would produce the same answer for well-formed input and a
 * silently re-ranked session for input where one concept's instruments
 * disagreed about their course list.
 *
 * A concept passes a course filter if **any** of its instruments names a
 * matching course, which is also the right answer for the M:N case: a concept
 * shared between two courses is legitimately part of both courses' sessions.
 *
 * Since `ol-t3sd`, a candidate belongs to several concepts, so the filter asks
 * about **membership** rather than about a chosen primary: an instrument passes
 * a concept filter if any of its concepts is allowed, and when it passes, all
 * of its concepts are in the session. Filtering to a concept she co-listed
 * second now reaches the instruments that name it — under bind-to-first they
 * were invisible to their own concept's filter, which was the narrowing showing
 * through into F2.5.
 */
function passingConceptIds(
  candidates: readonly QueueCandidate[],
  filter: QueueFilter | undefined,
): ReadonlySet<string> | null {
  if (filter === undefined) return null;
  const { courses, conceptIds } = filter;
  if (courses === undefined && conceptIds === undefined) return null;

  const conceptAllowed = conceptIds === undefined ? null : new Set(conceptIds);
  const courseAllowed = courses === undefined ? null : new Set(courses);

  const passing = new Set<string>();
  for (const candidate of candidates) {
    if (
      conceptAllowed !== null &&
      !candidate.conceptIds.some((conceptId) => conceptAllowed.has(conceptId))
    ) {
      continue;
    }
    if (courseAllowed !== null && !candidate.courses.some((course) => courseAllowed.has(course))) {
      continue;
    }
    for (const conceptId of candidate.conceptIds) passing.add(conceptId);
  }
  return passing;
}

/**
 * F2.17's preference, applied only among the instruments of one concept.
 *
 * Returns the index into `formatPreference` of this instrument's type, or the
 * list's length for a type that is not mentioned — so "unmentioned" is a
 * single bucket after every mentioned type, rather than an error or a silent
 * exclusion. An empty or omitted preference list gives every candidate the
 * same rank, and the FSRS-earliest one wins by falling through to order.
 */
function preferenceRank(
  type: SchedulableInstrumentType,
  formatPreference: readonly SchedulableInstrumentType[],
): number {
  const index = formatPreference.indexOf(type);
  return index === -1 ? formatPreference.length : index;
}

/**
 * The earliest day any of `candidate`'s concepts' material arrived
 * (ARRIVE-1's `arrivalDays`, keyed by concept), which is the first day this
 * instrument could have been served at all — what
 * `recallOutranksFormatPreference`'s never-reviewed branch measures its wait
 * from. `null` when no map was supplied or none of its concepts is in it: no
 * signal, never day zero.
 *
 * Earliest rather than latest because an instrument evidencing several
 * concepts (`ol-t3sd`'s concept SET) has been available since the first of
 * them arrived — the same "in her order, decide over the set" reading the
 * dedupe pass itself takes.
 */
function earliestArrivalDayOf(
  candidate: QueueCandidate,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
): CalendarDay | null {
  if (arrivalDays === undefined) return null;
  let earliest: CalendarDay | null = null;
  for (const conceptId of candidate.conceptIds) {
    const day = arrivalDays.get(conceptId);
    if (day === undefined) continue;
    if (earliest === null || day < earliest) earliest = day;
  }
  return earliest;
}

/**
 * The rank a candidate competes with for its concept's dedupe slot — lower
 * wins. Ordinarily `preferenceRank`, exactly as F2.17 always defined it.
 *
 * `[D-240]` item 2's override is `recallOutranksFormatPreference`
 * (`../scheduler/serving.ts`) — **the one implementation of that rule, shared
 * with the study-session composer** (`ol-2zfj.71` [SESS-7]); see that
 * module's doc for the bound, the never-reviewed case and why it lives
 * neither here nor there. When it fires, the candidate outranks every
 * preference-matched type unconditionally, by returning a rank below every
 * value `preferenceRank` can produce (which is `>= 0`). Two such candidates
 * on the same concept — both recall-tier and both past the bound — fall back
 * to `order` (plain FSRS order) in the caller's sort, same as an ordinary
 * tie.
 *
 * `arrivalDay` is the concept-arrival day the shared rule's never-reviewed
 * branch measures from (ARRIVE-1); `undefined`/`null` there is a no-op, so a
 * caller supplying no `arrivalDays` map composes exactly as before.
 */
function dedupeRank(
  candidate: QueueCandidate,
  formatPreference: readonly SchedulableInstrumentType[],
  now: Date,
  servingPolicy: QueueServingPolicy,
  arrivalDay: CalendarDay | null,
): number {
  if (
    recallOutranksFormatPreference(
      {
        instrumentType: candidate.instrumentType,
        state: candidate.state,
        arrivalDay,
      },
      now,
      servingPolicy,
      formatPreference.length > 0,
    )
  ) {
    return -1;
  }
  return preferenceRank(candidate.instrumentType, formatPreference);
}

/**
 * D7.1's `instrumentTypesOffered` for one offered item: every type the queue
 * could have offered instead of it — that is, the types of every eligible
 * instrument sharing at least one concept with it, **in queue order**.
 *
 * Computed over the eligible set, so it includes the instruments dedupe is
 * about to defer: "what the queue could have chosen" is the question the field
 * exists to answer, and it is unanswerable after the choice is made.
 *
 * Walked in FSRS order rather than in her concept order, so "in queue order"
 * keeps meaning what it said before `ol-t3sd`. For an instrument naming one
 * concept the answer is identical to the per-concept list this replaced.
 */
function instrumentTypesOfferedFor(
  candidate: QueueCandidate,
  eligible: readonly { readonly candidate: QueueCandidate }[],
): SchedulableInstrumentType[] {
  const concepts = new Set(candidate.conceptIds);
  const types: SchedulableInstrumentType[] = [];
  for (const { candidate: other } of eligible) {
    if (!other.conceptIds.some((conceptId) => concepts.has(conceptId))) continue;
    if (!types.includes(other.instrumentType)) types.push(other.instrumentType);
  }
  return types.length > 0 ? types : [candidate.instrumentType];
}

/**
 * `[D-240]` item 5 (`ol-egov.130`), `ol-2zfj.67` [SESS-6]: why `winnerType`
 * won its concept's dedupe slot, derived from `beatenTypes` — every
 * instrument type that was actually deferred behind it — rather than by
 * re-running `dedupeRank`'s override logic a second time. Deriving it from
 * the outcome, not the rule, means a reason can never disagree with what the
 * composed queue actually did: under ordinary `preferenceRank` ordering a
 * non-preferred recall-tier type cannot outrank a preference-matched one
 * (see {@link dedupeRank}'s own doc), so `winnerType` beating a
 * preference-matched `beatenTypes` member is only possible when `dedupeRank`'s
 * `-1` override fired.
 *
 * `undefined` when no preference was in force at all, or when nothing that
 * lost a slot to this instrument was of the OTHER kind the two reasons care
 * about — the ordinary "plain FSRS order decided" case, same "state the
 * absence" discipline every other optional field on `QueueItem` follows.
 */
function dedupeReasonFor(
  winnerType: SchedulableInstrumentType,
  beatenTypes: ReadonlySet<SchedulableInstrumentType>,
  formatPreference: readonly SchedulableInstrumentType[],
): QueueItemReason | undefined {
  if (formatPreference.length === 0 || beatenTypes.size === 0) return undefined;
  if (
    isRecallTier(winnerType) &&
    [...beatenTypes].some((type) => preferenceRank(type, formatPreference) === 0)
  ) {
    return 'recall-overdue';
  }
  if (
    preferenceRank(winnerType, formatPreference) === 0 &&
    [...beatenTypes].some((type) => isRecallTier(type))
  ) {
    return 'format-match';
  }
  return undefined;
}

/**
 * Compose one review session.
 *
 * Pure: same inputs, same output, always. No clock (`now` is an argument), no
 * I/O, no mutation of anything the caller passed in.
 */
export function composeQueue(input: ComposeQueueInput): ComposedQueue {
  const {
    candidates,
    now,
    suspended,
    filter,
    formatPreference = [],
    dedupeByConcept = true,
    servingPolicy = 'interval-bound',
    relatedConceptKeys,
    prerequisiteConceptKeys,
    assessmentContext,
    arrivalDays,
    conceptSourcePaths,
  } = input;

  // `[D-240]` item 2, `'preference-off'` arm: ignore `formatPreference`
  // entirely, as if it were never supplied — see the module doc. Computed
  // once, up front, so every use below (the preference sort AND the
  // interval-bound override, which itself checks
  // `formatPreference.length > 0`) sees the same effective preference.
  const effectiveFormatPreference = servingPolicy === 'preference-off' ? [] : formatPreference;

  // 1–3. Filter (F2.5), drop suspended (F2.6), keep only what is due.
  const allowedConcepts = passingConceptIds(candidates, filter);
  const eligible: { candidate: QueueCandidate; dueState: OfferedDueState }[] = [];
  for (const candidate of candidates) {
    if (
      allowedConcepts !== null &&
      !candidate.conceptIds.some((conceptId) => allowedConcepts.has(conceptId))
    ) {
      continue;
    }
    if (suspended !== undefined && isInstrumentSuspended(suspended, candidate.instrumentId)) {
      continue;
    }
    const dueState = dueStateOf(candidate, now);
    if (dueState === null) continue;
    eligible.push({ candidate, dueState });
  }

  // 4. Plain FSRS order. `sort` is stable, so instruments due at the same
  //    instant keep the caller's order rather than acquiring a tiebreaker this
  //    module invented.
  eligible.sort((a, b) => dueInstant(a.candidate) - dueInstant(b.candidate));

  // 5. F2.17, over the concept **set**. A candidate wins only if none of its
  //    concepts is already claimed, and winning claims all of them.
  //
  //    Deciding it in one greedy pass over (preference rank, FSRS order) —
  //    rather than per concept independently, as it was when the key was a
  //    single id — is forced by the set: choosing an instrument for concept A
  //    also spends concept B, so the concepts cannot be resolved in isolation.
  //    For a candidate naming exactly one concept the two formulations agree
  //    candidate for candidate: the first one this pass reaches for a concept
  //    is precisely the strictly-best-ranked one, ties going to the instrument
  //    plain FSRS order reached first, which is the rule the per-concept
  //    version stated. `compose.spec.ts` is unedited and is the evidence.
  const winnerByConcept = new Map<string, string>();
  if (dedupeByConcept) {
    const byPreference = eligible
      .map((entry, order) => ({
        entry,
        order,
        rank: dedupeRank(
          entry.candidate,
          effectiveFormatPreference,
          now,
          servingPolicy,
          earliestArrivalDayOf(entry.candidate, arrivalDays),
        ),
      }))
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.order - b.order));

    for (const { entry } of byPreference) {
      const { candidate } = entry;
      if (candidate.conceptIds.some((conceptId) => winnerByConcept.has(conceptId))) continue;
      for (const conceptId of candidate.conceptIds) {
        winnerByConcept.set(conceptId, candidate.instrumentId);
      }
    }
  }

  const items: QueueItem[] = [];
  const deferred: DeferredInstrument[] = [];
  for (const { candidate, dueState } of eligible) {
    // The first of *her* listed concepts whose slot went to someone else. One
    // name, in her order, rather than an arbitrary pick — see
    // `DeferredInstrument.deferredBehind`.
    const blockedBy = candidate.conceptIds
      .map((conceptId) => winnerByConcept.get(conceptId))
      .find((winner) => winner !== undefined && winner !== candidate.instrumentId);
    if (blockedBy !== undefined) {
      deferred.push({
        instrumentId: candidate.instrumentId,
        conceptIds: candidate.conceptIds,
        deferredBehind: blockedBy,
      });
      continue;
    }
    items.push({
      instrumentId: candidate.instrumentId,
      instrumentType: candidate.instrumentType,
      conceptIds: candidate.conceptIds,
      priorState: candidate.state,
      selectionContext: {
        dueState,
        // Both null in Phase A, and stated rather than omitted: D7.1's shape
        // must be identical across the A→B boundary or the checkpoint compares
        // two different records.
        examProximity: null,
        yieldRank: null,
        // D7.1: every type the queue could have offered instead of this one,
        // across every concept it is evidence for — see the helper.
        instrumentTypesOffered: instrumentTypesOfferedFor(candidate, eligible),
      },
    });
  }

  // `[D-240]` item 5: attach `dedupeReason` to every item something was
  // actually deferred behind, from the finished `deferred` list — a second
  // pass over data the loop above already produced, never a re-derivation of
  // `winnerByConcept`/`dedupeRank`. `eligibleTypeById` looks up a deferred
  // instrument's own type, which `DeferredInstrument` itself does not carry.
  const eligibleTypeById = new Map(
    eligible.map((e) => [e.candidate.instrumentId, e.candidate.instrumentType]),
  );
  const beatenTypesByWinner = new Map<string, Set<SchedulableInstrumentType>>();
  for (const entry of deferred) {
    const beatenType = eligibleTypeById.get(entry.instrumentId);
    if (beatenType === undefined) continue; // unreachable: every deferred id came from `eligible`
    const set = beatenTypesByWinner.get(entry.deferredBehind);
    if (set === undefined) beatenTypesByWinner.set(entry.deferredBehind, new Set([beatenType]));
    else set.add(beatenType);
  }
  const itemsWithReason: QueueItem[] = items.map((item) => {
    const beatenTypes = beatenTypesByWinner.get(item.instrumentId);
    if (beatenTypes === undefined) return item;
    const dedupeReason = dedupeReasonFor(
      item.instrumentType,
      beatenTypes,
      effectiveFormatPreference,
    );
    return dedupeReason === undefined ? item : { ...item, dedupeReason };
  });

  // 6. F2.18/F2.19 (`ol-ua0i`): reorder the already-decided offer list into
  //    course blocks, refined by within-block grouping. Cannot add, drop or
  //    re-dedupe anything — see `block-order.ts` and this file's module doc.
  const candidatesById = new Map(candidates.map((c) => [c.instrumentId, c]));
  const blocked = applyCourseBlocking({
    items: itemsWithReason,
    candidatesById,
    now,
    ...(relatedConceptKeys !== undefined ? { relatedConceptKeys } : {}),
    ...(prerequisiteConceptKeys !== undefined ? { prerequisiteConceptKeys } : {}),
    ...(assessmentContext !== undefined ? { assessmentContext } : {}),
    ...(arrivalDays !== undefined ? { arrivalDays } : {}),
    ...(conceptSourcePaths !== undefined ? { conceptSourcePaths } : {}),
  });

  return { items: blocked, deferred };
}
