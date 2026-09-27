/**
 * The confusion-pairing corroboration reader (`ol-2zfj.20`) — see
 * `./types.ts`'s module doc for the full scope argument. This file is the
 * one function: fold `RelationSet`'s `contrasts-with` entries and a
 * misconception projection's records into a corroboration verdict per
 * edge.
 *
 * Pure: no I/O, no clock, no identity minting. Same inputs, same output,
 * in any order, mirroring `../relation.js`'s `deriveRelationSet` and
 * `../corpus-relations/nominate.js`'s own purity discipline.
 */

import {
  classifyMisconceptionConceptIdScheme,
  type MisconceptionConceptIdScheme,
  type MisconceptionRecord,
} from '../../misconception/types.js';
import { type RelationSet, relationKey } from '../relation.js';
import type {
  ConfusionCorroborationStanding,
  ConfusionPairCorroboration,
  ConfusionPairingConcept,
  ConfusionPairingResult,
} from './types.js';

/** Case-sensitive name-or-alias index, same construction `corpusRelationSignals.ts`'s `gatherCorpusRelationVaultContext` uses. */
function byNameOrAlias(
  concepts: readonly ConfusionPairingConcept[],
): ReadonlyMap<string, ConfusionPairingConcept> {
  const index = new Map<string, ConfusionPairingConcept>();
  for (const concept of concepts) {
    if (!index.has(concept.name)) index.set(concept.name, concept);
    for (const alias of concept.aliases) {
      if (!index.has(alias)) index.set(alias, concept);
    }
  }
  return index;
}

/** Opaque-key index (`[D-088]`) — only concepts a caller supplied `key` for are indexed. */
function byOpaqueKey(
  concepts: readonly ConfusionPairingConcept[],
): ReadonlyMap<string, ConfusionPairingConcept> {
  const index = new Map<string, ConfusionPairingConcept>();
  for (const concept of concepts) {
    if (concept.key === null || concept.key === undefined) continue;
    if (!index.has(concept.key)) index.set(concept.key, concept);
  }
  return index;
}

/**
 * Resolves one `MisconceptionRecord.conceptId`/`.confusedWithConceptId` value against the
 * lookup space its own classified scheme selects — see `./types.ts`'s top doc, "the legacy read
 * path." Never falls back to the other space on a miss: a `'legacy-name'` id that is not in
 * `byName` is unresolved, full stop, not retried against `byKey` (and vice versa) — that retry
 * is exactly the silent cross-scheme reinterpretation this function exists to rule out.
 */
function resolveConfusionPairingConceptId(
  id: string,
  byName: ReadonlyMap<string, ConfusionPairingConcept>,
  byKey: ReadonlyMap<string, ConfusionPairingConcept>,
): {
  readonly concept: ConfusionPairingConcept | undefined;
  readonly scheme: MisconceptionConceptIdScheme;
} {
  const scheme = classifyMisconceptionConceptIdScheme(id);
  const concept = scheme === 'opaque-key' ? byKey.get(id) : byName.get(id);
  return { concept, scheme };
}

/**
 * The same fold identity `../relation.js`'s `RelationSetEntry.key` uses,
 * computed for a resolved (a, b) name pair — `contrasts-with` is symmetric,
 * so `relationKey` sorts the endpoints and a record evidencing (A, B) keys
 * identically to one evidencing (B, A).
 */
function confusionPairKey(a: string, b: string): string {
  return relationKey({ type: 'contrasts-with', from: a, to: b });
}

/** Same ordering `../relation.js`'s own (unexported) `byCodeUnit` sorts a split entry's endpoint-key pair by — restated locally rather than exported for one call site. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `entry.key` for a `contrasts-with` entry whose name pair was split into more than one course
 * identity (`../relation.js`'s `deriveRelationSet`, `[D-402]`) is `baseKey` followed by NUL and
 * the sorted `fromKey`/`toKey` pair — see that function's doc. Restated here (never re-exported
 * from `../relation.js` for one call site) so a misconception record whose resolved concepts both
 * carry a `key` can be matched to the ONE entry it actually evidences instead of the whole,
 * unsplit name group.
 */
function splitPairKey(baseKey: string, aKey: string, bKey: string): string {
  return `${baseKey}\u0000${[aKey, bKey].sort(byCodeUnit).join('\u0000')}`;
}

/**
 * Corroborate every `contrasts-with` edge `set` currently serves
 * (`RelationSetEntry.evidence === 'current'`, the same abstention gate
 * `../relation.js`'s `servedRelations` enforces) against `records`' evidence
 * of real confusion, after resolving both misconception ids to concepts via
 * `resolveConfusionPairingConceptId` (each id's own classified scheme picks
 * `concepts`' name/alias index or its `key` index — see `./types.ts`'s top
 * doc, "the legacy read path," for why a direct, scheme-blind id match is
 * never this reader's convention).
 *
 * Never mints a new edge from misconception evidence with no matching
 * `contrasts-with` entry — see `./types.ts`'s top doc; such pairs are only
 * counted (`ConfusionPairingResult.unmatchedMisconceptionPairs`).
 */
