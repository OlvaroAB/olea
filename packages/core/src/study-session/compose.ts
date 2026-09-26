/**
 * Session composition (SESS-1/`ol-xd1v`, SESS-2/`ol-4a78`; F2.18, F2.22, F4.6,
 * F6.6, C5.6, C5.9). Ratified baseline: `[D-113]` (`ol-egov.31`), canonical
 * text `findings/SESS-1-session-composition-model.md` §7 (olea-service).
 *
 * `./build.ts` already turns an ORDERED list of gap rows into a time-bounded
 * list of instruments — it decides nothing about which concepts deserve a
 * slot or in what proportion. This module is the layer SESS-1 designed above
 * it: it decides **which concepts are eligible and in what order**, and hands
 * the result to `buildStudySession` (with `order: 'given'`) to fill.
 *
 * ## The central move: two obligations, not one queue
 *
 * Every concept lands in exactly one **obligation class** each day —
 * `'unmet'`, `'recall-due'`, `'baseline-due'`, `'elective'` — where the class
 * decides which clock is being read and "how overdue" deliberately means a
 * different thing in each ({@link classifyObligation}). The recall obligation
 * (FSRS due) and the reading obligation (the retrieval baseline, C5.9) are
 * near-complements: FSRS intervals grow without bound as an item is held, so
 * recall abandons exactly the mature tail the baseline exists to keep
 * visible.
 *
 * **Baseline obligation is a SET, not a queue** (`[D-113]` item 4): an
 * unserved obligation is still exactly one obligation today, computed fresh
 * from `lastRetrievalDay` — nothing here accrues a debt of retrievals.
 *
 * **The ordering rule is `overdue-first`** (`[D-113]` item 3): one key —
 * days waiting, whatever the reason — defined for every obligation class,
 * zero free parameters. SESS-1 measured it beating a reserved-slice
 * allocator (three free parameters) at every tested operating point; the
 * reserved slice is not implemented here because it was not adopted.
 *
 * ## The retrieval baseline is keyed on mastery STAGE, never the interval
 *
 * `[D-113]` items 1 and 2: keying the widening gap on the mastery stage
 * (rather than the scheduler's own interval) makes the obligation bounded by
 * construction — three rungs, ceiling is the top rung — and makes the bound
 * behavioural, so a self-rating cannot push it out. See
 * {@link RETRIEVAL_BASELINE_STAGE_LADDER_DAYS}.
 *
 * ## Re-entry needs no special case (`[D-113]` item 5)
 *
 * F6.6 rules a re-entry session is the ordinary rule at fewer slots, never a
 * second selection mechanism. A single total order has no per-class share
 * for a second policy to act on, so under `overdue-first` a smaller budget
 * *is* the whole re-entry rule — there is no absence-detection branch in this
 * module to diverge from it. `compose.spec.ts`'s equality-of-rule test
 * asserts this holds by construction, per the component register's health
 * check (3.8).
 *
 * ## Two-level allocation, and what stood in for the missing first level
 *
 * Allocation is strictly two-level because `XCRS-1` (`ol-dq1c`, open) says
 * the pre-existing builder compared `gapScore` across courses, which the
 * contract forbids. Across courses, by **attention share**. Within a course,
 * by `overdue-first`, over that course's own concepts only — no `gapScore`
 * or `overdueDays` is ever compared across a course boundary.
 *
 * **`ol-v7r5.17` [ALLOC-2] wires the real share in**, via
 * {@link ComposeSessionRowsInput.allocation} and this module's own
 * `./allocation-seconds.js` (A2.5's contracted share-to-seconds conversion).
 * When it is supplied, it REPLACES both {@link proportionalCourseShares}'s
 * interim policy AND this module's local C5.6 floor-forcing
 * ({@link forcedCoursesFor}) wholesale, in one seam
 * ({@link composeSessionRows}'s own `allocation`-branch) — the two floor
 * mechanisms must never compound, because `computeAttentionShares`
 * (`olea-service`'s component 3.5) already resolves C5.6's windowed floor at
 * the point the share was computed, using her real sitting history rather
 * than this module's days-since-last-seen proxy.
 *
 * **Until a caller has a real allocation to pass, each course's share stays
 * proportional to how much of her ranked material lives in that course**
 * ({@link proportionalCourseShares}) — SESS-1's own headline configuration
 * (equal shares over the vault's uneven course sizes was measured to starve
 * the larger course; proportional avoids that confound), with this module's
 * own local floor-forcing still applying on that path exactly as before.
 * `allocation` is optional and an empty array reads the same as omitted —
 * both fall back to the interim path, so a caller with a stale or absent
 * plan degrades to today's behaviour rather than starving every course.
 *
 * **This interim path IS the composer's plan-less degraded mode**
 * (`docs/dev/one-assembly-path.md` §6 row 1, olea-service; `[SESS-11]`,
 * `ol-egov.132.12`) — a first-run student with no cached study plan at all
 * still gets a composed session, on these interim shares, exactly as she
 * always has. `[SESS-11]` considered and rejected building a SECOND
 * plan-less path here: this module has never required `allocation` to
 * produce a session, so there is nothing new to add. What that bead names
 * instead is a real but separate dependency, upstream of this module —
 * `rows` (`GapRow[]`) comes from the oracle chain (`gap/build.ts`'s
 * `buildGapView`), which needs an assignments base path to rank anything at
 * all, the same `isStudyPlanConfigured` gate Home and the session builder
 * already apply. A vault with no plan configured cannot produce `rows` in
 * the first place, regardless of `allocation` — no change this module could
 * make closes that gap, because it is a fact about what feeds this
 * function, not about what this function does with `allocation` once fed.
 *

 * C5.6's rolling floor is enforced ({@link forcedCourseFloorDays}): a course
 * that has gone at least `runningCourses + slack` days without a concept from
 * it being retrieved is forced a guaranteed slice, where `slack` is C5.6's own
 * declared constant ("running courses + slack, slack initially 2" —
 * `docs/Olea_alpha_functional_scope.md`), reused directly rather than
 * `builder.mjs`'s own unfitted sweep default. **Days, not sessions** — C5.6's
 * window is denominated in her sessions and this substitutes days, the
 * available, honest proxy (the product assumes a daily cadence elsewhere,
 * `fsrs-scheduler.ts`'s module doc); nothing here claims to count sessions.
 *
 * ## F2.18 — course blocks, applied after selection
 *
 * Selection above is course-partitioned by budget; block coherence
 * ({@link blockByCoursePresentation}) is applied *afterwards*, so it
 * constrains what she meets in what order and never what gets chosen, and
 * therefore cannot starve anything. Blocks are ordered by the most urgent
 * obligation class present. Interleaving concepts *within* a block needs no
 * code here: `buildStudySession`'s own breadth-first fill already visits
 * rows in the order it is handed, once per pass, so a course-blocked row
 * order interleaves concepts within the block for free.
 *
 * ## F2.19 — within-block grouping, layered strictly inside a tie
 *
 * F2.19 asks for a *further* grouping inside one course's block: absent a
 * near assessment, adjacent placement favours concept relatedness (C7.10);
 * as a dated assessment approaches, placement shifts toward that
 * assessment's own scope (F1.7); both continuous, never a stored phase.
 * `[D-113]` item 3's `overdue-first` rule stays the block's PRIMARY order —
 * F2.19 is a refinement among concepts already **exactly tied on
 * `overdueDays`** ("comparably due", with no invented fuzziness-window: two
 * concepts either share the same days-waiting number or they don't), never
 * a second axis competing with urgency. See {@link withinBlockOrder}.
 *
 * **The data path, and where it stops.** Both signals are caller-resolved,
 * matching the `arrivalDays` pattern above exactly, because this module
 * stays pure (INV-1) and neither signal lives in a `GapRow`:
 *
 * - **Relatedness** ({@link ComposeSessionRowsInput.relatedConceptKeys}) —
 *   `concept/relation.ts`'s `ConceptRelation.from`/`.to` are concept
 *   **names**; this module partitions and joins on `conceptKey`
 *   (`ol-63e1`), so a caller resolving names to keys is required either way,
 *   the same resolution `retrospective/build.ts`'s `conceptCourses` already
 *   performs for a different join. **Corrected — a production caller now
 *   resolves this**: `session-builder/provider.ts`'s `resolveRelatedConceptKeys`
 *   does the name-to-key join, fed by `main.ts`'s `servedRelationEdges()`
 *   (the same live, served `part-of`/relation edge fold), and passes the
 *   result in as `relatedConceptKeys`. Still degrades identically (see
 *   below) whenever that caller has nothing served yet.
 *   Deliberately type-agnostic over C7.10's six relation types — the clause
 *   says "concepts that connect to each other", not one type, so which
 *   edges count as "connected" is the caller's call.
 * - **Assessment scope** ({@link ComposeSessionRowsInput.assessmentContext})
 *   — keyed by the exact `VaultPath` a row's own {@link GapRow.targetAssessmentPath}
 *   already names (the oracle's own strongest-contributing assessment for
 *   that concept, F4.2/F4.7 weight-and-yield already blended into which
 *   assessment that is — this module does not re-derive assessment
 *   `weight`, only reads that assessment's `dueDay` and F1.7's resolved
 *   `scopeConceptKeys`). Building this map means resolving `AssessmentScope.text`
 *   (`assessment/scope.ts`) to concept keys — free text, no code path exists
 *   for that resolution yet — so this is a second, separate reachability
 *   gap from relatedness's, left to the production caller for the same
 *   reason.
 *
 * **Both maps are optional, and their absence is a no-op, provably.** With
 * either or both omitted, {@link withinBlockGroupingScore} reads 0 for
 * every row (no relation entry, no assessment context), so every row in a
 * tie band scores equal and the stable sort falls through to
 * {@link overdueFirst}'s own `gapScore`/`conceptName`/`conceptKey` tiebreak — byte-for-byte
 * today's behaviour. `compose.spec.ts` pins this equivalence explicitly.
 *
 * **The proximity weight is continuous, never a "near" threshold.** A
 * concept's own target assessment contributes a weight that decays smoothly
 * with `daysUntilDue` (half-life {@link WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS}),
 * the same declared-fallback shape `../oracle/rank.ts`'s
 * `DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS` already uses for the same
 * F4.7 arithmetic (`[D-110]`) — reused here, not re-derived, because it is
 * the same "how fast does an approaching date start to matter" judgement
 * applied to a second consumer. **F4.7's stop-at-the-assessment rule is
 * enforced by construction**: a `dueDay` that has passed (or is unknown)
 * reads as weight 0, which hands the row's placement entirely to
 * relatedness — never a negative or inverted push from a sat exam.
 *
 * ## F2.19 — the material-arrival cohort (`[D-149]`, `ol-v7r5.12`)
 *
 * A third signal, ruled onto this same blend rather than beside it as a
 * fourth grouping key. **Grain**: exact {@link GapRow.notePaths} overlap —
 * that field already *is* `ConceptRecord.sourcePaths` verbatim
 * (`../gap/build.ts`'s own doc), so "one cohort per source note" costs no
 * new extraction and no caller-resolved map, unlike relatedness/assessment
 * scope above ({@link withinBlockCohortAffinity}: the fraction of a tie
 * band's peers sharing at least one of a concept's own source notes — the
 * identical adjacency-fraction shape {@link withinBlockRelatedness} already
 * uses, over a different edge). **Precedence and decay**: the cohort BLENDS
 * INTO relatedness, continuously, keyed on how long ago the concept's
 * material arrived ({@link ComposeSessionRowsInput.arrivalDays}, `ARRIVE-1`)
 * — {@link withinBlockCohortDecayWeight} reads `1` the day it arrives and
 * decays smoothly toward `0` as `asOf` recedes from it (half-life
 * {@link MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS}), so material read as
 * "just arrived" leans placement toward the concepts it shares a source note
 * with, and that lean fades back to plain C7.10 relatedness as the material
 * ages — never a threshold, never a stored flag, never a phase. This is
 * `[D-149]`'s ruling verbatim: input (days since arrival) and output (a
 * blend weight) are shapes F2.19 already uses, so the continuous-never-a-
 * phase guarantee holds by construction rather than by a new check. The
 * proximity term above still has final say: an approaching assessment
 * overrides the whole relatedness-plus-cohort blend exactly as it did before
 * this bead, because the cohort is folded into what proximity blends
 * *against*, never around it.
 *
 * **No-op, provably, absent `arrivalDays`** — the same posture `arrivalDays`
 * already has for `ObligationSignals.arrivalDay` above: an omitted map, or a
 * concept missing from it, reads `arrivalDay: null`,
 * {@link withinBlockCohortDecayWeight} returns `0`, and the blend collapses
 * to relatedness alone — byte-for-byte what this module computed before this
 * bead. `compose.spec.ts` pins this equivalence explicitly, matching the
 * relatedness/assessment-context no-op proof already established above.
 *
 * **The review-queue path** (`../queue/block-order.ts`, `ol-ua0i`) reuses
 * {@link withinBlockRelatedness}/{@link withinBlockAssessmentProximity}
 * rather than duplicating them; {@link withinBlockCohortAffinity} and
 * {@link withinBlockCohortDecayWeight} are exported here for that same reuse
 * once that path threads `arrivalDays` and per-item source notes through —
 * `[D-149]` rules the cohort onto BOTH surfaces, the same reason F2.18/F2.19
 * name both. Wiring the queue side needs two shapes that path does not carry
 * today (`QueueCandidate` has no source-note field by design — see that
 * type's own "note the absences" doc — and `ComposeQueueInput` has no
 * `arrivalDays`), which is outside this module's boundary; filed as a
 * follow-up rather than guessed at here (see the bead for its id).
 *
 * ## F2.19 — a fifth, restored signal: direct prerequisite, strictly inside the tie band
 * (`[ILB-PLN-B1]`, `ol-egov.141.89.10.6`, `[D-296]`)
 *
 * `[SESS-8.6]` retired `composeQueue` and, with it, the only production read of a `prerequisite`
 * edge for queue ordering; this composer never read one. `[D-296]` — ruled 2026-09-23, once the
 * relations chain's targets were fixed — restores it here, option (b): "a tie-break in the live
 * composer's ordering," never a gate. It runs LAST, after the relatedness/cohort/assessment-scope
 * blend above has already ordered the band ({@link withinBlockOrder}'s `orderByPrerequisite` pass):
 * a row with a direct prerequisite also present in the SAME exact-`overdueDays` band sorts after
 * it, stably, so a row the blend above already placed keeps its place unless a prerequisite edge
 * says otherwise. **Direct edges only** ({@link prerequisiteConceptKeysFromEdges} does no
 * transitive closure), **never a gate** (nothing is dropped; an item with no confirmed prerequisite
 * or an unresolved one stays exactly as eligible as before), **never crosses a band**
 * (urgency, `overdue-first`, stays unoverridable), and **a cycle inside one band keeps that band's
 * ordinary order** (`orderByPrerequisite`'s documented cycle fallback). Reads through the SAME
 * `relations` field {@link applyContainmentCoPresence} already reads for `part-of` — see that
 * field's doc and {@link prerequisiteConceptKeysFromEdges}'s for why this is also where
 * `docs/dev/intelligence-build/rel.md` §3 Default 4's per-endpoint freshness gate is honoured: this
 * module never reads a second, ungated relations source for `prerequisite`. No-op, provably,
 * whenever `relations` carries no `prerequisite` edge — the same no-op guarantee this section's
 * other three signals already have.
 *
 * ## Overflow is not a student-visible surface (C5.9, F6.7)
 *
 * {@link ComposeSessionRowsResult.overflow} is a count per obligation class
 * plus the worst case in each — surfaced on the result for inspection and
 * telemetry, never threaded into `StudySessionModel` or rendered by
 * `session-builder/copy.ts`. F6.7 forbids a standing counter of unmet
 * material; whether any of this ever reaches a screen is a contract question
 * this module does not answer.
 *
 * ## Per-item obligation class IS meant to reach a screen (F6.7, `ol-y237`)
 *
 * {@link ComposeSessionRowsResult.obligationClasses} is the opposite shape
 * from `overflow` on purpose. F6.7 asks the suggested session to name new
 * (unmet) material **by its source** ("includes new material from Tuesday's
 * lecture"), never by a count — and this module already computes exactly the
 * classification a caller needs to write that sentence, then used to discard
 * it the instant `orderedRows` dropped down to `GapRow[]`. The map is keyed
 * by `conceptKey`, over exactly the rows `orderedRows` names (the chosen set,
 * never the classified-but-not-chosen remainder `overflow` counts), and its
 * value is one `ObligationClass` — nothing shaped like a total, a
 * per-class count, or a list of names. A caller pairs
 * `obligationClasses.get(row.conceptKey) === 'unmet'` with that SAME
 * concept's own instrument `notePath`/`noteTitle` (already on
 * `StudySessionItem`, carried through unrelated to this map) to name the
 * source — the class plus the existing source field is everything F6.7's
 * sentence needs, and there is no field here a renderer could sum to recover
 * the count the contract forbids. `buildComposedStudySession` folds the same
 * map onto {@link StudySessionModel.items} as each item's own
 * `obligationClass` so a caller working at the instrument level never has to
 * rejoin by `conceptKey` itself.
 *
 * ## The arrival-day signal (`ARRIVE-1`, `ol-4pue`) and its own honest gap
 *
 * The model's `classify()` computes an `unmet` concept's `overdueDays` from
 * `day - concept.arrivalDay`. `ObligationSignals.arrivalDay` is that signal
 * in production types: the caller resolves it (typically via
 * `VaultSource.firstSeen` over a concept's `notePaths` — a vault-host
 * file-creation/first-seen accessor, non-persisted and reversible, Class B)
 * and passes it in, either per call via {@link classifyObligation} or as a
 * `ComposeSessionRowsInput.arrivalDays` map keyed by `conceptKey`. When
 * present, `unmet` widens on real days-since-arrival exactly like every other
 * class — the SESS-1 §1.1 fix this bead exists for. `ConceptRecord` still
 * carries no date field and review-log entries still only exist for concepts
 * that HAVE been retrieved (excluding `unmet` by definition), so
 * `VaultSource.firstSeen` is the only production-shaped source; see that
 * interface's doc.
 *
 * **The gap this module cannot close alone:** `arrivalDay` is `null`
 * whenever the caller has none to offer — no map entry, no `firstSeen`
 * implementation on the host, or a file whose creation time the host itself
 * cannot report (`FolderSource`'s doc has a concrete example: checked-out git
 * files on this project's own dev platform). `overdueDays: 0` remains the
 * fallback for exactly that case: it defers to `gapScore`, i.e. today's
 * pre-`ARRIVE-1` production behaviour, rather than to `Number.POSITIVE_INFINITY`,
 * which would make `unmet` dominate every other class whenever any unmet
 * concept exists — the *opposite* starvation the design fought, where
 * recall-due and baseline-due material would never win against a standing
 * pool of new material. This module stays pure (see "INV-1 / §7.1" below), so
 * it cannot call `VaultSource` itself to close its own gap — resolving
 * `firstSeen` into a real `arrivalDays` map for the production caller
 * (`session-builder/provider.ts`) is deliberately left to a follow-up
 * (`ol-4pue`'s notes name it), not guessed at here.
 *
 * ## Citation validity (`[D-292]`, `[D-351]`, `[D-330]`; `ol-2zfj.154`, `ol-2zfj.147`,
 * `ol-egov.141.89.5.13`) — read here, and now ACTIONED
 *
 * `../instrument/citation-validity.js`'s `citationValidityStatus` is the ruled four-state
 * classification a caller can compute per instrument — `'current'`, `'superseded'`, `'pending'`
 * or `'unknown'` (`CitationValidityStatus`) — folding `[D-292]`'s digest comparison and
 * `[D-351]`'s pending-revalidation fact into one status, with `'pending'` taking precedence over a
 * digest comparison whenever both are available (that function's own doc). This module stays
 * pure (see "INV-1 / §7.1" below) and never reads an `InstrumentCitation` record, a digest or
 * `citationValidityStatus` itself — it takes the SAME two pieces of evidence that function does,
 * as two independently-optional, already-resolved, caller-supplied signals, and applies the
 * identical precedence rule in its own terms, so a production caller already wired to the older
 * three-state shape (`ol-egov.141.89.10.33`'s `resolveCitationFreshness`, which this bead's own
 * evidence confirms is already live) keeps working unmodified:
 *
 * - {@link ComposeSessionRowsInput.citationFreshness} — `[D-292]`'s digest comparison, keyed by
 *   `instrumentId`, `'fresh'`/`'stale'`/`'unknown'` ({@link CitationFreshnessState}). Unchanged in
 *   name, type and "optional, safe to omit, absence reads unknown" shape from before this bead —
 *   only what `'stale'` now DOES has changed (see below).
 * - {@link ComposeSessionRowsInput.citationPendingRevalidation} — `[D-351]`'s pending-revalidation
 *   fact, a set of instrument ids whose citation currently has a revalidation outstanding FOR THE
 *   EXACT SOURCE REVISION being checked. This module has no `InstrumentCitation` to check that
 *   revision against itself (see above), so an id belongs in this set only once the caller has
 *   already applied `citationValidityStatus`'s own scoping rule (its doc's "`[D-351]`'s scoping
 *   rule" section) — the same "arrives here already resolved" posture every other caller-resolved
 *   signal on this input takes. `[D-351]`'s stored field this evidence would normally come from is
 *   not built yet (`ol-egov.141.89.5.4`, open); omitted (as every production caller does today)
 *   this reads as "nothing pending," never as a reason to withhold anything on its own.
 *
 * **`'unknown'` is read AND actioned, alone**: an unknown-freshness instrument with no pending
 * evidence is still composed (never withheld — nothing here has grounds to treat "no observation
 * yet" as "broken"), and its id is surfaced on {@link ComposeSessionRowsResult.citationRecheckQueued}
 * — `ol-2zfj.154`'s own "serve with a re-check queued."
 *
 * **`'stale'` (a confirmed digest disagreement) and pending (`[D-351]`'s revalidation in flight)
 * are both now WITHHELD** — `[D-330]` (David, 2026-09-25, amending C5.8) generalises `[D-343]`'s
 * specific ruling into one removal rule for every cause an instrument can no longer be shown as
 * composed (suspended, withdrawn, its note gone, or its cited passage marked changed and pending
 * revalidation): the instrument drops from today's list, nothing takes its place, the remaining
 * order is kept, and nothing is recorded against her — David's own clarification names this
 * explicitly for "pending revalidation after a known cited-passage change, including within an
 * already-open session." Both causes are already-ruled and already reachable today: `'stale'`
 * needs only `[D-292]`'s digest fields (already landed, and already wired through
 * `resolveCitationFreshness` above — this bead's change alone flips that existing signal from
 * reported to withheld, with no other file's edit required), and `citationPendingRevalidation`
 * is ready for the day `[D-351]`'s store lands and a caller resolves it, exactly the "ready for
 * the signal the day a caller supplies it" posture {@link relatedConceptKeys} states elsewhere on
 * this input. Both ids are surfaced on {@link ComposeSessionRowsResult.citationRevalidationPending}
 * — read AND actioned, unlike `'unknown'` above: {@link buildComposedStudySession} filters exactly
 * this set out of the instrument index it hands `buildStudySession`'s fill (`./build.js`, not this
 * module's own file, so the filtering happens on this module's side of that boundary — see
 * {@link withholdInstruments}), and {@link extendComposedStudySession} applies the identical filter
 * to an already-open session's own previously-served items, never only to what a widened
 * recomposition would add (`[D-330]`'s "including within an already-open session"). Concept
 * SELECTION above (which rows make `orderedRows`) is untouched: a concept with one withheld
 * instrument among several is still selected and still served by whichever of its instruments
 * remain eligible; a concept whose every instrument is withheld is selected exactly as before
 * (this module has no per-instrument view at selection time) but the fill then finds nothing to
 * serve for it — "nothing takes its place," never a replacement row.
 *
 * ## `[D-331]` — the composition's own account (`ol-egov.141.89.10.65`)
 *
 * `[D-331]` (ruled 2026-09-25) preserves what a composition selected, what it set aside and why.
 * This module computes three facts for that and keeps them on the result, beside the order they
 * explain, without changing the order: `./composition-record.ts` freezes them into the durable
 * record, and nothing here writes anything.
 *
 * - **`groupingSignal`** ({@link dominantGroupingSignal}): which of F2.19's three blended signals
 *   decided the order inside the presented tie bands, as one discrete value (`./types.ts`'s
 *   `GroupingSignal`). {@link withinBlockGroupingScore} still computes the one score the sort
 *   reads, untouched; the attribution re-reads the same three terms separately after the order
 *   is fixed, so no floating-point rewrite of the score can reach the sort.
 * - **`setAside`**: what the composition weighed and did not serve, each with why, by id, at the
 *   grain the composer decided at (a course, a concept, an instrument; see `./types.ts`).
 *
 * The concept key each served instrument was composed under is no longer a fact this module
 * recovers from the outside: `./build.ts`'s fill now stamps it directly onto
 * `StudySessionItem.conceptKey` at the one place that ever chose it (`ol-egov.141.89.10.4`), so
 * `./composition-record.ts`'s `chosenItems` reads `item.conceptKey` off `model.items` itself —
 * `null` only when the item itself carries none (a hand-built fixture predating the field, or a
 * future caller with no resolvable key). There is no separate `itemConceptKeys` map to keep true
 * alongside the items it describes.
 *
 * {@link extendComposedStudySessionWithAccount} carries the same account through an outrun
 * extension; {@link extendComposedStudySession} is now that function's item list, byte-identical
 * to what it returned before.
 *
 * ## INV-1 / §7.1
 *
 * Pure. No `obsidian`, no vault I/O, no clock (`asOf` is an argument),
 * nothing stored. `Scheduler` implementations are pure functions of their
 * input (`scheduler/types.ts`), so `ReplayResult` — itself a pure fold over
 * entries the caller already read — is the only "history" this module needs.
 */

