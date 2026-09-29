/**
 * Scenario: `features/F6-today.md`'s F6.9 data-plumbing block (`olea-service`,
 * "a note that clears the free checks is recorded as processed, whatever the
 * judge says") — the same block `main-wiring.spec.ts` tags `@auto:plugin/
 * main-wiring.spec` for its own recording checks. This file adds the one case
 * that block's wording did not yet cover: a note's very FIRST save (a created
 * file, never before observed this session), which `ol-egov.141.89.11.13`
 * (`docs/dev/intelligence-build/vew.md`) found never reached the trigger at
 * all, and which `ol-egov.141.89.11.27` (`[D-426]`) now records through the
 * processed-revision feed.
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
import { createProcessedRevisionFeed } from '../src/ingestion/processed-revisions/feed.js';
import type { ProcessedRevisionInput } from '../src/ingestion/processed-revisions/store.js';
import { memoryVault } from './review/memory-vault.js';

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

/** A feed over an empty vault and a store that only collects what is recorded: the one seam these checks assert against. */
function feedOverNothing() {
  const recorded: ProcessedRevisionInput[] = [];
  const feed = createProcessedRevisionFeed({
    store: {
      async load() {
        throw new Error('not read here');
      },
      async recordProcessed(input) {
        recorded.push(input);
      },
      async rebuild() {},
    },
    vault: memoryVault(),
    manifestsFor: async () => new Map(),
  });
  return { feed, recorded };
}

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

  it("the feed records that first sighting as processed: 'judge-unavailable' is a processing moment, so a created note counts", async () => {
    const { trigger } = buildTriggerWithSpyJudge();
    const { feed, recorded } = feedOverNothing();
    await feed.start();
    const path = '01 Courses/FIXTURE101/lecture-3.md';
    const text = 'Some genuinely new material about a concept.';
    const result = await trigger.evaluate(path, text, undefined);
    await feed.noteEvaluated(path, text, result);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ path, courses: ['FIXTURE101'], state: 'read' });
  });

  it("an EMPTY first sighting (a genuinely blank created note) resolves to 'no-groundable-content' instead — still never a judge call, and never recorded as processed", async () => {
    const { trigger, judgeCall } = buildTriggerWithSpyJudge();
    const result = await trigger.evaluate('Courses/PSYCH326/new-blank-note.md', '', undefined);
    expect(result.kind).toBe('no-groundable-content');
    expect(judgeCall).not.toHaveBeenCalled();
    const { feed, recorded } = feedOverNothing();
    await feed.start();
    await feed.noteEvaluated('01 Courses/FIXTURE101/new-blank-note.md', '', result);
    expect(recorded).toEqual([]);
  });
});

describe("Olea's own home-note writes never enter the materiality gate (ol-egov.141.6.27)", () => {
  it("evaluateMaterialityChange returns before evaluating when the text is one of Olea's home notes, so the self-write cannot count as a change to her material or set off another sweep", () => {
    const body = main.slice(main.indexOf('private async evaluateMaterialityChange'));
    const guard = body.indexOf('isOleaHomeNote(currentText)');
    const evaluate = body.indexOf('this.materiality.evaluate(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(evaluate);
  });

  it('the predicate recognises an Olea home note and never one she authored', async () => {
    const { isOleaHomeNote } = await import('../src/generation/home-note.js');
    expect(isOleaHomeNote('---\ntopic:\n  - X\nolea-home-note: true\n---\n\nbody\n')).toBe(true);
    expect(isOleaHomeNote('---\ntopic: [X]\n---\n\nher note\n')).toBe(false);
  });
});
