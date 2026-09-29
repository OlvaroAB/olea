/**
 * The durable unit manifest store (`[D-445]`, ruled 2026-09-29, row 26 of the decision sheet;
 * `ol-egov.141.89.8.43`), against the ruling: append-only per-device records, separate reading and
 * extraction states, explicit revision retirement, unread or pending units unknown and never absent,
 * and a rebuild after deletion that never shows false completeness.
 *
 * Every string below is invented (INV-3); nothing here is drawn from a real vault. The extractor is
 * injected, so a source's pages and routes are chosen by the test; one suite at the end runs the
 * real extractors over synthetic bytes to prove the default path is wired.
 */
import {
  absenceGroundingFor,
  hasPendingUnits,
  isFullyRead,
  stableUnitId,
  type UnitManifest,
  type UnitManifestEntry,
  type UnitReadingState,
  type VaultPath,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { unitManifestLogPath } from '../../../core/src/ingestion/unit-manifest/log.js';
import {
  parseUnitManifestLog,
  serialiseUnitManifestRecord,
} from '../../../core/src/ingestion/unit-manifest/records.js';
import {
  createVaultUnitManifestStore,
  type UnitManifestStoreDeps,
} from '../../src/grove/unit-manifest-store.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import { type EventedTestVault, eventedTestVault } from './unit-manifest-test-vault.js';

const NOW = new Date('2026-09-29T10:00:00Z');
const DAY = isoWithLocalOffset(NOW).slice(0, 10);
const DEVICE_A = 'olea-devicea0001';
const DEVICE_B = 'olea-deviceb0002';
const FOLDER = '.olea/unit-manifests/';

const DECK = '03 Research/SYNTH101 Deck.pdf' as VaultPath;
const NOTES = '03 Research/SYNTH101 Notes.pdf' as VaultPath;
const SCAN = '03 Research/SYNTH101 Scan.png' as VaultPath;
const BLANK = '03 Research/SYNTH101 Blank.docx' as VaultPath;

type Route = 'text' | 'vision' | 'both' | 'furniture';
type Layout = readonly Route[] | 'empty' | 'broken';

function resultOf(path: VaultPath, layout: Layout) {
  if (layout === 'broken') {
    return { sourcePath: path, format: 'pdf' as const, outcome: 'unreadable' as const, pages: [] };
  }
  if (layout === 'empty') {
    return {
      sourcePath: path,
      format: 'pdf' as const,
      outcome: 'empty-document' as const,
      pages: [],
    };
  }
  return {
    sourcePath: path,
    format: 'pdf' as const,
    outcome: 'extracted' as const,
    pages: layout.map((route, index) => ({
      page: index + 1,
      charCount: route === 'vision' ? 0 : 900,
      textLayer: route === 'vision' ? ('absent' as const) : ('readable' as const),
      route: route === 'text' || route === 'furniture' ? ('text-layer' as const) : route,
      units: [],
      furniture: route === 'furniture',
    })),
  };
}

interface Harness {
  readonly vault: EventedTestVault;
  readonly layouts: Map<VaultPath, Layout>;
  readonly extractions: VaultPath[];
  make(overrides?: Partial<UnitManifestStoreDeps>): ReturnType<typeof createVaultUnitManifestStore>;
}

function harness(
  files: Record<string, string | Uint8Array> = {},
  vault: EventedTestVault = eventedTestVault(files),
  layouts: Map<VaultPath, Layout> = new Map(),
): Harness {
  const extractions: VaultPath[] = [];
  return {
    vault,
    layouts,
    extractions,
    make(overrides = {}) {
      return createVaultUnitManifestStore({
        vault,
        deviceId: DEVICE_A,
        now: () => NOW,
        extractSource: async ({ path }) => {
          extractions.push(path);
          return resultOf(path, layouts.get(path) ?? 'broken');
        },
        ...overrides,
      });
    },
  };
}

const SOURCES = {
  [DECK]: 'deck bytes, revision one',
  [NOTES]: 'notes bytes, revision one',
  [SCAN]: 'scan bytes, revision one',
  [BLANK]: 'blank bytes, revision one',
};

function ready(layouts: [VaultPath, Layout][] = [[DECK, ['text', 'text', 'vision']]]): Harness {
  const h = harness({ ...SOURCES });
  for (const [path, layout] of layouts) h.layouts.set(path, layout);
  return h;
}

async function manifestOf(
  store: ReturnType<Harness['make']>,
  path: VaultPath,
): Promise<UnitManifest> {
  const manifest = (await store.manifestsFor([path])).get(path);
  if (manifest === undefined) throw new Error(`expected a manifest for ${path}`);
  return manifest;
}

const IMAGE_READING: UnitReadingState = {
  kind: 'read',
  method: 'image',
  provenance: {
    task: 'vision.extract',
    promptVersion: 'v2-test',
    modelIdentity: 'synthetic-model',
    imageDigest: 'sha256-synthetic',
  },
};

function reading(path: VaultPath, page: number, readingState: UnitReadingState): UnitManifestEntry {
  return {
    unitId: stableUnitId(path, page),
    sourcePath: path,
    page,
    readingState,
    conceptExtractionState: 'not-started',
  };
}

function logLines(vault: EventedTestVault, device = DEVICE_A): string {
  return vault.contentOf(unitManifestLogPath(DAY, device)) ?? '';
}

function kinds(vault: EventedTestVault, device = DEVICE_A): string[] {
  return parseUnitManifestLog(logLines(vault, device)).records.map((r) => r.kind);
}

describe('a store with nothing behind it (INV-5)', () => {
  it('an empty vault loads to no manifests and writes nothing', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    expect(store.isLoaded()).toBe(true);
    expect(store.manifests().size).toBe(0);
    expect(h.vault.writes).toEqual([]);
  });

  it('a path no extractor claims is not a manifest-able source: it is omitted, and never enumerated', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    const got = await store.manifestsFor(['Notes/lecture.md' as VaultPath, DECK]);
    expect([...got.keys()]).toEqual([DECK]);
    expect(h.extractions).toEqual([DECK]);
  });
});

