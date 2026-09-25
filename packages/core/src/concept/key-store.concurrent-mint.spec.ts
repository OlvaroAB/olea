/**
 * `ol-egov.141.89.9.52` — concurrent lookup-then-mint in the concept-key store (`[D-357]`'s
 * follow-up, `[D-378]`'s "prevent fresh duplicate creation before real use").
 *
 * Before this bead `resolveConceptKey` listed `.olea/concepts/`, matched in memory and, on a miss,
 * minted and wrote — with nothing between the listing and the write. Two passes that meet one
 * brand-new concept at the same time (two review opens, a review open racing a generation pass,
 * the Today panel's several stamped readers loading at once) both list before either writes, both
 * miss, and both mint: two permanent keys for one anchor, the exact duplicate `[D-378]` otherwise
 * has to resolve after the fact.
 *
 * The second half of this file is `[D-378]`'s canonical lookup: records sharing an anchor are one
 * identity, the earliest-minted record is canonical, and no record is deleted or rewritten to get
 * there. Every concept name and course code below is invented (INV-3).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { extractConcepts } from './extract.js';
import {
  bindConceptKeyToNote,
  buildConceptKeyCanonicalIndex,
  CONCEPT_KEY_RECORD_SCHEMA_VERSION,
  type ConceptKeyAnchor,
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  listConceptKeyRecords,
  readConceptKeyCanonicalIndex,
  resolveConceptKey,
} from './key-store.js';

let root: string;
let source: FolderSource;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-concept-key-race-'));
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

async function readRaw(relPath: string): Promise<string> {
  return readFile(join(root, ...relPath.split('/')), 'utf8');
}

function recordFor(
  key: string,
  anchor: ConceptKeyAnchor,
  mintedAt: string,
  extra: Partial<ConceptKeyRecord> = {},
): ConceptKeyRecord {
  return {
    key,
    tier: anchor.kind === 'note' ? 1 : 2,
    anchor,
    aliases: [],
    mintedAt,
    schemaVersion: CONCEPT_KEY_RECORD_SCHEMA_VERSION,
    ...extra,
  };
}

/** Writes a record exactly as `key-store.ts` serialises one, so a later byte compare is meaningful. */
async function seed(record: ConceptKeyRecord): Promise<void> {
  await write(conceptKeyRecordPath(record.key), `${JSON.stringify(record, null, 2)}\n`);
}

describe('concurrent lookup-then-mint never mints two keys for one anchor (ol-egov.141.89.9.52)', () => {
  it('two concurrent resolves of one brand-new topic anchor return one key and leave one record', async () => {
    const anchor: ConceptKeyAnchor = {
      kind: 'topic',
      course: 'TESTC1',
      name: 'Widget theory',
      aliases: [],
    };
    const [first, second] = await Promise.all([
      resolveConceptKey(source, 2, anchor),
      resolveConceptKey(source, 2, anchor),
    ]);

    expect(second).toBe(first);
    expect(await listConceptKeyRecords(source)).toHaveLength(1);
  });

  it('two concurrent resolves of one brand-new bound note return one key and leave one record', async () => {
    const anchor: ConceptKeyAnchor = {
      kind: 'note',
      noteUid: null,
      notePath: 'Concepts/Gadget theory.md',
    };
    const keys = await Promise.all([
      resolveConceptKey(source, 1, anchor),
      resolveConceptKey(source, 1, anchor),
      resolveConceptKey(source, 1, anchor),
    ]);

    expect(new Set(keys).size).toBe(1);
    expect(await listConceptKeyRecords(source)).toHaveLength(1);
  });

  it('two concurrent stamped extraction passes over a vault with one new concept agree on its key', async () => {
    await write(
      '01 Courses/TESTC1/Week one.md',
      '---\ntopic: [Widget theory]\ncourse: TESTC1\n---\n\nThe front::The back\n',
    );

    const [a, b] = await Promise.all([
      extractConcepts(source, { stampConceptKeys: true }),
      extractConcepts(source, { stampConceptKeys: true }),
    ]);

    const keyA = a.find((c) => c.name === 'Widget theory')?.key;
    const keyB = b.find((c) => c.name === 'Widget theory')?.key;
    expect(keyA).toBeDefined();
    expect(keyB).toBe(keyA);
    expect(await listConceptKeyRecords(source)).toHaveLength(1);
  });

  it('a pass racing a key-driven rebind never regresses the rebound record back off its note', async () => {
    const topic: ConceptKeyAnchor = {
      kind: 'topic',
      course: 'TESTC1',
      name: 'Widget theory',
      aliases: [],
    };
    const key = await resolveConceptKey(source, 2, topic);
    const note = { kind: 'note' as const, noteUid: null, notePath: 'Concepts/Widget theory.md' };

    const [, resolved] = await Promise.all([
      bindConceptKeyToNote(source, key, note),
      resolveConceptKey(source, 2, topic),
    ]);

    expect(resolved).toBe(key);
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.anchor).toEqual(note);
  });
});

