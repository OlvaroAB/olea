/**
 * `ol-egov.141.89.9.30` (`[D-357]`): `readConceptsFromVault` — the concept read behind the
 * ingestion tick's per-folder readout (`main.ts`'s `readConceptsFromVault` method) and the corpus
 * relation pass (`readConceptsAndRelations`) — keys every concept by its permanent
 * `.olea/concepts/` key by default. The corpus relation stage takes its endpoint keys from here
 * (`corpusConceptsFrom`), and the relation cache and same-as key by what that stage emits, so
 * this is what stops them carrying the content-derived stand-in. Every course code and concept
 * name below is invented (INV-3).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ConceptReaderPort,
  ConceptReadRequest,
  ConceptReadResponse,
  ProposedConcept,
  VaultPath,
} from 'olea-core';
import {
  FolderSource,
  listConceptKeyRecords,
  OPAQUE_CONCEPT_KEY_PREFIX,
  PROVISIONAL_CONCEPT_KEY_PREFIX,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  corpusConceptsFrom,
  extractConceptsFromVault,
  readConceptsFromVault,
} from '../../src/concept/wiring.js';

const LECTURE: VaultPath = '01 Courses/TESTC1/Lecture one.md';

let root: string;
let vault: FolderSource;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-read-permanent-keys-plugin-'));
  vault = new FolderSource(root);
  const full = join(root, ...LECTURE.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(
    full,
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
    'utf8',
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Proposes a concept her conventions name and one they do not, both anchored in the lecture. */
const reader: ConceptReaderPort = {
  read(request: ConceptReadRequest): Promise<ConceptReadResponse> {
    const sent = new Set(request.passages.map((p) => p.anchor.sourcePath));
    const anchor = { sourcePath: LECTURE, location: { page: 1, charRange: { start: 0, end: 10 } } };
    const concepts: ProposedConcept[] = sent.has(LECTURE)
      ? [
          { name: 'Widget theory', aliases: [], anchor, alsoIn: [] },
          { name: 'Gadget drift', aliases: [], anchor, alsoIn: [] },
        ]
      : [];
    return Promise.resolve({ concepts });
  },
};

describe('readConceptsFromVault stamps permanent concept keys by default ([D-357])', () => {
  it('every concept it returns, and so every corpus-stage candidate, carries the permanent key', async () => {
    const result = await readConceptsFromVault({ conceptReader: reader }, vault);
    if (result === null || result.outcome !== 'read') throw new Error('expected a read');

    const widget = result.concepts.find((c) => c.name === 'Widget theory');
    const gadget = result.concepts.find((c) => c.name === 'Gadget drift');
    expect(widget?.key.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    expect(gadget?.key.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);

    // The corroborated concept carries the very key extraction resolves for it — one identity
    // for the read, the review log and every reader.
    const extracted = await extractConceptsFromVault(vault, {});
    expect(widget?.key).toBe(extracted.find((c) => c.name === 'Widget theory')?.key);

    // The corpus relation stage's input carries the same keys, so its edges, the relation cache
    // and same-as do too.
    const corpusKeys = corpusConceptsFrom(result.concepts).map((c) => c.key);
    expect(corpusKeys).toContain(widget?.key);
    expect(corpusKeys).toContain(gadget?.key);
    expect(
      corpusKeys.some((key) => key?.startsWith(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:`) === true),
    ).toBe(false);
  });

  it('a second read returns the same keys and mints nothing more', async () => {
    const first = await readConceptsFromVault({ conceptReader: reader }, vault);
    const recordsAfterFirst = (await listConceptKeyRecords(vault)).length;
    const second = await readConceptsFromVault({ conceptReader: reader }, vault);
    if (first?.outcome !== 'read' || second?.outcome !== 'read') throw new Error('expected reads');

    const keysOf = (concepts: readonly { name: string; key: string }[]) =>
      Object.fromEntries(concepts.map((c) => [c.name, c.key]));
    expect(keysOf(second.concepts)).toEqual(keysOf(first.concepts));
    expect(await listConceptKeyRecords(vault)).toHaveLength(recordsAfterFirst);
  });

  it('opting out (a shared, tracked fixture) writes nothing and keeps the stand-in', async () => {
    const result = await readConceptsFromVault({ conceptReader: reader }, vault, {
      stampConceptKeys: false,
    });
    if (result === null || result.outcome !== 'read') throw new Error('expected a read');
    expect(
      result.concepts.every((c) => c.key.startsWith(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:`)),
    ).toBe(true);
    expect(await listConceptKeyRecords(vault)).toHaveLength(0);
  });
});
