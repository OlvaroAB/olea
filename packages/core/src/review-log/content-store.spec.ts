import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  CONTENT_STORE_FOLDER,
  contentStorePath,
  isValidContentId,
  readContentForGrade,
  readContentRecord,
  writeContentRecord,
} from './content-store.js';

describe('content-store', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-content-store-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('lives under the C6.2a folder', () => {
    expect(CONTENT_STORE_FOLDER).toBe('.olea/content');
  });

  it('writes a record and reads it back exactly (F5 scenario: written record can be read back exactly)', async () => {
    const vault = new FolderSource(tempRoot);
    const { contentId, path } = await writeContentRecord(
      vault,
      { studentAnswer: 'cementation binds grains together', feedback: 'correct, well cited' },
      { deviceId: 'desktop-1', generateContentId: () => 'desktop-1.fixed-1' },
    );

    expect(contentId).toBe('desktop-1.fixed-1');
    expect(path).toBe(contentStorePath('desktop-1.fixed-1'));

    const result = await readContentRecord(vault, contentId);
    expect(result).toEqual({
      status: 'found',
      record: {
        contentId: 'desktop-1.fixed-1',
        studentAnswer: 'cementation binds grains together',
        feedback: 'correct, well cited',
      },
    });
  });

  it('carries misconceptionDetail when supplied, omits it when not', async () => {
    const vault = new FolderSource(tempRoot);
    await writeContentRecord(
      vault,
      { studentAnswer: 'x', feedback: 'y', misconceptionDetail: 'confused cause with correlation' },
      { deviceId: 'd1', generateContentId: () => 'd1.with-misconception' },
    );
    const found = await readContentRecord(vault, 'd1.with-misconception');
    expect(found.status).toBe('found');
    expect(found.status === 'found' && found.record.misconceptionDetail).toBe(
      'confused cause with correlation',
    );

    await writeContentRecord(
      vault,
      { studentAnswer: 'x', feedback: 'y' },
      {
        deviceId: 'd1',
        generateContentId: () => 'd1.without-misconception',
      },
    );
    const withoutRecord = await readContentRecord(vault, 'd1.without-misconception');
    expect(withoutRecord.status).toBe('found');
    expect(
      withoutRecord.status === 'found' && withoutRecord.record.misconceptionDetail,
    ).toBeUndefined();
  });

  it('never overwrites an existing content id (immutable, write-once — F5 scenario)', async () => {
    const vault = new FolderSource(tempRoot);
    await writeContentRecord(
      vault,
      { studentAnswer: 'first', feedback: 'first-feedback' },
      {
        deviceId: 'd1',
        generateContentId: () => 'd1.dup',
      },
    );

    await expect(
      writeContentRecord(
        vault,
        { studentAnswer: 'second', feedback: 'second-feedback' },
        {
          deviceId: 'd1',
          generateContentId: () => 'd1.dup',
        },
      ),
    ).rejects.toThrow(/refusing to overwrite an immutable record/);

    // The original file survives untouched.
    const result = await readContentRecord(vault, 'd1.dup');
    expect(result.status).toBe('found');
    expect(result.status === 'found' && result.record.studentAnswer).toBe('first');
  });

  it('two devices writing at the same moment mint different ids and never collide (F5 scenario)', async () => {
    const vault = new FolderSource(tempRoot);
    const a = await writeContentRecord(
      vault,
      { studentAnswer: 'from desktop', feedback: 'ok' },
      {
        deviceId: 'desktop',
      },
    );
    const b = await writeContentRecord(
      vault,
      { studentAnswer: 'from mobile', feedback: 'ok' },
      {
        deviceId: 'mobile',
      },
    );

    expect(a.contentId).not.toBe(b.contentId);
    expect(a.contentId.startsWith('desktop.')).toBe(true);
    expect(b.contentId.startsWith('mobile.')).toBe(true);

    const readA = await readContentRecord(vault, a.contentId);
    const readB = await readContentRecord(vault, b.contentId);
    expect(readA.status === 'found' && readA.record.studentAnswer).toBe('from desktop');
    expect(readB.status === 'found' && readB.record.studentAnswer).toBe('from mobile');
  });

  describe('[D-277] the full applied context (C6.2a widened)', () => {
    const specification = {
      schemaVersion: 'explain-back-target.v1' as const,
      declaredDemand: 'recall-a-fact' as const,
      conditions: 'closed-book explain-back, no notes',
      permittedSupport: 'nothing beyond the question text',
      adequacyCriteria: [{ id: 'a1', text: 'names what cementation does' }],
      disqualifiers: [],
      sourceBasis: ['block-1'],
      questionBinding: 'explains how cementation binds grains',
    };

    it('round-trips every widened field exactly (applied specification, digest, reference answer, source context, misconception digest, contract and rubric-policy versions)', async () => {
      const vault = new FolderSource(tempRoot);
      await writeContentRecord(
        vault,
        {
          studentAnswer: 'cementation binds grains together',
          feedback: 'correct, well cited',
          appliedSpecification: specification,
          appliedSpecificationDigest: 'sha256:abc123',
          referenceAnswer:
            'cementation is the process by which minerals precipitate and bind grains',
          sourceContext: [
            { blockId: 'block-1', text: 'cementation precipitates minerals between grains' },
          ],
          misconceptionDigest: [
            { concept: 'concept-a', statement: 'confuses cementation with compaction' },
          ],
          contractVersion: 3,
          rubricPolicyVersion: 'explain-back-judge.v7',
        },
        { deviceId: 'd1', generateContentId: () => 'd1.full-context' },
      );

      const result = await readContentRecord(vault, 'd1.full-context');
      expect(result).toEqual({
        status: 'found',
        record: {
          contentId: 'd1.full-context',
          studentAnswer: 'cementation binds grains together',
          feedback: 'correct, well cited',
          appliedSpecification: specification,
          appliedSpecificationDigest: 'sha256:abc123',
          referenceAnswer:
            'cementation is the process by which minerals precipitate and bind grains',
          sourceContext: [
            { blockId: 'block-1', text: 'cementation precipitates minerals between grains' },
          ],
          misconceptionDigest: [
            { concept: 'concept-a', statement: 'confuses cementation with compaction' },
          ],
          contractVersion: 3,
          rubricPolicyVersion: 'explain-back-judge.v7',
        },
      });
    });

    it('every widened field is absent when not supplied — no backfill, ordinary and permanent (D-277f)', async () => {
      const vault = new FolderSource(tempRoot);
      await writeContentRecord(
        vault,
        { studentAnswer: 'x', feedback: 'y' },
        { deviceId: 'd1', generateContentId: () => 'd1.no-spec' },
      );
      const found = await readContentRecord(vault, 'd1.no-spec');
      expect(found.status).toBe('found');
      const record = found.status === 'found' ? found.record : undefined;
      expect(record?.appliedSpecification).toBeUndefined();
      expect(record?.appliedSpecificationDigest).toBeUndefined();
      expect(record?.referenceAnswer).toBeUndefined();
      expect(record?.sourceContext).toBeUndefined();
      expect(record?.misconceptionDigest).toBeUndefined();
      expect(record?.contractVersion).toBeUndefined();
      expect(record?.rubricPolicyVersion).toBeUndefined();
    });

    it('a digest with no specification is malformed — reads as missing, never throws', async () => {
      const vault = new FolderSource(tempRoot);
      const path = contentStorePath('d1.digest-only');
      await vault.write(
        path,
        JSON.stringify({
          contentId: 'd1.digest-only',
          studentAnswer: 'x',
          feedback: 'y',
          appliedSpecificationDigest: 'sha256:orphan',
        }),
      );
      const result = await readContentRecord(vault, 'd1.digest-only');
      expect(result).toEqual({ status: 'missing', contentId: 'd1.digest-only' });
    });

    it('a specification with no digest is malformed — reads as missing, never throws', async () => {
      const vault = new FolderSource(tempRoot);
      const path = contentStorePath('d1.spec-only');
      await vault.write(
        path,
        JSON.stringify({
          contentId: 'd1.spec-only',
          studentAnswer: 'x',
          feedback: 'y',
          appliedSpecification: specification,
        }),
      );
      const result = await readContentRecord(vault, 'd1.spec-only');
      expect(result).toEqual({ status: 'missing', contentId: 'd1.spec-only' });
    });

    it('malformed shapes for the widened fields (wrong type) read as missing, never throw', async () => {
      const vault = new FolderSource(tempRoot);
      const cases: Record<string, unknown> = {
        referenceAnswer: 42,
        sourceContext: [{ blockId: 'b1' }], // missing `text`
        misconceptionDigest: [{ concept: 'c1' }], // missing `statement`
        contractVersion: 'three',
        rubricPolicyVersion: 7,
      };
      for (const [field, badValue] of Object.entries(cases)) {
        const id = `d1.bad-${field}`;
        await vault.write(
          contentStorePath(id),
          JSON.stringify({ contentId: id, studentAnswer: 'x', feedback: 'y', [field]: badValue }),
        );
        const result = await readContentRecord(vault, id);
        expect(result).toEqual({ status: 'missing', contentId: id });
      }
    });
  });

  describe('referential integrity (C6.2a: a missing referent has defined behaviour)', () => {
    it('a content id that was never written reads as missing, never throws', async () => {
      const vault = new FolderSource(tempRoot);
      const result = await readContentRecord(vault, 'never-written');
      expect(result).toEqual({ status: 'missing', contentId: 'never-written' });
    });

    it('a deleted content record reads as missing, never throws', async () => {
      const vault = new FolderSource(tempRoot);
      const { contentId, path } = await writeContentRecord(
        vault,
        { studentAnswer: 'x', feedback: 'y' },
        { deviceId: 'd1', generateContentId: () => 'd1.to-delete' },
      );
      await vault.delete?.(path);

      const result = await readContentRecord(vault, contentId);
      expect(result).toEqual({ status: 'missing', contentId });
    });

    it('a corrupt (unparseable) content file reads as missing, never throws', async () => {
      const vault = new FolderSource(tempRoot);
      const path = contentStorePath('corrupt-id');
      await vault.write(path, 'not valid json{{{');

      const result = await readContentRecord(vault, 'corrupt-id');
      expect(result).toEqual({ status: 'missing', contentId: 'corrupt-id' });
    });

    it('a well-formed-JSON-but-wrong-shape file reads as missing, never throws', async () => {
      const vault = new FolderSource(tempRoot);
      const path = contentStorePath('wrong-shape');
      await vault.write(path, JSON.stringify({ unrelated: true }));

      const result = await readContentRecord(vault, 'wrong-shape');
      expect(result).toEqual({ status: 'missing', contentId: 'wrong-shape' });
    });

    it('an invalid content id (never a valid file name) reads as missing rather than throwing', async () => {
      const vault = new FolderSource(tempRoot);
      const result = await readContentRecord(vault, '../escape');
      expect(result).toEqual({ status: 'missing', contentId: '../escape' });
    });

    it('readContentForGrade reads by explainBackGrade.contentRef', async () => {
      const vault = new FolderSource(tempRoot);
      await writeContentRecord(
        vault,
        { studentAnswer: 'x', feedback: 'y' },
        {
          deviceId: 'd1',
          generateContentId: () => 'd1.grade-ref',
        },
      );

      const found = await readContentForGrade(vault, { contentRef: 'd1.grade-ref' });
      expect(found.status).toBe('found');

      const missing = await readContentForGrade(vault, { contentRef: 'gone' });
      expect(missing).toEqual({ status: 'missing', contentId: 'gone' });
    });
  });

  describe('isValidContentId / contentStorePath', () => {
    it('accepts ids matching the device-id-prefixed shape', () => {
      expect(isValidContentId('desktop-1.abc-123')).toBe(true);
    });

    it.each([
      ['', 'empty'],
      ['has/slash', 'contains a path separator'],
      ['../escape', 'path traversal'],
      ['.hidden', 'leading dot'],
    ])('rejects an invalid content id %j (%s)', (contentId) => {
      expect(isValidContentId(contentId)).toBe(false);
      expect(() => contentStorePath(contentId)).toThrow();
    });
  });
});
