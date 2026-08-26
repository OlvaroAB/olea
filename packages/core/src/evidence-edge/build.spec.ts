/**
 * `buildConceptAssessmentEdges` tests (knowledge model §5, P5-T03).
 *
 * Every fixture string here is INVENTED — course codes, concept names,
 * question text — per INV-3; nothing below is drawn from a real vault.
 *
 * One shared synthetic vault covers the acceptance criterion and its
 * companions at once, the same way `assessment/read.spec.ts`'s synthetic
 * suite builds one small fixture per `describe` rather than reusing the
 * frozen `fixtures/vault` corpus (which this module deliberately does not
 * touch — see the task brief's ownership boundary).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConceptCitation } from '../tier3-evidence/types.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  buildConceptAssessmentEdges,
  buildQuestionIndex,
  resolveCitations,
  UnresolvableCitationError,
} from './build.js';
import type { ConceptAssessmentEdge } from './types.js';

const BASE_PATH = '02 Assignments/Assignments.base';
/**
 * `ol-63e1`: `BuildConceptAssessmentEdgesOptions.concepts` is required, but
 * this suite asserts on `conceptName`/edge shape only, never on the opaque
 * `conceptKey` — an empty list is deliberate here, exercising the documented
 * fallback (`conceptKey` defaults to the matched vocabulary name) rather than
 * running a full concept extraction this suite has no other use for.
 * `conceptKey.spec.ts` covers the real resolution path.
 */
const NO_CONCEPTS: readonly never[] = [];

