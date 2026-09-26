/**
 * Scenario: `features/F6-today.md`'s F6.9 data-plumbing block (`olea-service`,
 * "a material-arrival timestamp is recorded only on a real, gate-cleared
 * edit") — the same scenario `main-wiring.spec.ts` tags `@auto:plugin/
 * main-wiring.spec` for its own arrival-recording checks. This file adds the
 * one case that scenario's own wording did not yet cover: a note's very
 * FIRST save (a created file, never before observed this session), which
 * `ol-egov.141.89.11.13` (`docs/dev/intelligence-build/vew.md`) found never
 * reached the trigger at all.
 *
 * Two things had to both be true for `main.ts`'s fix (accepting `'create'`
 * alongside `'modify'` on register row 1.4's `vault.watch`) to be safe, not
 * merely "no longer filtered":
 *
 *  1. Feeding a first sighting through the real trigger must never itself
 *     cause a paid judge call — checked here as genuine runtime behaviour
 *     against the real `MaterialityTrigger` (`ingestion/materiality/
 *     wiring.ts`), which imports no `obsidian` and so is the one piece of
 *     this defect's fix this file can actually execute.
 *  2. `main.ts` must route a `'create'` event through the SAME
 *     `evaluateMaterialityChange` call a `'modify'` event already uses, not
 *     a parallel, less-safe shortcut. `main.ts` itself cannot be imported
 *     under Vitest (`main-wiring.spec.ts`'s own module doc explains why:
 *     `obsidian`'s `package.json` `main` is `""`) — checked here the same
 *     source-level way that file's whole suite does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type {
  MaterialityJudge,
  MaterialityJudgeVerdict,
} from '../src/ingestion/materiality/types.js';
import { buildMaterialityWiring } from '../src/ingestion/materiality/wiring.js';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

/** Same technique `main-wiring.spec.ts` uses: source with prose removed, so a doc paragraph describing the wiring cannot satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');

describe("main.ts's materiality watch reaches a created file, not only a modified one (ol-egov.141.89.11.13)", () => {
  it("the free-gate registration accepts 'create' alongside 'modify', both feeding the SAME evaluateMaterialityChange call — never a second, parallel path", () => {
    expect(main).toMatch(
      /vault\.watch\(\(event\)\s*=>\s*\{\s*if\s*\(event\.kind\s*!==\s*'modify'\s*&&\s*event\.kind\s*!==\s*'create'\)\s*return;\s*void this\.evaluateMaterialityChange\(vault,\s*event\.path\);\s*\}\),/,
    );
  });

  it('the course-setup watch (the pattern this fix follows) still reads create/rename immediately below it, unchanged', () => {
    expect(main).toMatch(
      /vault\.watch\(\(event\)\s*=>\s*\{\s*if\s*\(event\.kind\s*!==\s*'create'\s*&&\s*event\.kind\s*!==\s*'rename'\)\s*return;\s*this\.checkForCourseSetupProposals\(vault\);\s*\}\),/,
    );
  });
});

describe('a first sighting can never itself dispatch a paid materiality judge call (the safety property the fix above depends on)', () => {
  // `main.ts`'s `materialityPreviousText.get(path)` returns `undefined` for
  // any path this session has not seen before — true whether the FIRST event
  // observed for that path is a `'modify'` (today's only accepted kind
  // before this bead) or a `'create'` (accepted from this bead on). This
  // suite drives the real `MaterialityTrigger` exactly that way — a genuine
  // first sighting, `previousText: undefined` — and proves the free gates
  // resolve it without ever calling the judge, regardless of what the judge
  // would have said.

  function buildTriggerWithSpyJudge() {
    const store = new Map<string, unknown>();
    const dataHost = {
      loadData: async () => store.get('blob'),
      saveData: async (data: unknown) => {
        store.set('blob', data);
      },
    };
    const judgeCall = vi.fn<MaterialityJudge['judge']>(
      async (): Promise<MaterialityJudgeVerdict> => {
        throw new Error(
          'a first sighting must resolve through the free gates alone — the judge must never be reached',
        );
      },
    );
    const trigger = buildMaterialityWiring({
      dataHost,
      clock: { now: () => 1_000_000 },
      judge: { judge: judgeCall },
    });
    return { trigger, judgeCall };
  }

  it("a non-empty first sighting resolves to 'judge-unavailable' — never a judge call — because evaluate() has no previousText to send it", async () => {
    const { trigger, judgeCall } = buildTriggerWithSpyJudge();
    const result = await trigger.evaluate(
      'Courses/PSYCH326/lecture-3.md',
      'Some genuinely new material about a concept.',
      undefined,
    );
    expect(result.kind).toBe('judge-unavailable');
    expect(judgeCall).not.toHaveBeenCalled();
  });

  it("'judge-unavailable' is exactly the outcome recordMaterialArrivalIfObserved's observedMaterialChange reads as a real change — this first sighting DOES count as an arrival", () => {
    // The literal boolean `main.ts`'s `observedMaterialChange` implements —
    // duplicated here (six lines) rather than imported, for the same reason
    // every other source-level pin in this package copies main.ts's own
    // logic rather than importing it: main.ts cannot be imported at all
    // under Vitest. Kept honest by the source-level pin in main-wiring.spec.ts
    // ("records an arrival from the real materiality-evaluation result").
    function observedMaterialChange(result: {
      readonly kind: string;
      readonly verdict?: { readonly material: boolean };
    }): boolean {
      return (
        result.kind === 'judge-unavailable' ||
        (result.kind === 'verdict' && result.verdict?.material === true)
      );
    }
    expect(observedMaterialChange({ kind: 'judge-unavailable' })).toBe(true);
  });

  it("an EMPTY first sighting (a genuinely blank created note) resolves to 'no-groundable-content' instead — still never a judge call, and never read as an arrival", async () => {
    const { trigger, judgeCall } = buildTriggerWithSpyJudge();
    const result = await trigger.evaluate('Courses/PSYCH326/new-blank-note.md', '', undefined);
    expect(result.kind).toBe('no-groundable-content');
    expect(judgeCall).not.toHaveBeenCalled();
  });
});
