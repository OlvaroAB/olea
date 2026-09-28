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
 * three. `carries` is computed independently, for EVERY concept in scope,
 * practised or not (`[D-388]`, ruled 2026-09-27: option (a); the earlier
 * skip of too-early concepts, the review's "early-continue branch", is
 * removed rather than kept behind an option). A concept can appear in
 * `carries` AND in `held`, `faded` or the too-early count at once — it is a
 * cross-cutting reading, never a fourth bucket, and it never changes which
 * of the three a concept is counted in.
 *
 * ## What carries records, per `[D-388]`
 *
 * Each entry names its basis per later course (that course's declared scope,
 * or Olea's labelled reading of it; condition 3) and whether the concept has
 * qualifying practice history (condition 1): the same sufficiency floor that
 * separates held and faded from too early, so an entry whose concept is
 * counted too early always says it has none, and nothing here words, counts
 * or files it as faded (condition 2). History crosses courses only through
 * one identity: the same key, or a same-as link she confirmed (condition 4,
 * `[D-402]`); two concepts sharing only a label stay two concepts.
 *
 * ## Not a score, not a verdict
 *
 * Nothing here computes a ratio, a percentage, or a pass/fail judgement.
 * `RetrospectiveReading` carries independent counts and named lines; F8.3's
 * ban on a scalar (cited by F8.8 "with more force rather than less") is
 * upheld structurally — there is no field a caller could read as a quotient.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { buildSameAsKeyRedirect } from '../concept/same-as-consumer.js';
import { computeConceptMastery, readAllConceptVitality } from '../mastery/rollup.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import type {
  RetrospectiveCarriesEntry,
  RetrospectiveCarryBasis,
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

/**
 * Merges rows of `(conceptId, courses)` into one course set per IDENTITY —
 * a concept can be named more than once across the input, and a confirmed
 * same-as link names one identity by two ids (`identityOf`), matching
 * `earlier-course-recognition.ts`'s own helper. A blank course name is
 * never a course.
 */
function courseSetsByIdentity(
  rows: readonly { readonly conceptId: string; readonly courses: readonly string[] }[],
  identityOf: (conceptId: string) => string,
): Map<string, Set<string>> {
  const byIdentity = new Map<string, Set<string>>();
  for (const row of rows) {
    const identity = identityOf(row.conceptId);
    const set = byIdentity.get(identity) ?? new Set<string>();
    for (const course of row.courses) if (course !== '') set.add(course);
    byIdentity.set(identity, set);
  }
  return byIdentity;
}

interface CarriesContext {
  readonly course: string;
  readonly identityOf: (conceptId: string) => string;
  /** Courses whose material holds each identity: Olea's reading of their scope. */
  readonly readingCourses: ReadonlyMap<string, ReadonlySet<string>>;
  /** Courses whose examiner-declared units are aligned to each identity. */
  readonly declaredCourses: ReadonlyMap<string, ReadonlySet<string>>;
  readonly finalAssessmentIdentities: ReadonlySet<string> | undefined;
  readonly finalAssessmentBasis: RetrospectiveCarryBasis;
}

const NO_COURSES: ReadonlySet<string> = new Set<string>();

function buildCarriesEntry(
  conceptId: string,
  conceptName: string,
  hasQualifyingPractice: boolean,
  ctx: CarriesContext,
): RetrospectiveCarriesEntry | null {
  const identity = ctx.identityOf(conceptId);
  const reading = ctx.readingCourses.get(identity) ?? NO_COURSES;
  const declared = ctx.declaredCourses.get(identity) ?? NO_COURSES;
  const otherCourses = [...new Set([...reading, ...declared])]
    .filter((c) => c !== ctx.course)
    .sort();
  if (otherCourses.length > 0) {
    return {
      conceptId,
      conceptName,
      otherCourses,
      carriesToFinalAssessment: false,
      destinations: otherCourses.map((course) => ({
        course,
        basis: declared.has(course) ? 'declared-scope' : 'olea-reading',
      })),
      finalAssessmentBasis: null,
      hasQualifyingPractice,
    };
  }
  if (ctx.finalAssessmentIdentities?.has(identity) === true) {
    return {
      conceptId,
      conceptName,
      otherCourses: [],
      carriesToFinalAssessment: true,
      destinations: [],
      finalAssessmentBasis: ctx.finalAssessmentBasis,
      hasQualifyingPractice,
    };
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
  // `ol-egov.141.89.9.61`: vitality is a CURRENT reading (`[D-338]` item 3),
  // so a contest resolved `corrected` must exclude its instrument here too,
  // when `input.disputes` supplies one — the same dispute-aware projection
  // `registry/build.ts`'s own vitality read now folds. Defaults to none
  // (`RetrospectiveInput.disputes`'s own doc): a rejection already inside
  // `entries` still excludes without it.
  const vitalityByConceptId = readAllConceptVitality(
    entries,
    conceptIds,
    input.scheduler,
    input.now,
    input.holdingCut,
    projectInstrumentValidity(entries, input.disputes ?? []),
  );
  // `[D-388]` condition 4 / `[D-402]`: one identity is the same key or a
  // CONFIRMED same-as link, nothing weaker; with no links the redirect is
  // empty and every id is its own identity. Used for what carries only: the
  // partition reads each concept's own evidence, exactly as before.
  const redirect =
    input.sameAsLinks !== undefined
      ? buildSameAsKeyRedirect(input.sameAsLinks, input.canonicalKeys)
      : new Map<string, string>();
  const identityOf = (id: string): string => redirect.get(id) ?? id;
  const carriesContext: CarriesContext = {
    course: input.course,
    identityOf,
    readingCourses: courseSetsByIdentity(input.conceptCourses, identityOf),
    declaredCourses: courseSetsByIdentity(
      (input.declaredScopes ?? []).flatMap((scope) =>
        scope.conceptIds.map((conceptId) => ({ conceptId, courses: [scope.course] })),
      ),
      identityOf,
    ),
    finalAssessmentIdentities:
      input.finalAssessmentScope === undefined
        ? undefined
        : new Set(input.finalAssessmentScope.map((c) => identityOf(c.conceptId))),
    finalAssessmentBasis:
      input.finalAssessmentScopeOrigin === 'assessment-stated' ? 'declared-scope' : 'olea-reading',
  };
  // `ol-a07q` (`[D-281]` item 4): the displayed stage must exclude evidence
  // from an instrument proven invalid — a `rejected` verdict or a contest
  // resolved `corrected` (`../mastery/validity.ts`, `ol-v7r5.69`'s close
  // reason) — the same fold `../registry/build.ts`'s `buildRegistryModel`
  // already threads into its own stage read. Folded once over the whole
  // input log, not per concept.
  const invalidInstrumentIds = [...projectInstrumentValidity(entries).provenInvalid.keys()];

  const held: RetrospectiveConceptLine[] = [];
  const faded: RetrospectiveConceptLine[] = [];
  let tooEarlyCount = 0;
  const carries: RetrospectiveCarriesEntry[] = [];

  for (const { conceptId, conceptName } of input.scope) {
    const vitality = vitalityByConceptId.get(conceptId);
    // Absent from the map is unreachable in practice — `readAllConceptVitality`
    // returns an entry for every id it is asked about — but read as `'early'`
    // (no durable reading) rather than thrown, matching this package's
    // "an absent signal reads neutral/honest, never crashes the surface" rule
    // (`oracle/rank.ts`'s `resolveMasteryState`, `resolveRetrievabilityWeight`).
    const value = vitality?.value ?? 'early';

    // `[D-388]`: what carries is computed for every concept in scope, before
    // and apart from the partition, so a too-early concept can carry while
    // staying counted once, in `tooEarlyCount`.
    const carriesEntry = buildCarriesEntry(
      conceptId,
      conceptName,
      value !== 'early',
      carriesContext,
    );
    if (carriesEntry !== null) carries.push(carriesEntry);

    if (value === 'early') {
      tooEarlyCount += 1;
      continue;
    }

    const { state } = computeConceptMastery(entries, conceptId, { invalidInstrumentIds });
    const line: RetrospectiveConceptLine = {
      conceptId,
      conceptName,
      stage: state,
      vitality: value,
    };
    if (value === 'holding') held.push(line);
    else faded.push(line);
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
