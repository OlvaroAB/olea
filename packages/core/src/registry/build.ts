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
 *
 * ## F8.4b — per-instrument explain-back history (`[D-175]`, `ol-0r92.18`)
 *
 * `RegistryInstrumentSummary.explainBackHistory` is a THIN, read-time
 * overlay: `explainBackGradeHistoryByInstrument` (`../review-log/explain-back-
 * history.ts`) already folds the whole log into "which graded attempts
 * belong to which instrument, oldest first, which one is current" — this
 * module does no folding of its own, only a lookup by `instrumentId` per
 * instrument summary, the same posture it already takes toward mastery and
 * vitality. `input.disputes` is `[]` by default because
 * `session/history.ts`'s `readReviewLogHistory` (the walk `provider.ts`
 * uses) does not surface dispute records — see `BuildRegistryModelInput`'s
 * own doc in `./types.ts`. A caller that never supplies `disputes` still
 * gets a fully honest history, simply with no row ever marked contested,
 * which is the correct default for "unknown" rather than a fabricated
 * "definitely not contested."
 *
 * Only an INSTRUMENT-SEEDED explain-back attempt gets a row here — see
 * `RegistryInstrumentSummary.explainBackHistory`'s own doc in `./types.ts`
 * for why a freeform/topic-seeded attempt (no real vault instrument to
 * attach to) is invisible at this grain and still counted at the concept
 * grain by `explainBackSummaryFor` below.
 */

import type { Provenance } from '../extract/types.js';
import {
  computeAllConceptMastery,
  conceptIdsInLog,
  readAllConceptVitality,
} from '../mastery/rollup.js';
import { quarantinedGradeInstrumentIds } from '../review-log/contest.js';
import {
  type ExplainBackHistoryEntry,
  explainBackGradeHistoryByInstrument,
} from '../review-log/explain-back-history.js';
import { aliasesFor, isConceptPruned, resolvedDisplayName } from './overrides.js';
import type {
  BuildRegistryModelInput,
  RegistryConceptEntry,
  RegistryExplainBackHistoryRow,
  RegistryExplainBackSummary,
  RegistryInstrumentSummary,
  RegistryModel,
  RegistrySourceLocation,
} from './types.js';

/**
 * `RegistrySourceLocation`'s optional `page`/`section` follow `SourceLocation`'s
 * own "undefined means no structure exists" convention — never present as a
 * key with value `undefined`, only genuinely absent, so a caller that does
 * `Object.keys` or serialises the location never sees a phantom field.
 */
function passageGrain(
  location: Provenance['location'],
): Pick<RegistrySourceLocation, 'page' | 'section'> {
  return location.section === undefined
    ? { page: location.page }
    : { page: location.page, section: location.section };
}

/**
 * `[D-171]`'s per-instrument provenance. Always exactly one location — the
 * instrument's own note/heading/block, restated as a `RegistrySourceLocation`
 * — plus page/section grain when `VaultInstrumentRecord.sourceProvenance`
 * (`ol-2zfj.48`) is present. That field is itself optional and `undefined`
 * for every record `enumerate.ts` produces today: this walk reports
 * instruments already written INTO a note, never a generation-time citation
 * to the PDF/PPTX page or slide the material was drawn FROM. So a real vault
 * read still shows note-grain-only locations until a generation-time caller
 * populates `sourceProvenance` — see `../session/types.js`'s doc on that
 * field and this module's own doc.
 */
function instrumentSourceLocations(
  record: BuildRegistryModelInput['instrumentRecords'][number],
): readonly RegistrySourceLocation[] {
  const base: RegistrySourceLocation = {
    sourcePath: record.notePath,
    heading: record.heading,
    blockId: record.blockId,
  };
  const provenance = record.sourceProvenance;
  if (provenance === undefined) return [base];
  return [{ ...base, ...passageGrain(provenance.location) }];
}

/**
 * F8.4b's per-instrument explain-back history row set — oldest first,
 * exactly `explainBackGradeHistoryByInstrument`'s own order, with the
 * `[D-095]` contested marker overlaid on the CURRENT (non-superseded) row
 * only. An older, already-superseded attempt never carries the marker even
 * if it was disputed once: `quarantinedGradeInstrumentIds` already applies
 * `[D-095]`'s evidence-relative aging (a dispute retires once the claim it
 * rode recomputes on new evidence), so the only grade that CAN be presently
 * quarantined is the instrument's current standing one — the same reading
 * GLOSSARY's SOLO rule 3 gives depth ("the MOST RECENT graded explain-back")
 * applied to contest state instead of to the fold.
 */
