// ol-egov.141.89.5.101 (D-565): byte-identical lecture transcripts are one teaching event, computed
// in memory from their bytes. Synthetic text only.
import {
  countPassagesByTeachingEvent,
  type Provenance,
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

const A = '01 Courses/COURSEA/Lecture 1/export one.txt';
const B = '02 Archive/copy of the talk.txt';
const NOTE = '01 Courses/COURSEA/notes/an idea.md';
const TEXT = 'Invented lecture about marsh birds.\nA second invented line about reeds.\n';

const noLinks: ResolvedLinksPort = {
  resolvedLinks: () => new Map(),
  frontmatterFor: () => undefined,
};

const note: Provenance = {
  sourcePath: NOTE as VaultPath,
  location: { page: 1, charRange: { start: 0, end: 10 } },
};
const part = (sourcePath: string, n = 1): Provenance => ({
  sourcePath: sourcePath as VaultPath,
  location: { page: n, charRange: { start: 0, end: 10 }, transcriptPart: {} },
});

async function resolverFor(vault: MemoryVault, port: ResolvedLinksPort = noLinks) {
  return teachingEventResolverFrom(readLectureBundles(port), await readTextCopyGroups(vault));
}

describe('byte-identical transcript copies, ol-egov.141.89.5.101', () => {
  it('ol-egov.141.89.5.101 two byte-identical unlinked copies with different names count once', async () => {
    const vault = new MemoryVault();
    vault.files.set(A, TEXT);
    vault.files.set(B, TEXT);
    const of = await resolverFor(vault);
    expect(countPassagesByTeachingEvent([part(A), part(B)], of)).toBe(1);
    expect(countPassagesByTeachingEvent([note, part(A), part(B)], of)).toBe(2);
    expect(countPassagesByTeachingEvent([part(A), part(B)], undefined)).toBe(2);
  });

  it('ol-egov.141.89.5.101 a one-character difference counts twice', async () => {
    const vault = new MemoryVault();
    vault.files.set(A, TEXT);
    vault.files.set(B, TEXT.replace('marsh', 'marshes'));
    const of = await resolverFor(vault);
    expect(countPassagesByTeachingEvent([part(A), part(B)], of)).toBe(2);
  });

  it('ol-egov.141.89.5.101 two different lectures sharing an identical passage count twice', async () => {
    const shared = 'A shared invented paragraph about tides.\n';
    const vault = new MemoryVault();
    vault.files.set(A, `${shared}Only in the first.\n`);
    vault.files.set(B, `Only in the second.\n${shared}`);
    const of = await resolverFor(vault);
    expect(countPassagesByTeachingEvent([part(A), part(B)], of)).toBe(2);
  });

  it('ol-egov.141.89.5.101 each copy keeps its own path and citations; the grouping is not persisted', async () => {
    const vault = new MemoryVault();
    vault.files.set(A, TEXT);
    vault.files.set(B, TEXT);
    const before = vault.snapshot();
    const passages = [part(A, 2), part(B, 2)];
    const frozen = JSON.stringify(passages);
    const of = await resolverFor(vault);
    countPassagesByTeachingEvent(passages, of);
    expect(JSON.stringify(passages)).toBe(frozen);
    expect(passages.map((p) => p.sourcePath)).toEqual([A, B]);
    expect(vault.snapshot()).toEqual(before);
  });

  it('ol-egov.141.89.5.101 independent support counts the copies as one (concept size and the same-event test)', async () => {
    const vault = new MemoryVault();
    vault.files.set(A, TEXT);
    vault.files.set(B, TEXT);
    const of = await resolverFor(vault);
    const one = readConceptSize({
      anchor: note,
      alsoIn: [part(A)],
      sourcePaths: [],
      teachingEventOf: of,
    });
    const two = readConceptSize({
      anchor: note,
      alsoIn: [part(A), part(B)],
      sourcePaths: [],
      teachingEventOf: of,
    });
    expect(two).toEqual(one);
    // The same-event restatement test in corpusRelationSignals compares these two event ids.
    expect(of(A as VaultPath)).toBeDefined();
    expect(of(A as VaultPath)).toBe(of(B as VaultPath));
  });

  it('ol-egov.141.89.5.101 a copy of a bundled file joins that bundle; two bundles are not merged', async () => {
    const vault = new MemoryVault();
    const DECK = '01 Courses/COURSEA/Lecture 1/slides.pdf';
    const LINKER = '01 Courses/COURSEA/Lecture 1/home.md';
    vault.files.set(A, TEXT);
    vault.files.set(B, TEXT);
    vault.files.set(LINKER, '[[export one.txt]] [[slides.pdf]]');
    vault.binaries.set(DECK, new Uint8Array([1, 2, 3]));
    const port: ResolvedLinksPort = {
      resolvedLinks: () => new Map([[LINKER as VaultPath, [A as VaultPath, DECK as VaultPath]]]),
      frontmatterFor: () => undefined,
    };
    const of = await resolverFor(vault, port);
    expect(of(B as VaultPath)).toBe(of(A as VaultPath));
    expect(of(A as VaultPath)).toBe(of(DECK as VaultPath));
    // A transcript restating the bundle's deck adds nothing, the copy included.
    expect(countPassagesByTeachingEvent([part(DECK, 1), part(A), part(B)], of)).toBe(1 + 0);
  });
});
