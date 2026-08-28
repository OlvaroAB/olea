/**
 * `buildRegistryModel` — the pure projection behind F8.4's browsable
 * concept-and-instrument registry (`[REG-1]`, `ol-4v2l`, amended acceptance
 * `[D-135]`).
 *
 * ## This module computes nothing new about mastery or vitality
 *
 * Same posture `../today/mastery-overview.ts` states for its own module:
 * stage comes from `computeAllConceptMastery` (`./rollup.js`, C5.4), vitality
 * from `readAllConceptVitality` (the same file's `[D-087]` fold). Grouping
 * instruments by concept and overlaying the local rename/prune overrides is
 * the only work that happens here.
 *
 * ## Why this module takes a vault walk and a log read rather than doing them
 *
 * `enumerateVaultInstruments` and `readReviewLogHistory` are both real vault
 * I/O (async, and — per `session/history.ts`'s own doc — "whole, not
 * windowed"). A pure projection module has no business owning I/O timing or
 * caching policy; that is `packages/plugin/src/registry/provider.ts`'s job,
 * matching `gap/provider.ts` and `session-builder/provider.ts`'s own split
 * between "the walk" and "the pure compose". `buildRegistryModel` is
 * therefore synchronous and a pure function of its input, which is what
 * makes it directly unit-testable against a fixture list of records rather
 * than a fake vault.
 *
 * ## Instrument mix, and the M:N rule
 *
 * `VaultInstrumentRecord.conceptIds` is non-empty and can name several
 * concepts (`D-031`, `../session/types.ts`'s own doc — "one instrument, one
 * candidate, several concepts"). This module honours that: an instrument
 * shared by two concepts appears in both entries' `instruments`, never
 * narrowed to one. Concepts with zero instruments are still included (a
 * concept extracted from a `topic:` property with no card written for it
 * yet is real, and F8.4 asks for a browsable inventory, not a filtered one).
 *
 * ## Sort order
 *
 * By resolved display name, then by key — deterministic regardless of
 * extraction order or Map iteration order, and (per `./overrides.ts`'s own
 * doc) stable across a rename that lands in the same alphabetical bucket it
 * started in only coincidentally; a rename that changes the bucket moves the
 * row, which is the honest behaviour for an alphabetised list.
 */

import {
  computeAllConceptMastery,
  conceptIdsInLog,
  readAllConceptVitality,
} from '../mastery/rollup.js';
import { aliasesFor, isConceptPruned, resolvedDisplayName } from './overrides.js';
import type {
  BuildRegistryModelInput,
  RegistryConceptEntry,
  RegistryExplainBackSummary,
  RegistryInstrumentSummary,
  RegistryModel,
} from './types.js';

function instrumentSummary(
  record: BuildRegistryModelInput['instrumentRecords'][number],
  suspended: ReadonlySet<string>,
): RegistryInstrumentSummary {
  return {
    instrumentId: record.instrumentId,
    instrumentType: record.instrumentType,
    conceptIds: record.conceptIds,
    notePath: record.notePath,
    noteTitle: record.noteTitle,
    blockId: record.blockId,
    heading: record.heading,
    pruned: suspended.has(record.instrumentId),
  };
}

/**
 * Every instrument summary indexed by the concept ids it names — one entry
 * per (instrument, concept) pair, matching the M:N rule this module's doc
 * states. Vault-then-source order is preserved because `instrumentRecords`
 * already arrives in that order (`enumerateVaultInstruments`'s own doc) and
 * this only ever appends.
 */
function groupInstrumentsByConcept(
  instrumentRecords: BuildRegistryModelInput['instrumentRecords'],
  suspended: ReadonlySet<string>,
): ReadonlyMap<string, RegistryInstrumentSummary[]> {
  const byConcept = new Map<string, RegistryInstrumentSummary[]>();
  for (const record of instrumentRecords) {
    const summary = instrumentSummary(record, suspended);
    for (const conceptId of record.conceptIds) {
      const bucket = byConcept.get(conceptId);
      if (bucket === undefined) byConcept.set(conceptId, [summary]);
      else bucket.push(summary);
    }
  }
  return byConcept;
}

/** F8.4's "instrument mix... plus explain-back" — explain-back has no vault-persisted record to browse, so it is counted from the review log rather than the instrument walk (see `./types.ts`'s `RegistryExplainBackSummary` doc). */
function explainBackSummaryFor(
  entries: BuildRegistryModelInput['entries'],
  conceptId: string,
): RegistryExplainBackSummary {
  let attemptCount = 0;
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (entry.instrumentType !== 'explain-back') continue;
    if (!entry.conceptIds.includes(conceptId)) continue;
    attemptCount += 1;
  }
  return { attempted: attemptCount > 0, attemptCount };
}

function compareEntries(a: RegistryConceptEntry, b: RegistryConceptEntry): number {
  if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Builds the whole registry model — pure, synchronous, and (per this
 * module's doc) not itself responsible for reading the vault or the log.
 *
 * `input.concepts` is de-duplicated by `key`, first-wins, the same defence
 * `buildMasteryOverview` (`../today/mastery-overview.ts`) uses against a
 * caller that (accidentally, or because two extraction passes ran) hands in
 * the same concept twice.
 */
export function buildRegistryModel(input: BuildRegistryModelInput): RegistryModel {
  const seen = new Set<string>();
  const concepts = input.concepts.filter((concept) => {
    if (seen.has(concept.key)) return false;
    seen.add(concept.key);
    return true;
  });

  const instrumentsByConcept = groupInstrumentsByConcept(
    input.instrumentRecords,
    input.suspendedInstrumentIds,
  );

  // Every concept id the review log itself names, unioned with the concepts
  // this walk found — a concept whose note has since been renamed away can
  // still carry review-log evidence under an id this walk no longer mints,
  // and mastery/vitality should still be answerable for it rather than
  // silently dropped. It will not appear as a browsable row (there is no
  // `ConceptRecord` to build one from), but the rollup functions below never
  // fail for an id with no matching record.
  const conceptIds = concepts.map((c) => c.key);
  const idsForRollup = new Set([...conceptIds, ...conceptIdsInLog(input.entries)]);

  const masteryByConcept = computeAllConceptMastery(input.entries, [...idsForRollup]);
  const vitalityByConcept = readAllConceptVitality(
    input.entries,
    [...idsForRollup],
    input.scheduler,
    input.now,
    input.holdingCut,
  );

  const entries: RegistryConceptEntry[] = concepts.map((concept) => {
    const displayName = resolvedDisplayName(input.overrides, concept.key, concept.name);
    const mastery = masteryByConcept.get(concept.key);
    const vitality = vitalityByConcept.get(concept.key);
    if (mastery === undefined || vitality === undefined) {
      // Unreachable given `idsForRollup` is a superset of `conceptIds` above —
      // guarded rather than trusted, matching this codebase's own convention
      // (`../mastery/rollup.ts`'s `resolveOptions`) of failing loudly on an
      // invariant a future refactor could otherwise silently break.
      throw new Error(
        `buildRegistryModel: no mastery/vitality computed for concept ${concept.key}`,
      );
    }
    return {
      key: concept.key,
      displayName,
      originalName: concept.name,
      aliases: aliasesFor(input.overrides, concept.key),
      courses: concept.courses,
      tier: concept.tier,
      pruned: isConceptPruned(input.overrides, concept.key),
      instruments: instrumentsByConcept.get(concept.key) ?? [],
      explainBack: explainBackSummaryFor(input.entries, concept.key),
      mastery,
      vitality,
    };
  });

  entries.sort(compareEntries);
  return { concepts: entries };
}
