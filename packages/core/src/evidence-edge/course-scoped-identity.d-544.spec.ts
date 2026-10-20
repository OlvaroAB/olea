/**
 * `[D-544]` (ruled by David 2026-10-17, `ol-egov.141.89.3.52`) at the concept↔assessment edge: a
 * course whose own assessment documents name a wording only another course's identity carries keys
 * its edges to a course-scoped identity of its own, never to the other course's identity. The
 * course's own identity still wins whenever it has one, in any letter case; an identity in no course
 * is still taken; a wording with no record still keeps its name.
 *
 * Every fixture string is invented: course codes, the wording, the papers.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listConceptKeyRecords } from '../concept/key-store.js';
import type { ConceptRecord } from '../concept/types.js';
import { FolderSource } from '../vault/folder-source.js';
import { buildConceptAssessmentEdges } from './build.js';

const BASE_PATH = '02 Assignments/Assignments.base';
const WORDING = 'Tessellite';
const C = 'CEE101';
const D = 'DEE202';
const C_PAPER = '03 Research/CEE101 Past Paper 2024.md';
const D_PAPER = '03 Research/DEE202 Past Paper 2024.md';

const D_IDENTITY: ConceptRecord = {
  key: 'concept-key1:dee-tessellite',
  name: WORDING,
  tier: 1,
  courses: [D],
  sourcePaths: ['01 Courses/DEE202/Week 1.md'],
  boundNotePath: 'Zettelkasten/Tessellite.md',
};

function assessmentNote(course: string, heading: string, extra = ''): string {
  return (
    `---\nclass: ${course}\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\n` +
    `${extra}---\n\n# ${heading}\n`
  );
}

function pastPaper(course: string, year: number, question: string): string {
  return [
    '---',
    'role: past-paper',
    `course: ${course}`,
    '---',
    '',
    `# ${course} Past Paper — ${year}`,
    '',
    '## Question 1 (10 marks)',
    '',
    question,
    '',
  ].join('\n');
}

describe('[D-544] buildConceptAssessmentEdges — a course never keys to another course’s identity', () => {
  let root: string;
  let source: FolderSource;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-edge-d544-'));
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
    await write(C_PAPER, pastPaper(C, 2024, `Explain ${WORDING} with an example.`));
    await write(D_PAPER, pastPaper(D, 2024, `Define ${WORDING}.`));
    await write('02 Assignments/Exam C.md', assessmentNote(C, 'Exam C'));
    await write('02 Assignments/Exam D.md', assessmentNote(D, 'Exam D'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keys course C's edges to a course-scoped identity of C, and leaves D's edges on D's identity", async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [D_IDENTITY],
      vocabulary: [WORDING],
      stampConceptKeys: true,
    });
    const cKeys = result.edges.filter((e) => e.course === C).map((e) => e.conceptKey);
    const dKeys = result.edges.filter((e) => e.course === D).map((e) => e.conceptKey);
    expect(dKeys).toEqual([D_IDENTITY.key]);
    expect(cKeys).toHaveLength(1);
    expect(cKeys[0]).not.toBe(D_IDENTITY.key);
    expect(cKeys[0]?.startsWith('concept-key1:')).toBe(true);

    expect(result.courseScopedConcepts).toEqual([
      expect.objectContaining({
        key: cKeys[0],
        name: WORDING,
        tier: 3,
        courses: [C],
        sourcePaths: [C_PAPER],
        anchor: expect.objectContaining({ sourcePath: C_PAPER }),
      }),
    ]);
  });

  it('finds the same course-scoped identity on the next build, and mints exactly one record naming the other identity', async () => {
    const options = {
      basePath: BASE_PATH,
      concepts: [D_IDENTITY],
      vocabulary: [WORDING],
      stampConceptKeys: true,
    };
    const first = await buildConceptAssessmentEdges(source, options);
    const second = await buildConceptAssessmentEdges(source, options);
    const keyOf = (r: typeof first) => r.edges.find((e) => e.course === C)?.conceptKey;
    expect(keyOf(second)).toBe(keyOf(first));

    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    const [only] = records;
    expect(only?.record).toMatchObject({
      key: keyOf(first),
      tier: 3,
      anchor: { kind: 'topic', course: C, name: WORDING, aliases: [], introducingPaths: [C_PAPER] },
      normalizationCollisions: [D_IDENTITY.key],
    });
  });

  it('without stamping, takes a provisional stand-in qualified by the course and writes nothing', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [D_IDENTITY],
      vocabulary: [WORDING],
    });
    expect(result.edges.filter((e) => e.course === C).map((e) => e.conceptKey)).toEqual([
      `concept-prov1:${WORDING}@${C}`,
    ]);
    expect(await listConceptKeyRecords(source)).toEqual([]);
  });

  it("the course's own identity wins, spelled exactly or in another letter case, and nothing is minted", async () => {
    for (const ownName of [WORDING, WORDING.toLowerCase()]) {
      const own: ConceptRecord = {
        key: `concept-key1:cee-own-${ownName}`,
        name: ownName,
        tier: 2,
        courses: [C],
        sourcePaths: ['01 Courses/CEE101/Week 2.md'],
      };
      const result = await buildConceptAssessmentEdges(source, {
        basePath: BASE_PATH,
        concepts: [own, D_IDENTITY],
        vocabulary: [WORDING],
        stampConceptKeys: true,
      });
      expect(result.edges.filter((e) => e.course === C).map((e) => e.conceptKey)).toEqual([
        own.key,
      ]);
      expect(result.courseScopedConcepts).toEqual([]);
    }
    expect(await listConceptKeyRecords(source)).toEqual([]);
  });

  it('an identity in no course is still taken, as before: it crosses no course boundary', async () => {
    const courseLess: ConceptRecord = {
      key: 'concept-key1:no-course',
      name: WORDING,
      tier: 1,
      courses: [],
      sourcePaths: ['Zettelkasten/Tessellite.md'],
    };
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [courseLess],
      vocabulary: [WORDING],
      stampConceptKeys: true,
    });
    expect(result.edges.map((e) => e.conceptKey)).toEqual([courseLess.key, courseLess.key]);
    expect(await listConceptKeyRecords(source)).toEqual([]);
  });

  it('a wording no course holds keeps the wording as its key, and nothing is minted', async () => {
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [],
      vocabulary: [WORDING],
      stampConceptKeys: true,
    });
    expect(result.edges.map((e) => e.conceptKey)).toEqual([WORDING, WORDING]);
    expect(result.courseScopedConcepts).toEqual([]);
    expect(await listConceptKeyRecords(source)).toEqual([]);
  });

  it('a declared assessment scope reaches the same course-scoped identity as a past paper', async () => {
    await write(
      '02 Assignments/Exam C.md',
      assessmentNote(C, 'Exam C', `scope: Covers ${WORDING} and more.\n`),
    );
    await rm(join(root, ...C_PAPER.split('/')));
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [D_IDENTITY],
      vocabulary: [WORDING],
      stampConceptKeys: true,
    });
    const cEdges = result.edges.filter((e) => e.course === C);
    expect(cEdges.map((e) => e.basis)).toEqual(['assessment-brief']);
    expect(cEdges[0]?.conceptKey).not.toBe(D_IDENTITY.key);
    expect(result.courseScopedConcepts.map((c) => c.sourcePaths)).toEqual([
      ['02 Assignments/Exam C.md'],
    ]);
    // The assessment note itself is read, never written.
    expect(await readFile(join(root, '02 Assignments', 'Exam C.md'), 'utf8')).toContain('scope:');
  });
});
