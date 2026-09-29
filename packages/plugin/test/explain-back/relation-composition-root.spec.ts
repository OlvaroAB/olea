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
 *
 * `ol-egov.141.89.6.74`: the subject id these two files pass around is a concept
 * KEY (`instrument.conceptIds[0]`), and an edge's `from`/`to` are wordings. The
 * comparison of one with the other could never hold, so the pins below encode the
 * repaired shape (`main.ts` makes one call into `request.ts`'s
 * `resolveExplainBackCausesPartner`; `modal.ts` retrieves by the partner's
 * WORDING and names the neighbour everywhere else by its KEY) and refuse the
 * comparison itself in either file. What the repaired lookup does is proven
 * behaviourally in `request.spec.ts` and `causes-partner-from-corpus-stage.spec.ts`.
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
  it('imports resolveExplainBackCausesPartner alongside the existing retrieveExplainBackSourceBlocks', () => {
    expect(main).toMatch(
      /import \{\s*type ExplainBackRelationPartner,\s*type ExplainBackSourceBlock,\s*type FreeformTopicConceptMatch,\s*resolveExplainBackCausesPartner,\s*retrieveExplainBackSourceBlocks,\s*\} from '\.\/explain-back\/request\.js';/,
    );
  });

  it('composeExplainBackSourceBlocks supplies the raw this.relations and this.conceptRecords thunks on ExplainBackRetrievalDeps', () => {
    const start = main.indexOf('private async composeExplainBackSourceBlocks(');
    const end = main.indexOf('private resolveExplainBackCausesPartner(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = main.slice(start, end);
    expect(body).toMatch(/relations: \(\) => this\.relations,/);
    expect(body).toMatch(/conceptRecords: \(\) => this\.conceptRecords,/);
  });

  it('is one call into request.ts with the RAW this.relations and this.conceptRecords thunks (never servedRelationEdges()’s already-filtered array), passing the subject key through', () => {
    const start = main.indexOf('private resolveExplainBackCausesPartner(');
    const end = main.indexOf('matchFreeformTopicConcept(topic', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = main.slice(start, end);
    expect(body).toMatch(
      /return resolveExplainBackCausesPartner\(\s*\{ relations: \(\) => this\.relations, conceptRecords: \(\) => this\.conceptRecords \},\s*subjectConceptId,\s*\);/,
    );
    // `request.ts`'s function is what reads `servedRelations` (rel.md Default 4); this method
    // must not be a second, ungated scan of its own.
    expect(body).not.toMatch(/servedRelations|servedRelationEdges/);
  });

  it('never compares an edge’s wording with the subject id: no from/to comparison is left in the resolver (ol-egov.141.89.6.74)', () => {
    const start = main.indexOf('private resolveExplainBackCausesPartner(');
    const end = main.indexOf('matchFreeformTopicConcept(topic', start);
    const body = main.slice(start, end);
    expect(body).not.toMatch(/\.(?:from|to)\s*(?:===|!==)/);
    expect(body).not.toMatch(/(?:===|!==)\s*\w+\.(?:from|to)\b/);
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
      /readonly resolveCausesPartner\?: \(\s*subjectConceptId: string,\s*\) => ExplainBackRelationPartner \| undefined;/,
    );
  });

  it('resolveGradingSourceBlocks calls resolveCausesPartner, then retrieves the neighbour and calls resolveGradingRelationContext and buildGradingSourceMaterial', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /const partner =\s*subjectConceptId !== null \? deps\.resolveCausesPartner\?\.\(subjectConceptId\) : undefined;/,
    );
    // The partner names the OTHER end from the subject; retrieval takes its WORDING (a query),
    // and the material takes its KEY (an identity) — `ol-egov.141.89.6.74`.
    expect(body).toMatch(
      /const \{ edge, neighbourConceptId, neighbourName \} = partner;\s*neighbourBlocks = await deps\.retrieveSourceBlocks\(neighbourName\);/,
    );
    expect(body).toMatch(/named = \{\s*neighbourConceptId,/);
    expect(body).toMatch(/conceptId: named\.neighbourConceptId,/);
    expect(body).toMatch(
      /const relation: GradingRelationContext = resolveGradingRelationContext\(named\);/,
    );
    expect(body).toMatch(/const material = buildGradingSourceMaterial\(\{/);
  });

  it('never works out which end of the edge the subject is: no from/to comparison is left in resolveGradingSourceBlocks (ol-egov.141.89.6.74)', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    const body = modal.slice(start, end);
    expect(body).not.toMatch(/\.(?:from|to)\s*(?:===|!==)/);
    expect(body).not.toMatch(/(?:===|!==)\s*\w+\.(?:from|to)\b/);
  });

  it('a null subjectConceptId (the topic entry point) short-circuits to the unchanged sourceBlocks, never calling buildGradingSourceMaterial', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    const body = modal.slice(start, end);
    // `ol-egov.141.89.6.50`: widened from a bare `return sourceBlocks;` to a
    // full `ResolvedGradingSourceBlocks` object literal — `sourceMaterial`
    // and `relationExpected` must be threaded here too, not just the blocks;
    // `ol-egov.141.89.6.75` added the neighbour key, `undefined` here (no subject, so no partner).
    const earlyReturnMarker = 'if (subjectConceptId === null) {';
    expect(body).toMatch(
      /if \(subjectConceptId === null\) \{\s*return \{\s*sourceBlocks,\s*sourceMaterial: undefined,\s*relationExpected: false,\s*neighbourConceptId: undefined,\s*\};\s*\}/,
    );
    // The early return textually precedes the buildGradingSourceMaterial call.
    expect(body.indexOf(earlyReturnMarker)).toBeLessThan(
      body.indexOf('const material = buildGradingSourceMaterial('),
    );
  });

  it('resolveInstrumentPrompt feeds the widened gradingSourceBlocks to the judge context, while ResolvedPrompt.sourceBlocks keeps the plain retrieval (citation lookup + accept-time staleness comparison)', () => {
    const start = modal.indexOf('private async resolveInstrumentPrompt(');
    const end = modal.indexOf('private async resolveTopicPrompt(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    // `ol-egov.141.89.6.50`: `resolveGradingSourceBlocks` now returns a
    // `ResolvedGradingSourceBlocks` object — `gradingSourceBlocks` is
    // derived from its `.sourceBlocks` field, one line down.
    expect(body).toMatch(
      /const resolvedGrading = await resolveGradingSourceBlocks\(\s*this\.deps,\s*subjectConceptId,\s*sourceBlocks,\s*\);\s*const gradingSourceBlocks = resolvedGrading\.sourceBlocks;/,
    );
    expect(body).toMatch(
      /buildExplainBackPromptContextFromInstrument\(\s*instrument,\s*gradingSourceBlocks,\s*misconceptionDigest,\s*\);/,
    );
    // `ol-0r92.104` [DOS-I9] added `conceptIds` to this construction (a
    // non-attempt record's own field, D7.1); `ol-egov.141.89.6.50` added
    // `sourceMaterial`/`relationExpected`, carried to accept time;
    // `ol-egov.141.89.6.75` added `neighbourConceptId`, the resolved partner's key, beside them;
    // `ol-egov.141.89.6.4` (`[D-322]`) added `practiceOnly`, always `false`
    // here; `[STY-9]` (`ol-l5og.18.19`) added `courseCode`/`noteTitle`, the
    // seeding instrument's own fields, real data for the identity strip —
    // matched by name here rather than wildcarded, so an unrelated
    // future field slipping in unnoticed still fails this assertion instead
    // of silently passing through a loose wildcard.
    expect(body).toMatch(
      /const prompt: ResolvedPrompt = \{\s*context,\s*subjectConceptId,\s*practiceOnly: false,\s*originInstrumentId: instrument\.instrumentId,\s*sourceBlocks,\s*conceptIds: instrument\.conceptIds,\s*query,\s*sourceMaterial: resolvedGrading\.sourceMaterial,\s*relationExpected: resolvedGrading\.relationExpected,\s*neighbourConceptId: resolvedGrading\.neighbourConceptId,\s*courseCode: instrument\.courseCode,\s*noteTitle: instrument\.noteTitle,\s*\};/,
    );
  });

  it('resolveTopicPrompt also routes through resolveGradingSourceBlocks with a null subjectConceptId', () => {
    const start = modal.indexOf('private async resolveTopicPrompt(');
    const end = modal.indexOf('private async submitAnswer(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /const resolvedGrading = await resolveGradingSourceBlocks\(this\.deps, null, sourceBlocks\);\s*const gradingSourceBlocks = resolvedGrading\.sourceBlocks;/,
    );
    expect(body).toMatch(/buildExplainBackPromptContextFromTopic\(topic, gradingSourceBlocks\);/);
  });
});
