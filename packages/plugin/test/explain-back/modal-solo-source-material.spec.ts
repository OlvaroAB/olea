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
  it('declares ResolvedGradingSourceBlocks with sourceBlocks, sourceMaterial and relationExpected', () => {
    const start = modal.indexOf('export interface ResolvedGradingSourceBlocks {');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('export async function resolveGradingSourceBlocks(', start);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/readonly sourceBlocks: readonly ExplainBackSourceBlock\[\];/);
    expect(body).toMatch(/readonly sourceMaterial: GradingSourceMaterial \| undefined;/);
    expect(body).toMatch(/readonly relationExpected: boolean;/);
  });

  it('the null-subjectConceptId early return carries sourceMaterial: undefined, relationExpected: false — never a bare blocks array', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /if \(subjectConceptId === null\) \{\s*return \{ sourceBlocks, sourceMaterial: undefined, relationExpected: false \};\s*\}/,
    );
  });

  it('the relation-resolved path returns the real material and relationExpected computed from relation.kind, never hardcoded', () => {
    const start = modal.indexOf('export async function resolveGradingSourceBlocks(');
    const end = modal.indexOf('interface ResolvedPrompt', start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /return \{\s*sourceBlocks: flattenedSourceBlocks,\s*sourceMaterial: material,\s*relationExpected: relation\.kind === 'relation',\s*\};/,
    );
  });
});

describe('ResolvedPrompt carries sourceMaterial and relationExpected to accept time', () => {
  it('interface ResolvedPrompt declares both fields', () => {
    const start = modal.indexOf('interface ResolvedPrompt {');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('}', modal.indexOf('readonly relationExpected: boolean;', start));
    const body = modal.slice(start, end);
    expect(body).toMatch(/readonly sourceMaterial: GradingSourceMaterial \| undefined;/);
    expect(body).toMatch(/readonly relationExpected: boolean;/);
  });

  it('resolveInstrumentPrompt threads resolvedGrading.sourceMaterial/.relationExpected onto the constructed prompt', () => {
    const start = modal.indexOf('private async resolveInstrumentPrompt(');
    const end = modal.indexOf('private async resolveTopicPrompt(');
    const body = modal.slice(start, end);
    expect(body).toMatch(/sourceMaterial: resolvedGrading\.sourceMaterial,/);
    expect(body).toMatch(/relationExpected: resolvedGrading\.relationExpected,/);
  });

  it('resolveTopicPrompt threads them onto BOTH prompts it constructs (the insufficient-notes refusal and the answering phase)', () => {
    const start = modal.indexOf('private async resolveTopicPrompt(');
    const end = modal.indexOf('private async submitAnswer(');
    const body = modal.slice(start, end);
    const sourceMaterialHits =
      body.match(/sourceMaterial: resolvedGrading\.sourceMaterial,/g) ?? [];
    const relationExpectedHits =
      body.match(/relationExpected: resolvedGrading\.relationExpected,/g) ?? [];
    expect(sourceMaterialHits).toHaveLength(2);
    expect(relationExpectedHits).toHaveLength(2);
  });
});

describe('ExplainBackModalDeps.recordSoloGradeAndReview declares sourceMaterial/relationExpected as optional params', () => {
  it('declares both fields on the params object type', () => {
    const start = modal.indexOf('readonly recordSoloGradeAndReview?: (params: {');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('}) => Promise<SoloLevel | undefined>;', start);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/readonly sourceMaterial\?: GradingSourceMaterial;/);
    expect(body).toMatch(/readonly relationExpected\?: boolean;/);
  });
});

describe('computeAcceptGrading forwards prompt.sourceMaterial (conditionally) and prompt.relationExpected (always) to deps.recordSoloGradeAndReview', () => {
  it('spreads sourceMaterial conditionally — absent, never an explicit undefined, when prompt.sourceMaterial is undefined', () => {
    const start = modal.indexOf('private async computeAcceptGrading(');
    const end = modal.indexOf('private discardGrading(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /\.\.\.\(prompt\.sourceMaterial !== undefined\s*\?\s*\{ sourceMaterial: prompt\.sourceMaterial \}\s*:\s*\{\}\),/,
    );
  });

  it('sends relationExpected unconditionally, as a bare field, never conditionally spread', () => {
    const start = modal.indexOf('private async computeAcceptGrading(');
    const end = modal.indexOf('private discardGrading(');
    const body = modal.slice(start, end);
    expect(body).toMatch(/relationExpected: prompt\.relationExpected,/);
  });

  it('both appear inside the SAME recordSoloGradeAndReview call that already sends answerEdits and durationMs', () => {
    const start = modal.indexOf('private async computeAcceptGrading(');
    const end = modal.indexOf('private discardGrading(');
    const body = modal.slice(start, end);
    const callStart = body.indexOf(
      'const depthOutcome = await this.deps.recordSoloGradeAndReview({',
    );
    const callEnd = body.indexOf('});', callStart);
    expect(callStart).toBeGreaterThan(-1);
    expect(callEnd).toBeGreaterThan(callStart);
    const call = body.slice(callStart, callEnd);
    expect(call).toMatch(/durationMs,/);
    expect(call).toMatch(/answerEdits,/);
    expect(call).toMatch(/sourceMaterial: prompt\.sourceMaterial/);
    expect(call).toMatch(/relationExpected: prompt\.relationExpected,/);
  });
});
