/**
 * C5.3 as amended by `[D-090]`: a duplicate instrument id's LOSING copy never
 * becomes a live item on Olea's own authority. `session/build.ts`'s
 * `duplicateInstrumentIds` (`ol-v7r5.70`) already detects and reports a
 * collision, and its own module doc is explicit about the gap this module
 * closes: "the loser routes through a confirmation queue, inert until she
 * answers, never served — is contracted (`features/F3-learn-from-anything.md`'s
 * `@auto:core/instrument/duplication.spec` scenarios) but unbuilt: it needs
 * machinery this enumeration alone does not have (a confirmation queue is
 * plugin-side state), so it is deliberately not attempted here."
 *
 * This module is that machinery's PURE half — a caller (a session build, a
 * harness, a test) hands it what a vault walk and `duplicateInstrumentIds`
 * already produced, and it hands back three things, all derived, nothing
 * read or written:
 *
 *   - `recordsById` — the kept record per id, by the SAME last-write-wins
 *     rule `session/build.ts`'s own `recordsById` already uses (`[D-090]`
 *     changes what happens to the LOSER, never which copy is kept — see
 *     `notePath is exactly what C1.3 ruled untrustworthy`, F3's scenario
 *     "on a duplicate id, the copy where Olea last observed it keeps the
 *     id"). Recomputed here rather than taken as a given, so this module is
 *     testable on its own `records`/`duplicateInstrumentIds` pair without
 *     needing a full `ReviewSession`.
 *   - `candidates` — `input.candidates` with every losing copy withheld.
 *     `QueueCandidate` carries no `notePath` (`queue/types.ts`'s own "must
 *     not be able to branch on content" split), so a duplicated id's kept
 *     and losing copies produce CONTENT-IDENTICAL candidates; withholding
 *     the loser is therefore exactly "at most one candidate survives per
 *     duplicated id", regardless of which of the identical instances the
 *     input array happened to carry first.
 *   - `confirmationQueueEntries` — one entry per LOSING note path, each
 *     naming every instrument id that lost to a kept copy elsewhere from
 *     that note. Grouped by losing note rather than emitted one row per id,
 *     because F3's "a whole-file sync-conflict copy is handled wholesale"
 *     scenario rules that a losing note carrying several collided ids is
 *     ONE case for her to answer, not a stream of independent ones — and an
 *     ordinary single-item duplicate is simply the one-collision case of the
 *     same grouping, never a special case of it.
 *
 * ## What this module does not do
 *
 * It never persists a queue entry, never reads her answer, and never
 * transitions a `'proposed'` entry to `'confirmed'`/`'declined'` — that is
 * genuinely plugin-side state (an inert, later-answered record), and no such
 * store exists in production today. `DuplicationConfirmationStatus` mirrors
 * `../outcome/near-match.js`'s `OutcomeConceptNearMatchStatus` vocabulary —
 * the closest existing confirmation-shaped record in this codebase
 * (`proposed` / `confirmed` / `declined`, its own dot-folder sidecar,
 * `VaultSource`-parameterised) — deliberately, so a future plugin-side store
 * for this queue has a proven shape to extend rather than inventing a new
 * status vocabulary; this module itself only ever produces `'proposed'`
 * entries, since producing anything else would mean fabricating her answer.
 *
 * It never mints a fresh id for a losing copy, on Olea's authority or
 * otherwise — every entry below names the SAME `instrumentId` the collision
 * was found under; only her confirmation (never built here) can decide what
 * happens to that id next.
 */

import type { QueueCandidate } from '../queue/types.js';
import type { DuplicateInstrumentIdReport } from '../session/build.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * Mirrors `OutcomeConceptNearMatchStatus` (`../outcome/near-match.js`) — see
 * this module's doc for why. `resolveInstrumentDuplications` only ever
 * produces `'proposed'`; the other two members exist so a caller persisting
 * this shape (unbuilt — see module doc) has somewhere to record her answer
 * without inventing a second vocabulary.
 */
export type DuplicationConfirmationStatus = 'proposed' | 'confirmed' | 'declined';

/**
 * Why an entry exists. A closed union of one member, the same "a second
 * reason is a decision, not an implementation detail" discipline
 * `../outcome/near-match.js`'s `OutcomeConceptNearMatchReason` doc reserves
 * for its own sibling field — there is exactly one route into this module's
 * output today.
 */
export type DuplicationConfirmationReason = 'duplicate-instrument-id';

/** One instrument id this losing note collided on, and where its kept copy lives. */
export interface DuplicationCollision {
  readonly instrumentId: string;
  readonly keptNotePath: VaultPath;
}

