/**
 * `buildConceptAssessmentEdges` — see `./types.js`'s module doc for the edge
 * shape, what each field means, and the two places the knowledge model is
 * silent that this module had to decide.
 */

import { resolveAssessments } from '../assessment/resolve.js';
import type { AssessmentRecord } from '../assessment/types.js';
import { extractFromVault } from '../extract/registry.js';
import { segmentPastPaper } from '../source/segment-past-paper.js';
import { segmentPlainTextPastPaper } from '../source/segment-past-paper-plaintext.js';
import type { Source } from '../source/types.js';
import { extractTier3Evidence } from '../tier3-evidence/build.js';
import type { ConceptCitation } from '../tier3-evidence/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type {
  BuildConceptAssessmentEdgesOptions,
  BuildConceptAssessmentEdgesResult,
  ConceptAssessmentEdge,
  ConceptEvidenceBasis,
  EvidenceBriefCitation,
  EvidenceObjectivesCitation,
  EvidenceQuestionCitation,
} from './types.js';

/**
 * Thrown when a `kind: 'past-paper'` `ConceptCitation` does not resolve to a
 * real, independently-re-segmented question — see `resolveCitations`. This
 * is a defence against a citation reaching this module by any path other
 * than a genuine `segmentPastPaper` call (a hand-built test double, a future
 * refactor that starts constructing citations another way); by construction
 * `extractTier3Evidence`'s own output always resolves, so this should never
 * fire against real data. **An unresolvable citation is refused, not
 * dropped** — the acceptance criterion's own words — because silently
 * omitting it would produce an edge whose `citations` array under-reports
 * what backs it, which is exactly the "assertion, not evidence" failure this
 * whole module exists to rule out.
 *
 * Deliberately carries only path + label, never the citation's own
 * `questionText` — an error message is not the place for vault content.
 */
export class UnresolvableCitationError extends Error {
  constructor(
    public readonly sourcePath: VaultPath,
    public readonly questionLabel: string | undefined,
  ) {
    super(
      `evidence-edge: past-paper citation for ${JSON.stringify(sourcePath)}, question ` +
        `${JSON.stringify(questionLabel ?? null)}, does not resolve to a real segmented ` +
        'question. Refusing to build an edge on a citation that cannot be independently verified.',
    );
    this.name = 'UnresolvableCitationError';
  }
}

/**
 * Every question label a `role: 'past-paper'` `Source` actually produces,
 * re-derived independently of `extractTier3Evidence`'s own internal call to
 * the same segmenter — the trust boundary `resolveCitations` checks against.
 * Two routes, matching `../tier3-evidence/build.js`'s own split:
 *
 *  - **Markdown** (`format === null`): re-read and re-segment with
 *    `segmentPastPaper`, the block-parser segmenter.
 *  - **Binary** (`format !== null`, `ol-3ux7.10`): re-extract with
 *    `extractFromVault` and re-segment with `segmentPlainTextPastPaper`, the
 *    plain-text sibling. A source that degrades to `status: 'unsegmented'`
 *    is left OUT of the index entirely, exactly like a markdown source that
 *    (hypothetically) produced no questions would be — `resolveCitations`
 *    then refuses any stray `kind: 'past-paper'` citation for it rather than
 *    silently treating an empty entry as "zero real questions", and
 *    `../tier3-evidence/build.js`'s own abstention means no such citation is
 *    ever actually produced for an unsegmented source in the first place.
 */
export async function buildQuestionIndex(
  vault: VaultSource,
  sources: readonly Source[],
): Promise<ReadonlyMap<VaultPath, ReadonlySet<string>>> {
  const index = new Map<VaultPath, ReadonlySet<string>>();
  for (const source of sources) {
    if (source.role !== 'past-paper') continue;
    if (index.has(source.path)) continue;
    if (source.format === null) {
      const text = await vault.read(source.path);
      const { questions } = segmentPastPaper(source.path, text);
      index.set(source.path, new Set(questions.map((q) => q.label)));
    } else {
      const result = await extractFromVault(vault, source.path, source.format);
      const segmentation = segmentPlainTextPastPaper(result);
      if (segmentation.status === 'segmented') {
        index.set(source.path, new Set(segmentation.questions.map((q) => q.label)));
      }
    }
  }
  return index;
}