describe('unread or pending units are unknown, never absent', () => {
  it('a store that has not finished loading answers unknown for every source, and writes nothing', async () => {
    const h = ready();
    const store = h.make();
    const got = await store.manifestsFor([DECK, SCAN]);
    for (const path of [DECK, SCAN]) {
      const manifest = got.get(path) as UnitManifest;
      expect(hasPendingUnits(manifest)).toBe(true);
      expect(isFullyRead(manifest)).toBe(false);
    }
    expect(h.extractions).toEqual([]);
    expect(h.vault.writes).toEqual([]);
  });

  it('a read that arrives while the files are still loading waits for them, then answers from them', async () => {
    const h = ready();
    const first = h.make();
    await first.load();
    await manifestOf(first, DECK);
    first.recordReading(reading(DECK, 3, IMAGE_READING));
    await first.idle();

    const second = h.make({ deviceId: DEVICE_B });
    const loading = second.load();
    const got = await second.manifestsFor([DECK]);
    await loading;
    expect(isFullyRead(got.get(DECK) as UnitManifest)).toBe(true);
  });

  it('enumeration names every page: the vision page reads pending, in the manifest, not missing from it', async () => {
    const h = ready([[DECK, ['text', 'vision', 'both', 'text']]]);
    const store = h.make();
    await store.load();
    const manifest = await manifestOf(store, DECK);
    expect(manifest.entries.map((e) => [e.page, e.readingState.kind])).toEqual([
      [1, 'read'],
      [2, 'pending'],
      [3, 'pending'],
      [4, 'read'],
    ]);
    expect(isFullyRead(manifest)).toBe(false);
    expect(manifest.entries.map((e) => absenceGroundingFor(e))).toEqual([
      'groundable',
      'unknown',
      'unknown',
      'groundable',
    ]);
  });

  it('a page the text layer read carries no model provenance; a page nothing has read carries no state at all until one lands', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    const records = parseUnitManifestLog(logLines(h.vault)).records;
    const units = records.filter((r) => r.kind === 'unit');
    expect(units.map((r) => r.kind === 'unit' && r.page)).toEqual([1, 2]);
    for (const unit of units) {
      expect(unit.kind === 'unit' && unit.readingState).toEqual({
        kind: 'read',
        method: 'text-layer',
      });
    }
  });

  it('a furniture page reads as a finished read that found no text, not as content', async () => {
    const h = ready([[DECK, ['furniture', 'furniture']]]);
    const store = h.make();
    await store.load();
    const manifest = await manifestOf(store, DECK);
    expect(manifest.entries.map((e) => e.readingState)).toEqual([
      { kind: 'unreadable', reason: 'no-text-on-page' },
      { kind: 'unreadable', reason: 'no-text-on-page' },
    ]);
    expect(isFullyRead(manifest)).toBe(true);
  });
});

