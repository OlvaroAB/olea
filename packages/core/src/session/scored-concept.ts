/**
 * The one rule for which concept an ordinary instrument scores — `[D-419]`,
 * settled by `[D-423]` (`ol-egov.141.89.9.65`; C5.11: an instrument scores
 * exactly one concept, `[D-336]`: a subject is fixed before its scenario).
 *
 * ## The rule
 *
 * An instrument or review record carries `conceptIds`, every concept its note
 * is associated with, **in her order**. Index 0 is the **scored concept** —
 * her first-listed `topic:` value that resolves to a concept. Every later id is
 * a **context concept**: kept so the instrument stays reachable from it (the
 * study-session instrument index, the queue's per-concept dedupe, the
 * navigation lookups by concept) and so the review record can stamp what the
 * system believed about it (`masteryAtTime.byConcept`), and credited with
 * nothing. A note naming several topics does not establish that every question
 * tests every topic.
 *
 * ## Why the list keeps every concept (D2), not only the scored one (D1)
 *
 * `[D-423]` chose to leave `conceptIds` whole and make every *credit* reader
 * count only the first, through this module, over adding a second field for the
 * context concepts. The persisted review record is unchanged (no schema bump,
 * nothing rewritten), every lookup *by* concept still finds the instrument, and
 * the rule lives here once instead of in every reader's own `[0]`.
 *
 * ## Historical records follow the subject they recorded
 *
 * A review record's scored concept is `conceptIds[0]` **of that record**, read
 * from the log as written. Nothing here consults the instrument's current
 * binding, so reordering a note's topics later changes only what is enumerated
 * and recorded from then on and never reassigns evidence already on the log
 * (`[D-423]`: "reordering topics later must not silently reassign old
 * evidence"). Every record shape the log holds carries a non-empty list — the
 * one-id shapes were migrated to a one-element list by `review-log/upgrade.ts`,
 * which consults no current state — so no record lacks a subject; a record
 * written while the every-concept reading was in force (`ol-t3sd`) simply
 * credits only the first of the ids it carries.
 *
 * ## What this module does not decide
 *
 * A neighbour concept whose demonstrated use rides a review
 * (`schedulingObservation.neighbourConceptId`) is never on `conceptIds` and is
 * never scored; it does not pass through here. Crediting several concepts is
 * possible only as separate review events, one per scored subject, each with its
 * own explicit assessment evidence (C5.11, `[D-419]`) — this rule never
 * multiplies one event.
 *
 * Pure: no vault, no clock, no state.
 */

import type { ConceptRecord } from '../concept/types.js';

/** Anything that carries an instrument's or a review's concept list in her order. */
export interface ConceptListCarrier {
  readonly conceptIds: readonly string[];
}

/**
 * The scored concept of a concept list: its first id, or `undefined` for an
 * empty list. The schema makes every persisted list non-empty, so `undefined`
 * is only ever a hand-built value; a caller treats it as "credits nothing",
 * never as a reason to invent an id.
 */
export function scoredConceptId(conceptIds: readonly string[]): string | undefined {
  return conceptIds[0];
}

/**
 * The context concepts of a concept list — every id after the first, in her
 * order. Navigation and stamping only, never credit.
 */
export function contextConceptIds(conceptIds: readonly string[]): readonly string[] {
  return conceptIds.slice(1);
}

/** The scored concept of a record — `scoredConceptId` over the record's own list. */
export function scoredConceptOf(carrier: ConceptListCarrier): string | undefined {
  return scoredConceptId(carrier.conceptIds);
}

/**
 * Whether `carrier` credits `conceptId`: true only for its scored concept. A
 * record that merely names `conceptId` among its context concepts returns
 * false — use `conceptIds.includes` only for navigation, never for credit.
 */
export function creditsConcept(carrier: ConceptListCarrier, conceptId: string): boolean {
  return scoredConceptId(carrier.conceptIds) === conceptId;
}

/**
 * Orders the concepts a note is associated with, the way an instrument record
 * carries them: her `topic:` values first, in the order she wrote them, each
 * resolved against `noteConcepts` by name and dropped when it does not resolve,
 * then any remaining concept the extractor bound to the note (a drift between
 * the two meaning paths, or a concept the note's body links) — after every
 * topic, in the extractor's order.
 *
 * So index 0 of the result is her first-listed topic that resolves to a concept
 * (`[D-031]`'s "first topic value that resolves", now the ruled scored
 * concept). Only when *no* topic resolves does the scored concept fall back to
 * the first concept the extractor attested for the note — today's behaviour
 * for such a note, kept rather than changed here because withholding its
 * instruments would change what she is offered (an open question on
 * `ol-egov.141.89.9.65`).
 *
 * A concept appears once however often her list names it. Returns the concept
 * records, not ids, because the caller also needs each one's `courses`.
 */
export function orderNoteConcepts(
  topics: readonly string[],
  noteConcepts: readonly ConceptRecord[],
): readonly ConceptRecord[] {
  const byName = new Map(noteConcepts.map((concept) => [concept.name, concept]));
  const ordered: ConceptRecord[] = [];
  for (const topic of topics) {
    const concept = byName.get(topic);
    if (concept !== undefined && !ordered.includes(concept)) ordered.push(concept);
  }
  for (const concept of noteConcepts) {
    if (!ordered.includes(concept)) ordered.push(concept);
  }
  return ordered;
}