/**
 * Verifies every `kind: 'past-paper'` citation against `questionIndex`,
 * throwing `UnresolvableCitationError` on the first one that does not
 * resolve. Citations of other kinds (`objectives`, `generated-content`) pass
 * through untouched — an objectives citation carries no `questionLabel` to
 * verify against a segmented question index in the first place (`[D-226]`
 * ruling 2, see `./types.js`'s module doc for how they are admitted instead).
 */
export function resolveCitations(
  citations: readonly ConceptCitation[],
  questionIndex: ReadonlyMap<VaultPath, ReadonlySet<string>>,
): void {
  for (const citation of citations) {
    if (citation.kind !== 'past-paper') continue;
    const labels = questionIndex.get(citation.sourcePath);
    if (
      labels === undefined ||
      citation.questionLabel === undefined ||
      !labels.has(citation.questionLabel)
    ) {
      throw new UnresolvableCitationError(citation.sourcePath, citation.questionLabel);
    }
  }
}

function toEvidenceQuestionCitation(citation: ConceptCitation): EvidenceQuestionCitation {
  // Present by construction for every `kind: 'past-paper'` citation
  // (`pastPaperCitations` in `../tier3-evidence/build.js` always sets both), and
  // `resolveCitations` has already refused anything that didn't resolve —
  // so a missing label/text here would mean this function was called on the
  // wrong citation kind, which is this module's own bug, not absent evidence.
  if (citation.questionLabel === undefined || citation.questionText === undefined) {
    throw new Error(
      'evidence-edge: toEvidenceQuestionCitation called on a non-past-paper citation',
    );
  }
  return {
    sourcePath: citation.sourcePath,
    questionLabel: citation.questionLabel,
    questionText: citation.questionText,
    provenance: citation.provenance,
    ...(citation.duplicateSourcePaths !== undefined
      ? { duplicateSourcePaths: citation.duplicateSourcePaths }
      : {}),
  };
}

/**
 * The `basis: 'objectives'` sibling of {@link toEvidenceQuestionCitation}
 * (`[D-226]` ruling 2) — carries no question label or text because an
 * objectives mention names none; see `./types.js`'s `EvidenceObjectivesCitation`
 * doc.
 */
function toEvidenceObjectivesCitation(citation: ConceptCitation): EvidenceObjectivesCitation {
  return {
    sourcePath: citation.sourcePath,
    provenance: citation.provenance,
    ...(citation.duplicateSourcePaths !== undefined
      ? { duplicateSourcePaths: citation.duplicateSourcePaths }
      : {}),
  };
}

/**
 * One course-scoped evidence entry, of ANY basis, before it is attached to a
 * specific assessment path — course-level for `'past-paper'`/`'objectives'`
 * (one set, reused across every assessment in the course, per the module
 * doc's stated coarse-graining), assessment-scoped for `'assessment-brief'`
 * (`[D-247]`, see {@link briefEntriesForAssessment} for why that basis is
 * never pooled the same way). Module-scope rather than local to {@link
 * buildConceptAssessmentEdges} so {@link briefEntriesForAssessment} can
 * return it without a forward reference into that function's body.
 */
interface CourseEvidenceEntry {
  readonly conceptName: string;
  readonly basis: ConceptEvidenceBasis;
  readonly citations: readonly EvidenceQuestionCitation[];
  readonly objectivesCitations: readonly EvidenceObjectivesCitation[];
  /** `[D-247]`: present only on a `basis: 'assessment-brief'` entry — see {@link briefEntriesForAssessment}. */
  readonly briefCitations?: readonly EvidenceBriefCitation[];
  readonly confidence: number;
  readonly citationCount: number;
  readonly sourceCount: number;
}

