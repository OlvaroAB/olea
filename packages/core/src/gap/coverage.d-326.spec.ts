/**
 * `[D-326]` (`ol-egov.141.89.8.8`), carried as acceptance on
 * `ol-egov.141.89.11.4`: the coverage scope reads reading and extraction
 * status from the shared completeness record; an unread or partly read
 * region is unknown, never absent; a finished reading with unfinished
 * extraction is not shown as complete. Scenarios: `features/F4-oracle.md`
 * (olea-service), "[D-326]: the coverage scope reads the completeness record".
 *
 * Fixture ids are opaque (INV-3).
 */
import { describe, expect, it } from 'vitest';
import {
  markConceptExtractionComplete,
  newPendingEntry,
  withReadingState,
} from '../ingestion/unit-manifest/manifest.js';
import type {
  UnitManifest,
  UnitManifestEntry,
  UnitReadingState,
} from '../ingestion/unit-manifest/types.js';
import type { SourceCoverage } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { readRecordOf, summariseCoverageScope } from './coverage.js';

function row(sourcePath: string, overrides: Partial<SourceCoverage> = {}): SourceCoverage {
  return {
    sourcePath: sourcePath as VaultPath,
    kinds: ['registered-file'],
    role: 'past-paper',
    format: 'pdf',
    duplicateSourcePaths: [],
    courses: ['CRS-X'],
    outcome: 'extracted',
    pages: 2,
    units: 6,
    citations: 0,
    limitations: [],
    ...overrides,
  };
}

const READ: UnitReadingState = { kind: 'read', method: 'text-layer' };
const PARTIAL: UnitReadingState = { kind: 'partial', method: 'image', coverage: 'top half' };

/** One unit, its reading state set, and extraction marked complete when asked. */
function unit(path: string, page: number, state: UnitReadingState, extracted = false) {
  const entry = withReadingState(newPendingEntry(path as VaultPath, page), state);
  return extracted ? markConceptExtractionComplete(entry) : entry;
}

function manifest(path: string, entries: readonly UnitManifestEntry[]): UnitManifest {
  return { sourcePath: path as VaultPath, revisionDigest: 'rev-1', entries };
}

function records(...ms: UnitManifest[]): ReadonlyMap<VaultPath, UnitManifest> {
  return new Map(ms.map((m) => [m.sourcePath, m]));
}

const FULL_A = manifest('a.pdf', [unit('a.pdf', 1, READ, true), unit('a.pdf', 2, READ, true)]);

