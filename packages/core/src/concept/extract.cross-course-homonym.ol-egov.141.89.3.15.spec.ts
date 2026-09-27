/**
 * `[D-402]` (`ol-egov.141.89.3.15`): identical topic wording in two courses mints two
 * identities, one per course, joined only by a same-as link she confirms.
 *
 * The first describe block reproduces the concepts dev set's homonym-across-courses identity case
 * (`olea-service/eval/data/ilb/cpt/`, the one constructed case of that class) in its own shape:
 * two course notes whose `topic:` is the same wikilink, to a note that does not exist, and a read
 * whose model proposes nothing. Its course codes and wording are placeholders here.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Provenance } from '../extract/types.js';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import { extractConcepts, foldReadAnchors } from './extract.js';
import {
  CONCEPT_KEY_RECORD_SCHEMA_VERSION,
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  listConceptKeyRecords,
} from './key-store.js';
import type {
  ConceptReaderPort,
  ConceptReadRequest,
  ConceptReadResponse,
  ReadConcept,
} from './read.js';
import { readConcepts } from './read.js';
import { listSameAsLinkRecords, proposeSameAsFromMintCollisions } from './same-as.js';
import { readConceptSize } from './size.js';

let root: string;
let source: FolderSource;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-d402-'));
  source = new FolderSource(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(relPath: string, content: string): Promise<void> {
  const full = join(root, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf8');
}

const NOTE_A = '01 Courses/COURSEA/Week 1/Life.md';
const NOTE_B = '01 Courses/COURSEB/Week 2/Batteries.md';

/** The dev case's two notes: one wording, a wikilink to a note that does not exist, two courses. */
async function writeHomonymPair(): Promise<void> {
  await write(
    NOTE_A,
    '---\ntopic:\n  - "[[Cell]]"\n---\n# Life\n\nThe smallest unit that carries out life.\n',
  );
  await write(
    NOTE_B,
    '---\ntopic:\n  - "[[Cell]]"\n---\n# Batteries\n\nConverts chemical energy to electrical.\n',
  );
}

/** A reader that proposes nothing, like the dev case's scripted model responses. */
class SilentReader implements ConceptReaderPort {
  read(_request: ConceptReadRequest): Promise<ConceptReadResponse> {
    return Promise.resolve({ concepts: [] });
  }
}

function topicAnchorOf(record: ConceptKeyRecord) {
  if (record.anchor.kind !== 'topic') throw new Error('expected a topic anchor');
  return record.anchor;
}