/** Escapes every regex metacharacter so a concept name can be dropped into a `RegExp` literally — mirrors `../tier3-evidence/build.js`'s own `escapeRegExp`, kept local rather than imported (that module is not this bead's to touch) since the rule itself is one line and needs no shared state. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every one of `conceptNames` that occurs verbatim (case-insensitive,
 * word-bounded) in `text` — `[D-247]`'s "what this term's own assignment or
 * test says it covers", applied to the SAME no-fuzzy-matching rule
 * `../tier3-evidence/build.js`'s `findMentionedTerms` already uses for
 * past-paper and objectives text (R1/R2: no stemming, a plural or inflected
 * form genuinely misses). Matched against `options.concepts`' own names —
 * the vault's actual registered vocabulary, never a wider candidate list —
 * so a hit here is never an invented or inferred mention.
 */
function findMentionedConceptNames(
  text: string,
  conceptNames: readonly string[],
): readonly string[] {
  const hits: string[] = [];
  for (const name of conceptNames) {
    if (name === '') continue;
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'iu');
    if (pattern.test(text)) hits.push(name);
  }
  return hits;
}

/**
 * `[D-247]`'s `'assessment-brief'`-basis entries for ONE assessment —
 * deliberately NOT pooled across the course the way {@link
 * pastPaperEntries}/{@link objectivesEntries} are. A past paper or an
 * objectives document is course-wide evidence; an assessment's own stated
 * `scope` is not — it is a fact about THAT assessment alone (F4.2's own
 * copy example is "the brief for THIS assignment names it", never "a brief
 * somewhere in this course"). So a concept named in assignment 1's brief
 * never produces an edge on assignment 2's `assessmentPath`, even when both
 * share a course — the opposite of how past-paper/objectives evidence is
 * deliberately broadcast to every assessment in `build.ts`'s main loop.
 *
 * **Confidence is always `1`.** There is exactly one possible source for
 * this basis on this assessment (the assessment's own note) — "she stated
 * it" is not a frequency to be measured against a denominator of other
 * sources, unlike past-paper/objectives confidence (`computeConfidence`).
 * Never invented: `record.scope` is `undefined` unless `../assessment/
 * read.js` already resolved a real stated value (frontmatter or body
 * prose) for this exact note — see `./types.js`'s `ConceptEvidenceBasis`
 * doc.
 */
function briefEntriesForAssessment(
  record: AssessmentRecord,
  conceptNames: readonly string[],
): CourseEvidenceEntry[] {
  if (record.scope === undefined) return [];
  const mentioned = findMentionedConceptNames(record.scope, conceptNames);
  if (mentioned.length === 0) return [];
  const briefCitation: EvidenceBriefCitation = {
    sourcePath: record.path,
    provenance: { sourcePath: record.path, location: { page: 1 } },
  };
  return mentioned.map((conceptName) => ({
    conceptName,
    basis: 'assessment-brief',
    citations: [],
    objectivesCitations: [],
    briefCitations: [briefCitation],
    confidence: 1,
    citationCount: 1,
    sourceCount: 1,
  }));
}

/**
 * The fraction of `course`'s distinct registered sources of ONE basis that
 * cite `conceptName` at least once — see `./types.js`'s module doc for why
 * this needs no invented threshold, and for why the two bases' denominators
 * are never mixed (`[D-226]` ruling 2). `distinctSourcesForCourse` is always
 * ≥ 1 when this is called (an edge is only ever built from at least one
 * citation, and a citation implies at least one citing source of its own
 * basis), so this never divides by zero.
 */
function computeConfidence(
  citingSourcePaths: ReadonlySet<VaultPath>,
  distinctSourcesForCourse: number,
): number {
  return citingSourcePaths.size / distinctSourcesForCourse;
}

