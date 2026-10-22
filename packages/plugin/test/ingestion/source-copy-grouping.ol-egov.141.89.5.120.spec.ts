// ol-egov.141.89.5.120 (D-577): byte-identical copies of any source count once wherever a rule reads
// how many sources support a concept. Grouped in memory from the bytes, names ignored. Synthetic text only.
import {
  countPassagesByTeachingEvent,
  type Provenance,
  readConceptExtent,
  readConceptSize,
  type VaultPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type ResolvedLinksPort,
  readLectureBundles,
  readTextCopyGroups,
  teachingEventResolverFrom,
} from '../../src/ingestion/lecture-links.js';
import { MemoryVault } from './materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const N1 = '01 Courses/COURSEA/notes/reeds.md';
const N2 = '02 Archive/a duplicate of the reeds page.md';
const N3 = '01 Courses/COURSEA/notes/another page.md';
const BODY =
  '# Reeds\n\nInvented paragraph about reed beds and tides.\n\nA second invented paragraph.\n';

const noLinks: ResolvedLinksPort = {
  resolvedLinks: () => new Map(),
  frontmatterFor: () => undefined,
};

const at = (sourcePath: string, start = 0): Provenance => ({
  sourcePath: sourcePath as VaultPath,
  location: { page: 1, charRange: { start, end: start + 20 } },
});

async function resolverFor(vault: MemoryVault, port: ResolvedLinksPort = noLinks) {
  return teachingEventResolverFrom(readLectureBundles(port), await readTextCopyGroups(vault));
}

describe('byte-identical copies of a source that is not a transcript, ol-egov.141.89.5.120', () => {
  it('ol-egov.141.89.5.120 two copies of a note under different names count once; a third, different note counts again', async () => {
    const vault = new MemoryVault();
    vault.files.set(N1, BODY);
    vault.files.set(N2, BODY);
    vault.files.set(N3, `${BODY}One more invented line.\n`);
    const of = await resolverFor(vault);
    expect(countPassagesByTeachingEvent([at(N1), at(N2)], of)).toBe(1);
    expect(countPassagesByTeachingEvent([at(N1, 0), at(N2, 0), at(N1, 30), at(N2, 30)], of)).toBe(
      2,
    );
    expect(countPassagesByTeachingEvent([at(N1), at(N2), at(N3)], of)).toBe(2);
    expect(countPassagesByTeachingEvent([at(N1), at(N2)], undefined)).toBe(2);
  });

  it('ol-egov.141.89.5.120 concept size, extent, and the note count read the copies as one', async () => {
    const vault = new MemoryVault();
    vault.files.set(N1, BODY);
    vault.files.set(N2, BODY);
    vault.files.set(N3, 'A different invented page.\n');
    const of = await resolverFor(vault);
    const one = readConceptSize({
      anchor: at(N1),
      alsoIn: [],
      sourcePaths: [],
      teachingEventOf: of,
    });
    const copies = readConceptSize({
      anchor: at(N1),
      alsoIn: [at(N2)],
      sourcePaths: [N2 as VaultPath],
      teachingEventOf: of,
    });
    expect(copies).toEqual(one);
    const extent = readConceptExtent({
      anchor: at(N1),
      alsoIn: [at(N2), at(N3)],
      sourcePaths: [],
      teachingEventOf: of,
    });
    expect(extent.passageCount).toBe(2);
    expect(extent.noteCount).toBe(2);
  });

  it('ol-egov.141.89.5.120 each copy keeps its own path and citations; nothing is written', async () => {
    const vault = new MemoryVault();
    vault.files.set(N1, BODY);
    vault.files.set(N2, BODY);
    const before = vault.snapshot();
    const passages = [at(N1, 5), at(N2, 5)];
    const frozen = JSON.stringify(passages);
    const of = await resolverFor(vault);
    countPassagesByTeachingEvent(passages, of);
    expect(JSON.stringify(passages)).toBe(frozen);
    expect(passages.map((p) => p.sourcePath)).toEqual([N1, N2]);
    expect(vault.snapshot()).toEqual(before);
  });

  it('ol-egov.141.89.5.120 an identical passage inside otherwise different sources merges nothing', async () => {
    const shared = 'A shared invented paragraph about marsh tides.\n';
    const vault = new MemoryVault();
    vault.files.set(N1, `${shared}Only in the first.\n`);
    vault.files.set(N3, `Only in the second.\n${shared}`);
    const of = await resolverFor(vault);
    expect(countPassagesByTeachingEvent([at(N1), at(N3)], of)).toBe(2);
    expect(
      readConceptExtent({ anchor: at(N1), alsoIn: [at(N3)], sourcePaths: [], teachingEventOf: of })
        .noteCount,
    ).toBe(2);
  });

  it('ol-egov.141.89.5.120 a one-character difference counts twice', async () => {
    const vault = new MemoryVault();
    vault.files.set(N1, BODY);
    vault.files.set(N2, BODY.replace('reed', 'reeds'));
    const of = await resolverFor(vault);
    expect(countPassagesByTeachingEvent([at(N1), at(N2)], of)).toBe(2);
  });
});