describe('same-anchor duplicates resolve to one canonical, earliest-minted key ([D-378])', () => {
  const ANCHOR: ConceptKeyAnchor = {
    kind: 'topic',
    course: 'TESTC1',
    name: 'Widget theory',
    aliases: [],
  };

  it('lookup returns the earliest-minted of several same-anchor records, not the first one listed', async () => {
    // Listing order is key order (sorted paths); the earliest mint is deliberately NOT first.
    await seed(recordFor('concept-key1:aaaa', ANCHOR, '2026-09-20'));
    await seed(recordFor('concept-key1:bbbb', ANCHOR, '2026-09-03'));
    await seed(recordFor('concept-key1:cccc', ANCHOR, '2026-09-11'));

    expect(await resolveConceptKey(source, 2, ANCHOR)).toBe('concept-key1:bbbb');
  });

  it('two records minted the same day tie-break on the key, the same way on every read', async () => {
    await seed(recordFor('concept-key1:dddd', ANCHOR, '2026-09-03'));
    await seed(recordFor('concept-key1:cccc', ANCHOR, '2026-09-03'));

    expect(await resolveConceptKey(source, 2, ANCHOR)).toBe('concept-key1:cccc');
    expect(await resolveConceptKey(source, 2, ANCHOR)).toBe('concept-key1:cccc');
  });

  it('no duplicate record is deleted or rewritten, not even the canonical one, by a lookup or by building the index', async () => {
    await seed(recordFor('concept-key1:aaaa', ANCHOR, '2026-09-20'));
    await seed(recordFor('concept-key1:bbbb', ANCHOR, '2026-09-03'));
    const before = [
      await readRaw(conceptKeyRecordPath('concept-key1:aaaa')),
      await readRaw(conceptKeyRecordPath('concept-key1:bbbb')),
    ];

    await resolveConceptKey(source, 2, ANCHOR);
    await readConceptKeyCanonicalIndex(source);

    expect(await listConceptKeyRecords(source)).toHaveLength(2);
    expect([
      await readRaw(conceptKeyRecordPath('concept-key1:aaaa')),
      await readRaw(conceptKeyRecordPath('concept-key1:bbbb')),
    ]).toEqual(before);
  });

  it('the shared resolver maps every superseded duplicate to the key lookup returns', async () => {
    await seed(recordFor('concept-key1:aaaa', ANCHOR, '2026-09-20'));
    await seed(recordFor('concept-key1:bbbb', ANCHOR, '2026-09-03'));
    await seed(recordFor('concept-key1:cccc', ANCHOR, '2026-09-11'));

    const index = await readConceptKeyCanonicalIndex(source);
    const looked = await resolveConceptKey(source, 2, ANCHOR);

    for (const key of ['concept-key1:aaaa', 'concept-key1:bbbb', 'concept-key1:cccc']) {
      expect(index.canonicalOf(key)).toBe(looked);
    }
    // A key the store has never seen (a stand-in, or one from another vault) is left as it is.
    expect(index.canonicalOf('concept-prov1:Widget theory')).toBe('concept-prov1:Widget theory');
  });

  it('a duplicate bound by path and one bound by uid at the same path are one identity', async () => {
    await seed(
      recordFor(
        'concept-key1:eeee',
        { kind: 'note', noteUid: null, notePath: 'Concepts/Gadget theory.md' },
        '2026-09-02',
      ),
    );
    await seed(
      recordFor(
        'concept-key1:ffff',
        { kind: 'note', noteUid: 'uid-gadget', notePath: 'Concepts/Gadget theory.md' },
        '2026-09-09',
      ),
    );

    const index = buildConceptKeyCanonicalIndex(
      (await listConceptKeyRecords(source)).map(({ record }) => record),
    );
    expect(index.canonicalOf('concept-key1:ffff')).toBe('concept-key1:eeee');
    expect(
      await resolveConceptKey(source, 1, {
        kind: 'note',
        noteUid: 'uid-gadget',
        notePath: 'Concepts/Gadget theory.md',
      }),
    ).toBe('concept-key1:eeee');
  });

  it('two notes with different uids are never one identity, even through a uid-less record at the same path', async () => {
    const path = 'Concepts/Gadget theory.md';
    await seed(
      recordFor(
        'concept-key1:gggg',
        { kind: 'note', noteUid: 'uid-one', notePath: path },
        '2026-09-01',
      ),
    );
    await seed(
      recordFor('concept-key1:hhhh', { kind: 'note', noteUid: null, notePath: path }, '2026-09-02'),
    );
    await seed(
      recordFor(
        'concept-key1:iiii',
        { kind: 'note', noteUid: 'uid-two', notePath: path },
        '2026-09-03',
      ),
    );

    const index = buildConceptKeyCanonicalIndex(
      (await listConceptKeyRecords(source)).map(({ record }) => record),
    );
    expect(index.canonicalOf('concept-key1:iiii')).not.toBe(index.canonicalOf('concept-key1:gggg'));
  });

  it('two concepts sharing one introducing note are never one identity (D-378: a shared passage alone proves nothing)', async () => {
    const shared = ['01 Courses/TESTC1/Week one.md'];
    await seed(
      recordFor(
        'concept-key1:jjjj',
        {
          kind: 'topic',
          course: 'TESTC1',
          name: 'Widget theory',
          aliases: [],
          introducingPaths: shared,
        },
        '2026-09-01',
      ),
    );
    await seed(
      recordFor(
        'concept-key1:kkkk',
        {
          kind: 'topic',
          course: 'TESTC1',
          name: 'Gadget theory',
          aliases: [],
          introducingPaths: shared,
        },
        '2026-09-02',
      ),
    );

    const index = buildConceptKeyCanonicalIndex(
      (await listConceptKeyRecords(source)).map(({ record }) => record),
    );
    expect(index.canonicalOf('concept-key1:kkkk')).toBe('concept-key1:kkkk');
    expect(index.canonicalOf('concept-key1:jjjj')).toBe('concept-key1:jjjj');
  });

  it('a record rebound onto a note still carries its topic duplicates with it', async () => {
    await seed(
      recordFor(
        'concept-key1:llll',
        { kind: 'note', noteUid: null, notePath: 'Concepts/Widget theory.md' },
        '2026-09-01',
        { aliases: ['Widget theory'] },
      ),
    );
    await seed(recordFor('concept-key1:mmmm', ANCHOR, '2026-09-05'));

    const index = await readConceptKeyCanonicalIndex(source);
    expect(index.canonicalOf('concept-key1:mmmm')).toBe('concept-key1:llll');
    expect(await resolveConceptKey(source, 2, ANCHOR)).toBe('concept-key1:llll');
  });

  it('a rebind given a superseded duplicate moves the canonical record and leaves the duplicate untouched', async () => {
    await seed(recordFor('concept-key1:nnnn', ANCHOR, '2026-09-01'));
    await seed(recordFor('concept-key1:oooo', ANCHOR, '2026-09-07'));
    const duplicateBytes = await readRaw(conceptKeyRecordPath('concept-key1:oooo'));
    const note = { kind: 'note' as const, noteUid: null, notePath: 'Concepts/Widget theory.md' };

    await bindConceptKeyToNote(source, 'concept-key1:oooo', note);

    const byKey = new Map(
      (await listConceptKeyRecords(source)).map(({ record }) => [record.key, record]),
    );
    expect(byKey.get('concept-key1:nnnn')?.anchor).toEqual(note);
    expect(byKey.get('concept-key1:nnnn')?.aliases).toEqual(['Widget theory']);
    expect(await readRaw(conceptKeyRecordPath('concept-key1:oooo'))).toBe(duplicateBytes);
    expect(await resolveConceptKey(source, 1, note)).toBe('concept-key1:nnnn');
    expect(await resolveConceptKey(source, 2, ANCHOR)).toBe('concept-key1:nnnn');
  });
});

