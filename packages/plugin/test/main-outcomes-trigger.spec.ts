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
