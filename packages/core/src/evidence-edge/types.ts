/**
 * The concept↔assessment evidence edge (knowledge model §5, F4.2, P5-T03).
 *
 * The knowledge model names this edge and its payload in one line: **"concept
 * ↔ assessment | M:N | yield rank, confidence, evidence (past-paper question
 * IDs)"** (§5), glossed further down the same section: *"An exam does not
 * contain concepts; past papers and objectives give evidence that a concept
 * is examined, with a rank, a confidence, and citations."* This module is
 * that edge, built as a **pure projection** over two sources this package
 * already reads — `../tier3-evidence/build.js`'s tier-3 pass (past-paper
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
 *  - **Objectives citations are admitted, on their own basis (`[D-226]` ruling
 *    2, `ol-af3j`).** Superseding the exclusion this doc used to state: F4.2
 *    as amended says objectives count as ranking evidence, so a course whose
 *    only registered source is an objectives document is ranked rather than
 *    left unranked. An objectives document declares what is **in scope**; it
 *    does not evidence **how often something is examined**, so its evidence
 *    is never folded into a past-paper edge's `confidence` or `citations` —
 *    it gets its **own** edge, `basis: 'objectives'`, its **own** confidence
 *    (the objectives-source fraction, see `build.ts`'s
 *    `objectivesSourcesByCourse`), and its evidence lives in
 *    {@link ConceptAssessmentEdge.objectivesCitations} rather than
 *    `citations` — an objectives mention carries no question label or text
 *    to put there, and inventing one would be exactly the "wears a past
 *    paper's clothes" failure the ruling forbids. A concept cited by both
 *    kinds of source in one course gets **two** edges, one per basis, per
 *    the ruling's "each basis is stated for what it is."
 *
 * **What THIS module does not finish.** The edge is the data half of the
 * ruling. Presenting it — a copy-layer "own attribution sentence" analogous
 * to `packages/plugin/src/gap/copy.ts`'s `rankingAttribution`, and
 * `oracle/rank.ts`'s `buildReasoning` naming the basis rather than always
 * saying "past paper" — is downstream work this bead's ownership
 * (`evidence-edge/build.ts` and `types.ts` only) does not reach. No ratified
 * copy for an objectives-basis sentence exists in
 * `docs/Olea_vocabulary_registry.md` today, so none is invented here;
 * {@link ConceptAssessmentEdge.basis} is exactly the field a follow-on bead
 * needs to write one without guessing which edges it applies to.
 *
 * **Yield rank and confidence — both computable and inspectable, no invented
 * cutoff (per this run's provisional-parameter rule).** See `build.ts` for
 * the exact formulas and why each was chosen; neither uses a tunable
 * threshold, so there is nothing here for a decision bead to ratify — only
 * the design calls above, which are structural rather than numeric.
 */

import type { AssessmentReadReport } from '../assessment/types.js';
import type { ConceptRecord } from '../concept/types.js';
import type { Provenance } from '../extract/types.js';
import type {
  ExtractTier3EvidenceOptions,
  ExtractTier3EvidenceResult,
} from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * One past-paper question or sub-part backing an edge — the acceptance
 * criteria's "past-paper question citations", projected from
 * `ConceptCitation` (`../tier3-evidence/build.js`) down to the fields a citation
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
 * Which registered evidence an edge's `confidence` and citations were
 * computed from (`[D-226]` ruling 2). The two bases are never mixed — an
 * edge is one or the other, never a blend — which is what makes "each basis
 * is stated for what it is" checkable rather than a wording promise.
 */
export type ConceptEvidenceBasis = 'past-paper' | 'objectives';

/**
 * One objectives-document mention of a concept — the `basis: 'objectives'`
 * sibling of {@link EvidenceQuestionCitation}. An objectives document
 * declares scope, not examiner behaviour (`[D-226]` ruling 2): there is no
 * question to point at, so unlike its past-paper sibling this carries no
 * `questionLabel`/`questionText` — inventing either would misrepresent a
 * scope mention as an examiner's question, which is exactly what the ruling
 * forbids ("never wears a past paper's clothes").
 */
export interface EvidenceObjectivesCitation {
  readonly sourcePath: VaultPath;
  readonly provenance: Provenance;
  /** See `ConceptCitation.duplicateSourcePaths` (`ol-n0yc`) — present only when the citing objectives document is filed at more than one path. */
  readonly duplicateSourcePaths?: readonly VaultPath[];
}

