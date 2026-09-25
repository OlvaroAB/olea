/**
 * Scenario: `features/F4-oracle.md`, "F4.11 — Practice-paper command and view surface
 * [PAPER-8]" — this file covers the surface's own `[PAPER-10]` half: `ol-egov.141.6.1`
 * built `packages/plugin/src/paper/` fully composed and unit-tested but deliberately
 * unwired (its own close evidence: "no production caller in main.ts yet, by design"); this is
 * the source-level reachability check for the wiring `ol-0r92.75.1` [PAPER-10] adds.
 *
 * Same technique and the same reason `main-wiring.spec.ts`'s own module doc gives:
 * `main.ts` imports `obsidian`, which cannot be loaded under Vitest, so a source-level
 * assertion is the only instrument available for catching "the view/command exists and is
 * fully correct, and nothing ever registers it" — exactly the defect class
 * `main-wiring.spec.ts` was written for.
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

describe('the practice-paper view and command are registered, not merely written', () => {
  it('imports the view, command id and composition seam from ./paper/', () => {
    expect(main).toMatch(
      /import \{ PaperView, VIEW_TYPE_OLEA_PAPER \} from '\.\/paper\/view\.js';/,
    );
    expect(main).toMatch(
      /import \{ OLEA_COMMAND_PRACTICE_PAPER_OPEN \} from '\.\/paper\/ids\.js';/,
    );
    expect(main).toMatch(
      /import \{ buildPracticePaperProvider, courseForActiveFileInApp \} from '\.\/paper\/wiring\.js';/,
    );
  });

  it('registers the paper view type against a real buildPracticePaperProvider composition', () => {
    expect(main).toMatch(
      /const practicePaper = buildPracticePaperProvider\(\{\s*vault,\s*dataHost: this,\s*createTransport: createObsidianWorkerTransport,\s*settingsStore: new ObsidianStudyPlanSettingsStore\(this\),\s*\}\);/,
    );
    expect(main).toMatch(
      /this\.registerView\(VIEW_TYPE_OLEA_PAPER, \(leaf\) => new PaperView\(leaf, practicePaper\)\);/,
    );
  });

  it('registers a command hidden unless the active file resolves to a course', () => {
    expect(main).toMatch(
      /this\.addCommand\(\{\s*id: OLEA_COMMAND_PRACTICE_PAPER_OPEN,\s*name: '[^']*',\s*checkCallback: \(checking: boolean\) => \{\s*const course = courseForActiveFileInApp\(this\.app\);\s*if \(course === undefined\) return false;\s*if \(checking\) return true;\s*void this\.revealPracticePaperView\(course\);\s*return true;\s*\},\s*\}\);/,
    );
  });

  it('invoking the command reveals the paper view seeded with the resolved course, reusing an already-open leaf', () => {
    expect(main).toMatch(
      /private async revealPracticePaperView\(course: string\): Promise<void> \{\s*const \{ workspace \} = this\.app;\s*const existing = workspace\.getLeavesOfType\(VIEW_TYPE_OLEA_PAPER\);\s*const leaf: WorkspaceLeaf \| null = existing\[0\] \?\? workspace\.getLeaf\('tab'\);\s*if \(leaf === null \|\| leaf === undefined\) return;\s*if \(existing\.length === 0\) \{\s*await leaf\.setViewState\(\{ type: VIEW_TYPE_OLEA_PAPER, active: true \}\);\s*\}\s*await workspace\.revealLeaf\(leaf\);\s*const view = leaf\.view;\s*if \(view instanceof PaperView\) await view\.setCourse\(course\);\s*\}/,
    );
  });

  it('does not register the paper command through the shared commands module (main.ts owns it directly)', () => {
    // `commands/register-commands.ts` is a concurrent lane's owned path
    // (`.beads` lane table), so this bead adds a direct `this.addCommand`
    // call rather than a new `OleaCommandHandlers` key — see the doc
    // comment above the `this.addCommand` call this file just asserted.
    expect(main).not.toMatch(/practicePaperCheckCallback/);
  });
});
