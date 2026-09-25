/**
 * The D7.1 review-log record — FROZEN (P2-T03, INV-4).
 *
 * This is the single most consequential *data* decision in the product, for a
 * reason that has nothing to do with code quality: **it cannot be backfilled.**
 * INV-4 exists because every consumer of this record — mastery rollup (C5.4),
 * misconception recurrence (M1–M4), both early-warning signals, and the whole
 * Phase A→B checkpoint (spec §8) — reads a semester of history that only exists
 * if it was captured correctly on day one. A field missing in August is a
 * question that cannot be answered in November.
 *
 * So the shape is frozen here, in `contracts`, before P2-T03 writes a line of
 * the writer — and `olea-service` vendors this same file (plan §2.4).
 *
 * **Versioning (D-020, `ol-t3sd`, `ol-g6zg`, `ol-tka5`).** "Frozen" means *a
 * version* is frozen, not that the file never grows: v1 (`reviewLogRecordV1`)
 * stays here, untouched forever, so records already on disk stay readable; v2
 * adds the `kind` discriminator that turns the log into a union of review and
 * suspension events; v3 replaces `conceptId` with `conceptIds`, because one
 * instrument may be evidence for every concept its note names; and v4 moves
 * `masteryAtTime` out of `selectionContext` onto the record itself as a
 * per-concept map, because a rating is evidence for every concept the
 * instrument names and each of those concepts has its own mastery; v4 later
 * gains a third `kind`, `verdictLogRecordV4` (`ol-548w`, INV-6), additive the
 * same way `suspend`/`unsuspend` were additive at v2 — no version bump,
 * because nothing about an existing kind's shape changes. The rule for every
 * reader is the same one v1's doc already stated — **read the version first,
 * never guess** — with exactly one migration site, core's `upgrade.ts`
 * (`upgradeV1`, then `upgradeV2`, then `upgradeV3`). Every version bump so far
 * was taken while the only records in existence at that version were
 * fixtures; that was the last cheap moment each time, which is D-017's
 * argument.
 *
 * **v5 (`ol-tka5`, ratified `[D-117]`, design at `olea-service`'s
 * `docs/dev/verdict-seam-design.md`) is a MIGRATE-IN-PLACE bump, not an
 * additive one — the one deliberate exception to "every version bump so far
 * added a hop."** `[D-109]` (closed 2026-08-25, titled for this exact
 * migration) rules that review-log v5 carries no v4 retention: no real v4
 * record exists anywhere (prod is dark, no BRAT install, the alpha user has no
 * review log — `[D-109]`'s own expiry test), so `reviewLogRecordV4`,
 * `suspendLogRecordV4` and `verdictLogRecordV4` are renamed forward to V5
 * rather than kept alongside it, `REVIEW_LOG_READABLE_VERSIONS` drops `4`
 * rather than adding `5` beside it, and core's `upgrade.ts` gains no
 * `upgradeV4` hop — `upgradeV3` now targets v5 directly. v1–v3 are untouched
 * and still frozen exactly as before; this exception is scoped to the v4→v5
 * transition alone, per `[D-109]`'s own text. Three fields land: `supportLevelShown`
 * (D-094's shown-support ladder, principle 16/F2.20 — record what was shown,
 * never what she said), `explainBackGrade` (R9's SOLO depth verdict, a
 * `revisionOf` backward pointer, and a `[D-077]` content-store reference —
 * explain-back reviews only), and `schedulingObservation` (MAT-4's
 * non-scoring neighbour-use signal, `[D-087]`, C5.11 — originally
 * explain-back-only, **widened by `[D-185]` (`ol-0r92.41`) to any instrument
 * kind**, and the mastery fold must never read it).
 *
 * **All three are `.optional()`, not `.nullable()`-required, and that is a
 * deliberate build-time simplification, not the design doc's literal
 * schema.** The design draft wrote `supportLevelShown` as required-but-nullable
 * to match `selectionContext`'s explicit-null discipline; this build instead
 * follows the same "true absence, not a placeholder" rule v4's `masteryAtTime`
 * already established. **All three now have production writers, which does
 * not by itself argue for `.nullable()`-required — see below.**
 * `explainBackGrade` (and, when the accepted grading demonstrated a
 * neighbour concept's use, `schedulingObservation` riding the same event) is
 * written by `recordGradedExplainBackReview`
 * (`packages/core/src/study-session/explain-back-grade-write.ts`,
 * `ol-95vv.3`), reached through `ExplainBackModal`'s accept flow (`ol-cqz8`)
 * via `main.ts`'s `recordExplainBackSoloGradeAndReview` (`ol-38kp`).
 * `supportLevelShown` is written by
 * `packages/plugin/src/review/ports.ts`'s `createVaultReviewLogPort`
 * (row 3.9, `[SUPP-2]`/`ol-95vv.4`, `[SUPP-3]`/`ol-lpl4`), fed by the
 * chooser decision `packages/core/src/study-session/build.ts` composes onto
 * the study-session item and wired into production at `main.ts:896`. None of
 * that makes a writer universal: `explainBackGrade` and the
 * `schedulingObservation` this same path can produce are absent from every
 * non-explain-back review by construction, `schedulingObservation` also has
 * no wired producer yet for a qa/cloze/mcq review specifically
 * (`review/session.ts`'s `evaluateSchedulingObservationForGradeWrite` — see
 * that hook's own doc), `supportLevelShown` is absent for MCQ (out of
 * `[D-094]`'s ladder scope by rule) and for any review whose item carried no
 * chooser decision, and every record written before its writer landed
 * carries none of the three. A required field would still force every one
 * of those calls to `appendReviewLogRecord` to invent a value it does not
 * have.
 * **What would force a genuine v6 rather than a value inside this baseline:**
 * if a future ruling requires `supportLevelShown` to be non-omittable
 * (explicit `null` on every record, matching the older context fields) —
 * that is a schema-shape change (optional → required-nullable), not a value
 * change, and belongs in its own version.
 *
 * **v6 (`ol-95vv.8`) is defined in this file but not yet current.** It is the
 * one migration carrying the fields ruled since v5 (the mastery stamp's
 * vitality and arithmetic version, explain-back correctness in its own place,
 * a suspension's reason, hint use, the presented source revision), and it is
 * an ordinary additive hop: v5 stays readable. It leaves `supportLevelShown`
 * optional. See the v6 block after `reviewLogEntryV5` for what is staged and
 * what the flip that makes it current has to move together.
 *
 * **What v3's migration can and cannot do.** `upgradeV2` maps `conceptId` to
 * `[conceptId]` and nothing cleverer. A v2 record on disk names one concept
 * because one is all that was ever captured; the co-listed names it might have
 * carried are not recoverable from current vault state, and a guess persisted
 * into an append-only log is indistinguishable from a fact, forever. The
 * migration is therefore lossless in the only direction it can be — it never
 * drops what was recorded, and it never invents what was not.
 *
 * **v4's migration inherits exactly that restraint**, and it is the reason the
 * v4 field is shaped the way it is: a v3 record that names two concepts and
 * carries one mastery state cannot be split between them, because which concept
 * the state described was never captured. `upgradeV3` therefore attributes the
 * value only when there is exactly one concept to attribute it to, and
 * otherwise records it as explicitly **not attributable** — keeping what was
 * written down without inventing the half that never was.
 *
 * **This record lives in her vault, never on the server.** It is the event log
 * of plan §7.1's execution model: the truth from which every knowledge
 * projection is recomputed locally. D-005 forbids the Worker from storing it,
 * and nothing here may be sent to the Worker except transiently and by explicit
 * design.
 */

import { z } from 'zod';

/**
 * The schedulable instrument types (F2.14), plus explain-back.
 *
 * Explain-back is deliberately **not** FSRS-scheduled — it is on-demand (F5),
 * routed on repeated failure (F2.12), and its results are evidence into mastery
 * rather than a scheduled item. It appears here because D7.1 logs it: R5's
 * feedback loop and the amendment's second early-warning signal both need her
 * actual engagement per instrument type, which means every attempt is recorded
 * whether or not it produced a rating.
 *
 * F2.14 states the extensibility rule as a test: a schedulable type added later
 * may cost changes in rating mapping and in how the type renders, and in
 * nothing else — not queue composition, not the mastery interfaces, not this
 * enum.
 */
export const instrumentType = z.enum(['qa', 'cloze', 'mcq', 'explain-back']);
export type InstrumentType = z.infer<typeof instrumentType>;

/**
 * The FSRS four-way rating.
 *
 * **`easy` is absent for MCQ by rule, not by schema** (F2.16): recognising an
 * answer among options is weaker evidence than producing it unprompted, and
 * granting recognition the top rating would quietly corrupt FSRS state and
 * everything rolled up from it. That constraint is a pure function per
 * instrument type in core, deliberately *not* encoded as a narrower union here
 * — the log records what happened, and a schema that made the invalid state
 * unrepresentable would also make a real bug unloggable and therefore invisible.
 *
 * Explain-back produces **no** rating at all; the field is nullable for it.
 */
export const rating = z.enum(['again', 'hard', 'good', 'easy']);
export type Rating = z.infer<typeof rating>;

/**
 * Named growth-stage vocabulary (F2.11, D-049). `tree` requires a graded
 * explain-back (R7) — recall alone, however extensive, caps at `sapling`.
 *
 * **These are F2.11's current words verbatim (D-017's discipline, applied a
 * second time).** This enum previously read `new … yours` — a single
 * five-value ordinal that D-048 ruled a genuine modelling defect, not a
 * naming preference: it made a retention claim (`solid`) and an
 * understanding claim (`yours`) compete on one scale, and it had to express
 * fading recall as a demotion because it had nowhere else to put fading.
 * D-049 (decided from rendered candidates, not from prose) settled the
 * replacement: growth stage split out as its own monotonic axis, four
 * values, with vitality — `holding` / `needs tending` / `too early to say`,
 * `docs/Olea_vocabulary_registry.md` §1 axis 2 — carrying retention
 * separately as an overlay that never lowers a stage. **This enum is the
 * growth-stage axis only.** Vitality is its own enum, `vitalityValue`,
 * persisted from schema version 6 beside the stage (`masteryAtTimeV6`,
 * `ol-95vv.8`); nothing here encodes it, and nothing should default a
 * missing vitality reading to any one of its three values.
 *
 * The old five collapse onto the new four as: `new` → `seed`, `shaky` and
 * `coming` both → `sprout` (the new vocabulary has one bucket for "practised,
 * not holding yet" where the old ordinal split it in two), `solid` →
 * `sapling`, `yours` → `tree`.
 *
 * Changed at a deliberate moment rather than a convenient one, the same
 * argument D-017 made the first time: the review log persists this value and
 * the record is explicitly not backfillable, so the cost of a rename rises
 * the instant a real review exists. `[D-048]` found no real record did when
 * this changed and ruled it the last cheap moment, not the first — `[D-109]`
 * then generalised the point: no backwards compatibility is owed before real
 * user data exists, so this is a migrate-in-place value change, not a new
 * schema version.
 *
 * These identifiers are also the only growth-stage vocabulary in the
 * codebase. Display strings live at exactly one site — `mastery/display.ts`
 * in core — so F2.11's "one vocabulary used everywhere" is enforced by there
 * being nowhere else to disagree with.
 */
export const masteryState = z.enum(['seed', 'sprout', 'sapling', 'tree']);
export type MasteryState = z.infer<typeof masteryState>;

/**
 * The context the queue used when it chose this instrument — D7.1's core demand
 * and the half most easily under-built.
 *
 * Without this, "did prioritisation change what she studied?" is unanswerable,
 * because there is no record of *why* each item was offered. Every field is
 * captured even when it is null in the current phase: `planVersion` is null
 * until P5 publishes study plans (C7.6), and `yieldRank` and `examProximity`
 * are null while the queue is plain FSRS order in P2. Recording them as
 * explicit nulls rather than omitting them is what makes the Phase A baseline
 * and the Phase B comparison the same shape.
 */
export const selectionContext = z.object({
  /**
   * Whether the instrument was actually due, or drawn early/late.
   *
   * **The `explain-back` borrowed-value convention (`[D-178 / LOG-3]` item
   * 3).** An explain-back attempt is never FSRS-scheduled (F2.14 rules it
   * out of the schedule outright; F2.14a re-confirms it as a *trigger*, not
   * a queue item), so none of the four honest values applies to one. A
   * writer that must still supply this field borrows `'new'`, meaning only
   * *this item was not previously scheduled* — never a claim that it was
   * ever due, and never scheduling evidence a reader may draw an inference
   * from. This is a stated convention, not something the value's ordinary
   * meaning implies on its own, and it is provisional: the honest
   * representation is settled when the allocation/session-scheduling design
   * lands, or when F2.12 routing writes its first production record,
   * whichever comes first (the proposal's own hold, unchanged by this
   * comment).
   */
  dueState: z.enum(['due', 'overdue', 'early', 'new']),
  /** Days to the nearest relevant assessment; null when unknown or none. */
  examProximity: z.number().int().nullable(),
  /** Oracle yield rank at selection time; null before F2.8 switch-on. */
  yieldRank: z.number().int().nullable(),
  /**
   * Concept mastery when the item was offered; null if the concept was unrated.
   *
   * **Singular, frozen, and superseded.** This field belongs to v1, v2 and v3,
   * and keeps for all three the meaning v1 gave it. It is **not** part of the
   * v4 record: `selectionContextV4` omits it and the record carries
   * `masteryAtTime` beside `conceptIds` instead. Nothing here is edited, because
   * a v1 record on disk keeps the meaning v1 gave it and `upgradeV3` still has
   * to read this field to migrate it.
   *
   * **Why it moved rather than changed type in place (`ol-7328`, `ol-g6zg`).** A
   * v3 record names several concepts, so "the concept's mastery" does not pick
   * out one value: an instrument on two concepts has two mastery states at the
   * moment it is offered. David ruled that mastery is **per concept** — a rating
   * is evidence for every concept the instrument names — and that the
   * per-concept value is **stamped at write time**, never aggregated into one
   * number and never recomputed from history afterwards. Four things then made
   * retyping this field impossible, each independently sufficient:
   *
   * 1. **This object is shared with the frozen versions.** `selectionContext`
   *    is one schema, referenced by `reviewLogRecordV1` and inherited by v2 and
   *    v3 through their derivations. Retyping `masteryAtTime` here retypes it
   *    on v1 — the shape that is never edited again.
   * 2. **v3 has shipped**, in the tagged `0.9.0-alpha.3` build. Changing what a
   *    v3 record's `masteryAtTime` *is* would make two incompatible shapes both
   *    call themselves version 3, and "read the version, never guess" stops
   *    being answerable. So the change is a v4, not an amendment.
   * 3. **A v3 fixture already carries the un-attributable case.** The laptop v3
   *    golden has a review naming two concepts with a single non-null
   *    `masteryAtTime`. Which of the two the recorded state belonged to was
   *    never captured, and assigning it to both invents a fact — which is the
   *    same thing `upgradeV2` refuses to do with the concept list itself. The
   *    golden suite is extended, never pruned, so v4 needed an honest
   *    representation for that case rather than a rewrite of the fixture. It
   *    has one; see `masteryAtTime` below.
   * 4. **The field was in the wrong place**, and this outlives the other three:
   *    a per-concept map keyed by `conceptIds` cannot live *inside* this object,
   *    because this object cannot see `conceptIds` — that field is on the
   *    record, one level up. Keying the two together is a record-level
   *    invariant, so it belongs beside `conceptIds` and not here.
   *
   * The one producer of non-null values at any version is the synthetic corpus
   * generator, whose bands are labelled `synthetic-provisional` for exactly this
   * reason and calibrate nothing. Every *vault* writer has recorded `null` here
   * for the whole life of v1–v3, and omits the v4 field for the same reason:
   * C5.4's rollup does not exist yet.
   */
  masteryAtTime: masteryState.nullable(),
  /** Every instrument type the queue could have offered for this concept. */
  instrumentTypesOffered: z.array(instrumentType),
  /** Version of the study plan that selected this item; null pre-P5 (C7.6). */
  planVersion: z.string().nullable(),
});
export type SelectionContext = z.infer<typeof selectionContext>;

