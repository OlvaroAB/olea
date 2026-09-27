/**
 * `ol-egov.141.89.3.20` (`[D-402]`): `extractConceptsWithAnchors` passes its `coursesFolder` on to
 * `foldReadAnchors`, so a wording split by course folds each passage by the same courses folder
 * the extraction used. Before, the fold always read the default folder: with any other folder,
 * every passage read as coming from no course and folded onto every identity of the wording.
 * Course codes and wording are placeholders.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderSource, type Provenance, type ReadConcept, readConceptSize } from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractConceptsWithAnchors } from '../../src/concept/wiring.js';

let root: string;
let source: FolderSource;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'olea-anchors-courses-folder-'));
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

const FOLDER = 'Study/Courses';
const NOTE_A = `${FOLDER}/COURSEA/Life.md`;
const NOTE_B = `${FOLDER}/COURSEB/Batteries.md`;

function anchorIn(path: string): Provenance {
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

describe('extractConceptsWithAnchors reads the same courses folder for the fold ([D-402])', () => {
  it("each course identity takes only its own course's passages under a non-default courses folder", async () => {
    await write(NOTE_A, '---\ntopic: [Cell]\n---\n\n# Life\n');
    await write(NOTE_B, '---\ntopic: [Cell]\n---\n\n# Batteries\n');

    const records = (
      await extractConceptsWithAnchors(source, [readCell(anchorIn(NOTE_A), [anchorIn(NOTE_B)])], {
        coursesFolder: FOLDER,
        stampConceptKeys: false,
      })
    ).filter((r) => r.name === 'Cell');

    expect(records.map((r) => r.courses)).toEqual([['COURSEA'], ['COURSEB']]);
    expect(
      records.map((r) => [r.anchor?.sourcePath, ...(r.alsoIn ?? []).map((p) => p.sourcePath)]),
    ).toEqual([[NOTE_A], [NOTE_B]]);
  });
});
