/**
 * C5.3 as amended by `[D-090]` (`ol-egov.14`, approved 2026-08-23): the MATCHING half of the
 * deleted-id repair decision — the piece `./repair.ts`'s own module doc calls "genuinely new,
 * unbuilt" and "F8.6-shaped": given what a previous vault walk saw and what the current walk
 * sees, find every id that disappeared and pair it with the candidates `./repair.ts`'s
 * `resolveInstrumentRepair` is allowed to test it against.
 *
 * **The two dials, read from the ruling's own words, not invented.** C5.3's "Repair" paragraph
 * (`docs/Olea_alpha_functional_scope.md`) states silent repair needs "byte-identical item text,
 * same file, and the candidate id currently unclaimed", and calls this "the same two-dial shape
 * as F8.6's matcher" — F8.6's own text (same document, the "splitting and merging concepts"
 * clause) names the two dials explicitly: an *assertion* dial that "effectively never" fires
 * (auto-resolving two things as one is the one unrepairable act) and a *proposal* dial that is
 * "generous" ("she cannot confirm a match she is never shown, so conservatism at the proposal
 * dial is precisely how the it-doesn't-start-over promise silently fails"). `./repair.ts` is the
 * assertion dial: byte-identical AND same-file AND unclaimed, all three, or it does not fire.
 * This module is the proposal dial: a current item is a candidate worth PROPOSING (not silently
 * accepting) when EITHER of the two content-facing conditions holds on its own —
 *
 *   - the same raw text, found anywhere in the vault (the byte-identical dial, taken alone), or
 *   - an item with a new (previously-unseen) id, found in the SAME note the deleted id was last
 *     seen in (the same-file dial, taken alone).
 *
 * A candidate that only satisfies one dial is exactly the "moved item" (same text, different
 * file) or "edited item" (same file, different text) case — `resolveInstrumentRepair` will
 * surface it, never silently repair it, because near-certainty needs both. Widening this
 * module's inclusion test to OR rather than AND is not a relaxation of the assertion dial; it is
 * the proposal dial's own generosity, read off F8.6's text, not guessed.
 *
 * **Why "new id" gates both branches.** `./repair.ts`'s `RepairCandidate` "carries no id of its
 * own — an item with no id is exactly why a repair path was reached" (its own module doc). A
 * current item that already carries a stable, previously-known id is not an orphan; matching a
 * deleted id onto it would misattribute someone else's scheduling history, not repair anything.
 * So both dials only ever look at current items whose id was not present in the previous
 * enumeration at all.
 *
 * **"Deleted" is scoped to a location, not the whole vault — and that is what makes the
 * claimed-elsewhere dial reachable at all.** An id counts as deleted here when it is missing from
 * its OWN last-known `(instrumentId, notePath)` pair in the current enumeration — not simply
 * "absent from `current` altogether". If it were the latter, `candidateIdClaimedElsewhere` could
 * never be `true` (an id "currently carried by a live item elsewhere", `./repair.ts`'s own words,
 * cannot coexist with "absent from every current record"). Location-scoping is what lets the two
 * facts be true together: the id is gone from where it was, *and* some other current record
 * elsewhere in the vault still carries it — exactly the case `[D-090]` routes to duplication
 * rather than a silent repair, so a repair never creates a second live claimant of one id.
 * "Claimed elsewhere" is therefore a fact about the deleted id itself (is it live anywhere else
 * right now), not about any one candidate — `./repair.ts`'s own doc says as much ("never set true
 * for the candidate itself; the candidate carries no id") — so every candidate produced for one
 * deleted id carries the same value for it here.
 *
 * **What the ruling leaves open, deliberately not invented here (`[D-194]`):** no number or rule
 * bounds how many candidates one deleted id may be paired with, and nothing ranks or prefers one
 * candidate over another when several satisfy a dial. `resolveInstrumentRepair` is a
 * single-`(deletedId, candidate)` decision; iterating more than one candidate for the same
 * deleted id, and what to do if more than one turns out near-certain, is a caller's problem this
 * module does not attempt to solve. See this lane's report.
 *
 * **What this module does not do**, mirroring `./duplication.ts` and `./repair.ts`'s own
 * discipline: it never walks a vault, never reads a clock, never persists anything, and never
 * decides an outcome — only `resolveInstrumentRepair` decides, one candidate at a time, from
 * this module's output.
 */

