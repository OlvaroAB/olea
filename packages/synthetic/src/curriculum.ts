/**
 * A synthetic curriculum: coined assessments plus past-paper question
 * evidence, and the concept↔assessment edges those citations imply
 * (`olea-service`'s `ol-opmb.1` [TB-1]).
 *
 * ## Why this exists
 *
 * `rankOracle` (`olea-core`'s `oracle/rank.js`) cannot run without evidence —
 * `RankOracleInput.evidence` is `buildConceptAssessmentEdges`'s real output,
 * built by scanning actual past-paper text for vocabulary citations. Nothing
 * in `olea-synthetic` produces markdown to scan: `generateStream` fabricates
 * *events*, not notes. So this module builds the edges directly, as literal
 * data, rather than round-tripping through the extraction pipeline this
 * package has no vault to run it against. That is a deliberate shortcut and a
 * safe one: `ConceptAssessmentEdge` is plain data (yield rank, confidence,
 * citations), `rankOracle` only ever reads it, and nothing here claims to
 * have extracted anything — the edges are declared, not discovered.
 *
 * ## Self-consistency (the trap this file exists to avoid)
 *
 * Every `conceptName` and `course` below is one of `./vocabulary.js`'s own
 * `CONCEPTS`/`COURSES` ids (`syn:concept:…`, `syn:course:…`) — never a
 * fixture-vault string, and never a fresh coined token either. `rankOracle`
 * keys mastery by `conceptName` (see its own module doc), and a synthetic
 * stream's `ReviewLogRecord.conceptIds` are exactly these same
 * `syn:concept:…` ids (`./generate.js`'s `perConceptMastery`) — so a mastery
 * map built from a stream and a ranking built from this curriculum agree by
 * construction, without any relabelling step to get wrong.
 *
 * ## The deliberate gap: `COURSE_QUORBIN` never gets evidence
 *
 * `COURSE_QUORBIN` has one registered assessment and zero edges — the
 * "evidential, not membership" rule (`ConceptAssessmentEdge`'s module doc)
 * applied on purpose, so `rankOracle` abstains for it. A consumer that
 * relabelled that abstention into an empty ranking would be exactly the bug
 * `rank.ts`'s module doc calls out. `COURSE_VANTREL` carries every other
 * demonstrable case: a concept cited by two distinct past papers (`melspar`,
 * `distinctSourceCount === 2`), one cited once (`dornith`), one ranked here
 * but absent from `corpus.ts`'s material map entirely (F4.10's material-gap
 * row, `kelvane`), and one ranked with material present (`tirasp`). The
 * corpus, not this file, decides which class a ranked row lands in; see
 * `corpus.ts`'s module doc for which concept gets which.
 *
 * ## INV-3
 *
 * Every string minted here (`syn:assessment:…`, `syn:source:…`,
 * `syn:note:…`, question labels) is built from `SYNTHETIC_ID_PREFIX` plus
 * either an already-vetted vocabulary token (`melspar`, `vantrel`, …) or an
 * ordinary structural English word (`midterm`, `final`, `past-paper`,
 * `question`) of the same kind `AssessmentRecord.type` already uses elsewhere
 * in this codebase (`Quiz`, `Test`) — never a newly-coined proper noun, so
 * there is nothing here that needs its own zero-hit check beyond the one
 * `./vocabulary.js` already documents. `world.spec.ts` re-asserts this by
 * scanning every string this module produces for tokens outside that set.
 */

import type {
  AssessmentReadReport,
  AssessmentRecord,
  ConceptAssessmentEdge,
  EvidenceQuestionCitation,
  VaultPath,
} from 'olea-core';
import { SYNTHETIC_ID_PREFIX } from './provenance.js';
import { COURSE_QUORBIN, COURSE_VANTREL } from './vocabulary.js';

const CONCEPT = (token: string) => `${SYNTHETIC_ID_PREFIX}concept:${token}`;

/** `syn:concept:melspar` etc. — restated from `./vocabulary.js`'s tokens, never re-coined. */
export const CONCEPT_MELSPAR = CONCEPT('melspar');
export const CONCEPT_DORNITH = CONCEPT('dornith');
export const CONCEPT_KELVANE = CONCEPT('kelvane');
export const CONCEPT_TIRASP = CONCEPT('tirasp');

const ASSESSMENT_VANTREL_MIDTERM: VaultPath = `${SYNTHETIC_ID_PREFIX}assessment:vantrel:midterm`;
const ASSESSMENT_VANTREL_FINAL: VaultPath = `${SYNTHETIC_ID_PREFIX}assessment:vantrel:final`;
const ASSESSMENT_QUORBIN_FINAL: VaultPath = `${SYNTHETIC_ID_PREFIX}assessment:quorbin:final`;

/** Past-paper source paths — also `corpus.ts`'s `SourceCoverage` rows, by the same paths. */
export const SOURCE_VANTREL_PAPER_1: VaultPath = `${SYNTHETIC_ID_PREFIX}source:vantrel:past-paper-1`;
export const SOURCE_VANTREL_PAPER_2: VaultPath = `${SYNTHETIC_ID_PREFIX}source:vantrel:past-paper-2`;

function citation(
  sourcePath: VaultPath,
  questionLabel: string,
  conceptToken: string,
): EvidenceQuestionCitation {
  return {
    sourcePath,
    questionLabel,
    questionText: `${questionLabel}: explain ${conceptToken} with reference to its course.`,
    provenance: { sourcePath, location: { page: 1, charRange: { start: 0, end: 40 } } },
  };
}

function edge(
  conceptName: string,
  assessmentPath: VaultPath,
  course: string,
  yieldRank: number,
  confidence: number,
  citations: readonly EvidenceQuestionCitation[],
): ConceptAssessmentEdge {
  return { conceptName, assessmentPath, course, yieldRank, confidence, citations };
}

