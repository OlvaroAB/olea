/**
 * `buildGroveModel` — F8.1's six-state grove coverage computation (`[D-054]`,
 * `ol-o8eo`), the core work `ol-0r92.17`'s grove host filed as a follow-up
 * (`docs/dev` / `ol-z0j9` names the naming tension this closes — see below).
 *
 * ## The denominator is read, never inferred (F8.1)
 *
 * "The examiner's, never Olea's" means the denominator comes from
 * `ConceptCitation` rows `../tier3-evidence/build.js#extractTier3Evidence`
 * already produces for a REGISTERED source (F1.5's `role: 'objectives'` or
 * `role: 'past-paper'`, `../source/register.js`) — never from
 * `kind: 'generated-content'`, which is Olea's own reading of what she wrote
 * and exactly what F8.1 forbids counting. This module recomputes nothing
 * about extraction; it reads `citations` and `sources` verbatim and asks only
 * "which of these are examiner-declared, for this course" — the same
 * "compose once, read here" discipline `../gap/build.ts` and
 * `../evidence-edge/build.ts` already follow for the same tier-3 pass.
 *
 * ## Three course states, not one (F8.1 scenarios 1–3)
 *
 * A course with no registered objectives/past-paper source cannot honestly
 * show a `grove` at all (the word is "**never** used where scope was inferred
 * by Olea alone", registry §6) — so this module returns a three-way status
 * rather than a `GroveCourseModel` that always claims to be one:
 *
 *  - `'no-registered-source'` — no registered source AND nothing Olea has
 *    extracted either. F8.1 scenario 2's designed empty state.
 *  - `'inferred'` — no registered source, but she has concepts of her own.
 *    F8.1 scenario 3: presented as a guess, the `grove` label and its
 *    denominator claim withheld. **This is the exact case `ol-z0j9` flagged**
 *    — the round-27 grove host rendered every course this way, unconditionally,
 *    because this computation did not exist yet. Building this three-way
 *    split is the mechanism that resolves the tension: a caller can now tell
 *    "genuinely inferred" from "declared", and `ol-z0j9`'s naming question
 *    (rename the view? gate it?) stays David's to answer — this module only
 *    makes the two cases distinguishable, it does not rename anything.
 *  - `'declared'` — at least one registered objectives/past-paper source
 *    exists for the course. The real six-state reading below.
 *
 * ## `cells`, `materialGaps` and `volunteers` are three separate arrays, on purpose
 *
 * A `'declared'` course partitions every name it has evidence for into
 * exactly one of two buckets — `cells` (in scope, has material — the six-
 * state reading minus material gaps, via `./coverage.js#classifyDeclaredConcept`)
 * or `materialGaps` (in scope, no material, F4.10, named in plain language
 * per the registry's own ruling that this is NOT a fourth olive noun) — plus
 * `volunteers`, concepts she has that no registered source names at all
 * (F8.2's "self-sown", never hidden or auto-pruned). No concept is ever
 * silently dropped from all three.
 *
 * ## F8.3's ban, enforced at the type level too
 *
 * `GroveCourseSummary` carries a `builtCount` and a `denominatorCount`
 * SEPARATELY — never their quotient. `_assertNoCoverageScalar*` below is the
 * same compile-time tripwire `../concept/types.ts` uses for its own forbidden
 * fields: if a `ratio`/`percent`/`percentage`/`completion`/`quotient` key is
 * ever added to either shape, `pnpm -r typecheck` fails on it.
 *
 * ## INV-1 / §7.1
 *
 * Pure. No `obsidian`, no vault I/O, no clock — every input is already
 * gathered by the caller (mirroring `../registry/build.ts`'s own split
 * between "the walk" and "the pure compose").
 */

import type { ConceptRecord } from '../concept/types.js';
import type { ConceptMaterialPresence } from '../gap/build.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import type { Source, SourceRole } from '../source/types.js';
import type { ConceptCitation, ConceptCitationKind } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { classifyDeclaredConcept, type GroveDeclaredState, isVolunteer } from './coverage.js';

export type { GroveDeclaredState } from './coverage.js';

/** One in-scope concept's coverage reading — one of the five `GroveDeclaredState` values, never `volunteer` (volunteers are a separate array; see module doc). */
export interface GroveCell {
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly state: GroveDeclaredState;
  /** F4.5's stall flag — true only when `state === 'ground'` and it has persisted; see `./coverage.js`'s module doc. */
  readonly stall: boolean;
}

