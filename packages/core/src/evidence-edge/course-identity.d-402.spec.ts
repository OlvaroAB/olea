/**
 * `[D-402]` binding condition 2 at the concept↔assessment edge: when one wording has one
 * identity per course, an edge of course X keys to course X's identity, never to whichever
 * record of the wording happens to be listed last. Before this, `buildConceptAssessmentEdges`
 * resolved `conceptKey` through a name-only map, so a split wording's demand in one course could
 * land on the other course's identity, and which one depended on extraction order.
 *
 * Also pinned, unchanged on purpose: a wording with no identity in the edge's course still takes
 * the wording's identity elsewhere (whether it should is not ruled), and a wording with no record
 * at all still falls back to its name.
 *
 * Every fixture string here is INVENTED — course codes, concept names, assessment text — per
 * INV-3; nothing below is drawn from a real vault.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import { composeOracleRanking } from '../oracle/compose.js';
import { FolderSource } from '../vault/folder-source.js';
import { buildConceptAssessmentEdges } from './build.js';

const BASE_PATH = '02 Assignments/Assignments.base';
const WORDING = 'Flux tuning';

function identity(key: string, courses: readonly string[], name = WORDING): ConceptRecord {
  return { key, name, tier: 2, courses, sourcePaths: [] };
}

const IN_ONE = identity('concept-key1:flux-one', ['ONE101']);
const IN_TWO = identity('concept-key1:flux-two', ['TWO202']);

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

describe('buildConceptAssessmentEdges — [D-402] an edge keys to its own course’s identity', () => {
  let root: string;
  let source: FolderSource;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-evidence-edge-d402-'));
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

  it("brief basis: course ONE's declared scope keys to ONE's identity even when TWO's identity is listed last", async () => {
    await write(
      '02 Assignments/Essay.md',
      assessmentNote('ONE101', 'Essay', `scope: Covers ${WORDING}.\n`),
    );

    for (const concepts of [
      [IN_ONE, IN_TWO],
      [IN_TWO, IN_ONE],
    ]) {
      const result = await buildConceptAssessmentEdges(source, { basePath: BASE_PATH, concepts });
      const edges = result.edges.filter((e) => e.course === 'ONE101');
      expect(edges).toHaveLength(1);
      expect(edges[0]?.basis).toBe('assessment-brief');
      expect(edges[0]?.conceptKey).toBe(IN_ONE.key);
    }
  });

  it("past-paper basis: each course's paper keys to that course's identity, whatever the listing order", async () => {
    await write(
      '03 Research/ONE101 Past Paper 2024.md',
      pastPaper('ONE101', 2024, `Explain ${WORDING}.`),
    );
    await write(
      '03 Research/TWO202 Past Paper 2024.md',
      pastPaper('TWO202', 2024, `Define ${WORDING}.`),
    );
    await write('02 Assignments/Exam ONE.md', assessmentNote('ONE101', 'Exam ONE'));
    await write('02 Assignments/Exam TWO.md', assessmentNote('TWO202', 'Exam TWO'));

    for (const concepts of [
      [IN_ONE, IN_TWO],
      [IN_TWO, IN_ONE],
    ]) {
      const result = await buildConceptAssessmentEdges(source, {
        basePath: BASE_PATH,
        concepts,
        vocabulary: [WORDING],
      });
      const one = result.edges.filter((e) => e.course === 'ONE101' && e.basis === 'past-paper');
      const two = result.edges.filter((e) => e.course === 'TWO202' && e.basis === 'past-paper');
      expect(one).toHaveLength(1);
      expect(two).toHaveLength(1);
      expect(one[0]?.conceptKey).toBe(IN_ONE.key);
      expect(two[0]?.conceptKey).toBe(IN_TWO.key);
    }
  });

  it('through the production composition, each course ranks its own identity and neither borrows the other', async () => {
    await write(
      '03 Research/ONE101 Past Paper 2024.md',
      pastPaper('ONE101', 2024, `Explain ${WORDING}.`),
    );
    await write(
      '03 Research/TWO202 Past Paper 2024.md',
      pastPaper('TWO202', 2024, `Define ${WORDING}.`),
    );
    await write('02 Assignments/Exam ONE.md', assessmentNote('ONE101', 'Exam ONE'));
    await write('02 Assignments/Exam TWO.md', assessmentNote('TWO202', 'Exam TWO'));

    const { ranking } = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      concepts: [IN_ONE, IN_TWO],
      vocabulary: [WORDING],
      reviewLog: [],
      asOf: '2026-09-01',
    });
    const keysOf = (course: string): string[] => {
      const entry = ranking.courses.find((c) => c.course === course);
      if (entry === undefined || entry.status !== 'ranked') throw new Error(`${course} unranked`);
      return entry.ranked.map((row) => row.conceptKey);
    };
    expect(keysOf('ONE101')).toEqual([IN_ONE.key]);
    expect(keysOf('TWO202')).toEqual([IN_TWO.key]);
  });

  it("unchanged (not ruled): a wording with no identity in the edge's course still takes its identity elsewhere", async () => {
    await write(
      '02 Assignments/Essay.md',
      assessmentNote('ONE101', 'Essay', `scope: Covers ${WORDING}.\n`),
    );
    const result = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [IN_TWO],
    });
    expect(result.edges.map((e) => [e.course, e.conceptKey])).toEqual([['ONE101', IN_TWO.key]]);
  });

  it('unchanged: in a course holding neither identity, the last-listed identity is taken, and a wording with no record keeps its name', async () => {
    await write(
      '02 Assignments/Essay.md',
      assessmentNote('THR303', 'Essay', `scope: Covers ${WORDING}.\n`),
    );
    const split = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [IN_ONE, IN_TWO],
    });
    expect(split.edges.map((e) => e.conceptKey)).toEqual([IN_TWO.key]);

    await write(
      '03 Research/THR303 Past Paper 2024.md',
      pastPaper('THR303', 2024, 'Explain Gizmo drift.'),
    );
    const unrecorded = await buildConceptAssessmentEdges(source, {
      basePath: BASE_PATH,
      concepts: [IN_ONE],
      vocabulary: ['Gizmo drift'],
    });
    expect(
      unrecorded.edges.filter((e) => e.basis === 'past-paper').map((e) => e.conceptKey),
    ).toEqual(['Gizmo drift']);
  });
});