describe('pending is not empty', () => {
  it('an empty document is a known, empty manifest; a source the pass could not enumerate is left out, not called empty', async () => {
    const h = ready([
      [BLANK, 'empty'],
      [NOTES, 'broken'],
    ]);
    const store = h.make();
    await store.load();
    const got = await store.manifestsFor([BLANK, NOTES]);
    expect(got.get(BLANK)?.entries).toEqual([]);
    expect(got.has(NOTES)).toBe(false);
    // Nothing was recorded for the source that could not be enumerated: it is not "empty", it is unread.
    const written = parseUnitManifestLog(logLines(h.vault)).records;
    expect(written.every((r) => r.sourcePath === BLANK)).toBe(true);
  });

  it('a source that could not be enumerated is not retried within the session until it changes', async () => {
    const h = ready([[NOTES, 'broken']]);
    const store = h.make();
    await store.load();
    await store.manifestsFor([NOTES]);
    await store.manifestsFor([NOTES]);
    expect(h.extractions).toEqual([NOTES]);

    h.vault.put(NOTES, 'notes bytes, mended');
    h.layouts.set(NOTES, ['text']);
    store.observe({ kind: 'modify', path: NOTES });
    const again = await store.manifestsFor([NOTES]);
    expect(again.get(NOTES)?.entries.map((e) => e.readingState.kind)).toEqual(['read']);
  });
});

describe('append-only, and never outside her own layer', () => {
  it('enumerating writes only under .olea/unit-manifests, and never touches a source byte', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    expect(h.vault.writes.length).toBeGreaterThan(0);
    for (const path of h.vault.writes) expect(path.startsWith(FOLDER)).toBe(true);
    expect(h.vault.contentOf(DECK)).toBe(SOURCES[DECK]);
  });

  it('each later write keeps every earlier byte and adds only its own lines', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    const before = logLines(h.vault);

    store.recordReading(reading(DECK, 3, IMAGE_READING));
    await store.idle();
    const after = logLines(h.vault);

    expect(after.startsWith(before)).toBe(true);
    expect(parseUnitManifestLog(after.slice(before.length)).records).toHaveLength(1);
  });

  it('what it wrote parses back and re-serialises to the identical bytes (INV-2)', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    store.recordReading(reading(DECK, 3, IMAGE_READING));
    await store.recordConceptExtraction([DECK]);
    await store.idle();

    const file = logLines(h.vault);
    const parsed = parseUnitManifestLog(file);
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records.map(serialiseUnitManifestRecord).join('')).toBe(file);
  });

  it('a later state for a page supersedes the earlier in the projection while both stay on disk', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    store.recordReading(reading(DECK, 3, { kind: 'unavailable' }));
    store.recordReading(reading(DECK, 3, IMAGE_READING));
    await store.idle();

    const page3 = parseUnitManifestLog(logLines(h.vault)).records.filter(
      (r) => r.kind === 'unit' && r.page === 3,
    );
    expect(page3).toHaveLength(2);
    const manifest = (store.manifests().get(DECK) as UnitManifest).entries[2];
    expect(manifest?.readingState.kind).toBe('read');
  });
});

