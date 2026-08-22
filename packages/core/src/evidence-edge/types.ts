/**
 * The concept↔assessment evidence edge (knowledge model §5, F4.2, P5-T03).
 *
 * The knowledge model names this edge and its payload in one line: **"concept
 * ↔ assessment | M:N | yield rank, confidence, evidence (past-paper question
 * IDs)"** (§5), glossed further down the same section: *"An exam does not
 * contain concepts; past papers and objectives give evidence that a concept
 * is examined, with a rank, a confidence, and citations."* This module is
 * that edge, built as a **pure projection** over two sources this package
 * already reads — `../concept/evidence.js`'s tier-3 pass (past-paper
 * citations) and `../assessment/read.js`'s Bases reader (the assessment
 * records themselves) — never stored, always rebuildable from the vault plus
 * her registered past papers.
 *
 * **Evidential, not membership — the load-bearing rule.** An edge exists only
 * where a real past-paper question cites the concept; nothing here infers an
 * edge from course membership, folder structure, or co-occurrence. A course
 * with assessments but zero registered (or zero citing) past papers produces
 * zero edges for every one of that course's assessments — see `build.ts`'s
 * `assessmentsWithNoEvidence` and the zero-evidence suite in `build.spec.ts`.
 *
 * **Where the model is SILENT, and the call this module makes (Class B,
 * reversible — see `build.ts` for the full reasoning at the point it is
 * made):**
 *
 *  - **Which specific `AssessmentRecord` a past paper's evidence belongs to.**
 *    Past papers are grouped by `course` inside `Source` (frontmatter,
 *    verbatim); `AssessmentRecord` is *also* course-scoped but the model
 *    names no finer join (no assessment carries a "drawn from this past
 *    paper" reference, and a `Source` carries no assessment-type marker of
 *    its own). This module's join key is **course, and course alone** —
 *    every `AssessmentRecord` sharing a citing past paper's `course` is
 *    eligible for that concept's edge, regardless of the assessment's own
 *    `type` (Quiz/Assignment/Lab/Test). Filtering by `type` was considered
 *    and rejected: it would assert "past papers only evidence Test-typed
 *    assessments", which the model never states and a real vault could
 *    falsify (a past *quiz* paper exists in principle). The honest
 *    consequence, stated plainly: a `Lab` assessment in the same course as a
 *    cited past exam paper receives the same edges as that course's `Test`.
 *    F4.8 (assessment-*format*-matching, a separate downstream feature) is
 *    where practice format is matched to `type` — this edge does not
 *    pre-filter on its behalf.
 *  - **Objectives citations are excluded from this edge.** The knowledge
 *    model's own sentence names both past papers *and* objectives as
 *    evidence; this bead's acceptance criteria names only "past-paper
 *    question citations" as the edge's carried evidence. Implemented per the
 *    acceptance text — objectives citations still feed concept *extraction*
 *    (`../concept/evidence.js`, already shipped), just not this edge's
 *    `citations` or its `confidence`/`yieldRank` computation. Flagged as a
 *    discovered-from candidate rather than silently decided either way.
 *
 * **Yield rank and confidence — both computable and inspectable, no invented
 * cutoff (per this run's provisional-parameter rule).** See `build.ts` for
 * the exact formulas and why each was chosen; neither uses a tunable
 * threshold, so there is nothing here for a decision bead to ratify — only
 * the two design calls above, which are structural rather than numeric.
 */

import type { AssessmentReadReport } from '../assessment/types.js';
import type {
  ExtractTier3EvidenceOptions,
  ExtractTier3EvidenceResult,
} from '../concept/evidence.js';
import type { Provenance } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * One past-paper question or sub-part backing an edge — the acceptance
 * criteria's "past-paper question citations", projected from
 * `ConceptCitation` (`../concept/evidence.js`) down to the fields a citation
 * consumer needs. `questionLabel`/`questionText` are never optional here
 * (unlike on `ConceptCitation`, which also carries objectives/generated-
 * content citations that lack them) — this type only ever holds
 * `kind: 'past-paper'` citations, so both fields are present by
 * construction.
 */
export interface EvidenceQuestionCitation {
  readonly sourcePath: VaultPath;
  readonly questionLabel: string;
  readonly questionText: string;
  readonly provenance: Provenance;
  /** See `ConceptCitation.duplicateSourcePaths` (`ol-n0yc`) — present only when the citing past paper is filed at more than one path. */
  readonly duplicateSourcePaths?: readonly VaultPath[];
}

/**
 * One concept↔assessment edge (knowledge model §5). Never constructed with
 * an empty `citations` array — an edge with no evidence is not emitted at
 * all (see the module doc's "evidential, not membership" rule), so a
 * consumer that has an edge in hand always has at least one citation to show
 * for it.
 */
export interface ConceptAssessmentEdge {
  /** Exactly the vocabulary/concept name the citations matched (R2 — verbatim, never re-cased). */
  readonly conceptName: string;
  /** The `AssessmentRecord.path` this edge targets — the natural key, matching how the rest of this package identifies a note-backed record. */
  readonly assessmentPath: VaultPath;
  /** The course this edge's evidence and its target assessment agree on (never guessed — see `build.ts`). */
  readonly course: string;
  /**
   * 1-based rank among the concepts evidenced for THIS assessment, 1 =
   * highest yield. Ties are broken deterministically (see `build.ts`), so no
   * two edges on the same assessment ever share a rank. **Provisional
   * signal, not a final priority** — F4.2's actual ranking (P5-T04) also
   * weighs assessment weight, exam proximity and mastery; this field is one
   * input to that, not the finished answer.
   */
  readonly yieldRank: number;
  /**
   * In `(0, 1]` — the fraction of this course's distinct registered past
   * papers that cite this concept at least once. See `build.ts`'s
   * `computeConfidence` for the exact formula and why it needs no invented
   * threshold.
   */
  readonly confidence: number;
  /** Every past-paper question that cites `conceptName` in `course` — the proof, not a count of it. */
  readonly citations: readonly EvidenceQuestionCitation[];
}

export interface BuildConceptAssessmentEdgesOptions extends ExtractTier3EvidenceOptions {
  /** The `.base` file `readAssessments` scans — required; F7.9 leaves no default to guess (`../assessment/read.js`). */
  readonly basePath: VaultPath;
}

export interface BuildConceptAssessmentEdgesResult {
  readonly edges: readonly ConceptAssessmentEdge[];
  /** `readAssessments`'s own report, passed through unchanged — same "no new silent-empty failure mode" rule `ExtractTier3EvidenceResult.sourcesReport` follows. */
  readonly assessmentsRead: AssessmentReadReport;
  /** `extractTier3Evidence`'s own result, passed through — the citations this module's edges were built from, inspectable without recomputation. */
  readonly tier3: ExtractTier3EvidenceResult;
  /** Assessment paths whose `course` field was `undefined` — never guessed, so never eligible for an edge; named rather than silently absent. */
  readonly assessmentsWithoutCourse: readonly VaultPath[];
  /**
   * Assessment paths that HAD a `course` but received zero edges — either no
   * past-paper `Source` is registered for that course at all, or the ones
   * that are cite no vocabulary term. This is the acceptance criterion's
   * "zero evidence, zero edges" made inspectable rather than merely true: a
   * caller (or a test) can see exactly which assessments landed here and
   * why, instead of inferring it from an edge list that simply lacks them.
   */
  readonly assessmentsWithNoEvidence: readonly VaultPath[];
}
