/**
 * The **one** review-log migration site (D-020, `ol-t3sd`, INV-4, `ol-tka5`).
 *
 * There is exactly one file here and there is deliberately nowhere else in the
 * codebase that turns an old record into a new one. Ad-hoc upgrades scattered
 * through readers are how two callers end up disagreeing about what an old
 * record meant, and this log cannot be backfilled — a disagreement is not a bug
 * that gets fixed, it is a semester of history that answers a question
 * differently depending on who asked. `parse.ts` reads `schemaVersion` first,
 * validates against the matching frozen schema, and routes old records through
 * here; everything downstream of `parse.ts` only ever sees the current shape.
 *
 * **One function per hop, chained, rather than one function per pair.** v1
 * reaches v5 as `upgradeV3(upgradeV2(upgradeV1(record)))`. The alternative — a
 * direct `upgradeV1ToV5` alongside `upgradeV1ToV2` — is how the same record
 * acquires two migration paths that can disagree; chaining makes that
 * unrepresentable, and each hop stays independently testable against the
 * version it was written for.
 *
 * **`upgradeV3` targets v5 directly — there is no `upgradeV4` hop.** `[D-109]`
 * (`ol-tka5`) rules review-log v5 a migrate-in-place bump: no real v4 record
 * exists anywhere to migrate FROM (prod dark, no BRAT install), so v4 is
 * dropped from `REVIEW_LOG_READABLE_VERSIONS` rather than kept as a frozen
 * intermediate stage. `upgradeV3` therefore does in one hop what would
 * otherwise have been two — attribute mastery exactly as it always did, and
 * add the three v5 fields as omitted (their "not recorded" state, matching
 * `masteryAtTime`'s own v4 precedent), because a v1–v3 record predates every
 * one of them and there is nothing honest to invent.
 *
 * **Every hop takes one argument, and that is a load-bearing property rather
 * than a coincidence of style.** A migration with a second parameter is a
 * migration that can consult the vault, the clock or a concept index — and a
 * guess drawn from current state and persisted into an append-only log is
 * indistinguishable from a fact, forever. Each hop's arity is asserted in
 * `upgrade.spec.ts` so that "it cannot look anything up" is checked rather than
 * intended.
 */

import {
  type MasteryAtTime,
  type MasteryState,
  type ReviewLogEntry,
  type ReviewLogEntryV2,
  type ReviewLogEntryV3,
  type ReviewLogRecordV1,
  type ReviewLogRecordV2,
  reviewLogRecordV2,
  reviewLogRecordV3,
  reviewLogRecordV5,
  suspendLogRecordV3,
  suspendLogRecordV5,
} from 'olea-contracts';

/**
 * Upgrades a v1 review record to v2 — pure, total, and lossless.
 *
 * v1 could only ever mean "a review happened" (it had no `kind` and no other
 * record type existed), so the upgrade is exactly that statement made explicit:
 * stamp `kind: 'review'` and move the version. Nothing is inferred, defaulted
 * or dropped, which is why it is safe to apply to history written months ago.
 *
 * The result is produced through `reviewLogRecordV2.parse` rather than returned
 * as a bare object literal, for a reason that matters downstream: zod emits
 * keys in schema order, so an upgraded v1 record and a natively-read v2 record
 * with the same content serialise to **byte-identical JSON**. `merge.ts`
 * compares duplicate `eventId`s by their serialised form, so without that
 * canonicalisation the same event arriving from a v1 file on one device and a
 * v2 file on another would look like an id collision and throw.
 */
export function upgradeV1(record: ReviewLogRecordV1): ReviewLogRecordV2 {
  const { schemaVersion: _v1, ...rest } = record;
  return reviewLogRecordV2.parse({ schemaVersion: 2, kind: 'review', ...rest });
}

/**
 * Upgrades a v2 entry — review or suspension — to v3 (`ol-t3sd`).
 *
 * **`conceptId` becomes `[conceptId]`, and nothing cleverer happens here.**
 * That is the whole migration, and the restraint is the point rather than a
 * limitation of the implementation. v3 exists because one instrument may be
 * evidence for every concept its note names; a v2 record names one because one
 * is all that was ever captured, and the co-listed names it might have carried
 * were never written down. They are not recoverable from current vault state
 * either: her `topic:` lists have moved on, and the instrument may have been
 * edited or deleted since. So this function takes no vault, no clock and no
 * concept index — it *cannot* consult anything even if a future caller wished
 * it would. A guess persisted into an append-only log is indistinguishable
 * from a fact, forever.
 *
 * That makes the migration lossless in the only direction it can be: it never
 * drops what was recorded, and it never invents what was not. A v3 record
 * carrying exactly one concept is a true statement about a v2 record — "this
 * is the concept she was recorded as practising" — and a caller cannot tell
 * whether the second concept was absent or merely uncaptured, which is honest,
 * because neither can anyone else.
 *
 * Produced through `.parse` for the same reason `upgradeV1` is: zod emits keys
 * in schema order, so a migrated record and a natively-read v3 record of the
 * same event serialise **byte-identically**, and `merge.ts`'s comparison of
 * duplicate `eventId`s by serialised form does not mistake one for a collision
 * with the other.
 */