/**
 * One review event, **schema version 1 — FROZEN FOREVER, NEVER EDITED AGAIN.**
 *
 * This shape exists for exactly one purpose: so that a semester of v1 history
 * already written to her vault stays readable. **No writer ever produces it.**
 * The only code that may touch it is the v1 branch of `parse.ts` and the one
 * `upgradeV1` migration in core. If a field here looks wrong, it is still not
 * edited — a v1 record on disk has the meaning this file gave it on the day it
 * was written, and changing that meaning retroactively is exactly the
 * un-backfillable corruption INV-4 exists to prevent. Changes go in a new
 * version, not here.
 *
 * `schemaVersion` is first and mandatory: a semester of records must remain
 * readable across every later change, and the migration path is "read the
 * version, never guess". Two devices appending on the same day must merge
 * cleanly (P2-T03's acceptance), which is why `eventId` exists — it makes an
 * append idempotent and a duplicate detectable without coordination.
 *
 * Note what it does **not** have: a `kind`. v1 could only ever mean "a review
 * happened", and that is precisely the limitation D-020 was raised to remove —
 * a log shape that cannot say what kind of thing happened is a worse foundation
 * than one migration.
 */
export const reviewLogRecordV1 = z.object({
  schemaVersion: z.literal(1),
  /** Stable unique id for this event; makes two-device merges idempotent. */
  eventId: z.string().min(1),
  /** ISO-8601 with offset. The offset matters: "when did she study" is local. */
  timestamp: z.string().datetime({ offset: true }),
  /** The instrument reviewed. Scheduling state is per instrument (R3). */
  instrumentId: z.string().min(1),
  instrumentType,
  /** The concept this instrument practises — the spine (knowledge model §1). */
  conceptId: z.string().min(1),
  /** FSRS rating, or null for explain-back, which produces none (F2.16). */
  rating: rating.nullable(),
  /** True when she tapped "wasn't sure / guessed"; maps MCQ correct → Hard. */
  wasUnsure: z.boolean(),
  /** Milliseconds from presentation to answer; null if not measured. */
  durationMs: z.number().int().nonnegative().nullable(),
  selectionContext,
});
export type ReviewLogRecordV1 = z.infer<typeof reviewLogRecordV1>;

/**
 * One review event, schema version 2 — **FROZEN (D-020). Superseded by v3.**
 *
 * Identical to v1 in every field (derived from it below, so the two cannot
 * drift), plus the `kind` discriminator that makes the log a union of event
 * types rather than a single implicit one.
 *
 * Like v1, this shape now exists so that history already written to her vault
 * stays readable. No writer produces it; the only code that may touch it is the
 * v2 branch of `parse.ts` and core's `upgradeV2`.
 *
 * **`kind` is required, not defaulted, and that is the whole point.** A
 * defaulted discriminator would let a writer omit it and have the reader assume
 * `'review'` — which reintroduces exactly the "cannot say what kind of thing
 * happened" problem this version exists to remove, while looking like it
 * doesn't. A v2 line with no `kind` is a bug in a writer, and it is caught at
 * the boundary rather than silently interpreted.
 */
export const reviewLogRecordV2 = z.object({
  schemaVersion: z.literal(2),
  /** Discriminator. Required, never defaulted — see this object's doc. */
  kind: z.literal('review'),
  // Every remaining v1 field, verbatim and by derivation: "v2 is v1 plus
  // `kind`" is expressed here as code so it cannot become false by editing.
  ...reviewLogRecordV1.omit({ schemaVersion: true }).shape,
});
export type ReviewLogRecordV2 = z.infer<typeof reviewLogRecordV2>;

/**
 * One review event, schema version 3 — **the current review record**
 * (`ol-t3sd`, the D-031 successor).
 *
 * v2 minus `conceptId`, plus `conceptIds`. That is the whole change, and it is
 * expressed below by derivation from v2 so "v3 is v2 with one field swapped"
 * cannot become false by editing.
 *
 * **Why the field had to be persisted, rather than widened in memory only.** A
 * note may carry several `topic:` values; tier-2 extraction mints a concept per
 * value; and evidence is many-to-many everywhere else in the model. So a note
 * genuinely about two concepts is evidence for both. D-031 wanted exactly that
 * and could not have it, because this record held one id — and the interim it
 * settled for, binding each instrument to her *first* listed topic, was a
 * placeholder from the day it was written. Widening only the in-memory queue
 * was considered and declined on its merits: it would change which cards she is
 * offered while still logging one concept, which is faithful nowhere and
 * different everywhere. Ruled 2026-08-14; the ruling's own words are that one
 * instrument may be evidence for every concept its note names.
 *
 * **Key order.** `conceptIds` lands last rather than in `conceptId`'s old slot,
 * because the fields before it are spread wholesale from v2 rather than
 * re-listed here. That is deliberate: re-listing them is how a version bump
 * silently drops a field. Order matters only in that it must be *the same for
 * every v3 record* — `merge.ts` compares duplicate `eventId`s by serialised
 * form — and it is, because every v3 record is produced by this one schema's
 * `parse`, whether it was read natively or migrated.
 */
export const reviewLogRecordV3 = z.object({
  schemaVersion: z.literal(3),
  /** Discriminator. Required, never defaulted — see `reviewLogRecordV2`'s doc. */
  kind: z.literal('review'),
  // Every v2 field except `conceptId`, verbatim and by derivation.
  ...reviewLogRecordV2.omit({ schemaVersion: true, kind: true, conceptId: true }).shape,
  /**
   * Every concept this instrument practises, in the order her note names them
   * — the spine (knowledge model §1), now many-to-many as it is everywhere
   * else in the model.
   *
   * **Non-empty by schema.** An instrument with no concept is invisible to the
   * queue, to the mastery rollup and to every later question; a record that
   * named none would be an un-backfillable hole of exactly the kind INV-4
   * exists to prevent. `session/enumerate.ts` reports such an instrument
   * instead of logging it.
   *
   * The order is hers and is preserved verbatim (R1/R2): nothing here sorts,
   * case-folds or deduplicates it. Consumers that need set semantics — the
   * C5.4 mastery rollup, F2.17's dedupe — build a set themselves and are
   * explicit about doing so.
   */
  conceptIds: z.array(z.string().min(1)).min(1),
});
export type ReviewLogRecordV3 = z.infer<typeof reviewLogRecordV3>;

/**
 * The two suspension events (F2.6's durable half, D-020; semantics settled in
 * ol-p2t08a). Both are append-only facts, never mutations: unsuspending is a
 * *second* event, not a retraction of the first, so the log keeps the whole
 * history of what she stopped and restarted studying.
 */
export const suspendEventKind = z.enum(['suspend', 'unsuspend']);
export type SuspendEventKind = z.infer<typeof suspendEventKind>;

/**
 * What she did with an Olea-drafted instrument (`ol-548w`, INV-6, C5.4).
 *
 * INV-6 requires an accept step before anything AI-generated lands in her
 * vault. Before this, that step existed only as a UI shape — she saw an
 * unticked checkbox — and left no trace once acted on, so INV-6 was enforced
 * by the flow rather than evidenced by anything. `accepted`/`edited` are both
 * a real acceptance (she kept the artifact, with or without changing it
 * first); `rejected` is a real refusal. All three are the ground truth
 * `ol-v0w4`'s end-to-end evaluation needs and none of them existed as data.
 */
export const artifactVerdict = z.enum(['accepted', 'edited', 'rejected']);
export type ArtifactVerdict = z.infer<typeof artifactVerdict>;

/**
 * One suspend or unsuspend event, **schema version 2 — FROZEN. Superseded by
 * `suspendLogRecordV3`.**
 *
 * Append-only JSONL in the vault (C5.2), interleaved in the same files as
 * review records and discriminated by `kind`. Kept, like every superseded
 * version here, so that events already on disk stay readable; no writer
 * produces it, and only `parse.ts`'s v2 branch and core's `upgradeV2` may
 * touch it.
 *
 * The suspended set is a **projection** folded from these events, not a stored
 * list: `core/review-log/suspension.ts` rebuilds it from the log, and the queue
 * excludes it. `SchedulerState` is untouched by suspension (R3) and no marker
 * is written into her notes.
 */
export const suspendLogRecordV2 = z.object({
  schemaVersion: z.literal(2),
  kind: suspendEventKind,
  /** Stable unique id for this event; makes two-device merges idempotent. */
  eventId: z.string().min(1),
  /** ISO-8601 with offset. The offset matters: "when did she study" is local. */
  timestamp: z.string().datetime({ offset: true }),
  /** The instrument suspended or unsuspended. Suspension is per instrument (R3). */
  instrumentId: z.string().min(1),
  /**
   * The concept this instrument practised **at the time of the event**.
   *
   * Included even though suspension, like scheduling, is per instrument (R3):
   * the instrument→concept binding is not reconstructible later if the
   * instrument is edited to point elsewhere or deleted outright. That is the
   * INV-4 argument in its plainest form — a field missing in August is a
   * question ("what did she stop studying?") that cannot be answered in
   * November, and this log cannot be backfilled.
   */
  conceptId: z.string().min(1),
  // Deliberately absent, each for its own reason:
  // - No `rating`, `wasUnsure`, `durationMs`, `selectionContext`: a suspend is
  //   not a review. Forcing it into the review shape means a record where most
  //   fields are null and their nullability stops meaning anything — the
  //   nullable fields above only carry information because they are null for a
  //   *stated* reason (explain-back produces no rating, Phase A has no plan).
  // - No `reason`: CLAUDE.md forbids adopting a capability the contract does
  //   not name. F2.6 does not name a suspension reason and no UI collects one;
  //   adding a persisted field speculatively is the same mistake as omitting a
  //   needed one, and it would be frozen here forever either way.
  // - No `deviceId`: the device is already in the log file path
  //   (`core/review-log/path.ts` — one file per day per device, C5.2), exactly
  //   as it is for review records. `eventId` alone is what makes a two-device
  //   merge idempotent.
});
export type SuspendLogRecordV2 = z.infer<typeof suspendLogRecordV2>;

/**
 * One suspend or unsuspend event, **schema version 3 — the current one**
 * (`ol-t3sd`).
 *
 * v2 with `conceptId` replaced by `conceptIds`, derived from v2 so the two
 * cannot drift. The reason this record carries the binding at all is the reason
 * it has to move in step with the review record: the instrument→concept
 * binding is **not reconstructible later** if the instrument is edited to point
 * elsewhere or deleted outright. Leaving suspension on the singular field would
 * mean the log answered "what did she stop studying?" with one concept and
 * "what did she practise?" with several — for the same instrument, on the same
 * day, in the same file.
 */
export const suspendLogRecordV3 = z.object({
  schemaVersion: z.literal(3),
  // Every v2 field except `conceptId`, verbatim and by derivation. `conceptId`
  // was last in v2, so `conceptIds` lands in the same position.
  ...suspendLogRecordV2.omit({ schemaVersion: true, conceptId: true }).shape,
  /**
   * The concepts this instrument practised **at the time of the event**, in her
   * note's order. Non-empty for the same reason as on the review record, and
   * captured for the reason above: it cannot be recovered afterwards.
   */
  conceptIds: z.array(z.string().min(1)).min(1),
});
export type SuspendLogRecordV3 = z.infer<typeof suspendLogRecordV3>;

/**
 * Every shape a **v2** review-log line can take, discriminated by `kind`.
 *
 * Kept as a named export, not folded into `parse.ts`, because it is what a v2
 * line is validated against before core's `upgradeV2` sees it — the same
 * "validate against the frozen schema for its own declared version" discipline
 * `reviewLogRecordV1` gets.
 */
export const reviewLogEntryV2 = z.discriminatedUnion('kind', [
  reviewLogRecordV2,
  suspendLogRecordV2,
]);
export type ReviewLogEntryV2 = z.infer<typeof reviewLogEntryV2>;

/**
 * Every shape a **current-version** review-log line can take, discriminated by
 * `kind` — the union readers parse v3 lines against.
 *
 * Older records are deliberately *not* members: a reader must read
 * `schemaVersion` first and never guess, then migrate through core's single
 * `upgrade.ts` before anything else sees the record.
 */
export const reviewLogEntryV3 = z.discriminatedUnion('kind', [
  reviewLogRecordV3,
  suspendLogRecordV3,
]);
export type ReviewLogEntryV3 = z.infer<typeof reviewLogEntryV3>;