describe('buildConceptAssessmentEdges — synthetic vault covering the acceptance criteria', () => {
  let root: string;
  let source: FolderSource;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-edge-'));
    source = new FolderSource(root);

    // Zettelkasten — the default vocabulary. `Reagent titration` is never
    // mentioned by anything below; `Flux capacitor tuning` is mentioned only
    // by the objectives document, never by a past paper.
    await write('05 Zettelkasten/Widget theory.md', '# Widget theory\n');
    await write('05 Zettelkasten/Gadget assembly.md', '# Gadget assembly\n');
    await write('05 Zettelkasten/Sprocket alignment.md', '# Sprocket alignment\n');
    await write('05 Zettelkasten/Reagent titration.md', '# Reagent titration\n');
    await write('05 Zettelkasten/Flux capacitor tuning.md', '# Flux capacitor tuning\n');

    // Past papers. TESTC101 gets two years — Widget theory is cited by both
    // (confidence 1.0), Gadget assembly by only the 2023 one (confidence
    // 0.5). TESTC202 gets one paper citing a different concept entirely.
    // TESTC303 gets none at all — the zero-evidence course.
    await write(
      '03 Research/TESTC101 Past Paper 2023.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2023',
        '',
        '## Question 1 (10 marks)',
        '',
        'Explain the core mechanism behind Widget theory and why it matters.',
        '',
        '## Question 2 (10 marks)',
        '',
        'Describe how Gadget assembly proceeds from raw components to a finished unit.',
        '',
      ].join('\n'),
    );
    await write(
      '03 Research/TESTC101 Past Paper 2024.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2024',
        '',
        '## Question 1 (10 marks)',
        '',
        'Widget theory predicts a specific outcome under load — derive it.',
        '',
      ].join('\n'),
    );
    await write(
      '03 Research/TESTC101 Course Objectives.md',
      [
        '---',
        'role: objectives',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 — Course Objectives',
        '',
        '- Describe the essentials of Flux capacitor tuning and its constraints.',
        '',
      ].join('\n'),
    );
    await write(
      '03 Research/TESTC202 Past Paper 2023.md',
      [
        '---',
        'role: past-paper',
        'course: TESTC202',
        '---',
        '',
        '# TESTC202 Past Paper — 2023',
        '',
        '## Question 1 (10 marks)',
        '',
        'Justify the standard procedure for Sprocket alignment on a test rig.',
        '',
      ].join('\n'),
    );

    // Assignments Base: TESTC101 has two assessments (broadcast test),
    // TESTC202 has one, TESTC303 has one with NO past-paper evidence at
    // all, and one assessment carries no `class` key whatsoever.
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
    await write(
      '02 Assignments/Quiz 1.md',
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    );
    await write(
      '02 Assignments/Final Exam.md',
      '---\nclass: TESTC101\ntype: Test\nweight: 50\ndue: 2026-11-01\nstatus: upcoming\n---\n\n# Final Exam\n',
    );
    await write(
      '02 Assignments/Essay 1.md',
      '---\nclass: TESTC202\ntype: Assignment\nweight: 20\ndue: 2026-09-15\nstatus: upcoming\n---\n\n# Essay 1\n',
    );
    await write(
      '02 Assignments/Lab 1.md',
      '---\nclass: TESTC303\ntype: Lab\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Lab 1\n',
    );
    await write(
      '02 Assignments/Mystery Task.md',
      '---\ntype: Quiz\nweight: 5\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Mystery Task\n',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('ACCEPTANCE: an assessment whose course has zero registered/citing past papers gets zero edges — not implied ones', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    const labEdges = result.edges.filter((e) => e.assessmentPath === '02 Assignments/Lab 1.md');
    expect(labEdges).toEqual([]);
    expect(result.assessmentsWithNoEvidence).toEqual(['02 Assignments/Lab 1.md']);
  });

  it('never manufactures an edge for a zettel concept that no past paper ever cites', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    const names = new Set(result.edges.map((e) => e.conceptName));
    expect(names.has('Reagent titration')).toBe(false);
  });

  it('excludes objectives-only evidence — a concept cited only by the objectives document gets no edge, even in a course with real past-paper evidence', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    // TESTC101 legitimately has edges (Widget theory, Gadget assembly), so
    // this is not the zero-evidence-course case — it isolates the citation
    // KIND filter specifically.
    const names = new Set(
      result.edges.filter((e) => e.course === 'TESTC101').map((e) => e.conceptName),
    );
    expect(names.has('Flux capacitor tuning')).toBe(false);
    expect([...names].sort()).toEqual(['Gadget assembly', 'Widget theory']);
  });

  it('an assessment with no `class` value is never guessed into a course, and never receives an edge', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    expect(result.assessmentsWithoutCourse).toEqual(['02 Assignments/Mystery Task.md']);
    expect(result.edges.some((e) => e.assessmentPath === '02 Assignments/Mystery Task.md')).toBe(
      false,
    );
  });

  it('partial evidence: only the concepts actually cited get edges, not every zettel concept in the course', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    const testc101Concepts = new Set(
      result.edges.filter((e) => e.course === 'TESTC101').map((e) => e.conceptName),
    );
    expect(testc101Concepts).toEqual(new Set(['Widget theory', 'Gadget assembly']));
  });

  it('confidence is the fraction of a course’s distinct past papers that cite the concept, and yield rank orders by citation breadth', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    const quiz1 = result.edges.filter((e) => e.assessmentPath === '02 Assignments/Quiz 1.md');

    const widget = quiz1.find((e) => e.conceptName === 'Widget theory');
    const gadget = quiz1.find((e) => e.conceptName === 'Gadget assembly');
    expect(widget).toBeDefined();
    expect(gadget).toBeDefined();

    // Widget theory: cited by both TESTC101 papers -> confidence 1.0.
    expect(widget?.confidence).toBe(1);
    expect(widget?.citations).toHaveLength(2);
    // Gadget assembly: cited by only the 2023 paper of two -> confidence 0.5.
    expect(gadget?.confidence).toBe(0.5);
    expect(gadget?.citations).toHaveLength(1);

    // More citing questions -> better (lower) rank.
    expect(widget?.yieldRank).toBe(1);
    expect(gadget?.yieldRank).toBe(2);

    const sprocket = result.edges.find(
      (e) =>
        e.assessmentPath === '02 Assignments/Essay 1.md' && e.conceptName === 'Sprocket alignment',
    );
    expect(sprocket?.confidence).toBe(1);
    expect(sprocket?.yieldRank).toBe(1);
  });

  it('course-level broadcast (documented Class B call): every assessment sharing a course gets the identical edge set, differing only by assessmentPath', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    const strip = (e: ConceptAssessmentEdge) => {
      const { assessmentPath: _assessmentPath, ...rest } = e;
      return rest;
    };
    const quiz1 = result.edges
      .filter((e) => e.assessmentPath === '02 Assignments/Quiz 1.md')
      .map(strip)
      .sort((a, b) => (a.conceptName < b.conceptName ? -1 : 1));
    const finalExam = result.edges
      .filter((e) => e.assessmentPath === '02 Assignments/Final Exam.md')
      .map(strip)
      .sort((a, b) => (a.conceptName < b.conceptName ? -1 : 1));
    expect(finalExam).toEqual(quiz1);
    expect(quiz1).toHaveLength(2);
  });

  it('every citation carried on an edge is real: sourcePath + questionLabel resolve to what segmentPastPaper actually produced', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    for (const edge of result.edges) {
      for (const citation of edge.citations) {
        expect(citation.sourcePath).toMatch(/^03 Research\//);
        expect(citation.questionLabel).toBeTruthy();
        expect(citation.questionText.length).toBeGreaterThan(0);
      }
    }
  });

  it('rebuild-from-source equivalence: calling it twice against the same vault yields identical output', async () => {
    const first = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    const second = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: NO_CONCEPTS,
    });
    expect(second).toEqual(first);
  });

  it('C7/INV-2: building edges writes nothing back to the vault', async () => {
    const allPaths = await source.list();
    const before = new Map(
      await Promise.all(allPaths.map(async (p) => [p, await source.read(p)] as const)),
    );
    await buildConceptAssessmentEdges(source, { basePath: BASE_PATH, concepts: NO_CONCEPTS });
    const after = new Map(
      await Promise.all(allPaths.map(async (p) => [p, await source.read(p)] as const)),
    );
    expect(after).toEqual(before);
    expect(await source.list()).toEqual(allPaths);
  });
});

