/**
 * `ol-egov.141.89.3.20` (`[D-402]`): the read path corroborates a model-proposed concept against
 * the identity of its own course, never against another course's record for the same wording, so
 * both courses' records survive a read.
 *
 * The fixture is the concepts dev set's homonym-across-courses shape, as
 * `./extract.cross-course-homonym.ol-egov.141.89.3.15.spec.ts` builds it: two course notes whose
 * `topic:` is the same wikilink, to a note that does not exist. Course codes and wording are
 * placeholders. Here the reader proposes that wording from a chosen set of documents.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import { extractConcepts } from './extract.js';
import { listConceptKeyRecords } from './key-store.js';
import type {
  ConceptReaderPort,
  ConceptReadRequest,
  ConceptReadResponse,
  ConceptsRead,
  ReadConcept,
} from './read.js';
import { readConcepts } from './read.js';

let root: string;
let source: FolderSource;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-d402-read-'));
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
const NOTE_C = '01 Courses/COURSEC/Week 3/Other.md';
const LOOSE = '03 Research/Loose.md';

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

/** Proposes the shared wording once per document it reads whose path is in `from`, anchored on that document's first passage. */
class WordingReader implements ConceptReaderPort {
  constructor(
    private readonly from: ReadonlySet<VaultPath>,
    private readonly wording = 'Cell',
  ) {}

  read(request: ConceptReadRequest): Promise<ConceptReadResponse> {
    const first = request.passages.find((p) => this.from.has(p.anchor.sourcePath));
    if (first === undefined) return Promise.resolve({ concepts: [] });
    return Promise.resolve({
      concepts: [{ name: this.wording, aliases: [], anchor: first.anchor, alsoIn: [] }],
    });
  }
}

async function read(from: readonly VaultPath[], stamp = false): Promise<ConceptsRead> {
  const result = await readConcepts(source, new WordingReader(new Set(from)), {
    budget: { maxPassages: 200 },
    ...(stamp ? { stampConceptKeys: true } : {}),
  });
  if (result.outcome !== 'read') throw new Error(`expected a read, got ${result.outcome}`);
  return result;
}

function cells(result: ConceptsRead): readonly ReadConcept[] {
  return result.concepts.filter((c) => c.name === 'Cell');
}

function passagePaths(concept: ReadConcept | undefined): readonly VaultPath[] {
  if (concept?.anchor === undefined) return [];
  return [concept.anchor.sourcePath, ...concept.alsoIn.map((p) => p.sourcePath)];
}

describe('a proposal corroborates the identity of its own course ([D-402])', () => {
  it('proposed from the second course only: resolves to that course identity, and the first course record survives', async () => {
    await writeHomonymPair();
    const records = (await extractConcepts(source)).filter((c) => c.name === 'Cell');
    const keyA = records.find((r) => r.courses.includes('COURSEA'))?.key;
    const keyB = records.find((r) => r.courses.includes('COURSEB'))?.key;

    const found = cells(await read([NOTE_B]));

    expect(found).toHaveLength(2);
    const [inA, inB] = found;
    expect(inA?.courses).toEqual(['COURSEA']);
    expect(inA?.key).toBe(keyA);
    expect(inA?.anchor).toBeUndefined();
    expect(inB?.courses).toEqual(['COURSEB']);
    expect(inB?.key).toBe(keyB);
    expect(passagePaths(inB)).toEqual([NOTE_B]);
    expect(inB?.sourcePaths).toEqual([NOTE_B]);
  });

  it('proposed from both courses: two concepts, each anchored on its own course, course lists disjoint', async () => {
    await writeHomonymPair();

    const found = cells(await read([NOTE_A, NOTE_B]));

    expect(found.map((c) => c.courses)).toEqual([['COURSEA'], ['COURSEB']]);
    expect(found.map(passagePaths)).toEqual([[NOTE_A], [NOTE_B]]);
    expect(found.map((c) => c.sourcePaths)).toEqual([[NOTE_A], [NOTE_B]]);
    expect(new Set(found.map((c) => c.key)).size).toBe(2);
  });

  it('stamped: each concept carries its own course identity permanent key, and the read mints nothing more', async () => {
    await writeHomonymPair();
    const stamped = (await extractConcepts(source, { stampConceptKeys: true })).filter(
      (c) => c.name === 'Cell',
    );

    const found = cells(await read([NOTE_A, NOTE_B], true));

    expect(found.map((c) => c.key)).toEqual(stamped.map((r) => r.key));
    expect(await listConceptKeyRecords(source)).toHaveLength(2);
  });

  it('a passage from a document in no course stays with each identity', async () => {
    await writeHomonymPair();
    await write(LOOSE, '# Loose\n\nA note about cells, filed in no course.\n');

    const found = cells(await read([LOOSE]));

    expect(found.map((c) => c.courses)).toEqual([['COURSEA'], ['COURSEB']]);
    expect(found.map(passagePaths)).toEqual([[LOOSE], [LOOSE]]);
  });

  it('a passage from a third course corroborates neither identity: it is that course concept, and both records survive', async () => {
    await writeHomonymPair();
    await write(NOTE_C, '# Other\n\nA third course mentions cells too.\n');

    const found = cells(await read([NOTE_C]));

    expect(found.map((c) => c.courses)).toEqual([['COURSEA'], ['COURSEB'], ['COURSEC']]);
    const inC = found[2];
    expect(inC?.provenanceTier).toBe(3);
    expect(passagePaths(inC)).toEqual([NOTE_C]);
    expect(new Set(found.map((c) => c.key)).size).toBe(3);
  });
});

describe('a wording with one identity corroborates exactly as before', () => {
  it('a proposal from another course corroborates the one record and joins its course (unchanged)', async () => {
    await write(NOTE_A, '---\ntopic: [Cell]\n---\n\n# Life\n\nThe smallest unit.\n');
    await write(NOTE_B, '# Batteries\n\nNo topic here, but the reader proposes the wording.\n');
    const [record] = (await extractConcepts(source)).filter((c) => c.name === 'Cell');

    const found = cells(await read([NOTE_B]));

    expect(found).toHaveLength(1);
    expect(found[0]?.key).toBe(record?.key);
    expect(found[0]?.courses).toEqual(['COURSEA', 'COURSEB']);
    expect(passagePaths(found[0])).toEqual([NOTE_B]);
  });
});