/**
 * One concept↔assessment edge (knowledge model §5). Never constructed with
 * BOTH `citations` and `objectivesCitations` empty — an edge with no
 * evidence at all is not emitted (see the module doc's "evidential, not
 * membership" rule). Which of the two is the real evidence depends on
 * {@link basis}: a `'past-paper'` edge's evidence is `citations` and
 * `objectivesCitations` is absent; an `'objectives'` edge's evidence is
 * `objectivesCitations` and `citations` is the empty array, never a
 * fabricated one (`[D-226]` ruling 2 — see module doc).
 */
export interface ConceptAssessmentEdge {
  /**
   * Exactly the vocabulary/concept name the citations matched (R2 — verbatim,
   * never re-cased). **Display only, never a join key** (`ol-63e1`,
   * `[D-088]`/`[D-109]`) — a renderer reads this; a mastery or review-log join
   * reads {@link conceptKey} instead. Kept because `citations`/`reasoning`
   * consumers still need her own wording, and R2 forbids re-deriving it from
   * anything else.
   */
  readonly conceptName: string;
  /**
   * The opaque, stable join key (`ConceptRecord.key`, `ol-il6m`) for the same
   * concept `conceptName` names — resolved from
   * `BuildConceptAssessmentEdgesOptions.concepts` by exact name match.
   * **This is the identity a review-log `conceptIds` entry now carries**
   * (`ol-63e1`'s coordinated flip): `oracle/compose.ts` joins mastery on this
   * field, never on `conceptName`. Falls back to `conceptName` itself only
   * when no matching `ConceptRecord` is found (a vocabulary term with no
   * corresponding record — should not happen against a consistent vault
   * snapshot; documented rather than thrown, matching this package's "degrade
   * to a named, inspectable value" discipline elsewhere).
   */
  readonly conceptKey: string;
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
   * In `(0, 1]` — the fraction of this course's distinct registered sources
   * of THIS edge's {@link basis} that cite this concept at least once. A
   * `'past-paper'` edge's denominator is distinct past-paper sources; an
   * `'objectives'` edge's denominator is distinct objectives sources —
   * **never the other basis's count** (`[D-226]` ruling 2). See `build.ts`'s
   * `computeConfidence` for the exact formula and why it needs no invented
   * threshold.
   */
  readonly confidence: number;
  /** Every past-paper question that cites `conceptName` in `course` — the proof, not a count of it. Empty (never fabricated) when {@link basis} is `'objectives'`; see {@link objectivesCitations} for that edge's real evidence. */
  readonly citations: readonly EvidenceQuestionCitation[];
  /**
   * Which registered evidence this edge's `confidence` and citations were
   * computed from (`[D-226]` ruling 2 — see module doc). **Optional,
   * defaulting to `'past-paper'`** so every edge this module produced before
   * this field existed, and every literal a caller outside this package
   * constructs without it (`packages/synthetic/src/curriculum.ts`), reads
   * exactly as it always has. `build.ts` sets it explicitly on every edge it
   * builds, for both bases.
   */
  readonly basis?: ConceptEvidenceBasis;
  /**
   * The objectives citations behind this edge — this edge's real evidence
   * when {@link basis} is `'objectives'`; absent (never an empty array) for
   * a `'past-paper'` edge, matching how `citations` is never fabricated for
   * an `'objectives'` edge. Kept as a **separate** field rather than folded
   * into `citations` because the two citation shapes are not
   * interchangeable — an objectives mention carries no question label or
   * text, and giving it one would be exactly the "wears a past paper's
   * clothes" misrepresentation `[D-226]` forbids.
   */
  readonly objectivesCitations?: readonly EvidenceObjectivesCitation[];
}

export interface BuildConceptAssessmentEdgesOptions extends ExtractTier3EvidenceOptions {
  /** The `.base` file `readAssessments` scans — required; F7.9 leaves no default to guess (`../assessment/read.js`). */
  readonly basePath: VaultPath;
  /**
   * Every `ConceptRecord` this vault snapshot extracted — the source of
   * {@link ConceptAssessmentEdge.conceptKey} (`ol-63e1`). Required rather than
   * optional: an edge built without a real name→key map would either fabricate
   * a key or silently fall back to the display name for every entry, which is
   * exactly the half-flipped state that zeroes the mastery join this bead
   * exists to fix. The caller already extracts this list for another purpose
   * in every production path today (`enumerateVaultInstruments`'s
   * `VaultInstrumentEnumeration.concepts`, or a direct `extractConcepts` call)
   * — this module does no extraction of its own, it only reads the mapping.
   */
  readonly concepts: readonly ConceptRecord[];
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