/**
 * One confirmation-queue entry — everything at ONE losing note path, inert
 * until she answers (C5.3 / `[D-090]`). `collisions` carries more than one
 * entry exactly when a whole file duplicated at once (a sync-conflict copy,
 * F3's third `duplication.spec` scenario): every id that note lost is one
 * wholesale case, not `collisions.length` separate ones.
 */
export interface DuplicationConfirmationQueueEntry {
  readonly losingNotePath: VaultPath;
  readonly collisions: readonly DuplicationCollision[];
  readonly status: DuplicationConfirmationStatus;
  readonly reason: DuplicationConfirmationReason;
  /** Epoch ms — the caller's clock (`input.now`), never read directly here. */
  readonly proposedAt: number;
}

export interface ResolveInstrumentDuplicationsInput {
  /** The same enumeration `session/build.ts`'s `instruments.records` carries — every copy, duplicates included. */
  readonly records: readonly VaultInstrumentRecord[];
  /** `ReviewSession.duplicateInstrumentIds` (`session/build.ts`), or an equivalent report over `records`. */
  readonly duplicateInstrumentIds: readonly DuplicateInstrumentIdReport[];
  /** The candidate set to withhold losing copies from — `ReviewSession.candidates` or an equivalent pool. */
  readonly candidates: readonly QueueCandidate[];
  /** Epoch ms for every entry's `proposedAt` — the caller's `Clock.now()`, never `Date.now()` read here. */
  readonly now: number;
}

export interface ResolveInstrumentDuplicationsResult {
  /** The kept record per id — `input.records`' own last-write-wins rule, unchanged by `[D-090]` (see module doc). */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
  /** `input.candidates` with every losing copy withheld — at most one candidate survives per duplicated id. */
  readonly candidates: readonly QueueCandidate[];
  /** One entry per losing note path, sorted by that path — deterministic output for a deterministic input. */
  readonly confirmationQueueEntries: readonly DuplicationConfirmationQueueEntry[];
}

/**
 * C5.3 / `[D-090]`'s pure half — see module doc. Deterministic: the same
 * input always produces the same output, sorted so a caller (and a test)
 * never has to re-sort it.
 */
export function resolveInstrumentDuplications(
  input: ResolveInstrumentDuplicationsInput,
): ResolveInstrumentDuplicationsResult {
  // Last-write-wins over `records`, in the array's own order — identical
  // rule to `session/build.ts`'s `recordsById`, recomputed here rather than
  // taken as a given so this module stands alone (see module doc).
  const recordsById = new Map<string, VaultInstrumentRecord>();
  for (const record of input.records) {
    recordsById.set(record.instrumentId, record);
  }

  const duplicatedIds = new Set(input.duplicateInstrumentIds.map((d) => d.instrumentId));

  // `QueueCandidate` carries no `notePath` (see module doc): a duplicated
  // id's kept and losing copies are content-identical candidates, so
  // withholding the loser is "keep the first instance, drop the rest".
  const seenCandidateIds = new Set<string>();
  const candidates: QueueCandidate[] = [];
  for (const candidate of input.candidates) {
    if (duplicatedIds.has(candidate.instrumentId)) {
      if (seenCandidateIds.has(candidate.instrumentId)) continue;
      seenCandidateIds.add(candidate.instrumentId);
    }
    candidates.push(candidate);
  }

  // Group every losing (instrumentId, losingNotePath) pair by its losing
  // note path — F3's wholesale scenario: several ids losing from the SAME
  // note is one case, not several (see module doc).
  const collisionsByLosingNotePath = new Map<VaultPath, DuplicationCollision[]>();
  for (const duplicate of input.duplicateInstrumentIds) {
    for (const notePath of duplicate.notePaths) {
      if (notePath === duplicate.keptNotePath) continue;
      const collision: DuplicationCollision = {
        instrumentId: duplicate.instrumentId,
        keptNotePath: duplicate.keptNotePath,
      };
      const existing = collisionsByLosingNotePath.get(notePath);
      if (existing === undefined) {
        collisionsByLosingNotePath.set(notePath, [collision]);
      } else {
        existing.push(collision);
      }
    }
  }

  const confirmationQueueEntries: DuplicationConfirmationQueueEntry[] = [
    ...collisionsByLosingNotePath,
  ]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([losingNotePath, collisions]) => ({
      losingNotePath,
      collisions: [...collisions].sort((a, b) =>
        a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0,
      ),
      status: 'proposed' as const,
      reason: 'duplicate-instrument-id' as const,
      proposedAt: input.now,
    }));

  return { recordsById, candidates, confirmationQueueEntries };
}