import type { StudyPlanAllocationEntry } from 'olea-contracts';
import { orderByPrerequisite } from '../concept/prerequisite-order.js';
import type { ConceptRelation } from '../concept/relation.js';
import { daysBetween } from '../dates.js';
import type { GapRow } from '../gap/build.js';
import type { CitationFreshnessState } from '../instrument/citation-store.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { SchedulerState } from '../scheduler/types.js';
import { containerConceptKeysToDrop } from '../session/containment.js';
import type { ReplayResult } from '../session/replay.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import {
  type CalendarDay,
  calendarDayOfTimestamp,
  isCalendarDay,
  shiftCalendarDay,
} from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';
import { allocationSharesToSeconds } from './allocation-seconds.js';
import {
  type BuildStudySessionInput,
  buildStudySession,
  CONCEPT_SIZE_SECONDS_MULTIPLIER,
  type StudySessionItem,
  type StudySessionModel,
} from './build.js';
import type { DurationModel } from './duration.js';
import type { ConceptInstrumentIndex } from './instrument-index.js';
import type {
  CompositionSetAside,
  GroupingSignal,
  SetAsideConcept,
  SetAsideCourse,
  SetAsideInstrument,
} from './types.js';
import type { WindowDeficitEntry } from './window.js';

const SECONDS_PER_MINUTE = 60;

/** Which obligation put a concept in front of her today. Exactly one per concept. See the module doc. */
export type ObligationClass = 'unmet' | 'recall-due' | 'baseline-due' | 'elective';

/** Presentation precedence — lower sorts first. `[D-113]`'s ordering rule uses `overdueDays`, not this; this is only for {@link blockByCoursePresentation}'s "most urgent class present" tiebreak. */
const CLASS_PRECEDENCE: Readonly<Record<ObligationClass, number>> = Object.freeze({
  unmet: 0,
  'recall-due': 1,
  'baseline-due': 2,
  elective: 3,
});

/**
 * The widening ladder, keyed on mastery stage (`[D-113]` items 1/2; findings
 * §7, plateau measured over rungs 10–25 days, 21 chosen as the largest value
 * with margin on both sides).
 *
 * `seed` has no rung: a concept with no scored evidence has never been
 * retrieved, so it is `'unmet'`, and the baseline has nothing to be relative
 * to. `'unknown'` (`OracleMasteryState`'s extra value — no mastery join at
 * all) is treated the same way, for the same reason.
 *
 * *Revisit when* real review-log history exists to check the rungs against
 * how they felt to her — see `[D-113]`'s revisit condition.
 */
export const RETRIEVAL_BASELINE_STAGE_LADDER_DAYS: Readonly<
  Record<'sprout' | 'sapling' | 'tree', number>
> = Object.freeze({
  sprout: 5,
  sapling: 12,
  tree: 21,
});

/**
 * C5.6's own declared constant: "Width: running courses + slack, slack
 * initially 2" (`docs/Olea_alpha_functional_scope.md`) — not `builder.mjs`'s
 * `courseFloorWindowSessions` default of 6, which was an unfitted sweep
 * parameter for the simulation rather than the ratified contract number.
 * This module reuses C5.6's own slack directly, in days rather than sessions
 * — see the module doc's note on that substitution.
 */
const COURSE_FLOOR_WINDOW_SLACK = 2;

function baselineGapDaysFor(masteryState: OracleMasteryState): number | null {
  if (masteryState === 'sprout' || masteryState === 'sapling' || masteryState === 'tree') {
    return RETRIEVAL_BASELINE_STAGE_LADDER_DAYS[masteryState];
  }
  return null;
}

function daysBetweenCalendarDays(from: CalendarDay, to: CalendarDay): number {
  return daysBetween(new Date(`${from}T00:00:00.000Z`), new Date(`${to}T00:00:00.000Z`));
}

/** One concept's obligation today, and how overdue it is *within that class* — a different clock per class, by design. See the module doc. */
export interface ObligationClassification {
  readonly klass: ObligationClass;
  readonly overdueDays: number;
}

/** {@link classifyObligation}'s input — one concept's obligation-relevant facts, already resolved to calendar days. */
export interface ObligationSignals {
  readonly masteryState: OracleMasteryState;
  /** The latest calendar day any of this concept's instruments were reviewed, or `null` if none ever were (→ `'unmet'`). */
  readonly lastRetrievalDay: CalendarDay | null;
  /** The soonest FSRS due day among this concept's reviewed instruments, or `null` if none has scheduling state. */
  readonly recallDueDay: CalendarDay | null;
  /**
   * ARRIVE-1 (`ol-4pue`): the day this concept first became reachable to
   * her, or `null` when the caller has no signal for it (see the module
   * doc's "arrival-day signal" section). Only read when `lastRetrievalDay`
   * is `null` — an already-retrieved concept never needs it, since it is not
   * in the `unmet` class this exists to widen.
   */
  readonly arrivalDay: CalendarDay | null;
  readonly asOf: CalendarDay;
}

/**
 * Sort one concept into exactly one obligation class, and say how overdue it
 * is within that class. Mirrors `scripts/modeling/lib/builder.mjs`'s
 * `classify()` — see that file for the design's own account of why
 * `overdueDays` means a different thing per class.
 */
export function classifyObligation(input: ObligationSignals): ObligationClassification {
  const { masteryState, lastRetrievalDay, recallDueDay, arrivalDay, asOf } = input;

  if (lastRetrievalDay === null) {
    // ARRIVE-1: widen on real days-since-arrival when the caller has a
    // signal for it, so `unmet` competes on the same "days waiting" key as
    // every other class (SESS-1 §1.1) instead of sorting purely on gapScore.
    // Clamped at 0 rather than allowed negative — a signal reporting an
    // arrival "after" asOf (clock skew, a caller passing a future day) must
    // never make a concept read as having a negative wait.
    //
    // No signal (`arrivalDay === null`) falls back to the module doc's
    // conservative `overdueDays: 0` — see "The arrival-day signal" section
    // for why 0, never `Number.POSITIVE_INFINITY`, is the honest choice for
    // an unknown wait.
    const overdueDays =
      arrivalDay === null ? 0 : Math.max(0, daysBetweenCalendarDays(arrivalDay, asOf));
    return { klass: 'unmet', overdueDays };
  }
  if (recallDueDay !== null && recallDueDay <= asOf) {
    return { klass: 'recall-due', overdueDays: daysBetweenCalendarDays(recallDueDay, asOf) };
  }
  const gap = baselineGapDaysFor(masteryState);
  if (gap === null) return { klass: 'elective', overdueDays: 0 };
  const baselineDueDay = shiftCalendarDay(lastRetrievalDay, gap);
  if (baselineDueDay <= asOf) {
    return { klass: 'baseline-due', overdueDays: daysBetweenCalendarDays(baselineDueDay, asOf) };
  }
  return { klass: 'elective', overdueDays: 0 };
}

/**
 * {@link ObligationSignals.lastRetrievalDay}/`recallDueDay` for one concept,
 * aggregated over every instrument {@link ConceptInstrumentIndex} knows for
 * it: the latest reviewed day across all of them (any of its cards checked
 * counts as the concept being checked), and the soonest FSRS due day among
 * the ones that have scheduling state (the most urgent card drives the
 * concept's recall obligation).
 */
function obligationSignalsFor(
  conceptKey: string,
  instruments: ConceptInstrumentIndex,
  replay: ReplayResult,
): { readonly lastRetrievalDay: CalendarDay | null; readonly recallDueDay: CalendarDay | null } {
  let lastRetrievalDay: CalendarDay | null = null;
  let recallDueDay: CalendarDay | null = null;
  for (const record of instruments.instrumentsFor(conceptKey)) {
    const replayed = replay.states.get(record.instrumentId);
    if (replayed === undefined) continue;
    const reviewedDay = calendarDayOfTimestamp(replayed.lastReviewedAt);
    if (reviewedDay !== null && (lastRetrievalDay === null || reviewedDay > lastRetrievalDay)) {
      lastRetrievalDay = reviewedDay;
    }
    const dueDay = calendarDayOfTimestamp(replayed.state.due);
    if (dueDay !== null && (recallDueDay === null || dueDay < recallDueDay)) {
      recallDueDay = dueDay;
    }
  }
  return { lastRetrievalDay, recallDueDay };
}

/**
 * The cheapest of a concept's instruments — the estimate used for
 * cross-course budget accounting (never the real fill, which
 * `buildStudySession` still does per-instrument, exactly, including its own
 * `[D-066]`/`ol-urvq` size pricing). Zero for a concept with no instruments
 * (F4.5/F4.10 gaps): it cannot be scheduled either way.
 *
 * Applies `CONCEPT_SIZE_SECONDS_MULTIPLIER` here too — `build.ts`'s own
 * price for a `'coarse'` row — so a coarse concept's larger true cost is
 * reflected in which course's cap it is weighed against, not just in the
 * final per-instrument fill.
 */
function representativeSecondsFor(
  row: GapRow,
  instruments: ConceptInstrumentIndex,
  durations: DurationModel,
): number {
  const records = instruments.instrumentsFor(row.conceptKey);
  if (records.length === 0) return 0;
  const sizeBand = row.conceptSize?.band ?? 'fine';
  const cheapest = Math.min(
    ...records.map((record) => durations.secondsFor(record.instrumentType)),
  );
  return cheapest * CONCEPT_SIZE_SECONDS_MULTIPLIER[sizeBand];
}

