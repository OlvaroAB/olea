/**
 * `ol-egov.141.89.4.19` (`[D-402]`), end to end through `readConcepts`: a relation the reader
 * proposes between concepts of one course resolves to that course's identity when the wording is
 * split by course, and carries both endpoint keys, so a reader downstream joins by identity.
 *
 * The fixture is the homonym-across-courses shape of
 * `./read.cross-course-homonym.ol-egov.141.89.3.20.spec.ts`: two course notes whose `topic:` is the
 * same wikilink, so `./extract.js` keeps one identity per course. Course codes and wording are
 * placeholders.
 *
 * `readConcepts` does not yet tell reconciliation which document each relation came from (the
 * splice is handed back on the bead), so these tests pin what the shipped path does without it:
 * the pair of endpoints sharing a document decides, and a relation that could belong to either
 * course is dropped and counted rather than resolved to the first.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { containerConceptKeysToDrop } from '../session/containment.js';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import { extractConcepts } from './extract.js';
import type {
  ConceptReaderPort,
  ConceptReadRequest,
  ConceptReadResponse,
  ConceptsRead,
} from './read.js';
import { readConcepts } from './read.js';
import type { RelationWithEndpointKeys } from './related-concept-keys.js';
import type { ProposedRelation } from './relation.js';

let root: string;
let source: FolderSource;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-d402-relations-'));
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

const NOTE_A = '01 Courses/COURSEA/Week 1/Life.md' as VaultPath;
const NOTE_B = '01 Courses/COURSEB/Week 2/Batteries.md' as VaultPath;
const LOOSE = '03 Research/Loose.md' as VaultPath;

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

/** What the reader says about one document: the wordings it proposes (anchored on the document's first passage) and the relations between them. */
interface DocumentReading {
  readonly concepts: readonly string[];
  readonly relations?: readonly Pick<ProposedRelation, 'from' | 'to'>[];
}

/** Answers each call from the reading scripted for that call's document; a document with none yields nothing. */
class ScriptedReader implements ConceptReaderPort {
  constructor(private readonly byDocument: ReadonlyMap<VaultPath, DocumentReading>) {}

  read(request: ConceptReadRequest): Promise<ConceptReadResponse> {
    const first = request.passages[0];
    const reading = first === undefined ? undefined : this.byDocument.get(first.anchor.sourcePath);
    if (first === undefined || reading === undefined) return Promise.resolve({ concepts: [] });
    return Promise.resolve({
      concepts: reading.concepts.map((name) => ({
        name,
        aliases: [],
        anchor: first.anchor,
        alsoIn: [],
      })),
      relations: (reading.relations ?? []).map(({ from, to }) => ({
        type: 'part-of' as const,
        from,
        to,
        confidence: 0.7,
      })),
    });
  }
}

async function read(
  byDocument: ReadonlyMap<VaultPath, DocumentReading>,
  stamp = false,
): Promise<ConceptsRead> {
  const result = await readConcepts(source, new ScriptedReader(byDocument), {
    budget: { maxPassages: 200 },
    ...(stamp ? { stampConceptKeys: true } : {}),
  });
  if (result.outcome !== 'read') throw new Error(`expected a read, got ${result.outcome}`);
  return result;
}

async function cellKeys(stamp = false): Promise<{ keyA: string; keyB: string }> {
  const records = (await extractConcepts(source, stamp ? { stampConceptKeys: true } : {})).filter(
    (c) => c.name === 'Cell',
  );
  const keyA = records.find((r) => r.courses.includes('COURSEA'))?.key;
  const keyB = records.find((r) => r.courses.includes('COURSEB'))?.key;
  if (keyA === undefined || keyB === undefined || keyA === keyB) {
    throw new Error('fixture: expected two course identities for the shared wording');
  }
  return { keyA, keyB };
}

function keyOf(result: ConceptsRead, name: string, course?: string): string | undefined {
  return result.concepts.find(
    (c) => c.name === name && (course === undefined || c.courses.includes(course)),
  )?.key;
}

function edges(result: ConceptsRead): readonly RelationWithEndpointKeys[] {
  return result.relations;
}

