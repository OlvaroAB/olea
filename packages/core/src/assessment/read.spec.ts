import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { readAssessments } from './read.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');
const BASE_PATH = '02 Assignments/Assignments.base';

describe('readAssessments — against the real Assignments.base fixture', () => {
  const source = new FolderSource(FIXTURE_ROOT);

  it('reads all 14 assessment records, none dropped', async () => {
    const report = await readAssessments(source, BASE_PATH);
    expect(report.configErrors).toEqual([]);
    expect(report.sourceFolders).toEqual(['02 Assignments']);
    expect(report.notesScanned).toHaveLength(14);
    expect(report.records).toHaveLength(14);
  });

  it('resolves all five fields to their real (canonical) frontmatter keys', () => {
    return readAssessments(source, BASE_PATH).then((report) => {
      const byField = new Map(report.columns.map((c) => [c.field, c.matchedKey]));
      expect(byField.get('course')).toBe('class');
      expect(byField.get('type')).toBe('type');
      expect(byField.get('weight')).toBe('weight');
      expect(byField.get('due')).toBe('due');
      expect(byField.get('status')).toBe('status');
      expect(report.unresolvedFields).toEqual([]);
    });
  });

  it('`formula.daysLeft` is not reported as an unrecognized column (it is computed, not a note field)', async () => {
    const report = await readAssessments(source, BASE_PATH);
    expect(report.unrecognizedColumns).toEqual([]);
  });

  it('preserves `type` verbatim — exact casing, no normalisation', async () => {
    const report = await readAssessments(source, BASE_PATH);
    const types = new Set(report.records.map((r) => r.type));
    expect(types).toEqual(new Set(['Quiz', 'Assignment', 'Lab', 'Test']));
  });

  it('parses weight as a number and each course sums to 100', async () => {
    const report = await readAssessments(source, BASE_PATH);
    const byCourse = new Map<string, number>();
    for (const r of report.records) {
      if (r.course === undefined || r.weight === undefined) continue;
      byCourse.set(r.course, (byCourse.get(r.course) ?? 0) + r.weight);
    }
    expect(byCourse.get('GEOL204')).toBe(100);
    expect(byCourse.get('MUSTH104')).toBe(100);
  });

  it('reads a specific known record correctly end to end', async () => {
    const report = await readAssessments(source, BASE_PATH);
    const quiz1 = report.records.find(
      (r) => r.path === '02 Assignments/Quiz 1 - Grainsize and Roundness.md',
    );
    expect(quiz1).toEqual({
      path: '02 Assignments/Quiz 1 - Grainsize and Roundness.md',
      course: 'GEOL204',
      type: 'Quiz',
      weight: 5,
      weightRaw: '5',
      due: '2026-08-14',
      status: 'done',
      scope: 'Short in-class quiz covering calibre classes and the roundness scale.',
    });
  });

  it("resolves a sixth, optional field — scope (F1.7 / ASC-1) — from the assessment note's own body prose where she has recorded no dedicated property", async () => {
    const report = await readAssessments(source, BASE_PATH);
    const midterm = report.records.find(
      (r) => r.path === '02 Assignments/Midterm Test - GEOL204.md',
    );
    expect(midterm?.scope).toBe('Covers WEEK 1 through WEEK 5 material.');
    // never required — an assessment stating nothing about its coverage is
    // not reported as a gap the way an unmatched required column would be.
    expect(report.unresolvedFields).toEqual([]);
  });

  it('is deterministic across repeated calls', async () => {
    const first = await readAssessments(source, BASE_PATH);
    const second = await readAssessments(source, BASE_PATH);
    expect(second).toEqual(first);
  });
});