interface ClassifiedRow {
  readonly row: GapRow;
  readonly klass: ObligationClass;
  readonly overdueDays: number;
  readonly lastRetrievalDay: CalendarDay | null;
  readonly cost: number;
}

/**
 * `[D-113]` item 3: one key, defined for every class, comparing the same thing — days waiting,
 * whatever the reason. Zero free parameters.
 *
 * **The residual tie order — `[D-265]` ruling 4 / `[INTERV-6]` audit (`ol-egov.141.55`).** When
 * `overdueDays` and `gapScore` both tie exactly (routine for concepts with no evidence at all: an
 * empty history reads `overdueDays: 0` and the same neutral `gapScore` for every brand-new
 * concept absent a caller-supplied `arrivalDay`), the ruling requires the residual order to be
 * "deterministic and stated, never import order or identifier". `conceptKey` alone fails that:
 * post-`ol-bo48` it is `mintOpaqueConceptKey`'s random nonce (`../concept/key-store.ts`'s module
 * doc), so it carries no structural meaning and is not even stable across a re-mint of the SAME
 * underlying note — two runs over identical vault content could tie-break in different orders.
 * `conceptName` — the vault-facing display name, "source availability"/"scope" in the ruling's
 * own list of legitimate structural inputs — sorts first and IS the stated key for this tie.
 * `conceptKey` is kept only as the final fallback, to guarantee a total order in the residual
 * (real but rare) case of two distinct concepts sharing one display name in the same course; it
 * is never the tiebreak's stated reason, only its totality guard. Audited empirically:
 * `compose.spec.ts`'s "`[D-265]` ruling 4 / `[INTERV-6]`" describe block shows the old
 * `conceptKey`-first order was reachable and repairs it, and separately shows the full comparator
 * chain is invariant to the input `rows` array's order (permutation-tested), so this was never an
 * iteration-order bug — the defect was which stated key the residual tie read, not whether it was
 * stable run to run.
 */
function overdueFirst(a: ClassifiedRow, b: ClassifiedRow): number {
  if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
  if (a.row.gapScore !== b.row.gapScore) return b.row.gapScore - a.row.gapScore;
  if (a.row.conceptName !== b.row.conceptName) {
    return a.row.conceptName < b.row.conceptName ? -1 : 1;
  }
  return a.row.conceptKey < b.row.conceptKey ? -1 : a.row.conceptKey > b.row.conceptKey ? 1 : 0;
}

/**
 * F1.7's per-assessment date and resolved scope, keyed by the same
 * `VaultPath` a row's own `GapRow.targetAssessmentPath` names. See the
 * module doc's "F2.19 — within-block grouping" section for the data path
 * and why `weight` is deliberately not re-modelled here.
 */
export interface AssessmentGroupingContext {
  /** F4.7's dated arithmetic input. `null` reads as "no known deadline" — the same honest-unknown posture `daysUntilDue: null` gets in `../oracle/rank.ts`, never a fabricated date. */
  readonly dueDay: CalendarDay | null;
  /** F1.7's resolved scope (`../assessment/scope.ts`'s `AssessmentScope.text`), already turned into concept keys by the caller — the same shape `../retrospective/build.ts`'s `RetrospectiveConceptCoverage` already is for a different consumer. */
  readonly scopeConceptKeys: ReadonlySet<string>;
}

/**
 * The half-life (days) an assessment's continuous placement-shift weight
 * decays over as its due date recedes — see the module doc. **Declared, not
 * derived**: reused verbatim from `../oracle/rank.ts`'s
 * `DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS` (`[D-110]`), which is itself
 * argued there as a client-side default rather than a fitted number. This
 * module applies the identical argument to a second, structurally identical
 * question ("how fast does an approaching date start to matter") rather than
 * inventing a second constant for the same judgement.
 */
export const WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS = 14;

/**
 * F4.7's continuous countdown, applied to ONE row's own target assessment.
 * `0` for "no known deadline" and, by construction, for a **passed**
 * assessment (`daysUntilDue < 0`) — F4.7's "exerts no weight" enforced as a
 * value rather than a branch a caller could forget. Never negative, never
 * above 1.
 *
 * Exported for `queue/block-order.ts` (`ol-ua0i`) — the plain review-queue
 * path reuses this exact formula for its own F2.19 layer rather than
 * restating the decay curve a second time. No behaviour change: still the
 * same pure `dueDay`/`asOf` arithmetic.
 */
export function withinBlockAssessmentProximity(
  dueDay: CalendarDay | null,
  asOf: CalendarDay,
): number {
  if (dueDay === null) return 0;
  const daysUntilDue = daysBetweenCalendarDays(asOf, dueDay);
  if (daysUntilDue < 0) return 0;
  return 1 / (1 + daysUntilDue / WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS);
}

/**
 * How connected `conceptKey` is to its `peers` (the rest of its tie band,
 * same course) — the fraction of peers it shares a C7.10 edge with, `0` when
 * `related` is absent/empty or there are no peers to compare against. This is
 * the "adjacent placement favours relatedness" half of F2.19: a concept
 * connected to more of its comparably-due neighbours scores higher and sorts
 * toward the rest of that cluster, without this module ever building a
 * clustering structure of its own.
 *
 * Exported for `queue/block-order.ts` (`ol-ua0i`) — see
 * `withinBlockAssessmentProximity`'s doc above. No behaviour change.
 */
export function withinBlockRelatedness(
  conceptKey: string,
  peers: readonly string[],
  related: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): number {
  if (related === undefined || peers.length === 0) return 0;
  const own = related.get(conceptKey);
  if (own === undefined || own.size === 0) return 0;
  const connected = peers.filter((peer) => own.has(peer)).length;
  return connected / peers.length;
}

/**
 * `[D-149]`'s cohort GRAIN: the fraction of `peers` this concept shares at
 * least one EXACT source note with — `notePaths` is `GapRow.notePaths`
 * (`ConceptRecord.sourcePaths` verbatim), so "one cohort per source note"
 * needs no new extraction and no caller-resolved map, unlike
 * {@link withinBlockRelatedness}'s C7.10 adjacency above. Same
 * connected-over-peers shape as that function, over a different edge. `0`
 * when `notePaths` or `peers` is empty, or no peer's own notes overlap at
 * all.
 *
 * Exported for `../queue/block-order.ts` reuse once that path carries a
 * source-note field on `QueueCandidate` — see the module doc's "material-
 * arrival cohort" section for why that wiring is a follow-up rather than
 * done here.
 */
export function withinBlockCohortAffinity(
  notePaths: readonly VaultPath[],
  peers: readonly string[],
  peerNotePaths: ReadonlyMap<string, readonly VaultPath[]>,
): number {
  if (notePaths.length === 0 || peers.length === 0) return 0;
  const own = new Set(notePaths);
  const connected = peers.filter((peer) =>
    (peerNotePaths.get(peer) ?? []).some((path) => own.has(path)),
  ).length;
  return connected / peers.length;
}

/**
 * How many days a material-arrival cohort's pull on placement takes to fade
 * to half strength — `[D-149]`'s "continuous decay weight". **Declared, not
 * derived**: production callers resolve `arrivalDays` on both session
 * surfaces (session-builder/provider.ts since ARRIVE-2; session/build.ts for
 * the review-queue path, ol-4e7o), but no arrival *history* exists yet to
 * fit this against. One week is defensible on its own terms without a corpus: it is
 * the plain reading of "a lecture's worth of material reads as freshly
 * arrived until roughly the next one lands" — a course-cadence fact, not a
 * fitted number, and the same kind of one-sentence defence the register asks
 * of a declared constant. *Revisit* once `ARRIVE-1` has a real caller and
 * enough arrival history exists to check whether a week is too short
 * (cohorts scatter before she has revisited the material once) or too long
 * (a stale lecture's cohort still outweighs plain concept relatedness weeks
 * later).
 */
export const MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS = 7;

/**
 * `[D-149]`'s continuous decay weight: how strongly a concept's own
 * material-arrival cohort should still pull its placement, purely as a
 * function of how long ago that material arrived. `1` the day it arrives,
 * decaying smoothly toward `0` as `asOf` moves away from `arrivalDay` — the
 * same reciprocal shape {@link withinBlockAssessmentProximity} uses for a
 * date still to come, mirrored here for one already past. `0` when there is
 * no arrival signal at all (never an unbounded pull) and, by construction,
 * for an arrival day `asOf` has not reached yet (clock skew, a caller
 * passing a future day) — never a negative wait, the same clamp
 * {@link classifyObligation} applies to `arrivalDay`.
 *
 * Exported for `../queue/block-order.ts` reuse — see
 * {@link withinBlockCohortAffinity}'s doc.
 */
export function withinBlockCohortDecayWeight(
  arrivalDay: CalendarDay | null,
  asOf: CalendarDay,
): number {
  if (arrivalDay === null) return 0;
  const daysSinceArrival = daysBetweenCalendarDays(arrivalDay, asOf);
  if (daysSinceArrival < 0) return 0;
  return 1 / (1 + daysSinceArrival / MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS);
}

/**
 * One row's F2.19 placement-affinity score within its tie band — higher
 * sorts earlier. `(1 - proximity) * blendedRelatedness + proximity *
 * scopeMembership`, where `blendedRelatedness` is itself `(1 - cohortWeight)
 * * relatedness + cohortWeight * cohortAffinity` (`[D-149]`, see the module
 * doc's "material-arrival cohort" section) — every step a continuous blend,
 * never a staged switch, so "no assessment near favours relatedness", "just-
 * arrived material favours its own cohort" and "an approaching assessment
 * favours its own scope" are the SAME formula read at different points on
 * two continuous weights, exactly as F2.19 requires. `0` for every row when
 * none of the optional signals are supplied — see the module doc's no-op
 * proof.
 */
function withinBlockGroupingScore(
  c: ClassifiedRow,
  peers: readonly string[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  peerNotePaths: ReadonlyMap<string, readonly VaultPath[]>,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  asOf: CalendarDay,
): number {
  const relatedness = withinBlockRelatedness(c.row.conceptKey, peers, relatedConceptKeys);
  const cohortWeight = withinBlockCohortDecayWeight(
    arrivalDays?.get(c.row.conceptKey) ?? null,
    asOf,
  );
  const cohortAffinity = withinBlockCohortAffinity(c.row.notePaths, peers, peerNotePaths);
  const blendedRelatedness = (1 - cohortWeight) * relatedness + cohortWeight * cohortAffinity;
  const context =
    c.row.targetAssessmentPath !== null
      ? assessmentContext?.get(c.row.targetAssessmentPath)
      : undefined;
  if (context === undefined) return blendedRelatedness;
  const proximity = withinBlockAssessmentProximity(context.dueDay, asOf);
  const scopeMembership = context.scopeConceptKeys.has(c.row.conceptKey) ? 1 : 0;
  return (1 - proximity) * blendedRelatedness + proximity * scopeMembership;
}

/** A grouping signal that can decide an adjacency — every {@link GroupingSignal} but `'none'`. */
type DecidingGroupingSignal = Exclude<GroupingSignal, 'none'>;

/**
 * `[D-331]`: which signal wins when two decided the same number of adjacencies, in F2.19's own
 * precedence — the proximity term "still has final say" over the relatedness-plus-cohort blend
 * (the module doc's cohort section), and the cohort is what that blend leans on while material is
 * fresh. **Declared, never fitted**: a reading of the clause, not a number.
 */
const GROUPING_SIGNAL_PRECEDENCE: readonly DecidingGroupingSignal[] = [
  'assessment-scope',
  'arrival-cohort',
  'relatedness',
];

/**
 * {@link withinBlockGroupingScore}'s three terms, kept apart so {@link dominantGroupingSignal} can
 * say which of them moved an adjacency. Algebraically the score is their sum (with no assessment
 * context the proximity reads `0`, which is exactly the score's own early return); this function
 * never feeds a sort, so a last-bit floating-point difference between the sum and the score is
 * harmless by construction — the sort keeps reading {@link withinBlockGroupingScore} alone.
 */
function withinBlockGroupingComponents(
  c: ClassifiedRow,
  peers: readonly string[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  peerNotePaths: ReadonlyMap<string, readonly VaultPath[]>,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  asOf: CalendarDay,
): Readonly<Record<DecidingGroupingSignal, number>> {
  const relatedness = withinBlockRelatedness(c.row.conceptKey, peers, relatedConceptKeys);
  const cohortWeight = withinBlockCohortDecayWeight(
    arrivalDays?.get(c.row.conceptKey) ?? null,
    asOf,
  );
  const cohortAffinity = withinBlockCohortAffinity(c.row.notePaths, peers, peerNotePaths);
  const context =
    c.row.targetAssessmentPath !== null
      ? assessmentContext?.get(c.row.targetAssessmentPath)
      : undefined;
  const proximity =
    context === undefined ? 0 : withinBlockAssessmentProximity(context.dueDay, asOf);
  const scopeMembership = context?.scopeConceptKeys.has(c.row.conceptKey) === true ? 1 : 0;
  return {
    relatedness: (1 - proximity) * (1 - cohortWeight) * relatedness,
    'arrival-cohort': (1 - proximity) * cohortWeight * cohortAffinity,
    'assessment-scope': proximity * scopeMembership,
  };
}

/**
 * `[D-331]`, F2.22's "why this grouping": the one F2.19 signal that decided the within-course
 * order of the PRESENTED composition, as a discrete value. Reads the order after it is fixed and
 * changes nothing in it.
 *
 * `orderedBlocks` is the presentation order {@link blockByCoursePresentation} returned: contiguous
 * course blocks, each sorted by {@link withinBlockOrder}, so each block's exact-`overdueDays` tie
 * bands are contiguous runs, with the same members, peers and note paths that function scored.
 * For every adjacent pair inside a band whose grouping scores differ (the score, not the urgency
 * fallback, decided that adjacency), the deciding signal is the one whose term lifts the earlier
 * row most over the later one ({@link GROUPING_SIGNAL_PRECEDENCE} on an exact tie). The signal
 * deciding the most adjacencies is the composition's; a tie in that count goes by the same
 * precedence. `'none'` when no adjacency was decided by a score, which is every composition with
 * no F2.19 signal supplied (the module doc's no-op proof: every score reads `0`).
 *
 * Counted over what she is shown (the chosen set's presentation), not over the dominant course's
 * whole candidate order the focused selection grouped before choosing: the grouping sentence
 * describes the session she meets. Class B, flagged on the bead.
 */
function dominantGroupingSignal(
  orderedBlocks: readonly ClassifiedRow[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  asOf: CalendarDay,
): GroupingSignal {
  const decided = new Map<DecidingGroupingSignal, number>();
  let i = 0;
  while (i < orderedBlocks.length) {
    const first = orderedBlocks[i];
    if (first === undefined) break;
    let j = i + 1;
    while (
      j < orderedBlocks.length &&
      orderedBlocks[j]?.row.course === first.row.course &&
      orderedBlocks[j]?.overdueDays === first.overdueDays
    ) {
      j += 1;
    }
    const band = orderedBlocks.slice(i, j);
    i = j;
    if (band.length < 2) continue;
    const keys = band.map((c) => c.row.conceptKey);
    const notePathsByKey = new Map<string, readonly VaultPath[]>(
      band.map((c) => [c.row.conceptKey, c.row.notePaths]),
    );
    const peersOf = (c: ClassifiedRow) => keys.filter((k) => k !== c.row.conceptKey);
    const score = (c: ClassifiedRow) =>
      withinBlockGroupingScore(
        c,
        peersOf(c),
        relatedConceptKeys,
        assessmentContext,
        notePathsByKey,
        arrivalDays,
        asOf,
      );
    const terms = (c: ClassifiedRow) =>
      withinBlockGroupingComponents(
        c,
        peersOf(c),
        relatedConceptKeys,
        assessmentContext,
        notePathsByKey,
        arrivalDays,
        asOf,
      );
    for (let k = 0; k + 1 < band.length; k += 1) {
      const earlier = band[k];
      const later = band[k + 1];
      if (earlier === undefined || later === undefined) continue;
      // An exact tie fell through to `overdueFirst`: urgency, not a grouping signal, decided it.
      if (!(score(earlier) > score(later))) continue;
      const earlierTerms = terms(earlier);
      const laterTerms = terms(later);
      let decider: DecidingGroupingSignal | undefined;
      let largestLift = Number.NEGATIVE_INFINITY;
      for (const signal of GROUPING_SIGNAL_PRECEDENCE) {
        const lift = earlierTerms[signal] - laterTerms[signal];
        if (lift > largestLift) {
          decider = signal;
          largestLift = lift;
        }
      }
      if (decider !== undefined) decided.set(decider, (decided.get(decider) ?? 0) + 1);
    }
  }
  let dominant: GroupingSignal = 'none';
  let mostDecided = 0;
  for (const signal of GROUPING_SIGNAL_PRECEDENCE) {
    const count = decided.get(signal) ?? 0;
    if (count > mostDecided) {
      dominant = signal;
      mostDecided = count;
    }
  }
  return dominant;
}

/**
 * F2.19: reorders each course-block's `overdue-first` bucket WITHIN its own
 * exact-`overdueDays` tie bands only — see the module doc for why equality is
 * the tie-band boundary (zero invented fuzziness) and why this cannot move a
 * row across bands (urgency is never overridden). Bands are scored
 * independently and concatenated back in `overdueFirst`'s own band order;
 * ties within a band fall back to `overdueFirst` itself (`gapScore`, then
 * `conceptName`, then `conceptKey` — see that function's doc for the
 * `[D-265]`/`[INTERV-6]` residual-tie audit), so with no
 * relatedness/assessment-context/arrival signal this is `overdueFirst`
 * unchanged.
 *
 * **`[ILB-PLN-B1]` (`ol-egov.141.89.10.6`, `[D-296]`): a direct-prerequisite pass runs last,
 * inside this SAME band, never across one.** `orderByPrerequisite` (`concept/prerequisite-order.ts`)
 * takes the band in whatever order F2.19's score just gave it and moves an entry only when
 * `prerequisiteConceptKeys` names a prerequisite of it also present in the band — a stable Kahn
 * pass, so a row with no prerequisite edge in this band never moves relative to its neighbours,
 * and an empty or undefined map is a byte-for-byte no-op (the same no-op guarantee
 * `relatedConceptKeys`/`assessmentContext`/`arrivalDays` already have). **Never a gate**: this only
 * reorders the band `withinBlockOrder` was already going to return in full; nothing is dropped, and
 * nothing here can move a row to a different `overdueDays` band, so urgency stays unoverridable
 * exactly as the module doc's F2.19 section requires. **A cycle inside one band is left in its
 * incoming (F2.19-scored) order** — `orderByPrerequisite`'s own documented fallback — which is
 * this band's "ordinary order" absent the prerequisite signal, matching `[D-296]`'s reading that a
 * false or contradictory edge set costs order, never membership or credit. Composition-time only:
 * this runs inside `composeSessionRows`/`buildComposedStudySession`, never on an already-frozen
 * session's held item list, so it cannot reshuffle a held session (`[D-193]`) — `extendComposedStudySession`
 * only appends more of the same course under the same shares (see that function's doc) and never
 * re-runs this ordering over what she already has.
 */
function withinBlockOrder(
  bucket: readonly ClassifiedRow[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  asOf: CalendarDay,
  prerequisiteConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): readonly ClassifiedRow[] {
  const sorted = [...bucket].sort(overdueFirst);
  const result: ClassifiedRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i];
    if (first === undefined) break;
    let j = i + 1;
    while (j < sorted.length && sorted[j]?.overdueDays === first.overdueDays) j += 1;
    const band = sorted.slice(i, j);
    const keys = band.map((c) => c.row.conceptKey);
    // `[D-149]`'s cohort grain reads straight off each row's own
    // `notePaths` — no caller-resolved map needed, unlike relatedness and
    // assessment context above (see the module doc).
    const notePathsByKey = new Map<string, readonly VaultPath[]>(
      band.map((c) => [c.row.conceptKey, c.row.notePaths]),
    );
    const scored = band.map((c) => ({
      c,
      // Exclude self from its own peer set.
      score: withinBlockGroupingScore(
        c,
        keys.filter((k) => k !== c.row.conceptKey),
        relatedConceptKeys,
        assessmentContext,
        notePathsByKey,
        arrivalDays,
        asOf,
      ),
    }));
    scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : overdueFirst(a.c, b.c)));
    // `[ILB-PLN-B1]`: direct-prerequisite tie-break, strictly inside this band — see this
    // function's doc.
    const ordered = orderByPrerequisite(
      scored.map((s) => s.c),
      (c) => c.row.conceptKey,
      prerequisiteConceptKeys,
    );
    result.push(...ordered);
    i = j;
  }
  return result;
}