/**
 * Human-presentable form of a coined assessment path (WBF-1, `ol-mxw3`) —
 * same discipline as `vocabulary.ts`'s `conceptDisplayName`/
 * `courseDisplayName` and `corpus.ts`'s `sourceDisplayName`: title-cases
 * already-vetted structural English (`midterm`, `final`), never invents a
 * new word.
 *
 * `oracle/rank.ts`'s `buildReasoning` embeds `top.assessmentPath` verbatim
 * in `ConceptPriority.reasoning` — mechanically-assembled FREE TEXT, not a
 * structured field, so `packages/workbench/src/oracle/display-names.ts`
 * cannot fix this leak by swapping a field; it has to substitute this exact
 * substring inside the reasoning string. `GapRow.targetAssessmentPath`
 * (`olea-core`'s `gap/build.ts`) is always drawn from the SAME
 * `contributions[0]` `rank.ts` uses for the reasoning string (both modules'
 * own comments say so), so a caller with the row in hand always has the
 * exact substring to replace, never a guess.
 */
const ASSESSMENT_DISPLAY_NAMES: ReadonlyMap<VaultPath, string> = new Map([
  [ASSESSMENT_VANTREL_MIDTERM, 'Vantrel: midterm'],
  [ASSESSMENT_VANTREL_FINAL, 'Vantrel: final'],
  [ASSESSMENT_QUORBIN_FINAL, 'Quorbin: final'],
]);

/** `syn:assessment:vantrel:midterm` → `'Vantrel: midterm'`. Throws on a path this module did not mint. */
export function assessmentDisplayName(path: VaultPath): string {
  const name = ASSESSMENT_DISPLAY_NAMES.get(path);
  if (name === undefined) {
    throw new Error(
      `olea-synthetic: assessmentDisplayName called with an unknown assessment path: ${path}`,
    );
  }
  return name;
}

export interface SyntheticCurriculum {
  readonly assessments: readonly AssessmentRecord[];
  readonly assessmentsRead: AssessmentReadReport;
  readonly edges: readonly ConceptAssessmentEdge[];
  /** `COURSE_QUORBIN`'s assessment, registered but with zero evidence — `rankOracle`'s abstain path. */
  readonly assessmentsWithNoEvidence: readonly VaultPath[];
}

/**
 * The whole curriculum, deterministic and unseeded — every value here is a
 * literal, not a draw from an `Rng`, because the point is a fixed, inspectable
 * world rather than a distribution.
 */
export function buildCurriculum(): SyntheticCurriculum {
  const assessments: AssessmentRecord[] = [
    {
      path: ASSESSMENT_VANTREL_MIDTERM,
      course: COURSE_VANTREL,
      type: 'Quiz',
      weight: 30,
      weightRaw: '30',
      due: '2027-01-20',
      status: 'upcoming',
    },
    {
      path: ASSESSMENT_VANTREL_FINAL,
      course: COURSE_VANTREL,
      type: 'Test',
      weight: 50,
      weightRaw: '50',
      due: '2027-02-10',
      status: 'upcoming',
    },
    {
      path: ASSESSMENT_QUORBIN_FINAL,
      course: COURSE_QUORBIN,
      type: 'Test',
      weight: 60,
      weightRaw: '60',
      due: '2027-02-05',
      status: 'upcoming',
    },
  ];

  const assessmentsRead: AssessmentReadReport = {
    records: assessments,
    sourceFolders: [`${SYNTHETIC_ID_PREFIX}assessments`],
    notesScanned: assessments.map((a) => a.path),
    notesWithoutFrontmatter: [],
    columns: (['course', 'type', 'weight', 'due', 'status'] as const).map((field) => ({
      field,
      matchedKey: field,
    })),
    unresolvedFields: [],
    unrecognizedColumns: [],
    configErrors: [],
  };

  const edges: ConceptAssessmentEdge[] = [
    edge(CONCEPT_MELSPAR, ASSESSMENT_VANTREL_MIDTERM, COURSE_VANTREL, 1, 0.9, [
      citation(SOURCE_VANTREL_PAPER_1, 'Q1', 'melspar'),
    ]),
    edge(CONCEPT_MELSPAR, ASSESSMENT_VANTREL_FINAL, COURSE_VANTREL, 1, 0.8, [
      citation(SOURCE_VANTREL_PAPER_2, 'Q1', 'melspar'),
    ]),
    edge(CONCEPT_DORNITH, ASSESSMENT_VANTREL_MIDTERM, COURSE_VANTREL, 2, 0.5, [
      citation(SOURCE_VANTREL_PAPER_1, 'Q2', 'dornith'),
    ]),
    edge(CONCEPT_KELVANE, ASSESSMENT_VANTREL_FINAL, COURSE_VANTREL, 3, 0.55, [
      citation(SOURCE_VANTREL_PAPER_2, 'Q3', 'kelvane'),
    ]),
    edge(CONCEPT_TIRASP, ASSESSMENT_VANTREL_MIDTERM, COURSE_VANTREL, 3, 0.4, [
      citation(SOURCE_VANTREL_PAPER_1, 'Q3', 'tirasp'),
    ]),
    edge(CONCEPT_TIRASP, ASSESSMENT_VANTREL_FINAL, COURSE_VANTREL, 2, 0.45, [
      citation(SOURCE_VANTREL_PAPER_2, 'Q2', 'tirasp'),
    ]),
  ];

  return {
    assessments,
    assessmentsRead,
    edges,
    assessmentsWithNoEvidence: [ASSESSMENT_QUORBIN_FINAL],
  };
}