describe('a relation between concepts of one course resolves to that course identity ([D-402])', () => {
  it('both courses read, the relation in the second: it names the second course identity', async () => {
    await writeHomonymPair();
    const { keyA, keyB } = await cellKeys();

    const result = await read(
      new Map([
        [NOTE_A, { concepts: ['Cell'] }],
        [
          NOTE_B,
          { concepts: ['Cell', 'Electrode'], relations: [{ from: 'Electrode', to: 'Cell' }] },
        ],
      ]),
    );

    const [edge] = edges(result);
    expect(edges(result)).toHaveLength(1);
    expect(edge?.toKey).toBe(keyB);
    expect(edge?.toKey).not.toBe(keyA);
    expect(edge?.fromKey).toBe(keyOf(result, 'Electrode'));
    expect(edge?.introducingPassages.to.sourcePath).toBe(NOTE_B);
    expect(edge?.introducingPassages.from.sourcePath).toBe(NOTE_B);
    expect(result.relationsDropped).toBe(0);
  });

  it('a relation in each course: each names its own course identity', async () => {
    await writeHomonymPair();
    const { keyA, keyB } = await cellKeys();

    const result = await read(
      new Map([
        [
          NOTE_A,
          { concepts: ['Cell', 'Organelle'], relations: [{ from: 'Organelle', to: 'Cell' }] },
        ],
        [
          NOTE_B,
          { concepts: ['Cell', 'Electrode'], relations: [{ from: 'Electrode', to: 'Cell' }] },
        ],
      ]),
    );

    const byPart = new Map(edges(result).map((e) => [e.from, e]));
    expect(byPart.get('Organelle')?.toKey).toBe(keyA);
    expect(byPart.get('Electrode')?.toKey).toBe(keyB);
    expect(byPart.get('Organelle')?.introducingPassages.to.sourcePath).toBe(NOTE_A);
    expect(byPart.get('Electrode')?.introducingPassages.to.sourcePath).toBe(NOTE_B);
  });

  it('stamped keys: the edge carries the second course identity permanent key', async () => {
    await writeHomonymPair();
    const { keyB } = await cellKeys(true);

    const result = await read(
      new Map([
        [NOTE_A, { concepts: ['Cell'] }],
        [
          NOTE_B,
          { concepts: ['Cell', 'Electrode'], relations: [{ from: 'Electrode', to: 'Cell' }] },
        ],
      ]),
      true,
    );

    expect(edges(result).map((e) => e.toKey)).toEqual([keyB]);
    expect(edges(result).map((e) => e.fromKey)).toEqual([keyOf(result, 'Electrode', 'COURSEB')]);
  });

  it('downstream, containment drops the second course container, where a name join picks the first', async () => {
    await writeHomonymPair();
    const { keyA, keyB } = await cellKeys();
    const result = await read(
      new Map([
        [NOTE_A, { concepts: ['Cell'] }],
        [
          NOTE_B,
          { concepts: ['Cell', 'Electrode'], relations: [{ from: 'Electrode', to: 'Cell' }] },
        ],
      ]),
    );
    const electrodeKey = keyOf(result, 'Electrode');
    if (electrodeKey === undefined) throw new Error('expected the part concept');
    // A name join over her records in vault order: the first course's identity claims the name.
    const keyOfName = new Map([
      ['Cell', keyA],
      ['Electrode', electrodeKey],
    ]);

    const drop = containerConceptKeysToDrop(
      result.relations,
      keyOfName,
      new Set([electrodeKey, keyB]),
    );

    expect([...drop]).toEqual([keyB]);
  });
});

describe('a relation the shipped path cannot place is dropped and counted', () => {
  it('both endpoints read in both courses, the relation in one: dropped as ambiguous, not given the first course', async () => {
    await writeHomonymPair();

    const result = await read(
      new Map([
        [NOTE_A, { concepts: ['Cell', 'Membrane'] }],
        [NOTE_B, { concepts: ['Cell', 'Membrane'], relations: [{ from: 'Membrane', to: 'Cell' }] }],
      ]),
    );

    expect(result.relations).toEqual([]);
    expect(result.relationsDropped).toBe(1);
  });

  it('a document in no course, whose passage sits with each identity: dropped as ambiguous', async () => {
    await writeHomonymPair();
    await write(LOOSE, '# Loose\n\nA note about cells, filed in no course.\n');

    const result = await read(
      new Map([
        [LOOSE, { concepts: ['Cell', 'Nucleus'], relations: [{ from: 'Nucleus', to: 'Cell' }] }],
      ]),
    );

    expect(result.concepts.filter((c) => c.name === 'Cell')).toHaveLength(2);
    expect(result.relations).toEqual([]);
    expect(result.relationsDropped).toBe(1);
  });
});

describe('a wording with one identity resolves as before', () => {
  it('the one record: resolved, with its key', async () => {
    await write(NOTE_A, '---\ntopic: [Cell]\n---\n\n# Life\n\nThe smallest unit.\n');
    await write(NOTE_B, '# Batteries\n\nNo topic here, but the reader proposes the wording.\n');
    const [record] = (await extractConcepts(source)).filter((c) => c.name === 'Cell');

    const result = await read(
      new Map([
        [
          NOTE_B,
          { concepts: ['Cell', 'Electrode'], relations: [{ from: 'Electrode', to: 'Cell' }] },
        ],
      ]),
    );

    expect(edges(result)).toEqual([
      {
        type: 'part-of',
        from: 'Electrode',
        to: 'Cell',
        provenance: 'model-proposed',
        confidence: 0.7,
        introducingPassages: {
          from: edges(result)[0]?.introducingPassages.from,
          to: edges(result)[0]?.introducingPassages.to,
        },
        fromKey: keyOf(result, 'Electrode'),
        toKey: record?.key,
      },
    ]);
    expect(edges(result)[0]?.introducingPassages.to.sourcePath).toBe(NOTE_B);
    expect(result.relationsDropped).toBe(0);
  });
});