describe('reading and extraction are separate states', () => {
  it('a vision reading lands as read and leaves extraction not started', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    store.recordReading(reading(DECK, 3, IMAGE_READING));
    await store.idle();
    const manifest = store.manifests().get(DECK) as UnitManifest;
    expect(isFullyRead(manifest)).toBe(true);
    expect(manifest.entries.every((e) => e.conceptExtractionState === 'not-started')).toBe(true);
  });

  it('extraction is marked only on units the text layer read, and only for the sources asked about', async () => {
    const h = ready([
      [DECK, ['text', 'text', 'vision']],
      [NOTES, ['text']],
    ]);
    const store = h.make();
    await store.load();
    await store.manifestsFor([DECK, NOTES]);
    store.recordReading(reading(DECK, 3, IMAGE_READING));
    await store.recordConceptExtraction([DECK]);
    await store.idle();

    const deck = store.manifests().get(DECK) as UnitManifest;
    expect(deck.entries.map((e) => e.conceptExtractionState)).toEqual([
      'complete',
      'complete',
      // The concept read pass reads the text layer; it never read this page's image.
      'not-started',
    ]);
    // Reading is untouched by marking extraction.
    expect(deck.entries.map((e) => e.readingState.kind)).toEqual(['read', 'read', 'read']);
    const notes = store.manifests().get(NOTES) as UnitManifest;
    expect(notes.entries.map((e) => e.conceptExtractionState)).toEqual(['not-started']);
  });

  it('marking extraction twice writes it once', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    await store.recordConceptExtraction([DECK]);
    const written = h.vault.writes.length;
    await store.recordConceptExtraction([DECK]);
    expect(h.vault.writes.length).toBe(written);
  });

  it('marking a page that is still pending writes nothing: there is no read material for extraction to have run over', async () => {
    const h = ready([[DECK, ['vision', 'vision']]]);
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    const written = h.vault.writes.length;
    await store.recordConceptExtraction([DECK]);
    expect(h.vault.writes.length).toBe(written);
  });

  it('a reading that changes resets extraction for that unit: it ran over the earlier reading, not this one', async () => {
    const h = ready([[DECK, ['text', 'vision']]]);
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    await store.recordConceptExtraction([DECK]);
    expect((store.manifests().get(DECK) as UnitManifest).entries[0]?.conceptExtractionState).toBe(
      'complete',
    );

    store.recordReading(reading(DECK, 1, IMAGE_READING));
    await store.idle();

    const page1 = (store.manifests().get(DECK) as UnitManifest).entries[0];
    expect(page1?.readingState.kind).toBe('read');
    expect(page1?.readingState).toMatchObject({ method: 'image' });
    expect(page1?.conceptExtractionState).toBe('not-started');
  });

  it('extraction that finished survives a reading record that repeats the reading it ran over', async () => {
    const h = ready([[DECK, ['text']]]);
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    await store.recordConceptExtraction([DECK]);
    store.recordReading(reading(DECK, 1, { kind: 'read', method: 'text-layer' }));
    await store.idle();
    expect((store.manifests().get(DECK) as UnitManifest).entries[0]?.conceptExtractionState).toBe(
      'complete',
    );
  });
});

describe('a reading never makes a manifest that reads complete by omission', () => {
  it('a reading for a source nobody had enumerated enumerates it first, so every page is in the manifest', async () => {
    const h = ready([[DECK, ['text', 'vision', 'vision', 'vision']]]);
    const store = h.make();
    await store.load();
    store.recordReading(reading(DECK, 2, IMAGE_READING));
    await store.idle();
    const manifest = store.manifests().get(DECK) as UnitManifest;
    expect(manifest.entries).toHaveLength(4);
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual([
      'read',
      'read',
      'pending',
      'pending',
    ]);
    expect(isFullyRead(manifest)).toBe(false);
  });

  it('a reading for a source that cannot be enumerated is not recorded at all', async () => {
    const h = ready([[NOTES, 'broken']]);
    const store = h.make();
    await store.load();
    store.recordReading(reading(NOTES, 1, IMAGE_READING));
    await store.idle();
    expect(h.vault.writes).toEqual([]);
    expect(store.manifests().size).toBe(0);
  });
});

describe('a source known not to be enumerable is not re-extracted by the writers either', () => {
  it('a reading or an extraction pass for it costs no further extraction and writes nothing', async () => {
    const h = ready([[NOTES, 'broken']]);
    const store = h.make();
    await store.load();
    await store.manifestsFor([NOTES]);
    expect(h.extractions).toEqual([NOTES]);

    store.recordReading(reading(NOTES, 1, IMAGE_READING));
    await store.recordConceptExtraction([NOTES]);
    await store.idle();

    expect(h.extractions).toEqual([NOTES]);
    expect(h.vault.writes).toEqual([]);
  });
});

