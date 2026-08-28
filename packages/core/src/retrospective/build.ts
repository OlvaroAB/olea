/**
 * `buildRetrospective` — F8.8's whole computation (`[POST-1]`, `[D-134]`).
 * Pure, no I/O, no cache — recomputed fresh every time, matching this
 * package's rule throughout (`rank.ts`, `earlier-course-recognition.ts`):
 * nothing here is a source of truth, only a projection over the log and the
 * caller-resolved scope (see `types.ts`'s module doc for why scope itself is
 * a caller input rather than something derived here).
 *
 * ## The three groupings are a partition; "carries" is an overlay
 *
 * DSN-2's central finding (`docs/design/dsn2-retrospective/NOTES.md` §1, in
 * olea-service): F8.8 names three groupings and the vitality axis has three
 * values, and they are not the same three. `held` (vitality `holding`) and
 * `faded` (vitality `tending`) partition the scope together with
 * `tooEarlyCount` (vitality `early`, STATED as a count rather than filed
 * under either list) — every concept in scope lands in exactly one of the
 * three. `carries` is computed independently, over `held` and `faded` only
 * (never over the too-early set, which has no durable evidence for F8.7's
 * derivation to read), and a concept can appear in `carries` AND in `held`
 * or `faded` at once — it is a cross-cutting reading, not a fourth bucket.
 *
 * ## Not a score, not a verdict
 *
 * Nothing here computes a ratio, a percentage, or a pass/fail judgement.
 * `RetrospectiveReading` carries independent counts and named lines; F8.3's
 * ban on a scalar (cited by F8.8 "with more force rather than less") is
 * upheld structurally — there is no field a caller could read as a quotient.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { computeConceptMastery, readAllConceptVitality } from '../mastery/rollup.js';
import type {
  RetrospectiveCarriesLine,
  RetrospectiveConceptLine,
  RetrospectiveInput,
  RetrospectiveReading,
} from './types.js';

function compareByConceptName(
  a: { readonly conceptName: string },
  b: { readonly conceptName: string },
): number {
  return a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0;
}

/** Merges every `ConceptCourses` row into one course set per concept id — a concept can be named more than once across the input, matching `earlier-course-recognition.ts`'s own helper. */
function courseSetsByConcept(
  conceptCourses: RetrospectiveInput['conceptCourses'],
): Map<string, Set<string>> {
  const byConcept = new Map<string, Set<string>>();
  for (const row of conceptCourses) {
    const set = byConcept.get(row.conceptId) ?? new Set<string>();
    for (const course of row.courses) set.add(course);
    byConcept.set(row.conceptId, set);
  }
  return byConcept;
}

function buildCarriesLine(
  conceptId: string,
  conceptName: string,
  course: string,
  courseSets: Map<string, Set<string>>,
  finalAssessmentScope: readonly { readonly conceptId: string }[] | undefined,
): RetrospectiveCarriesLine | null {
  const otherCourses = [...(courseSets.get(conceptId) ?? new Set<string>())]
    .filter((c) => c !== course)
    .sort();
  if (otherCourses.length > 0) {
    return { conceptId, conceptName, otherCourses, carriesToFinalAssessment: false };
  }
  const carriesToFinalAssessment =
    finalAssessmentScope?.some((c) => c.conceptId === conceptId) ?? false;
  if (carriesToFinalAssessment) {
    return { conceptId, conceptName, otherCourses: [], carriesToFinalAssessment: true };
  }
  return null;
}

/**
 * F8.8's whole computation. `input.scope`'s order is not relied on anywhere;
 * every list this function returns is sorted by concept name for a
 * deterministic, diffable result (the same purity/rebuild property
 * `oracle/rank.ts` and `earlier-course-recognition.ts` both hold).
 */
export function buildRetrospective(input: RetrospectiveInput): RetrospectiveReading {
  const entries: readonly ReviewLogEntry[] = input.entries;
  const conceptIds = input.scope.map((c) => c.conceptId);
  const vitalityByConceptId = readAllConceptVitality(
    entries,
    conceptIds,
    input.scheduler,
    input.now,
    input.holdingCut,
  );
  const courseSets = courseSetsByConcept(input.conceptCourses);

  const held: RetrospectiveConceptLine[] = [];
  const faded: RetrospectiveConceptLine[] = [];
  let tooEarlyCount = 0;
  const carries: RetrospectiveCarriesLine[] = [];

  for (const { conceptId, conceptName } of input.scope) {
    const vitality = vitalityByConceptId.get(conceptId);
    // Absent from the map is unreachable in practice — `readAllConceptVitality`
    // returns an entry for every id it is asked about — but read as `'early'`
    // (no durable reading) rather than thrown, matching this package's
    // "an absent signal reads neutral/honest, never crashes the surface" rule
    // (`oracle/rank.ts`'s `resolveMasteryState`, `resolveRetrievabilityWeight`).
    const value = vitality?.value ?? 'early';

    if (value === 'early') {
      tooEarlyCount += 1;
      continue; // too-early concepts carry no durable evidence for `carries` to read.
    }

    const { state } = computeConceptMastery(entries, conceptId);
    const line: RetrospectiveConceptLine = {
      conceptId,
      conceptName,
      stage: state,
      vitality: value,
    };
    if (value === 'holding') held.push(line);
    else faded.push(line);

    const carriesLine = buildCarriesLine(
      conceptId,
      conceptName,
      input.course,
      courseSets,
      input.finalAssessmentScope,
    );
    if (carriesLine !== null) carries.push(carriesLine);
  }

  held.sort(compareByConceptName);
  faded.sort(compareByConceptName);
  carries.sort(compareByConceptName);

  return {
    assessmentPath: input.assessmentPath,
    course: input.course,
    scopeOrigin: input.scopeOrigin,
    scopeCount: input.scope.length,
    held,
    faded,
    tooEarlyCount,
    carries,
  };
}
