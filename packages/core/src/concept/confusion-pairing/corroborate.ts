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

import type { MisconceptionRecord } from '../../misconception/types.js';
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

/**
 * The same fold identity `../relation.js`'s `RelationSetEntry.key` uses,
 * computed for a resolved (a, b) name pair — `contrasts-with` is symmetric,
 * so `relationKey` sorts the endpoints and a record evidencing (A, B) keys
 * identically to one evidencing (B, A).
 */
function confusionPairKey(a: string, b: string): string {
  return relationKey({ type: 'contrasts-with', from: a, to: b });
}

/**
 * Corroborate every `contrasts-with` edge `set` currently serves
 * (`RelationSetEntry.evidence === 'current'`, the same abstention gate
 * `../relation.js`'s `servedRelations` enforces) against `records`' evidence
 * of real confusion, after resolving both misconception ids to concept
 * names via `concepts`' name/alias index — see `./types.ts`'s top doc for
 * why that resolution, rather than a direct id match, is this reader's
 * identity-space convention.
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

  const recordCountByPairKey = new Map<string, number>();
  const occurrenceCountByPairKey = new Map<string, number>();
  let unresolvedRecords = 0;
  let evidenceBearingRecords = 0;

  for (const record of records) {
    if (record.confusedWithConceptId === null) continue;
    evidenceBearingRecords += 1;

    const a = byName.get(record.conceptId);
    const b = byName.get(record.confusedWithConceptId);
    if (a === undefined || b === undefined) {
      unresolvedRecords += 1;
      continue;
    }
    if (a.name === b.name) continue; // resolved to the same concept — not a pair, not an identity failure either

    const key = confusionPairKey(a.name, b.name);
    recordCountByPairKey.set(key, (recordCountByPairKey.get(key) ?? 0) + 1);
    occurrenceCountByPairKey.set(
      key,
      (occurrenceCountByPairKey.get(key) ?? 0) + record.occurrenceCount,
    );
  }

  const contrastsWithEntries = set.entries.filter(
    (entry) => entry.evidence === 'current' && entry.edge.type === 'contrasts-with',
  );

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

  return { entries, unmatchedMisconceptionPairs, unresolvedRecords, evidenceBearingRecords };
}