describe('explicit revision retirement', () => {
  async function settledDeck(): Promise<{
    h: Harness;
    store: ReturnType<Harness['make']>;
  }> {
    const h = ready([[DECK, ['text', 'vision']]]);
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    store.recordReading(reading(DECK, 2, IMAGE_READING));
    await store.recordConceptExtraction([DECK]);
    await store.idle();
    return { h, store };
  }

  it('changed bytes retire the old revision and enumerate the new one: none of the old readings carry over', async () => {
    const { h, store } = await settledDeck();
    expect(isFullyRead(store.manifests().get(DECK) as UnitManifest)).toBe(true);
    const oldDigest = (store.manifests().get(DECK) as UnitManifest).revisionDigest;

    h.vault.put(DECK, 'deck bytes, revision two');
    h.layouts.set(DECK, ['text', 'vision', 'vision']);
    store.observe({ kind: 'modify', path: DECK });
    const manifest = await manifestOf(store, DECK);

    expect(manifest.revisionDigest).not.toBe(oldDigest);
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual([
      'read',
      'pending',
      'pending',
    ]);
    expect(manifest.entries.every((e) => e.conceptExtractionState === 'not-started')).toBe(true);
    const records = parseUnitManifestLog(logLines(h.vault)).records;
    const retired = records.filter((r) => r.kind === 'retired');
    expect(retired).toHaveLength(1);
    expect(retired[0]).toMatchObject({ revisionDigest: oldDigest, reason: 'superseded' });
  });

  it('an extraction pass that finishes after the source changed marks the current revision, never the retired one', async () => {
    const { h, store } = await settledDeck();
    h.vault.put(DECK, 'deck bytes, revision two');
    h.layouts.set(DECK, ['text', 'text']);
    store.observe({ kind: 'modify', path: DECK });

    await store.recordConceptExtraction([DECK]);

    const manifest = store.manifests().get(DECK) as UnitManifest;
    expect(manifest.entries.map((e) => e.conceptExtractionState)).toEqual(['complete', 'complete']);
    expect(kinds(h.vault).filter((k) => k === 'retired')).toHaveLength(1);
  });

  it('a modify event that changed no byte writes nothing and costs no extraction', async () => {
    const { h, store } = await settledDeck();
    const written = h.vault.writes.length;
    const extracted = h.extractions.length;
    store.observe({ kind: 'modify', path: DECK });
    const manifest = await manifestOf(store, DECK);
    expect(isFullyRead(manifest)).toBe(true);
    expect(h.vault.writes.length).toBe(written);
    expect(h.extractions.length).toBe(extracted);
  });

  it('a manifest is not trusted from a modify event until the bytes have been checked again', async () => {
    const { h, store } = await settledDeck();
    h.vault.put(DECK, 'deck bytes, revision two');
    h.layouts.set(DECK, ['vision']);
    const stale = h.make();
    await stale.load();
    // A fresh session: the file changed while Obsidian was closed, so its manifest is not current.
    const manifest = await manifestOf(stale, DECK);
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual(['pending']);
    // The projection the first store still holds is untouched until it re-checks.
    expect(isFullyRead(store.manifests().get(DECK) as UnitManifest)).toBe(true);
  });

  it('a source that changed into something unenumerable retires the old revision and claims nothing new', async () => {
    const { h, store } = await settledDeck();
    h.vault.put(DECK, 'deck bytes, corrupted');
    h.layouts.set(DECK, 'broken');
    store.observe({ kind: 'modify', path: DECK });
    const got = await store.manifestsFor([DECK]);
    expect(got.has(DECK)).toBe(false);
    expect(store.manifests().has(DECK)).toBe(false);
    expect(kinds(h.vault).filter((k) => k === 'retired')).toHaveLength(1);
  });

  it('a deleted source is retired as removed and the projection no longer holds it', async () => {
    const { h, store } = await settledDeck();
    store.observe({ kind: 'delete', path: DECK });
    await store.idle();
    expect(store.manifests().has(DECK)).toBe(false);
    const retired = parseUnitManifestLog(logLines(h.vault)).records.filter(
      (r) => r.kind === 'retired',
    );
    expect(retired).toHaveLength(1);
    expect(retired[0]).toMatchObject({ reason: 'source-removed' });
  });

  it('a renamed source is retired at its old path, and the new path is enumerated afresh', async () => {
    const { h, store } = await settledDeck();
    const moved = '03 Research/SYNTH101 Deck moved.pdf' as VaultPath;
    h.vault.put(moved, SOURCES[DECK] ?? '');
    await h.vault.delete?.(DECK);
    h.layouts.set(moved, ['text', 'vision']);
    store.observe({ kind: 'rename', path: moved, oldPath: DECK });
    const manifest = await manifestOf(store, moved);
    await store.idle();
    expect(store.manifests().has(DECK)).toBe(false);
    // Nothing is carried across a rename: the image page must be read again.
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual(['read', 'pending']);
  });

  it('an event for a path the store holds nothing about writes nothing', async () => {
    const { h, store } = await settledDeck();
    const written = h.vault.writes.length;
    store.observe({ kind: 'delete', path: 'Notes/lecture.md' });
    store.observe({ kind: 'modify', path: 'Notes/lecture.md' });
    await store.idle();
    expect(h.vault.writes.length).toBe(written);
  });
});