describe('the dev set homonym case: one wording in two courses ([D-402])', () => {
  it('mints two identities, one per course, whose course lists and introducing notes do not overlap', async () => {
    await writeHomonymPair();

    const concepts = (await extractConcepts(source)).filter((c) => c.name === 'Cell');

    expect(concepts).toHaveLength(2);
    expect(concepts.map((c) => c.courses)).toEqual([['COURSEA'], ['COURSEB']]);
    expect(concepts.map((c) => c.sourcePaths)).toEqual([[NOTE_A], [NOTE_B]]);
    // Unstamped stand-ins stay distinct too: never one shared key for both courses.
    expect(new Set(concepts.map((c) => c.key)).size).toBe(2);
  });

  it('stamped: two key records, each anchored on its own course and its own introducing note', async () => {
    await writeHomonymPair();

    const concepts = (await extractConcepts(source, { stampConceptKeys: true })).filter(
      (c) => c.name === 'Cell',
    );
    const [inA, inB] = concepts;
    expect(inA?.key).not.toBe(inB?.key);

    const byKey = new Map(
      (await listConceptKeyRecords(source)).map(({ record }) => [record.key, record]),
    );
    expect(byKey.size).toBe(2);
    const anchorA = topicAnchorOf(byKey.get(inA?.key as string) as ConceptKeyRecord);
    const anchorB = topicAnchorOf(byKey.get(inB?.key as string) as ConceptKeyRecord);
    expect([anchorA.course, anchorA.introducingPaths]).toEqual(['COURSEA', [NOTE_A]]);
    expect([anchorB.course, anchorB.introducingPaths]).toEqual(['COURSEB', [NOTE_B]]);
  });

  it('raises exactly one proposed same-as link through the mint-collision seam, and confirms nothing', async () => {
    await writeHomonymPair();

    await extractConcepts(source, { stampConceptKeys: true });
    await proposeSameAsFromMintCollisions(source, await listConceptKeyRecords(source));
    // A second tick over the same vault adds nothing: no new key, no second link.
    await extractConcepts(source, { stampConceptKeys: true });
    await proposeSameAsFromMintCollisions(source, await listConceptKeyRecords(source));

    const keys = (await listConceptKeyRecords(source)).map(({ record }) => record.key).sort();
    const links = await listSameAsLinkRecords(source);
    expect(keys).toHaveLength(2);
    expect(links).toHaveLength(1);
    expect(links[0]?.record.status).toBe('proposed');
    expect([links[0]?.record.keyA, links[0]?.record.keyB]).toEqual(keys);
    expect(links.some(({ record }) => record.status === 'confirmed')).toBe(false);
  });

  it('through the read, as the identity case runs it: two concepts, two keys, disjoint courses', async () => {
    await writeHomonymPair();

    const result = await readConcepts(source, new SilentReader(), {
      budget: { maxPassages: 60 },
      stampConceptKeys: true,
      under: '01 Courses',
    });

    if (result.outcome !== 'read') throw new Error(`expected a read, got ${result.outcome}`);
    const cells = result.concepts.filter((c) => c.name === 'Cell');
    expect(cells).toHaveLength(2);
    expect(new Set(cells.map((c) => c.key)).size).toBe(2);
    expect(cells.map((c) => c.courses).sort()).toEqual([['COURSEA'], ['COURSEB']]);
    // The subtree read took the vault-wide identities' keys and minted nothing more.
    expect(await listConceptKeyRecords(source)).toHaveLength(2);
  });
});

describe('keys already minted are never rewritten ([D-402], [D-088])', () => {
  it('an identity formed by the old cross-course merge keeps its key for the course it anchored on; only the other course mints', async () => {
    await writeHomonymPair();
    // Exactly what the old merge wrote: one record, anchored on the first course, both notes.
    const merged: ConceptKeyRecord = {
      key: 'concept-key1:merged-before-d402',
      tier: 2,
      anchor: {
        kind: 'topic',
        course: 'COURSEA',
        name: 'Cell',
        aliases: [],
        introducingPaths: [NOTE_A, NOTE_B],
      },
      aliases: [],
      mintedAt: '2026-09-01',
      schemaVersion: CONCEPT_KEY_RECORD_SCHEMA_VERSION,
    };
    const mergedPath = conceptKeyRecordPath(merged.key);
    await write(mergedPath, `${JSON.stringify(merged, null, 2)}\n`);

    const concepts = (await extractConcepts(source, { stampConceptKeys: true })).filter(
      (c) => c.name === 'Cell',
    );
    await proposeSameAsFromMintCollisions(source, await listConceptKeyRecords(source));

    const inA = concepts.find((c) => c.courses.includes('COURSEA'));
    const inB = concepts.find((c) => c.courses.includes('COURSEB'));
    expect(inA?.key).toBe(merged.key);
    expect(inB?.key).not.toBe(merged.key);
    // The old record is still at its own path under its own key.
    const onDisk = JSON.parse(await readFile(join(root, mergedPath), 'utf8')) as ConceptKeyRecord;
    expect(onDisk.key).toBe(merged.key);
    expect(onDisk.mintedAt).toBe(merged.mintedAt);
    expect(await listConceptKeyRecords(source)).toHaveLength(2);

    const links = await listSameAsLinkRecords(source);
    expect(links).toHaveLength(1);
    expect(links[0]?.record.status).toBe('proposed');
    expect([links[0]?.record.keyA, links[0]?.record.keyB].sort()).toEqual(
      [merged.key, inB?.key as string].sort(),
    );
  });
});