function groupByCourse(rows: readonly ClassifiedRow[]): ReadonlyMap<string, ClassifiedRow[]> {
  const byCourse = new Map<string, ClassifiedRow[]>();
  for (const c of rows) {
    const bucket = byCourse.get(c.row.course);
    if (bucket === undefined) byCourse.set(c.row.course, [c]);
    else bucket.push(c);
  }
  return byCourse;
}

/** Interim cross-course allocation until `ALLOC-1` exists — see the module doc. */
function proportionalCourseShares(
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
): ReadonlyMap<string, number> {
  const total = [...byCourse.values()].reduce((n, rows) => n + rows.length, 0);
  const shares = new Map<string, number>();
  for (const [course, rows] of byCourse) shares.set(course, total === 0 ? 0 : rows.length / total);
  return shares;
}

/** C5.6's rolling floor, in days rather than sessions — see the module doc. */
function forcedCourseFloorDays(runningCourseCount: number): number {
  return runningCourseCount + COURSE_FLOOR_WINDOW_SLACK;
}

function courseLastSeenDay(rows: readonly ClassifiedRow[]): CalendarDay | null {
  let latest: CalendarDay | null = null;
  for (const c of rows) {
    if (c.lastRetrievalDay !== null && (latest === null || c.lastRetrievalDay > latest)) {
      latest = c.lastRetrievalDay;
    }
  }
  return latest;
}

function forcedCoursesFor(
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
  asOf: CalendarDay,
  runningCourseCount: number,
): readonly string[] {
  const windowDays = forcedCourseFloorDays(runningCourseCount);
  const forced: string[] = [];
  for (const [course, rows] of byCourse) {
    const lastSeen = courseLastSeenDay(rows);
    const daysSince =
      lastSeen === null ? Number.POSITIVE_INFINITY : daysBetweenCalendarDays(lastSeen, asOf);
    if (daysSince >= windowDays) forced.push(course);
  }
  return forced;
}

/** Seconds per course, attention shares plus C5.6's floor forcing a guaranteed slice for a long-absent course — mirrors `builder.mjs`'s `courseBudgets`. */
function courseBudgetsFor(
  courses: readonly string[],
  budgetSeconds: number,
  shares: ReadonlyMap<string, number>,
  forced: readonly string[],
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const c of courses) out.set(c, budgetSeconds * (shares.get(c) ?? 0));
  if (forced.length === 0 || courses.length === 0) return out;
  const guaranteed = budgetSeconds / courses.length;
  let borrowed = 0;
  for (const c of forced) {
    const cur = out.get(c) ?? 0;
    borrowed += Math.max(0, guaranteed - cur);
    out.set(c, Math.max(cur, guaranteed));
  }
  const donors = courses.filter((c) => !forced.includes(c));
  const donorTotal = donors.reduce((n, c) => n + (out.get(c) ?? 0), 0);
  if (donorTotal > 0) {
    for (const c of donors) {
      const cur = out.get(c) ?? 0;
      out.set(c, Math.max(0, cur - borrowed * (cur / donorTotal)));
    }
  }
  return out;
}

/**
 * F2.18: course blocks, ordered by the most urgent obligation class present;
 * concepts within a block kept in `overdue-first` order, refined by F2.19's
 * within-tie-band grouping (see {@link withinBlockOrder} and the module
 * doc) when `relatedConceptKeys`/`assessmentContext`/`arrivalDays` are
 * supplied, and by `[ILB-PLN-B1]`'s direct-prerequisite tie-break when
 * `prerequisiteConceptKeys` is.
 */
function blockByCoursePresentation(
  chosen: readonly ClassifiedRow[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  asOf: CalendarDay,
  prerequisiteConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): readonly ClassifiedRow[] {
  const byCourse = groupByCourse(chosen);
  const ordered = new Map<string, readonly ClassifiedRow[]>();
  for (const [course, bucket] of byCourse) {
    ordered.set(
      course,
      withinBlockOrder(
        bucket,
        relatedConceptKeys,
        assessmentContext,
        arrivalDays,
        asOf,
        prerequisiteConceptKeys,
      ),
    );
  }
  const blocks = [...ordered.entries()].sort((a, b) => {
    const best = (items: readonly ClassifiedRow[]) =>
      items.reduce((m, c) => Math.min(m, CLASS_PRECEDENCE[c.klass]), Number.POSITIVE_INFINITY);
    const diff = best(a[1]) - best(b[1]);
    return diff !== 0 ? diff : a[0] < b[0] ? -1 : 1;
  });
  return blocks.flatMap(([, items]) => items);
}

/** A count per obligation class plus the worst case in each — C5.9's surface-rather-than-truncate clause. NOT a student-visible surface; see the module doc. */
export interface ObligationOverflowEntry {
  readonly klass: ObligationClass;
  readonly count: number;
  readonly worstOverdueDays: number;
}

function buildOverflow(
  classified: readonly ClassifiedRow[],
  chosenKeys: ReadonlySet<string>,
): readonly ObligationOverflowEntry[] {
  const classes: readonly ObligationClass[] = ['unmet', 'recall-due', 'baseline-due', 'elective'];
  return classes.map((klass) => {
    const left = classified.filter((c) => c.klass === klass && !chosenKeys.has(c.row.conceptKey));
    return {
      klass,
      count: left.length,
      worstOverdueDays: left.reduce((m, c) => Math.max(m, c.overdueDays), 0),
    };
  });
}

/**
 * `[D-244]` (`ol-egov.137` / FOCUS-1), item 6's implementation (`[FOCUS-3]`,
 * `ol-egov.137.2`), narrowed by `[FOCUS-5]` (`ol-egov.137.4`, David's ruling
 * 2026-09-11): a session is exactly one course (C5.6, F2.18). The two-course
 * `'focused'` policy — the admission step, the deficit/urgency doors,
 * `MIN_BLOCK_SECONDS` — is **removed, not parked**; see this bead's commit
 * for the diff and `docs/Olea_alpha_functional_scope.md`'s amended C5.6/F2.18
 * for the ratified text. `'single'` selects one dominant course (filter,
 * then urgency, then window deficit) and never admits a second.
 * **`'single'` is now the default** — see
 * {@link ComposeSessionRowsInput.focusPolicy}. `'every-course'` survives only
 * as the harness's comparison baseline: every eligible course gets a slice,
 * exactly as this module did before `[FOCUS-3]`.
 */
export type FocusPolicy = 'every-course' | 'single';

/**
 * Which of `[D-244]` item 2's three tests chose the dominant course this
 * session — `'filter'` (her course-or-topic steering named it), `'urgency'`
 * (its assessment risk crossed {@link URGENCY_OVERRIDE_THRESHOLD}), or
 * `'deficit'` (it holds the largest accumulated window deficit among the
 * eligible courses). Travels on {@link ComposeSessionRowsResult} so the
 * `[FOCUS-4]` sweep can count sessions per branch, and is what item 5's
 * sentence names (see {@link FOCUS_BRANCH_SENTENCE}).
 */
export type FocusBranch = 'filter' | 'urgency' | 'deficit';

/**
 * `[D-244]` item 6 / `findings/precommitment-focus-urgency.md` (`[FOCUS-2]`,
 * `ol-egov.137.1`): the assessment-urgency override this composer reads under
 * `focusPolicy !== 'every-course'`. **Declared** (`[BND-4]`/`[D-191]`), never
 * fitted: `1 × 1/7 × 0.5` — the urgency of a full-weight assessment seven
 * days away with half its assessed scope still weak. Higher is stricter (the
 * calendar rarely overrides the rotation); lower is more permissive
 * (assessments dominate more of the term). Moves only per the pre-commitment's
 * own moved-enough rule, one step at a time (halve or double), never off a
 * value read from her log.
 */
export const URGENCY_OVERRIDE_THRESHOLD = 1 / 14;

/**
 * `[D-244]` item 5's sentence, worded through
 * `docs/Olea_vocabulary_registry.md` at ratification time and corrected by
 * `[FOCUS-5]` (`ol-egov.137.4`): the `filter` fragment's "mostly" was true
 * under the two-course rule (a second course could still fill leftover
 * budget) and is false now that a session is exactly one course — the
 * fragment is corrected to match, `urgency`/`deficit` unchanged. This module
 * does not compose prose (see the module doc's "Framing" note two files
 * over, `build.ts`), it carries the one ratified fragment per branch so a
 * caller assembling the rendered sentence (naming the course) has the exact
 * wording ratified rather than inventing a paraphrase.
 */
export const FOCUS_BRANCH_SENTENCE: Readonly<Record<FocusBranch, string>> = Object.freeze({
  filter: 'this course because you asked for it',
  urgency: 'because its assessment is close and the assessed material still needs work',
  deficit: 'because it is behind its share from your recent sessions',
});

/**
 * `urgency(course)` read off the plan's OWN inputs, never re-derived
 * (`findings/precommitment-focus-urgency.md` (a): "not new machinery").
 * `StudyPlanAllocationEntry.contributions` mirrors `src/plan/allocation.ts`'s
 * `CourseAllocationContribution` field for field, and its `'risk'` entry IS
 * `assessmentWorth × proximityUrgency(daysToNextAssessment) ×
 * effectiveReadinessMultiplier(readiness, evidenceVolume)` — exactly C5.6's
 * ramped proximity-times-readiness term the pre-commitment names. Absent
 * `allocation` (the interim/no-allocation path, which has no risk computation
 * at all — see the module doc's "Two-level allocation" section), this reads
 * empty and the urgency branch never fires; the composer still runs on filter
 * and deficit alone, an honest degrade rather than a fabricated number.
 */
function urgencyByCourseFrom(
  allocation: readonly StudyPlanAllocationEntry[] | undefined,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const entry of allocation ?? []) {
    const risk = entry.contributions.find((c) => c.name === 'risk');
    if (risk !== undefined) out.set(entry.courseId, risk.value);
  }
  return out;
}

/**
 * The window-deficit ordering key FOCUS-3 reads for its deficit branch: days
 * since a course's material was last retrieved, `+Infinity` for a course
 * never seen — the SAME days-denominated proxy this module's own
 * {@link forcedCourseFloorDays}/{@link forcedCoursesFor} already substitute
 * for C5.6's session-denominated window (see the module doc's "C5.6's rolling
 * floor" note). **Corrected**: `sittingsSinceFloorMet` now HAS a pure
 * client-side producer, `packages/core/src/allocation/resolve-inputs.ts`
 * (`ol-v7r5.63` / `[DOS-C4]`), wired to a production caller in
 * `packages/plugin/src/plan/provider.ts` (`ol-feza` / `[DOS-C4-a]`) — but
 * that walk feeds the study PLAN's own per-course floor accounting
 * (component 3.5, still `boundary: service` for the forcing decision
 * itself), not this composer's `deficitByCourse` reading. This function has
 * no access to that plan-side history and keeps its own days-since-last-seen
 * substitute for the ordinary (non-`windowDeficit`) path — reusing this
 * module's own existing client-side substitute rather than reaching into a
 * file this bead does not own.
 */
function deficitDaysByCourseFrom(
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
  asOf: CalendarDay,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const [course, rows] of byCourse) {
    const lastSeen = courseLastSeenDay(rows);
    out.set(
      course,
      lastSeen === null ? Number.POSITIVE_INFINITY : daysBetweenCalendarDays(lastSeen, asOf),
    );
  }
  return out;
}

/**
 * `[FOCUS-5]` (`ol-egov.137.4`)'s tie-break input for
 * {@link selectDominantCourse}: how long ago each course was actually
 * SERVED (not merely owed) — bigger means "served longer ago",
 * `Number.POSITIVE_INFINITY` for "never served" in the supplied signal. Reads
 * `[FOCUS-3b]`'s real {@link WindowDeficitEntry.sessionsSinceLastServed} when
 * a caller supplied `windowDeficit` — `window.ts`'s own doc already defines
 * "served" there as "a past session where the course received > 0 seconds",
 * exactly `[FOCUS-5]`'s own wording, so this reuses that field rather than
 * computing a second recency reading. Falls back to
 * {@link deficitDaysByCourseFrom}'s days-since-last-seen substitute otherwise
 * — the SAME value that substitute already sorts the deficit branch by, so a
 * tie in that mode's deficit is already a tie in this reading too and
 * `courseId` remains the only signal left to break it, exactly as before this
 * bead.
 */
function recencyByCourseFrom(
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
  asOf: CalendarDay,
  windowDeficit: ReadonlyMap<string, WindowDeficitEntry> | undefined,
): ReadonlyMap<string, number> {
  if (windowDeficit !== undefined) {
    return new Map(
      [...windowDeficit].map(([course, entry]) => [course, entry.sessionsSinceLastServed]),
    );
  }
  return deficitDaysByCourseFrom(byCourse, asOf);
}

/** Total representative-seconds cost of a concept group — see {@link groupConceptRows}. */
function groupCost(group: readonly ClassifiedRow[]): number {
  return group.reduce((n, c) => n + c.cost, 0);
}

/**
 * `[D-244]` item 4 / F2.19's group primitive
 * (`findings/precommitment-focus-second-course.md` (a)): partitions one
 * course's already-{@link withinBlockOrder}ed rows into maximal runs of
 * DIRECTLY connected concepts — F2.19's relatedness (C7.10) or material-
 * arrival cohort (a shared source note) between two ADJACENT rows in that
 * order. **Corrected — `relatedConceptKeys` now has a production caller**
 * (`session-builder/provider.ts`'s `resolveRelatedConceptKeys`, fed by
 * `main.ts`'s served relation edges; see the module doc's "F2.19" section).
 * **Absent both signals — real whenever no relation edges have been served
 * yet, or a caller omits the map entirely — every row is still its own
 * singleton group**, the same no-op-when-absent posture every optional
 * F2.19 signal already takes on this path, never a fabricated cluster. A
 * singleton group can never be "cut", so the group primitive's "never cut a
 * group" guarantee holds by construction whenever the inputs are absent,
 * exactly as it does now that a caller supplies relatedness.
 */