export function upgradeV2(entry: ReviewLogEntryV2): ReviewLogEntryV3 {
  if (entry.kind === 'review') {
    const { schemaVersion: _v2, conceptId, ...rest } = entry;
    return reviewLogRecordV3.parse({ schemaVersion: 3, ...rest, conceptIds: [conceptId] });
  }
  const { schemaVersion: _v2, conceptId, ...rest } = entry;
  return suspendLogRecordV3.parse({ schemaVersion: 3, ...rest, conceptIds: [conceptId] });
}

/**
 * Decides what a v3 record's single `masteryAtTime` becomes on a v4 record, and
 * refuses to decide when it cannot (`ol-g6zg`).
 *
 * Three cases, and the third is the whole reason this hop needed a decision
 * rather than a rename:
 *
 * - **Nothing recorded.** `null` meant "no mastery was recorded for this item",
 *   and v4 says that by leaving the field off. The two encodings mean the same
 *   thing, so nothing is lost and nothing is added.
 * - **One concept.** The value described that concept and no other, because
 *   there was no other. It becomes a one-entry map, which is the same statement
 *   in the new shape.
 * - **Several concepts.** The value described *one* of them, and which one was
 *   never captured. Splitting it across all of them asserts that each concept
 *   was at that state, which the log never said; picking one asserts a
 *   primary, which is exactly the pick-one-and-persist-it problem D-031 was
 *   raised to end. So the value is kept and the attribution is explicitly
 *   declined. **This is the case the whole v4 shape was designed around**: a v3
 *   golden already carries it, goldens are extended and never pruned (INV-2),
 *   and inventing an attribution is the one thing this migration must not do.
 */
function attributeV3Mastery(
  recorded: MasteryState | null,
  conceptIds: readonly string[],
): MasteryAtTime | undefined {
  if (recorded === null) return undefined;
  const only = conceptIds.length === 1 ? conceptIds[0] : undefined;
  if (only !== undefined) {
    return { attribution: 'per-concept', byConcept: { [only]: recorded } };
  }
  return { attribution: 'not-attributable', recorded };
}

/**
 * Upgrades a v3 entry — review or suspension — to **v5** (`ol-g6zg`'s mastery
 * attribution, `ol-tka5`/`[D-109]`'s migrate-in-place v5 bump).
 *
 * **`selectionContext.masteryAtTime` becomes the record's own `masteryAtTime`,
 * and nothing else moves.** The field leaves `selectionContext` because a map
 * keyed by `conceptIds` cannot live in an object that cannot see `conceptIds`;
 * every other context field is carried through untouched, still as the explicit
 * nulls D7.1 requires. A suspension has no `selectionContext` and therefore
 * nothing to attribute, so it only has its version stamped forward — it moves
 * with the review record so that one daily file never holds two current
 * versions.
 *
 * **`supportLevelShown`, `explainBackGrade` and `schedulingObservation` are
 * left OMITTED, never defaulted to a value.** A v3 record predates every one
 * of D-094, R9/GLOSSARY and D-087 — there is nothing in a v1–v3 record that
 * could honestly populate any of the three, so omission states a true "not
 * recorded," the same restraint `masteryAtTime`'s own v4 migration already
 * established for exactly this situation.
 *
 * **What it will not do**, and the restraint is inherited directly from
 * `upgradeV2`: it takes no vault, no clock and no mastery rollup, so it
 * *cannot* consult current state even if a future caller wished it would. See
 * `attributeV3Mastery` for the one genuinely undecidable case and how it is
 * recorded rather than guessed.
 *
 * Produced through `.parse` for the same reason the earlier hops are: zod emits
 * keys in schema order, so a migrated record and a natively-read v5 record of
 * the same event serialise **byte-identically**, and `merge.ts`'s comparison of
 * duplicate `eventId`s by serialised form does not mistake one for a collision
 * with the other. The map itself is built in `conceptIds` order for the same
 * reason — a one-entry map at this hop, but the ordering rule is stated where a
 * later writer will read it.
 */
export function upgradeV3(entry: ReviewLogEntryV3): ReviewLogEntry {
  if (entry.kind !== 'review') {
    const { schemaVersion: _v3, ...rest } = entry;
    return suspendLogRecordV5.parse({ schemaVersion: 5, ...rest });
  }

  const { schemaVersion: _v3, selectionContext, ...rest } = entry;
  const { masteryAtTime: recorded, ...contextV4 } = selectionContext;
  const attributed = attributeV3Mastery(recorded, entry.conceptIds);

  return reviewLogRecordV5.parse({
    schemaVersion: 5,
    ...rest,
    selectionContext: contextV4,
    // Omitted, not set to undefined: `JSON.stringify` drops an
    // undefined-valued key anyway, but the record is compared and merged in
    // memory long before it is serialised, and `{ masteryAtTime: undefined }`
    // is a key that `Object.keys` reports and an absent field is not. The
    // same reasoning is why `supportLevelShown`, `explainBackGrade` and
    // `schedulingObservation` are simply never assigned below — a v3 record
    // has nothing honest to say about any of the three.
    ...(attributed === undefined ? {} : { masteryAtTime: attributed }),
  });
}