import type { VaultPath } from '../vault/types.js';
import type { DeletedInstrumentRecord, RepairCandidate } from './repair.js';

/**
 * One instrument as the CURRENT vault walk sees it — the same three fields
 * `DeletedInstrumentRecord` carries for the previous walk, so a caller can build both sides from
 * the same enumeration shape (`../session/types.js`'s `VaultInstrumentRecord`: `instrumentId`,
 * `notePath`, and `card.raw`/`mcq.raw` depending on `instrumentType`).
 */
export interface CurrentInstrumentSnapshot {
  readonly instrumentId: string;
  /** The item's raw source text, now. */
  readonly raw: string;
  /** The file the item is found in, now. */
  readonly notePath: VaultPath;
}

export interface MatchDeletedInstrumentIdsInput {
  /** Every instrument the LAST walk that still saw it observed — `DeletedInstrumentRecord`'s own shape. */
  readonly previous: readonly DeletedInstrumentRecord[];
  /** Every instrument the CURRENT walk observed. */
  readonly current: readonly CurrentInstrumentSnapshot[];
}

/**
 * One deleted id and every candidate this module allows `resolveInstrumentRepair` to test it
 * against — `candidates` may be empty (no candidate found) and is never ranked or truncated (see
 * module doc: how many to consider, and how to prefer among several, is not ruled).
 */
export interface DeletedInstrumentMatch {
  readonly deletedId: DeletedInstrumentRecord;
  readonly candidates: readonly RepairCandidate[];
}

function notePathKey(instrumentId: string, notePath: VaultPath): string {
  return `${instrumentId}\u0000${notePath}`;
}

/**
 * C5.3 / `[D-090]`'s matching half — see module doc. Deterministic: the same input always
 * produces the same output, sorted so a caller (and a test) never has to re-sort it.
 */
export function matchDeletedInstrumentIds(
  input: MatchDeletedInstrumentIdsInput,
): readonly DeletedInstrumentMatch[] {
  const { previous, current } = input;

  // The id survived, unchanged, at its own last-known location.
  const liveAtOwnLocation = new Set(current.map((c) => notePathKey(c.instrumentId, c.notePath)));
  // Is this id, previously seen, still live ANYWHERE in the current walk (possibly at a
  // different location)? That is the claimed-elsewhere dial — see module doc.
  const liveAnywhere = new Set(current.map((c) => c.instrumentId));
  // An id already known from the previous walk is not "new"; only a current item with a
  // previously-unseen id is a candidate (see module doc).
  const previouslyKnownIds = new Set(previous.map((p) => p.instrumentId));

  const matches: DeletedInstrumentMatch[] = [];

  for (const deletedId of previous) {
    if (liveAtOwnLocation.has(notePathKey(deletedId.instrumentId, deletedId.notePath))) {
      continue; // still exactly where it was — not deleted.
    }

    const candidateIdClaimedElsewhere = liveAnywhere.has(deletedId.instrumentId);

    const candidates: RepairCandidate[] = [];
    for (const item of current) {
      if (previouslyKnownIds.has(item.instrumentId)) continue; // not a new/orphan item.
      const sameFile = item.notePath === deletedId.notePath;
      const sameText = item.raw === deletedId.raw;
      if (!sameFile && !sameText) continue; // satisfies neither dial — not proposed.
      candidates.push({ raw: item.raw, notePath: item.notePath, candidateIdClaimedElsewhere });
    }

    candidates.sort((a, b) => {
      if (a.notePath !== b.notePath) return a.notePath < b.notePath ? -1 : 1;
      return a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0;
    });

    matches.push({ deletedId, candidates });
  }

  matches.sort((a, b) =>
    a.deletedId.instrumentId < b.deletedId.instrumentId
      ? -1
      : a.deletedId.instrumentId > b.deletedId.instrumentId
        ? 1
        : 0,
  );

  return matches;
}