describe('[D-326] the coverage scope reads the completeness record', () => {
  it('a source read in full with extraction finished keeps the exhaustive claim', () => {
    const scope = summariseCoverageScope([row('a.pdf')], { manifests: records(FULL_A) });
    expect(scope.sources[0]).toMatchObject({
      readState: 'read',
      readingCompleteness: 'full',
      conceptExtraction: 'complete',
      absenceGrounding: 'groundable',
    });
    expect(scope.canStateExhaustiveness).toBe(true);
  });

  it('a partly read unit makes the source partly read: absence unknown, the claim withdrawn', () => {
    const m = manifest('a.pdf', [unit('a.pdf', 1, READ, true), unit('a.pdf', 2, PARTIAL, true)]);
    const scope = summariseCoverageScope([row('a.pdf', { citations: 3 })], {
      manifests: records(m),
    });
    expect(scope.sources[0]).toMatchObject({
      readState: 'read',
      readingCompleteness: 'partial',
      absenceGrounding: 'unknown',
    });
    expect(scope.partlyReadCount).toBe(1);
    expect(scope.canStateExhaustiveness).toBe(false);
  });

  it.each([
    ['failed', { kind: 'failed', reason: 'render-failed', retryable: false }],
    ['not legible', { kind: 'unreadable', reason: 'not-legible' }],
  ] as const)(
    'a %s unit beside read ones leaves the source partly read, never read in full',
    (_, state) => {
      const m = manifest('a.pdf', [unit('a.pdf', 1, READ, true), unit('a.pdf', 2, state)]);
      const scope = summariseCoverageScope([row('a.pdf')], { manifests: records(m) });
      expect(scope.sources[0]?.readingCompleteness).toBe('partial');
      expect(scope.sources[0]?.absenceGrounding).toBe('unknown');
      expect(scope.canStateExhaustiveness).toBe(false);
    },
  );

  it.each([
    ['pending', { kind: 'pending', reason: 'budget' }],
    ['unavailable', { kind: 'unavailable' }],
  ] as const)('a %s unit leaves the reading unsettled and extraction unfinished', (_, state) => {
    const m = manifest('a.pdf', [unit('a.pdf', 1, READ, true), unit('a.pdf', 2, state)]);
    const scope = summariseCoverageScope([row('a.pdf')], { manifests: records(m) });
    expect(scope.sources[0]).toMatchObject({
      readState: 'read',
      readingCompleteness: 'unsettled',
      conceptExtraction: 'unfinished',
      absenceGrounding: 'unknown',
    });
    expect(scope.unsettledCount).toBe(1);
    expect(scope.canStateExhaustiveness).toBe(false);
  });

  it('a source none of whose units has been read reads not attempted, never read', () => {
    const m = manifest('a.pdf', [newPendingEntry('a.pdf' as VaultPath, 1)]);
    const scope = summariseCoverageScope([row('a.pdf', { outcome: 'extracted', units: 6 })], {
      manifests: records(m),
    });
    expect(scope.sources[0]?.readState).toBe('not-attempted');
    expect(scope.sources[0]?.absenceGrounding).toBe('unknown');
    expect(scope.canStateExhaustiveness).toBe(false);
  });

  it('a finished reading with unfinished extraction is two facts, and not complete', () => {
    const m = manifest('a.pdf', [unit('a.pdf', 1, READ, true), unit('a.pdf', 2, READ, false)]);
    const scope = summariseCoverageScope([row('a.pdf')], { manifests: records(m) });
    expect(scope.sources[0]).toMatchObject({
      readState: 'read',
      readingCompleteness: 'full',
      conceptExtraction: 'unfinished',
    });
    expect(scope.extractionUnfinishedCount).toBe(1);
    expect(scope.canStateExhaustiveness).toBe(false);
    // Finishing the extraction, and nothing else, restores the claim.
    const done = manifest('a.pdf', [unit('a.pdf', 1, READ, true), unit('a.pdf', 2, READ, true)]);
    expect(
      summariseCoverageScope([row('a.pdf')], { manifests: records(done) }).canStateExhaustiveness,
    ).toBe(true);
  });

  it('the record is read instead of the extractor verdict: every unit failed reads unreadable', () => {
    const failed: UnitReadingState = { kind: 'failed', reason: 'render-failed', retryable: true };
    const m = manifest('a.pdf', [unit('a.pdf', 1, failed), unit('a.pdf', 2, failed)]);
    const scope = summariseCoverageScope([row('a.pdf', { outcome: 'extracted', units: 6 })], {
      manifests: records(m),
    });
    expect(scope.sources[0]?.readState).toBe('unreadable');
    expect(scope.sources[0]?.outcome).toBe('extracted'); // the verdict still shown beside it
    expect(scope.unreadableCount).toBe(1);
  });

  it('blank pages and pages with no text are a read that found nothing, not a failure', () => {
    const m = manifest('a.pdf', [
      unit('a.pdf', 1, { kind: 'unreadable', reason: 'blank-page' }),
      unit('a.pdf', 2, { kind: 'unreadable', reason: 'no-text-on-page' }),
    ]);
    expect(readRecordOf(m)).toEqual({
      readState: 'read-yielded-nothing',
      readingCompleteness: 'full',
      conceptExtraction: 'nothing-to-extract',
    });
  });

  it('a source with no record, or an empty one, keeps the extractor verdict with both facts not recorded', () => {
    const empty = manifest('b.pdf', []);
    const scope = summariseCoverageScope([row('a.pdf'), row('b.pdf')], {
      manifests: records(empty),
    });
    for (const source of scope.sources) {
      expect(source).toMatchObject({
        readState: 'read',
        readingCompleteness: 'not-recorded',
        conceptExtraction: 'not-recorded',
        absenceGrounding: 'groundable',
      });
    }
    // Today's gate, unchanged, for a scope with no records at all.
    expect(scope.canStateExhaustiveness).toBe(true);
    expect(summariseCoverageScope([row('a.pdf')])).toEqual(
      summariseCoverageScope([row('a.pdf')], { manifests: new Map() }),
    );
  });

  it('one partly read source among fully read ones is enough to withdraw the claim', () => {
    const partB = manifest('b.pdf', [unit('b.pdf', 1, PARTIAL, true)]);
    const scope = summariseCoverageScope([row('a.pdf'), row('b.pdf')], {
      manifests: records(FULL_A, partB),
    });
    expect(scope.sources.map((s) => s.readingCompleteness)).toEqual(['full', 'partial']);
    expect(scope.canStateExhaustiveness).toBe(false);
  });

  // `ol-egov.141.89.11.19`: `declaredUnits` is a second, independent gate
  // beside `[D-326]`'s own three — each can withhold the claim on its own,
  // and neither's presence changes the other's verdict.
  describe('declaredUnits beside [D-326] (ol-egov.141.89.11.19)', () => {
    it('a fully read, fully extracted source still withholds on an empty declared set', () => {
      const scope = summariseCoverageScope([row('a.pdf')], {
        manifests: records(FULL_A),
        declaredUnits: [],
      });
      expect(scope.canStateExhaustiveness).toBe(false);
      // The [D-326] facts this bead must not disturb, unchanged.
      expect(scope.sources[0]).toMatchObject({
        readState: 'read',
        readingCompleteness: 'full',
        conceptExtraction: 'complete',
      });
    });

    it('a fully read, fully extracted source still withholds on a declared unit with no aligned concept', () => {
      const scope = summariseCoverageScope([row('a.pdf')], {
        manifests: records(FULL_A),
        declaredUnits: [
          { declarationId: 'u1', conceptKeys: ['cpt-01'] },
          { declarationId: 'u2', conceptKeys: [] },
        ],
      });
      expect(scope.canStateExhaustiveness).toBe(false);
      expect(scope.unalignedDeclaredUnitCount).toBe(1);
    });

    it('every declared unit aligned does not override a [D-326] withholding condition', () => {
      const partB = manifest('b.pdf', [unit('b.pdf', 1, PARTIAL, true)]);
      const scope = summariseCoverageScope([row('a.pdf'), row('b.pdf')], {
        manifests: records(FULL_A, partB),
        declaredUnits: [{ declarationId: 'u1', conceptKeys: ['cpt-01'] }],
      });
      expect(scope.canStateExhaustiveness).toBe(false);
    });

    it('a fully read, fully extracted source with every declared unit aligned allows the claim', () => {
      const scope = summariseCoverageScope([row('a.pdf')], {
        manifests: records(FULL_A),
        declaredUnits: [{ declarationId: 'u1', conceptKeys: ['cpt-01'] }],
      });
      expect(scope.canStateExhaustiveness).toBe(true);
    });
  });
});