describe('resolveCitations — the trust boundary an edge’s citations must clear', () => {
  const provenance = {
    sourcePath: '03 Research/TESTC101 Past Paper 2023.md',
    location: { page: 1, charRange: { start: 0, end: 10 } },
  } as const;

  function pastPaperCitation(overrides: Partial<ConceptCitation> = {}): ConceptCitation {
    return {
      conceptName: 'Widget theory',
      kind: 'past-paper',
      sourcePath: '03 Research/TESTC101 Past Paper 2023.md',
      course: 'TESTC101',
      provenance,
      questionLabel: '1',
      questionText: 'Explain the core mechanism behind Widget theory.',
      ...overrides,
    };
  }

  it('does not throw when the citation resolves to a real indexed question', () => {
    const index = new Map([['03 Research/TESTC101 Past Paper 2023.md', new Set(['1', '2'])]]);
    expect(() => resolveCitations([pastPaperCitation()], index)).not.toThrow();
  });

  it('MUTATION: a questionLabel not present in the index is refused, never silently dropped', () => {
    const index = new Map([['03 Research/TESTC101 Past Paper 2023.md', new Set(['1', '2'])]]);
    const mutated = pastPaperCitation({ questionLabel: '999' });
    expect(() => resolveCitations([mutated], index)).toThrow(UnresolvableCitationError);
  });

  it('MUTATION: a sourcePath absent from the index entirely is refused', () => {
    const index = new Map([['03 Research/TESTC101 Past Paper 2023.md', new Set(['1', '2'])]]);
    const mutated = pastPaperCitation({ sourcePath: '03 Research/Nonexistent Paper.md' });
    expect(() => resolveCitations([mutated], index)).toThrow(UnresolvableCitationError);
  });

  it('non-past-paper citations are never checked against the index (objectives carries no questionLabel by construction)', () => {
    const index = new Map<string, ReadonlySet<string>>();
    const objectivesCitation: ConceptCitation = {
      conceptName: 'Flux capacitor tuning',
      kind: 'objectives',
      sourcePath: '03 Research/TESTC101 Course Objectives.md',
      course: 'TESTC101',
      provenance,
    };
    expect(() => resolveCitations([objectivesCitation], index)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ol-3ux7.10 — a registered PDF past paper reaches this edge too, once
// `segmentPlainTextPastPaper` confidently splits it into questions. Every
// string below is invented, per INV-3.
// ---------------------------------------------------------------------------

/**
 * A minimal, valid, single-page PDF with one `Tj` — the same hand-built style
 * `../concept/evidence.spec.ts` and `../extract/pdf.spec.ts` use, so this
 * exercises the real extractor rather than a mock of it.
 */
function buildPdfBytes(pageText: string): Uint8Array {
  const escapeLiteral = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const raw = `BT /F1 12 Tf 20 150 Td (${escapeLiteral(pageText)}) Tj ET`;
  const text =
    '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R ' +
    '/Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n' +
    `5 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n` +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

describe('buildConceptAssessmentEdges — a registered PDF past paper (ol-3ux7.10)', () => {
  let root: string;
  let source: FolderSource;
  const PDF_BASE_PATH = '02 Assignments/Assignments.base';

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async function writePdf(relPath: string, pageText: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buildPdfBytes(pageText));
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-edge-pdf-'));
    source = new FolderSource(root);

    await write('05 Zettelkasten/Widget theory.md', '# Widget theory\n');
    await write(
      PDF_BASE_PATH,
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        '    - file.ext == "md"',
        'properties:',
        '  class:',
        '  type:',
      ].join('\n'),
    );
    await write('02 Assignments/Quiz 1.md', '---\nclass: TESTP101\ntype: Quiz\n---\n\n# Quiz 1\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a PDF past paper that segments produces a real edge, with a resolved question-level citation', async () => {
    await writePdf('03 Research/2023.pdf', 'Question 1. Explain Widget theory. (10 marks)');

    const result = await buildConceptAssessmentEdges(source, {
      basePath: PDF_BASE_PATH,
      concepts: NO_CONCEPTS,
      registeredFiles: [{ path: '03 Research/2023.pdf', role: 'past-paper', course: 'TESTP101' }],
    });

    const edge = result.edges.find(
      (e) => e.assessmentPath === '02 Assignments/Quiz 1.md' && e.conceptName === 'Widget theory',
    );
    expect(edge).toBeDefined();
    expect(edge?.confidence).toBe(1);
    expect(edge?.citations).toHaveLength(1);
    expect(edge?.citations[0]?.sourcePath).toBe('03 Research/2023.pdf');
    expect(edge?.citations[0]?.questionLabel).toBe('1');
    expect(edge?.citations[0]?.questionText).toContain('Widget theory');
    expect(result.assessmentsWithNoEvidence).toEqual([]);
  });

  it('a PDF past paper with no recognisable question numbering abstains — no edge, no throw, reported as no-evidence', async () => {
    await writePdf(
      '03 Research/2024.pdf',
      'Widget theory is covered extensively throughout this booklet.',
    );

    const result = await buildConceptAssessmentEdges(source, {
      basePath: PDF_BASE_PATH,
      concepts: NO_CONCEPTS,
      registeredFiles: [{ path: '03 Research/2024.pdf', role: 'past-paper', course: 'TESTP101' }],
    });

    expect(result.edges.some((e) => e.assessmentPath === '02 Assignments/Quiz 1.md')).toBe(false);
    expect(result.assessmentsWithNoEvidence).toEqual(['02 Assignments/Quiz 1.md']);
  });
});

describe('buildQuestionIndex — a registered PDF past paper re-extracts and re-segments independently (ol-3ux7.10)', () => {
  let root: string;
  let source: FolderSource;

  async function writePdf(relPath: string, pageText: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buildPdfBytes(pageText));
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-edge-pdf-index-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('indexes the labels segmentPlainTextPastPaper produces for a binary source', async () => {
    await writePdf('03 Research/2023.pdf', 'Question 1. Explain Widget theory. (10 marks)');

    const index = await buildQuestionIndex(source, [
      {
        path: '03 Research/2023.pdf',
        role: 'past-paper',
        course: 'TESTP101',
        kind: 'registered-file',
        format: 'pdf',
      },
    ]);
    expect(index.get('03 Research/2023.pdf')).toEqual(new Set(['1']));
  });

  it('leaves an unsegmentable binary source OUT of the index entirely, rather than an empty entry', async () => {
    await writePdf('03 Research/2024.pdf', 'Widget theory is covered extensively.');

    const index = await buildQuestionIndex(source, [
      {
        path: '03 Research/2024.pdf',
        role: 'past-paper',
        course: 'TESTP101',
        kind: 'registered-file',
        format: 'pdf',
      },
    ]);
    expect(index.has('03 Research/2024.pdf')).toBe(false);
  });
});

describe('buildQuestionIndex — independently re-derives real question labels from the source text', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-edge-index-'));
    source = new FolderSource(root);
    const full = join(root, '03 Research');
    await mkdir(full, { recursive: true });
    await writeFile(
      join(full, 'TESTC101 Past Paper 2023.md'),
      [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '## Question 1 (10 marks)',
        '',
        'Body text for question one.',
        '',
        '## Question 2 (10 marks)',
        '',
        'Body text for question two.',
        '',
      ].join('\n'),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('indexes exactly the labels segmentPastPaper produces, from a re-read of the source text', async () => {
    const index = await buildQuestionIndex(source, [
      {
        path: '03 Research/TESTC101 Past Paper 2023.md',
        role: 'past-paper',
        course: 'TESTC101',
        kind: 'registered-file',
        format: null,
      },
    ]);
    expect(index.get('03 Research/TESTC101 Past Paper 2023.md')).toEqual(new Set(['1', '2']));
  });
});
