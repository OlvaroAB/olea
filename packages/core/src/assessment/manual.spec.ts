import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  addManualAssessmentEntry,
  isManualAssessmentRecord,
  listManualAssessmentRecords,
  MANUAL_ASSESSMENT_STORE_FOLDER,
  manualAssessmentRecordPath,
  manualAssessmentRecordToAssessmentRecord,
  mintManualAssessmentId,
  readManualAssessments,
  removeManualAssessmentEntry,
} from './manual.js';

describe('addManualAssessmentEntry / listManualAssessmentRecords — F1.2 manual fallback storage', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-manual-assessment-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes a record under .olea/assessments and reads it back byte-identical (INV-2)', async () => {
    let counter = 0;
    const { record, path } = await addManualAssessmentEntry(
      source,
      {
        course: 'Course A',
        type: 'Quiz',
        weightRaw: '20',
        due: '2026-10-01',
        status: 'not started',
      },
      { generateId: () => `fixed-${counter++}`, now: () => '2026-09-26' },
    );

    expect(path).toBe(manualAssessmentRecordPath(record.id));
    expect(path.startsWith(`${MANUAL_ASSESSMENT_STORE_FOLDER}/`)).toBe(true);

    const before = await source.read(path);
    const stored = await listManualAssessmentRecords(source);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.record).toEqual(record);
    const after = await source.read(path);
    // Reading twice, with a listing in between, must not change a single byte.
    expect(after).toBe(before);
  });

  it('trims and omits blank optional fields rather than storing empty strings', async () => {
    const { record } = await addManualAssessmentEntry(source, {
      course: '  Course A  ',
      type: '  Quiz  ',
      weightRaw: '   ',
      due: '',
    });
    expect(record.course).toBe('Course A');
    expect(record.type).toBe('Quiz');
    expect(record.weightRaw).toBeUndefined();
    expect(record.due).toBeUndefined();
    expect(record.status).toBeUndefined();
    expect('weightRaw' in record).toBe(false);
  });

  it('refuses a blank course or type before writing any byte', async () => {
    await expect(addManualAssessmentEntry(source, { course: '', type: 'Quiz' })).rejects.toThrow();
    await expect(
      addManualAssessmentEntry(source, { course: 'Course A', type: '  ' }),
    ).rejects.toThrow();
    expect(await listManualAssessmentRecords(source)).toEqual([]);
  });

  it('always mints a fresh record — two calls with identical fields never merge or overwrite', async () => {
    await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz' });
    await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz' });
    const stored = await listManualAssessmentRecords(source);
    expect(stored).toHaveLength(2);
    expect(stored[0]?.record.id).not.toBe(stored[1]?.record.id);
  });

  it('sorts by enteredAt then id, not by write order alone', async () => {
    await addManualAssessmentEntry(
      source,
      { course: 'Course B', type: 'Test' },
      { now: () => '2026-09-27', generateId: () => 'b' },
    );
    await addManualAssessmentEntry(
      source,
      { course: 'Course A', type: 'Quiz' },
      { now: () => '2026-09-01', generateId: () => 'a' },
    );
    const stored = await listManualAssessmentRecords(source);
    expect(stored.map((s) => s.record.course)).toEqual(['Course A', 'Course B']);
  });

  it('skips a corrupt record file rather than throwing, and never registers it as valid', async () => {
    await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz' });
    await source.write(`${MANUAL_ASSESSMENT_STORE_FOLDER}/corrupt.json`, '{ not valid json');
    const stored = await listManualAssessmentRecords(source);
    expect(stored).toHaveLength(1);
    expect(isManualAssessmentRecord(JSON.parse('{}'))).toBe(false);
  });

  it('removeManualAssessmentEntry deletes the file; a second call is a safe no-op', async () => {
    const { path } = await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz' });
    expect(await listManualAssessmentRecords(source)).toHaveLength(1);
    await removeManualAssessmentEntry(source, path);
    expect(await listManualAssessmentRecords(source)).toEqual([]);
    await expect(removeManualAssessmentEntry(source, path)).resolves.toBeUndefined();
  });

  it('mintManualAssessmentId is opaque and prefixed, never a transform of a typed field', () => {
    const id = mintManualAssessmentId(() => 'nonce-value');
    expect(id).toBe('manual-assessment1:nonce-value');
  });

  describe('manualAssessmentRecordToAssessmentRecord / readManualAssessments', () => {
    it('applies [D-143] weight normalization at read time, identically to the Base reader', async () => {
      await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz', weightRaw: '20' });
      const [record] = await readManualAssessments(source);
      expect(record?.weight).toBeCloseTo(0.2, 10);
      expect(record?.weightBasis).toBe('percentage');
      expect(record?.weightRaw).toBe('20');
    });

    it('a fraction-basis weight (<= 1) is kept as-is', async () => {
      await addManualAssessmentEntry(source, {
        course: 'Course A',
        type: 'Quiz',
        weightRaw: '0.2',
      });
      const [record] = await readManualAssessments(source);
      expect(record?.weight).toBeCloseTo(0.2, 10);
      expect(record?.weightBasis).toBe('fraction');
    });

    it('an absent weight normalizes to undefined, never a fabricated zero', async () => {
      await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz' });
      const [record] = await readManualAssessments(source);
      expect(record?.weight).toBeUndefined();
      expect(record?.weightBasis).toBeUndefined();
    });

    it('always reports scope as undefined — F1.7 is not collected by this fallback', async () => {
      const stored = await addManualAssessmentEntry(source, { course: 'Course A', type: 'Quiz' });
      const converted = manualAssessmentRecordToAssessmentRecord(stored.record, stored.path);
      expect(converted.scope).toBeUndefined();
    });

    it('returns the exact same fields readAssessments produces, none added or dropped', async () => {
      await addManualAssessmentEntry(source, {
        course: 'Course A',
        type: 'Quiz',
        weightRaw: '20',
        due: '2026-10-01',
        status: 'not started',
      });
      const [record] = await readManualAssessments(source);
      expect(record && Object.keys(record).sort()).toEqual(
        [
          'path',
          'course',
          'type',
          'weight',
          'weightBasis',
          'weightRaw',
          'due',
          'status',
          'scope',
        ].sort(),
      );
    });
  });
});
