/**
 * `ol-76pt` (`[D-373]` applying `[D-329]`): `composeOracleRanking`'s
 * `serveCoursesWithoutAssessmentsOnNeed` opts a course she has material for
 * but no assessment record into `rankOracle`'s need-only reading, and leaves
 * a completed course (every assessment passed) on its ordinary reading.
 *
 * INV-3: every course code, concept name, path and question below is
 * invented.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractConcepts } from '../concept/extract.js';
import type { ConceptRecord } from '../concept/types.js';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import { composeOracleRanking, coursesWithoutAssessmentRecords } from './compose.js';

const BASE_PATH = '02 Assignments/Assignments.base';
const NO_ASSESSMENT_COURSE = 'TESTN200';

/** A concept whose only course has no assessment record — the no-assessment course. */
const ORBIT: ConceptRecord = {
  key: 'concept-prov1:invented-orbit',
  name: 'Invented orbit',
  tier: 2,
  courses: [NO_ASSESSMENT_COURSE],
  sourcePaths: ['01 Courses/TESTN200/Invented orbit.md' as VaultPath],
};

describe('composeOracleRanking — a course with material but no assessment record is served on need alone (`ol-76pt`, `[D-373]`, `[D-329]`)', () => {
  let root: string;
  let source: FolderSource;
  let concepts: readonly ConceptRecord[];

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-oracle-need-only-'));
    source = new FolderSource(root);
    await write(
      '05 Zettelkasten/Widget theory.md',
      '---\ntopic: Widget theory\n---\n\n# Widget theory\n',
    );
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
      ].join('\n'),
    );
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
    concepts = [...(await extractConcepts(source, {})), ORBIT];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('opted in: the no-assessment course ranks its concept at unknown relevance, with a mastery reading', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: '2026-08-15',
      concepts,
      serveCoursesWithoutAssessmentsOnNeed: true,
    });

    const course = result.ranking.courses.find((c) => c.course === NO_ASSESSMENT_COURSE);
    expect(course?.status).toBe('ranked');
    if (course?.status !== 'ranked') throw new Error('expected the no-assessment course to rank');
    const entry = course.ranked.find((c) => c.conceptKey === ORBIT.key);
    expect(entry).toBeDefined();
    // `[D-329]`'s unknown-relevance entry: no contributing edge, no citation.
    expect(entry?.factors.contributions).toEqual([]);
    expect(entry?.citations).toEqual([]);
    // Its key joined the mastery fold, so need reads her own evidence.
    expect(result.mastery.has(ORBIT.key)).toBe(true);

    // The course with a real assessment is unchanged in kind.
    const ranked = result.ranking.courses.find((c) => c.course === 'TESTC101');
    expect(ranked?.status).toBe('ranked');
  });

  it('omitted: the no-assessment course is absent from the ranking, byte-identical to before', async () => {
    const withoutOptIn = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: '2026-08-15',
      concepts,
    });
    expect(withoutOptIn.ranking.courses.map((c) => c.course)).toEqual(['TESTC101']);
    expect(withoutOptIn.mastery.has(ORBIT.key)).toBe(false);

    const explicitFalse = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: '2026-08-15',
      concepts,
      serveCoursesWithoutAssessmentsOnNeed: false,
    });
    expect(explicitFalse).toEqual(withoutOptIn);
  });

  it('a completed course (its one assessment passed) keeps its ordinary reading — its concept is vetoed, never served on need — while the no-assessment course is', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: '2026-10-15',
      concepts,
      serveCoursesWithoutAssessmentsOnNeed: true,
    });

    const completed = result.ranking.courses.find((c) => c.course === 'TESTC101');
    if (completed?.status !== 'ranked') throw new Error('expected TESTC101 to report ranked');
    expect(completed.ranked).toEqual([]);
    expect((completed.vetoedConcepts ?? []).map((c) => c.conceptName)).toEqual(['Widget theory']);

    const needOnly = result.ranking.courses.find((c) => c.course === NO_ASSESSMENT_COURSE);
    if (needOnly?.status !== 'ranked') throw new Error('expected the no-assessment course to rank');
    expect(needOnly.ranked.map((c) => c.conceptKey)).toEqual([ORBIT.key]);
  });
});

describe('coursesWithoutAssessmentRecords (`ol-76pt`)', () => {
  it('names only the courses no record names, each with its concepts by key', () => {
    const shared: ConceptRecord = {
      key: 'concept-prov1:invented-shared',
      name: 'Invented shared',
      tier: 2,
      courses: ['TESTC101', NO_ASSESSMENT_COURSE],
      sourcePaths: [],
    };
    const universe = coursesWithoutAssessmentRecords([ORBIT, shared], [{ course: 'TESTC101' }, {}]);
    expect([...universe.keys()]).toEqual([NO_ASSESSMENT_COURSE]);
    expect(universe.get(NO_ASSESSMENT_COURSE)).toEqual(
      new Map([
        [ORBIT.key, ORBIT.name],
        [shared.key, shared.name],
      ]),
    );
  });

  it('is empty when every course has a record', () => {
    expect(coursesWithoutAssessmentRecords([ORBIT], [{ course: NO_ASSESSMENT_COURSE }]).size).toBe(
      0,
    );
  });
});