function groupConceptRows(
  orderedCourseRows: readonly ClassifiedRow[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): readonly (readonly ClassifiedRow[])[] {
  const groups: ClassifiedRow[][] = [];
  for (const c of orderedCourseRows) {
    const current = groups[groups.length - 1];
    const prev = current === undefined ? undefined : current[current.length - 1];
    const connected =
      current !== undefined &&
      prev !== undefined &&
      (withinBlockRelatedness(c.row.conceptKey, [prev.row.conceptKey], relatedConceptKeys) > 0 ||
        withinBlockCohortAffinity(
          c.row.notePaths,
          [prev.row.conceptKey],
          new Map([[prev.row.conceptKey, prev.row.notePaths]]),
        ) > 0);
    if (connected && current !== undefined) current.push(c);
    else groups.push([c]);
  }
  return groups;
}

/**
 * Greedily takes WHOLE groups (never a partial one, `[D-244]` items 1/4) from
 * `groups` in priority order, up to `budgetSeconds`. A group that does not
 * fit is skipped rather than a hard stop — the same skip-and-continue reading
 * Pass 1's existing `if (spent + c.cost > cap) continue` already gives a
 * single concept, generalised here to a group.
 */
function fillWholeGroups(
  groups: readonly (readonly ClassifiedRow[])[],
  budgetSeconds: number,
): { readonly chosen: readonly ClassifiedRow[]; readonly spent: number } {
  const chosen: ClassifiedRow[] = [];
  let spent = 0;
  for (const group of groups) {
    const cost = groupCost(group);
    if (spent + cost > budgetSeconds) continue;
    chosen.push(...group);
    spent += cost;
  }
  return { chosen, spent };
}

/**
 * `[D-244]` item 2: her course-or-topic filter (F4.6) first, then an
 * eligible course whose urgency crosses {@link URGENCY_OVERRIDE_THRESHOLD},
 * then the eligible course with the largest window deficit.
 * `eligibleCourses` is always the eligible set — see the module doc's
 * eligibility note above {@link composeFocusedSelection}: a refused course
 * never appears in `byCourse`/`courses` at all, so no explicit refusal check
 * is needed here.
 *
 * The filter branch fires only when she named exactly ONE course and that
 * course is eligible — a multi-course filter narrows the roster (STEER-1,
 * applied upstream, before classification) without itself settling
 * dominance, so the hierarchy continues to urgency/deficit over just the
 * named courses.
 *
 * `deficitByCourse` is generic over WHICH deficit reading fed it —
 * `[FOCUS-3b]`'s real session-denominated {@link WindowDeficitEntry.deficit}
 * when a caller supplied {@link ComposeSessionRowsInput.windowDeficit}, or
 * this module's own days-since-last-seen substitute otherwise (see
 * {@link composeFocusedSelection}'s call site). Both scales agree that
 * "bigger is more owed"; only the ordering matters here.
 *
 * `[FOCUS-5]` (`ol-egov.137.4`, David's ruling 2026-09-11, C5.6): **at an
 * exact deficit tie, the course served LEAST RECENTLY wins** — "the one you
 * have not seen in longest" is a rule she can anticipate, unlike a raw
 * `courseId` sort. `recencyByCourse` is generic the same way
 * `deficitByCourse` is: `[FOCUS-3b]`'s real
 * {@link WindowDeficitEntry.sessionsSinceLastServed} when `windowDeficit` was
 * supplied, or this module's own days-since-last-seen substitute otherwise
 * (see {@link recencyByCourseFrom}) — bigger means "served longer ago",
 * `Number.POSITIVE_INFINITY` for "never served at all", the same convention
 * both readings already use. `courseId` still breaks a remaining tie, for
 * determinism only.
 */
function selectDominantCourse(
  eligibleCourses: readonly string[],
  courseFilter: readonly string[] | undefined,
  urgencyByCourse: ReadonlyMap<string, number>,
  deficitByCourse: ReadonlyMap<string, number>,
  recencyByCourse: ReadonlyMap<string, number>,
): { readonly course: string; readonly branch: FocusBranch } | undefined {
  if (eligibleCourses.length === 0) return undefined;

  if (courseFilter !== undefined && courseFilter.length === 1) {
    const named = courseFilter[0];
    if (named !== undefined && eligibleCourses.includes(named)) {
      return { course: named, branch: 'filter' };
    }
  }

  let byUrgency: { readonly course: string; readonly value: number } | undefined;
  for (const course of eligibleCourses) {
    const urgency = urgencyByCourse.get(course);
    if (urgency === undefined || urgency < URGENCY_OVERRIDE_THRESHOLD) continue;
    if (
      byUrgency === undefined ||
      urgency > byUrgency.value ||
      (urgency === byUrgency.value && course < byUrgency.course)
    ) {
      byUrgency = { course, value: urgency };
    }
  }
  if (byUrgency !== undefined) return { course: byUrgency.course, branch: 'urgency' };

  let byDeficit:
    | { readonly course: string; readonly value: number; readonly recency: number }
    | undefined;
  for (const course of eligibleCourses) {
    const deficit = deficitByCourse.get(course) ?? 0;
    const recency = recencyByCourse.get(course) ?? Number.POSITIVE_INFINITY;
    if (
      byDeficit === undefined ||
      deficit > byDeficit.value ||
      (deficit === byDeficit.value &&
        (recency > byDeficit.recency ||
          (recency === byDeficit.recency && course < byDeficit.course)))
    ) {
      byDeficit = { course, value: deficit, recency };
    }
  }
  return byDeficit === undefined ? undefined : { course: byDeficit.course, branch: 'deficit' };
}

/** {@link composeFocusedSelection}'s result — see that function's doc. */
interface FocusedSelectionResult {
  readonly chosen: readonly ClassifiedRow[];
  readonly shares: ReadonlyMap<string, number>;
  readonly budgets: ReadonlyMap<string, number>;
  readonly dominantCourse: string;
  readonly focusBranch: FocusBranch;
  readonly focusReason: string;
}

/**
 * `[D-244]` items 1-3 (`[FOCUS-3]`, `ol-egov.137.2`), narrowed by `[FOCUS-5]`
 * (`ol-egov.137.4`, David's ruling 2026-09-11): the one-course focus rule, run
 * whenever `focusPolicy !== 'every-course'` (i.e. `'single'`, now the
 * default — see {@link ComposeSessionRowsInput.focusPolicy}). Replaces
 * `composeSessionRows`'s ordinary course-by-course budgeted passes entirely
 * for this branch — see the call site — rather than composing with them,
 * because the two rules answer the same question ("how much of the session
 * does each course get") differently and must never both answer it at once.
 *
 * **`[FOCUS-5]` removed the second-course step entirely** — `[D-244]`'s
 * admission clauses, its deficit/urgency "doors", and `MIN_BLOCK_SECONDS` are
 * gone from this codebase, not parked behind a flag; see this bead's commit
 * for the diff and `docs/Olea_alpha_functional_scope.md`'s amended C5.6/F2.18
 * for the ratified text. A session is exactly one course: the dominant
 * course fills from its OWN whole groups up to the full session budget, and
 * whatever budget it does not use goes unspent — ending early is the
 * intended shape (F2.18), never a hunt for a second course to fill it.
 *
 * **Eligibility (item 1's "the ranking will serve it").** `courses` here is
 * always `[...byCourse.keys()]` — a course the ranking refuses (P5-T03's
 * `status: 'abstained'`/`'no-evidence'`) produces zero `GapRow`s and so never
 * enters `byCourse` at all. There is deliberately no separate refusal check:
 * the pre-commitment's own distinction ("a course whose ranking returns rows
 * but whose block comes out empty is a composer defect, not a refusal")
 * means eligibility has to be read at the ROW-SET level, before selection —
 * exactly what `byCourse` already is — never inferred from an empty block
 * after the fact.
 *
 * **The floor is not paid per session.** A non-selected eligible course's
 * `share`/seconds this session are `0` (see the return below); its window
 * deficit is carried by the service-side accounting (`src/plan/allocation.ts`)
 * and by the client-side window (C5.6's rolling floor, paid across sessions)
 * rather than by anything this module tracks per-session.
 *
 * Returns `undefined` only when there is no eligible course at all
 * (`eligibleCourses.length === 0`) — `composeSessionRows`'s caller falls back
 * to the ordinary (empty either way) path in that one degenerate case; see
 * the call site's comment for why the two are provably equivalent there.
 *
 * `windowDeficit` is `[FOCUS-3b]`'s (`ol-ulj7`) real, session-denominated
 * D-092 window reading (`./window.js`'s `computeWindowDeficit`), read off her
 * review log by the caller. **Optional, and its absence is byte-identical to
 * this bead** — the deficit branch's ordering below (and, since `[FOCUS-5]`,
 * its exact-tie recency tie-break, {@link recencyByCourseFrom}) fall back to
 * this module's own days-since-last-seen substitute exactly as before this
 * bead. Never read for urgency, and never for eligibility (eligibility is
 * read at the row-set level regardless — see the module doc's eligibility
 * note).
 */
function composeFocusedSelection(
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
  courses: readonly string[],
  courseFilter: readonly string[] | undefined,
  allocation: readonly StudyPlanAllocationEntry[] | undefined,
  budgetSeconds: number,
  asOf: CalendarDay,
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  windowDeficit: ReadonlyMap<string, WindowDeficitEntry> | undefined,
  // `[ILB-PLN-B1]`: threaded through for the SAME reason relatedConceptKeys/assessmentContext/
  // arrivalDays already are — `withinBlockOrder`'s band order here can affect which groups
  // `fillWholeGroups` below fits under budget, not only final presentation, so the tie-band
  // preference must be live at selection time too, never only at `blockByCoursePresentation`'s
  // later pass over the already-chosen set.
  prerequisiteConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): FocusedSelectionResult | undefined {
  const urgencyByCourse = urgencyByCourseFrom(allocation);
  // `[FOCUS-3b]`: the real window projection, when supplied, REPLACES the
  // days-since-last-seen substitute for ordering the deficit branch — never
  // compounds with it. Absent, this is byte-identical to before that bead.
  const deficitByCourse: ReadonlyMap<string, number> =
    windowDeficit !== undefined
      ? new Map([...windowDeficit].map(([course, entry]) => [course, entry.deficit]))
      : deficitDaysByCourseFrom(byCourse, asOf);
  const recencyByCourse = recencyByCourseFrom(byCourse, asOf, windowDeficit);
  const dominantPick = selectDominantCourse(
    courses,
    courseFilter,
    urgencyByCourse,
    deficitByCourse,
    recencyByCourse,
  );
  if (dominantPick === undefined) return undefined;
  const { course: dominantCourse, branch } = dominantPick;

  // Only the dominant course's own groups are ever needed now — `[FOCUS-5]`
  // removed every other course's role in this selection.
  const orderedDominant = withinBlockOrder(
    byCourse.get(dominantCourse) ?? [],
    relatedConceptKeys,
    assessmentContext,
    arrivalDays,
    asOf,
    prerequisiteConceptKeys,
  );
  const dominantGroups = groupConceptRows(orderedDominant, relatedConceptKeys);
  const { chosen: dominantChosen, spent: dominantSpent } = fillWholeGroups(
    dominantGroups,
    budgetSeconds,
  );

  const shares = new Map<string, number>();
  const budgets = new Map<string, number>();
  for (const course of courses) {
    if (course === dominantCourse) {
      shares.set(course, budgetSeconds > 0 ? dominantSpent / budgetSeconds : 0);
      budgets.set(course, dominantSpent);
    } else {
      // Not the dominant course this session — zero, never a fragment.
      shares.set(course, 0);
      budgets.set(course, 0);
    }
  }

  return {
    chosen: dominantChosen,
    shares,
    budgets,
    dominantCourse,
    focusBranch: branch,
    focusReason: FOCUS_BRANCH_SENTENCE[branch],
  };
}

/**
 * C7.9 containment co-presence (register row 3.7; `../session/containment.js`;
 * `[SESS-11]`, `ol-egov.132.12`) — a broad-area concept and one of its own
 * parts are never composed into the same session. `session/build.ts` already
 * applies this rule to `composeQueue`'s instrument-level candidate pool
 * before that composer runs; this composer's own candidate pool is
 * concept-level (`GapRow`, one row per concept), so this applies the
 * identical rule — `containerConceptKeysToDrop`, the same shared primitive,
 * same `part-of` edges, same "the part is kept, the container yields"
 * asymmetry — to `rows` instead, over the SAME candidate pool `composeQueue`
 * would have seen: every row this composition was handed, before
 * [STEER-1]'s course/topic filter narrows it (mirroring `session/build.ts`'s
 * own ordering, containment before `composeQueue`'s `filter`).
 *
 * **No second concept lookup.** `containerConceptKeysToDrop` needs a name ->
 * key resolver to read `ConceptRelation.from`/`.to` (concept **names**)
 * against `GapRow.conceptKey` (the opaque join key) — this module has no
 * `ConceptRecord[]` to build one from, so it builds the map from `rows`
 * itself: every row already carries both `conceptName` and `conceptKey`
 * (`ol-63e1`), the exact pair `session/containment.ts`'s own `nameToKey`
 * resolves from `ConceptRecord[]`. First occurrence wins, the same
 * convention that module uses.
 *
 * **Corrected — wired to a real edge set.** `session-builder/provider.ts`'s
 * `composedInput` now passes `deps.relations()` (`main.ts`'s
 * `servedRelationEdges()`, the same live, served `part-of` edge fold
 * `session/build.ts`'s own queue-path containment filter already reads) as
 * `relations` here, so this is no longer the no-op every real caller took
 * before — see `session/build.ts`'s own module doc, which records the same
 * correction for its `relations` posture. Still a genuine no-op whenever
 * `edges` is empty (no relation batch served yet, or a caller omitting the
 * field), the same "absence is a real no-op" posture every optional signal
 * on this composer takes.
 */
function nameToKeyFromRows(rows: readonly GapRow[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.conceptName)) map.set(row.conceptName, row.conceptKey);
  }
  return map;
}

/**
 * `rows` with every C7.9 co-present container concept's row dropped — see
 * this section's doc above {@link nameToKeyFromRows}. Returns `rows`
 * unchanged by reference whenever nothing is dropped (the no-op case), the
 * same "no new array on the common path" discipline
 * `session/containment.ts`'s own `filterContainmentCoPresence` follows.
 */
function applyContainmentCoPresence(
  rows: readonly GapRow[],
  edges: readonly ConceptRelation[],
): { readonly kept: readonly GapRow[]; readonly dropped: readonly GapRow[] } {
  if (edges.length === 0 || rows.length === 0) return { kept: rows, dropped: [] };
  const present = new Set(rows.map((row) => row.conceptKey));
  const drop = containerConceptKeysToDrop(edges, nameToKeyFromRows(rows), present);
  if (drop.size === 0) return { kept: rows, dropped: [] };
  const kept: GapRow[] = [];
  const dropped: GapRow[] = [];
  for (const row of rows) (drop.has(row.conceptKey) ? dropped : kept).push(row);
  return { kept, dropped };
}

/**
 * F2.19's restored fourth tie-band signal — `[ILB-PLN-B1]` (`ol-egov.141.89.10.6`), ruled by
 * `[D-296]` option (b): "re-wire prerequisite: as a tie-break in the live composer's ordering."
 * `[SESS-8.6]` retired `composeQueue` and with it the only production read of a `prerequisite`
 * edge for ordering; this resolves `edges` back into {@link orderByPrerequisite}'s adjacency shape
 * (dependent `conceptKey` -> the set of `conceptKey`s that should be solid first) so
 * {@link withinBlockOrder} can apply it.
 *
 * **Same edge-walk discipline as {@link applyContainmentCoPresence}'s `part-of` read, filtered to
 * `prerequisite` instead** — the identical `keyOfName` map (built once, from `nameToKeyFromRows`,
 * over the whole candidate pool, never a second `ConceptRecord[]` lookup this module does not
 * carry), the identical "an unresolved endpoint drops the whole edge, never guessed at" posture,
 * and the identical self-relation guard. This mirrors `concept/prerequisite-order.ts`'s own
 * `resolvePrerequisiteConceptKeys` rather than importing it, because that function asks for a
 * `ConceptRecord[]` and this module resolves names to keys from `GapRow[]` instead — the same
 * reason `nameToKeyFromRows`'s doc gives for not reusing `session/containment.ts`'s
 * `ConceptRecord[]`-keyed `nameToKey`.
 *
 * **Direct prerequisites only** (`[D-296]`'s reading, `[D-265]`'s F2.12 ruling read across):
 * `edges` is expected to be `input.relations` verbatim, the composer's one relations input, never a
 * second, wider or transitively-closed set — this function does no traversal of its own, so an
 * edge list that is already direct-only in, is direct-only out.
 *
 * **Freshness is the caller's gate, not this function's** (`docs/dev/intelligence-build/rel.md`
 * §3 Default 4, `ol-egov.141.89.4.11`): `edges` must already be `servedRelations(set)`'s output (or
 * `main.ts`'s `servedRelationEdges()`, the production fold over it) — the one path that withholds a
 * stale or unverified proposition — never a raw per-proposition cache read. This function has no
 * `RelationEvidenceState` to check; it trusts `edges` the exact way {@link applyContainmentCoPresence}
 * already does for the same field, and reads through no other path to `concept/relation-cache.ts`.
 */
function prerequisiteConceptKeysFromEdges(
  edges: readonly ConceptRelation[],
  keyOfName: ReadonlyMap<string, string>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.type !== 'prerequisite') continue;
    const fromKey = keyOfName.get(edge.from);
    const toKey = keyOfName.get(edge.to);
    if (fromKey === undefined || toKey === undefined) continue;
    if (fromKey === toKey) continue; // a self-prerequisite cannot order anything; defensive
    const existing = adjacency.get(toKey);
    if (existing === undefined) adjacency.set(toKey, new Set([fromKey]));
    else existing.add(fromKey);
  }
  return adjacency;
}