/** An examiner-declared name with no matching material — F4.10, named in plain language (registry §6), never a `GroveCell`. */
export interface GroveMaterialGapCell {
  readonly conceptName: string;
}

/** A concept built from her notes that no registered source names — F8.2's `volunteer`, outside the declared-scope count and never auto-pruned. */
export interface GroveVolunteerCell {
  readonly conceptKey: string;
  readonly conceptName: string;
}

/** F8.3: the count and the denominator's source, carried separately — never their ratio. See the tripwire below this type. */
export interface GroveCourseSummary {
  /** Declared-scope concepts with at least one instrument built — every `cells` entry whose `state !== 'ground'`. */
  readonly builtCount: number;
  /** `cells.length + materialGaps.length` — every name the denominator names, whether or not she has material for it yet. */
  readonly denominatorCount: number;
  /** Which registered documents produced this denominator — F8.1's "the denominator is the examiner's": always traceable to a real, registered source. */
  readonly denominatorSourcePaths: readonly VaultPath[];
}

/** Names forbidden on any grove-facing shape (F8.3) — see this module's doc. */
type ForbiddenCoverageScalarKey =
  | 'ratio'
  | 'percent'
  | 'percentage'
  | 'completion'
  | 'coveragePercent'
  | 'quotient';
type AssertNever<T extends never> = T;
type _assertNoCoverageScalarOnSummary = AssertNever<
  Extract<keyof GroveCourseSummary, ForbiddenCoverageScalarKey>
>;
type _assertNoCoverageScalarOnCell = AssertNever<
  Extract<keyof GroveCell, ForbiddenCoverageScalarKey>
>;

/** One course's grove reading — a three-way status, never a single shape that always claims to be a real `grove` (see module doc). */
export type GroveCourseModel =
  | {
      readonly status: 'no-registered-source';
      readonly course: string;
    }
  | {
      readonly status: 'inferred';
      readonly course: string;
      /** Everything Olea has found for this course — an inference, not the `grove`; the denominator claim is withheld entirely (F8.1 scenario 3). */
      readonly concepts: readonly GroveVolunteerCell[];
    }
  | {
      readonly status: 'declared';
      readonly course: string;
      readonly cells: readonly GroveCell[];
      readonly materialGaps: readonly GroveMaterialGapCell[];
      readonly volunteers: readonly GroveVolunteerCell[];
      readonly summary: GroveCourseSummary;
    };

/** A registered source's role counts toward F8.1's denominator only for these two — F1.5's own two document kinds. `'course-material'` (F3.1) never declares scope. */
const DECLARED_SOURCE_ROLES: ReadonlySet<SourceRole> = new Set(['objectives', 'past-paper']);
/** Mirrors `DECLARED_SOURCE_ROLES` on the citation side — a `'generated-content'` citation is Olea's own reading and never contributes to the denominator. */
const DECLARED_CITATION_KINDS: ReadonlySet<ConceptCitationKind> = new Set([
  'objectives',
  'past-paper',
]);

function sortedUnique(paths: readonly VaultPath[]): readonly VaultPath[] {
  return [...new Set(paths)].sort();
}

function byConceptName<T extends { readonly conceptName: string }>(a: T, b: T): number {
  return a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0;
}

/** Everything `buildGroveModel` needs for ONE course — the caller filters vault-wide reads to `course` on every field except `concepts`, which it scopes itself (matching `../gap/build.ts`'s own course-scoped convention). */
export interface BuildGroveModelInput {
  readonly course: string;
  /** Every `ConceptRecord` associated with `course` (`ConceptRecord.courses`, M:N) — the caller scopes this, not this function. */
  readonly concepts: readonly ConceptRecord[];
  /** `SourceRegistrationReport.sources`, vault-wide — filtered here to `course` and to the two declared roles. */
  readonly sources: readonly Source[];
  /** `ExtractTier3EvidenceResult.citations`, vault-wide — filtered here to `course` and to the two declared kinds. */
  readonly citations: readonly ConceptCitation[];
  /** Per concept KEY — `../gap/build.js#buildMaterialPresence`'s own output, unmodified. */
  readonly materialPresence: ReadonlyMap<string, ConceptMaterialPresence>;
  /** Per concept KEY — `../mastery/rollup.js#computeAllConceptMastery`'s own output, unmodified. */
  readonly mastery: ReadonlyMap<string, ConceptMasteryResult>;
  /** Per concept KEY, the ground-streak each concept carried into THIS evaluation — absent means "never read ground before". See `./coverage.js`'s module doc for why this module holds none of this itself. */
  readonly priorGroundStreaks?: ReadonlyMap<string, number>;
}

