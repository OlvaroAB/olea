/**
 * `ol-egov.141.89.9.30` (`[D-357]`): a stamped concept read keys every concept it returns by the
 * permanent `.olea/concepts/` key — a corroborated concept by the key its record resolves, an
 * uncorroborated one by a key the store resolves on a topic anchor (the first course its passages
 * sit in, and its name). The corpus relation stage and same-as key by `ReadConcept.key`, so this
 * is what stops them carrying the content-derived stand-in. Every course code and concept name
 * below is invented (INV-3).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Provenance } from '../extract/types.js';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import { OPAQUE_CONCEPT_KEY_PREFIX, PROVISIONAL_CONCEPT_KEY_PREFIX } from './concept-key.js';
import { extractConcepts } from './extract.js';
import { listConceptKeyRecords } from './key-store.js';
import {
  type ConceptReaderPort,
  type ConceptReadRequest,
  type ConceptReadResponse,
  type ProposedConcept,
  readConcepts,
} from './read.js';

const LECTURE = '01 Courses/TESTC1/Lecture one.md';
const BUDGET = { maxPassages: 100 };

let root: string;
let source: FolderSource;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-read-permanent-keys-'));
  source = new FolderSource(root);
  await write(
    LECTURE,
    [
      '---',
      'topic: [Widget theory]',
      'course: TESTC1',
      '---',
      '',
      '# Lecture one',
      '',
      'Widget theory explains the settling. Gadget drift follows from it.',
      '',
    ].join('\n'),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(relPath: string, content: string): Promise<void> {
  const full = join(root, ...relPath.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf8');
}

function anchorIn(path: VaultPath): Provenance {
  return { sourcePath: path, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

/** Proposes both concepts for any call that was sent the lecture. */
class ScriptedReader implements ConceptReaderPort {
  read(request: ConceptReadRequest): Promise<ConceptReadResponse> {
    const sent = new Set(request.passages.map((p) => p.anchor.sourcePath));
    const concepts: ProposedConcept[] = sent.has(LECTURE)
      ? [
          { name: 'Widget theory', aliases: [], anchor: anchorIn(LECTURE), alsoIn: [] },
          { name: 'Gadget drift', aliases: [], anchor: anchorIn(LECTURE), alsoIn: [] },
        ]
      : [];
    return Promise.resolve({ concepts });
  }
}

async function keyOf(name: string, stampConceptKeys: boolean): Promise<string | undefined> {
  const result = await readConcepts(source, new ScriptedReader(), {
    budget: BUDGET,
    stampConceptKeys,
  });
  if (result.outcome !== 'read') throw new Error(`expected a read, got ${result.outcome}`);
  return result.concepts.find((c) => c.name === name)?.key;
}

describe('readConcepts keys every concept by the permanent key when stamped ([D-357])', () => {
  it('a corroborated concept carries the permanent key its record resolves', async () => {
    const key = await keyOf('Widget theory', true);
    const recordKey = (await extractConcepts(source, { stampConceptKeys: true })).find(
      (c) => c.name === 'Widget theory',
    )?.key;
    expect(key?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    expect(key).toBe(recordKey);
  });

  it('an uncorroborated concept gets a permanent key on a topic anchor (passage course, name), and keeps it', async () => {
    const first = await keyOf('Gadget drift', true);
    const second = await keyOf('Gadget drift', true);
    expect(first?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    expect(second).toBe(first);

    const record = (await listConceptKeyRecords(source)).find((r) => r.record.key === first);
    expect(record?.record.tier).toBe(3);
    expect(record?.record.anchor).toEqual({
      kind: 'topic',
      course: 'TESTC1',
      name: 'Gadget drift',
      aliases: [],
      introducingPaths: [LECTURE],
    });
  });

  it('a concept her conventions later name converges on the key the read gave it', async () => {
    const readKey = await keyOf('Gadget drift', true);
    await write(
      '01 Courses/TESTC1/Lecture two.md',
      '---\ntopic: [Gadget drift]\ncourse: TESTC1\n---\n\nFront::Back\n',
    );
    const recordKey = (await extractConcepts(source, { stampConceptKeys: true })).find(
      (c) => c.name === 'Gadget drift',
    )?.key;
    expect(recordKey).toBe(readKey);
  });

  it('two reads meeting one new concept at once agree on its key and leave one record for it', async () => {
    const [a, b] = await Promise.all([keyOf('Gadget drift', true), keyOf('Gadget drift', true)]);
    expect(b).toBe(a);
    const gadgetRecords = (await listConceptKeyRecords(source)).filter(
      (r) => r.record.anchor.kind === 'topic' && r.record.anchor.name === 'Gadget drift',
    );
    expect(gadgetRecords).toHaveLength(1);
  });

  it('unstamped, the read writes nothing and keeps the stand-in key (a call over a shared fixture)', async () => {
    const key = await keyOf('Gadget drift', false);
    expect(key?.startsWith(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    expect(await listConceptKeyRecords(source)).toHaveLength(0);
  });
});
