/**
 * The course cutoff record and its log (`[D-411]` option a, `[D-387]`; `ol-v7r5.66`).
 * INV-3: every course id and concept id below is an invented, opaque fixture.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attainmentArithmeticVersion } from '../mastery/attainment.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  appendCourseCutoffRecord,
  COURSE_CUTOFF_LOG_FOLDER,
  courseCutoffLogPath,
  readCourseCutoffLog,
  recordCourseCutoffs,
} from './course-cutoff-log.js';
import {
  buildCourseCutoffRecord,
  type CourseCutoffRecord,
  firstCourseCutoffByCourse,
  HISTORICAL_AWARD_RULE_VERSION,
  isProvisionalCutoffSource,
  lastPassedAssessmentDay,
  parseCourseCutoffLog,
  parseCourseCutoffRecord,
  parseRecordedStageArithmetic,
  serializeCourseCutoffRecord,
  takeCourseCutoff,
} from './course-cutoff-record.js';

const VERSION = attainmentArithmeticVersion({
  saplingRule: 'any-scored-success',
  withheldEvidence: 'count',
});

function record(overrides: Partial<Record<keyof CourseCutoffRecord, unknown>> = {}) {
  const parsed = parseCourseCutoffRecord({
    schemaVersion: 1,
    courseId: 'OLD1',
    cutoffDay: '2026-06-12',
    source: 'provisional-last-passed-assessment',
    arithmeticVersion: VERSION,
    historicalAwardRuleVersion: HISTORICAL_AWARD_RULE_VERSION,
    conceptIds: ['c1', 'c2'],
    ...overrides,
  });
  if (parsed === null) throw new Error('fixture is not a valid course cutoff record');
  return parsed;
}

describe('[D-411] course cutoff record: shape and round trip', () => {
  it('holds exactly the ruled fields, ids only, and round-trips byte-identically (INV-2)', () => {
    const r = buildCourseCutoffRecord({
      courseId: 'OLD1',
      cutoff: { cutoffDay: '2026-06-12', source: 'provisional-last-passed-assessment' },
      arithmeticVersion: VERSION,
      conceptIds: ['c2', 'c1', 'c2'],
    });
    expect(Object.keys(r)).toEqual([
      'schemaVersion',
      'courseId',
      'cutoffDay',
      'source',
      'arithmeticVersion',
      'historicalAwardRuleVersion',
      'conceptIds',
    ]);
    expect(r.conceptIds).toEqual(['c1', 'c2']);
    expect(r.historicalAwardRuleVersion).toBe(HISTORICAL_AWARD_RULE_VERSION);
    const line = serializeCourseCutoffRecord(r);
    const reparsed = parseCourseCutoffRecord(JSON.parse(line));
    expect(reparsed).toEqual(r);
    expect(serializeCourseCutoffRecord(reparsed as CourseCutoffRecord)).toBe(line);
  });

  it('refuses a line carrying a leaving reason, a stored stage or any other field it does not know', () => {
    const base = JSON.parse(serializeCourseCutoffRecord(record()));
    expect(parseCourseCutoffRecord({ ...base, leavingReason: 'finished' })).toBeNull();
    expect(parseCourseCutoffRecord({ ...base, stageByConcept: { c1: 'tree' } })).toBeNull();
    expect(parseCourseCutoffRecord({ ...base, schemaVersion: 2 })).toBeNull();
    expect(parseCourseCutoffRecord({ ...base, source: 'finished' })).toBeNull();
    expect(parseCourseCutoffRecord({ ...base, cutoffDay: '12/06/2026' })).toBeNull();
    expect(parseCourseCutoffRecord({ ...base, courseId: '' })).toBeNull();
  });

  it('parses a log line by line, reporting a torn trailing line by number only', () => {
    const content = `${serializeCourseCutoffRecord(record())}{"schemaVersion":1,"cour`;
    const parsed = parseCourseCutoffLog(content);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.invalidLines).toEqual([{ lineNumber: 2, reason: 'invalid JSON' }]);
  });

  it('reads a recorded arithmetic version back into the parts a stage fold needs, never guessing', () => {
    expect(parseRecordedStageArithmetic(VERSION)).toEqual({
      foldVersion: 'att-fold-1',
      saplingRule: 'any-scored-success',
    });
    expect(
      parseRecordedStageArithmetic('att-fold-1;sapling=unaided-recall;withheld=count')?.saplingRule,
    ).toBe('unaided-recall');
    expect(parseRecordedStageArithmetic('att-fold-1;sapling=something-new')).toBeNull();
    expect(parseRecordedStageArithmetic('att-fold-1;withheld=count')).toBeNull();
    expect(parseRecordedStageArithmetic('')).toBeNull();
  });
});

describe('[D-387] taking a cutoff', () => {
  const assessments = [
    { course: 'OLD1', due: '2026-05-02' },
    { course: 'OLD1', due: '2026-06-12' },
    { course: 'OLD1', due: '2026-10-30' },
    { course: 'OLD1', due: 'not a day' },
    { course: 'OLD2', due: '2026-07-01' },
    { course: undefined, due: '2026-08-01' },
  ];

  it('the provisional cutoff is the last assessment date already passed, for that course only', () => {
    expect(lastPassedAssessmentDay('OLD1', assessments, '2026-09-27')).toBe('2026-06-12');
    // Due today has not passed yet (the retrospective's rule: due before today).
    expect(lastPassedAssessmentDay('OLD1', assessments, '2026-06-12')).toBe('2026-05-02');
  });

  it('a course with a passed assessment and no leaving gesture gets a provisional cutoff, which is not a leaving', () => {
    const cutoff = takeCourseCutoff({ courseId: 'OLD1', assessments, today: '2026-09-27' });
    expect(cutoff).toEqual({
      cutoffDay: '2026-06-12',
      source: 'provisional-last-passed-assessment',
    });
    expect(isProvisionalCutoffSource(cutoff?.source ?? 'leaving-gesture')).toBe(true);
    const r = buildCourseCutoffRecord({
      courseId: 'OLD1',
      cutoff: cutoff as NonNullable<typeof cutoff>,
      arithmeticVersion: VERSION,
      conceptIds: ['c1'],
    });
    // No field anywhere in the record can carry a leaving, a completion or a reason.
    const line = serializeCourseCutoffRecord(r);
    expect(line).not.toMatch(/reason|finish|complet|left|leav|archiv/i);
  });

  it('prefers her leaving gesture when one exists (C7.8), unprovisional', () => {
    expect(
      takeCourseCutoff({
        courseId: 'OLD1',
        leavingGestureDay: '2026-07-20',
        assessments,
        today: '2026-09-27',
      }),
    ).toEqual({ cutoffDay: '2026-07-20', source: 'leaving-gesture' });
    expect(isProvisionalCutoffSource('leaving-gesture')).toBe(false);
  });

  it('with neither a leaving gesture nor a passed assessment, no cutoff is taken', () => {
    expect(
      takeCourseCutoff({
        courseId: 'OLD3',
        assessments: [{ course: 'OLD3', due: '2026-12-01' }],
        today: '2026-09-27',
      }),
    ).toBeNull();
    expect(takeCourseCutoff({ courseId: 'OLD3', assessments: [], today: '2026-09-27' })).toBeNull();
  });

  it('one record per course: the first read wins, a later one never displaces it', () => {
    const first = record();
    const later = record({ cutoffDay: '2026-08-01' });
    expect(firstCourseCutoffByCourse([first, later]).get('OLD1')).toEqual(first);
  });
});

describe('[D-411] course cutoff log', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-course-cutoff-log-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("names one file per day per device under Olea's own layer, beside the composition log", () => {
    expect(COURSE_CUTOFF_LOG_FOLDER).toBe('.olea/course-cutoffs');
    expect(courseCutoffLogPath('2026-09-27', 'device-1')).toBe(
      '.olea/course-cutoffs/2026-09-27.device-1.jsonl',
    );
    expect(() => courseCutoffLogPath('27-09-2026', 'device-1')).toThrow();
    expect(() => courseCutoffLogPath('2026-09-27', '../x')).toThrow();
  });

  it('appends, never rewrites, closing off a torn trailing line', async () => {
    const path = courseCutoffLogPath('2026-09-27', 'device-1');
    await vault.write(path, '{"schemaVersion":1,"cour');
    await appendCourseCutoffRecord(vault, record(), 'device-1', '2026-09-27');
    const text = await readFile(join(root, path), 'utf8');
    expect(text).toBe(`{"schemaVersion":1,"cour\n${serializeCourseCutoffRecord(record())}`);
    const { records, invalidLines } = await readCourseCutoffLog(vault);
    expect(records).toEqual([record()]);
    expect(invalidLines).toHaveLength(1);
  });

  it('records a course the first time only: a later calendar edit and a later rule change write nothing and move nothing', async () => {
    const concepts = [
      { conceptId: 'c1', courses: ['OLD1', 'NEW1'] },
      { conceptId: 'c2', courses: ['OLD1'] },
      { conceptId: 'c3', courses: ['NEW1'] },
    ];
    const first = await recordCourseCutoffs(vault, {
      courseIds: ['OLD1'],
      existing: (await readCourseCutoffLog(vault)).records,
      concepts,
      assessments: [{ course: 'OLD1', due: '2026-06-12' }],
      arithmeticVersion: VERSION,
      today: '2026-09-01',
      deviceId: 'device-1',
    });
    expect(first.written).toHaveLength(1);
    expect(first.byCourse.get('OLD1')).toMatchObject({
      cutoffDay: '2026-06-12',
      source: 'provisional-last-passed-assessment',
      conceptIds: ['c1', 'c2'],
      arithmeticVersion: VERSION,
    });
    const path = courseCutoffLogPath('2026-09-01', 'device-1');
    const before = await readFile(join(root, path), 'utf8');

    // She moves the assessment's date, and the arithmetic has since changed.
    const second = await recordCourseCutoffs(vault, {
      courseIds: ['OLD1'],
      existing: (await readCourseCutoffLog(vault)).records,
      concepts,
      assessments: [{ course: 'OLD1', due: '2026-07-20' }],
      arithmeticVersion: attainmentArithmeticVersion({
        saplingRule: 'unaided-recall',
        withheldEvidence: 'count',
      }),
      today: '2026-09-27',
      deviceId: 'device-1',
    });
    expect(second.written).toEqual([]);
    expect(second.byCourse.get('OLD1')).toEqual(first.byCourse.get('OLD1'));
    expect(await readFile(join(root, path), 'utf8')).toBe(before);
    expect(await vault.exists(courseCutoffLogPath('2026-09-27', 'device-1'))).toBe(false);
  });

  it('with no cutoff available, writes nothing at all', async () => {
    const result = await recordCourseCutoffs(vault, {
      courseIds: ['OLD1'],
      existing: [],
      concepts: [{ conceptId: 'c1', courses: ['OLD1'] }],
      assessments: [{ course: 'OLD1', due: '2026-12-01' }],
      arithmeticVersion: VERSION,
      today: '2026-09-27',
      deviceId: 'device-1',
    });
    expect(result.written).toEqual([]);
    expect(result.byCourse.size).toBe(0);
    expect(await vault.exists(courseCutoffLogPath('2026-09-27', 'device-1'))).toBe(false);
  });
});
