/**
 * The gap and coverage views (F4.3, F4.5, F4.9, F4.10; P5-T06a, `ol-p5t06a`),
 * with `ol-cvsc` [P3-T07h]'s scope statement folded in.
 *
 * **One computation, because it is one screen set.** The gap view orders what
 * is worth studying; the coverage view says what she has not started and what
 * her material does not contain. Both read the same ranking, the same mastery,
 * and — crucially — the same record of *what was actually read*, which is the
 * half `ol-cvsc` exists for and the half a surface cannot fake.
 *
 * **The three gap classes are three, and the contract says why (F4.5, F4.10).**
 *
 *  - `'mastery-gap'` (F4.3) — her material names it, cards exist, she knows it
 *    badly. *"You know this badly."*
 *  - `'coverage-gap'` (F4.5) — her material names it, **no instrument exists
 *    yet**. *"You haven't started."*
 *  - `'material-gap'` (F4.10) — the assessment evidence names it and **her
 *    material does not**. *"We don't have it."*
 *
 * The distinction is load-bearing rather than editorial, and F4.10 says so
 * outright: F4.5's draft affordance is safe *precisely because the notes
 * exist* — the cards are missing, the grounding is not. On a material-gap row
 * there is nothing to ground on, so drafting is exactly the confabulation C4.7
 * refuses and INV-5 tests for. **A surface that merges the two classes attaches
 * a generate-from-nothing button to the one row where nothing exists to
 * generate from.** {@link affordancesFor} is where that is enforced, and it is
 * enforced by construction rather than by a caller remembering.
 *
 * **What this module does not do, and why that is not a hedge.** With today's
 * tier-3 vocabulary (Zettelkasten note titles — `concept/evidence.ts`), a
 * concept the oracle can rank is a concept that already has a note of hers, so
 * `'material-gap'` is reachable through this shape but rare-to-absent in
 * practice against the current pipeline. That is a fact about the extraction
 * vocabulary, not a reason to loosen the classification: the class exists, the
 * affordance rule is enforced on it, and if a later pass mints concepts from
 * material she has no note for (`ol-p5t06a`'s own note records the case — a set
 * text she names in her own exam-prediction notes and has written nothing
 * about), those rows land in the class the contract already defined for them.
 * Widening the vocabulary is not this bead's work; being ready for it is free.
 *
 * **R7's readiness/knowledge split** lives in `./readiness.js` — read that
 * module's doc before changing any ordering here. In one line: the ranking this
 * module re-sorts is the oracle's, multiplied by a *readiness* weight that
 * never touches mastery.
 *
 * **INV-1 / §7.1.** Pure. No `obsidian`, no vault I/O, no clock, no network,
 * nothing stored. Same inputs in, same view out, forever — a local projection,
 * which is what makes "the Worker is a calculator, not a database" hold on this
 * surface as well.
 */

import type { AssessmentRecord } from '../assessment/types.js';
import type { SourceCoverage } from '../concept/evidence.js';
import type { ConceptSize } from '../concept/size.js';
import type { ConceptRecord } from '../concept/types.js';
import type { EvidenceQuestionCitation } from '../evidence-edge/types.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import type {
  ConceptPriority,
  OracleAbstainReason,
  OracleMasteryState,
  RankOracleResult,
} from '../oracle/types.js';
import type { VaultPath } from '../vault/types.js';
import { type CoverageScope, summariseCoverageScope } from './coverage.js';
import {
  type AssessmentFormat,
  assessmentFormatOf,
  type ReadinessFactors,
  type ReadinessOptions,
  readinessFactorsFor,
} from './readiness.js';

/** Which of the contract's three gap classes a row is. See the module doc. */
export type GapClass = 'mastery-gap' | 'coverage-gap' | 'material-gap';

/**
 * What a row offers her.
 *
 * `'draft-cards'` is the one that carries a rule rather than a preference:
 * F4.10 forbids it on a material-gap row outright — *"not relabelled, not
 * disabled, not conditional"*, because a disabled button still advertises a
 * capability the row cannot have.
 */
export type GapAffordance = 'open-concept' | 'build-session' | 'draft-cards' | 'find-source';