export interface ComposeSessionRowsInput {
  readonly rows: readonly GapRow[];
  /**
   * `ol-egov.141.89.10.30`: the caller's job to exclude a currently-
   * suspended or withdrawn instrument before it is indexed here — this
   * module never reads a suspend record itself (no `suspendedInstrumentIds`
   * fold anywhere in this file) and does not filter `instrumentsFor()`'s
   * results by anything but concept id. `session-builder/provider.ts`,
   * this composer's one production caller, builds this index from
   * `enumeration.records` already filtered by that fold (mirroring
   * `session/build.ts`'s own `candidates` filter, `ol-egov.141.89.10.13`) —
   * see that file's `composeStudySessionForRequest` for where. A caller
   * that hands this an unfiltered index will compose a suspended or
   * withdrawn instrument into the session; nothing downstream of this
   * field catches that.
   */
  readonly instruments: ConceptInstrumentIndex;
  /** `replaySchedulerStates(entries, scheduler)` — the same replay the caller's `Scheduler` produces elsewhere. */
  readonly replay: ReplayResult;
  readonly durations: DurationModel;
  readonly asOf: CalendarDay;
  readonly budgetSeconds: number;
  /**
   * ARRIVE-1 (`ol-4pue`): per-concept arrival day, keyed by `conceptKey` —
   * precomputed pure data, exactly like `instruments`/`replay`/`durations`
   * are, so this module stays synchronous and does no `VaultSource` I/O
   * itself (see the module doc's "INV-1 / §7.1" section). Typically built by
   * resolving `VaultSource.firstSeen` over each concept's `GapRow.notePaths`
   * and converting the earliest result with `calendarDayOfTimestamp`.
   * **Optional, and safe to omit entirely**: a missing map, or a concept
   * absent from it, both read as "no signal" and fall back to
   * {@link classifyObligation}'s conservative `overdueDays: 0` for `unmet` —
   * never to an unbounded wait. See the module doc's "arrival-day signal"
   * section for why 0 is the honest fallback.
   */
  readonly arrivalDays?: ReadonlyMap<string, CalendarDay>;
  /**
   * F2.19: C7.10 relation adjacency, keyed by `conceptKey`, each value the
   * set of OTHER `conceptKey`s it connects to. **Optional and safe to omit
   * entirely** — see the module doc's "F2.19" section for the data path and
   * the no-op proof when this is absent.
   */
  readonly relatedConceptKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * F2.19: F1.7's per-assessment date and resolved scope, keyed by the exact
   * `VaultPath` a row's own `targetAssessmentPath` names. **Optional and
   * safe to omit entirely** — see {@link AssessmentGroupingContext} and the
   * module doc's "F2.19" section.
   */
  readonly assessmentContext?: ReadonlyMap<VaultPath, AssessmentGroupingContext>;
  /**
   * [STEER-1] (`ol-imqy`, `[D-076]` round 2 "Can she steer it?"): the
   * "course or topic" steering input, one of the three the ruling makes
   * first-class on this one path (alongside {@link ComposeSessionRowsInput.budgetSeconds}
   * and `buildStudySession`'s `focusConceptName`). Matches {@link GapRow.course}
   * verbatim — R1/R2, never case-folded. `undefined` means no restriction;
   * combined with {@link conceptIds} by AND, mirroring `../queue/types.ts`'s
   * `QueueFilter`. Applied before `groupByCourse` and everything downstream
   * of it, so cross-course allocation runs only over the courses she actually
   * asked about — XCRS-1 (`ol-dq1c`) never compares a `gapScore` across a
   * boundary this filter already removed, it just sees fewer courses.
   */
  readonly courses?: readonly string[];
  /**
   * [STEER-1]'s "topic" half of the same input: restrict to one or more
   * concepts by {@link GapRow.conceptKey} — the opaque join key, never
   * `conceptName` (R2). `undefined` means no restriction; combined with
   * {@link courses} by AND.
   */
  readonly conceptIds?: readonly string[];
  /**
   * A2.5's real cross-course allocation (component 3.5), read off the
   * caller's cached study-plan artifact (`StudyPlanBody.allocation`,
   * `packages/contracts/src/artifact-envelope.ts`) — `ol-v7r5.17` [ALLOC-2].
   * **Optional, and an empty array reads the same as omitted**: both mean
   * "no real allocation yet" and fall back to
   * {@link proportionalCourseShares}'s interim policy, this module's
   * behaviour before this field existed. See the module doc's "Two-level
   * allocation" section for why supplying it also disables this module's own
   * local C5.6 floor-forcing rather than compounding with it.
   */
  readonly allocation?: readonly StudyPlanAllocationEntry[];
  /**
   * `[D-244]` (`ol-egov.137` / FOCUS-1), item 6 (`[FOCUS-3]`,
   * `ol-egov.137.2`), narrowed by `[FOCUS-5]` (`ol-egov.137.4`, David's
   * ruling 2026-09-11): **defaults to `'single'`** — a session is one course
   * (C5.6, F2.18). `'every-course'` survives only as the harness's comparison
   * baseline; supply it explicitly to serve every eligible course a slice,
   * exactly as this module did before `[FOCUS-3]`. See {@link FocusPolicy}'s
   * doc for the full history.
   */
  readonly focusPolicy?: FocusPolicy;
  /**
   * `[FOCUS-3b]` (`ol-ulj7`, discovered from `ol-egov.137.5` [FOCUS-4c]):
   * D-092's real, session-denominated window deficit
   * (`./window.js`'s `computeWindowDeficit`), read off her review log by the
   * caller. **Optional, and its absence is the exact behaviour FOCUS-3
   * already shipped**: `composeFocusedSelection` falls back to this module's
   * own days-since-last-seen substitute
   * ({@link forcedCourseFloorDays}/{@link deficitDaysByCourseFrom}) exactly
   * as before this bead — see the module doc's "C5.6's rolling floor" note
   * for why that substitute exists and FOCUS-4c's finding for its known gap
   * (a course starving 13-14 sessions while the substitute never read past a
   * 2-day deficit). Read when `focusPolicy !== 'every-course'`, for the
   * deficit branch's dominant-course ordering and, since `[FOCUS-5]`, its
   * exact-tie recency tie-break ({@link recencyByCourseFrom}) — never for
   * urgency, and never for eligibility (a refused course is read at the
   * row-set level regardless, both here and inside `./window.js`'s own
   * history — see that module's doc).
   */
  readonly windowDeficit?: ReadonlyMap<string, WindowDeficitEntry>;
  /**
   * C7.9 containment co-presence (register row 3.7; `[SESS-11]`,
   * `ol-egov.132.12`) — `part-of` edges available at composition time,
   * applied to `rows` before anything else runs. **Omitted means none, which
   * is a real no-op, not a degraded mode** — the identical posture
   * `session/build.ts`'s own `BuildReviewSessionInput.relations` documents
   * for `composeQueue`'s candidate pool. See the doc above
   * {@link nameToKeyFromRows} for why this module resolves names to keys from
   * `rows` itself rather than taking a second `ConceptRecord[]` input.
   *
   * **Also `[ILB-PLN-B1]`'s (`ol-egov.141.89.10.6`, `[D-296]`) one source of `prerequisite`
   * edges** for the restored tie-band ordering signal — see the module doc's "a fifth, restored
   * signal" section and {@link prerequisiteConceptKeysFromEdges}. Same field, same expectation:
   * this must already be a served, freshness-gated edge set (`concept/relation.ts`'s
   * `servedRelations`, or `main.ts`'s `servedRelationEdges()`), never a raw per-proposition cache
   * read — this module has no `RelationEvidenceState` to check that itself.
   */
  readonly relations?: readonly ConceptRelation[];
  /**
   * `[D-292]`'s citation freshness, keyed by `instrumentId` — see the module doc's "Citation
   * validity" section for the full account of what is read vs. actioned, and for why this
   * field's own name/type/shape are unchanged from before `[D-330]` (a real production caller,
   * `ol-egov.141.89.10.33`'s `resolveCitationFreshness`, already resolves it). **Optional, and
   * safe to omit entirely**: an omitted map, or an instrument missing from it, both read as
   * `'unknown'`, never `'fresh'` — this module never treats "no signal" as "no problem" for a
   * citation the way it does for {@link arrivalDays}/{@link relatedConceptKeys} above, because
   * `'unknown'` is itself one of `[D-292]`'s three ruled states, not a degraded fallback outside
   * them. What changed is what `'stale'` now DOES — see {@link citationPendingRevalidation} and
   * the module doc.
   */
  readonly citationFreshness?: ReadonlyMap<string, CitationFreshnessState>;
  /**
   * `[D-351]`'s pending-revalidation fact — instrument ids with a revalidation currently
   * outstanding for the exact source revision being checked. See the module doc's "Citation
   * validity" section for why this module takes it as an id set rather than resolving
   * `citationValidityStatus`'s own scoping rule itself (it has no `InstrumentCitation` to check a
   * revision against). **Optional, and safe to omit entirely** — an omitted set, or an
   * instrument missing from it, both read as "nothing pending," the same posture `[D-351]`'s
   * stored field not existing yet (`ol-egov.141.89.5.4`, open) already leaves every production
   * caller in today. Takes precedence over {@link citationFreshness} when both are supplied for
   * the same instrument — the same precedence `citationValidityStatus` itself states.
   */
  readonly citationPendingRevalidation?: ReadonlySet<string>;
}

export interface ComposeSessionRowsResult {
  /** Course-blocked, obligation-ordered — feed straight to `buildStudySession` with `order: 'given'`. */
  readonly orderedRows: readonly GapRow[];
  readonly overflow: readonly ObligationOverflowEntry[];
  readonly courseShares: ReadonlyMap<string, number>;
  readonly forcedCourses: readonly string[];
  /**
   * Rows the C7.9 containment co-presence filter dropped before anything
   * else ran (`[SESS-11]`) — empty whenever `input.relations` is omitted or
   * carries no edges; `session-builder/provider.ts` now supplies a real,
   * served edge set (`main.ts`'s `servedRelationEdges()`), so this is no
   * longer empty on every real caller — see {@link applyContainmentCoPresence}'s
   * own doc for the correction. Reported rather than folded silently
   * into `orderedRows`'s absence, the same posture
   * `ReviewSession.containmentDropped` already takes on the retiring queue
   * path. Optional only so a hand-built fixture predating this bead remains
   * valid — the same "optional on the result, always set by the real
   * builder" pattern `StudySessionModel.explainBackItems` and
   * `ComposeSessionRowsResult.focusPolicy` already use; `composeSessionRows`
   * itself always sets it.
   */
  readonly containmentDropped?: readonly GapRow[];
  /**
   * Each chosen concept's own {@link ObligationClass}, keyed by `conceptKey`
   * — a student-visible signal, unlike {@link overflow}. See the module
   * doc's "Per-item obligation class" section for why this shape (one class
   * per concept, no count, no total) is exactly what F6.7 needs and nothing
   * it forbids. Covers precisely the concepts named in {@link orderedRows};
   * a `conceptKey` classified-but-not-chosen lives only in `overflow`'s
   * aggregate, never here.
   */
  readonly obligationClasses: ReadonlyMap<string, ObligationClass>;
  /**
   * [SESS-9] (`ol-2zfj.77`, C5.5/C5.6): the seconds each course's share
   * converts to against this composition's own budget — A2.5's conversion
   * where a real `allocation` was supplied, this module's interim
   * proportional policy plus its local floor-forcing where it was not, in
   * both cases the exact map the selection above was capped by. Returned so
   * `buildStudySession`'s fill can honour the same seconds the selection did,
   * rather than the share stopping at concept selection and the instrument
   * fill spending one flat session-wide total — see `./build.ts`'s module doc,
   * "Allocation's share is honoured before the cross-course fill".
   */
  readonly courseSeconds: ReadonlyMap<string, number>;
  /**
   * Echoes {@link ComposeSessionRowsInput.focusPolicy}, defaulted to
   * `'single'` since `[FOCUS-5]` — so a caller (or the `[FOCUS-4]` harness)
   * can tell which arm ran without also threading the input through.
   * Optional only so a hand-built fixture predating `[FOCUS-3]` remains
   * valid — the same "optional on the result, always set by the real
   * builder" pattern `StudySessionModel.explainBackItems` already uses;
   * `composeSessionRows` itself always sets it.
   */
  readonly focusPolicy?: FocusPolicy;
  /**
   * `[D-244]` item 2's chosen dominant course this session. `undefined` under
   * `'every-course'` (no dominant course is chosen — every eligible course
   * may be served) and in the degenerate case of no eligible course at all.
   */
  readonly dominantCourse?: string;
  /** Which of item 2's three tests chose {@link dominantCourse} — see {@link FocusBranch}. `undefined` exactly when {@link dominantCourse} is. */
  readonly focusBranch?: FocusBranch;
  /** Item 5's ratified sentence fragment for {@link focusBranch} — see {@link FOCUS_BRANCH_SENTENCE}. `undefined` exactly when {@link focusBranch} is. */
  readonly focusReason?: string;
  /**
   * The `'unknown'` citation-validity state, ACTIONED — see the module doc's "Citation validity"
   * section. Instrument ids, among the instruments backing {@link orderedRows}' own concepts,
   * whose {@link ComposeSessionRowsInput.citationFreshness} reads `'unknown'` (an omitted map, or
   * an instrument missing from it, both count) AND which have no pending evidence either. The
   * instrument IS in `orderedRows` — this is the re-check signal a caller enqueues alongside
   * serving it (`ol-2zfj.154`'s "serve with a re-check queued"), never a reason to withhold it.
   */
  readonly citationRecheckQueued: ReadonlySet<string>;
  /**
   * The `'stale'` freshness state and `[D-351]`'s pending-revalidation fact, read AND now
   * ACTIONED — `[D-330]`/`[D-351]` (both ruled 2026-09-25) settle the withholding this field used
   * to only report; see the module doc's "Citation validity" section and
   * {@link ComposeSessionRowsInput.citationFreshness}/{@link ComposeSessionRowsInput.citationPendingRevalidation}'s
   * docs. Instrument ids, among the instruments backing {@link orderedRows}' own concepts, whose
   * freshness reads `'stale'` (a confirmed digest disagreement) or which appear in
   * `citationPendingRevalidation` (a revalidation for this citation's own source revision is
   * outstanding) — both are the same "cited passage marked changed" cause `[D-330]`'s removal
   * rule names, and both are withheld the same way. This set names the instruments a caller
   * (and {@link buildComposedStudySession}/{@link extendComposedStudySession}, downstream in this
   * same module) must exclude from what is actually served; it does NOT mean the instrument still
   * appears in the fill the way `citationRecheckQueued`'s does.
   */
  readonly citationRevalidationPending: ReadonlySet<string>;
  /**
   * `[D-331]`: which F2.19 signal decided the presented within-course grouping — see
   * {@link dominantGroupingSignal} and the module doc's "`[D-331]`" section. Optional only so a
   * hand-built fixture predating this field remains valid, the same pattern
   * {@link containmentDropped} uses; `composeSessionRows` always sets it.
   */
  readonly groupingSignal?: GroupingSignal;
  /**
   * `[D-331]`: what this SELECTION weighed and did not take, each with why, by id — other
   * eligible courses (course grain), the session's own concepts whose group did not fit or that
   * yielded to a part (concept grain), and instruments withheld under `[D-330]` (instrument
   * grain, the same ids {@link citationRevalidationPending} names). The fill's own set-asides
   * (a selected concept no instrument of which got a slot) are added by
   * {@link buildComposedStudySession}, which runs the fill. Optional for the same fixture reason
   * as {@link groupingSignal}; `composeSessionRows` always sets it.
   */
  readonly setAside?: CompositionSetAside;
}

/**
 * `[D-330]`/`[D-351]`'s removal test for one instrument, mirroring `citationValidityStatus`'s own
 * precedence (that function's doc: pending wins whenever it applies, before any digest
 * comparison is even consulted) — see the module doc's "Citation validity" section for why this
 * module takes the two pieces of evidence separately rather than calling that function itself.
 * `'pending'` (in `citationPendingRevalidation`) is checked first and, on its own, is sufficient;
 * otherwise a `'stale'` freshness reading withholds; anything else (`'fresh'`, `'unknown'`, or no
 * signal at all) does not.
 */
function isCitationWithheld(
  instrumentId: string,
  citationFreshness: ReadonlyMap<string, CitationFreshnessState> | undefined,
  citationPendingRevalidation: ReadonlySet<string> | undefined,
): boolean {
  if (citationPendingRevalidation?.has(instrumentId) === true) return true;
  return citationFreshness?.get(instrumentId) === 'stale';
}

/**
 * Decide which concepts are eligible for today's session and in what order —
 * the layer SESS-1 designed. See the module doc for the full algorithm.
 *
 * The selection pass uses {@link representativeSecondsFor}'s cheap-instrument
 * estimate for cross-course budget accounting only; `buildStudySession` still
 * does the real, per-instrument accounting downstream, so an estimate that
 * runs a little high or low here costs at most a slightly generous or
 * slightly tight candidate set — never a wrong final session.
 */
