/**
 * `buildConceptAssessmentEdges` — see `./types.js`'s module doc for the edge
 * shape, what each field means, and the two places the knowledge model is
 * silent that this module had to decide.
 */

import { readAssessments } from '../assessment/read.js';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptCitation } from '../concept/evidence.js';
import { extractTier3Evidence } from '../concept/evidence.js';
import { segmentPastPaper } from '../source/segment-past-paper.js';
import type { Source } from '../source/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type {
  BuildConceptAssessmentEdgesOptions,
  BuildConceptAssessmentEdgesResult,
  ConceptAssessmentEdge,
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
 * Every question label `segmentPastPaper` actually produces for each
 * markdown `role: 'past-paper'` `Source`, re-derived independently of
 * `extractTier3Evidence`'s own internal call to the same function — the
 * trust boundary `resolveCitations` checks against. A binary past paper
 * (`format !== null`) is not segmentable (`ol-pdfpastpaper`) and never
 * produces `questionLabel`-bearing citations in the first place, so it is
 * not indexed here.
 */
export async function buildQuestionIndex(
  vault: VaultSource,
  sources: readonly Source[],
): Promise<ReadonlyMap<VaultPath, ReadonlySet<string>>> {
  const index = new Map<VaultPath, ReadonlySet<string>>();
  for (const source of sources) {
    if (source.role !== 'past-paper' || source.format !== null) continue;
    if (index.has(source.path)) continue;
    const text = await vault.read(source.path);
    const { questions } = segmentPastPaper(source.path, text);
    index.set(source.path, new Set(questions.map((q) => q.label)));
  }
  return index;
}

/**
 * Verifies every `kind: 'past-paper'` citation against `questionIndex`,
 * throwing `UnresolvableCitationError` on the first one that does not
 * resolve. Citations of other kinds are not this module's concern and pass
 * through untouched — see `./types.js`'s module doc for why objectives
 * citations are excluded from this edge entirely.
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
  // (`pastPaperCitations` in `../concept/evidence.js` always sets both), and
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
 * The fraction of `course`'s distinct registered past-paper sources that
 * cite `conceptName` at least once — see `./types.js`'s module doc for why
 * this needs no invented threshold. `distinctPastPaperSourcesForCourse` is
 * always ≥ 1 when this is called (an edge is only ever built from at least
 * one citation, and a citation implies at least one citing source), so this
 * never divides by zero.
 */
function computeConfidence(
  citingSourcePaths: ReadonlySet<VaultPath>,
  distinctPastPaperSourcesForCourse: number,
): number {
  return citingSourcePaths.size / distinctPastPaperSourcesForCourse;
}

/** Deterministic descending sort: more citing questions first, then more distinct citing papers, then concept name ascending. No two entries can tie all the way through, so rank assignment below never has to break a further tie. */
function compareByYield(
  a: { readonly conceptName: string; readonly citationCount: number; readonly sourceCount: number },
  b: { readonly conceptName: string; readonly citationCount: number; readonly sourceCount: number },
): number {
  if (a.citationCount !== b.citationCount) return b.citationCount - a.citationCount;
  if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount;
  return a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0;
}

/**
 * Builds every concept↔assessment evidence edge reachable from `vault` — a
 * pure, rebuildable projection over `readAssessments` (assessment records)
 * and `extractTier3Evidence` (past-paper citations). See `./types.js`'s
 * module doc for the edge shape and the two calls made where the knowledge
 * model is silent.
 */
export async function buildConceptAssessmentEdges(
  vault: VaultSource,
  options: BuildConceptAssessmentEdgesOptions,
): Promise<BuildConceptAssessmentEdgesResult> {
  const [assessmentsRead, tier3] = await Promise.all([
    readAssessments(vault, options.basePath),
    extractTier3Evidence(vault, options),
  ]);

  // `ol-63e1`: the opaque join key for each vocabulary/concept name matched
  // against tier-3 material — see `./types.js`'s `ConceptAssessmentEdge.conceptKey`
  // doc for why a missing entry falls back to the name rather than throwing.
  const conceptKeyByName = new Map(options.concepts.map((concept) => [concept.name, concept.key]));

  const questionIndex = await buildQuestionIndex(vault, tier3.sourcesReport.sources);
  resolveCitations(tier3.citations, questionIndex);

  const pastPaperCitations = tier3.citations.filter((c) => c.kind === 'past-paper');

  // Distinct past-paper sources per course — the confidence denominator.
  // Built from `sourcesReport.sources` (already de-duplicated by `ol-n0yc`'s
  // content-hash rule upstream in `registerSources`), never from the
  // citations themselves, so a concept with zero citations in an
  // otherwise-cited course still has a correct (if unused) denominator.
  const pastPaperSourcesByCourse = new Map<string, Set<VaultPath>>();
  for (const source of tier3.sourcesReport.sources) {
    if (source.role !== 'past-paper' || source.course === undefined) continue;
    let set = pastPaperSourcesByCourse.get(source.course);
    if (set === undefined) {
      set = new Set();
      pastPaperSourcesByCourse.set(source.course, set);
    }
    set.add(source.path);
  }

  // Citations grouped by course, then by concept — the join this module
  // performs is course-only (see ./types.js's module doc for why).
  const citationsByCourse = new Map<string, Map<string, ConceptCitation[]>>();
  for (const citation of pastPaperCitations) {
    if (citation.course === undefined) continue; // never guessed — see module doc.
    let byConcept = citationsByCourse.get(citation.course);
    if (byConcept === undefined) {
      byConcept = new Map();
      citationsByCourse.set(citation.course, byConcept);
    }
    const list = byConcept.get(citation.conceptName);
    if (list === undefined) byConcept.set(citation.conceptName, [citation]);
    else list.push(citation);
  }

  // One evidence set per course, computed once and reused across every
  // assessment that shares the course — course-level evidence, not
  // per-assessment evidence, per the module doc's stated coarse-graining.
  interface CourseEvidenceEntry {
    readonly conceptName: string;
    readonly citations: readonly EvidenceQuestionCitation[];
    readonly confidence: number;
    readonly citationCount: number;
    readonly sourceCount: number;
  }
  const evidenceByCourse = new Map<string, readonly CourseEvidenceEntry[]>();
  for (const [course, byConcept] of citationsByCourse) {
    const distinctSources = pastPaperSourcesByCourse.get(course)?.size ?? 0;
    const entries: CourseEvidenceEntry[] = [];
    for (const [conceptName, citations] of byConcept) {
      const citingSourcePaths = new Set(citations.map((c) => c.sourcePath));
      entries.push({
        conceptName,
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
        confidence: computeConfidence(citingSourcePaths, distinctSources),
        citationCount: citations.length,
        sourceCount: citingSourcePaths.size,
      });
    }
    entries.sort(compareByYield);
    evidenceByCourse.set(course, entries);
  }

  // One assessment record per path — a `.base` folder scan cannot list the
  // same note twice, but de-duplicating defensively costs nothing and keeps
  // this function correct if that ever changes upstream.
  const assessmentsByPath = new Map<VaultPath, AssessmentRecord>();
  for (const record of assessmentsRead.records) assessmentsByPath.set(record.path, record);

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
    const evidence = evidenceByCourse.get(course);
    if (evidence === undefined || evidence.length === 0) {
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
