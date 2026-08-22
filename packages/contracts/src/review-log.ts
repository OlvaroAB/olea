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
 * **Versioning (D-020, `ol-t3sd`, `ol-g6zg`).** "Frozen" means *a version* is
 * frozen, not that the file never grows: v1 (`reviewLogRecordV1`) stays here,
 * untouched forever, so records already on disk stay readable; v2 adds the
 * `kind` discriminator that turns the log into a union of review and suspension
 * events; v3 replaces `conceptId` with `conceptIds`, because one instrument
 * may be evidence for every concept its note names; and v4 moves `masteryAtTime`
 * out of `selectionContext` onto the record itself as a per-concept map, because
 * a rating is evidence for every concept the instrument names and each of those
 * concepts has its own mastery. The rule for every reader is the same one v1's
 * doc already stated — **read the version first, never guess** — with exactly
 * one migration site, core's `upgrade.ts` (`upgradeV1`, then `upgradeV2`, then
 * `upgradeV3`). Every version bump so far was taken while the only records in
 * existence at that version were fixtures; that was the last cheap moment each
 * time, which is D-017's argument.
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
 * Named mastery states (F2.11). `yours` requires recall or explanation (R7).
 *
 * **These are F2.11's words verbatim, and that is the point (D-017).** This
 * enum previously read `unseen … developing`, which contradicted the spec's
 * `new … coming`. Two of five disagreed, and the conflict was settled toward
 * the prose for one reason: `new` and `coming` are her words about her own
 * learning, while `unseen` and `developing` are the system's words about her.
 * Principle 12 — information and consequence, never verdict — is a vocabulary
 * decision before it is a copy decision.
 *
 * Changed at a deliberate moment rather than a convenient one. The review log
 * persists this value and the record is explicitly not backfillable, so the
 * cost of the rename rises the instant a real review exists. No real record
 * did when this changed; that made it the last cheap moment, not the first.
 *
 * These identifiers are also the only mastery vocabulary in the codebase.
 * Display strings live at exactly one site — `mastery/display.ts` in core —
 * so F2.11's "one vocabulary used everywhere" is enforced by there being
 * nowhere else to disagree with.
 */