describe('readAssessments — tolerant column matching and honest reporting (synthetic)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-assessment-read-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('matches renamed columns via the alias table (Weighting, Due Date) and case-insensitively', async () => {
    await write(
      'Work/Assignments.base',
      [
        'filters:',
        '  and:',
        '    - file.inFolder("Work")',
        '    - file.ext == "md"',
        'properties:',
        '  Class:',
        '    displayName: Class',
        '  Type:',
        '    displayName: Type',
        '  Weighting:',
        '    displayName: Weighting',
        '  Due Date:',
        '    displayName: Due Date',
        '  Status:',
        '    displayName: Status',
      ].join('\n'),
    );
    await write(
      'Work/Essay.md',
      '---\nClass: COURSEA\nType: Essay\nWeighting: 30\nDue Date: 2026-09-01\nStatus: upcoming\n---\n\n# Essay\n',
    );

    const report = await readAssessments(source, 'Work/Assignments.base');
    expect(report.configErrors).toEqual([]);
    expect(report.unresolvedFields).toEqual([]);
    expect(report.unrecognizedColumns).toEqual([]);
    expect(report.records).toEqual([
      {
        path: 'Work/Essay.md',
        course: 'COURSEA',
        type: 'Essay',
        weight: 30,
        weightRaw: '30',
        due: '2026-09-01',
        status: 'upcoming',
      },
    ]);
  });

  it('reports an unrecognized declared column instead of silently dropping it', async () => {
    await write(
      'Work/Assignments.base',
      [
        'filters:',
        '  and:',
        '    - file.inFolder("Work")',
        'properties:',
        '  class:',
        '    displayName: Class',
        '  type:',
        '    displayName: Type',
        '  weight:',
        '    displayName: Weight',
        '  due:',
        '    displayName: Due',
        '  status:',
        '    displayName: Status',
        '  location:',
        '    displayName: Location',
      ].join('\n'),
    );
    await write(
      'Work/Quiz.md',
      '---\nclass: COURSEA\ntype: Quiz\nweight: 5\ndue: 2026-09-01\nstatus: done\nlocation: Room 4\n---\n\n# Quiz\n',
    );

    const report = await readAssessments(source, 'Work/Assignments.base');
    expect(report.unrecognizedColumns).toEqual(['location']);
    expect(report.unresolvedFields).toEqual([]);
    expect(report.records).toHaveLength(1);
  });

  it('when a required field cannot be matched at all, records are still built for the fields that did resolve, and the gap is reported — never a silent zero', async () => {
    await write(
      'Work/Assignments.base',
      [
        'filters:',
        '  and:',
        '    - file.inFolder("Work")',
        'properties:',
        '  class:',
        '  type:',
        '  status:',
      ].join('\n'),
    );
    await write('Work/Quiz.md', '---\nclass: COURSEA\ntype: Quiz\nstatus: done\n---\n\n# Quiz\n');

    const report = await readAssessments(source, 'Work/Assignments.base');
    expect([...report.unresolvedFields].sort()).toEqual(['due', 'weight']);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.course).toBe('COURSEA');
    expect(report.records[0]?.weight).toBeUndefined();
    expect(report.records[0]?.due).toBeUndefined();
  });

  it('when NOTHING resolves, records is empty AND the report says why — this is the silent-zero regression guard', async () => {
    await write(
      'Work/Assignments.base',
      [
        'filters:',
        '  and:',
        '    - file.inFolder("Work")',
        'properties:',
        '  mystery-column:',
      ].join('\n'),
    );
    await write('Work/Quiz.md', '---\nmystery-column: hello\n---\n\n# Quiz\n');

    const report = await readAssessments(source, 'Work/Assignments.base');
    expect(report.records).toEqual([]);
    expect(report.columns).toEqual([]);
    expect(report.unresolvedFields).toHaveLength(5);
    expect(report.unrecognizedColumns).toEqual(['mystery-column']);
    // The report is not silent about why: notesScanned proves notes existed.
    expect(report.notesScanned).toHaveLength(1);
  });

  it('a .base file with no file.inFolder(...) filter produces a configError, not a silent empty read', async () => {
    await write('Work/Assignments.base', 'views:\n  - type: table\n');

    const report = await readAssessments(source, 'Work/Assignments.base');
    expect(report.records).toEqual([]);
    expect(report.sourceFolders).toEqual([]);
    expect(report.notesScanned).toEqual([]);
    expect(report.configErrors).toHaveLength(1);
    expect(report.configErrors[0]).toMatch(/inFolder/);
  });

  it('a note with no frontmatter in the scanned folder is reported, not silently merged into the count', async () => {
    await write(
      'Work/Assignments.base',
      [
        'filters:',
        '  and:',
        '    - file.inFolder("Work")',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
      ].join('\n'),
    );
    await write(
      'Work/Quiz.md',
      '---\nclass: COURSEA\ntype: Quiz\nweight: 5\ndue: 2026-09-01\nstatus: done\n---\n\n# Quiz\n',
    );
    await write('Work/scratch.md', '# Just some notes, no frontmatter\n');

    const report = await readAssessments(source, 'Work/Assignments.base');
    expect(report.notesScanned).toEqual(['Work/Quiz.md', 'Work/scratch.md']);
    expect(report.notesWithoutFrontmatter).toEqual(['Work/scratch.md']);
    expect(report.records).toHaveLength(1);
  });
});
