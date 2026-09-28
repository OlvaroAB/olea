/**
 * The population record and per-unit coverage (`ol-egov.141.89.11.4`; the standing
 * views chain spec, `docs/dev/intelligence-build/vew.md` in olea-service, sections 2.1
 * and 2.2).
 *
 * **What it answers.** Before any coverage number is formed, what does the course's
 * count count, over what, and how much of it is known? The spec's list, per course:
 * the counted unit; the denominator and the documents that supplied it; the reading
 * state of the examiner's documents and of her material, apart; the extraction state
 * of declarations and of concepts, apart; then each declared unit on four dimensions
 * (declared, material, practice, evidence), never collapsed; the per-state counts,
 * the unmatched units, the volunteers, the in-flight and stuck sets; and whether the
 * exhaustive claim is allowed.
 *
 * **The rulings it holds.**
 * - `[D-355]`: the examiner's declared unit is the counted unit. A unit with no
 *   matching concept, or an ambiguous alignment, stays in the denominator. Where no
 *   examiner document exists there is no count: the counted unit is Olea's own
 *   concept reading, which must carry its label (`[D-151]`), and the denominator
 *   reads not declared.
 * - `[D-326]`: an unread or partly read region is unknown, never absent. A unit
 *   reads missing from her material only when every source of her material was read
 *   in full and concept extraction finished; finishing a reading never marks
 *   extraction finished. A document with no completeness record reads unknown.
 * - The spec's 2.2: support is a set (a broad concept and its own part are one set,
 *   one entry); a concept aligned to two units supports both, each counted once; a
 *   broad unit is never dropped because a narrower unit is matched; a unit counts on
 *   a dimension as `every` only when its whole support meets it, `some` kept apart;
 *   stuck counts processing passes, never renders.
 *
 * **Class B defaults, flagged for review** (none is a ruling):
 * 1. Per-state counts and the unmatched list are formed when the denominator is
 *    known or partly read (they count the units listed, each with a known state);
 *    volunteers only when it is known, since a concept may align to a unit in the
 *    unread part.
 * 2. A declaration aligned only to withdrawn concepts reads as having no concept in
 *    her material.
 * 3. A course with no material at all reads its material as read in full, so a
 *    declared unit with no concept reads missing from it.
 * 4. The exhaustive claim is withheld over a document or source that was read and
 *    held nothing, the same as the gap view's existing gate.
 * 5. Several examiner documents' declaration extraction summarise to the least
 *    finished state (failed, cut short, pending, unknown, finished).
 *
 * **INV-1.** Pure computation over inputs the caller gathered; no vault, no clock,
 * nothing stored. Same inputs in any order, same population.
 */

import type {
  ConceptEvidenceState,
  CoursePopulation,
  CoursePopulationInput,
  DeclaredUnitCoverage,
  DenominatorState,
  ExhaustiveWithholdReason,
  PopulationCounts,
  PopulationDeclarationInput,
  PopulationDocumentInput,
  PopulationExtractionState,
  PopulationExtractionSummary,
  PopulationReading,
  PopulationReadingSummary,
  UnitMaterialState,
  UnitSupportState,
} from './types.js';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(byString);
}

/** One summary over a set: `none` when empty, the shared state, else `mixed`; a missing record reads `unknown`. */
function summariseReadings(
  readings: readonly (PopulationReading | null)[],
): PopulationReadingSummary {
  if (readings.length === 0) return 'none';
  const states = new Set(readings.map((r) => r?.state ?? 'unknown'));
  if (states.size === 1) return [...states][0] as PopulationReadingSummary;
  return 'mixed';
}

/** Least finished first: the order an extraction summary is read by. */
const EXTRACTION_ORDER: readonly PopulationExtractionSummary[] = [
  'failed',
  'cut-short',
  'pending',
  'unknown',
  'finished',
];