describe('concurrent devices', () => {
  it("a second device folds the first one's files and stamps its own records above them (Lamport clock)", async () => {
    const h = ready();
    const a = h.make({ deviceId: DEVICE_A });
    await a.load();
    await manifestOf(a, DECK);
    a.recordReading(reading(DECK, 3, IMAGE_READING));
    await a.idle();
    const highest = Math.max(
      ...parseUnitManifestLog(logLines(h.vault, DEVICE_A)).records.map((r) => r.clock),
    );

    const b = h.make({ deviceId: DEVICE_B });
    await b.load();
    const seen = await manifestOf(b, DECK);
    expect(isFullyRead(seen)).toBe(true);
    b.recordReading(reading(DECK, 2, { kind: 'unavailable' }));
    await b.idle();
    const bClocks = parseUnitManifestLog(logLines(h.vault, DEVICE_B)).records.map((r) => r.clock);
    expect(Math.min(...bClocks)).toBeGreaterThan(highest);
  });

  it('two devices that read different pages offline fold to both readings, whichever files arrive first', async () => {
    const layouts = new Map<VaultPath, Layout>([[DECK, ['vision', 'vision', 'text']]]);
    const onA = harness({ ...SOURCES }, undefined, layouts);
    const onB = harness({ ...SOURCES }, undefined, layouts);
    const a = onA.make({ deviceId: DEVICE_A });
    const b = onB.make({ deviceId: DEVICE_B });
    await a.load();
    await b.load();
    await manifestOf(a, DECK);
    await manifestOf(b, DECK);
    a.recordReading(reading(DECK, 1, IMAGE_READING));
    b.recordReading(reading(DECK, 2, IMAGE_READING));
    await a.idle();
    await b.idle();

    const synced = (first: EventedTestVault, second: EventedTestVault): EventedTestVault => {
      const merged = eventedTestVault({ ...SOURCES });
      for (const [path, content] of [...first.snapshot(), ...second.snapshot()]) {
        if (path.startsWith(FOLDER)) merged.put(path, content);
      }
      return merged;
    };
    const readBoth = async (vault: EventedTestVault): Promise<UnitManifest> => {
      const store = createVaultUnitManifestStore({
        vault,
        deviceId: 'olea-devicec0003',
        now: () => NOW,
        extractSource: async () => {
          throw new Error('must not extract: the records already cover this revision');
        },
      });
      await store.load();
      return await manifestOf(store, DECK);
    };
    const ab = await readBoth(synced(onA.vault, onB.vault));
    const ba = await readBoth(synced(onB.vault, onA.vault));
    expect(ab).toEqual(ba);
    expect(ab.entries.map((e) => e.readingState.kind)).toEqual(['read', 'read', 'read']);
  });

  it('each device writes only its own file', async () => {
    const h = ready();
    const a = h.make({ deviceId: DEVICE_A });
    const b = h.make({ deviceId: DEVICE_B });
    await a.load();
    await b.load();
    await manifestOf(a, DECK);
    b.recordReading(reading(DECK, 3, IMAGE_READING));
    await b.idle();
    expect(h.vault.writes.filter((p) => p.includes(DEVICE_A)).length).toBeGreaterThan(0);
    expect(h.vault.writes.filter((p) => p.includes(DEVICE_B)).length).toBeGreaterThan(0);
    for (const path of h.vault.writes) {
      expect([DEVICE_A, DEVICE_B].filter((d) => path.includes(d))).toHaveLength(1);
    }
  });
});