export const masteryState = z.enum(['new', 'shaky', 'coming', 'solid', 'yours']);
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
  /** Whether the instrument was actually due, or drawn early/late. */
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
export const masteryAtTime = z.discriminatedUnion('attribution', [
  z.object({
    attribution: z.literal('per-concept'),
    /**
     * One entry per concept the record names, keyed by concept id.
     *
     * Agreement with `conceptIds` is enforced on the **record**
     * (`reviewLogRecordV4`'s refinement) and cannot be enforced here: this
     * object cannot see `conceptIds`, which is the structural reason the whole
     * field moved out of `selectionContext`.
     */
    byConcept: z.record(z.string().min(1), masteryState),
  }),
  z.object({
    attribution: z.literal('not-attributable'),
    /**
     * The state that was on the record, kept verbatim. Its concept is not
     * recoverable and is not guessed at.
     */
    recorded: masteryState,
  }),
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
 * One review event, **schema version 4 — the current review record**
 * (`ol-g6zg`, implementing `ol-7328`'s ruling).
 *
 * v3 with `masteryAtTime` moved out of `selectionContext` and onto the record,
 * beside `conceptIds`, as an optional per-concept value. Everything else is
 * derived from v3 so "v4 is v3 with one field relocated" cannot become false by
 * editing.
 *
 * **Optional, and absence means exactly what `null` meant.** v1–v3 wrote
 * `masteryAtTime: null` to say "no mastery was recorded for this item", and
 * D7.1's explicit-null discipline is why the other `selectionContext` fields
 * are never omitted. That discipline is unchanged for them. This field is the
 * one exception and the exception is principled: `null` there was a *scalar
 * absence* in a fixed-shape object, whereas here the alternative to a value is
 * an empty map — which would mean "a mastery map was recorded and it names none
 * of the concepts", a statement no writer wants to make and one the invariant
 * above would reject anyway. Absent is the honest encoding, and it round-trips
 * through `JSON.stringify` without the `undefined`-drops-the-key hazard that
 * makes omission dangerous elsewhere in this record.
 *
 * **Nothing writes it yet.** C5.4's mastery rollup (`ol-p4t06`) is the first
 * and only intended producer; until it exists every vault writer omits the
 * field, which is a true statement rather than a placeholder. The version was
 * taken now rather than then for D-017's reason: at the moment of the bump no
 * real v3 record existed anywhere — v3 landed after `0.9.0-alpha.2`, only
 * `0.9.0-alpha.3` can write it, and the only v3 records in existence were the
 * fixtures in this repo. That was the last cheap moment.
 *
 * **Key order.** `masteryAtTime` lands last, after `conceptIds`; `selectionContext`
 * keeps v3's position because re-declaring an existing key in an object literal
 * replaces its value without moving it. So a v4 record's key order is v3's with
 * one key appended, which keeps the migration's output and a natively-read v4
 * record byte-identical for the same event.
 */
export const reviewLogRecordV4 = z
  .object({
    schemaVersion: z.literal(4),
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
  })
  .superRefine(refineMasteryAgreesWithConcepts);
export type ReviewLogRecordV4 = z.infer<typeof reviewLogRecordV4>;

/**
 * One suspend or unsuspend event, **schema version 4 — the current one**.
 *
 * Identical to v3 in every field, derived from it, with only the version
 * stamped forward. Nothing about the ruling touches a suspension: a suspend is
 * not a review and carries no `selectionContext`, so it has no mastery to
 * attribute.
 *
 * It moves anyway, and that is the point of moving it. `schemaVersion` is read
 * per *line*, and the two record types share one daily file, so a build that
 * wrote v4 reviews beside v3 suspensions would be asking every reader — now and
 * in a semester — to hold two current versions at once. One version per line,
 * one current version.
 */
export const suspendLogRecordV4 = z.object({
  schemaVersion: z.literal(4),
  // Every v3 field, verbatim and by derivation.
  ...suspendLogRecordV3.omit({ schemaVersion: true }).shape,
});
export type SuspendLogRecordV4 = z.infer<typeof suspendLogRecordV4>;

/**
 * Every shape a **current-version** review-log line can take, discriminated by
 * `kind` — the union readers parse v4 lines against.
 *
 * Older records are deliberately *not* members: a reader must read
 * `schemaVersion` first and never guess, then migrate through core's single
 * `upgrade.ts` before anything else sees the record.
 */
export const reviewLogEntryV4 = z.discriminatedUnion('kind', [
  reviewLogRecordV4,
  suspendLogRecordV4,
]);
export type ReviewLogEntryV4 = z.infer<typeof reviewLogEntryV4>;

/**
 * Aliases for the current shapes, so consumers that only ever meant "a review
 * happened" keep reading naturally. These always point at the newest version;
 * code that needs a specific version names it explicitly.
 */
export const reviewLogEntry = reviewLogEntryV4;
export type ReviewLogEntry = z.infer<typeof reviewLogEntryV4>;
export const reviewLogRecord = reviewLogRecordV4;
export type ReviewLogRecord = z.infer<typeof reviewLogRecordV4>;
export const suspendLogRecord = suspendLogRecordV4;
export type SuspendLogRecord = z.infer<typeof suspendLogRecordV4>;

/** Current schema version, for writers stamping new records. */
export const REVIEW_LOG_SCHEMA_VERSION = 4 as const;

/**
 * Every version this build can *read*, newest first. `parse.ts` routes on it,
 * and its own error message quotes it, so adding a version cannot leave a
 * reader claiming to understand a set it no longer matches.
 */
export const REVIEW_LOG_READABLE_VERSIONS = [4, 3, 2, 1] as const;