/**
 * What her own material holds for one concept — the input that decides the gap
 * class, supplied by the caller rather than re-derived here.
 *
 * Two separate absences, deliberately not one field: no notes is F4.10, notes
 * without cards is F4.5, and a single "is it covered" boolean would collapse
 * exactly the distinction the contract calls load-bearing.
 */
export interface ConceptMaterialPresence {
  /** Notes of hers that name this concept — `ConceptRecord.sourcePaths`. Empty means her material does not have it (F4.10). */
  readonly notePaths: readonly VaultPath[];
  /** Instruments (cards) reachable from those notes. Zero with non-empty `notePaths` is F4.5. */
  readonly instrumentCount: number;
  /**
   * `ConceptRecord.size`, passed through — how much of her material grounds
   * this concept (`[D-066]`, `concept/size.ts`). **Optional, deliberately
   * mirroring `ConceptRecord.size`'s own optionality**: other lanes construct
   * `ConceptMaterialPresence` literals (`packages/synthetic/src/corpus.ts`,
   * `packages/plugin/src/gap/provider.ts`, `packages/workbench`) without this
   * field, and a required key here would break their typecheck for a field
   * this bead (`ol-urvq` [SIZE-2]) adds, not theirs.
   */
  readonly size?: ConceptSize;
}

/** One row of the gap view. */
export interface GapRow {
  /** Display only (R2, verbatim) — never a join key; use {@link conceptKey}. */
  readonly conceptName: string;
  /** The opaque join key (`ol-63e1`, `[D-088]`/`[D-109]`) — restated from `ConceptPriority.conceptKey`. What a downstream instrument lookup (`study-session/instrument-index.ts`) or a study-plan `conceptId` joins on, never `conceptName`. */
  readonly conceptKey: string;
  readonly course: string;
  readonly gapClass: GapClass;
  /** 1-based position in this view, after the readiness re-sort. */
  readonly rank: number;
  /** 1-based position in the oracle's own ranking, kept so the two orders can be compared rather than conflated. */
  readonly oracleRank: number;
  /** `ConceptPriority.priorityScore`, verbatim — knowledge-side. */
  readonly priorityScore: number;
  /** `priorityScore × readiness.weight` — readiness-side, and what this view sorts on. */
  readonly gapScore: number;
  readonly readiness: ReadinessFactors;
  /**
   * The oracle's mastery reading, verbatim. **Never rewritten by the readiness
   * weighting** — R7: mastery describes knowledge, this view describes
   * readiness, and they may legitimately disagree without either overwriting
   * the other.
   */
  readonly masteryState: OracleMasteryState;
  /** The strongest-contributing assessment (`rank.ts` sorts `contributions` by contribution), or `null` if the entry somehow carried none. Whose `type` selected the format. */
  readonly targetAssessmentPath: VaultPath | null;
  readonly assessmentFormat: AssessmentFormat;
  /** The past-paper questions behind this row, from the oracle entry, verbatim. Never empty for a ranked entry. */
  readonly citations: readonly EvidenceQuestionCitation[];
  readonly distinctSourceCount: number;
  /** The oracle's own mechanically-assembled reasoning, verbatim — never re-narrated here. */
  readonly reasoning: string;
  readonly notePaths: readonly VaultPath[];
  readonly instrumentCount: number;
  readonly affordances: readonly GapAffordance[];
  /**
   * `ConceptMaterialPresence.size`, passed through verbatim — how much of her
   * material grounds this concept (`[D-066]`). Read by `study-session/`'s
   * fill (`ol-urvq` [SIZE-2]) to price a `'coarse'` concept's slot as worth
   * more of the session's budget than a `'fine'` one's. **Optional**, for the
   * same reason `ConceptMaterialPresence.size` is: a concept whose size was
   * never computed (an older or synthetic construction site) is absent here
   * rather than carrying an invented reading.
   */
  readonly conceptSize?: ConceptSize;
}

