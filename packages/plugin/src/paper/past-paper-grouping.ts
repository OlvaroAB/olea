/**
 * The local question grouping of a past paper's own text, as the structured paper's template while
 * that paper's structure reading is pending (`[D-559]`: "grouping as the fallback for a text paper
 * whose reading is pending"; `ol-egov.141.89.7.60`; F4.11; scp.md 2.2: the grouping is
 * corroboration and fallback, never the default once a reading exists).
 *
 * **When it is read.** Only when no counted reading of the course gives the paper a template
 * (`./provider.ts`, `composeRequestedPaper`: readings first), and then only for a paper of the
 * course whose reading is pending:
 *
 * - a document registered now as a past paper of the course (her review log) whose current
 *   revision has no reading that counts (`olea-core`'s `pastPaperReadingCounts`) and was not read
 *   in full and found to state nothing ({@link pastPaperReadingPending}). A paper whose current
 *   revision cannot be established has no current reading, so it is pending too (Class B, flagged
 *   on the bead);
 * - a Markdown past paper of the course (`role: past-paper` and `course:` in its frontmatter, read
 *   by `olea-core`'s `registerSources`, as `../generation/format-match.ts` reads it). A Markdown
 *   paper is never sent for a structure reading (`olea-core`'s `isRegisterableDocument` offers only
 *   non-Markdown files for registration, and the reading trigger reads registrations only), so its
 *   reading is always pending and its grouping shapes the paper (Class B under `[D-559]`'s
 *   fallback wording, flagged on the bead).
 *
 * Papers are tried in path order, and the first whose grouping forms a template is used: the same
 * stable choice, and the same absence of any claim that one sitting is more representative, that
 * `olea-core`'s `paperRecoveredStructureFromReadings` makes among readings. A paper whose text
 * cannot be read or split gives nothing, and the next is tried.
 *
 * **Which text, and criterion 2 of the bead.** A Markdown paper's text is the note itself, split by
 * `segmentPastPaper` and grouped by `groupMarkdownPastPaper`. Any other paper's text is the local
 * extraction (`extractFromVault`), split by the extracted-text splitter
 * (`segmentPlainTextPastPaper`) and grouped beside it, on the same extraction, by
 * `groupPlainTextPastPaper` ({@link groupPastPaperText}). The tier-3 evidence build
 * (`olea-core`'s `tier3-evidence/build.ts`) runs the same splitter for ranking evidence, which
 * reads segmented questions only and never a paper's structure, so it gains nothing from a grouping
 * and is unchanged.
 *
 * **The mapping rule, in plain words** ({@link pastPaperTemplateFromGrouping}).
 *
 * 1. A part is a segmented question the paper asks to be answered: one with no sub-parts. A
 *    question with sub-parts is a stem, which the grouping already carries as its parent-question
 *    group, so it is never a part.
 * 2. A part sits in the innermost group the grouping places it in. A part the grouping places in
 *    no group is left out, which is the reader's own rule (the Worker drops a part whose group is
 *    not kept: a part is judged inside its group). A part whose groups do not nest one inside the
 *    next (a shared stimulus that crosses a section boundary) cannot be placed in one group without
 *    dropping another, and is left out too. Nothing is guessed.
 * 3. A part carries the paper's own numbering as its label, the marks the splitter read from its
 *    own text (stated) or unknown, an unknown dependency (the grouping reads no dependency, and
 *    unknown is never independence), and an empty question form: the grouping reads no descriptor,
 *    and the structured shape keeps the paper's own descriptor only, never an invented one
 *    (`[D-431]`: unknown stays unknown).
 * 4. A group carries its kind, label, nesting, members, `choose` and stimulus exactly as the
 *    grouping states them. Its id is an opaque ordinal, never the paper's numbering, so a structure
 *    problem's detail stays content-free (D-005).
 * 5. The paper's total marks and time allowance are unknown: the grouping reads neither.
 * 6. The grouping's `unresolved` list is never read. Structure it names is not in the template, and
 *    it is forgotten with the grouping when the request ends. No surface shows it.
 * 7. A grouping whose placements do not line up one to one with its splitter's questions, that
 *    places one label twice, that repeats a group id or nests a group in one it does not hold, or
 *    that yields no part, gives no template: the paper is composed flat. So does a template the
 *    structured builder then refuses (`olea-core`'s `buildStructuredPaperShape`, its rule 6: a
 *    choice whose alternatives were not all kept, for one).
 *
 * **Nothing is stored.** The grouping is recomputed from her paper's text at each request and
 * forgotten. The journal records the paper's structure exactly as it does for one shaped on a
 * reading, so an unfinished paper resumes on its own recorded structure however the reading or the
 * grouping has moved since (`[D-560]`, `./journal-composition.ts`). Nothing is logged (D-005).
 */

