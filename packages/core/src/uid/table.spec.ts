import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { stampUid } from './stamp.js';
import { buildUidTable } from './table.js';

describe('buildUidTable', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-uid-table-'));
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

  it('is empty against a vault with no stamped notes', async () => {
    await write('Note.md', '---\ncourse: GEOL204\n---\n\n# Note\n');
    const result = await buildUidTable(source);
    expect(result.table.size).toBe(0);
    expect(result.duplicates).toEqual([]);
  });

  it('indexes every stamped note by its uid', async () => {
    const a = stampUid('---\ncourse: GEOL204\n---\n\n# A\n', { generateId: () => 'uid-a' });
    const b = stampUid('---\ncourse: MUSTH104\n---\n\n# B\n', { generateId: () => 'uid-b' });
    await write('A.md', a.content);
    await write('B.md', b.content);
    await write('C.md', '# C has no frontmatter at all\n');

    const result = await buildUidTable(source);
    expect(result.table.get('uid-a')).toBe('A.md');
    expect(result.table.get('uid-b')).toBe('B.md');
    expect(result.table.size).toBe(2);
    expect(result.duplicates).toEqual([]);
  });

  it('reports a duplicate uid instead of silently overwriting the first path', async () => {
    const a = stampUid('---\ncourse: GEOL204\n---\n\n# A\n', { generateId: () => 'dup-uid' });
    const b = stampUid('---\ncourse: GEOL204\n---\n\n# B (copy of A)\n', {
      generateId: () => 'dup-uid',
    });
    await write('A.md', a.content);
    await write('B-copy.md', b.content);

    const result = await buildUidTable(source);
    // First path in sorted-list scan order wins the table slot.
    expect(result.table.get('dup-uid')).toBe('A.md');
    expect(result.table.size).toBe(1);
    expect(result.duplicates).toEqual([{ uid: 'dup-uid', path: 'B-copy.md' }]);
  });

  it('honours a custom key', async () => {
    const a = stampUid('---\ncourse: GEOL204\n---\n\n# A\n', {
      key: 'my-uid',
      generateId: () => 'uid-a',
    });
    await write('A.md', a.content);

    expect((await buildUidTable(source)).table.size).toBe(0); // default key not present
    const result = await buildUidTable(source, { key: 'my-uid' });
    expect(result.table.get('uid-a')).toBe('A.md');
  });

  it('round-trips against the real fixture vault without throwing (none are stamped yet)', async () => {
    const fixtureRoot = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');
    const fixtureSource = new FolderSource(fixtureRoot);
    const result = await buildUidTable(fixtureSource);
    expect(result.table.size).toBe(0);
    expect(result.duplicates).toEqual([]);
  });
});