export function corroborateConfusionPairs(
  set: RelationSet,
  records: readonly MisconceptionRecord[],
  concepts: readonly ConfusionPairingConcept[],
): ConfusionPairingResult {
  const byName = byNameOrAlias(concepts);
  const byKey = byOpaqueKey(concepts);

  const contrastsWithEntries = set.entries.filter(
    (entry) => entry.evidence === 'current' && entry.edge.type === 'contrasts-with',
  );

  // `ol-egov.141.89.4.20` (`[D-402]`): a name pair split across course identities folds into
  // more than one entry sharing the same `baseKey` (`../relation.js`'s `deriveRelationSet`) —
  // this says, per name pair, how many entries actually share it, so a misconception record is
  // matched by its own endpoint KEY pair only where disambiguation is actually needed and by the
  // plain name pair (today's join, unchanged) everywhere else — never the reverse, and never a
  // split key computed where nothing splits, which would silently stop matching the ordinary case.
  const baseKeyCounts = new Map<string, number>();
  for (const entry of contrastsWithEntries) {
    const baseKey = confusionPairKey(entry.edge.from, entry.edge.to);
    baseKeyCounts.set(baseKey, (baseKeyCounts.get(baseKey) ?? 0) + 1);
  }

  const recordCountByPairKey = new Map<string, number>();
  const occurrenceCountByPairKey = new Map<string, number>();
  let unresolvedRecords = 0;
  let legacyUnresolvedRecords = 0;
  let opaqueKeyUnresolvedRecords = 0;
  let evidenceBearingRecords = 0;

  for (const record of records) {
    if (record.confusedWithConceptId === null) continue;
    evidenceBearingRecords += 1;

    const resolvedA = resolveConfusionPairingConceptId(record.conceptId, byName, byKey);
    const resolvedB = resolveConfusionPairingConceptId(record.confusedWithConceptId, byName, byKey);
    const a = resolvedA.concept;
    const b = resolvedB.concept;
    if (a === undefined || b === undefined) {
      unresolvedRecords += 1;
      // Either endpoint still on the pre-migration scheme puts this record in the legacy
      // bucket — conservative, per `./types.ts`'s doc: a mixed-scheme record is not yet fully
      // migrated, so it is never reported as a clean opaque-key miss.
      if (resolvedA.scheme === 'legacy-name' || resolvedB.scheme === 'legacy-name') {
        legacyUnresolvedRecords += 1;
      } else {
        opaqueKeyUnresolvedRecords += 1;
      }
      continue;
    }
    if (a.name === b.name) continue; // resolved to the same concept — not a pair, not an identity failure either

    const baseKey = confusionPairKey(a.name, b.name);
    const aKey = a.key;
    const bKey = b.key;
    // Split only when the fold actually split this name pair AND both endpoints resolved to a
    // concept carrying `[D-088]`'s opaque key — an unkeyed record under a split wording cannot
    // say which course's edge it evidences and is left to land on `baseKey`, which no split
    // entry uses, so it is honestly reported as unmatched rather than guessed onto one course.
    const key =
      (baseKeyCounts.get(baseKey) ?? 0) > 1 && aKey != null && bKey != null
        ? splitPairKey(baseKey, aKey, bKey)
        : baseKey;
    recordCountByPairKey.set(key, (recordCountByPairKey.get(key) ?? 0) + 1);
    occurrenceCountByPairKey.set(
      key,
      (occurrenceCountByPairKey.get(key) ?? 0) + record.occurrenceCount,
    );
  }

  const matchedPairKeys = new Set<string>();
  const entries: ConfusionPairCorroboration[] = contrastsWithEntries.map((entry) => {
    matchedPairKeys.add(entry.key);
    const misconceptionRecordCount = recordCountByPairKey.get(entry.key) ?? 0;
    const misconceptionOccurrenceCount = occurrenceCountByPairKey.get(entry.key) ?? 0;
    const standing: ConfusionCorroborationStanding =
      misconceptionRecordCount > 0 ? 'corroborated' : 'uncorroborated';
    return {
      key: entry.key,
      a: entry.edge.from,
      b: entry.edge.to,
      edge: entry,
      misconceptionRecordCount,
      misconceptionOccurrenceCount,
      standing,
    };
  });
  entries.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  let unmatchedMisconceptionPairs = 0;
  for (const key of recordCountByPairKey.keys()) {
    if (!matchedPairKeys.has(key)) unmatchedMisconceptionPairs += 1;
  }

  return {
    entries,
    unmatchedMisconceptionPairs,
    unresolvedRecords,
    legacyUnresolvedRecords,
    opaqueKeyUnresolvedRecords,
    evidenceBearingRecords,
  };
}