import {
  DEFAULT_SOURCES_FOLDER,
  documentStateView,
  type ExtractionResult,
  extractFromVault,
  formatFromExtension,
  groupMarkdownPastPaper,
  groupPlainTextPastPaper,
  type PaperMarks,
  type PaperQuestionGroup,
  type PaperStructureTemplate,
  type PaperTemplatePart,
  type PastPaperStoredReading,
  pastPaperReadingCounts,
  type QuestionBlock,
  type ReadingPolicy,
  registerSources,
  type ScopeReadingProjection,
  type ScopeRevisionRef,
  type SourceFormat,
  segmentPastPaper,
  structureView,
  type TextPaperQuestionGrouping,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { segmentPlainTextPastPaper } from '../../../core/src/source/segment-past-paper-plaintext.js';
import type { RegisteredPastPaper } from '../scope-reading/declared-demands.js';

/** One past paper's local grouping, with the splitter's questions it was read from (their marks are the parts'). */
export interface PastPaperTextGrouping {
  readonly grouping: TextPaperQuestionGrouping;
  /** The splitter's questions, in its document order: one per placement. */
  readonly questions: readonly QuestionBlock[];
}

const UNKNOWN_MARKS: PaperMarks = { status: 'unknown' };

function marksOf(marks: number | undefined): PaperMarks {
  return marks !== undefined && Number.isFinite(marks) && marks >= 0
    ? { status: 'stated', value: marks }
    : UNKNOWN_MARKS;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * One paper's local grouping as a `PaperStructureTemplate`, by the mapping rule in the module doc,
 * or `null` when it gives none (rule 7). Pure: no I/O, no clock, no logging.
 */
export function pastPaperTemplateFromGrouping(
  text: PastPaperTextGrouping,
): PaperStructureTemplate | null {
  const { grouping, questions } = text;
  if (grouping.groups.length === 0 || grouping.placements.length !== questions.length) return null;
  const labels = new Set<string>();
  for (const [index, placement] of grouping.placements.entries()) {
    if (placement.label !== questions[index]?.label || labels.has(placement.label)) return null;
    labels.add(placement.label);
  }

  const groupById = new Map(grouping.groups.map((group) => [group.id, group] as const));
  if (groupById.size !== grouping.groups.length) return null;
  // A group nested in a group the grouping does not hold would have to be re-nested: never.
  for (const group of grouping.groups) {
    if (group.parentGroupId !== undefined && !groupById.has(group.parentGroupId)) return null;
  }
  const opaqueId = new Map(grouping.groups.map((group, index) => [group.id, `group-${index + 1}`]));

  /** The ids from the outermost group down to `id`, by each group's own parent; `null` when a parent is missing or the nesting loops. */
  const chainTo = (id: string): string[] | null => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let at = groupById.get(id);
    while (at !== undefined) {
      if (seen.has(at.id)) return null;
      seen.add(at.id);
      chain.unshift(at.id);
      if (at.parentGroupId === undefined) return chain;
      at = groupById.get(at.parentGroupId);
    }
    return null;
  };

  const parts: PaperTemplatePart[] = [];
  for (const [index, placement] of grouping.placements.entries()) {
    if (placement.isStem) continue;
    const innermost = placement.groupPath[placement.groupPath.length - 1];
    if (innermost === undefined) continue;
    const chain = chainTo(innermost);
    if (chain === null || !sameList(chain, placement.groupPath)) continue;
    parts.push({
      id: `part-${parts.length + 1}`,
      label: placement.label,
      groupId: opaqueId.get(innermost) as string,
      questionForm: '',
      marks: marksOf(questions[index]?.marks),
      dependsOn: { status: 'unknown' },
    });
  }
  if (parts.length === 0) return null;

  const groups: PaperQuestionGroup<unknown>[] = grouping.groups.map((group) => {
    const parent =
      group.parentGroupId === undefined ? undefined : opaqueId.get(group.parentGroupId);
    return {
      id: opaqueId.get(group.id) as string,
      kind: group.kind,
      label: group.label,
      ...(parent !== undefined ? { parentGroupId: parent } : {}),
      memberLabels: group.memberLabels,
      ...(group.choose !== undefined ? { choose: group.choose } : {}),
      anchor: group.anchor,
      stimulus: group.stimulus,
    };
  });
  return { groups, parts, totalMarks: UNKNOWN_MARKS, timeAllowance: { status: 'unknown' } };
}

/**
 * `[D-559]`: whether a registered past paper's structure reading is pending, so its local grouping
 * may shape the paper. `reading` is `null` when the paper's current revision cannot be established
 * (no reading of it can be current). Not pending: a reading that counts, or a revision read in full
 * that states nothing. Pending: everything else (never read, owed, read in part, read only at another
 * revision or by a reader not accepted, or a structure whose state was never written). Pure.
 */
export function pastPaperReadingPending(reading: PastPaperStoredReading | null): boolean {
  if (reading === null) return true;
  if (pastPaperReadingCounts(reading)) return false;
  return !(reading.state.status === 'known' && reading.state.state.kind === 'read-states-nothing');
}

/** How a past paper's text is extracted: `extractFromVault` in production. */
export type PastPaperExtract = (
  vault: VaultSource,
  path: VaultPath,
  format: SourceFormat,
) => Promise<ExtractionResult>;

function isMarkdownPath(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * One past paper's local grouping from its own text (module doc, "Which text"), or `null` when no
 * extractor reads it or the extracted-text splitter could not split it. Throws when the paper cannot
 * be read; the reader skips such a paper.
 */
export async function groupPastPaperText(
  vault: VaultSource,
  path: VaultPath,
  extract: PastPaperExtract = extractFromVault,
): Promise<PastPaperTextGrouping | null> {
  if (isMarkdownPath(path)) {
    const content = await vault.read(path);
    const segmentation = segmentPastPaper(path, content);
    return {
      grouping: groupMarkdownPastPaper(segmentation, content),
      questions: segmentation.questions,
    };
  }
  const format = formatFromExtension(path);
  if (format === null) return null;
  const extraction = await extract(vault, path, format);
  // The extracted-text splitter, and the grouping beside it on the same extraction (criterion 2).
  const segmentation = segmentPlainTextPastPaper(extraction);
  if (segmentation.status !== 'segmented') return null;
  return {
    grouping: groupPlainTextPastPaper(extraction, segmentation),
    questions: segmentation.questions,
  };
}

/** The course's Markdown past papers: `registerSources`'s `role: past-paper` notes whose `course:` names it, the read `../generation/format-match.ts` makes. */
export async function markdownPastPapersOf(
  vault: VaultSource,
  course: string,
  sourcesFolder: VaultPath = DEFAULT_SOURCES_FOLDER,
): Promise<readonly VaultPath[]> {
  const report = await registerSources(vault, { sourcesFolder });
  return report.sources
    .filter(
      (source) =>
        source.role === 'past-paper' && source.format === null && source.course === course,
    )
    .map((source) => source.path);
}

export interface PendingPaperTemplateReaderDeps {
  /** The scope-reading projection (`../scope-reading/persistence.ts`'s `load`). */
  readonly loadScopeReadings: () => Promise<ScopeReadingProjection>;
  /** The documents registered now as past papers (`registeredPastPapersFrom`). */
  readonly registeredPastPapers: () => Promise<readonly RegisteredPastPaper[]>;
  /** Each path's current revision digest; a path left out has no current revision. */
  readonly currentRevisions: (
    paths: readonly VaultPath[],
  ) => Promise<ReadonlyMap<VaultPath, string>>;
  /** Reader prompt versions accepted. Omitted: any version. */
  readonly policy?: ReadingPolicy;
  /** The course's Markdown past papers ({@link markdownPastPapersOf}). */
  readonly markdownPastPapers: (course: string) => Promise<readonly VaultPath[]>;
  /** One paper's local grouping ({@link groupPastPaperText}); `null` or a throw gives nothing for that paper. */
  readonly groupPaper: (path: VaultPath) => Promise<PastPaperTextGrouping | null>;
}

/**
 * The template of the course's first past paper, in path order, whose reading is pending and whose
 * local grouping forms one, or `null` when none does (module doc). Reads only; nothing is stored or
 * logged. Throws when a seam other than `groupPaper` throws; the provider reads that as none.
 */
export function createPendingPaperTemplateReader(
  deps: PendingPaperTemplateReaderDeps,
): (course: string) => Promise<PaperStructureTemplate | null> {
  return async (course) => {
    const registered = [
      ...new Set(
        (await deps.registeredPastPapers())
          .filter((paper) => paper.courses.includes(course))
          .map((paper) => paper.path),
      ),
    ].sort();
    const pending: VaultPath[] = [];
    if (registered.length > 0) {
      const [projection, revisions] = await Promise.all([
        deps.loadScopeReadings(),
        deps.currentRevisions(registered),
      ]);
      for (const path of registered) {
        const revisionDigest = revisions.get(path);
        let reading: PastPaperStoredReading | null = null;
        if (revisionDigest !== undefined) {
          const source: ScopeRevisionRef = {
            sourcePath: path,
            documentKind: 'past-paper',
            revisionDigest,
          };
          reading = {
            state: documentStateView(projection, source),
            structure: structureView(projection, source, deps.policy),
          };
        }
        if (pastPaperReadingPending(reading)) pending.push(path);
      }
    }
    // A Markdown paper is never read, so it is always pending; one also registered through her
    // review log is judged by its registration above.
    const registeredSet = new Set(registered);
    const markdown = (await deps.markdownPastPapers(course)).filter(
      (path) => !registeredSet.has(path),
    );
    for (const path of [...new Set([...pending, ...markdown])].sort()) {
      let text: PastPaperTextGrouping | null;
      try {
        text = await deps.groupPaper(path);
      } catch {
        continue;
      }
      if (text === null) continue;
      const template = pastPaperTemplateFromGrouping(text);
      if (template !== null) return template;
    }
    return null;
  };
}
