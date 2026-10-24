/**
 * `ol-egov.141.89.6.50` — source-level coverage for `modal.ts`'s half of
 * this bead: `resolveGradingSourceBlocks` must keep the `GradingSourceMaterial`
 * it builds (not just the flattened blocks), `ResolvedPrompt` must carry it
 * to accept time, and `computeAcceptGrading` must forward it — plus
 * `relationExpected` — onto `deps.recordSoloGradeAndReview`'s params.
 *
 * `modal.ts` extends Obsidian's `Modal` and cannot be imported under Vitest
 * (`obsidian`'s `package.json main` is `""` — see this directory's sibling
 * specs, e.g. `resolve-grading-source-blocks-introducing-passages.spec.ts`,
 * for the same constraint and the same comments-stripped source-matching
 * workaround used here). The runtime half of this bead — that
 * `solo-review.ts` actually forwards these fields into
 * `buildGradeSoloInputFromTypedAnswer`'s `resolved` argument correctly — is
 * covered directly, with no source-extraction needed, in
 * `solo-review-source-material.spec.ts`.
 *
 * `ol-egov.141.89.6.75` adds the neighbour's concept KEY to the same hand-off: the resolved partner's
 * `neighbourConceptId` rides on `ResolvedGradingSourceBlocks` and `ResolvedPrompt` beside
 * `sourceMaterial`, and reaches the write in the accepted-attempt call (the pins below), so the
 * F5.3a scheduling observation can name the neighbour by key.
 *
 * **v0.9 (`[D-603]`, `ol-egov.141.89.6.129`):** no accepted attempt is written, so nothing carries
 * the material or the key to a write. The lookup still returns both, unchanged, for when grading
 * returns; what the view takes from it now is the passages (the flattened blocks) and the prompt's
 * shape, with the two wordings a relation's reflection prompt names (registry §39).
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

describe('resolveGradingSourceBlocks returns the material and relationExpected, not just the flattened blocks', () => {
  it('declares ResolvedGradingSourceBlocks with sourceBlocks, sourceMaterial, relationExpected and the neighbour key', () => {
    const start = modal.indexOf('export interface ResolvedGradingSourceBlocks {');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('export async function resolveGradingSourceBlocks(', start);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/readonly sourceBlocks: readonly ExplainBackSourceBlock\[\];/);
    expect(body).toMatch(/readonly sourceMaterial: GradingSourceMaterial \| undefined;/);
    expect(body).toMatch(/readonly relationExpected: boolean;/);
    expect(body).toMatch(/readonly neighbourConceptId: string \| undefined;/);
    expect(body).toMatch(
      /readonly relationNames: \{ readonly concept: string; readonly neighbour: string \} \| undefined;/,
    );
  });

  it('the null-subjectConceptId early return carries sourceMaterial: undefined, relationExpected: false and no neighbour key — never a bare blocks array', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /if \(subjectConceptId === null\) \{\s*return \{\s*sourceBlocks,\s*sourceMaterial: undefined,\s*relationExpected: false,\s*neighbourConceptId: undefined,\s*relationNames: undefined,\s*\};\s*\}/,
    );
  });

  it('the relation-resolved path returns the real material, relationExpected computed from relation.kind (never hardcoded) and the partner key it composed the relation from', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /return \{\s*sourceBlocks: flattenedSourceBlocks,\s*sourceMaterial: material,\s*relationExpected: relation\.kind === 'relation',\s*neighbourConceptId: named\?\.neighbourConceptId,\s*relationNames: relation\.kind === 'relation' \? relationNames : undefined,\s*\};/,
    );
  });
});

describe('v0.9: ResolvedPrompt carries the passages and the prompt’s shape from the lookup', () => {
  it('interface ResolvedPrompt declares the passages and the shape, and no material or key for a write', () => {
    const start = modal.indexOf('interface ResolvedPrompt {');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('\n}', start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/readonly passages: readonly ExplainBackSourceBlock\[\];/);
    expect(body).toMatch(/readonly shape: ExplainBackReflectionShape;/);
    expect(body).not.toMatch(/sourceMaterial|relationExpected|neighbourConceptId/);
  });

  it('resolveInstrumentPrompt takes the passages from the lookup, and makes the prompt a relation only when one resolved with both wordings', () => {
    const start = modal.indexOf('private async resolveInstrumentPrompt(');
    const end = modal.indexOf('private async resolveTopicPrompt(');
    const body = modal.slice(start, end);
    expect(body).toMatch(/await resolveGradingSourceBlocks\(\s*this\.deps,\s*subjectConceptId,/);
    expect(body).toMatch(/passages: lookup\.sourceBlocks,/);
    expect(body).toMatch(
      /lookup\.relationExpected && lookup\.relationNames !== undefined\s*\?\s*\{ kind: 'relation', \.\.\.lookup\.relationNames \}\s*:\s*\{ kind: 'concept' \}/,
    );
  });

  it('resolveTopicPrompt’s one prompt (it is never refused, [D-629]) is a concept prompt over the lookup’s blocks', () => {
    const start = modal.indexOf('private async resolveTopicPrompt(');
    const end = modal.indexOf('private enterNewQuestion(');
    const body = modal.slice(start, end);
    expect(body.match(/const prompt: ResolvedPrompt = \{/g)).toHaveLength(1);
    expect(body).toMatch(/passages: lookup\.sourceBlocks,/);
    expect(body).toMatch(/shape: \{ kind: 'concept' \},/);
  });
});

describe('ExplainBackModalDeps.recordSoloGradeAndReview declares sourceMaterial/relationExpected/neighbourConceptId as optional params', () => {
  it('declares all three fields on the params object type', () => {
    const start = modal.indexOf('readonly recordSoloGradeAndReview?: (params: {');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('}) => Promise<SoloLevel | undefined>;', start);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/readonly sourceMaterial\?: GradingSourceMaterial;/);
    expect(body).toMatch(/readonly relationExpected\?: boolean;/);
    expect(body).toMatch(/readonly neighbourConceptId\?: string;/);
  });
});

describe('v0.9: no write takes the material or the neighbour key', () => {
  it('the view makes no recordSoloGradeAndReview call, so nothing forwards them', () => {
    expect(modal).not.toMatch(/this\.deps\.recordSoloGradeAndReview\(/);
    expect(modal).not.toMatch(
      /prompt\.sourceMaterial|prompt\.relationExpected|prompt\.neighbourConceptId/,
    );
  });
});