describe('what stays one identity, because something other than the wording joins it', () => {
  it('a concept bound to her note, linked from two courses, stays one identity with both courses', async () => {
    await write('05 Zettelkasten/Cell.md', '---\ntype: concept\n---\n\n# Cell\n\nHers.\n');
    await writeHomonymPair();

    const concepts = (await extractConcepts(source)).filter((c) => c.name === 'Cell');
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.tier).toBe(1);
    expect(concepts[0]?.courses).toEqual(['COURSEA', 'COURSEB']);
  });

  it('one note filed under both courses joins them: her cross-listing, not a coincidence of wording', async () => {
    await write(
      '01 Courses/Shared/Cross-listed.md',
      '---\ntopic: [Cell]\ncourse: [COURSEA, COURSEB]\n---\n\n# X\n',
    );
    await write('01 Courses/COURSEB/Week 3/More.md', '---\ntopic: [Cell]\n---\n\n# More\n');

    const concepts = (await extractConcepts(source)).filter((c) => c.name === 'Cell');
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.courses).toEqual(['COURSEA', 'COURSEB']);
    expect(concepts[0]?.key).toBe('concept-prov1:Cell');
  });

  it('a citation from a note in no course stays with each course identity; their course lists still do not overlap', async () => {
    await writeHomonymPair();
    await write('03 Research/Loose.md', '---\ntopic: [Cell]\n---\n\n# Loose\n');

    const concepts = (await extractConcepts(source)).filter((c) => c.name === 'Cell');
    expect(concepts.map((c) => c.courses)).toEqual([['COURSEA'], ['COURSEB']]);
    expect(concepts.map((c) => c.sourcePaths)).toEqual([
      [NOTE_A, '03 Research/Loose.md'],
      [NOTE_B, '03 Research/Loose.md'],
    ]);
  });

  it('a wording cited in one course and in no course is one identity, exactly as before', async () => {
    await write(NOTE_A, '---\ntopic: [Cell]\n---\n\n# Life\n');
    await write('03 Research/Loose.md', '---\ntopic: [Cell]\n---\n\n# Loose\n');

    const concepts = (await extractConcepts(source)).filter((c) => c.name === 'Cell');
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.courses).toEqual(['COURSEA']);
    expect(concepts[0]?.key).toBe('concept-prov1:Cell');
  });
});

describe('a stamped subtree pass keys each course identity by its vault-wide key ([D-357], [D-402])', () => {
  it('each course subtree takes its own identity, and none mints', async () => {
    await writeHomonymPair();

    const whole = (await extractConcepts(source, { stampConceptKeys: true })).filter(
      (c) => c.name === 'Cell',
    );
    const inA = await extractConcepts(source, {
      stampConceptKeys: true,
      under: '01 Courses/COURSEA',
    });
    const inB = await extractConcepts(source, {
      stampConceptKeys: true,
      under: '01 Courses/COURSEB',
    });

    expect(inA.map((c) => c.key)).toEqual([whole[0]?.key]);
    expect(inB.map((c) => c.key)).toEqual([whole[1]?.key]);
    expect(await listConceptKeyRecords(source)).toHaveLength(2);
  });
});

describe('foldReadAnchors folds a split wording per course ([D-402])', () => {
  function anchorIn(path: VaultPath): Provenance {
    return { sourcePath: path, location: { page: 1, charRange: { start: 0, end: 5 } } };
  }
  function readCell(anchor: Provenance, alsoIn: readonly Provenance[]): ReadConcept {
    return {
      key: 'concept-prov1:Cell',
      name: 'Cell',
      aliases: [],
      provenanceTier: 2,
      courses: ['COURSEA', 'COURSEB'],
      anchor,
      alsoIn,
      sourcePaths: [],
      size: readConceptSize({ anchor, alsoIn, sourcePaths: [] }),
    };
  }

  it("each identity takes its own course's passages, and a passage from no course goes to both", async () => {
    await writeHomonymPair();
    const records = (await extractConcepts(source)).filter((c) => c.name === 'Cell');
    const loose = anchorIn('03 Research/Loose.md');

    const folded = foldReadAnchors(records, [
      readCell(anchorIn(NOTE_A), [anchorIn(NOTE_B), loose]),
    ]);

    expect(
      folded.map((r) => [r.anchor?.sourcePath, ...(r.alsoIn ?? []).map((p) => p.sourcePath)]),
    ).toEqual([
      [NOTE_A, '03 Research/Loose.md'],
      [NOTE_B, '03 Research/Loose.md'],
    ]);
  });
});