export function composeSessionRows(input: ComposeSessionRowsInput): ComposeSessionRowsResult {
  const {
    rows: allRows,
    instruments,
    replay,
    durations,
    asOf,
    budgetSeconds,
    arrivalDays,
    relatedConceptKeys,
    assessmentContext,
    courses: courseFilter,
    conceptIds: conceptIdFilter,
    allocation,
    windowDeficit,
  } = input;
  // `[FOCUS-5]` (`ol-egov.137.4`, David's ruling 2026-09-11): omission now
  // means `'single'` — a session is one course by default. `'every-course'`
  // must be requested explicitly (the harness's own comparison baseline).
  const focusPolicy = input.focusPolicy ?? 'single';

  // C7.9 containment co-presence (`[SESS-11]`), over the WHOLE candidate
  // pool and before [STEER-1]'s course/topic filter — see the doc above
  // `applyContainmentCoPresence` for why this mirrors `session/build.ts`'s
  // own ordering (containment before `composeQueue`'s `filter`).
  const containment = applyContainmentCoPresence(allRows, input.relations ?? []);

  // `[ILB-PLN-B1]` (`[D-296]`): the SAME `input.relations` field, resolved to `prerequisite`
  // edges only — see `prerequisiteConceptKeysFromEdges`'s doc for why this reuses that one
  // already-gated field rather than a second input, and why direct-only/freshness both follow
  // from that reuse rather than needing separate enforcement here.
  const prerequisiteConceptKeys = prerequisiteConceptKeysFromEdges(
    input.relations ?? [],
    nameToKeyFromRows(allRows),
  );

  // [STEER-1]: the course-or-topic input, applied before any allocation
  // work so shares/forced-courses/obligation classes are all computed over
  // exactly the scope she asked about — see the field docs above.
  const rows =
    courseFilter === undefined && conceptIdFilter === undefined
      ? containment.kept
      : containment.kept.filter(
          (row) =>
            (courseFilter === undefined || courseFilter.includes(row.course)) &&
            (conceptIdFilter === undefined || conceptIdFilter.includes(row.conceptKey)),
        );

  const classified: ClassifiedRow[] = rows.map((row) => {
    const { lastRetrievalDay, recallDueDay } = obligationSignalsFor(
      row.conceptKey,
      instruments,
      replay,
    );
    const { klass, overdueDays } = classifyObligation({
      masteryState: row.masteryState,
      lastRetrievalDay,
      recallDueDay,
      // ARRIVE-1: `undefined` map or missing entry both collapse to `null` —
      // "no signal", not "arrived at epoch 0" — see `ComposeSessionRowsInput`.
      arrivalDay: arrivalDays?.get(row.conceptKey) ?? null,
      asOf,
    });
    return {
      row,
      klass,
      overdueDays,
      lastRetrievalDay,
      cost: representativeSecondsFor(row, instruments, durations),
    };
  });

  const byCourse = groupByCourse(classified);
  const courses = [...byCourse.keys()];

  // `[D-244]` (`[FOCUS-3]`, `ol-egov.137.2`): `focusPolicy !== 'every-course'`
  // replaces the ordinary course-by-course budgeted passes below entirely —
  // see `composeFocusedSelection`'s own doc for why the two rules must never
  // both run. `focusResult` is `undefined` only when there is no eligible
  // course at all (`courses.length === 0`), in which case the ordinary path
  // below is taken instead — it produces the identical empty result in that
  // one degenerate case (every helper it calls is a no-op over an empty
  // `byCourse`), so this is not a silent fallback to different behaviour.
  const focusResult: FocusedSelectionResult | undefined =
    focusPolicy === 'every-course'
      ? undefined
      : composeFocusedSelection(
          byCourse,
          courses,
          courseFilter,
          allocation,
          budgetSeconds,
          asOf,
          relatedConceptKeys,
          assessmentContext,
          arrivalDays,
          windowDeficit,
          prerequisiteConceptKeys,
        );

  let shares: ReadonlyMap<string, number>;
  let forced: readonly string[];
  let budgets: ReadonlyMap<string, number>;
  let chosen: ClassifiedRow[];
  let chosenKeys: ReadonlySet<string>;

  if (focusResult !== undefined) {
    shares = focusResult.shares;
    // Item 5: the floor is not paid per session, so nothing is "forced" a
    // guaranteed slice THIS session under a focus policy — the window
    // accounting (service-side) carries what is owed instead. See
    // `composeFocusedSelection`'s doc.
    forced = [];
    budgets = focusResult.budgets;
    chosen = [...focusResult.chosen];
    chosenKeys = new Set(chosen.map((c) => c.row.conceptKey));
  } else {
    // `ol-v7r5.17` [ALLOC-2]: a real allocation (non-empty) replaces both the
    // interim proportional share AND this module's own local C5.6
    // floor-forcing, wholesale — see the module doc's "Two-level allocation"
    // section for why the two floor mechanisms must never compound. Absent or
    // empty falls back to today's pre-ALLOC-2 behaviour unchanged.
    if (allocation !== undefined && allocation.length > 0) {
      shares = new Map(allocation.map((entry) => [entry.courseId, entry.share]));
      forced = [];
      budgets = allocationSharesToSeconds(allocation, budgetSeconds).secondsByCourseId;
    } else {
      shares = proportionalCourseShares(byCourse);
      forced = forcedCoursesFor(byCourse, asOf, courses.length);
      budgets = courseBudgetsFor(courses, budgetSeconds, shares, forced);
    }

    const chosenRows: ClassifiedRow[] = [];
    const chosenKeySet = new Set<string>();
    let spent = 0;

    // Pass 1: course by course (alphabetical — never by score, XCRS-1), each
    // capped at its own budget.
    for (const course of [...courses].sort()) {
      const cap = spent + (budgets.get(course) ?? 0);
      for (const c of [...(byCourse.get(course) ?? [])].sort(overdueFirst)) {
        if (spent + c.cost > cap) continue;
        chosenRows.push(c);
        chosenKeySet.add(c.row.conceptKey);
        spent += c.cost;
      }
    }
    // Pass 2: whatever a course's own budget could not absorb, in the same
    // order, against whatever of the session budget remains.
    for (const c of classified
      .filter((c) => !chosenKeySet.has(c.row.conceptKey))
      .sort(overdueFirst)) {
      if (spent + c.cost > budgetSeconds) continue;
      chosenRows.push(c);
      chosenKeySet.add(c.row.conceptKey);
      spent += c.cost;
    }
    chosen = chosenRows;
    chosenKeys = chosenKeySet;
  }

  const orderedBlocks = blockByCoursePresentation(
    chosen,
    relatedConceptKeys,
    assessmentContext,
    arrivalDays,
    asOf,
    prerequisiteConceptKeys,
  );
  const orderedRows = orderedBlocks.map((c) => c.row);
  const overflow = buildOverflow(classified, chosenKeys);
  // Keyed over the CHOSEN set only (`orderedBlocks`, same rows as
  // `orderedRows`) — see `ComposeSessionRowsResult.obligationClasses`'s doc.
  const obligationClasses = new Map<string, ObligationClass>(
    orderedBlocks.map((c) => [c.row.conceptKey, c.klass]),
  );

  // `[D-292]`/`[D-330]`/`[D-351]` citation validity — see the module doc's "Citation validity"
  // section for what is read vs. actioned. Walked over the CHOSEN set's own instruments only (the
  // same `orderedBlocks` scope `obligationClasses` above uses), never the full candidate pool.
  const citationRecheckQueued = new Set<string>();
  const citationRevalidationPending = new Set<string>();
  // `[D-331]`: the same withheld ids, in the order met, each with the concept it was composed
  // under — the instrument grain of `setAside` below. Filled alongside the set, never instead of it.
  const setAsideInstruments: SetAsideInstrument[] = [];
  for (const c of orderedBlocks) {
    for (const record of instruments.instrumentsFor(c.row.conceptKey)) {
      // `[D-330]`: `'stale'` (a confirmed digest disagreement) and `[D-351]`'s pending fact are
      // the same "cited passage marked changed" removal cause — both withheld the same way. See
      // `buildComposedStudySession`'s `withholdInstruments` call for where this set is actioned.
      if (
        isCitationWithheld(
          record.instrumentId,
          input.citationFreshness,
          input.citationPendingRevalidation,
        )
      ) {
        if (!citationRevalidationPending.has(record.instrumentId)) {
          setAsideInstruments.push({
            instrumentId: record.instrumentId,
            conceptKey: c.row.conceptKey,
            reason: 'cited-passage-changed',
          });
        }
        citationRevalidationPending.add(record.instrumentId);
      } else if ((input.citationFreshness?.get(record.instrumentId) ?? 'unknown') === 'unknown') {
        citationRecheckQueued.add(record.instrumentId);
      }
    }
  }

  // `[D-331]`: the selection's own set-asides — see `ComposeSessionRowsResult.setAside`. Read off
  // the facts the selection above already decided (`focusResult`, `chosenKeys`, `classified`,
  // `containment`); nothing here feeds back into `orderedRows`.
  const sessionCourses: ReadonlySet<string> =
    focusResult !== undefined ? new Set([focusResult.dominantCourse]) : new Set(courses);
  const setAsideCourses: SetAsideCourse[] =
    focusResult === undefined
      ? []
      : [...courses]
          .filter((course) => course !== focusResult.dominantCourse)
          .sort()
          .map((courseId) => ({ courseId, reason: 'another-course-chosen' }));
  const setAsideConcepts: SetAsideConcept[] = [
    ...classified
      .filter((c) => sessionCourses.has(c.row.course) && !chosenKeys.has(c.row.conceptKey))
      .sort(overdueFirst)
      .map((c): SetAsideConcept => ({ conceptKey: c.row.conceptKey, reason: 'did-not-fit' })),
    // C7.9 ran over the whole pool before [STEER-1]'s filter; only a yielded concept she could
    // have been served here (inside her steering, in this session's course) was set aside by it.
    ...containment.dropped
      .filter(
        (row) =>
          sessionCourses.has(row.course) &&
          (courseFilter === undefined || courseFilter.includes(row.course)) &&
          (conceptIdFilter === undefined || conceptIdFilter.includes(row.conceptKey)),
      )
      .map((row): SetAsideConcept => ({ conceptKey: row.conceptKey, reason: 'yields-to-part' })),
  ];

  return {
    orderedRows,
    overflow,
    courseShares: shares,
    forcedCourses: forced,
    obligationClasses,
    courseSeconds: budgets,
    containmentDropped: containment.dropped,
    citationRecheckQueued,
    citationRevalidationPending,
    groupingSignal: dominantGroupingSignal(
      orderedBlocks,
      relatedConceptKeys,
      assessmentContext,
      arrivalDays,
      asOf,
    ),
    setAside: {
      courses: setAsideCourses,
      concepts: setAsideConcepts,
      instruments: setAsideInstruments,
    },
    // `[FOCUS-3]`'s echo discipline, unchanged by `[FOCUS-5]`'s default flip:
    // the `focusPolicy` field is echoed only when the caller explicitly
    // supplied one (even `'every-course'` explicitly), never synthesised
    // from the default, so a caller reading `Object.keys(result)` sees no
    // new field unless it opted in — `dominantCourse`/`focusBranch`/
    // `focusReason` below are NOT gated the same way: they appear whenever
    // `focusResult` ran, which since `[FOCUS-5]` includes every omitted-input
    // call (the default is `'single'`, not `'every-course'`).
    ...(input.focusPolicy !== undefined ? { focusPolicy } : {}),
    ...(focusResult !== undefined
      ? {
          dominantCourse: focusResult.dominantCourse,
          focusBranch: focusResult.focusBranch,
          focusReason: focusResult.focusReason,
        }
      : {}),
  };
}

export interface BuildComposedStudySessionInput
  // `obligationClasses` is omitted for the same reason `order`/`rows` are:
  // it is derived from `composeSessionRows` below, never a caller input —
  // see `buildComposedStudySession`'s own override of it. `schedulerStates`
  // ([SESS-7], `[D-240]` item 2) is omitted for exactly that reason too: this
  // input already carries `replay`, and the fill's map is that replay folded
  // to its states, so a caller able to pass a second, possibly-disagreeing one
  // is a defect surface rather than a feature. `courseBudgetSeconds`
  // ([SESS-9], `ol-2zfj.77`) joins them on the same argument: this input
  // already carries `allocation`, and the fill's per-course seconds are that
  // allocation converted by A2.5's rule, so a caller able to pass a second,
  // possibly-disagreeing set of seconds could silently compose against a share
  // the selection above never used.
  extends Omit<
    BuildStudySessionInput,
    'order' | 'rows' | 'obligationClasses' | 'schedulerStates' | 'courseBudgetSeconds'
  > {
  readonly rows: readonly GapRow[];
  /** `replaySchedulerStates(entries, scheduler)` — see `ComposeSessionRowsInput.replay`. */
  readonly replay: ReplayResult;
  /** ARRIVE-1 — see `ComposeSessionRowsInput.arrivalDays`, passed straight through. */
  readonly arrivalDays?: ReadonlyMap<string, CalendarDay>;
  /** F2.19 — see `ComposeSessionRowsInput.relatedConceptKeys`, passed straight through. */
  readonly relatedConceptKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  /** F2.19 — see `ComposeSessionRowsInput.assessmentContext`, passed straight through. */
  readonly assessmentContext?: ReadonlyMap<VaultPath, AssessmentGroupingContext>;
  /** [STEER-1] — see `ComposeSessionRowsInput.courses`, passed straight through. */
  readonly courses?: readonly string[];
  /** [STEER-1] — see `ComposeSessionRowsInput.conceptIds`, passed straight through. */
  readonly conceptIds?: readonly string[];
  /** `ol-v7r5.17` [ALLOC-2] — see `ComposeSessionRowsInput.allocation`, passed straight through. */
  readonly allocation?: readonly StudyPlanAllocationEntry[];
  /** `[D-244]` (`[FOCUS-3]`) — see `ComposeSessionRowsInput.focusPolicy`, passed straight through. Defaults to `'single'` since `[FOCUS-5]`. */
  readonly focusPolicy?: FocusPolicy;
  /** `[FOCUS-3b]` (`ol-ulj7`) — see `ComposeSessionRowsInput.windowDeficit`, passed straight through. */
  readonly windowDeficit?: ReadonlyMap<string, WindowDeficitEntry>;
  /** C7.9 (`[SESS-11]`) — see `ComposeSessionRowsInput.relations`, passed straight through. */
  readonly relations?: readonly ConceptRelation[];
  /** `[D-292]`/`[D-330]` — see `ComposeSessionRowsInput.citationFreshness`, passed straight through and now additionally used (a `'stale'` reading) to withhold an instrument from the fill below. */
  readonly citationFreshness?: ReadonlyMap<string, CitationFreshnessState>;
  /** `[D-351]`/`[D-330]` — see `ComposeSessionRowsInput.citationPendingRevalidation`, passed straight through and used to withhold an instrument from the fill below. */
  readonly citationPendingRevalidation?: ReadonlySet<string>;
}

/**
 * [STEER-1] (`ol-imqy`, `[D-076]` round 2 "Can she steer it?"): the single
 * request shape carrying all three steering inputs the ruling makes
 * first-class on ONE path — the time she has, a course or topic, and a
 * stated interest (today's only proxy: front-lifting one named concept,
 * `focusConceptName`). A caller builds ONE object of this shape and hands it
 * to {@link buildComposedStudySession} unmodified.
 *
 * It is ALSO, unmodified, a valid `filter` for `composeQueue`
 * (`../queue/compose.js`): `QueueFilter`'s `courses`/`conceptIds` are a
 * structural subset of this type, and `../queue/types.ts` documents that
 * compatibility explicitly rather than leaving it to be discovered. This is
 * deliberately plain data with no row-shape coupling (unlike `ClassifiedRow`
 * or `QueueItem` — see `../queue/block-order.ts`'s module doc for why THOSE
 * restate rather than share a type across this exact boundary); a type with
 * no row-shape to restate has nothing that convention protects, so it is
 * shared once instead.
 */
export type SessionSteeringRequest = Pick<
  BuildComposedStudySessionInput,
  'budgetMinutes' | 'courses' | 'conceptIds' | 'focusConceptName'
>;

export interface ComposedStudySession {
  /**
   * Carries the same per-concept classification as {@link obligationClasses}
   * below, already folded onto each item as its own `obligationClass` — see
   * `StudySessionItem.obligationClass`'s doc.
   */
  readonly model: StudySessionModel;
  /** NOT a student-visible surface — see the module doc's F6.7 section. */
  readonly overflow: readonly ObligationOverflowEntry[];
  readonly courseShares: ReadonlyMap<string, number>;
  readonly forcedCourses: readonly string[];
  /**
   * IS a student-visible signal, unlike {@link overflow} — see
   * `ComposeSessionRowsResult.obligationClasses`'s doc and the module doc's
   * "Per-item obligation class" section. Surfaced here too (not only on
   * `model.items`) for a caller that wants the composition-level map without
   * walking every item.
   */
  readonly obligationClasses: ReadonlyMap<string, ObligationClass>;
  /**
   * C7.9 containment co-presence (`[SESS-11]`) — see
   * `ComposeSessionRowsResult.containmentDropped`. Empty whenever no
   * `relations` were supplied, which is every real caller today. Optional
   * for the same fixture-compatibility reason as that field;
   * `buildComposedStudySession` always sets it.
   */
  readonly containmentDropped?: readonly GapRow[];
  /** `[D-244]` (`[FOCUS-3]`) — see `ComposeSessionRowsResult.focusPolicy`; optional for the same fixture-compatibility reason. `buildComposedStudySession` always sets it. */
  readonly focusPolicy?: FocusPolicy;
  /** See `ComposeSessionRowsResult.dominantCourse`. */
  readonly dominantCourse?: string;
  /** See `ComposeSessionRowsResult.focusBranch`. */
  readonly focusBranch?: FocusBranch;
  /** See `ComposeSessionRowsResult.focusReason`. */
  readonly focusReason?: string;
  /** See `ComposeSessionRowsResult.citationRecheckQueued`. */
  readonly citationRecheckQueued: ReadonlySet<string>;
  /** See `ComposeSessionRowsResult.citationRevalidationPending`. */
  readonly citationRevalidationPending: ReadonlySet<string>;
  /**
   * `[D-331]` — see `ComposeSessionRowsResult.groupingSignal`. Optional only so a hand-built
   * fixture predating this field remains valid; `buildComposedStudySession` always sets it.
   */
  readonly groupingSignal?: GroupingSignal;
  /**
   * `[D-331]`: the whole composition's set-asides — `ComposeSessionRowsResult.setAside` plus the
   * fill's own: a selected concept no instrument of which got a slot (`'did-not-fit'`), or with
   * nothing to practise it (`'no-instruments'`). A selected concept whose instruments all sit in
   * the session under another concept is in the session, so it is not listed; one whose
   * instruments were all withheld is listed at the instrument grain only. Optional for the same
   * fixture reason; `buildComposedStudySession` always sets it.
   */
  readonly setAside?: CompositionSetAside;
}