/**
 * What the system believed about her mastery at the moment it offered her the
 * item — **schema version 4's shape for it** (`ol-7328`'s ruling, drafted in
 * `ol-g6zg`).
 *
 * **Per concept, because there is no honest single number.** A v3+ record names
 * every concept the instrument is evidence for, and each of those concepts has
 * its own mastery at that instant. Every collapse loses the information the
 * field exists for: a mean is a number about no concept, a max or a min
 * silently privileges one, and a designated "primary" concept recreates exactly
 * the pick-one-and-persist-it problem D-031 was raised to end.
 *
 * **Stamped at write time, never recomputed.** The competing design — drop the
 * field and re-derive mastery by replaying the log — was considered and
 * rejected on one ground: this field records what the system **believed when it
 * offered her the item**. A replay under a newer algorithm reproduces today's
 * answer, not the answer that actually governed that day's queue, and
 * `selectionContext` exists precisely to make "did prioritisation change what
 * she studied?" answerable afterwards. A projection is right for *current*
 * mastery and wrong for *mastery at time*.
 *
 * **Two arms, and the second one exists because of a fixture.** The ordinary
 * arm is the map. The `not-attributable` arm is what `upgradeV3` writes for a
 * v3 record that named several concepts and carried one mastery state: the
 * state was really recorded, but which concept it described was never captured,
 * so attributing it to any of them — or to all of them — would invent a fact.
 * The arm keeps the value and declines the attribution, which is the same
 * restraint `upgradeV2` shows toward the concept list itself. **No writer ever
 * produces this arm**; only the migration does.
 *
 * The discriminator is explicit rather than inferred from the object's shape,
 * for the reason every discriminator in this file is: a reader that had to
 * guess which arm it was holding would guess wrong exactly once, permanently,
 * in an append-only log.
 */
const masteryAtTimePerConcept = z.object({
  attribution: z.literal('per-concept'),
  /**
   * One entry per concept the record names, keyed by concept id.
   *
   * Agreement with `conceptIds` is enforced on the **record**
   * (`reviewLogRecordV5`'s `refineMasteryAgreesWithConcepts` refinement,
   * inherited unchanged from v4) and cannot be enforced here: this object
   * cannot see `conceptIds`, which is the structural reason the whole field
   * moved out of `selectionContext`.
   */
  byConcept: z.record(z.string().min(1), masteryState),
});

const masteryAtTimeNotAttributable = z.object({
  attribution: z.literal('not-attributable'),
  /**
   * The state that was on the record, kept verbatim. Its concept is not
   * recoverable and is not guessed at.
   */
  recorded: masteryState,
});

// The two arms are named (module-private) only so `masteryAtTimeV6` below can
// derive from them; the v5 union is the same two objects it always was.
export const masteryAtTime = z.discriminatedUnion('attribution', [
  masteryAtTimePerConcept,
  masteryAtTimeNotAttributable,
]);
export type MasteryAtTime = z.infer<typeof masteryAtTime>;

/**
 * `selectionContext` as **v4** carries it: every v1 field except
 * `masteryAtTime`, which moved up onto the record.
 *
 * Derived by `.omit` rather than re-listed, so "v4's context is v1's context
 * minus one field" is expressed as code and cannot become false by editing —
 * the same discipline every version bump in this file uses. The v1 object
 * itself is untouched and still carries the singular field for v1, v2 and v3.
 */
export const selectionContextV4 = selectionContext.omit({ masteryAtTime: true });
export type SelectionContextV4 = z.infer<typeof selectionContextV4>;

/**
 * Every concept id a record's mastery map must be keyed by, with duplicates in
 * `conceptIds` collapsed to their first occurrence.
 *
 * `conceptIds` is her order, verbatim, and nothing sorts, case-folds or
 * deduplicates it (see `reviewLogRecordV3`'s doc). A map, by construction, can
 * hold a key once — so the set the map is checked against is the deduplicated
 * list, and a record that names the same concept twice is still satisfiable.
 */
function expectedMasteryKeys(conceptIds: readonly string[]): string[] {
  return [...new Set(conceptIds)];
}

/**
 * The record-level invariant v4 exists to make expressible: a per-concept
 * mastery map names **exactly** the concepts the record names.
 *
 * Applied with `superRefine` on the record rather than inside the field,
 * because the field cannot see `conceptIds` — that is point 4 of the argument
 * in `selectionContext.masteryAtTime`'s doc, and half the reason the field
 * moved at all. Both directions are checked and both are real failures: an
 * extra key is a mastery value for a concept this review was not evidence for,
 * and a missing key is a concept the writer had a value for and dropped.
 *
 * Set agreement, deliberately not key *order*. The writer and `upgradeV3` both
 * build the map in `conceptIds` order so that serialisation is canonical
 * (`merge.ts` compares duplicate `eventId`s by serialised form), but JavaScript
 * hoists integer-like keys to the front of an object regardless of insertion
 * order, so an order rule would be unsatisfiable for a numeric concept id and
 * would buy nothing: both paths are hoisted identically.
 */
function refineMasteryAgreesWithConcepts(
  value: {
    readonly conceptIds: readonly string[];
    readonly masteryAtTime?: MasteryAtTime | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const mastery = value.masteryAtTime;
  if (mastery === undefined || mastery.attribution !== 'per-concept') return;

  const expected = expectedMasteryKeys(value.conceptIds);
  const actual = Object.keys(mastery.byConcept);
  const missing = expected.filter((id) => !Object.hasOwn(mastery.byConcept, id));
  const extra = actual.filter((id) => !expected.includes(id));
  if (missing.length === 0 && extra.length === 0) return;

  ctx.addIssue({
    code: 'custom',
    path: ['masteryAtTime', 'byConcept'],
    message:
      'masteryAtTime.byConcept must name exactly the record’s conceptIds' +
      (missing.length > 0 ? `; missing ${JSON.stringify(missing)}` : '') +
      (extra.length > 0 ? `; unexpected ${JSON.stringify(extra)}` : ''),
  });
}

/**
 * Which prompt template and model produced the artifact a verdict is about
 * (D7.3, D-005). The same two fields `responseStamp` (`../worker.ts`) stamps
 * onto a generated artifact client-side; a verdict record repeats them here
 * rather than importing that type, so this record has no compile-time
 * coupling to the Worker envelope beyond the two fields it actually needs.
 *
 * **Why this is not content, and why it is required rather than optional.**
 * D-005 forbids her content, never the provenance of a call that produced an
 * artifact — task id, model id and prompt version are exactly what it
 * enumerates as permitted. Every verdict is about something Olea drafted, so
 * every verdict has a generating call to name; there is no honest case for
 * omitting it, unlike `masteryAtTime` (`ol-g6zg`'s doc above), where absence
 * states a true "not yet computed".
 *
 * **Moved above the v4 record block by `ol-tka5`'s v5 migration** so that
 * `explainBackGrade` below can reference it — it was originally declared
 * between the (now-renamed) suspend and verdict records, where nothing needed
 * it this early.
 */
export const artifactProvenance = z.object({
  /** The task id that produced the draft (`../worker.ts`'s `taskId`, not re-imported — see this object's doc). */
  taskId: z.string().min(1),
  /** VERSION file of the prompt template that produced it (C4.3, D7.3). */
  promptVersion: z.string().min(1),
  /** The model that produced it (C4.6). */
  modelId: z.string().min(1),
});
export type ArtifactProvenance = z.infer<typeof artifactProvenance>;

/**
 * SOLO taxonomy level (Biggs & Collis 1982; `GLOSSARY.md` "SOLO taxonomy"),
 * the wire encoding of R9's grading verdict (`ol-tka5`). Five levels, never
 * fewer — R9's whole argument against a binary correct/incorrect field is
 * that a flat verdict cannot express "separate ideas integrated under a
 * principle" versus "listed alongside one another," which is exactly what
 * the depth gate (R7) tests for. Internal vocabulary only — GLOSSARY's SOLO
 * rule 5 is explicit that level names are never exposed to the student; the
 * vocabulary registry's growth-stage display (seed/sprout/sapling/tree) is
 * the only SOLO-derived thing she ever sees, and it is derived from this by
 * the mastery fold, not stored here twice.
 */
export const soloLevel = z.enum([
  'prestructural',
  'unistructural',
  'multistructural',
  'relational',
  'extended-abstract',
]);
export type SoloLevel = z.infer<typeof soloLevel>;

/**
 * The support ladder a review was shown at (`[D-094]`), objectively —
 * "record what was shown, never what she said" (principle 16, F2.20). Three
 * tiers, matching D-094's ruling exactly: independent (no support), prompted
 * (targeted hint on demand), guided (source expandable, elaboration prompt on
 * incomplete answers). The reduced-difficulty variant D-094 explicitly
 * excludes from the ladder is not a fourth value here for the same reason it
 * is not a fourth rung there — a different question is a different
 * instrument, not a support level.
 *
 * Recognition-tier reviews (MCQ) have no ladder (D-094 item 4) — not
 * schema-enforced, the same choice `rating`'s doc makes for `easy` being
 * absent at MCQ by rule rather than by narrower type: the log records what
 * happened, and encoding every domain invariant as a union would make a real
 * bug (an MCQ review wrongly stamped with a support level) unloggable.
 */
export const supportLevel = z.enum(['independent', 'prompted', 'guided']);
export type SupportLevel = z.infer<typeof supportLevel>;

/**
 * The explain-back correctness judge's three verdicts (`[D-281]`) — declared
 * once and used by both homes the verdict has had: the nested
 * `explainBackGrade.correctness` (v5) and the top-level
 * `explainBackCorrectness.verdict` (v6, `[D-303]`), so a reader that meets
 * either can never meet a fourth value in one of them.
 */
export const explainBackCorrectnessVerdict = z.enum(['correct', 'partial', 'incorrect']);
export type ExplainBackCorrectnessVerdict = z.infer<typeof explainBackCorrectnessVerdict>;

/**
 * The grading verdict for one explain-back review (`ol-tka5`) — R9's "the
 * grader emits a SOLO verdict" made a persisted fact. Present only on
 * `review`-kind records whose `instrumentType` is `'explain-back'` (enforced
 * below by `refineExplainBackGradeInstrumentType`); absent everywhere else,
 * the same "true absence, not a placeholder" discipline `masteryAtTime`
 * established at v4 — nothing writes this for a declined or abandoned
 * explain-back attempt, and nothing should default it. **A production
 * writer exists**: `recordGradedExplainBackReview`
 * (`packages/core/src/study-session/explain-back-grade-write.ts`,
 * `ol-95vv.3`) composes and appends this field, reached in production
 * through `ExplainBackModal`'s accept flow (`ol-cqz8`) via `main.ts`'s
 * `recordExplainBackSoloGradeAndReview` (`ol-38kp`) — all closed since
 * 2026-09-01.
 */
export const explainBackGrade = z.object({
  /** The SOLO level this response reached. Never a number, never averaged — GLOSSARY rule 3. */
  soloLevel,
  /**
   * **The INDEPENDENT correctness verdict for this same attempt (`[D-281]`,
   * `ol-95vv.10`).** The explain-back judge's own correct/partial/incorrect
   * classification of the answer, persisted here so the mastery fold can
   * combine it with `soloLevel` — which is produced by a separate assessor,
   * blind to this field, and stays that way. R9's argument against a FLAT
   * verdict is untouched: this is not a replacement for `soloLevel`, it is
   * the second of two independent readings of one attempt, and neither is
   * derived from the other.
   *
   * **Optional, and absence means UNKNOWN — never `correct`.** Every record
   * written before this field existed carries no verdict at all, and
   * `[D-281]` rules that such a record can never newly qualify the top
   * growth stage. Defaulting it, or letting a reader treat absence as
   * success, is the one way this field can do harm; the fold's own gate
   * (`packages/core/src/mastery/rollup.ts`) tests for the literal
   * `'correct'` and nothing else.
   *
   * D-005 is untouched: this is a three-value classification, never her
   * answer text or the grader's rationale — both of those stay behind
   * `contentRef`.
   *
   * **Its v6 successor is `explainBackCorrectness` (`[D-303]`).** The ruling
   * gives the verdict its own top-level field with its own stamp, because
   * nested here it can only be recorded when a depth grade also exists. Once
   * v6 is current, new writes go there; this nested field stays in the v6
   * shape, unchanged, only so a record that already carries one keeps it
   * verbatim through the v5 → v6 hop, and `reviewLogRecordV6` refuses a
   * record carrying both.
   */
  correctness: explainBackCorrectnessVerdict.optional(),
  /**
   * Opaque reference into the `[D-077]` / `ol-2jod.8` immutable content
   * store — her answer text, the grader's feedback, and any misconception
   * detail, kept as immutable files Olea owns, referenced by id, never
   * inline. This is the field that makes R9's "recomputed when the grading
   * rule changes, and shown to her with the evidence that produced it"
   * actually honourable: the verdict alone cannot be replayed, the
   * referenced content can. D-005 is satisfied because the pointer itself is
   * an opaque identifier, structurally identical to every other id already
   * in this file — it is never the text.
   */
  contentRef: z.string().min(1),
  /**
   * The `eventId` of a PRIOR review event this one re-grades — set only when
   * the grading pipeline is explicitly re-run against previously-recorded
   * content (a rubric or prompt version change), never for a fresh attempt
   * at the same concept. This is the "revision" item from David's six;
   * "supersession" — the sixth — is deliberately NOT a separate field or
   * event: GLOSSARY defines depth as "the SOLO level of the MOST RECENT
   * graded explain-back for the concept," a read-time chronological
   * resolution the fold already needs (ordering by `(timestamp, eventId)`),
   * so a plain new attempt superseding an old one needs no field at all.
   * `revisionOf` exists only for the narrower case ordering alone cannot
   * distinguish: a re-grade of the *same* recorded answer under a changed
   * rubric, as opposed to a genuinely new attempt.
   *
   * **A fold input, not a stamp.** The mastery and attainment folds read it
   * for supersession (`[D-281]`: a corrective re-grade disqualifies the
   * attempt it names — `packages/core/src/mastery/rollup.ts` and
   * `mastery/attainment.ts`), so it is NOT covered by knowledge model §8 test
   * 5 (strip-invariance), which strips scheduling observations and stamped
   * beliefs only. Stripping it would change the readings, correctly.
   */
  revisionOf: z.string().min(1).nullable(),
  /**
   * Which prompt template and model produced THIS grade (D7.3, D-005) —
   * distinct from any `artifactProvenance` on a `verdictLogRecord`, which
   * stamps the DRAFTING call, not the grading call. Reused rather than
   * redeclared, same reasoning as `verdictLogRecordV5`'s own field.
   */
  artifactProvenance,
});
export type ExplainBackGrade = z.infer<typeof explainBackGrade>;

/**
 * Her demonstrated correct use of a neighbour concept while the SUBJECT
 * concept was the one being scored (`[D-087]`, C5.11, MAT-4's
 * `SchedulingObservation`, `ol-tka5`). Marks the reciprocal prompt as likely
 * to succeed; NEVER scores `neighbourConceptId`, never moves its stage or
 * vitality — C5.11's exception-free rule against a second scoring target.
 * Present only when the grading pipeline found demonstrated use; absent
 * otherwise.
 *
 * **Kind-general, not explain-back-only (`[D-185]`, `ol-0r92.41`).** F5.3a
 * was widened from "while explaining X" to any item kind: wherever an item's
 * scoring subject is X and a neighbour concept Y appeared as context, Y's
 * demonstrated use lands here regardless of `instrumentType`. This field's
 * shape does not change — it never carried an `instrumentType` or
 * discriminant of its own — only `refineExplainBackGradeInstrumentType`
 * below, which used to gate its presence to `explain-back`, no longer does.
 *
 * **The mastery fold must never read this field.** Knowledge model §8 test 5
 * (strip-invariance) is the contract test: folding a log and a copy of it
 * with every `schedulingObservation` and every stamped belief
 * (`masteryAtTime`) stripped must produce byte-identical scoring readings,
 * for a log built from any mix of instrument kinds. (`explainBackGrade
 * .revisionOf` is not in that set: the fold reads it for supersession — see
 * its own doc.) Exclusion is enforced by no fold function
 * importing this field, not by filtering an event kind — the same mechanism
 * the knowledge model already names for this exact type.
 */
export const schedulingObservation = z.object({
  /** The concept her demonstrated use was evidence about — never conceptIds[0], never scored. */
  neighbourConceptId: z.string().min(1),
});
export type SchedulingObservation = z.infer<typeof schedulingObservation>;

/**
 * `explainBackGrade` may only appear on an explain-back review — SOLO grades
 * a response, and only an explain-back response is gradable (GLOSSARY SOLO
 * rule 2).
 *
 * **`schedulingObservation` is deliberately NOT restricted here.** It used to
 * be, alongside `explainBackGrade`, until `[D-185]` (`ol-0r92.41`) widened
 * F5.3a/C5.11 from explain-back-only to any instrument kind: a neighbour
 * concept's demonstrated use may now ride the review event of an MCQ, Q&A or
 * cloze review exactly as it can an explain-back one. Only `explainBackGrade`
 * still names a SOLO verdict, which only an explain-back response can earn —
 * that half of the old rule survives unchanged.
 *
 * Applied with `superRefine` on the record, the same pattern as
 * `refineMasteryAgreesWithConcepts` — kept even though only one field is
 * checked now, so a future field needing the same "explain-back only" gate
 * has a place to land beside this one.
 */
function refineExplainBackGradeInstrumentType(
  value: {
    readonly instrumentType: InstrumentType;
    readonly explainBackGrade?: ExplainBackGrade | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.instrumentType === 'explain-back') return;
  if (value.explainBackGrade !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['explainBackGrade'],
      message: 'explainBackGrade may only appear on an explain-back review',
    });
  }
}

