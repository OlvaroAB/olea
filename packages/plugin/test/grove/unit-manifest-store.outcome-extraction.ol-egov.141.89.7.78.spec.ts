/**
 * The durable page record's half of retire on revision (`ol-egov.141.89.7.78`, `[D-531]` B with
 * completeness rules): `outcomeRevisionPagesFor` hands the outcomes trigger the document's current
 * version, checked against the file's bytes, and `recordOutcomeExtraction` stores the per-page
 * "outcomes extracted" mark, only for the current version and only on a page read in full. Written
 * to olea-service `features/F4-oracle.md`, F4.1, the scenarios tagged with this file.
 *
 * Every string below is invented (INV-3). The extractor is injected, so a source's pages and routes
 * are chosen by the test; digests are the real content hash of the synthetic bytes.
 */
import {
  hashContent,
  stableUnitId,
  type UnitManifestEntry,
  type UnitReadingState,
  type VaultPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { unitManifestLogPath } from '../../../core/src/ingestion/unit-manifest/log.js';
import {
  parseUnitManifestLog,
  type UnitStateRecord,
} from '../../../core/src/ingestion/unit-manifest/records.js';
import {
  type OutcomeRevisionPages,
  outcomeRevisionReadInFull,
  planOutcomeDelivery,
} from '../../../core/src/outcome/retire-on-revision.js';
import {
  createVaultUnitManifestStore,
  type UnitManifestStoreDeps,
} from '../../src/grove/unit-manifest-store.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import { type EventedTestVault, eventedTestVault } from './unit-manifest-test-vault.js';

const NOW = new Date('2026-10-06T10:00:00Z');
const DAY = isoWithLocalOffset(NOW).slice(0, 10);
const DEVICE_A = 'olea-devicea0001';

const DOC = '03 Research/SYNTH101 Objectives.pdf' as VaultPath;
const V1 = 'objectives bytes, version one';
const V2 = 'objectives bytes, version two';

type Route = 'text' | 'vision' | 'furniture';

function resultOf(path: VaultPath, layout: readonly Route[]) {
  return {
    sourcePath: path,
    format: 'pdf' as const,
    outcome: 'extracted' as const,
    pages: layout.map((route, index) => ({
      page: index + 1,
      charCount: route === 'vision' ? 0 : 900,
      textLayer: route === 'vision' ? ('absent' as const) : ('readable' as const),
      route: route === 'vision' ? ('vision' as const) : ('text-layer' as const),
      units: [],
      furniture: route === 'furniture',
    })),
  };
}

function digestOf(content: string): Promise<string> {
  return hashContent(new TextEncoder().encode(content));
}

function setup(layout: readonly Route[] = ['text', 'text', 'vision']) {
  const vault = eventedTestVault({ [DOC]: V1 });
  const make = (overrides: Partial<UnitManifestStoreDeps> = {}) =>
    createVaultUnitManifestStore({
      vault,
      deviceId: DEVICE_A,
      now: () => NOW,
      extractSource: async ({ path }) => resultOf(path, layout),
      ...overrides,
    });
  return { vault, make };
}

function imageReading(promptVersion = 'v2-test'): UnitReadingState {
  return {
    kind: 'read',
    method: 'image',
    provenance: {
      task: 'vision.extract.v2',
      promptVersion,
      modelIdentity: 'synthetic-model',
      imageDigest: 'sha256-synthetic',
    },
  };
}

function reading(page: number, readingState: UnitReadingState): UnitManifestEntry {
  return {
    unitId: stableUnitId(DOC, page),
    sourcePath: DOC,
    page,
    readingState,
    conceptExtractionState: 'not-started',
  };
}

function unitRecords(vault: EventedTestVault): UnitStateRecord[] {
  const content = vault.contentOf(unitManifestLogPath(DAY, DEVICE_A)) ?? '';
  return parseUnitManifestLog(content).records.filter(
    (record): record is UnitStateRecord => record.kind === 'unit',
  );
}

function markedPages(vault: EventedTestVault, digest: string): number[] {
  return unitRecords(vault)
    .filter(
      (record) => record.revisionDigest === digest && record.outcomeExtractionState === 'complete',
    )
    .map((record) => record.page);
}

async function current(
  store: ReturnType<ReturnType<typeof setup>['make']>,
): Promise<OutcomeRevisionPages> {
  const pages = await store.outcomeRevisionPagesFor(DOC);
  if (pages === undefined) throw new Error('expected a current version');
  return pages;
}

describe("the page record answers for the file's current bytes", () => {
  it('hands the version of the bytes the file holds now, listing a replaced file afresh', async () => {
    const { vault, make } = setup();
    const store = make();
    await store.load();
    const d1 = await digestOf(V1);
    const first = await current(store);
    expect(first).toMatchObject({
      sourcePath: DOC,
      revisionDigest: d1,
      expectedPages: [1, 2, 3],
      knownRevisions: [d1],
    });
    expect(first.history.map((state) => [state.page, state.reading])).toEqual([
      [1, 'read'],
      [2, 'read'],
    ]);

    // She replaces the file; no vault event has reached the store yet.
    vault.put(DOC, V2);
    const d2 = await digestOf(V2);
    const second = await current(store);
    expect(second.revisionDigest).toBe(d2);
    expect(second.knownRevisions).toEqual([d1, d2].sort());
    const content = vault.contentOf(unitManifestLogPath(DAY, DEVICE_A)) ?? '';
    const retirements = parseUnitManifestLog(content).records.filter(
      (record) => record.kind === 'retired',
    );
    expect(retirements.map((record) => record.revisionDigest)).toEqual([d1]);
  });

  it('a file that cannot be read, or a page record that has not loaded, hands no version', async () => {
    const { vault, make } = setup();
    const unloaded = make();
    expect(await unloaded.outcomeRevisionPagesFor(DOC)).toBeUndefined();

    vault.put(unitManifestLogPath(DAY, DEVICE_A), 'x');
    const original = vault.read.bind(vault);
    vault.read = async () => {
      throw new Error('host unavailable');
    };
    const failing = make();
    await expect(failing.load()).rejects.toThrow('host unavailable');
    expect(await failing.outcomeRevisionPagesFor(DOC)).toBeUndefined();
    vault.read = original;

    const store = make();
    await store.load();
    expect(
      await store.outcomeRevisionPagesFor('03 Research/SYNTH101 Missing.pdf' as VaultPath),
    ).toBeUndefined();
    expect(await store.outcomeRevisionPagesFor('Notes/a note.md' as VaultPath)).toBeUndefined();
  });
});

describe('a mark is written only for the current version and a page read in full', () => {
  it('marks only the pages read in full, beside their reading and concept-extraction state', async () => {
    const { vault, make } = setup(['text', 'text', 'vision']);
    const store = make();
    await store.load();
    const d1 = await digestOf(V1);
    await store.recordOutcomeExtraction(DOC, d1, [1, 2, 3]);
    // Page 3 waits for its image reading: it is not read, so it cannot be marked.
    expect(markedPages(vault, d1)).toEqual([1, 2]);
    const marks = unitRecords(vault).filter(
      (record) => record.outcomeExtractionState === 'complete',
    );
    for (const record of marks) {
      expect(record.readingState).toEqual({ kind: 'read', method: 'text-layer' });
      expect(record.conceptExtractionState).toBe('not-started');
    }

    // A page already marked for its reading writes nothing again.
    const before = unitRecords(vault).length;
    await store.recordOutcomeExtraction(DOC, d1, [1, 2]);
    expect(unitRecords(vault)).toHaveLength(before);

    // A page read only in part, or whose reading failed, is not marked; read in full, it is.
    store.recordReading(
      reading(3, { kind: 'partial', method: 'image', coverage: 'the upper half' }),
    );
    await store.recordOutcomeExtraction(DOC, d1, [3]);
    store.recordReading(reading(3, { kind: 'failed', reason: 'render-failed', retryable: false }));
    await store.recordOutcomeExtraction(DOC, d1, [3]);
    expect(markedPages(vault, d1)).toEqual([1, 2]);
    store.recordReading(reading(3, imageReading()));
    await store.recordOutcomeExtraction(DOC, d1, [3]);
    expect(markedPages(vault, d1)).toEqual([1, 2, 3]);
  });

  it('marks nothing for a version that is not the current one', async () => {
    const { vault, make } = setup(['text']);
    const store = make();
    await store.load();
    const d1 = await digestOf(V1);
    await current(store);
    vault.put(DOC, V2);
    await store.recordOutcomeExtraction(DOC, d1, [1]);
    expect(markedPages(vault, d1)).toEqual([]);
    const d2 = await digestOf(V2);
    expect(markedPages(vault, d2)).toEqual([]);
    expect((await current(store)).revisionDigest).toBe(d2);
  });
});

describe('a mark counts only for the reading it was made over', () => {
  it('survives the same reading and a concept pass; a different reading clears it', async () => {
    const { make } = setup(['text', 'vision']);
    const store = make();
    await store.load();
    const d1 = await digestOf(V1);
    store.recordReading(reading(2, imageReading('v2-test')));
    await store.recordOutcomeExtraction(DOC, d1, [1, 2]);
    const marksOf = async () =>
      (await store.manifestsFor([DOC]))
        .get(DOC)
        ?.entries.map((entry) => entry.outcomeExtractionState);
    expect(await marksOf()).toEqual(['complete', 'complete']);

    // The same reading recorded again, and concept extraction over the text page, keep the marks.
    store.recordReading(reading(2, imageReading('v2-test')));
    await store.recordConceptExtraction([DOC]);
    const manifest = (await store.manifestsFor([DOC])).get(DOC);
    expect(manifest?.entries[0]).toMatchObject({
      conceptExtractionState: 'complete',
      outcomeExtractionState: 'complete',
    });
    expect(await marksOf()).toEqual(['complete', 'complete']);

    // A different reading of page 2 lands: no longer marked, until a delivery extracts it.
    store.recordReading(reading(2, imageReading('v3-test')));
    await store.idle();
    expect(await marksOf()).toEqual(['complete', undefined]);
    await store.recordOutcomeExtraction(DOC, d1, [2]);
    expect(await marksOf()).toEqual(['complete', 'complete']);
  });
});

describe('a version is read in full once every page is read and extracted, and only then', () => {
  it('two text pages and one page read from its image', async () => {
    const { make } = setup(['text', 'text', 'vision']);
    const store = make();
    await store.load();
    const d1 = await digestOf(V1);
    expect(planOutcomeDelivery(await current(store), d1).standing).toBe('open');
    await store.recordOutcomeExtraction(DOC, d1, [1, 2]);
    expect(outcomeRevisionReadInFull(await current(store))).toBe(false);
    store.recordReading(reading(3, imageReading()));
    expect(outcomeRevisionReadInFull(await current(store))).toBe(false);
    await store.recordOutcomeExtraction(DOC, d1, [3]);
    expect(outcomeRevisionReadInFull(await current(store))).toBe(true);
    expect(planOutcomeDelivery(await current(store), d1).standing).toBe('reread');
  });

  it('with one page not read, failed or read only in part, never', async () => {
    const states: readonly (UnitReadingState | null)[] = [
      null,
      { kind: 'failed', reason: 'render-failed', retryable: false },
      { kind: 'unavailable' },
      { kind: 'partial', method: 'image', coverage: 'the left column' },
      { kind: 'unreadable', reason: 'not-legible' },
    ];
    for (const state of states) {
      const { make } = setup(['text', 'text', 'vision']);
      const store = make();
      await store.load();
      const d1 = await digestOf(V1);
      if (state !== null) store.recordReading(reading(3, state));
      await store.recordOutcomeExtraction(DOC, d1, [1, 2, 3]);
      expect(outcomeRevisionReadInFull(await current(store)), JSON.stringify(state)).toBe(false);
    }
  });

  it('a page found blank needs no extraction; a page with no text on it neither', async () => {
    const { make } = setup(['text', 'furniture', 'vision']);
    const store = make();
    await store.load();
    const d1 = await digestOf(V1);
    store.recordReading(reading(3, { kind: 'unreadable', reason: 'blank-page' }));
    await store.recordOutcomeExtraction(DOC, d1, [1]);
    expect(outcomeRevisionReadInFull(await current(store))).toBe(true);
  });
});

describe('a duplicate or late delivery never undoes a completed version', () => {
  it('a different reading after completion, and a mark asked for the older version', async () => {
    const { vault, make } = setup(['text', 'vision']);
    const store = make();
    await store.load();
    const d1 = await digestOf(V1);
    await current(store);
    vault.put(DOC, V2);
    const d2 = await digestOf(V2);
    expect((await current(store)).revisionDigest).toBe(d2);
    store.recordReading(reading(2, imageReading()));
    await store.recordOutcomeExtraction(DOC, d2, [1, 2]);
    expect(outcomeRevisionReadInFull(await current(store))).toBe(true);

    store.recordReading(
      reading(2, { kind: 'failed', reason: 'malformed-response-twice', retryable: true }),
    );
    const unitsBefore = unitRecords(vault).filter((record) => record.revisionDigest === d1).length;
    await store.recordOutcomeExtraction(DOC, d1, [1, 2]);
    expect(unitRecords(vault).filter((record) => record.revisionDigest === d1)).toHaveLength(
      unitsBefore,
    );
    const after = await current(store);
    expect(after.revisionDigest).toBe(d2);
    expect(outcomeRevisionReadInFull(after)).toBe(true);
    expect(planOutcomeDelivery(after, d1).standing).toBe('late');
    expect(planOutcomeDelivery(after, d2).standing).toBe('reread');
  });
});

describe('a reload keeps the marks', () => {
  it('the version still counts as read in full, from the stored records alone', async () => {
    const { vault, make } = setup(['text', 'vision']);
    const first = make();
    await first.load();
    const d1 = await digestOf(V1);
    first.recordReading(reading(2, imageReading()));
    await first.recordOutcomeExtraction(DOC, d1, [1]);
    await first.idle();

    // The app reloads mid-version: the second page's extraction lands in a fresh session.
    const second = make();
    await second.load();
    const reloaded = await current(second);
    expect(reloaded.history.filter((state) => state.outcomesExtracted).map((s) => s.page)).toEqual([
      1,
    ]);
    expect(outcomeRevisionReadInFull(reloaded)).toBe(false);
    await second.recordOutcomeExtraction(DOC, d1, [2]);

    const third = make();
    await third.load();
    expect(outcomeRevisionReadInFull(await current(third))).toBe(true);
    expect(vault.paths().filter((path) => !path.startsWith('.olea/unit-manifests/'))).toEqual([
      DOC,
    ]);
  });

  it('a mark whose write fails is not folded: the page reads as not extracted, and the caller is told', async () => {
    const { vault, make } = setup(['text']);
    const store = make();
    await store.load();
    const d1 = await digestOf(V1);
    await current(store);
    vault.failWrites = true;
    await expect(store.recordOutcomeExtraction(DOC, d1, [1])).rejects.toThrow('write refused');
    vault.failWrites = false;
    expect(markedPages(vault, d1)).toEqual([]);
    expect(outcomeRevisionReadInFull(await current(store))).toBe(false);
  });
});
