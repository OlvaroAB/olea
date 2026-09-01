/**
 * Queue composition v1 (F2.5, F2.14, F2.17, C5.5, P2-T07).
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
 */

import { daysBetween } from '../dates.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import { isInstrumentSuspended } from '../review-log/suspension.js';
import { applyCourseBlocking } from './block-order.js';
import type {
  ComposedQueue,
  ComposeQueueInput,
  DeferredInstrument,
  QueueCandidate,
  QueueFilter,
  QueueItem,
  QueueSelectionContext,
} from './types.js';

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
    relatedConceptKeys,
    assessmentContext,
    arrivalDays,
    conceptSourcePaths,
  } = input;

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
        rank: preferenceRank(entry.candidate.instrumentType, formatPreference),
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

  // 6. F2.18/F2.19 (`ol-ua0i`): reorder the already-decided offer list into
  //    course blocks, refined by within-block grouping. Cannot add, drop or
  //    re-dedupe anything — see `block-order.ts` and this file's module doc.
  const candidatesById = new Map(candidates.map((c) => [c.instrumentId, c]));
  const blocked = applyCourseBlocking({
    items,
    candidatesById,
    now,
    ...(relatedConceptKeys !== undefined ? { relatedConceptKeys } : {}),
    ...(assessmentContext !== undefined ? { assessmentContext } : {}),
    ...(arrivalDays !== undefined ? { arrivalDays } : {}),
    ...(conceptSourcePaths !== undefined ? { conceptSourcePaths } : {}),
  });

  return { items: blocked, deferred };
}
