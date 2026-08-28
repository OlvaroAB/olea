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