/** One course's gap view, or its abstention — mirroring `CourseOracleRanking`, which refuses to collapse the two. */
export type GapCourseView =
  | {
      readonly course: string;
      readonly status: 'ranked';
      readonly rows: readonly GapRow[];
    }
  | {
      readonly course: string;
      readonly status: 'abstained';
      readonly reason: OracleAbstainReason;
      readonly detail: string;
      readonly assessmentPaths: readonly VaultPath[];
    };

export interface GapViewModel {
  readonly courses: readonly GapCourseView[];
  /**
   * What the read path actually covered (`ol-cvsc`). Present on the model
   * itself rather than passed alongside it, so a surface cannot render the
   * rows without having the scope in hand.
   */
  readonly scope: CoverageScope;
  /** Echoed from the ranking — this view invents no time of its own. */
  readonly asOf: string;
}

export interface BuildGapViewInput {
  /** `rankOracle`'s result (P5-T04), unmodified. */
  readonly ranking: RankOracleResult;
  /** The assessments Base, for `type` → format (F4.8). Records this map does not cover resolve to an unknown format, which weights nothing. */
  readonly assessments: readonly AssessmentRecord[];
  /** Per-concept mastery (P4-T06), keyed by the opaque join key exactly as `rankOracle`/`composeOracleRanking` key it (`ol-63e1`). Omitted entirely means no recognition evidence anywhere, which weights nothing. */
  readonly mastery?: ReadonlyMap<string, ConceptMasteryResult>;
  /** What her own material holds, per concept KEY (`ol-63e1` — see {@link buildMaterialPresence}). A concept absent from this map is a material gap (F4.10). */
  readonly materialPresence: ReadonlyMap<string, ConceptMaterialPresence>;
  /** `extractTier3Evidence`'s own `sourceCoverage`, unmodified. */
  readonly sourceCoverage: readonly SourceCoverage[];
  readonly readiness?: ReadinessOptions;
}

/**
 * Which affordances a row of this class offers.
 *
 * The `'material-gap'` branch is the one with a contract behind it and it is
 * written as an exhaustive switch so a fourth class cannot be added without
 * deciding its affordances — a default branch here would silently hand a new
 * class the draft button.
 */
export function affordancesFor(gapClass: GapClass): readonly GapAffordance[] {
  switch (gapClass) {
    case 'mastery-gap':
      return ['open-concept', 'build-session'];
    case 'coverage-gap':
      // The draft affordance, and the only class that gets it: the notes exist,
      // so there is grounding to draft from (F4.5). INV-6's accept step still
      // stands between anything generated and her vault.
      return ['open-concept', 'draft-cards', 'build-session'];
    case 'material-gap':
      // Locate-or-open, and nothing else. Not a disabled draft, not a
      // relabelled one — F4.10.
      return ['find-source'];
  }
}

/** The gap class implied by what her material holds. See the module doc for why this is three-valued. */
export function classifyGap(presence: ConceptMaterialPresence | undefined): GapClass {
  if (presence === undefined || presence.notePaths.length === 0) return 'material-gap';
  return presence.instrumentCount > 0 ? 'mastery-gap' : 'coverage-gap';
}

/**
 * Build a `ConceptMaterialPresence` map from concept extraction plus a count of
 * instruments per note.
 *
 * A concept's instruments are those in **every note that names it**
 * (`ConceptRecord.sourcePaths`) — D-031's narrowing was removed by `ol-t3sd`,
 * so an instrument is evidence for every concept its note names and nothing is
 * attributed away from anything. Notes the count map does not mention
 * contribute zero, which is the honest reading: the caller found no instruments
 * there.
 *
 * **Keyed by `concept.key`, not `concept.name`** (`ol-63e1`) — a caller looks
 * this map up with `ConceptPriority.conceptKey`/`GapRow.conceptKey`, the same
 * opaque identity a review-log entry now carries, so a display-name key here
 * would silently never match.
 */
export function buildMaterialPresence(
  concepts: readonly ConceptRecord[],
  instrumentCountsByNotePath: ReadonlyMap<VaultPath, number>,
): ReadonlyMap<string, ConceptMaterialPresence> {
  const presence = new Map<string, ConceptMaterialPresence>();
  for (const concept of concepts) {
    const notePaths = [...concept.sourcePaths].sort();
    const instrumentCount = notePaths.reduce(
      (total, path) => total + (instrumentCountsByNotePath.get(path) ?? 0),
      0,
    );
    presence.set(concept.key, {
      notePaths,
      instrumentCount,
      ...(concept.size !== undefined ? { size: concept.size } : {}),
    });
  }
  return presence;
}