export interface BuildGroveModelResult {
  readonly model: GroveCourseModel;
  /** Every concept's ground-streak AFTER this evaluation, keyed by concept KEY — a concept no longer `ground` is simply absent (its streak resets), not zeroed. Hand this whole map back as the next call's `priorGroundStreaks` for the same course. */
  readonly nextGroundStreaks: ReadonlyMap<string, number>;
}

/**
 * Build one course's grove reading — see module doc for the three-way
 * status and the six-state (`ground`/`seed`/`sprout`/`sapling`/`tree`/
 * `volunteer`) reading behind `'declared'`.
 */
export function buildGroveModel(input: BuildGroveModelInput): BuildGroveModelResult {
  const { course } = input;
  const emptyStreaks: ReadonlyMap<string, number> = input.priorGroundStreaks ?? new Map();

  const denominatorSourcePaths = sortedUnique(
    input.sources
      .filter((source) => source.course === course && DECLARED_SOURCE_ROLES.has(source.role))
      .map((source) => source.path),
  );

  // No registered source at all — F8.1 scenarios 2 and 3. Neither branch
  // reads `citations`: with no registered source there is nothing for a
  // citation to have been drawn FROM (a `kind: 'objectives'`/`'past-paper'`
  // citation always cites a registered source of that role), so this gate is
  // sufficient on its own.
  if (denominatorSourcePaths.length === 0) {
    if (input.concepts.length === 0) {
      return { model: { status: 'no-registered-source', course }, nextGroundStreaks: emptyStreaks };
    }
    const concepts: GroveVolunteerCell[] = input.concepts
      .map((concept) => ({ conceptKey: concept.key, conceptName: concept.name }))
      .sort(byConceptName);
    return { model: { status: 'inferred', course, concepts }, nextGroundStreaks: emptyStreaks };
  }

  const declaredNames = new Set(
    input.citations
      .filter((c) => c.course === course && DECLARED_CITATION_KINDS.has(c.kind))
      .map((c) => c.conceptName),
  );

  const conceptsByName = new Map(input.concepts.map((concept) => [concept.name, concept]));

  const cells: GroveCell[] = [];
  const materialGaps: GroveMaterialGapCell[] = [];
  const nextGroundStreaks = new Map<string, number>();

  for (const conceptName of declaredNames) {
    const concept = conceptsByName.get(conceptName);
    if (concept === undefined) {
      // The examiner's document names this concept and her material does
      // not — F4.10, never `ground` (registry §6's "ground correction").
      materialGaps.push({ conceptName });
      continue;
    }

    const presence = input.materialPresence.get(concept.key);
    const hasMaterial = presence !== undefined && presence.notePaths.length > 0;
    const masteryState = input.mastery.get(concept.key)?.state;
    const classification = classifyDeclaredConcept({
      hasMaterial,
      instrumentCount: presence?.instrumentCount ?? 0,
      ...(masteryState !== undefined ? { masteryState } : {}),
      priorGroundStreak: emptyStreaks.get(concept.key) ?? 0,
    });

    if (classification.kind === 'material-gap') {
      materialGaps.push({ conceptName });
      continue;
    }

    cells.push({
      conceptKey: concept.key,
      conceptName,
      state: classification.state,
      stall: classification.stall,
    });
    if (classification.state === 'ground') {
      nextGroundStreaks.set(concept.key, classification.groundStreak);
    }
  }

  const volunteers: GroveVolunteerCell[] = input.concepts
    .filter((concept) => isVolunteer(concept.name, declaredNames))
    .map((concept) => ({ conceptKey: concept.key, conceptName: concept.name }))
    .sort(byConceptName);

  const summary: GroveCourseSummary = {
    builtCount: cells.filter((cell) => cell.state !== 'ground').length,
    denominatorCount: cells.length + materialGaps.length,
    denominatorSourcePaths,
  };

  return {
    model: {
      status: 'declared',
      course,
      cells: [...cells].sort(byConceptName),
      materialGaps: [...materialGaps].sort(byConceptName),
      volunteers,
      summary,
    },
    nextGroundStreaks,
  };
}
