/**
 * `[D-247]`'s `'assessment-brief'` basis, at `[D-399]`'s declared weight —
 * `buildConceptAssessmentEdges` tests for `ol-egov.142.2` (core half) and
 * `ol-egov.141.89.10.71`: what an assessment's DECLARED scope says it covers
 * becomes a third concept-assessment-edge basis, on its own declared
 * confidence, never folded into past-paper or objectives evidence, never
 * broadcast to a sibling assessment, never read from body prose or an
 * inferred scope, and on for every production ranking caller.
 *
 * Every fixture string here is INVENTED — course codes, concept names,
 * assignment text — per INV-3; nothing below is drawn from a real vault.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractDeclaredScope,
  extractStatedScope,
  readDeclaredScope,
  resolveScope,
} from '../assessment/scope.js';
import { parseDocument } from '../block/parse.js';
import type { ConceptRecord } from '../concept/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { composeOracleRanking } from '../oracle/compose.js';
import { FolderSource } from '../vault/folder-source.js';
import { ASSESSMENT_BRIEF_CONFIDENCE, buildConceptAssessmentEdges } from './build.js';
import type { ConceptAssessmentEdge } from './types.js';

const BASE_PATH = '02 Assignments/Assignments.base';

function concept(name: string, courses: readonly string[], key?: string): ConceptRecord {
  return {
    key: key ?? `concept:${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    tier: 1,
    courses,
    sourcePaths: [],
  };
}

function assessmentNote(course: string, heading: string, extra = '', body = ''): string {
  return (
    `---\nclass: ${course}\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\n` +
    `${extra}---\n\n# ${heading}\n${body === '' ? '' : `\n${body}\n`}`
  );
}

function pastPaper(course: string, year: number, questions: readonly string[]): string {
  return [
    '---',
    'role: past-paper',
    `course: ${course}`,
    '---',
    '',
    `# ${course} Past Paper — ${year}`,
    '',
    ...questions.flatMap((text, i) => [`## Question ${i + 1} (10 marks)`, '', text, '']),
  ].join('\n');
}

function briefEdgesOf(edges: readonly ConceptAssessmentEdge[]): ConceptAssessmentEdge[] {
  return edges.filter((e) => e.basis === 'assessment-brief');
}

describe("buildConceptAssessmentEdges — [D-247]/[D-399] 'assessment-brief' basis", () => {
  let root: string;
  let source: FolderSource;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-edge-brief-'));
    source = new FolderSource(root);
    await write(
      BASE_PATH,
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        '    - file.ext == "md"',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('produces an edge at the declared confidence from a scope-aliased frontmatter property, citing the assessment itself — no exams needed (D-247: "a course with no exams or tests ranks from its briefs")', async () => {
    await write(
      '02 Assignments/Essay 1.md',
      assessmentNote('BRF101', 'Essay 1', 'scope: Covers Widget theory in depth.\n'),
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Widget theory', ['BRF101'])],
    });

    const briefEdges = briefEdgesOf(result.edges);
    expect(briefEdges).toHaveLength(1);
    const edge = briefEdges[0] as ConceptAssessmentEdge;
    expect(edge.conceptName).toBe('Widget theory');
    expect(edge.conceptKey).toBe('concept:widget-theory');
    expect(edge.course).toBe('BRF101');
    expect(edge.assessmentPath).toBe('02 Assignments/Essay 1.md');
    expect(edge.confidence).toBe(ASSESSMENT_BRIEF_CONFIDENCE);
    expect(edge.yieldRank).toBe(1);
    expect(edge.citations).toEqual([]);
    expect(edge.objectivesCitations).toBeUndefined();
    expect(edge.briefCitations).toEqual([
      {
        sourcePath: '02 Assignments/Essay 1.md',
        provenance: { sourcePath: '02 Assignments/Essay 1.md', location: { page: 1 } },
      },
    ]);
    // A course with zero past-paper/objectives evidence still ranks from its
    // brief — the assessment must never fall into the "no evidence" report.
    expect(result.assessmentsWithNoEvidence).not.toContain('02 Assignments/Essay 1.md');
  });

  it('[D-399] condition 4: a concept name in the body prose is wording, not a statement of coverage — no brief edge, and the assessment reports no evidence; the same name in a declared scope yields one', async () => {
    await write(
      '02 Assignments/Essay 2.md',
      assessmentNote(
        'BRF102',
        'Essay 2',
        '',
        'Unlike last term, this assignment does not revisit Gadget assembly.',
      ),
    );
    await write(
      '02 Assignments/Essay 3.md',
      assessmentNote('BRF102', 'Essay 3', 'covers: Gadget assembly\n'),
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Gadget assembly', ['BRF102'])],
    });

    const briefEdges = briefEdgesOf(result.edges);
    expect(briefEdges.map((e) => e.assessmentPath)).toEqual(['02 Assignments/Essay 3.md']);
    expect(result.assessmentsWithNoEvidence).toContain('02 Assignments/Essay 2.md');
    // The F1.7 stated scope (which the within-block grouping reads) still
    // carries the prose — only the ranking's brief basis refuses it.
    const essay2 = result.assessmentsRead.records.find(
      (r) => r.path === '02 Assignments/Essay 2.md',
    );
    expect(essay2?.scope).toContain('Gadget assembly');
  });

  it('[D-399] condition 4: an inferred scope never yields a brief edge — the declared reader ignores body prose and never consults inference candidates', async () => {
    const note = assessmentNote('BRF103', 'Quiz', '', 'Weeks one to three.');
    await write('02 Assignments/Quiz.md', note);
    const doc = parseDocument(note);
    const first = doc.blocks[0];
    if (first?.kind !== 'frontmatter') throw new Error('fixture has no frontmatter');
    const fm = parseFrontmatter(first.inner);

    expect(extractStatedScope(fm, doc)).toBe('Weeks one to three.');
    expect(extractDeclaredScope(fm)).toBeUndefined();
    expect(await readDeclaredScope(source, '02 Assignments/Quiz.md')).toBeUndefined();
    // An inferred scope exists only as `resolveScope`'s output, which the
    // brief basis never reads.
    expect(resolveScope(undefined, [{ label: 'Widget theory' }])?.origin).toBe('inferred');

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Widget theory', ['BRF103'])],
    });
    expect(briefEdgesOf(result.edges)).toHaveLength(0);
    expect(result.assessmentsWithNoEvidence).toContain('02 Assignments/Quiz.md');
  });

  it('never invents a brief: a heading-only note with no stated scope produces no assessment-brief edge and is reported as no-evidence', async () => {
    await write('02 Assignments/Essay 4.md', assessmentNote('BRF104', 'Essay 4'));

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Widget theory', ['BRF104'])],
    });

    expect(briefEdgesOf(result.edges)).toHaveLength(0);
    expect(result.assessmentsWithNoEvidence).toContain('02 Assignments/Essay 4.md');
  });

  it('never fuzzy-matches: a run-together superstring is not a word-bounded hit (R1/R2, same rule tier3-evidence applies)', async () => {
    await write(
      '02 Assignments/Essay 5.md',
      assessmentNote('BRF105', 'Essay 5', 'scope: Actionpotentialsandgating this term.\n'),
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Action potential', ['BRF105'])],
    });

    expect(briefEdgesOf(result.edges)).toHaveLength(0);
    expect(result.assessmentsWithNoEvidence).toContain('02 Assignments/Essay 5.md');
  });

  it('attaches an assessment-brief edge only to the assessment whose OWN scope names the concept — never broadcast to a sibling assessment in the same course', async () => {
    await write(
      '02 Assignments/Assignment A.md',
      assessmentNote('BRF202', 'Assignment A', 'scope: Focuses on Sprocket alignment.\n'),
    );
    await write('02 Assignments/Assignment B.md', assessmentNote('BRF202', 'Assignment B'));

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Sprocket alignment', ['BRF202'])],
    });

    const briefEdges = briefEdgesOf(result.edges);
    expect(briefEdges).toHaveLength(1);
    expect(briefEdges[0]?.assessmentPath).toBe('02 Assignments/Assignment A.md');
    expect(result.assessmentsWithNoEvidence).toContain('02 Assignments/Assignment B.md');
    expect(
      result.edges.filter((e) => e.assessmentPath === '02 Assignments/Assignment B.md'),
    ).toHaveLength(0);
  });

  it('[D-399]: the brief basis is on by default; only an explicit false leaves it out', async () => {
    await write(
      '02 Assignments/Essay 1.md',
      assessmentNote('BRF101', 'Essay 1', 'scope: Covers Widget theory in depth.\n'),
    );
    const concepts = [concept('Widget theory', ['BRF101'])];

    const byDefault = await buildConceptAssessmentEdges(source, { basePath: BASE_PATH, concepts });
    const optedOut = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts,
      includeAssessmentBriefBasis: false,
    });

    expect(briefEdgesOf(byDefault.edges)).toHaveLength(1);
    expect(briefEdgesOf(optedOut.edges)).toHaveLength(0);
  });

  describe('a mixed course — past papers plus a declared scope', () => {
    // Six papers: Widget theory in all six, Gadget assembly in the first
    // two, Sprocket alignment in the first only. Flux tuning appears in no
    // paper at all — the newly declared topic.
    const NAMES = ['Widget theory', 'Gadget assembly', 'Sprocket alignment', 'Flux tuning'];
    const CONCEPTS = NAMES.map((name) => concept(name, ['MIX101']));

    async function writeMixedCourse(scopeLine: string): Promise<void> {
      for (const name of NAMES) await write(`05 Zettelkasten/${name}.md`, `# ${name}\n`);
      for (let i = 0; i < 6; i++) {
        const questions = ['Explain Widget theory under load.'];
        if (i < 2) questions.push('Describe Gadget assembly step by step.');
        if (i === 0) questions.push('Why does Sprocket alignment drift?');
        await write(
          `03 Research/MIX101 Past Paper ${2020 + i}.md`,
          pastPaper('MIX101', 2020 + i, questions),
        );
      }
      await write(
        '02 Assignments/Project.md',
        assessmentNote('MIX101', 'Project', `${scopeLine}\n`),
      );
    }

    it('[D-399] condition 1 via the production composition: a topic only the scope names ranks above zero, and below a concept the scope equally names that the papers also cite', async () => {
      await writeMixedCourse('scope: Flux tuning and Widget theory');

      // `composeOracleRanking` is the one composition every production
      // ranking caller goes through (`packages/plugin/src/gap/provider.ts`,
      // `plan/provider.ts`, `session-builder/provider.ts`,
      // `registry/provider.ts`), and none of them names the brief basis.
      const { ranking } = await composeOracleRanking({
        vault: source,
        basePath: BASE_PATH,
        concepts: CONCEPTS,
        reviewLog: [],
        asOf: '2026-09-01',
      });

      const course = ranking.courses.find((c) => c.course === 'MIX101');
      if (course === undefined || course.status !== 'ranked') {
        throw new Error('expected MIX101 to be ranked');
      }
      const names = course.ranked.map((entry) => entry.conceptName);
      const flux = course.ranked.find((entry) => entry.conceptName === 'Flux tuning');
      expect(flux).toBeDefined();
      expect(flux?.factors.preMasteryScore).toBeGreaterThan(0);
      expect(flux?.priorityScore).toBeGreaterThan(0);
      expect(names.indexOf('Flux tuning')).toBeGreaterThan(names.indexOf('Widget theory'));
      // Distinct bases on distinct evidence each count (condition 3's second
      // half): Widget theory carries both its past-paper and its brief
      // contribution on the one assessment.
      const widget = course.ranked.find((entry) => entry.conceptName === 'Widget theory');
      expect(widget?.factors.contributions).toHaveLength(2);
    });

    it('[D-399]: the brief confidence is the one declared value, below what a single citation carries in a course of six papers', async () => {
      await writeMixedCourse('scope: Flux tuning');

      const result = await buildConceptAssessmentEdges(source, {
        basePath: BASE_PATH,
        concepts: CONCEPTS,
      });

      const brief = briefEdgesOf(result.edges);
      expect(brief.map((e) => e.conceptName)).toEqual(['Flux tuning']);
      expect(brief[0]?.confidence).toBe(ASSESSMENT_BRIEF_CONFIDENCE);
      const sprocket = result.edges.find(
        (e) => e.conceptName === 'Sprocket alignment' && e.basis === 'past-paper',
      );
      expect(sprocket?.confidence).toBeCloseTo(1 / 6);
      expect(ASSESSMENT_BRIEF_CONFIDENCE).toBeLessThan(sprocket?.confidence ?? 0);
      expect(ASSESSMENT_BRIEF_CONFIDENCE).toBeGreaterThan(0);
      // Placed where the course's first single-citation concept sits (one
      // past the two concepts cited more than once), never above them.
      expect(brief[0]?.yieldRank).toBe(3);
    });

    it('[D-399] condition 2: the current scope never decays older papers — every past-paper edge is identical with and without the brief', async () => {
      await writeMixedCourse('scope: Flux tuning');

      const withBrief = await buildConceptAssessmentEdges(source, {
        basePath: BASE_PATH,
        concepts: CONCEPTS,
      });
      const withoutBrief = await buildConceptAssessmentEdges(source, {
        basePath: BASE_PATH,
        concepts: CONCEPTS,
        includeAssessmentBriefBasis: false,
      });

      const pastPaperEdges = (edges: readonly ConceptAssessmentEdge[]) =>
        edges.filter((e) => e.basis === 'past-paper');
      expect(pastPaperEdges(withBrief.edges)).toEqual(pastPaperEdges(withoutBrief.edges));
      expect(pastPaperEdges(withBrief.edges)).toHaveLength(3);
      expect(briefEdgesOf(withBrief.edges)).toHaveLength(1);
    });
  });

  it('[D-399] condition 3: the same statement reaching one assessment twice counts once — two names for one concept key yield one brief edge', async () => {
    await write(
      '02 Assignments/Essay 6.md',
      assessmentNote('BRF106', 'Essay 6', 'scope: Widget theory, and widget Theory again\n'),
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [
        concept('Widget theory', ['BRF106'], 'concept:widget'),
        concept('widget Theory', ['BRF106'], 'concept:widget'),
      ],
    });

    const brief = briefEdgesOf(result.edges);
    expect(brief).toHaveLength(1);
    expect(brief[0]?.conceptKey).toBe('concept:widget');
  });

  it('[D-399] condition 3: a declared scope on a note that is also registered as the course objectives adds no second edge for a concept that note already cites', async () => {
    await write('05 Zettelkasten/Widget theory.md', '# Widget theory\n');
    await write(
      '02 Assignments/Syllabus task.md',
      assessmentNote(
        'BRF107',
        'Syllabus task',
        'scope: Widget theory\n',
        '- Describe the essentials of Widget theory.',
      ),
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Widget theory', ['BRF107'])],
      registeredFiles: [
        { path: '02 Assignments/Syllabus task.md', role: 'objectives', course: 'BRF107' },
      ],
    });

    const onTask = result.edges.filter(
      (e) => e.assessmentPath === '02 Assignments/Syllabus task.md',
    );
    expect(onTask.map((e) => e.basis)).toEqual(['objectives']);
  });
});