/**
 * Deterministic descending sort: more citing questions first, then more
 * distinct citing sources, then concept name ascending, then basis ascending.
 * The basis tiebreak is what keeps this total now that `[D-226]` lets the
 * SAME concept in the SAME course carry two entries — one per basis — that
 * can otherwise tie on every other field; a within-basis tie is still
 * impossible (each basis's grouping already deduplicates by concept name),
 * so this is reached only across bases and never needed within one.
 */
function compareByYield(
  a: {
    readonly conceptName: string;
    readonly citationCount: number;
    readonly sourceCount: number;
    readonly basis: ConceptEvidenceBasis;
  },
  b: {
    readonly conceptName: string;
    readonly citationCount: number;
    readonly sourceCount: number;
    readonly basis: ConceptEvidenceBasis;
  },
): number {
  if (a.citationCount !== b.citationCount) return b.citationCount - a.citationCount;
  if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount;
  if (a.conceptName !== b.conceptName) return a.conceptName < b.conceptName ? -1 : 1;
  return a.basis < b.basis ? -1 : a.basis > b.basis ? 1 : 0;
}

/**
 * Groups citations of ONE kind by course, then by concept — the join this
 * module performs is course-only (see `./types.js`'s module doc for why).
 * `sourceRole` is required rather than inferred from `kind` because a
 * `ConceptCitation`'s `kind` and a `Source`'s `role` are separate vocabularies
 * that happen to share two of their values today; passing it explicitly
 * keeps this function correct if that ever stops being true.
 */
function groupCitationsByCourseAndConcept(
  citations: readonly ConceptCitation[],
): ReadonlyMap<string, ReadonlyMap<string, ConceptCitation[]>> {
  const byCourse = new Map<string, Map<string, ConceptCitation[]>>();
  for (const citation of citations) {
    if (citation.course === undefined) continue; // never guessed — see module doc.
    let byConcept = byCourse.get(citation.course);
    if (byConcept === undefined) {
      byConcept = new Map();
      byCourse.set(citation.course, byConcept);
    }
    const list = byConcept.get(citation.conceptName);
    if (list === undefined) byConcept.set(citation.conceptName, [citation]);
    else list.push(citation);
  }
  return byCourse;
}

/** Distinct registered source paths per course, for one `SourceRole` — the confidence denominator for that role's basis. Built from `sourcesReport.sources` (already de-duplicated by `ol-n0yc`'s content-hash rule upstream in `registerSources`), never from the citations themselves, so a concept with zero citations in an otherwise-cited course still has a correct (if unused) denominator. */
function sourcePathsByCourseForRole(
  sources: readonly Source[],
  role: 'past-paper' | 'objectives',
): ReadonlyMap<string, ReadonlySet<VaultPath>> {
  const byCourse = new Map<string, Set<VaultPath>>();
  for (const source of sources) {
    if (source.role !== role || source.course === undefined) continue;
    let set = byCourse.get(source.course);
    if (set === undefined) {
      set = new Set();
      byCourse.set(source.course, set);
    }
    set.add(source.path);
  }
  return byCourse;
}

/**
 * Builds every concept↔assessment evidence edge reachable from `vault` — a
 * pure, rebuildable projection over `resolveAssessments` (assessment
 * records — F1.2's Base-or-manual fallback, `ol-egov.141.8.10`: a readable
 * Base always wins, whatever it contains; manual entries are read only on a
 * blank or unreadable `basePath`, see `../assessment/resolve.js`'s module
 * doc) and `extractTier3Evidence` (past-paper citations). See `./types.js`'s
 * module doc for the edge shape and the two calls made where the knowledge
 * model is silent.
 *
 * **This is the seam that used to leave a manual-only setup unranked.**
 * Every production caller reaches assessment records only through this
 * function (`oracle/compose.ts` → here), so switching this one call from
 * `readAssessments` to `resolveAssessments` is what makes a manual-only
 * setup (no configured Base) produce real edges rather than zero, with no
 * change to a readable Base's own output (`resolveAssessments` returns that
 * report unchanged but for the added `source: 'base'` field).
 */