function summariseExtractions(
  states: readonly (PopulationExtractionState | null)[],
): PopulationExtractionSummary {
  if (states.length === 0) return 'none';
  const present = new Set<PopulationExtractionSummary>(states.map((s) => s ?? 'unknown'));
  return EXTRACTION_ORDER.find((s) => present.has(s)) ?? 'unknown';
}

function denominatorStateOf(
  storeReadable: boolean,
  examinerDocuments: readonly PopulationDocumentInput[],
): DenominatorState {
  if (!storeReadable) return 'could-not-read';
  if (examinerDocuments.length === 0) return 'not-declared';
  if (examinerDocuments.some((d) => d.reading?.state === 'unreadable')) return 'could-not-read';
  if (
    examinerDocuments.some(
      (d) =>
        d.reading === null ||
        d.reading.state === 'unread' ||
        d.declarationExtraction !== 'finished',
    )
  ) {
    return 'not-yet-known';
  }
  if (examinerDocuments.some((d) => d.reading?.state === 'partial')) return 'partly-read';
  return 'known';
}

/** Declarations from the course's examiner documents, one per declaration id (aligned keys unioned), by id. */
function countedDeclarations(
  declarations: readonly PopulationDeclarationInput[],
  examinerIds: ReadonlySet<string>,
): PopulationDeclarationInput[] {
  const byId = new Map<string, PopulationDeclarationInput>();
  for (const d of declarations) {
    if (!examinerIds.has(d.documentId)) continue;
    const prior = byId.get(d.declarationId);
    if (prior === undefined) {
      byId.set(d.declarationId, d);
      continue;
    }
    const aligned = prior.alignment === 'aligned' || d.alignment === 'aligned';
    byId.set(d.declarationId, {
      ...prior,
      alignment: aligned ? 'aligned' : prior.alignment,
      conceptKeys: [
        ...(prior.alignment === 'aligned' ? prior.conceptKeys : []),
        ...(d.alignment === 'aligned' ? d.conceptKeys : []),
      ],
    });
  }
  return [...byId.values()].sort((a, b) => byString(a.declarationId, b.declarationId));
}

type ConceptMaterial = 'read' | 'partial' | 'unknown';

function supportState(total: number, met: number, unknown: number): UnitSupportState {
  if (total > 0 && met === total) return 'every';
  if (met > 0) return 'some';
  if (unknown > 0) return 'not-yet-known';
  return 'none';
}

function emptyCounts(): { -readonly [K in keyof PopulationCounts]: Record<string, number> } {
  return {
    material: { read: 0, 'partly-read': 0, missing: 0, 'not-yet-known': 0 },
    practice: { every: 0, some: 0, none: 0, 'not-yet-known': 0 },
    evidence: { every: 0, some: 0, none: 0, 'not-yet-known': 0 },
  };
}