/**
 * `schedulingObservation.neighbourConceptId` must never be a member of the
 * record's own `conceptIds` — it is explicitly the concept NOT being scored
 * (C5.11); a record naming its own subject as its neighbour observation would
 * be the second-scoring-target bug R9/C5.11 forbid, caught structurally
 * rather than trusted to a caller.
 */
/**
 * An MCQ review's behavioural correctness (`[D-205 / SIG-2]`, `ol-yj0k`,
 * `ol-egov.96`) — which option she chose and whether it matched the key,
 * captured alongside the self-reported rating rather than discarded once
 * `mapMcqRating` has used it. **Never content** (D-005): an index and a
 * boolean, never the option's text, stem or concept wording. Present only
 * on a graded MCQ review; absent on every other instrument kind and on every
 * pre-`[D-205]` MCQ record — a reader treats absence as "signal not
 * captured," never as "incorrect." Additive on v5, no `schemaVersion` bump,
 * same reasoning `[D-178]` applied to `schedulingObservation` above. Read by
 * nothing until a named consumer (the effort or misconception insight) cites
 * it — the rating mapping this rides beside is unchanged.
 */
export const mcqCorrectness = z.object({
  /** The option index she chose (0-based, matching `McqItem.options`). */
  chosenIndex: z.number().int().min(0),
  /** Whether `chosenIndex` matched the key. */
  matchedKey: z.boolean(),
});
export type McqCorrectness = z.infer<typeof mcqCorrectness>;

/**
 * `correctness` may only appear on an `instrumentType: 'mcq'` review — the
 * same "shape enforces the restriction the field's own doc states" pattern
 * `refineExplainBackGradeInstrumentType` above uses for `explainBackGrade`.
 */
function refineCorrectnessInstrumentType(
  value: {
    readonly instrumentType: InstrumentType;
    readonly correctness?: McqCorrectness | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.instrumentType === 'mcq') return;
  if (value.correctness !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['correctness'],
      message: 'correctness may only appear on an mcq review',
    });
  }
}

/**
 * How an explain-back answer was composed (`[D-228 / SIG-3]`, `ol-gzhp`,
 * `ol-egov.115`), captured alongside the grade rather than discarded once
 * composed. **Never content** (D-005): two integers, never the answer text,
 * a diff of successive drafts, or a per-key stream with timings — any of
 * which would be reconstructable toward what she wrote and so is content for
 * D-005's purposes, the same way document metadata is content per
 * `ol-pdfmeta`. `firstEditMs` is milliseconds from presentation to the first
 * input event — the one part of latency `durationMs` cannot separate on its
 * own. `editBursts` is a count of distinct composing sessions, never a
 * per-keystroke count (that option, `keystrokeCount`, was REJECTED by
 * `[D-228]`).
 *
 * **Absence means "not captured," never "she made no edits"** — the same
 * reader rule `mcqCorrectness`'s own doc states, restated here rather than
 * left implicit because a seventh optional field is exactly where a reader
 * skimming the shape could default to the wrong reading. Present only on a
 * graded explain-back review (the only free-text answering surface in
 * either repo — Q&A, cloze and MCQ are reveal-then-self-rate or one-click,
 * with no textarea anywhere, so they are N/A BY CONSTRUCTION, not "not
 * wired yet"). Additive on v5, no `schemaVersion` bump, the same reasoning
 * `[D-178]` applied to `schedulingObservation` and `[D-205]` to
 * `correctness` above.
 *
 * **Never live-displayed** (`ol-9a7z`): the capturing surface must never
 * show her a running count or timer while she composes — a visible counter
 * would change how she writes and manufacture the very behaviour it
 * measures. That is a constraint on the capturing UI, not on this schema,
 * but it is the reason this field may exist at all under the cognitive-
 * offloading check, so it is recorded here too.
 *
 * Read by nothing until a named consumer (the miscalibration triangulation
 * — does laboured composition co-occur with a lower `explainBackGrade
 * .soloLevel` than the self-rating implies) is built; `[D-228]`'s own
 * revisit condition removes the field if a year passes with no consumer.
 * TUNE-1 (`ol-uiel`) may NEVER read this field to fit a constant — it fits
 * on public multi-user corpora, which carry no edit behaviour, and
 * principle 17 as amended by `[D-078]` forbids her own history from setting
 * any constant.
 */
export const answerEdits = z.object({
  /** Milliseconds from presentation to the first `'input'` event, or `null` if no input ever fired since presentation (she submitted an untouched, discard-preserved answer). */
  firstEditMs: z.number().int().nonnegative().nullable(),
  /** How many distinct composing sessions produced this answer — never a per-keystroke count. */
  editBursts: z.number().int().nonnegative(),
});
export type AnswerEdits = z.infer<typeof answerEdits>;

/**
 * `answerEdits` may only appear on an `instrumentType: 'explain-back'`
 * review — the same "shape enforces the restriction the field's own doc
 * states" pattern `refineExplainBackGradeInstrumentType` and
 * `refineCorrectnessInstrumentType` above use for their own fields. Q&A,
 * cloze and MCQ have no free-text answering surface to edit at all.
 */
function refineAnswerEditsInstrumentType(
  value: {
    readonly instrumentType: InstrumentType;
    readonly answerEdits?: AnswerEdits | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.instrumentType === 'explain-back') return;
  if (value.answerEdits !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['answerEdits'],
      message: 'answerEdits may only appear on an explain-back review',
    });
  }
}

