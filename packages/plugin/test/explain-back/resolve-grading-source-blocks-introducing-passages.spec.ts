/**
 * `ol-egov.141.89.6.36`: coverage for `resolveGradingSourceBlocks`'s new
 * half — resolving a live causes edge's OWN introducing passages
 * (`ConceptRelation.introducingPassages`, a `Provenance` per endpoint) into
 * citable `ExplainBackSourceBlock`s through the new
 * `deps.resolveIntroducingPassage` port, the way `ol-egov.141.89.6.33`
 * already resolves the neighbour's own defining passages through
 * `deps.retrieveSourceBlocks`.
 *
 * `modal.ts` extends Obsidian's `Modal`, and `obsidian`'s `package.json`
 * `main` is `""`, so the module cannot be IMPORTED under Vitest at all
 * (confirmed here the same way `submit-guard.spec.ts` and
 * `relation-composition-root.spec.ts` already document it — attempting the
 * import fails resolving `obsidian` several files deep). This file follows
 * both of this directory's established workarounds:
 *
 * 1. **Extract-and-run** (`submit-guard.spec.ts`'s technique): the new,
 *    self-contained helper `resolveEdgeIntroducingPassages` is small enough
 *    to strip of its TypeScript syntax by exact, checked `.replace()` calls
 *    and evaluate as real, running code via `new Function` — never a
 *    hand-written re-implementation of its logic. This is what proves the
 *    bead's three behavioural cases for real: a resolvable passage adds
 *    exactly that block; a stale/missing one (the port resolving `null`)
 *    adds nothing; an already-present block is not duplicated.
 * 2. **Source-text matching** (`relation-composition-root.spec.ts`'s
 *    technique, already used for this exact exported function's OTHER
 *    half): `resolveGradingSourceBlocks` itself calls `olea-core`'s
 *    `resolveGradingRelationContext`/`buildGradingSourceMaterial`, both
 *    generically typed and too entangled with the rest of the function to
 *    extract cleanly — and both already independently proven to fold a
 *    `ResolvedRelationEdge.introducingPassages` into `sourceBlocks`
 *    (`packages/core/src/mastery/gradingInputContract.spec.ts`, outside
 *    this bead's `owns`). What is NOT already proven anywhere is that
 *    `resolveGradingSourceBlocks` actually wires the new helper's result
 *    into that call, AND into the `lookup` map the final `flatMap` reads —
 *    a block absent from `lookup` is silently dropped even if
 *    `buildGradingSourceMaterial` names it — so that wiring is this file's
 *    second job.
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

const modal = codeOf('explain-back/modal.ts');

interface FakeSourceBlock {
  readonly block: { readonly blockId: string; readonly text: string };
  readonly path: string;
  readonly blockIndex: number;
}

interface FakeConceptRelation {
  readonly introducingPassages: { readonly from: unknown; readonly to: unknown };
}

type ResolveEdgeIntroducingPassages = (
  deps: { resolveIntroducingPassage?: (p: unknown) => Promise<FakeSourceBlock | null> },
  edge: FakeConceptRelation,
  alreadyPresentBlockIds: Set<string>,
) => Promise<readonly FakeSourceBlock[]>;

/**
 * Extracts `resolveEdgeIntroducingPassages`'s own source and evaluates it as
 * a standalone async function — the helper's real logic, run for real,
 * without importing the `obsidian`-dependent module it lives in. The
 * `.replace()` calls below are exact-string, not regex-general, and are
 * asserted to have matched (each old/new pair checked against the raw
 * extract before this function is trusted) — a signature change to the real
 * source makes this extraction fail loudly rather than silently testing
 * stale logic.
 */