/** One course's population record and per-unit coverage. See the module doc for every rule. */
export function buildCoursePopulation(input: CoursePopulationInput): CoursePopulation {
  const storeReadable = input.documentStoreReadable !== false;
  const documents = storeReadable ? input.documents : [];
  const examinerDocuments = [...documents.filter((d) => d.examiner)].sort((a, b) =>
    byString(a.documentId, b.documentId),
  );
  const materialDocuments = documents.filter((d) => !d.examiner);

  // Her material: every source, and every document registered (or reclassified) into a
  // non-examiner role.
  const materialReadings = new Map<string, PopulationReading | null>();
  for (const s of input.sources) materialReadings.set(s.sourceId, s.reading);
  for (const d of materialDocuments) materialReadings.set(d.documentId, d.reading);
  const materialItems = [...materialReadings.values()];

  const liveConcepts = new Map(
    input.concepts.filter((c) => c.withdrawn !== true).map((c) => [c.conceptKey, c]),
  );
  const withdrawnKeys = new Set(
    input.concepts.filter((c) => c.withdrawn === true).map((c) => c.conceptKey),
  );
  const withEligibleInstrument = new Set(
    input.instruments.filter((i) => i.standing === 'eligible').flatMap((i) => i.conceptKeys),
  );

  const countedUnit =
    examinerDocuments.length > 0
      ? 'declared-unit'
      : !storeReadable
        ? 'unknown'
        : liveConcepts.size > 0
          ? 'concept-labelled'
          : 'unknown';

  const denominatorState = denominatorStateOf(storeReadable, examinerDocuments);
  const declarations = countedDeclarations(
    input.declarations,
    new Set(examinerDocuments.map((d) => d.documentId)),
  );

  const materialReadInFull = materialItems.every(
    (r) => r !== null && (r.state === 'complete' || r.state === 'read-empty'),
  );
  const conceptExtractionFinished =
    materialItems.length === 0 && liveConcepts.size === 0
      ? input.conceptExtraction === null || input.conceptExtraction === 'finished'
      : input.conceptExtraction === 'finished';
  const missingIsKnowable = materialReadInFull && conceptExtractionFinished;

  const conceptMaterial = (key: string): ConceptMaterial => {
    const sourceIds = liveConcepts.get(key)?.sourceIds ?? [];
    const readings = sourceIds.map((id) => materialReadings.get(id) ?? null);
    if (readings.length === 0) return 'unknown';
    if (readings.every((r) => r?.state === 'complete')) return 'read';
    if (readings.some((r) => r?.state === 'complete' || r?.state === 'partial')) return 'partial';
    return 'unknown';
  };
  const evidenceOf = (key: string): ConceptEvidenceState | undefined =>
    input.conceptEvidence.get(key);

  const units: DeclaredUnitCoverage[] = declarations.map((d) => {
    const base = {
      declarationId: d.declarationId,
      documentId: d.documentId,
      revision: d.revision,
      counted: true as const,
      entries: 1 as const,
    };
    if (d.alignment === 'not-aligned') {
      return {
        ...base,
        alignment: 'not-aligned',
        support: [],
        material: 'not-yet-known',
        practice: 'not-yet-known',
        evidence: 'not-yet-known',
      };
    }
    const support =
      d.alignment === 'aligned'
        ? sortedUnique(d.conceptKeys).filter((k) => !withdrawnKeys.has(k))
        : [];
    if (support.length === 0) {
      return {
        ...base,
        alignment: 'no-concept',
        support: [],
        material: missingIsKnowable ? 'missing' : 'not-yet-known',
        practice: 'none',
        evidence: 'none',
      };
    }
    const materials = support.map(conceptMaterial);
    const material: UnitMaterialState = materials.every((m) => m === 'read')
      ? 'read'
      : materials.every((m) => m === 'unknown')
        ? 'not-yet-known'
        : 'partly-read';
    const practised = support.filter((k) => withEligibleInstrument.has(k)).length;
    const evidence = support.map(evidenceOf);
    return {
      ...base,
      alignment: 'aligned',
      support,
      material,
      practice: supportState(support.length, practised, 0),
      evidence: supportState(
        support.length,
        evidence.filter((e) => e === 'assessed').length,
        evidence.filter((e) => e === undefined).length,
      ),
    };
  });

  const countsFormed = denominatorState === 'known' || denominatorState === 'partly-read';
  let counts: PopulationCounts | null = null;
  if (countsFormed) {
    const tally = emptyCounts();
    for (const u of units) {
      tally.material[u.material] = (tally.material[u.material] ?? 0) + 1;
      tally.practice[u.practice] = (tally.practice[u.practice] ?? 0) + 1;
      tally.evidence[u.evidence] = (tally.evidence[u.evidence] ?? 0) + 1;
    }
    counts = tally as unknown as PopulationCounts;
  }

  const supportingKeys = sortedUnique(units.flatMap((u) => u.support));
  const supported = new Set(supportingKeys);
  const inFlight = storeReadable
    ? supportingKeys.filter(
        (k) => (liveConcepts.get(k)?.sourceIds.length ?? 0) > 0 && !withEligibleInstrument.has(k),
      )
    : null;
  let stuck: string[] | null = null;
  if (inFlight !== null && input.processingPasses !== undefined) {
    const passesQueuing = new Map<string, Set<string>>();
    for (const pass of input.processingPasses) {
      for (const key of pass.queuedConceptKeys) {
        const set = passesQueuing.get(key) ?? new Set<string>();
        set.add(pass.passId);
        passesQueuing.set(key, set);
      }
    }
    stuck = inFlight.filter((k) => (passesQueuing.get(k)?.size ?? 0) >= 2);
  }

  const reasons = new Set<ExhaustiveWithholdReason>();
  if (!storeReadable) reasons.add('document-store-unreadable');
  if (units.length === 0) reasons.add('no-declared-unit');
  if (units.some((u) => u.alignment !== 'aligned')) reasons.add('unit-not-aligned');
  if (examinerDocuments.some((d) => d.reading?.state !== 'complete')) {
    reasons.add('examiner-document-not-read-in-full');
  }
  if (examinerDocuments.some((d) => d.declarationExtraction !== 'finished')) {
    reasons.add('declaration-extraction-unfinished');
  }
  if (
    materialItems.some((r) => r?.state !== 'complete') ||
    units.some((u) => u.alignment === 'aligned' && u.material !== 'read')
  ) {
    reasons.add('material-not-read-in-full');
  }
  if (input.conceptExtraction !== 'finished') reasons.add('concept-extraction-unfinished');
  const REASON_ORDER: readonly ExhaustiveWithholdReason[] = [
    'document-store-unreadable',
    'no-declared-unit',
    'unit-not-aligned',
    'examiner-document-not-read-in-full',
    'declaration-extraction-unfinished',
    'material-not-read-in-full',
    'concept-extraction-unfinished',
  ];
  const exhaustiveWithheldBecause = REASON_ORDER.filter((r) => reasons.has(r));

  const denominatorSources = examinerDocuments.map((d) => ({
    documentId: d.documentId,
    revision: d.revision,
    revisionDate: d.revisionDate,
  }));
  const asOf =
    denominatorSources
      .map((s) => s.revisionDate)
      .filter((day): day is string => day !== null)
      .sort(byString)
      .at(-1) ?? null;

  return {
    courseId: input.courseId,
    countedUnit,
    labelRequired: countedUnit === 'concept-labelled',
    denominator: {
      state: denominatorState,
      value: denominatorState === 'known' ? units.length : null,
      sources: denominatorSources,
      asOf,
    },
    readingState: {
      examiner: storeReadable
        ? summariseReadings(examinerDocuments.map((d) => d.reading))
        : 'unknown',
      material: storeReadable ? summariseReadings(materialItems) : 'unknown',
    },
    extractionState: {
      declarations: storeReadable
        ? summariseExtractions(examinerDocuments.map((d) => d.declarationExtraction))
        : 'unknown',
      concepts:
        input.conceptExtraction ??
        (materialItems.length === 0 && liveConcepts.size === 0 ? 'none' : 'unknown'),
    },
    units,
    counts,
    unmatched: countsFormed
      ? units.filter((u) => u.material === 'missing').map((u) => u.declarationId)
      : null,
    volunteers:
      denominatorState === 'known'
        ? [...liveConcepts.keys()].filter((k) => !supported.has(k)).sort(byString)
        : null,
    inFlight,
    stuck,
    exhaustive: exhaustiveWithheldBecause.length === 0 ? 'allowed' : 'withheld',
    exhaustiveWithheldBecause,
  };
}

/** {@link buildCoursePopulation} for every course, by course id. */
export function buildCoursePopulations(
  inputs: readonly CoursePopulationInput[],
): readonly CoursePopulation[] {
  return inputs.map(buildCoursePopulation).sort((a, b) => byString(a.courseId, b.courseId));
}