function refineSchedulingObservationNotSubject(
  value: {
    readonly conceptIds: readonly string[];
    readonly schedulingObservation?: SchedulingObservation | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const observation = value.schedulingObservation;
  if (observation === undefined) return;
  if (value.conceptIds.includes(observation.neighbourConceptId)) {
    ctx.addIssue({
      code: 'custom',
      path: ['schedulingObservation', 'neighbourConceptId'],
      message:
        'schedulingObservation.neighbourConceptId must not be one of the record’s own ' +
        'conceptIds — it is the concept NOT being scored (C5.11)',
    });
  }
}

/**
 * One review event, **schema version 5 — the current review record**
 * (`ol-tka5`, ratified `[D-117]`).
 *
 * v4 plus three fields, all optional (see this file's header for why they
 * are optional rather than required-nullable): `supportLevelShown` (every
 * recall/explanation review, D-094), `explainBackGrade` (explain-back
 * reviews only, R9/GLOSSARY SOLO), `schedulingObservation` (a review of any
 * kind naming a neighbour concept as context, D-087, widened from
 * explain-back-only by `[D-185]`). Migrated IN PLACE per `[D-109]`: v4 is
 * not retained as a frozen, readable historical version — no real v4 record
 * exists anywhere (prod dark, no BRAT install, `[D-109]`'s own expiry test),
 * so there is nothing to stay compatible with. `reviewLogRecordV4`,
 * `suspendLogRecordV4` and `verdictLogRecordV4` are renamed to V5
 * (suspend/verdict: version bump only, no shape change — the "one version
 * per line" rule `suspendLogRecordV5`'s own doc states forces every kind in
 * the union to move together).
 *
 * Everything through `masteryAtTime` is derived from v4 exactly as v4 was
 * derived from v3, so "v5 is v4 plus these fields" cannot become false by
 * editing.
 */
export const reviewLogRecordV5 = z
  .object({
    schemaVersion: z.literal(5),
    /** Discriminator. Required, never defaulted — see `reviewLogRecordV2`'s doc. */
    kind: z.literal('review'),
    // Every v3 field, verbatim and by derivation.
    ...reviewLogRecordV3.omit({ schemaVersion: true, kind: true }).shape,
    // Re-declared, not appended: an object literal that re-assigns an existing
    // key keeps that key's original position, so `selectionContext` stays where
    // v3 put it while losing the field that moved up here.
    selectionContext: selectionContextV4,
    /**
     * What the system believed about each named concept's mastery when it
     * offered this item. Absent means it was not recorded — which is what every
     * writer means today, because C5.4's rollup does not exist yet.
     */
    masteryAtTime: masteryAtTime.optional(),
    /**
     * Objective support level presented (principle 16, F2.20, `[D-094]`).
     * Optional, not required-nullable — a production writer exists
     * (`packages/plugin/src/review/ports.ts`'s `createVaultReviewLogPort`,
     * `[SUPP-2]`/`ol-95vv.4`), but it merges the field only when the item
     * carried a chooser decision (absent for MCQ, out of D-094's ladder
     * scope, and for any caller not yet wired to the chooser); this file's
     * header explains why that differs from the design draft's literal
     * schema.
     */
    supportLevelShown: supportLevel.optional(),
    /** Present only for graded explain-back reviews. Written in production by `recordGradedExplainBackReview` (`ol-95vv.3`), reached via `ExplainBackModal`'s accept flow (`ol-cqz8`, `ol-38kp`) — see this field's own doc above for the chain. */
    explainBackGrade: explainBackGrade.optional(),
    /**
     * Present only when this review — of ANY instrument kind, `[D-185]` —
     * demonstrated use of a neighbour concept named as context.
     */
    schedulingObservation: schedulingObservation.optional(),
    /**
     * Present only for a graded MCQ review (`[D-205 / SIG-2]`). See
     * `mcqCorrectness`'s own doc for the privacy and additive-schema
     * reasoning.
     */
    correctness: mcqCorrectness.optional(),
    /**
     * Present only for a graded explain-back review (`[D-228 / SIG-3]`). See
     * `answerEdits`'s own doc for the privacy, gating and no-live-display
     * reasoning.
     */
    answerEdits: answerEdits.optional(),
  })
  .superRefine(refineMasteryAgreesWithConcepts)
  .superRefine(refineExplainBackGradeInstrumentType)
  .superRefine(refineSchedulingObservationNotSubject)
  .superRefine(refineCorrectnessInstrumentType)
  .superRefine(refineAnswerEditsInstrumentType);
export type ReviewLogRecordV5 = z.infer<typeof reviewLogRecordV5>;

/**
 * One suspend or unsuspend event, **schema version 5 — the current one**.
 *
 * Identical to v4 in every field, derived from it (renamed forward per
 * `[D-109]`, `ol-tka5` — v4 is not retained), with only the version stamped
 * forward. Nothing about the v5 ruling touches a suspension: a suspend is not
 * a review and carries no `selectionContext`, so it has no mastery, support
 * level or grade to attribute.
 *
 * It moves anyway, and that is the point of moving it. `schemaVersion` is read
 * per *line*, and the record types share one daily file, so a build that wrote
 * v5 reviews beside v4 suspensions would be asking every reader — now and in a
 * semester — to hold two current versions at once. One version per line, one
 * current version.
 */
export const suspendLogRecordV5 = z.object({
  schemaVersion: z.literal(5),
  // Every v3 field, verbatim and by derivation. (v4 made no shape change to
  // this record, so deriving from v3 directly — as v4 itself did — is
  // identical to deriving from the now-retired v4.)
  ...suspendLogRecordV3.omit({ schemaVersion: true }).shape,
});
export type SuspendLogRecordV5 = z.infer<typeof suspendLogRecordV5>;

/**
 * One accept/edit/reject verdict, **schema version 5** (`ol-548w`, INV-6;
 * renamed forward from v4 by `ol-tka5`/`[D-109]` — no shape change).
 *
 * A third `kind`, additive to the discriminated union exactly the way
 * `suspend`/`unsuspend` were additive at v2 (D-020) — the v4→v5 bump moves
 * this kind forward only because `[D-109]` requires every kind in the union
 * to share one current version (`suspendLogRecordV5`'s doc), not because
 * anything about its shape changed. Lives in the same daily file as reviews
 * and suspensions (C5.2), append-only: a verdict is a fact about a moment,
 * never revised in place — re-drafting after a reject is a new instrument
 * with its own future verdict, not an edit to this one.
 *
 * **Keyed on `conceptIds`, the opaque join key (C7.11, `[D-088]`, `[D-109]`,
 * `ol-il6m`).** This is a brand-new writer with no legacy record to stay
 * consistent with, so it keys on `ConceptRecord.key` from day one rather than
 * inheriting the display-name join `reviewLogRecordV5.conceptIds` still
 * carries today (see `olea-core`'s `session/enumerate.ts` for why that one
 * has not flipped yet). A future coordinated flip of the review/suspend
 * mint sites does not have to touch this shape at all.
 *
 * **No content, per D-005.** `verdict` and `artifactProvenance` are exactly
 * what INV-6's oracle needs — what she decided, and which generating call
 * produced the thing she decided about — and neither carries her text.
 */
export const verdictLogRecordV5 = z.object({
  schemaVersion: z.literal(5),
  /** Discriminator. Required, never defaulted — see `reviewLogRecordV2`'s doc. */
  kind: z.literal('verdict'),
  /** Stable unique id for this event; makes two-device merges idempotent. */
  eventId: z.string().min(1),
  /** ISO-8601 with offset. The offset matters: "when did she decide" is local. */
  timestamp: z.string().datetime({ offset: true }),
  /** The instrument this verdict is about. */
  instrumentId: z.string().min(1),
  instrumentType,
  /**
   * Every concept this instrument was drafted for, in the order the drafting
   * pass named them. Non-empty for the same reason `reviewLogRecordV3`'s
   * field is: an instrument with no concept is invisible to every later
   * question, and a record naming none would be an un-backfillable hole.
   */
  conceptIds: z.array(z.string().min(1)).min(1),
  verdict: artifactVerdict,
  artifactProvenance,
});
export type VerdictLogRecordV5 = z.infer<typeof verdictLogRecordV5>;

/**
 * One succession event, **schema version 5** (`[D-133]`, `ol-w00s` /
 * `ol-2zfj.37`). A fourth `kind`, additive to the discriminated union
 * exactly the way `verdict` was additive at v4/v5 (this record's own doc
 * comment above) — no version bump, because nothing about the *shape* the
 * union already carries changes; a new literal `kind` value is exactly
 * what "additive" means here.
 *
 * **Records only the FACT of succession — never a copy of the chain.**
 * Which instrument superseded which, and when: nothing else. The
 * metadata-position `predecessor:` field on the successor's own instrument
 * block (`packages/core/src/instrument/mcq-format.ts`'s
 * `MCQ_FIELD_PREDECESSOR`, and the plugin's block-agnostic
 * `instrument-blocks/predecessor.ts`) is the single source of truth for the
 * chain itself; this event exists so "was this instrument superseded, and
 * by what" is answerable from the log alone, the same way
 * `suspendLogRecordV5` already answers "was this instrument suspended" —
 * see that record's own doc for why a log-side fact still earns its place
 * beside a block-side field that could, in principle, be walked instead.
 *
 * **No `instrumentType`, no `conceptIds`.** Unlike `verdictLogRecordV5`,
 * this is not a judgment about an instrument's content and does not need
 * the concept binding a verdict or suspend event needs to answer "what did
 * she stop studying" — a successor's own verdict/suspend records (if any)
 * already carry that. Widening this record to duplicate them would be the
 * exact copy this record's doc says it deliberately is not.
 *
 * **No content, per D-005.** Both ids are opaque instrument identifiers.
 */
export const successionLogRecordV5 = z.object({
  schemaVersion: z.literal(5),
  /** Discriminator. Required, never defaulted — see `reviewLogRecordV2`'s doc. */
  kind: z.literal('succession'),
  /** Stable unique id for this event; makes two-device merges idempotent. */
  eventId: z.string().min(1),
  /** ISO-8601 with offset. The offset matters: "when did succession happen" is local. */
  timestamp: z.string().datetime({ offset: true }),
  /** The instrument this succeeds — the one the successor now supersedes. */
  predecessorInstrumentId: z.string().min(1),
  /** The freshly-materialized successor's own id. */
  successorInstrumentId: z.string().min(1),
});
export type SuccessionLogRecordV5 = z.infer<typeof successionLogRecordV5>;

/**
 * `[D-095]`'s three kinds a claim can be — the effect on a contest is fixed
 * by which of these the disputed claim was, never by what she picked
 * (`disputeLogRecordV5`'s own doc).
 *
 * `unsorted` is a fourth, added by `[D-215]` (`ol-egov.103`): the claim kind
 * used exactly when the disputed rendering's routing row is still `open` —
 * the tap still records, the effect is `held` (nothing moves, nothing is
 * invented), and `unsorted` names that no ruled kind has claimed the line
 * yet, never that the record itself is malformed.
 */
export const contestedClaimKind = z.enum(['reading', 'structural', 'grade', 'unsorted']);
export type ContestedClaimKind = z.infer<typeof contestedClaimKind>;

/**
 * What the contest did at the moment she made it. Stored rather than derived
 * so a record stays readable if the routing table ever changes: what
 * happened to her claim is a fact about that moment.
 *
 * `returned-to-candidate` is deliberately not called deletion or removal —
 * vocabulary registry §3's hard clamp, and the ruled mechanic besides: the
 * claim entered service through her confirmation and a contest withdraws
 * that confirmation.
 */
export const contestEffect = z.enum(['held', 'returned-to-candidate', 'quarantined']);
export type ContestEffect = z.infer<typeof contestEffect>;

/**
 * The eleven persisted renderings, matching `olea-core`'s
 * `review-log/contest.ts` `CLAIM_ROUTING` — every `ClaimRendering` except
 * `declared-fact`, which is never a contest at all and never reaches this
 * schema. Six are routed to a ruled `[D-095]` kind; five widened in by
 * `[D-215]` (`ol-egov.103`) carry `claimKind: 'unsorted'` and
 * `routingStatus: 'open'` instead — DSN-1's open questions 6-10, recorded
 * rather than refused now that a claim on one of them is still recordable.
 */
export const contestedClaimRendering = z.enum([
  'mastery-reading',
  'cross-term-recognition',
  'retrospective-reading',
  'concept-relation-edge',
  'cross-course-match',
  'explain-back-grade',
  'trend-sentence',
  'study-plan-ranking',
  'refusal',
  'vault-freshness-line',
  'generated-explanation',
]);
export type ContestedClaimRendering = z.infer<typeof contestedClaimRendering>;

/**
 * Whether a dispute record's resolution fields are present together or
 * absent together — a resolving dispute carries both `resolves` and
 * `outcome`; an opening one carries neither. Half of either pair would leave
 * the acknowledgment `[D-095]` §2 requires with nothing to point at.
 */
function refineDisputeResolutionPairing(
  value: {
    readonly resolves?: string | undefined;
    readonly outcome?: 'upheld' | 'corrected' | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const hasResolves = value.resolves !== undefined;
  const hasOutcome = value.outcome !== undefined;
  if (hasResolves === hasOutcome) return;
  ctx.addIssue({
    code: 'custom',
    path: hasResolves ? ['outcome'] : ['resolves'],
    message:
      'a resolving dispute record carries both `resolves` and `outcome`, and an opening one ' +
      'carries neither',
  });
}

/**
 * `[D-215]`'s pairing: `routingStatus: 'open'` is present exactly when
 * `claimKind` is `'unsorted'`, and absent for the three ruled kinds. Modelled
 * on `refineDisputeResolutionPairing` immediately above — a field that only
 * means something alongside a specific sibling value is exactly the shape
 * that pairing already guards.
 */
function refineOpenRoutingPairing(
  value: {
    readonly claimKind: ContestedClaimKind;
    readonly routingStatus?: 'open' | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const isUnsorted = value.claimKind === 'unsorted';
  const hasRoutingStatus = value.routingStatus !== undefined;
  if (isUnsorted === hasRoutingStatus) return;
  ctx.addIssue({
    code: 'custom',
    path: ['routingStatus'],
    message:
      '`routingStatus` is present exactly when `claimKind` is `unsorted`, and absent for the ' +
      'three ruled kinds',
  });
}

/**
 * One dispute event, schema version 5 — a fifth `kind` in the review log's
 * daily file (C5.2), append-only. `[D-046]` clause 4's "recorded either
 * way", shaped by `[D-095]` (`ol-egov.19`).
 *
 * **Moved here from `olea-core`'s `review-log/contest-record.ts`
 * (`ol-qs72`), additive to the discriminated union exactly the way
 * `successionLogRecordV5` was — no version bump, because nothing about the
 * shape the union already carries changes; a new literal `kind` value is
 * what additive means here.** `ol-fgba` [DISP-1] originally built this
 * record in core because that lane did not own `packages/contracts/` and
 * `olea-core` deliberately has no zod dependency; the wire shape is
 * byte-identical to what that lane shipped — this is a paste plus a union
 * member, not a redesign.
 *
 * **No content, per D-005.** What she disputed, which kind of claim it was,
 * which concepts and instrument it concerned, what the contest did, and an
 * opaque fingerprint of the evidence the claim rested on. Never her wording,
 * never the rendered sentence, never a reason she typed — and deliberately
 * **no reason field at all**, because `[D-095]` fixes the effect by what she
 * touched and never by what she picked.
 *
 * **Append-only, like every other record in this file family.** A
 * resolution is a SECOND dispute record carrying `resolves` (the opening
 * event's id) and `outcome` — never an edit to the first. That is what
 * makes the compensating event `[D-095]` §2 requires able to name her
 * contest as its catalyst: a real, durable event id, written where she can
 * see it.
 *
 * **`routingStatus` is additive, ruled by `[D-215]` (`ol-egov.103`).** A
 * dispute on one of the five renderings the routing table still leaves open
 * carries `claimKind: 'unsorted'` and `routingStatus: 'open'`; `effect` is
 * still `held` — nothing moves and nothing is invented. A later ruling that
 * routes the rendering does not rewrite these records: a recorded-open
 * dispute may be acknowledged but never acted on retroactively. Absent for
 * the three ruled kinds, exactly as before this widening.
 */
export const disputeLogRecordV5 = z
  .object({
    schemaVersion: z.literal(5),
    /** Discriminator. Required, never defaulted — see `reviewLogRecordV2`'s doc. */
    kind: z.literal('dispute'),
    /** Stable unique id; makes two-device merges idempotent, and is the catalyst id. */
    eventId: z.string().min(1),
    /** ISO-8601 with offset. The offset matters: "when did she disagree" is local. */
    timestamp: z.string().datetime({ offset: true }),
    claimKind: contestedClaimKind,
    claimRendering: contestedClaimRendering,
    /**
     * Every concept the claim was about. Non-empty for the same reason
     * `verdictLogRecordV5.conceptIds` is: a dispute naming no concept is
     * invisible to every later question.
     */
    conceptIds: z.array(z.string().min(1)).min(1),
    /** Present for a grade, and for a structural claim that names an instrument. */
    instrumentId: z.string().min(1).optional(),
    /**
     * Opaque fingerprint of the evidence the claim rested on when she
     * disputed it — the hinge of evidence-relative aging (`[D-095]` §3).
     * Never a copy of the evidence, and never her text.
     */
    evidenceBasis: z.string().min(1),
    effect: contestEffect,
    /** The opening dispute this record resolves. Absent on an opening dispute. */
    resolves: z.string().min(1).optional(),
    /** How the re-derivation landed. Present exactly when `resolves` is. */
    outcome: z.enum(['upheld', 'corrected']).optional(),
    /**
     * The single literal `'open'`, present exactly when `claimKind` is
     * `'unsorted'` (`[D-215]`) — see this record's own doc above. Never a
     * reason field: it names the routing state, not what she picked.
     */
    routingStatus: z.literal('open').optional(),
  })
  .superRefine(refineDisputeResolutionPairing)
  .superRefine(refineOpenRoutingPairing);
export type DisputeLogRecordV5 = z.infer<typeof disputeLogRecordV5>;

/**
 * The three retrospective-offer events (`[D-134]` Q5, F8.8) — additive to
 * the discriminated union the same way `suspendLogRecordV5` is: one record
 * shape spanning three `kind` literals (`suspendEventKind`'s own pattern)
 * rather than three near-identical shapes, because "offered", "opened" and
 * "dismissed" carry the same two fields and differ only in which happened.
 *
 * **`[D-134]` Q5's own words: "offer/open/dismiss are ordinary events in
 * the local event log... no new storage, second device converges."**
 * `ol-r68l`'s round-27 build shipped an interim per-install store
 * (`packages/plugin/src/retrospective/offer-store.ts`'s `data.json`
 * pattern) because this file sat outside that lane's ownership —
 * `ol-0r92.16` is the follow-up that lands the ruling's own mechanism and
 * retires the interim store. The review log is the "local event log" the
 * ruling names: the same append-only, per-device-per-day file every other
 * kind in this union already lives in (C5.2), so a second device converges
 * on the same offer/open/dismiss history the ordinary merge-by-`eventId`
 * discipline (`./merge.ts`) already gives every other kind.
 *
 * **No separate family.** The ruling's own wording — "ordinary events in
 * the local event log" — names the review log itself, not a new log
 * alongside it; a second event family would need its own append/merge/parse
 * discipline this project already has and gains nothing by duplicating.
 *
 * **`kind` carries the vocabulary D-134's ruling itself uses** —
 * `'retrospective-offered' | 'retrospective-opened' | 'retrospective-dismissed'`
 * — matching `olea-core`'s pre-existing `RetrospectiveOfferEvent['kind']`
 * exactly, so a reviewLogEntry of this shape and a `RetrospectiveOfferEvent`
 * are structurally the same object (the extra `schemaVersion`/`eventId` on
 * the persisted record are simply ignored by code that only reads the three
 * fields `RetrospectiveOfferEvent` names).
 *
 * **No content, per D-005.** `assessmentPath` is the vault path of the
 * assessment note the offer concerns — a location, not her wording about
 * it.
 */
export const retrospectiveOfferEventKind = z.enum([
  'retrospective-offered',
  'retrospective-opened',
  'retrospective-dismissed',
]);
export type RetrospectiveOfferEventKind = z.infer<typeof retrospectiveOfferEventKind>;

export const retrospectiveOfferLogRecordV5 = z.object({
  schemaVersion: z.literal(5),
  kind: retrospectiveOfferEventKind,
  /** Stable unique id; makes two-device merges idempotent. */
  eventId: z.string().min(1),
  /** ISO-8601 with offset. The offset matters: "when did she open/dismiss it" is local. */
  timestamp: z.string().datetime({ offset: true }),
  /** The vault path of the assessment note this offer/open/dismiss concerns. */
  assessmentPath: z.string().min(1),
});
export type RetrospectiveOfferLogRecordV5 = z.infer<typeof retrospectiveOfferLogRecordV5>;

/**
 * Which of F2.12/F2.14a/F5.3a's routes produced an explain-back offer
 * (`explainBackOfferLogRecordV5`'s own doc). Stored on the record rather than
 * derived, because the question this data exists to answer is *which trigger
 * goes untaken* — a proposal she never asked for (`strong-recall-proposal`,
 * F2.14a), a routing after repeated failure (`repeated-failure`, F2.12),
 * `on-demand` (her own request), and the F5.3a reciprocal prompt off a live
 * scheduling observation (`scheduling-observation`, `[D-204 / LOG-4]`,
 * `ol-egov.95`) are four distinct offers, never collapsed into one another.
 *
 * **`scheduling-observation` (`[D-204]`) is additive at the schema level —
 * no `schemaVersion` bump**, the same reasoning `[D-178 / LOG-3]` applied
 * when this field itself was introduced: widening an enum's meaning-set is
 * additive exactly like adding an optional field, and D7.1 (amended by
 * `[D-204]`) is what authorises the fourth literal, not this file alone.
 */
export const explainBackOfferTrigger = z.enum([
  'repeated-failure',
  'strong-recall-proposal',
  'on-demand',
  'scheduling-observation',
]);
export type ExplainBackOfferTrigger = z.infer<typeof explainBackOfferTrigger>;

/**
 * How a declined explain-back offer went untaken. `not-taken` is today's only
 * honest value — F2.12's banner offers one action and simply clears itself
 * when she moves past the item, whether or not she touched it
 * (`packages/plugin/src/review/view.ts:682-719`); nothing here builds a
 * `dismissed` control. `dismissed` is reserved so that if one is ever ruled,
 * the two are distinguishable in the data rather than silently merged.
 */
export const explainBackDeclineManner = z.enum(['dismissed', 'not-taken']);
export type ExplainBackDeclineManner = z.infer<typeof explainBackDeclineManner>;

/**
 * The two explain-back-offer events (`[D-178 / LOG-3]` item 2,
 * `ol-3ux7.5.6`, `ol-0r92.13`) — additive to the discriminated union the same
 * way `retrospectiveOfferLogRecordV5` is: one record shape spanning two
 * `kind` literals rather than two near-identical shapes, because "offered"
 * and "declined" carry the same fields and differ only in which happened
 * (plus the pairing fields a decline alone carries).
 *
 * **What is recorded, and what deliberately is not.** That an explain-back
 * was offered, and — separately — that the offer left the surface unaccepted.
 * F2.14a rules plainly that declining changes nothing and is not itself a
 * state; this event does not contradict that ruling, because an append-only
 * log record is a record of something that *happened* (an offer went
 * untaken), never a state she is in. **There is no `accepted` kind and no
 * decision to add a dismiss control is implied by this shape** — an accepted
 * offer is evidenced by the `explain-back` review record it produces, and the
 * banner's one-action design is unchanged.
 *
 * **The pairing rule, modelled on `disputeLogRecordV5`'s `resolves`/
 * `outcome`.** An `explain-back-offered` record carries neither `answers` nor
 * `manner`; an `explain-back-declined` record carries both — `answers` names
 * the offer event it answers, `manner` says how it went untaken. Half of
 * either pair would leave a decline pointing at nothing.
 *
 * **No content, per D-005.** Two opaque ids (the concept and, where present,
 * the instrument that routed to it), two enums, and an event-id pointer.
 * Never a reason she gave, and never her wording — no reason field exists at
 * all, the same restraint `disputeLogRecordV5` states for its own claim.
 */
function refineExplainBackOfferPairing(
  value: {
    readonly kind: 'explain-back-offered' | 'explain-back-declined';
    readonly answers?: string | undefined;
    readonly manner?: 'dismissed' | 'not-taken' | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const isDecline = value.kind === 'explain-back-declined';
  const hasAnswers = value.answers !== undefined;
  const hasManner = value.manner !== undefined;
  if (hasAnswers !== isDecline) {
    ctx.addIssue({
      code: 'custom',
      path: ['answers'],
      message:
        'a declined offer carries `answers` (the offer event it answers); an offered record ' +
        'carries neither',
    });
  }
  if (hasManner !== isDecline) {
    ctx.addIssue({
      code: 'custom',
      path: ['manner'],
      message: 'a declined offer carries `manner`; an offered record carries neither',
    });
  }
}

export const explainBackOfferEventKind = z.enum(['explain-back-offered', 'explain-back-declined']);
export type ExplainBackOfferEventKind = z.infer<typeof explainBackOfferEventKind>;

export const explainBackOfferLogRecordV5 = z
  .object({
    schemaVersion: z.literal(5),
    kind: explainBackOfferEventKind,
    /** Stable unique id; makes two-device merges idempotent, and is what a decline's `answers` names. */
    eventId: z.string().min(1),
    /** ISO-8601 with offset. The offset matters: "when did she pass on it" is local. */
    timestamp: z.string().datetime({ offset: true }),
    /**
     * Every concept the offer concerned. Non-empty for the same reason
     * `verdictLogRecordV5.conceptIds` is: an offer naming no concept is
     * invisible to every later question.
     */
    conceptIds: z.array(z.string().min(1)).min(1),
    trigger: explainBackOfferTrigger,
    /** Present for F2.12 routing off a specific instrument; absent otherwise. */
    instrumentId: z.string().min(1).optional(),
    /** The offer event this record answers. Present exactly on a decline. */
    answers: z.string().min(1).optional(),
    /** How the offer went untaken. Present exactly on a decline. */
    manner: explainBackDeclineManner.optional(),
  })
  .superRefine(refineExplainBackOfferPairing);
export type ExplainBackOfferLogRecordV5 = z.infer<typeof explainBackOfferLogRecordV5>;

/**
 * One explain-back **non-attempt** (`[D-273]`, F5.7; D7.1's non-attempt
 * paragraph): a prompt she opened that produced no explanation. Additive to
 * the v5 discriminated union exactly the way `explainBackOfferLogRecordV5`
 * was — no `schemaVersion` bump, because nothing about the shape the union
 * already carries changes; a new literal `kind` value is what additive means
 * here.
 *
 * **What is recorded is what D7.1 names, and nothing else:** that the prompt
 * was opened and this offer produced no explanation, which of the four
 * triggers the offer behind it was made under, and which concepts it
 * concerned. `trigger` reuses `explainBackOfferTrigger` rather than
 * redeclaring it — the same four routes, so the per-offer counting reads the
 * offer record and this one on one key.
 *
 * **One kind for both exits, and the record does not say which one she took
 * (`[D-306]`).** A named skip and a prompt closed without an answer are the
 * same event, so there is one `kind` literal, not a two-literal enum, and no
 * `exit`, `manner` or reason field exists at all. That is the deliberate
 * contrast with `explainBackDeclineManner`, which does tell `dismissed` from
 * `not-taken` for an offer that was never opened.
 *
 * **Beside the offer record, not inside it** (D7.1): a decline is an offer
 * never opened, and this is a prompt opened and left — hence its own kind
 * rather than a third `explainBackOfferEventKind` literal.
 *
 * **No grade, because nothing was graded** (D7.1, `[D-273]`): no `rating`,
 * no `explainBackGrade`, no `contentRef` — a skip sends no answer, so there
 * is no answer to point at. **An answer the declared local check flagged is
 * never written as this kind** (`[D-304]`): it is graded and recorded as the
 * review it is.
 *
 * **Read by nothing that reports what she knows** (F5.7, knowledge model R7
 * and M5): no fold, growth stage or vitality reading reads it, and the
 * misconception matcher never sees it. Its one reader is the per-offer
 * counting, by trigger and by concept, and that count is never shown to her
 * (`[D-305]`). `'non-attempt'` is internal vocabulary (vocabulary registry
 * §19) and is never printed; the word she sees for the action is *skip*,
 * which is not the literal here because the record does not say she took it.
 *
 * **The offer reference (`[D-369]`, `ol-egov.141.89.6.53`).** `offerEventId`
 * names the `explain-back-offered` record behind the prompt, by that record's
 * own `eventId` — a stable identifier, never a key derived from timing or
 * from the concept list — so "offered, then opened and left" is joinable
 * exactly rather than by time proximity. It is **present exactly when a real
 * offer record stands behind the prompt**, and absent — no key at all, never
 * `null` or an empty string — when she opened the prompt herself: a
 * `trigger: 'on-demand'` record carrying one is refused by
 * `refineNonAttemptOfferReference` below, because there is no offer behind a
 * self-initiated prompt to point at. Never invented and never backfilled: a
 * record written before this field existed carries none, and that absence
 * means only that no reference was recorded. Additive on v5 with no version
 * bump, as the ruling states and this paragraph's predecessor anticipated —
 * an optional field whose absence every older record already satisfies.
 *
 * **Still not carried, because D7.1's paragraph does not name them:**
 * `instrumentId`/`instrumentType` and `selectionContext`. Each could land
 * later as an optional field without a version bump; neither is added ahead
 * of a ruling, because a field on records already on disk cannot be taken
 * back. (The instrument is recoverable through the offer, which is why
 * `[D-369]` declined to add it beside the reference.)
 *
 * **No content, per D-005.** Opaque concept ids, one enum and, where present,
 * one opaque event id.
 */
function refineNonAttemptOfferReference(
  value: {
    readonly trigger: ExplainBackOfferTrigger;
    readonly offerEventId?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.trigger !== 'on-demand' || value.offerEventId === undefined) return;
  ctx.addIssue({
    code: 'custom',
    path: ['offerEventId'],
    message:
      'a self-initiated (on-demand) prompt has no offer behind it, so it carries no ' +
      '`offerEventId` ([D-369])',
  });
}

export const nonAttemptLogRecordV5 = z
  .object({
    schemaVersion: z.literal(5),
    /** Discriminator. Required, never defaulted — see `reviewLogRecordV2`'s doc. */
    kind: z.literal('non-attempt'),
    /** Stable unique id; makes two-device merges idempotent. */
    eventId: z.string().min(1),
    /**
     * ISO-8601 with offset, the moment the prompt was left (the skip taken or
     * the prompt closed). The offset matters: "when did she leave it" is local.
     */
    timestamp: z.string().datetime({ offset: true }),
    /**
     * Every concept the prompt concerned. Non-empty for the same reason
     * `explainBackOfferLogRecordV5.conceptIds` is: a record naming no concept
     * is invisible to every later question, including the per-concept count.
     */
    conceptIds: z.array(z.string().min(1)).min(1),
    /** The trigger the offer behind this prompt was made under (D7.1). */
    trigger: explainBackOfferTrigger,
    /**
     * The `eventId` of the `explain-back-offered` record behind this prompt
     * (`[D-369]`). Present exactly when such an offer record exists; absent
     * for a self-initiated prompt and on every record written before the
     * field existed. See this record's own doc above.
     */
    offerEventId: z.string().min(1).optional(),
  })
  .superRefine(refineNonAttemptOfferReference);
export type NonAttemptLogRecordV5 = z.infer<typeof nonAttemptLogRecordV5>;

/**
 * A wrong MCQ pick's distractor provenance, carried INLINE on
 * `misconceptionObservedLogRecordV5` (`[D-202]`, `ol-egov.92`; `ol-0r92.44`)
 * — field-for-field the same shape `quiz.generate.v1`'s distractor schema
 * requires at generation time (`[D-195]`, `olea-service/src/tasks/
 * quizGenerate.ts`, private; read for shape only), right down to
 * `source_says`'s snake_case, so the two sides of the wire never need a
 * translation step.
 *
 * **Inline, not a reference, because there is nowhere else this survives
 * to.** By the time she answers — days or weeks after generation, on
 * whatever device holds the schedule — the vault's persisted MCQ block
 * carries only the option's `text` (`McqFields.distractors: readonly
 * string[]`, unchanged by `[D-202]`; the persisted-BLOCK shape was never
 * ruled to become an object array, only the event's shape was). `believes`/
 * `source_says` are not recoverable from the vault at answer time by any
 * other route, so this event is the one place they are captured — the same
 * "capture it from day one or lose it permanently" argument F5.6 already
 * makes for the misconception store itself.
 */
export const mcqMisconceptionProvenance = z.object({
  /** The option text she saw — matches the chosen `McqOption.label` verbatim. */
  text: z.string().min(1),
  /** The specific wrong belief this distractor encodes (F2.15/`[D-195]`). */
  believes: z.string().min(1),
  /** What the source material actually says, correcting `believes`. */
  source_says: z.string().min(1),
});
export type McqMisconceptionProvenance = z.infer<typeof mcqMisconceptionProvenance>;

/**
 * One wrong MCQ pick (`[D-202]`, `ol-egov.92`; build bead `ol-0r92.44`) —
 * additive to the v5 discriminated union, no `schemaVersion` bump, the same
 * reasoning `[D-178 / LOG-3]` applied when `explainBackOfferLogRecordV5` and
 * `retrospectiveOfferLogRecordV5` arrived: a discriminated union may grow a
 * member without moving every existing record forward.
 *
 * **Appended only on a wrong pick; a correct pick appends nothing here.**
 * The review event itself (`kind: 'review'`, the SAME `mcqNext` call,
 * carrying `correctness.matchedKey: true`) is the whole record of a right
 * answer — see `mcqCorrectness`'s own doc. This record's `reviewEventId`
 * names that paired review event's `eventId`, the same "half of a pair
 * points at the other half by event id" shape `disputeLogRecordV5`'s
 * `resolves` and `explainBackOfferLogRecordV5`'s `answers` already use.
 *
 * **`misconceptionId` is minted CLIENT-SIDE, always freshly, at write time —
 * never matched against existing history first.** `[D-202]`'s own words:
 * "a never-matched record stays as written... [and] reconciles at read
 * time, never by rewriting the event." This is a deliberately different
 * mechanism from the *other* misconception stream this codebase already has
 * (`packages/core/src/misconception/events.ts`'s `buildObservationEvent`,
 * explain-back's free-text findings): that path runs M1's embedding match
 * BEFORE minting, because a spoken explanation's wording varies occurrence
 * to occurrence and needs a similarity judgement to avoid minting a
 * duplicate id for the same belief. An MCQ pick has no such ambiguity — it
 * is a deterministic choice among a fixed, already-known set of distractors
 * — so there is nothing to match against at write time, and this record
 * carries no embedding and calls no matcher. Reconciling occurrences of "the
 * same" misconception across records (by a content-derived distractor key,
 * per `ol-pjs7`'s aggregation proposal) is a READ-time projection concern,
 * not this writer's — this schema does not encode that key, and nothing
 * here should be read as anticipating its shape.
 *
 * **The Worker mints nothing into this event (D-005, stateless calculator).**
 * It never sees a misconception-observed record at all: the write happens
 * entirely on-device, in `packages/core/src/review-log/write.ts`'s
 * `appendMisconceptionObservedRecord`, the only mint site for both
 * `eventId` and `misconceptionId`.
 *
 * **Never content beyond the one distractor she actually picked, which she
 * already saw rendered on screen** — the same privacy posture
 * `mcqCorrectness` states for its own two fields, extended to the
 * provenance of that specific option. No free-text answer of hers, no
 * grader output, and no reference to any OTHER option in the pool.
 */
export const misconceptionObservedLogRecordV5 = z.object({
  schemaVersion: z.literal(5),
  kind: z.literal('misconception-observed'),
  /** Stable unique id for this event; makes a two-device same-day append idempotent, same as every other kind here. */
  eventId: z.string().min(1),
  /** ISO-8601 with offset — same local-time reasoning as every other timestamp in this file. */
  timestamp: z.string().datetime({ offset: true }),
  /** The MCQ instrument this pick was on. */
  instrumentId: z.string().min(1),
  /** Every concept the instrument practises — the same value as the paired review record's `conceptIds`. Non-empty for the same reason that record's is. */
  conceptIds: z.array(z.string().min(1)).min(1),
  /** The paired review record's own `eventId` — the SAME `mcqNext` call, `kind: 'review'`, that carries `correctness.matchedKey: false` for this pick. */
  reviewEventId: z.string().min(1),
  /** Client-minted, always fresh at write time — see this record's own doc for why no matching happens here. */
  misconceptionId: z.string().min(1),
  /** The chosen distractor's provenance, inline — see `mcqMisconceptionProvenance`'s own doc for why inline is the only option. */
  distractor: mcqMisconceptionProvenance,
});
export type MisconceptionObservedLogRecordV5 = z.infer<typeof misconceptionObservedLogRecordV5>;

/**
 * The two roles [D-226]'s S1/S2 controls ever offer for a non-markdown
 * document (F1.5(b)'s evidenced ask; the document-side control). Deliberately
 * narrower than `olea-core`'s in-memory `SourceRole`, which also carries
 * `'course-material'` for F3.1's manual-registration default — neither
 * control ever offers that role, so this persisted enum never needs to carry
 * it. Contracts does not depend on `olea-core` (the dependency runs the other
 * way), so the two enums are declared independently rather than shared.
 */
export const sourceRegisteredRole = z.enum(['past-paper', 'objectives']);
export type SourceRegisteredRole = z.infer<typeof sourceRegisteredRole>;

/**
 * One "source registered" event — [D-226] ruling 1 (`ol-egov.113`), landed as
 * F1.5's "How she names a document, and where that naming lives" paragraph.
 * A ninth `kind`, additive to the discriminated union exactly the way
 * `misconceptionObservedLogRecordV5` was — no version bump, because nothing
 * about the shape the union already carries changes; a new literal `kind`
 * value is what additive means here.
 *
 * **What this records, and what it deliberately does not.** A markdown note
 * still declares its own role with a `role` frontmatter property (F1.3: her
 * stated property wins) — this event exists for exactly the case that
 * property cannot cover, a file that carries no frontmatter at all. It names
 * a fact about a PATH: which document, which of the two roles either control
 * ever offers, and which course. **Document grain only — never a passage or
 * whole-file split**, the ruling's own words.
 *
 * **Declared vs corrected provenance falls out for free (knowledge model
 * §3.2), and needs no field of its own.** A correction is simply a LATER
 * event naming the same `path`; `olea-core`'s
 * `source/register.ts#projectRegisteredFiles` folds "latest event per path
 * wins," the identical `(timestamp instant, eventId)` ordering
 * `review-log/suspension.ts#suspendedInstrumentIds` already uses for its own
 * per-instrument fold. A correction therefore outranks a declaration exactly
 * as it does everywhere else in this project, by ordering alone — this
 * record carries no separate provenance flag.
 *
 * **Never server-side** (architecture boundary §1). This lives in her local
 * event log like every other kind in this union, and the Worker never sees
 * it — the whole point of ruling 1's "option A".
 *
 * **No content, per D-005.** `path` is a vault location, not her wording; the
 * two enums name a role and identify a course, never quote anything she or
 * the document says.
 */
export const sourceRegisteredLogRecordV5 = z.object({
  schemaVersion: z.literal(5),
  /** Discriminator. Required, never defaulted — see `reviewLogRecordV2`'s doc. */
  kind: z.literal('source-registered'),
  /** Stable unique id for this event; makes two-device merges idempotent. */
  eventId: z.string().min(1),
  /** ISO-8601 with offset. The offset matters: "when did she register this" is local. */
  timestamp: z.string().datetime({ offset: true }),
  /** The vault path of the document being named. */
  path: z.string().min(1),
  role: sourceRegisteredRole,
  /** The course this document belongs to (F8.1's denominator, F7.9). */
  course: z.string().min(1),
});
export type SourceRegisteredLogRecordV5 = z.infer<typeof sourceRegisteredLogRecordV5>;

/**
 * Every shape a **current-version** review-log line can take, discriminated by
 * `kind` — the union readers parse v5 lines against.
 *
 * Older records are deliberately *not* members: a reader must read
 * `schemaVersion` first and never guess, then migrate through core's single
 * `upgrade.ts` before anything else sees the record.
 */
export const reviewLogEntryV5 = z.discriminatedUnion('kind', [
  reviewLogRecordV5,
  suspendLogRecordV5,
  verdictLogRecordV5,
  successionLogRecordV5,
  disputeLogRecordV5,
  retrospectiveOfferLogRecordV5,
  explainBackOfferLogRecordV5,
  nonAttemptLogRecordV5,
  misconceptionObservedLogRecordV5,
  sourceRegisteredLogRecordV5,
]);
export type ReviewLogEntryV5 = z.infer<typeof reviewLogEntryV5>;

/*
 * ---------------------------------------------------------------------------
 * Schema version 6 (`ol-95vv.8`) — DEFINED HERE, NOT YET CURRENT.
 * ---------------------------------------------------------------------------
 */

/**
 * **Schema version 6 is the one evidence-format migration every ruled field
 * rides together, so her log migrates once** (`ol-95vv.8`): MAT-7's vitality
 * and arithmetic version on the mastery stamp (`[D-087]`, `[D-116]`),
 * `[D-303]`'s top-level explain-back correctness, `[D-345]`'s reason on a
 * suspension plus its rule-version marker, `[D-350]`'s hint-opened fact and
 * `[D-358]`'s presented source-revision stamp.
 *
 * **An ordinary additive hop, not `[D-109]`'s migrate-in-place exception.**
 * v5 records exist, so v5 stays readable forever, exactly as v1–v3 do. The
 * v5 → v6 hop is a pure restamp: every v5 field keeps the meaning v5 gave it,
 * and every field new at v6 is simply absent on a migrated record — which
 * every one of them reads as *not recorded*, i.e. unknown, never as a default
 * value. That is why each new field is `.optional()`, and why no v6 field is a
 * v5 field bolted on: a v5 parse strips all of them.
 *
 * **Staged: the shapes land before any line can be written.**
 * `REVIEW_LOG_SCHEMA_VERSION` is still 5, `REVIEW_LOG_READABLE_VERSIONS` does
 * not yet list 6, and every current alias below still names a v5 schema. No
 * writer may produce a v6 line until core's `parse.ts` reads 6 and
 * `upgrade.ts` gains the one v5 → v6 hop; those, the aliases, the version
 * constant and the writers move together in one change (the flip), because a
 * line this build's reader would refuse is a line lost.
 *
 * **Key order.** Every v6 object spreads its v5 shape first and re-declares
 * `schemaVersion` (and, for the review, `masteryAtTime`) in place — an object
 * literal that re-assigns an existing key keeps that key's position — so a v5
 * record restamped to 6 serialises byte-identically apart from the version
 * digit, and every field new at v6 lands after the last v5 field.
 */

/**
 * Vitality, the retention axis (F2.11, `[D-049]`, `[D-087]`): the vocabulary
 * registry's three internal names (§1 axis 2) — `holding`, `tending` (shown as
 * *needs tending*) and `early` (shown as *too early to say*), matching
 * `olea-core`'s `mastery/vitality.ts` `Vitality` exactly. Display words live
 * in core's display module and nowhere here. `early` is a real reading, not a
 * missing one: absence of a vitality stamp means *not recorded*, and nothing
 * may default it to any of the three.
 */
export const vitalityValue = z.enum(['holding', 'tending', 'early']);
export type VitalityValue = z.infer<typeof vitalityValue>;

/**
 * `masteryAtTime` at **v6**: both axes plus the arithmetic version that
 * produced them (MAT-7, `ol-95vv.8`; `[D-087]`'s "both axes stamped").
 *
 * **Why the stage map stays as it was.** `byConcept` keeps its v5 type
 * exactly, and vitality rides beside it as a parallel map keyed the same way,
 * so a v5 stamp restamped to 6 is already a valid v6 stamp (the legacy,
 * stage-only form) and every reader of the stage reads it unchanged.
 *
 * **The stamp is whole or it is the legacy one.** A writer that stamps
 * vitality stamps the arithmetic version with it, and the reverse
 * (`refineBeliefStampComplete`): a vitality reading with no version cannot be
 * reproduced, and a version stamped over a stage alone would repeat, in the
 * durable record, the stage-without-vitality defect `[D-116]`'s co-presence
 * clause forbids on display. The only stage-only stamp a v6 record carries is
 * one migrated from v5.
 *
 * **Stamped at write time, never recomputed, never an input.** The same rule
 * as v4's stamp (`masteryAtTime`'s doc above): these record what the system
 * believed when it offered the item, passed through from the reading the
 * writer already had — nothing computes a second reading to stamp — and no
 * fold reads them back as evidence (knowledge model §8 test 5,
 * strip-invariance, covers every stamped belief).
 *
 * The `not-attributable` arm is unchanged: only a v3 migration produces it,
 * and a v3 record never carried vitality or a version.
 */
export const masteryAtTimeV6 = z.discriminatedUnion('attribution', [
  masteryAtTimePerConcept.extend({
    /**
     * The vitality reading for each concept the record names, beside its
     * stage in `byConcept`. Keyed exactly like `byConcept`
     * (`refineVitalityAgreesWithConcepts`). Absent on a legacy stamp.
     */
    vitalityByConcept: z.record(z.string().min(1), vitalityValue).optional(),
    /**
     * The arithmetic version that produced this stamp's stage and vitality:
     * `olea-core`'s `attainmentArithmeticVersion` string
     * (`packages/core/src/mastery/attainment.ts` — fold rule, sapling rule,
     * withheld-evidence policy and scheduler configuration), opaque here.
     *
     * **Also `[D-345]`'s rule-version marker.** Stamped on every review whose
     * belief a writer recorded, it is the dated trail of which rules were in
     * force when, so a historical award can be reproduced under the rule
     * version that produced it. A stamp, never scoring evidence. Absent on a
     * legacy stamp.
     */
    arithmeticVersion: z.string().min(1).optional(),
  }),
  masteryAtTimeNotAttributable,
]);
export type MasteryAtTimeV6 = z.infer<typeof masteryAtTimeV6>;

/**
 * A v6 vitality map names **exactly** the concepts the record names — the
 * same set rule, for the same reasons, as `refineMasteryAgreesWithConcepts`
 * applies to the stage map: an extra key is a reading for a concept this
 * review was not evidence for, a missing key a reading the writer dropped.
 */
function refineVitalityAgreesWithConcepts(
  value: {
    readonly conceptIds: readonly string[];
    readonly masteryAtTime?: MasteryAtTimeV6 | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const mastery = value.masteryAtTime;
  if (mastery === undefined || mastery.attribution !== 'per-concept') return;
  const vitality = mastery.vitalityByConcept;
  if (vitality === undefined) return;

  const expected = expectedMasteryKeys(value.conceptIds);
  const missing = expected.filter((id) => !Object.hasOwn(vitality, id));
  const extra = Object.keys(vitality).filter((id) => !expected.includes(id));
  if (missing.length === 0 && extra.length === 0) return;

  ctx.addIssue({
    code: 'custom',
    path: ['masteryAtTime', 'vitalityByConcept'],
    message:
      'masteryAtTime.vitalityByConcept must name exactly the record’s conceptIds' +
      (missing.length > 0 ? `; missing ${JSON.stringify(missing)}` : '') +
      (extra.length > 0 ? `; unexpected ${JSON.stringify(extra)}` : ''),
  });
}

/**
 * Vitality and the arithmetic version travel together or not at all — see
 * `masteryAtTimeV6`'s doc ("the stamp is whole or it is the legacy one").
 */
function refineBeliefStampComplete(
  value: { readonly masteryAtTime?: MasteryAtTimeV6 | undefined },
  ctx: z.RefinementCtx,
): void {
  const mastery = value.masteryAtTime;
  if (mastery === undefined || mastery.attribution !== 'per-concept') return;
  const hasVitality = mastery.vitalityByConcept !== undefined;
  const hasVersion = mastery.arithmeticVersion !== undefined;
  if (hasVitality === hasVersion) return;
  ctx.addIssue({
    code: 'custom',
    path: ['masteryAtTime', hasVitality ? 'arithmeticVersion' : 'vitalityByConcept'],
    message:
      'a v6 mastery stamp carries vitalityByConcept and arithmeticVersion together, or ' +
      'neither (the stage-only form a v5 record migrates to)',
  });
}

/**
 * The explain-back correctness verdict in its own place (`[D-303]`, ruled
 * 2026-09-24, option b): the correctness judge's verdict for this attempt,
 * with the stamp of the call that produced it, as a top-level field of the
 * explain-back review record — mirroring how `mcqCorrectness` records a
 * multiple-choice answer.
 *
 * **Why it left `explainBackGrade`.** Nested there, the verdict could only be
 * recorded when the depth pass also returned a grade (`soloLevel`,
 * `contentRef`, `revisionOf` and the grade's stamp are all required), so an
 * accepted verdict was lost whenever depth grading failed or was unavailable.
 * Here it stands alone: the first grading pass writes it, and the depth record
 * stays exactly as strict as before.
 *
 * **Its own stamp** (`artifactProvenance`, D7.3) names the correctness call —
 * never borrowed from the depth grade's, which names a different call.
 *
 * **Absent means UNKNOWN, never `correct`** (`[D-281]`, unchanged): a reader
 * that does not know this field sees no verdict and treats it as unknown, the
 * safe direction. Only an explain-back review carries it, and never beside a
 * nested `explainBackGrade.correctness` (`refineExplainBackCorrectness`).
 * D-005: a three-value verdict and a provenance stamp, never her answer or
 * the grader's rationale.
 */
export const explainBackCorrectness = z.object({
  verdict: explainBackCorrectnessVerdict,
  artifactProvenance,
});
export type ExplainBackCorrectness = z.infer<typeof explainBackCorrectness>;

/**
 * `explainBackCorrectness` appears only on an explain-back review, and never
 * on a record whose depth grade still carries the nested v5 verdict — one
 * attempt has one correctness judgement, in one place.
 */
function refineExplainBackCorrectness(
  value: {
    readonly instrumentType: InstrumentType;
    readonly explainBackCorrectness?: ExplainBackCorrectness | undefined;
    readonly explainBackGrade?: ExplainBackGrade | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.explainBackCorrectness === undefined) return;
  if (value.instrumentType !== 'explain-back') {
    ctx.addIssue({
      code: 'custom',
      path: ['explainBackCorrectness'],
      message: 'explainBackCorrectness may only appear on an explain-back review',
    });
  }
  if (value.explainBackGrade?.correctness !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['explainBackCorrectness'],
      message:
        'explainBackCorrectness never appears beside a nested explainBackGrade.correctness — ' +
        'one attempt, one correctness verdict ([D-303])',
    });
  }
}

/**
 * One review event, **schema version 6** (`ol-95vv.8`) — defined, not yet
 * current (see the v6 block's opening doc).
 *
 * Every v5 field, by derivation, with `masteryAtTime` widened in place to
 * `masteryAtTimeV6`, plus three optional top-level fields. Every v5
 * refinement is re-applied unchanged (a refined object's refinements do not
 * travel with its `.shape`), plus the three v6 adds.
 */
export const reviewLogRecordV6 = z
  .object({
    ...reviewLogRecordV5.shape,
    schemaVersion: z.literal(6),
    /** Both axes plus the arithmetic version (MAT-7) — see `masteryAtTimeV6`. */
    masteryAtTime: masteryAtTimeV6.optional(),
    /** Explain-back reviews only (`[D-303]`) — see `explainBackCorrectness`. */
    explainBackCorrectness: explainBackCorrectness.optional(),
    /**
     * Whether she opened the hint on this review (`[D-350]`, D-094's ratchet,
     * R7's discount). A writer that could observe it records an explicit
     * `true` or `false`. **Absent means UNKNOWN** — on every record written
     * before the field existed and on any review whose surface did not
     * observe it — never `false` and never inferred from
     * `supportLevelShown`, which records that a hint was *offered*, not
     * taken; and an absent value alone never lowers or corrects a past award.
     */
    hintOpened: z.boolean().optional(),
    /**
     * Which revision of the source this review was read against (`[D-358]`):
     * the digest of the cited passage **as presented to her**, which may
     * differ from the file's state when she submitted, in the same digest
     * space as the citation store's `passageDigest`
     * (`packages/core/src/instrument/citation-store.ts`, `[D-292]`). Named
     * for what it holds so it is never confused with that store's
     * `sourceRevision`, a hash of the whole source file. **Absent means
     * UNKNOWN**, never backfilled or inferred; C5.10's tie-break
     * (`packages/core/src/review-log/tiebreak.ts`) treats unknown as never
     * comparable. Opaque: a digest, never the passage (D-005).
     */
    presentedPassageDigest: z.string().min(1).optional(),
  })
  .superRefine(refineMasteryAgreesWithConcepts)
  .superRefine(refineVitalityAgreesWithConcepts)
  .superRefine(refineBeliefStampComplete)
  .superRefine(refineExplainBackGradeInstrumentType)
  .superRefine(refineSchedulingObservationNotSubject)
  .superRefine(refineCorrectnessInstrumentType)
  .superRefine(refineAnswerEditsInstrumentType)
  .superRefine(refineExplainBackCorrectness);
export type ReviewLogRecordV6 = z.infer<typeof reviewLogRecordV6>;

/**
 * Why an instrument stopped standing (`[D-345]`, ruled 2026-09-25): the one
 * new persisted fact the award-history ruling needs, on the event that takes
 * an instrument out of standing.
 *
 * - `defect` — proven invalid: rejected after use, found defective with her
 *   confirmation (F2.23), withdrawn as defective.
 * - `source-revision` — its cited passage changed, or a successor was
 *   authored.
 * - `own-choice` — she suspended or withdrew it, no defect found.
 *
 * **Absence is the only unknown.** A suspension with no reason — every one
 * written before v6, and any whose writer did not know — reads as unknown:
 * never presented as her choice, never as a defect. There is no `unknown`
 * literal, so the one fact has one encoding.
 *
 * **Nothing here can revoke an award.** `defect` is the only value that proves
 * a defect, and so the only one that may ever correct a displayed stage;
 * forgetting has no event at all, and `own-choice` or `source-revision` alone
 * never revoke or lower a past award (`[D-345]` item 4). What a reader does
 * with each value is the attainment fold's
 * (`packages/core/src/mastery/attainment.ts`), never this schema's. An enum of
 * causes, never text she typed.
 */
export const suspensionReason = z.enum(['defect', 'source-revision', 'own-choice']);
export type SuspensionReason = z.infer<typeof suspensionReason>;

/**
 * A `reason` rides only a `suspend`: an `unsuspend` returns the instrument to
 * standing, and there is no "why it stopped" to record on it.
 */
function refineSuspensionReasonOnSuspendOnly(
  value: { readonly kind: SuspendEventKind; readonly reason?: SuspensionReason | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.kind === 'suspend' || value.reason === undefined) return;
  ctx.addIssue({
    code: 'custom',
    path: ['reason'],
    message:
      'only a suspend event carries a reason; an unsuspend returns an instrument to standing',
  });
}

/** One suspend or unsuspend event, **schema version 6**: v5 plus `[D-345]`'s optional `reason`. */
export const suspendLogRecordV6 = z
  .object({
    ...suspendLogRecordV5.shape,
    schemaVersion: z.literal(6),
    /** Why the instrument stopped standing — see `suspensionReason`. Absent means unknown. */
    reason: suspensionReason.optional(),
  })
  .superRefine(refineSuspensionReasonOnSuspendOnly);
export type SuspendLogRecordV6 = z.infer<typeof suspendLogRecordV6>;

// Every other kind moves to v6 with no shape change — "one version per line,
// one current version" (`suspendLogRecordV5`'s doc) — derived from its v5
// shape with only the version restamped, and with its v5 refinements
// re-applied where it has any.

/** One verdict event, **schema version 6**: `verdictLogRecordV5`, version restamped. */
export const verdictLogRecordV6 = z.object({
  ...verdictLogRecordV5.shape,
  schemaVersion: z.literal(6),
});
export type VerdictLogRecordV6 = z.infer<typeof verdictLogRecordV6>;

/** One succession event, **schema version 6**: `successionLogRecordV5`, version restamped. */
export const successionLogRecordV6 = z.object({
  ...successionLogRecordV5.shape,
  schemaVersion: z.literal(6),
});
export type SuccessionLogRecordV6 = z.infer<typeof successionLogRecordV6>;

/** One dispute event, **schema version 6**: `disputeLogRecordV5`, version restamped, pairings kept. */
export const disputeLogRecordV6 = z
  .object({ ...disputeLogRecordV5.shape, schemaVersion: z.literal(6) })
  .superRefine(refineDisputeResolutionPairing)
  .superRefine(refineOpenRoutingPairing);
export type DisputeLogRecordV6 = z.infer<typeof disputeLogRecordV6>;

/** One retrospective-offer event, **schema version 6**: its v5 shape, version restamped. */
export const retrospectiveOfferLogRecordV6 = z.object({
  ...retrospectiveOfferLogRecordV5.shape,
  schemaVersion: z.literal(6),
});
export type RetrospectiveOfferLogRecordV6 = z.infer<typeof retrospectiveOfferLogRecordV6>;

/** One explain-back-offer event, **schema version 6**: its v5 shape, version restamped, pairing kept. */
export const explainBackOfferLogRecordV6 = z
  .object({ ...explainBackOfferLogRecordV5.shape, schemaVersion: z.literal(6) })
  .superRefine(refineExplainBackOfferPairing);
export type ExplainBackOfferLogRecordV6 = z.infer<typeof explainBackOfferLogRecordV6>;

/** One non-attempt event, **schema version 6**: its v5 shape (`[D-369]`'s offer reference included), version restamped. */
export const nonAttemptLogRecordV6 = z
  .object({ ...nonAttemptLogRecordV5.shape, schemaVersion: z.literal(6) })
  .superRefine(refineNonAttemptOfferReference);
export type NonAttemptLogRecordV6 = z.infer<typeof nonAttemptLogRecordV6>;

/** One misconception-observed event, **schema version 6**: its v5 shape, version restamped. */
export const misconceptionObservedLogRecordV6 = z.object({
  ...misconceptionObservedLogRecordV5.shape,
  schemaVersion: z.literal(6),
});
export type MisconceptionObservedLogRecordV6 = z.infer<typeof misconceptionObservedLogRecordV6>;

/** One source-registered event, **schema version 6**: its v5 shape, version restamped. */
export const sourceRegisteredLogRecordV6 = z.object({
  ...sourceRegisteredLogRecordV5.shape,
  schemaVersion: z.literal(6),
});
export type SourceRegisteredLogRecordV6 = z.infer<typeof sourceRegisteredLogRecordV6>;

/**
 * Every shape a **v6** review-log line can take, discriminated by `kind` —
 * the same ten members as `reviewLogEntryV5`, each at version 6. Not yet the
 * union readers parse current lines against (see the v6 block's opening doc).
 */
export const reviewLogEntryV6 = z.discriminatedUnion('kind', [
  reviewLogRecordV6,
  suspendLogRecordV6,
  verdictLogRecordV6,
  successionLogRecordV6,
  disputeLogRecordV6,
  retrospectiveOfferLogRecordV6,
  explainBackOfferLogRecordV6,
  nonAttemptLogRecordV6,
  misconceptionObservedLogRecordV6,
  sourceRegisteredLogRecordV6,
]);
export type ReviewLogEntryV6 = z.infer<typeof reviewLogEntryV6>;

/**
 * Aliases for the current shapes, so consumers that only ever meant "a review
 * happened" keep reading naturally. These always point at the newest version;
 * code that needs a specific version names it explicitly.
 */
export const reviewLogEntry = reviewLogEntryV5;
export type ReviewLogEntry = z.infer<typeof reviewLogEntryV5>;
export const reviewLogRecord = reviewLogRecordV5;
export type ReviewLogRecord = z.infer<typeof reviewLogRecordV5>;
export const suspendLogRecord = suspendLogRecordV5;
export type SuspendLogRecord = z.infer<typeof suspendLogRecordV5>;
export const verdictLogRecord = verdictLogRecordV5;
export type VerdictLogRecord = z.infer<typeof verdictLogRecordV5>;
export const successionLogRecord = successionLogRecordV5;
export type SuccessionLogRecord = z.infer<typeof successionLogRecordV5>;
export const disputeLogRecord = disputeLogRecordV5;
export type DisputeLogRecord = z.infer<typeof disputeLogRecordV5>;
export const retrospectiveOfferLogRecord = retrospectiveOfferLogRecordV5;
export type RetrospectiveOfferLogRecord = z.infer<typeof retrospectiveOfferLogRecordV5>;
export const explainBackOfferLogRecord = explainBackOfferLogRecordV5;
export type ExplainBackOfferLogRecord = z.infer<typeof explainBackOfferLogRecordV5>;
export const nonAttemptLogRecord = nonAttemptLogRecordV5;
export type NonAttemptLogRecord = z.infer<typeof nonAttemptLogRecordV5>;
export const misconceptionObservedLogRecord = misconceptionObservedLogRecordV5;
export type MisconceptionObservedLogRecord = z.infer<typeof misconceptionObservedLogRecordV5>;
export const sourceRegisteredLogRecord = sourceRegisteredLogRecordV5;
export type SourceRegisteredLogRecord = z.infer<typeof sourceRegisteredLogRecordV5>;

/** Current schema version, for writers stamping new records. */
export const REVIEW_LOG_SCHEMA_VERSION = 5 as const;

/**
 * Every version this build can *read*, newest first. `parse.ts` routes on it,
 * and its own error message quotes it, so adding a version cannot leave a
 * reader claiming to understand a set it no longer matches.
 *
 * **`4` is dropped, not kept alongside `5`** (`[D-109]`, `ol-tka5`) — the one
 * deliberate exception to this list's own history of only ever growing. No
 * real v4 record exists anywhere to stay readable for; a device that
 * somehow still wrote one takes the ordinary unknown-version path below,
 * indistinguishable from a version this build has never heard of.
 */
export const REVIEW_LOG_READABLE_VERSIONS = [5, 3, 2, 1] as const;
