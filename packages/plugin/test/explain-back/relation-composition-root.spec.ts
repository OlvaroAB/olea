/**
 * `ol-egov.141.89.6.33`: source-level proof that the composition root
 * (`main.ts`) and the view (`explain-back/modal.ts`) actually wire rel.md
 * section 1's "Explain-back partner (causes)" row through to a live
 * grading request — `explain-back/request.ts`'s `resolveExplainBackRelationEdge`
 * and an optional `relations` reader on `ExplainBackRetrievalDeps` landed
 * with no production caller (`ol-egov.141.89.6.30`); this is that caller.
 *
 * Source-level, not behavioural, for the same reason every sibling spec in
 * this directory gives: `main.ts` imports `obsidian` directly (its own
 * module doc, `main-wiring.spec.ts`) and `modal.ts` extends Obsidian's
 * `Modal` and pulls in `registry/obsidian-ports.ts` transitively — neither
 * can be imported under Vitest at all (`obsidian`'s `package.json` `main`
 * is `""`, confirmed by attempting a targeted `vi.mock('obsidian', ...)`
 * shim here first: the import chain reaches `ItemView` and other exports
 * several files deep, which would need an ever-growing hand-maintained
 * fake — exactly what this repo's established pattern avoids). Comments
 * are stripped before matching so a doc paragraph describing the wiring
 * can't satisfy an assertion that the wiring actually exists.
 *
 * The behavioural half of "a current neighbour's passages are included, a
 * stale endpoint's are excluded" is covered where it CAN be covered without
 * an obsidian import: `request.spec.ts` (`ol-egov.141.89.6.30`, already
 * closed) proves `resolveExplainBackRelationEdge` itself excludes a stale
 * or wrong-type edge and serves a current one; `gradingInputContract.spec.ts`
 * (`olea-core`) proves `resolveGradingRelationContext`/
 * `buildGradingSourceMaterial` fold a resolved edge's neighbour into
 * `sourceBlocks`. This file's job is narrower and different in kind: proving
 * `main.ts`/`modal.ts` actually call those already-proven pure functions,
 * with the right arguments, from the real production path.
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
const modal = codeOf('explain-back/modal.ts');

describe('main.ts: resolveExplainBackCausesPartner (rel.md section 1, "Explain-back partner (causes)")', () => {
  it('imports resolveExplainBackRelationEdge alongside the existing retrieveExplainBackSourceBlocks', () => {
    expect(main).toMatch(
      /import \{\s*type ExplainBackSourceBlock,\s*resolveExplainBackRelationEdge,\s*retrieveExplainBackSourceBlocks,\s*\} from '\.\/explain-back\/request\.js';/,
    );
  });

  it('composeExplainBackSourceBlocks supplies the raw this.relations thunk on ExplainBackRetrievalDeps', () => {
    const start = main.indexOf('private async composeExplainBackSourceBlocks(');
    const end = main.indexOf('private resolveExplainBackCausesPartner(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = main.slice(start, end);
    expect(body).toMatch(/relations: \(\) => this\.relations,/);
  });

  it('finds a candidate causes edge through the SAME gated servedRelations(this.relations) read servedRelationEdges() uses, never an ungated scan', () => {
    const start = main.indexOf('private resolveExplainBackCausesPartner(');
    const end = main.indexOf('buildExplainBackObservationContextFor', start);
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, end);
    expect(body).toMatch(
      /const candidate = servedRelations\(this\.relations\)\.find\(\s*\(edge\) =>\s*edge\.type === 'causes' &&\s*\(edge\.from === subjectConceptId \|\| edge\.to === subjectConceptId\),\s*\);/,
    );
  });

  it('resolves the neighbour as the OTHER endpoint from subjectConceptId, then re-confirms through resolveExplainBackRelationEdge with the RAW this.relations thunk (never servedRelationEdges()’s already-filtered array)', () => {
    const start = main.indexOf('private resolveExplainBackCausesPartner(');
    const end = main.indexOf('buildExplainBackObservationContextFor', start);
    const body = main.slice(start, end);
    expect(body).toMatch(
      /const neighbourConceptId =\s*candidate\.from === subjectConceptId \? candidate\.to : candidate\.from;/,
    );
    expect(body).toMatch(
      /return resolveExplainBackRelationEdge\(\s*\{ relations: \(\) => this\.relations \},\s*subjectConceptId,\s*neighbourConceptId,\s*\);/,
    );
    // Never the already-gated array — `resolveExplainBackRelationEdge` must
    // be the thing that applies rel.md Default 4, not a trusted upstream
    // filter this method re-derives its own way.
    expect(body).not.toMatch(
      /resolveExplainBackRelationEdge\(\s*\{ relations: \(\) => servedRelationEdges/,
    );
  });

  it('openExplainBackModal wires resolveCausesPartner to the real method', () => {
    const start = main.indexOf('private openExplainBackModal(');
    const end = main.indexOf('evaluateConfusionRouting(', start);
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, end);
    expect(body).toMatch(
      /resolveCausesPartner: \(subjectConceptId\) =>\s*this\.resolveExplainBackCausesPartner\(subjectConceptId\),/,
    );
  });
});

describe('explain-back/modal.ts: resolveGradingSourceBlocks threads the resolved neighbour through the real core functions', () => {
  it('imports buildGradingSourceMaterial and resolveGradingRelationContext from olea-core', () => {
    expect(modal).toMatch(/buildGradingSourceMaterial,/);
    expect(modal).toMatch(/resolveGradingRelationContext,/);
  });

  it('declares resolveCausesPartner as an optional dep, absent by default (every pre-existing caller keeps its concept-only behaviour)', () => {
    expect(modal).toMatch(
      /readonly resolveCausesPartner\?: \(subjectConceptId: string\) => ConceptRelation \| undefined;/,
    );
  });

  it('resolveGradingSourceBlocks calls resolveCausesPartner, then retrieves the neighbour and calls resolveGradingRelationContext and buildGradingSourceMaterial', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /subjectConceptId !== null \? deps\.resolveCausesPartner\?\.\(subjectConceptId\) : undefined;/,
    );
    expect(body).toMatch(
      /neighbourBlocks = await deps\.retrieveSourceBlocks\(neighbourConceptId\);/,
    );
    expect(body).toMatch(
      /const relation: GradingRelationContext = resolveGradingRelationContext\(named\);/,
    );
    expect(body).toMatch(/const material = buildGradingSourceMaterial\(\{/);
  });

  it('a null subjectConceptId (the topic entry point) short-circuits to the unchanged sourceBlocks, never calling buildGradingSourceMaterial', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/if \(subjectConceptId === null\) return sourceBlocks;/);
    // The early return textually precedes the buildGradingSourceMaterial call.
    expect(body.indexOf('if (subjectConceptId === null) return sourceBlocks;')).toBeLessThan(
      body.indexOf('const material = buildGradingSourceMaterial('),
    );
  });

  it('resolveInstrumentPrompt feeds the widened gradingSourceBlocks to the judge context, while ResolvedPrompt.sourceBlocks keeps the plain retrieval (citation lookup + accept-time staleness comparison)', () => {
    const start = modal.indexOf('private async resolveInstrumentPrompt(');
    const end = modal.indexOf('private async resolveTopicPrompt(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /const gradingSourceBlocks = await resolveGradingSourceBlocks\(\s*this\.deps,\s*subjectConceptId,\s*sourceBlocks,\s*\);/,
    );
    expect(body).toMatch(
      /buildExplainBackPromptContextFromInstrument\(\s*instrument,\s*gradingSourceBlocks,\s*misconceptionDigest,\s*\);/,
    );
    expect(body).toMatch(
      /const prompt: ResolvedPrompt = \{\s*context,\s*subjectConceptId,\s*originInstrumentId: instrument\.instrumentId,\s*sourceBlocks,\s*query,\s*\};/,
    );
  });

  it('resolveTopicPrompt also routes through resolveGradingSourceBlocks with a null subjectConceptId', () => {
    const start = modal.indexOf('private async resolveTopicPrompt(');
    const end = modal.indexOf('private async submitAnswer(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /const gradingSourceBlocks = await resolveGradingSourceBlocks\(this\.deps, null, sourceBlocks\);/,
    );
    expect(body).toMatch(/buildExplainBackPromptContextFromTopic\(topic, gradingSourceBlocks\);/);
  });
});
