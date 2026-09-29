/**
 * Scenario: `olea-service`'s `features/F1-sources.md`, the `[D-344]` block appended after
 * "registering while offline..." — "main.ts wires the trigger through the same F7.3-recorded
 * transport every other Worker-backed port uses" — @auto:plugin/main-outcomes-trigger.spec.
 *
 * `main.ts` imports `obsidian`, whose `package.json` `main` is `""`, so it cannot be loaded under
 * Vitest at all (see `main-wiring.spec.ts`'s own module doc, which this file copies the
 * source-level-assertion technique from verbatim). What this file can check is *reachability* —
 * that `buildIngestionRunner` is actually given an `outcomes` option, wired to the same
 * F7.8/F7.3-recorded transport pair `vision` already uses, and that the eligibility function it
 * names reaches the real D-226 projection. What it cannot check is that a real Obsidian host then
 * behaves as `wiring.ts`'s own tests (`outcomes-extract-trigger.spec.ts`) prove the composition
 * does; that stays the `@manual` scenario in `F1-sources.md`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

/** Source with prose removed — a doc paragraph describing the wiring must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');

describe('outcomes.extract.v1 is wired into the real ingestion runner, not left composed-but-unreachable', () => {
  it('buildIngestionRunner is given an outcomes option', () => {
    expect(main).toMatch(/buildIngestionRunner\(\{[\s\S]*?outcomes:\s*\{/);
  });

  it('the outcomes option uses the same F7.8/F7.3-recorded transport pair `vision` already uses', () => {
    expect(main).toMatch(
      /outcomes:\s*\{\s*dataHost:\s*this,\s*createTransport:\s*createRecordingTransport,/,
    );
  });

  it("the outcomes option names a registeredDocumentFor reaching this plugin's own eligibility method", () => {
    expect(main).toMatch(
      /registeredDocumentFor:\s*\(sourcePath\)\s*=>\s*this\.registeredOutcomesDocumentFor\(vault,\s*sourcePath\)/,
    );
  });

  it('registeredOutcomesDocumentFor exists and reaches the real D-226 projection, not a stub', () => {
    expect(main).toMatch(/private async registeredOutcomesDocumentFor\(/);
    expect(main).toMatch(/readReviewLogHistory\(vault\)/);
    expect(main).toMatch(/projectRegisteredFiles\(entries\)/);
  });

  it('only objectives/past-paper roles are treated as eligible — course-material and unregistered both read as null', () => {
    expect(main).toMatch(/spec\.role !== 'objectives' && spec\.role !== 'past-paper'/);
  });

  it('imports readReviewLogHistory and projectRegisteredFiles from olea-core, not a re-derived local projection', () => {
    expect(main).toMatch(/projectRegisteredFiles,/);
    expect(main).toMatch(/readReviewLogHistory,/);
  });
});

describe('[D-429] (row 16, ol-egov.141.89.7.5): the trigger writes the examiner-scope reading, and main.ts supplies what it needs', () => {
  // `persistence.ts` and the three stores were built with no production writer; the trigger's
  // discard point now calls them (`outcomes-extract-scope-reading.spec.ts` proves that end to
  // end). These are the source-level pins that `main.ts` hands the trigger its two facts: the
  // stable device id and the reading basis, and that the basis is the unit manifest's, never a
  // second, differently keyed digest.

  it('the outcomes option carries a scopeReading dep', () => {
    expect(main).toMatch(/outcomes:\s*\{[\s\S]*?scopeReading:\s*\{/);
  });

  it('scopeReading names the same device id the rest of onload uses, not a fresh mint', () => {
    expect(main).toMatch(/scopeReading:\s*\{\s*deviceId:\s*async \(\) => deviceId,/);
  });

  it("the reading basis is the unit manifest's own answer for that source, through the tested helper", () => {
    expect(main).toMatch(
      /readingBasisFor:\s*async \(sourcePath\) => \{\s*const manifest = \(await unitManifests\.manifestsFor\(\[sourcePath\]\)\)\.get\(sourcePath\);\s*return manifest === undefined \? null : documentReadingBasisFromManifest\(manifest\);\s*\},/,
    );
  });

  it('imports documentReadingBasisFromManifest from the scope-reading module', () => {
    expect(main).toMatch(
      /import \{ documentReadingBasisFromManifest \} from '\.\/scope-reading\/basis\.js';/,
    );
  });

  it('adds no Worker call and no second writer: the only scope-reading persistence is the trigger', () => {
    expect(main).not.toMatch(/createScopeReadingPersistence/);
  });
});