describe('deletion and rebuild never show false completeness', () => {
  async function completedVault(): Promise<Harness> {
    const h = ready([
      [DECK, ['text', 'text', 'vision']],
      [NOTES, ['text', 'text']],
    ]);
    const store = h.make();
    await store.load();
    await store.manifestsFor([DECK, NOTES]);
    store.recordReading(reading(DECK, 3, IMAGE_READING));
    await store.recordConceptExtraction([DECK, NOTES]);
    await store.idle();
    // Before the deletion: both sources read in full, and their concept extraction finished.
    expect(isFullyRead(store.manifests().get(DECK) as UnitManifest)).toBe(true);
    expect(isFullyRead(store.manifests().get(NOTES) as UnitManifest)).toBe(true);
    return h;
  }

  function deleteTheFolder(h: Harness): void {
    for (const path of h.vault.paths()) {
      if (path.startsWith(FOLDER)) h.vault.put(path, '');
    }
    for (const path of h.vault.paths()) {
      if (path.startsWith(FOLDER)) void h.vault.delete?.(path);
    }
  }

  it('right after the folder is deleted, and before anything is rebuilt, no source reads complete', async () => {
    const h = await completedVault();
    deleteTheFolder(h);
    expect(h.vault.paths().some((p) => p.startsWith(FOLDER))).toBe(false);

    const rebuilt = h.make({ deviceId: DEVICE_A });
    // Not loaded yet: unknown, never the text-layer verdict.
    const beforeLoad = await rebuilt.manifestsFor([DECK, NOTES]);
    for (const path of [DECK, NOTES]) {
      const manifest = beforeLoad.get(path) as UnitManifest;
      expect(isFullyRead(manifest)).toBe(false);
      expect(hasPendingUnits(manifest)).toBe(true);
    }
    await rebuilt.load();
    // Loaded, nothing recorded: the projection holds nothing to call complete.
    expect(rebuilt.manifests().size).toBe(0);
  });

  it('while the rebuild is still enumerating, the projection has nothing that reads complete', async () => {
    const h = await completedVault();
    deleteTheFolder(h);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rebuilt = h.make({
      extractSource: async ({ path }) => {
        await gate;
        return resultOf(path, h.layouts.get(path) ?? 'broken');
      },
    });
    await rebuilt.load();
    const pending = rebuilt.manifestsFor([DECK, NOTES]);
    await Promise.resolve();
    expect(rebuilt.manifests().size).toBe(0);
    release?.();
    await pending;
  });

  it('after the rebuild, the text-only source reads finished again and the source with an image page does not', async () => {
    const h = await completedVault();
    deleteTheFolder(h);
    const rebuilt = h.make();
    await rebuilt.load();
    const got = await rebuilt.manifestsFor([DECK, NOTES]);

    const notes = got.get(NOTES) as UnitManifest;
    expect(isFullyRead(notes)).toBe(true);
    // Its concept extraction is not something the enumeration can know: it starts over.
    expect(notes.entries.every((e) => e.conceptExtractionState === 'not-started')).toBe(true);

    const deck = got.get(DECK) as UnitManifest;
    expect(isFullyRead(deck)).toBe(false);
    expect(deck.entries.map((e) => e.readingState.kind)).toEqual(['read', 'read', 'pending']);
    expect(deck.entries.map((e) => absenceGroundingFor(e))).toEqual([
      'groundable',
      'groundable',
      'unknown',
    ]);
  });

  it('the rebuild does not touch a source byte or anything outside .olea/unit-manifests', async () => {
    const h = await completedVault();
    deleteTheFolder(h);
    h.vault.writes.length = 0;
    const rebuilt = h.make();
    await rebuilt.load();
    await rebuilt.manifestsFor([DECK, NOTES]);
    expect(h.vault.writes.length).toBeGreaterThan(0);
    for (const path of h.vault.writes) expect(path.startsWith(FOLDER)).toBe(true);
    expect(h.vault.contentOf(DECK)).toBe(SOURCES[DECK]);
  });
});