describe('a subtree pass keys each concept by its vault-wide identity ([D-357], ol-egov.141.89.9.30)', () => {
  it('a topic-only concept named in two courses gets one key from a whole-vault pass and from either course subtree', async () => {
    await write(
      '01 Courses/TESTA1/Week one.md',
      '---\ntopic: [Widget theory]\ncourse: TESTA1\n---\n\nFront a::Back a\n',
    );
    await write(
      '01 Courses/TESTB2/Week one.md',
      '---\ntopic: [Widget theory]\ncourse: TESTB2\n---\n\nFront b::Back b\n',
    );

    const whole = await extractConcepts(source, { stampConceptKeys: true });
    const inA = await extractConcepts(source, {
      stampConceptKeys: true,
      under: '01 Courses/TESTA1',
    });
    const inB = await extractConcepts(source, {
      stampConceptKeys: true,
      under: '01 Courses/TESTB2',
    });

    const key = whole.find((c) => c.name === 'Widget theory')?.key;
    expect(key).toBeDefined();
    expect(inA.find((c) => c.name === 'Widget theory')?.key).toBe(key);
    expect(inB.find((c) => c.name === 'Widget theory')?.key).toBe(key);
    // The subtree passes minted nothing of their own.
    expect(await listConceptKeyRecords(source)).toHaveLength(1);
    // Everything else on a subtree record is still the subtree's own.
    expect(inB.find((c) => c.name === 'Widget theory')?.sourcePaths).toEqual([
      '01 Courses/TESTB2/Week one.md',
    ]);
  });

  it('a subtree pass run first, before any whole-vault pass, still mints the key the whole vault later reads', async () => {
    await write(
      '01 Courses/TESTA1/Week one.md',
      '---\ntopic: [Widget theory]\ncourse: TESTA1\n---\n\nFront a::Back a\n',
    );
    await write(
      '01 Courses/TESTB2/Week one.md',
      '---\ntopic: [Widget theory]\ncourse: TESTB2\n---\n\nFront b::Back b\n',
    );

    const inB = await extractConcepts(source, {
      stampConceptKeys: true,
      under: '01 Courses/TESTB2',
    });
    const whole = await extractConcepts(source, { stampConceptKeys: true });

    expect(inB.find((c) => c.name === 'Widget theory')?.key).toBe(
      whole.find((c) => c.name === 'Widget theory')?.key,
    );
    expect(await listConceptKeyRecords(source)).toHaveLength(1);
  });
});
