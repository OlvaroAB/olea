import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { addManualAssessmentEntry } from './manual.js';
import { hasReadableAssessmentsBase, resolveAssessments } from './resolve.js';

const REAL_BASE_FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');
const REAL_BASE_PATH = '02 Assignments/Assignments.base';

describe('resolveAssessments — F1.2 choice between the Base and the manual fallback', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-resolve-assessments-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a blank (unconfigured) basePath reads the manual fallback, never attempting a Base read', async () => {
    await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz' });
    const report = await resolveAssessments(source, '');
    expect(report.source).toBe('manual');
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.course).toBe('Course A');
  });

  it('a configured but unreadable basePath (no such file) falls back to manual entries, never throwing', async () => {
    await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz' });
    const report = await resolveAssessments(source, 'no/such/file.base');
    expect(report.source).toBe('manual');
    expect(report.records).toHaveLength(1);
    expect(report.configErrors).toEqual([]);
  });

  it('zero manual entries is an honest empty report, never a config error', async () => {
    const report = await resolveAssessments(source, '');
    expect(report.source).toBe('manual');
    expect(report.records).toEqual([]);
    expect(report.configErrors).toEqual([]);
    expect(report.unresolvedFields).toEqual([]);
  });

  it('a readable Base always wins, even when manual entries also exist', async () => {
    await mkdir(join(root, '02 Assignments'), { recursive: true });
    await writeFile(
      join(root, '02 Assignments', 'Assignments.base'),
      [
        'filters:',
        '  and:',
        '    - file.inFolder("02 Assignments")',
        'properties:',
        '  class:',
        '  type:',
        '  weight:',
        '  due:',
        '  status:',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(root, '02 Assignments', 'quiz-1.md'),
      [
        '---',
        'class: Course A',
        'type: Quiz',
        'weight: 20',
        'due: 2026-10-01',
        'status: not started',
        '---',
        '',
      ].join('\n'),
    );
    await addManualAssessmentEntry(source, { course: 'Course B', type: 'Test' });

    const report = await resolveAssessments(source, '02 Assignments/Assignments.base');
    expect(report.source).toBe('base');
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.course).toBe('Course A');
  });

  it('against the real fixture Base, resolves to the Base and reports it as the source', async () => {
    const fixtureSource = new FolderSource(REAL_BASE_FIXTURE_ROOT);
    const report = await resolveAssessments(fixtureSource, REAL_BASE_PATH);
    expect(report.source).toBe('base');
    expect(report.records).toHaveLength(15);
  });
});

describe('hasReadableAssessmentsBase', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-has-readable-base-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is false for a blank path', async () => {
    expect(await hasReadableAssessmentsBase(source, '')).toBe(false);
  });

  it('is false for a configured but missing path', async () => {
    expect(await hasReadableAssessmentsBase(source, 'no/such/file.base')).toBe(false);
  });

  it('is true for the real fixture Base', async () => {
    const fixtureSource = new FolderSource(REAL_BASE_FIXTURE_ROOT);
    expect(await hasReadableAssessmentsBase(fixtureSource, REAL_BASE_PATH)).toBe(true);
  });
});