function explainBackHistoryFor(
  historyByInstrument: ReadonlyMap<string, readonly ExplainBackHistoryEntry[]>,
  quarantinedInstrumentIds: ReadonlySet<string>,
  instrumentId: string,
): readonly RegistryExplainBackHistoryRow[] {
  const entries = historyByInstrument.get(instrumentId) ?? [];
  return entries.map((entry) => ({
    eventId: entry.eventId,
    timestamp: entry.timestamp,
    soloLevel: entry.soloLevel,
    contested: !entry.superseded && quarantinedInstrumentIds.has(instrumentId),
  }));
}

function instrumentSummary(
  record: BuildRegistryModelInput['instrumentRecords'][number],
  suspended: ReadonlySet<string>,
  explainBackHistoryByInstrument: ReadonlyMap<string, readonly ExplainBackHistoryEntry[]>,
  quarantinedInstrumentIds: ReadonlySet<string>,
): RegistryInstrumentSummary {
  return {
    instrumentId: record.instrumentId,
    instrumentType: record.instrumentType,
    conceptIds: record.conceptIds,
    notePath: record.notePath,
    noteTitle: record.noteTitle,
    blockId: record.blockId,
    heading: record.heading,
    sourceLocations: instrumentSourceLocations(record),
    explainBackHistory: explainBackHistoryFor(
      explainBackHistoryByInstrument,
      quarantinedInstrumentIds,
      record.instrumentId,
    ),
    pruned: suspended.has(record.instrumentId),
  };
}

/**
 * `[D-171]`'s per-concept provenance — `sourcePaths` (every note whose
 * `topic:` or wikilink named this concept, F1.3) plus `boundNotePath` when
 * the concept is bound to a Zettelkasten note, deduplicated by path and
 * sorted for a deterministic result. Each path carries page/section grain
 * too when `ConceptRecord.anchor`/`.alsoIn` (`ol-2zfj.48`) names that same
 * path — those fields are themselves optional and `undefined` on every mint
 * site `../concept/extract.js` owns today (passage grain is
 * `../concept/read.js`'s `ReadConcept.anchor`/`alsoIn`, a different stage's
 * output not yet folded back onto the same `ConceptRecord`), so a real
 * vault read still shows note-grain-only locations until that fold lands —
 * see this module's doc.
 */
function conceptSourceLocations(
  concept: BuildRegistryModelInput['concepts'][number],
): readonly RegistrySourceLocation[] {
  const byPath = new Map<string, RegistrySourceLocation>();
  const notePaths = new Set<string>(concept.sourcePaths);
  if (concept.boundNotePath !== undefined) notePaths.add(concept.boundNotePath);
  for (const sourcePath of notePaths) byPath.set(sourcePath, { sourcePath });

  const passages: readonly Provenance[] = [
    ...(concept.anchor !== undefined ? [concept.anchor] : []),
    ...(concept.alsoIn ?? []),
  ];
  for (const passage of passages) {
    byPath.set(passage.sourcePath, {
      sourcePath: passage.sourcePath,
      ...passageGrain(passage.location),
    });
  }

  return [...byPath.keys()].sort().map((sourcePath) => {
    const location = byPath.get(sourcePath);
    if (location === undefined) throw new Error(`unreachable: missing location for ${sourcePath}`);
    return location;
  });
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
  explainBackHistoryByInstrument: ReadonlyMap<string, readonly ExplainBackHistoryEntry[]>,
  quarantinedInstrumentIds: ReadonlySet<string>,
): ReadonlyMap<string, RegistryInstrumentSummary[]> {
  const byConcept = new Map<string, RegistryInstrumentSummary[]>();
  for (const record of instrumentRecords) {
    const summary = instrumentSummary(
      record,
      suspended,
      explainBackHistoryByInstrument,
      quarantinedInstrumentIds,
    );
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

  const explainBackHistoryByInstrument = explainBackGradeHistoryByInstrument(input.entries);
  const quarantinedInstrumentIds = new Set(quarantinedGradeInstrumentIds(input.disputes ?? []));

  const instrumentsByConcept = groupInstrumentsByConcept(
    input.instrumentRecords,
    input.suspendedInstrumentIds,
    explainBackHistoryByInstrument,
    quarantinedInstrumentIds,
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
      sourceLocations: conceptSourceLocations(concept),
      instruments: instrumentsByConcept.get(concept.key) ?? [],
      explainBack: explainBackSummaryFor(input.entries, concept.key),
      mastery,
      vitality,
    };
  });

  entries.sort(compareEntries);
  return { concepts: entries };
}