function assessmentTypesByPath(
  assessments: readonly AssessmentRecord[],
): ReadonlyMap<VaultPath, string | undefined> {
  const types = new Map<VaultPath, string | undefined>();
  for (const record of assessments) types.set(record.path, record.type);
  return types;
}

function buildRow(
  entry: ConceptPriority,
  input: BuildGapViewInput,
  types: ReadonlyMap<VaultPath, string | undefined>,
): Omit<GapRow, 'rank'> {
  // `contributions` is sorted by contribution descending (ties by path), so
  // [0] is the assessment that actually drove this concept's score — the same
  // choice `rank.ts` makes for its reasoning string, deliberately, so the
  // format we match on and the assessment we name are one assessment.
  const target = entry.factors.contributions[0];
  const targetAssessmentPath = target?.assessmentPath ?? null;
  const assessmentFormat =
    targetAssessmentPath === null ? 'unknown' : assessmentFormatOf(types.get(targetAssessmentPath));

  const readiness = readinessFactorsFor(
    input.mastery?.get(entry.conceptKey),
    assessmentFormat,
    input.readiness ?? {},
  );

  const presence = input.materialPresence.get(entry.conceptKey);
  const gapClass = classifyGap(presence);

  return {
    conceptName: entry.conceptName,
    conceptKey: entry.conceptKey,
    course: entry.course,
    gapClass,
    oracleRank: entry.rank,
    priorityScore: entry.priorityScore,
    gapScore: entry.priorityScore * readiness.weight,
    readiness,
    masteryState: entry.factors.masteryState,
    targetAssessmentPath,
    assessmentFormat,
    citations: entry.citations,
    distinctSourceCount: entry.factors.distinctSourceCount,
    reasoning: entry.reasoning,
    notePaths: presence?.notePaths ?? [],
    instrumentCount: presence?.instrumentCount ?? 0,
    affordances: affordancesFor(gapClass),
    ...(presence?.size !== undefined ? { conceptSize: presence.size } : {}),
  };
}

/**
 * Build the gap and coverage view model.
 *
 * An abstained course stays abstained: `rank.ts` refused to collapse "no
 * evidence" into "an empty ranking" and this view does not undo that, for the
 * same reason the study-plan artifact does not (P5-T05). An abstention on this
 * surface is a sentence about scope, which is the neighbouring case of the one
 * `ol-cvsc` is about.
 */
export function buildGapView(input: BuildGapViewInput): GapViewModel {
  const types = assessmentTypesByPath(input.assessments);

  const courses: GapCourseView[] = input.ranking.courses.map((course) => {
    if (course.status === 'abstained') {
      return {
        course: course.course,
        status: 'abstained',
        reason: course.reason,
        detail: course.detail,
        assessmentPaths: course.assessmentPaths,
      };
    }
    const unranked = course.ranked.map((entry) => buildRow(entry, input, types));
    const sorted = [...unranked].sort((a, b) => {
      if (a.gapScore !== b.gapScore) return b.gapScore - a.gapScore;
      // Deterministic tiebreak, and deliberately the oracle's own order first:
      // where readiness says nothing, this view says nothing either.
      if (a.oracleRank !== b.oracleRank) return a.oracleRank - b.oracleRank;
      return a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0;
    });
    return {
      course: course.course,
      status: 'ranked',
      rows: sorted.map((row, index) => ({ ...row, rank: index + 1 })),
    };
  });

  return {
    courses,
    scope: summariseCoverageScope(input.sourceCoverage),
    asOf: input.ranking.asOf,
  };
}

/** Every row across every ranked course, in course order — the coverage screen's own list, filtered by the caller to the class it shows. */
export function allGapRows(model: GapViewModel): readonly GapRow[] {
  return model.courses.flatMap((course) => (course.status === 'ranked' ? course.rows : []));
}