function extractResolveEdgeIntroducingPassages(): ResolveEdgeIntroducingPassages {
  const start = modal.indexOf('async function resolveEdgeIntroducingPassages(');
  const end = modal.indexOf('export async function resolveGradingSourceBlocks(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const raw = modal.slice(start, end);

  const typedSignature =
    'async function resolveEdgeIntroducingPassages(\n' +
    "  deps: Pick<ExplainBackModalDeps, 'resolveIntroducingPassage'>,\n" +
    '  edge: ConceptRelation,\n' +
    '  alreadyPresentBlockIds: ReadonlySet<string>,\n' +
    '): Promise<readonly ExplainBackSourceBlock[]> {';
  expect(raw).toContain(typedSignature);
  const typedResolvedDecl = 'const resolved: ExplainBackSourceBlock[] = [];';
  expect(raw).toContain(typedResolvedDecl);

  const source = raw
    .replace(
      typedSignature,
      'return async function resolveEdgeIntroducingPassages(deps, edge, alreadyPresentBlockIds) {',
    )
    .replace(typedResolvedDecl, 'const resolved = [];');

  // eslint-disable-next-line no-new-func
  return new Function(source)() as ResolveEdgeIntroducingPassages;
}

function fakeBlock(blockId: string, text = 'text'): FakeSourceBlock {
  return { block: { blockId, text }, path: 'course/subject.md', blockIndex: 0 };
}

describe('resolveEdgeIntroducingPassages — run for real from its own source (ol-egov.141.89.6.36)', () => {
  const resolveEdgeIntroducingPassages = extractResolveEdgeIntroducingPassages();

  it('an edge with a resolvable introducing passage adds exactly that citable block', async () => {
    const introducingBlock = fakeBlock('intro-block', 'Coughing can trigger bronchitis.');
    const edge: FakeConceptRelation = {
      introducingPassages: { from: { sourcePath: 'from.md' }, to: { sourcePath: 'to.md' } },
    };
    const seen: unknown[] = [];
    const deps = {
      resolveIntroducingPassage: async (p: unknown) => {
        seen.push(p);
        // Only the `from` endpoint resolves — proves the result is exactly
        // one block, not "at least one" or "always both."
        return p === edge.introducingPassages.from ? introducingBlock : null;
      },
    };

    const result = await resolveEdgeIntroducingPassages(deps, edge, new Set());

    expect(result).toEqual([introducingBlock]);
    expect(seen).toEqual([edge.introducingPassages.from, edge.introducingPassages.to]);
  });

  it('a stale or missing passage (the port resolves null) adds nothing', async () => {
    const edge: FakeConceptRelation = {
      introducingPassages: { from: { sourcePath: 'from.md' }, to: { sourcePath: 'to.md' } },
    };
    const deps = { resolveIntroducingPassage: async () => null };

    const result = await resolveEdgeIntroducingPassages(deps, edge, new Set());

    expect(result).toEqual([]);
  });

  it('no duplicate when the resolved passage is already in the source (alreadyPresentBlockIds)', async () => {
    const existing = fakeBlock('bronchitis-block');
    const edge: FakeConceptRelation = {
      introducingPassages: { from: { sourcePath: 'from.md' }, to: { sourcePath: 'to.md' } },
    };
    const deps = { resolveIntroducingPassage: async () => existing };

    const result = await resolveEdgeIntroducingPassages(
      deps,
      edge,
      new Set([existing.block.blockId]),
    );

    expect(result).toEqual([]);
  });

  it('no duplicate between the two endpoints when both resolve to the SAME block', async () => {
    const same = fakeBlock('same-block');
    const edge: FakeConceptRelation = {
      introducingPassages: { from: { sourcePath: 'from.md' }, to: { sourcePath: 'to.md' } },
    };
    const deps = { resolveIntroducingPassage: async () => same };

    const result = await resolveEdgeIntroducingPassages(deps, edge, new Set());

    expect(result).toEqual([same]);
  });

  it('no port supplied (absent dep, main.ts has not wired one) resolves nothing — never throws', async () => {
    const edge: FakeConceptRelation = {
      introducingPassages: { from: { sourcePath: 'from.md' }, to: { sourcePath: 'to.md' } },
    };

    const result = await resolveEdgeIntroducingPassages({}, edge, new Set());

    expect(result).toEqual([]);
  });
});

describe("resolveGradingSourceBlocks: wires resolveEdgeIntroducingPassages in (source-level, matching relation-composition-root.spec.ts's technique for this same function's other half)", () => {
  function body(): string {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return modal.slice(start, end);
  }

  it('declares resolveIntroducingPassage as an optional dep, absent by default', () => {
    expect(modal).toMatch(
      /readonly resolveIntroducingPassage\?: \(\s*provenance: Provenance,\s*\) => Promise<ExplainBackSourceBlock \| null>;/,
    );
  });

  it('computes alreadyPresentBlockIds from sourceBlocks and neighbourBlocks, then calls resolveEdgeIntroducingPassages with the edge', () => {
    const b = body();
    expect(b).toMatch(
      /const alreadyPresentBlockIds = new Set\(\s*\[\.\.\.sourceBlocks, \.\.\.neighbourBlocks\]\.map\(\(entry\) => entry\.block\.blockId\),\s*\);/,
    );
    expect(b).toMatch(
      /introducingBlocks = await resolveEdgeIntroducingPassages\(deps, edge, alreadyPresentBlockIds\);/,
    );
  });

  it('threads the resolved introducingBlocks into named.edge.introducingPassages — never the hardcoded [] this bead replaces', () => {
    const b = body();
    expect(b).toMatch(/introducingPassages: introducingBlocks\.map\(\(entry\) => entry\.block\),/);
    expect(b).not.toMatch(/introducingPassages: \[\],/);
  });

  it('adds introducingBlocks to the lookup map the final flatMap reads — otherwise buildGradingSourceMaterial could name a block that silently drops out', () => {
    const b = body();
    expect(b).toMatch(
      /for \(const entry of \[\.\.\.sourceBlocks, \.\.\.neighbourBlocks, \.\.\.introducingBlocks\]\) \{\s*lookup\.set\(entry\.block\.blockId, entry\);\s*\}/,
    );
  });
});

describe("the SOLO denominator effect (this bead's acceptance criteria): decided KEPT", () => {
  it("documents the decision: request.ts (outside this bead's owns) sets omissionDenominator: context.sourceBlocks unconditionally, and context.sourceBlocks is exactly gradingSourceBlocks — so a resolved introducing passage reaches SOLO's denominator the same way it reaches the correctness judge; kept as consistent with F5.3 (\"subject material plus edge provenance, nothing wider\" — an introducing passage IS edge provenance, unlike the neighbour's own defining passages, which F5.3 explicitly excludes and which a PRE-EXISTING gap already lets through today, unrelated to this bead's change — see the report's Follow-ups)", () => {
    // A structural check that the coupling this decision rests on still
    // holds: `resolveInstrumentPrompt`/`resolveTopicPrompt` pass
    // `gradingSourceBlocks` (this function's return value, which now
    // includes any resolved introducing-passage block) straight into
    // `buildExplainBackPromptContextFromInstrument`/`FromTopic`, whose
    // `context.sourceBlocks` `request.ts`'s `buildGradeSoloInputFromTypedAnswer`
    // reads for BOTH `sourceMaterial.sourceBlocks` and
    // `sourceMaterial.omissionDenominator` (`request.spec.ts`, `ol-egov.141.89.6.36`'s
    // own report cites the exact lines). If this call site ever stops
    // passing the widened `gradingSourceBlocks` through, this decision's
    // premise breaks and it needs re-deciding.
    const start = modal.indexOf('private async resolveInstrumentPrompt(');
    const end = modal.indexOf('private async resolveTopicPrompt(');
    const b = modal.slice(start, end);
    expect(b).toMatch(
      /buildExplainBackPromptContextFromInstrument\(\s*instrument,\s*gradingSourceBlocks,\s*misconceptionDigest,\s*\);/,
    );
  });
});
