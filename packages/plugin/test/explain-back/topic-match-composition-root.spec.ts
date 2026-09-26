/**
 * `[D-322]` (`ol-egov.141.89.6.4`): source-level proof that `main.ts` actually wires the
 * registry-backed `matchFreeformTopicConcept` composer into `ExplainBackModal`'s deps —
 * `explain-back/modal.ts`'s `resolveTopicPrompt` and `ExplainBackModalDeps.matchFreeformTopicConcept`
 * landed (`be89757`) with no production caller, per that bead's own report ("Remaining: … a
 * registry-backed topic matcher composer (main.ts and registry provider)"); this is that caller.
 *
 * Source-level, not behavioural, for the same reason `relation-composition-root.spec.ts` (this
 * directory) gives: `main.ts` imports `obsidian` directly and cannot be imported under Vitest.
 * The behavioural half — candidate building from `ConceptRecord`/`RegistryOverrides`, and the
 * matching rule itself — is covered where it CAN be covered without an obsidian import:
 * `registry/topic-matcher-provider.spec.ts` (candidate building and the composed matcher) and
 * `explain-back/request.spec.ts` (the pure `matchFreeformTopicToConcept`, already closed).
 * Comments are stripped before matching, same convention.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — see this file's module doc. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');

describe('main.ts: matchFreeformTopicConcept ([D-322])', () => {
  it('imports createFreeformTopicMatcher from registry/topic-matcher-provider.js', () => {
    expect(main).toMatch(
      /import \{ createFreeformTopicMatcher \} from '\.\/registry\/topic-matcher-provider\.js';/,
    );
  });

  it('matchFreeformTopicConcept composes createFreeformTopicMatcher from the already-cached conceptRecords and registryOverridesCache, never a fresh read', () => {
    const start = main.indexOf('private matchFreeformTopicConcept(');
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf('\n  }', start);
    const body = main.slice(start, end);
    expect(body).toMatch(/conceptRecords: \(\) => this\.conceptRecords,/);
    expect(body).toMatch(/overrides: \(\) => this\.registryOverridesCache,/);
    // Course-aware per D-322, but honestly absent: no freeform call site has a course signal
    // today (see the method's own doc) — `courseCode` is never passed here.
    expect(body).not.toMatch(/courseCode:/);
  });

  it('openExplainBackModal wires matchFreeformTopicConcept to the real method, alongside resolveCausesPartner', () => {
    const start = main.indexOf('private openExplainBackModal(');
    const end = main.indexOf('evaluateConfusionRouting(', start);
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, end);
    expect(body).toMatch(
      /matchFreeformTopicConcept: \(topic\) => this\.matchFreeformTopicConcept\(topic\),/,
    );
  });
});