export async function buildConceptAssessmentEdges(
  vault: VaultSource,
  options: BuildConceptAssessmentEdgesOptions,
): Promise<BuildConceptAssessmentEdgesResult> {
  const [assessmentsRead, tier3] = await Promise.all([
    resolveAssessments(vault, options.basePath),
    extractTier3Evidence(vault, options),
  ]);

  // `ol-63e1`: the opaque join key for each vocabulary/concept name matched
  // against tier-3 material — see `./types.js`'s `ConceptAssessmentEdge.conceptKey`
  // doc for why a missing entry falls back to the name rather than throwing.
  const conceptKeyByName = new Map(options.concepts.map((concept) => [concept.name, concept.key]));

  const questionIndex = await buildQuestionIndex(vault, tier3.sourcesReport.sources);
  resolveCitations(tier3.citations, questionIndex);

  const pastPaperCitations = tier3.citations.filter((c) => c.kind === 'past-paper');
  // `[D-226]` ruling 2: admitted on their own basis, never folded into the
  // past-paper denominator or citation set — see `./types.js`'s module doc.
  const objectivesCitations = tier3.citations.filter((c) => c.kind === 'objectives');

  const pastPaperSourcesByCourse = sourcePathsByCourseForRole(
    tier3.sourcesReport.sources,
    'past-paper',
  );
  const objectivesSourcesByCourse = sourcePathsByCourseForRole(
    tier3.sourcesReport.sources,
    'objectives',
  );

  const pastPaperByCourse = groupCitationsByCourseAndConcept(pastPaperCitations);
  const objectivesByCourse = groupCitationsByCourseAndConcept(objectivesCitations);

  // One evidence set per course, computed once and reused across every
  // assessment that shares the course — course-level evidence, not
  // per-assessment evidence, per the module doc's stated coarse-graining.
  // A course can carry entries of BOTH bases for the same concept
  // (`[D-226]` ruling 2's "each basis is stated for what it is") — they are
  // never merged into one entry. `CourseEvidenceEntry` itself is declared at
  // module scope — see its own doc.

  function pastPaperEntries(
    byConcept: ReadonlyMap<string, ConceptCitation[]>,
    distinctSources: number,
  ): CourseEvidenceEntry[] {
    const entries: CourseEvidenceEntry[] = [];
    for (const [conceptName, citations] of byConcept) {
      const citingSourcePaths = new Set(citations.map((c) => c.sourcePath));
      entries.push({
        conceptName,
        basis: 'past-paper',
        citations: citations
          .map(toEvidenceQuestionCitation)
          .sort((a, b) =>
            a.sourcePath !== b.sourcePath
              ? a.sourcePath < b.sourcePath
                ? -1
                : 1
              : a.questionLabel < b.questionLabel
                ? -1
                : a.questionLabel > b.questionLabel
                  ? 1
                  : 0,
          ),
        objectivesCitations: [],
        confidence: computeConfidence(citingSourcePaths, distinctSources),
        citationCount: citations.length,
        sourceCount: citingSourcePaths.size,
      });
    }
    return entries;
  }

  function objectivesEntries(
    byConcept: ReadonlyMap<string, ConceptCitation[]>,
    distinctSources: number,
  ): CourseEvidenceEntry[] {
    const entries: CourseEvidenceEntry[] = [];
    for (const [conceptName, citations] of byConcept) {
      const citingSourcePaths = new Set(citations.map((c) => c.sourcePath));
      entries.push({
        conceptName,
        basis: 'objectives',
        citations: [],
        objectivesCitations: citations
          .map(toEvidenceObjectivesCitation)
          // No question label to sort by (an objectives mention names none)
          // — sourcePath, then the citing location, keeps this deterministic
          // without inventing an ordering key the citation doesn't carry.
          .sort((a, b) =>
            a.sourcePath !== b.sourcePath
              ? a.sourcePath < b.sourcePath
                ? -1
                : 1
              : JSON.stringify(a.provenance.location) < JSON.stringify(b.provenance.location)
                ? -1
                : 1,
          ),
        confidence: computeConfidence(citingSourcePaths, distinctSources),
        citationCount: citations.length,
        sourceCount: citingSourcePaths.size,
      });
    }
    return entries;
  }

  const coursesWithEvidence = new Set<string>([
    ...pastPaperByCourse.keys(),
    ...objectivesByCourse.keys(),
  ]);
  const evidenceByCourse = new Map<string, readonly CourseEvidenceEntry[]>();
  for (const course of coursesWithEvidence) {
    const entries: CourseEvidenceEntry[] = [
      ...pastPaperEntries(
        pastPaperByCourse.get(course) ?? new Map(),
        pastPaperSourcesByCourse.get(course)?.size ?? 0,
      ),
      ...objectivesEntries(
        objectivesByCourse.get(course) ?? new Map(),
        objectivesSourcesByCourse.get(course)?.size ?? 0,
      ),
    ];
    entries.sort(compareByYield);
    evidenceByCourse.set(course, entries);
  }

  // One assessment record per path — a `.base` folder scan cannot list the
  // same note twice, but de-duplicating defensively costs nothing and keeps
  // this function correct if that ever changes upstream.
  const assessmentsByPath = new Map<VaultPath, AssessmentRecord>();
  for (const record of assessmentsRead.records) assessmentsByPath.set(record.path, record);

  // `[D-247]`: the real, registered vocabulary a brief mention is matched
  // against — `options.concepts`' own names, deduplicated, never a wider
  // candidate list. See `findMentionedConceptNames`'s doc.
  const conceptNames = [...new Set(options.concepts.map((concept) => concept.name))];

  const edges: ConceptAssessmentEdge[] = [];
  const assessmentsWithoutCourse: VaultPath[] = [];
  const assessmentsWithNoEvidence: VaultPath[] = [];

  for (const record of [...assessmentsByPath.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    const course = record.course;
    if (course === undefined) {
      assessmentsWithoutCourse.push(record.path);
      continue;
    }
    // Course-level (past-paper/objectives) evidence, shared with every
    // other assessment in this course, PLUS this one assessment's own
    // `'assessment-brief'` entries (`[D-247]`) — never shared, see
    // `briefEntriesForAssessment`'s doc. Re-sorting the combined list with
    // the SAME comparator `evidenceByCourse` was already sorted with is a
    // no-op whenever brief entries are empty (a stable sort of an
    // already-sorted list under an unchanged comparator reproduces the same
    // order byte-for-byte) — the existing past-paper/objectives ranking is
    // therefore unchanged for every assessment that carries no brief.
    const courseEvidence = evidenceByCourse.get(course) ?? [];
    const briefEntries =
      options.includeAssessmentBriefBasis === true
        ? briefEntriesForAssessment(record, conceptNames)
        : [];
    const evidence =
      briefEntries.length === 0
        ? courseEvidence
        : [...courseEvidence, ...briefEntries].sort(compareByYield);
    if (evidence.length === 0) {
      assessmentsWithNoEvidence.push(record.path);
      continue;
    }
    evidence.forEach((entry, index) => {
      edges.push({
        conceptName: entry.conceptName,
        conceptKey: conceptKeyByName.get(entry.conceptName) ?? entry.conceptName,
        assessmentPath: record.path,
        course,
        yieldRank: index + 1,
        confidence: entry.confidence,
        citations: entry.citations,
        basis: entry.basis,
        ...(entry.basis === 'objectives' ? { objectivesCitations: entry.objectivesCitations } : {}),
        ...(entry.basis === 'assessment-brief' ? { briefCitations: entry.briefCitations } : {}),
      });
    });
  }

  return {
    edges,
    assessmentsRead,
    tier3,
    assessmentsWithoutCourse,
    assessmentsWithNoEvidence,
  };
}
