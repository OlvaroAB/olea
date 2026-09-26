/**
 * `[D-378]`'s canonical lookup in `proposeSameAsForMovedNoteAnchors` (`ol-egov.141.89.9.56`): an
 * orphaned note anchor held by two same-anchor records is one identity, so it proposes one same-as
 * link (under the canonical key), never one per record; a candidate that is the orphan's own
 * superseded duplicate is not a proposal at all; and two candidates that share only an introducing
 * passage stay two concepts, each proposed on its own.
 *
 * Every fixture string is invented (INV-3).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ConceptKeyAnchor,
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  FolderSource,
  listSameAsLinkRecords,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proposeSameAsForMovedNoteAnchors } from '../../src/concept/wiring.js';

const CANONICAL = 'concept-key1:aaaa';
const DUPLICATE = 'concept-key1:bbbb';
const PASSAGE_A = 'concept-key1:eeee';
const PASSAGE_B = 'concept-key1:ffff';
const MOVED_NOTE = 'concept-key1:nnnn';

const OLD_NOTE_PATH = '05 Zettelkasten/Concept One.md';
const SHARED_INTRODUCING_NOTE = ['01 Courses/TESTC1/Week one.md'];

function conceptRecord(key: string, anchor: ConceptKeyAnchor, mintedAt: string): ConceptKeyRecord {
  return {
    key,
    tier: anchor.kind === 'note' ? 1 : 2,
    anchor,
    aliases: [],
    mintedAt,
    schemaVersion: 1,
  };
}

describe('proposeSameAsForMovedNoteAnchors resolves keys through the canonical-key index ([D-378], ol-egov.141.89.9.56)', () => {
  let root: string;
  let vault: FolderSource;

  async function seed(record: ConceptKeyRecord): Promise<void> {
    await vault.write(conceptKeyRecordPath(record.key), `${JSON.stringify(record, null, 2)}\n`);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-moved-note-canonical-'));
    vault = new FolderSource(root);
    // Two records for one uid-less note anchor (a same-anchor duplicate), whose note has moved.
    const orphan: ConceptKeyAnchor = { kind: 'note', noteUid: null, notePath: OLD_NOTE_PATH };
    await seed(conceptRecord(CANONICAL, orphan, '2026-09-01'));
    await seed(conceptRecord(DUPLICATE, orphan, '2026-09-05'));
    await vault.write('05 Zettelkasten/Folder/concept one.md', 'Invented note text, moved.');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('proposes one link for the orphaned identity, under its canonical key, not one per duplicate record', async () => {
    const proposals = await proposeSameAsForMovedNoteAnchors(vault, [
      { key: MOVED_NOTE, name: 'concept one' },
    ]);

    expect(proposals).toHaveLength(1);
    expect([proposals[0]?.keyA, proposals[0]?.keyB]).toEqual([CANONICAL, MOVED_NOTE]);
    expect(await listSameAsLinkRecords(vault)).toHaveLength(1);
  });

  it("a candidate that is the orphan's own superseded duplicate is the same identity, never a proposal", async () => {
    const proposals = await proposeSameAsForMovedNoteAnchors(vault, [
      { key: DUPLICATE, name: 'concept one' },
    ]);

    expect(proposals).toHaveLength(0);
    expect(await listSameAsLinkRecords(vault)).toHaveLength(0);
  });

  it('two candidates sharing only an introducing passage stay two concepts, each proposed on its own', async () => {
    await seed(
      conceptRecord(
        PASSAGE_A,
        {
          kind: 'topic',
          course: 'TESTC1',
          name: 'Concept one',
          aliases: [],
          introducingPaths: SHARED_INTRODUCING_NOTE,
        },
        '2026-09-02',
      ),
    );
    await seed(
      conceptRecord(
        PASSAGE_B,
        {
          kind: 'topic',
          course: 'TESTC1',
          name: 'Concept One',
          aliases: [],
          introducingPaths: SHARED_INTRODUCING_NOTE,
        },
        '2026-09-03',
      ),
    );

    const proposals = await proposeSameAsForMovedNoteAnchors(vault, [
      { key: PASSAGE_A, name: 'Concept one' },
      { key: PASSAGE_B, name: 'Concept One' },
    ]);

    expect(proposals.map((link) => [link.keyA, link.keyB])).toEqual([
      [CANONICAL, PASSAGE_A],
      [CANONICAL, PASSAGE_B],
    ]);
  });
});