describe('a torn or unreadable log', () => {
  it('a crash-truncated last line costs that record: the page it named reads pending, never read', async () => {
    const h = ready([[DECK, ['vision', 'vision']]]);
    const first = h.make();
    await first.load();
    await manifestOf(first, DECK);
    first.recordReading(reading(DECK, 1, IMAGE_READING));
    first.recordReading(reading(DECK, 2, IMAGE_READING));
    await first.idle();

    // Tear the last line, as an interrupted append would.
    const path = unitManifestLogPath(DAY, DEVICE_A);
    const whole = h.vault.contentOf(path) as string;
    const lastLineStart = whole.trimEnd().lastIndexOf('\n') + 1;
    h.vault.put(path, whole.slice(0, lastLineStart + 60));

    const second = h.make();
    await second.load();
    const manifest = await manifestOf(second, DECK);
    expect(manifest.entries.map((e) => e.readingState.kind)).toEqual(['read', 'pending']);
    expect(isFullyRead(manifest)).toBe(false);
  });

  it('a log that cannot be read leaves the store unloaded, so every source reads unknown rather than empty', async () => {
    const h = ready();
    const vault = h.vault;
    vault.put(unitManifestLogPath(DAY, DEVICE_A), 'x');
    const original = vault.read.bind(vault);
    vault.read = async () => {
      throw new Error('host unavailable');
    };
    const store = h.make();
    await expect(store.load()).rejects.toThrow('host unavailable');
    expect(store.isLoaded()).toBe(false);
    const got = await store.manifestsFor([DECK]);
    expect(hasPendingUnits(got.get(DECK) as UnitManifest)).toBe(true);
    vault.read = original;
  });

  it('a write that fails is not folded: the source stays unknown and nothing is claimed', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    h.vault.failWrites = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const got = await store.manifestsFor([DECK]);
    spy.mockRestore();
    expect(hasPendingUnits(got.get(DECK) as UnitManifest)).toBe(true);
    expect(store.manifests().size).toBe(0);
    h.vault.failWrites = false;
    const retried = await manifestOf(store, DECK);
    expect(retried.entries.map((e) => e.readingState.kind)).toEqual(['read', 'read', 'pending']);
  });
});

describe('subscribers', () => {
  it('are told once when a burst of readings lands, not once per page', async () => {
    const h = ready([[DECK, ['vision', 'vision', 'vision']]]);
    const timers: Array<() => void> = [];
    const store = h.make({
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimer: () => undefined,
    });
    await store.load();
    await manifestOf(store, DECK);
    const listener = vi.fn();
    store.subscribe(listener);
    store.recordReading(reading(DECK, 1, IMAGE_READING));
    store.recordReading(reading(DECK, 2, IMAGE_READING));
    store.recordReading(reading(DECK, 3, IMAGE_READING));
    await store.idle();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('an unsubscribed listener hears nothing, and a listener that throws does not stop the rest', async () => {
    const h = ready();
    const store = h.make();
    await store.load();
    await manifestOf(store, DECK);
    const heard = vi.fn();
    const off = store.subscribe(heard);
    off();
    store.subscribe(() => {
      throw new Error('a view that broke');
    });
    const other = vi.fn();
    store.subscribe(other);
    store.recordReading(reading(DECK, 3, IMAGE_READING));
    await store.idle();
    expect(heard).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('the default extractors are wired', () => {
  it('enumerates a real image through the real registry: one page, routed to vision, so pending', async () => {
    const vault = eventedTestVault({ [SCAN]: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) });
    const store = createVaultUnitManifestStore({ vault, deviceId: DEVICE_A, now: () => NOW });
    await store.load();
    const manifest = await manifestOf(store, SCAN);
    expect(manifest.entries.map((e) => [e.page, e.readingState.kind])).toEqual([[1, 'pending']]);
    expect(isFullyRead(manifest)).toBe(false);
  });

  it('leaves out a file whose bytes no extractor can open, so the census keeps its own verdict', async () => {
    const vault = eventedTestVault({ [DECK]: 'these bytes are not a pdf' });
    const store = createVaultUnitManifestStore({ vault, deviceId: DEVICE_A, now: () => NOW });
    await store.load();
    const got = await store.manifestsFor([DECK]);
    expect(got.has(DECK)).toBe(false);
    expect(vault.writes).toEqual([]);
  });
});
