/**
 * Reachability of the durable unit manifest (`[D-445]`, `ol-egov.141.89.8.43`; Definition of Done
 * clause 5, `[D-072]`): the store is reached from `main.ts`, by the reader that needs it and by every
 * writer, and the F7.4 export and full delete can find its files.
 *
 * `main.ts` imports `obsidian`, which has no runtime under Vitest, so the composition is asserted at
 * the source, the technique `test/main-wiring.spec.ts` documents and this repo already uses where it
 * is the only instrument available. Prose is stripped first so a comment describing the wiring cannot
 * satisfy an assertion about it. What each call does once reached is proven behaviourally in the
 * sibling suites (`unit-manifest-store`, `-provider`, `-ingestion-wiring`); this file pins only that
 * the seams are joined.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  UNIT_MANIFEST_FOLDER,
  unitManifestLogPath,
} from '../../../core/src/ingestion/unit-manifest/log.js';
import { OLEA_LAYER_FOLDERS, OLEA_PROBED_DAILY_STREAMS } from '../../src/privacy/log-discovery.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');
const wiring = codeOf('ingestion/wiring.ts');

/** The text of `main.ts` from the first occurrence of `start` to the first `end` after it. */
function between(source: string, start: RegExp, end: RegExp): string {
  const from = source.search(start);
  if (from === -1) throw new Error(`not found: ${start}`);
  const rest = source.slice(from);
  const to = rest.search(end);
  return to === -1 ? rest : rest.slice(0, to);
}

describe('the unit manifest is reached from main.ts', () => {
  it('constructs one store over the plugin vault and device id, routed the way the ingestion queue routes', () => {
    expect(main).toMatch(
      /const unitManifests = createVaultUnitManifestStore\(\{\s*vault,\s*deviceId,\s*now: this\.now,\s*extractOptions: \(\) => this\.ingestion\?\.extractOptions,\s*\}\);/,
    );
    expect(main).toMatch(/this\.unitManifests = unitManifests;/);
  });

  it('loads it at start without blocking onload, and logs a failure rather than swallowing it', () => {
    expect(main).toMatch(/void unitManifests\.load\(\)\.catch\(/);
  });

  it('hands the grove census the store as its unitManifests supplier, with the paths the census will classify', () => {
    const groveRegistration = between(
      main,
      /this\.registerView\(VIEW_TYPE_OLEA_GROVE/,
      /return new GroveView\(/,
    );
    expect(groveRegistration).toMatch(/createLocalGroveProvider\(\{/);
    expect(groveRegistration).toMatch(
      /unitManifests: \(paths\) => unitManifests\.manifestsFor\(paths\),/,
    );
  });

  it("feeds the vision runner's every reading into the store, through the ingestion composition", () => {
    const ingestionCall = between(
      main,
      /this\.ingestion = await buildIngestionRunner\(\{/,
      /\n {4}\}\);/,
    );
    expect(ingestionCall).toMatch(
      /vision: \{[^}]*onManifestEntry: \(entry\) => unitManifests\.recordReading\(entry\),[^}]*\}/s,
    );
  });

  it('tells the store about every vault event, so a changed or removed source is not trusted', () => {
    expect(main).toMatch(
      /this\.register\(vault\.watch\(\(event\) => unitManifests\.observe\(event\)\)\);/,
    );
  });

  it('refreshes an open grove when the store records something', () => {
    expect(main).toMatch(
      /unitManifests\.subscribe\(\(\) => \{\s*void refreshOpenTodayViews\(this\.app\.workspace, VIEW_TYPE_OLEA_GROVE\);\s*\}\)/,
    );
  });

  it('marks concept extraction from the sources the concept read pass consumed in full, and no others', () => {
    const call = between(
      main,
      /await this\.unitManifests\?\.recordConceptExtraction\(/,
      /\n {6}\);/,
    );
    expect(call).toContain('pass.read.coverage');
    expect(call).toContain('row.passagesOffered > 0');
    expect(call).toContain('row.passagesRead >= row.passagesOffered');
    expect(call).toContain('!row.truncatedByBudget');
    expect(call).toContain('row.sourcePath');
  });
});

describe('the ingestion composition carries the seams the store needs', () => {
  it('forwards vision.onManifestEntry into the vision page runner', () => {
    expect(wiring).toMatch(
      /\.\.\.\(vision\.onManifestEntry \? \{ onManifestEntry: vision\.onManifestEntry \} : \{\}\),/,
    );
  });

  it('returns the routing options its extraction ran with', () => {
    expect(wiring).toMatch(
      /return \{ engine, sink, \.\.\.\(extractOptions \? \{ extractOptions \} : \{\}\) \};/,
    );
  });
});

describe("F7.4 can find the store's files (the export and the full delete)", () => {
  it('registers the folder as a record folder, carried as the exact text on disk and removed by the full delete', () => {
    expect(OLEA_LAYER_FOLDERS).toContainEqual({ folder: UNIT_MANIFEST_FOLDER, role: 'record' });
  });

  it("probes this device's own daily file by exact path, so a host that lists nothing under a dot folder still finds it", () => {
    const stream = OLEA_PROBED_DAILY_STREAMS.find((s) => s.folder === UNIT_MANIFEST_FOLDER);
    expect(stream).toBeDefined();
    expect(stream?.pathFor('2026-09-29', 'olea-k3f9zq1m7x2p')).toBe(
      unitManifestLogPath('2026-09-29', 'olea-k3f9zq1m7x2p'),
    );
  });
});
