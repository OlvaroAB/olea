/**
 * `[D-247]`'s `'assessment-brief'` basis — `buildConceptAssessmentEdges`
 * tests for `ol-egov.142.2` (core half): "what this term's own assignment or
 * test says it covers" (F1.7's `AssessmentRecord.scope`) becomes a THIRD
 * concept-assessment-edge basis, on its own confidence, never folded into
 * past-paper or objectives evidence and never broadcast to a sibling
 * assessment that carries no brief of its own.
 *
 * Every fixture string here is INVENTED — course codes, concept names,
 * assignment text — per INV-3; nothing below is drawn from a real vault.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import { FolderSource } from '../vault/folder-source.js';
import { buildConceptAssessmentEdges } from './build.js';
import type { ConceptAssessmentEdge } from './types.js';

const BASE_PATH = '02 Assignments/Assignments.base';

function concept(name: string, courses: readonly string[]): ConceptRecord {
  return {
    key: `concept:${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    tier: 1,
    courses,
    sourcePaths: [],
  };
}

describe("buildConceptAssessmentEdges — [D-247] 'assessment-brief' basis", () => {
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

  it('produces a confidence-1 edge from a scope-aliased frontmatter property, citing the assessment itself — no exams needed (D-247: "a course with no exams or tests ranks from its briefs")', async () => {
    await write(
      '02 Assignments/Essay 1.md',
      '---\nclass: BRF101\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\nscope: Covers Widget theory in depth.\n---\n\n# Essay 1\n',
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Widget theory', ['BRF101'])],
      includeAssessmentBriefBasis: true,
    });

    const briefEdges = result.edges.filter((e) => e.basis === 'assessment-brief');
    expect(briefEdges).toHaveLength(1);
    const edge = briefEdges[0] as ConceptAssessmentEdge;
    expect(edge.conceptName).toBe('Widget theory');
    expect(edge.course).toBe('BRF101');
    expect(edge.assessmentPath).toBe('02 Assignments/Essay 1.md');
    expect(edge.confidence).toBe(1);
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

  it("reads the note's own body prose when no scope-aliased property is present (F1.7's stated-scope fallback)", async () => {
    await write(
      '02 Assignments/Essay 2.md',
      [
        '---',
        'class: BRF102',
        'type: Assignment',
        'weight: 20',
        'due: 2026-10-01',
        'status: upcoming',
        '---',
        '',
        '# Essay 2',
        '',
        'This assignment covers Gadget assembly from raw components onward.',
        '',
      ].join('\n'),
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Gadget assembly', ['BRF102'])],
      includeAssessmentBriefBasis: true,
    });

    const briefEdges = result.edges.filter((e) => e.basis === 'assessment-brief');
    expect(briefEdges).toHaveLength(1);
    expect(briefEdges[0]?.conceptName).toBe('Gadget assembly');
    expect(briefEdges[0]?.assessmentPath).toBe('02 Assignments/Essay 2.md');
  });

  it('never invents a brief: a heading-only note with no stated scope produces no assessment-brief edge and is reported as no-evidence', async () => {
    await write(
      '02 Assignments/Essay 3.md',
      '---\nclass: BRF103\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\n---\n\n# Essay 3\n',
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Widget theory', ['BRF103'])],
      includeAssessmentBriefBasis: true,
    });

    expect(result.edges.filter((e) => e.basis === 'assessment-brief')).toHaveLength(0);
    expect(result.assessmentsWithNoEvidence).toContain('02 Assignments/Essay 3.md');
  });

  it('never fuzzy-matches: a run-together superstring is not a word-bounded hit (R1/R2, same rule tier3-evidence applies)', async () => {
    await write(
      '02 Assignments/Essay 4.md',
      '---\nclass: BRF104\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\nscope: Actionpotentialsandgating are out of scope this term.\n---\n\n# Essay 4\n',
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Action potential', ['BRF104'])],
      includeAssessmentBriefBasis: true,
    });

    expect(result.edges.filter((e) => e.basis === 'assessment-brief')).toHaveLength(0);
    expect(result.assessmentsWithNoEvidence).toContain('02 Assignments/Essay 4.md');
  });

  it('attaches an assessment-brief edge only to the assessment whose OWN brief names the concept — never broadcast to a sibling assessment in the same course (the past-paper/objectives course-wide model does not apply here)', async () => {
    await write(
      '02 Assignments/Assignment A.md',
      '---\nclass: BRF202\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\nscope: Focuses on Sprocket alignment.\n---\n\n# Assignment A\n',
    );
    await write(
      '02 Assignments/Assignment B.md',
      '---\nclass: BRF202\ntype: Assignment\nweight: 20\ndue: 2026-11-01\nstatus: upcoming\n---\n\n# Assignment B\n',
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Sprocket alignment', ['BRF202'])],
      includeAssessmentBriefBasis: true,
    });

    const briefEdges = result.edges.filter((e) => e.basis === 'assessment-brief');
    expect(briefEdges).toHaveLength(1);
    expect(briefEdges[0]?.assessmentPath).toBe('02 Assignments/Assignment A.md');
    // Assignment B carries no brief of its own and cites no past-paper or
    // objectives evidence either — it stays in the no-evidence report,
    // never silently inheriting Assignment A's brief evidence.
    expect(result.assessmentsWithNoEvidence).toContain('02 Assignments/Assignment B.md');
    expect(
      result.edges.filter((e) => e.assessmentPath === '02 Assignments/Assignment B.md'),
    ).toHaveLength(0);
  });

  it('builds no brief edge when includeAssessmentBriefBasis is omitted (D-399 holds the weight)', async () => {
    await write(
      '02 Assignments/Essay 1.md',
      '---\nclass: BRF101\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\nscope: Covers Widget theory in depth.\n---\n\n# Essay 1\n',
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [concept('Widget theory', ['BRF101'])],
    });

    expect(result.edges.some((e) => e.basis === 'assessment-brief')).toBe(false);
  });
});