/**
 * `ReplayResult.states` folded to the `instrumentId -> SchedulerState` map
 * `buildStudySession`'s serving rule takes ([SESS-7], `[D-240]` item 2).
 * Absence stays absence: an instrument never rated is missing from `replay`
 * and stays missing here, which the rule reads as "never reviewed".
 */
function schedulerStatesOf(replay: ReplayResult): ReadonlyMap<string, SchedulerState> {
  const states = new Map<string, SchedulerState>();
  for (const [instrumentId, replayed] of replay.states) {
    states.set(instrumentId, replayed.state);
  }
  return states;
}

/**
 * `[D-330]`/`[D-351]`'s removal action: a view of `instruments` that omits exactly the instrument
 * ids `withheldInstrumentIds` names, so `buildStudySession`'s own per-instrument fill (`./build.js`,
 * a file this module does not own) never offers one of them a slot. See the module doc's "Citation
 * validity" section for why this filter — never a `build.js` change — is where the withholding
 * happens: this module already computes {@link ComposeSessionRowsResult.citationRevalidationPending}
 * from its own `input.citationFreshness`/`input.citationPendingRevalidation`, and
 * `ComposeSessionRowsInput.instruments`'s own doc already
 * establishes "the caller hands the fill an already-filtered index" as this module's posture for a
 * suspended or withdrawn instrument — this is the identical posture applied to the one signal this
 * module itself reads and can therefore filter without any other file's cooperation.
 *
 * `concepts`/`recordCount` are passed through unchanged: they describe what went INTO the index (a
 * fact about the vault enumeration), never what the fill is offered out of it — the same distinction
 * `buildConceptInstrumentIndex`'s own doc draws for those two fields.
 */
function withholdInstruments(
  instruments: ConceptInstrumentIndex,
  withheldInstrumentIds: ReadonlySet<string>,
): ConceptInstrumentIndex {
  if (withheldInstrumentIds.size === 0) return instruments;
  return {
    concepts: instruments.concepts,
    recordCount: instruments.recordCount,
    instrumentsFor(conceptId: string): readonly VaultInstrumentRecord[] {
      return instruments
        .instrumentsFor(conceptId)
        .filter((record) => !withheldInstrumentIds.has(record.instrumentId));
    },
  };
}

/**
 * `[D-331]`: the fill's own set-asides, over the selection's rows in session order — see
 * `ComposedStudySession.setAside`'s doc for what is and is not listed, and why. `servedConceptKeys`
 * is read straight off `items`' own `conceptKey` (`./build.ts`'s fill stamps it there directly,
 * `ol-egov.141.89.10.4`) — a plain read, not a reconstruction from `orderedRows`/`instruments`.
 */
function fillSetAsideConcepts(
  orderedRows: readonly GapRow[],
  instruments: ConceptInstrumentIndex,
  withheld: ReadonlySet<string>,
  items: readonly StudySessionItem[],
): readonly SetAsideConcept[] {
  const servedInstrumentIds = new Set(items.map((item) => item.instrumentId));
  const servedConceptKeys = new Set(
    items.map((item) => item.conceptKey).filter((key): key is string => key !== undefined),
  );
  const out: SetAsideConcept[] = [];
  for (const row of orderedRows) {
    if (servedConceptKeys.has(row.conceptKey)) continue;
    const records = instruments.instrumentsFor(row.conceptKey);
    if (records.length === 0) {
      out.push({ conceptKey: row.conceptKey, reason: 'no-instruments' });
      continue;
    }
    const available = records.filter((record) => !withheld.has(record.instrumentId));
    if (available.length === 0) continue;
    if (available.every((record) => servedInstrumentIds.has(record.instrumentId))) continue;
    out.push({ conceptKey: row.conceptKey, reason: 'did-not-fit' });
  }
  return out;
}

/**
 * `composeSessionRows` + `buildStudySession(order: 'given')` — the whole
 * SESS-1 layer, end to end. This is what a production caller wants; the two
 * halves stay separately exported for testing and for a caller that needs
 * the composed order without the instrument-level fill.
 *
 * Validates `budgetMinutes`/`asOf` itself, with the same rule
 * `buildStudySession` applies, so an invalid budget fails before any
 * composition work runs rather than after.
 */
export function buildComposedStudySession(
  input: BuildComposedStudySessionInput,
): ComposedStudySession {
  if (!Number.isFinite(input.budgetMinutes) || input.budgetMinutes <= 0) {
    throw new Error(
      `buildComposedStudySession: budgetMinutes must be a finite number greater than 0, got ${input.budgetMinutes}`,
    );
  }
  if (!isCalendarDay(input.asOf)) {
    throw new Error(
      `buildComposedStudySession: asOf must be a YYYY-MM-DD day, got ${JSON.stringify(input.asOf)}`,
    );
  }

  const budgetSeconds = input.budgetMinutes * SECONDS_PER_MINUTE;
  const composed = composeSessionRows({
    rows: input.rows,
    instruments: input.instruments,
    replay: input.replay,
    durations: input.durations,
    asOf: input.asOf,
    budgetSeconds,
    ...(input.arrivalDays !== undefined ? { arrivalDays: input.arrivalDays } : {}),
    ...(input.relatedConceptKeys !== undefined
      ? { relatedConceptKeys: input.relatedConceptKeys }
      : {}),
    ...(input.assessmentContext !== undefined
      ? { assessmentContext: input.assessmentContext }
      : {}),
    ...(input.courses !== undefined ? { courses: input.courses } : {}),
    ...(input.allocation !== undefined ? { allocation: input.allocation } : {}),
    ...(input.conceptIds !== undefined ? { conceptIds: input.conceptIds } : {}),
    ...(input.focusPolicy !== undefined ? { focusPolicy: input.focusPolicy } : {}),
    ...(input.windowDeficit !== undefined ? { windowDeficit: input.windowDeficit } : {}),
    ...(input.relations !== undefined ? { relations: input.relations } : {}),
    ...(input.citationFreshness !== undefined
      ? { citationFreshness: input.citationFreshness }
      : {}),
    ...(input.citationPendingRevalidation !== undefined
      ? { citationPendingRevalidation: input.citationPendingRevalidation }
      : {}),
  });

  const model = buildStudySession({
    ...input,
    rows: composed.orderedRows,
    order: 'given',
    // `[D-330]`/`[D-351]`: an instrument whose citation reads `'superseded'` or `'pending'`
    // (both in `composed.citationRevalidationPending`) is withheld from the fill entirely — see
    // `withholdInstruments`'s own doc and the module doc's "Citation validity" section. Derived
    // from the composition just run, never a caller input, the same reason `obligationClasses`
    // below is.
    instruments: withholdInstruments(input.instruments, composed.citationRevalidationPending),
    // Derived from the composition just run, not a caller input — see
    // `BuildComposedStudySessionInput`'s Omit and its comment above.
    obligationClasses: composed.obligationClasses,
    // [SESS-7] (`[D-240]` item 2): the same `replay` this composition already
    // classified obligations from, folded to the per-instrument states the
    // fill's serving rule reads — never a second read of the log, and never a
    // second scheduler.
    schedulerStates: schedulerStatesOf(input.replay),
    // [SESS-9] (`ol-2zfj.77`): the seconds the selection above was capped by,
    // handed to the fill so C5.5's "fills each course's seconds from that
    // course's own ranking" is true of the instruments served and not only of
    // the concepts selected. Derived from the composition just run, never a
    // caller input — the same reason `obligationClasses` and `schedulerStates`
    // are omitted from `BuildComposedStudySessionInput`.
    courseBudgetSeconds: composed.courseSeconds,
  });

  // `[D-331]`: the composition's own account, read off the fill just run — see the module doc's
  // "`[D-331]`" section. Nothing below feeds `model`.
  const selectionSetAside = composed.setAside ?? { courses: [], concepts: [], instruments: [] };
  const setAside: CompositionSetAside = {
    courses: selectionSetAside.courses,
    concepts: [
      ...fillSetAsideConcepts(
        composed.orderedRows,
        input.instruments,
        composed.citationRevalidationPending,
        model.items,
      ),
      ...selectionSetAside.concepts,
    ],
    instruments: selectionSetAside.instruments,
  };

  return {
    model,
    overflow: composed.overflow,
    courseShares: composed.courseShares,
    forcedCourses: composed.forcedCourses,
    obligationClasses: composed.obligationClasses,
    citationRecheckQueued: composed.citationRecheckQueued,
    citationRevalidationPending: composed.citationRevalidationPending,
    groupingSignal: composed.groupingSignal ?? 'none',
    setAside,
    ...(composed.containmentDropped !== undefined
      ? { containmentDropped: composed.containmentDropped }
      : {}),
    ...(composed.focusPolicy !== undefined ? { focusPolicy: composed.focusPolicy } : {}),
    ...(composed.dominantCourse !== undefined ? { dominantCourse: composed.dominantCourse } : {}),
    ...(composed.focusBranch !== undefined ? { focusBranch: composed.focusBranch } : {}),
    ...(composed.focusReason !== undefined ? { focusReason: composed.focusReason } : {}),
  };
}

/**
 * F2.17/C5.8's "outran the target" extension
 * (`docs/dev/one-assembly-path.md` §3b, olea-service; `[SESS-11]`,
 * `ol-egov.132.12`).
 *
 * C5.8's own text: "the list changes only by her own action (finishing,
 * leaving, or outrunning the target under the same plan's shares), never by
 * the tool." A frozen `ComposedStudySession` has no way to grow itself — this
 * is the missing move. It calls {@link buildComposedStudySession} again, with
 * `input` unmodified apart from `budgetMinutes` (the caller's own wider
 * number — how far she wants to keep going is a product judgement this
 * function does not make, the same posture `./reentry.js`'s
 * `composeReentrySession` already takes for "how much smaller"), so any
 * caller that hands over the SAME `courses`/`conceptIds`/`allocation`/
 * `focusPolicy` it used to build `previous` gets "the same plan's shares"
 * (C5.5) by construction — identity, not a re-derivation — rather than this
 * function inventing a pinned-shares mechanism of its own. This is the same
 * discipline `composeReentrySession` already states for its own variant call
 * ("this module contains no second selection mechanism of its own"), applied
 * to growth instead of shrinkage.
 *
 * **Never reorders, never duplicates — and now drops exactly what `[D-330]` rules removable.**
 * The same three-word contract `packages/plugin/src/review/queue-adapter.ts`'s
 * `FrozenReviewQueue.extend` already states for the queue path (`extend`'s
 * own doc: "grow, never replace, never reorder, never duplicate") holds for reordering and
 * duplication; `previous`'s own items keep their relative order and are never reordered. But
 * `[D-330]` (David's clarification: "including within an already-open session") makes removal the
 * one exception this function must apply too, not only `buildComposedStudySession`'s fresh fill —
 * an item of `previous.model.items` whose `instrumentId` reads `'stale'` (freshness) or appears
 * in `citationPendingRevalidation`, against THIS call's own `input`, is dropped, never carried
 * forward, before anything is appended (see
 * {@link ComposeSessionRowsResult.citationRevalidationPending}'s doc).
 * Every surviving previous item keeps its own byte-identical value; only positions are renumbered
 * to stay contiguous. Items the wider composition offers that are not already among the survivors
 * (matched by `instrumentId`, the same key `extend` matches on) are appended, in the order the
 * wider fill produced them, with `position` continuing the renumbered sequence.
 *
 * **The gap this closes.** `ComposedStudySession.model.leftOut`/`.overflow`
 * are per-CONCEPT (`StudySessionOmission`/`ObligationOverflowEntry`) — there
 * was nothing per-instrument to thread through `extend`'s
 * `instrument.instrumentId` matching, which is exactly why re-running the
 * same budget found nothing new (`ol-egov.132.12`'s own bead, confirmed
 * empirically against `packages/plugin/test/review/open-session.spec.ts`'s
 * "continue extends" scenario). Recomposing at a wider budget and diffing by
 * `instrumentId` produces the missing per-instrument view without inventing
 * a second per-instrument bookkeeping structure inside this module.
 *
 * **Reachability.** Wired: `packages/plugin/src/main.ts`'s outrun handling calls this function
 * directly, at the site building `items` from `result.composedInput` widened to
 * `widerBudgetMinutes` (its `extendComposedStudySession(...)` call) — `result.composedInput`
 * comes from `session-builder/provider.ts`'s `composeStudySessionForRequest`, which already
 * carries `citationFreshness` (that file's `resolveCitationFreshness` call), so this function's
 * `[D-330]` removal reaches production without any further wiring.
 *
 * `[D-331]` (`ol-egov.141.89.10.65`): now the item list of
 * {@link extendComposedStudySessionWithAccount}, which also carries the composition's own account
 * through the extension. The items are byte-identical to what this function returned before, and
 * an extension that changes nothing still returns `previous.model.items` itself.
 */
export function extendComposedStudySession(
  input: BuildComposedStudySessionInput,
  previous: ComposedStudySession,
): readonly StudySessionItem[] {
  return extendComposedStudySessionWithAccount(input, previous).model.items;
}

/**
 * {@link extendComposedStudySession}'s growth, returned as the whole extended session with the
 * composition's `[D-331]` account kept true through it (`ol-egov.141.89.10.65`).
 *
 * The session is exactly the one `main.ts`'s `extendDefaultStudySession` builds today from the
 * item list (`{ ...previous, model: { ...previous.model, items } }`), so a caller switching to
 * this function changes nothing it already shows; only the account fields differ from a plain
 * spread, which would carry `previous`'s account unchanged and leave every appended item without
 * a concept key:
 *
 * - each item's own `conceptKey` needs no carrying at all: it travels with the item object
 *   itself (`previous`'s retained items keep theirs, `widened`'s appended items already carry
 *   theirs from the fill that built them), so there is no separate map to keep true here;
 * - `setAside`: the other courses as `previous` set them aside (the extension is pinned to the
 *   same course and does not re-weigh them); the wider composition's concepts and withheld
 *   instruments, less anything now in the session; plus every `previous` item this extension
 *   dropped under `[D-330]`, as `'cited-passage-changed'` (the only removal this function applies);
 * - `groupingSignal`: `previous`'s, unchanged. F2.22 states the composition once, at the start,
 *   and an extension grows that same composition rather than restating it.
 *
 * Returns `previous` itself when nothing was appended and nothing removed.
 */
export function extendComposedStudySessionWithAccount(
  input: BuildComposedStudySessionInput,
  previous: ComposedStudySession,
): ComposedStudySession {
  const widened = buildComposedStudySession(input);
  // `[D-330]`/`[D-351]`: removal reaches an already-open session's own previously-served items,
  // not only what this wider recomposition would newly offer — read against THIS call's own
  // `citationFreshness`/`citationPendingRevalidation`, never `previous`'s, so the freshest
  // evidence always governs. See the module doc's own "Citation validity" section and this
  // function's doc.
  const retainedPrevious = previous.model.items.filter(
    (item) =>
      !isCitationWithheld(
        item.instrumentId,
        input.citationFreshness,
        input.citationPendingRevalidation,
      ),
  );
  const somethingWasRemoved = retainedPrevious.length !== previous.model.items.length;
  const alreadyServed = new Set(retainedPrevious.map((item) => item.instrumentId));
  const appended = widened.model.items.filter((item) => !alreadyServed.has(item.instrumentId));
  if (appended.length === 0 && !somethingWasRemoved) return previous;
  // A removal reopens gaps in `position` (e.g. 1, 2, 3 with 2 removed) that appending after
  // `retainedPrevious.length` alone would collide with — renumbered only when something was
  // actually removed, so the ordinary append-only path keeps every retained item's own
  // `position` byte-identical, exactly as it already did before `[D-330]`.
  const renumberedPrevious = somethingWasRemoved
    ? retainedPrevious.map((item, index) => ({ ...item, position: index + 1 }))
    : retainedPrevious;
  const items: readonly StudySessionItem[] = [
    ...renumberedPrevious,
    ...appended.map((item, index) => ({
      ...item,
      position: renumberedPrevious.length + index + 1,
    })),
  ];

  // `[D-331]`: the account, carried through — see this function's own doc. Nothing below feeds
  // `items`. Each item's own `conceptKey` already travelled with it into `items` above; no map
  // is built to restate that.
  const inSession = new Set(items.map((item) => item.instrumentId));
  const conceptsInSession = new Set(
    items.map((item) => item.conceptKey).filter((key): key is string => key !== undefined),
  );
  const widenedSetAside = widened.setAside ?? { courses: [], concepts: [], instruments: [] };
  const removed: SetAsideInstrument[] = [];
  for (const item of previous.model.items) {
    if (alreadyServed.has(item.instrumentId)) continue;
    const conceptKey =
      item.conceptKey ??
      widenedSetAside.instruments.find((entry) => entry.instrumentId === item.instrumentId)
        ?.conceptKey;
    if (conceptKey !== undefined) {
      removed.push({
        instrumentId: item.instrumentId,
        conceptKey,
        reason: 'cited-passage-changed',
      });
    }
  }
  const listed = new Set<string>();
  const setAsideInstruments: SetAsideInstrument[] = [];
  for (const entry of [...removed, ...widenedSetAside.instruments]) {
    if (inSession.has(entry.instrumentId) || listed.has(entry.instrumentId)) continue;
    listed.add(entry.instrumentId);
    setAsideInstruments.push(entry);
  }
  const setAside: CompositionSetAside = {
    courses: previous.setAside?.courses ?? widenedSetAside.courses,
    concepts: widenedSetAside.concepts.filter((entry) => !conceptsInSession.has(entry.conceptKey)),
    instruments: setAsideInstruments,
  };

  return { ...previous, model: { ...previous.model, items }, setAside };
}
