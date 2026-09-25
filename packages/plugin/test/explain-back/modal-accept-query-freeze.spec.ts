/**
 * `ol-egov.141.89.6.16`: the accept-time staleness recheck must re-retrieve
 * with the EXACT query the original prompt was built from — never a second,
 * independently rebuilt query string. Before this bead's fix,
 * `computeAcceptGrading` passed `prompt.context.question` to
 * `deps.buildObservationContext`, a DIFFERENT string than the one
 * `resolveInstrumentPrompt`/`resolveTopicPrompt` actually retrieved
 * `sourceBlocks` against — for a cloze instrument (`questionQuery` joins
 * `before`/`after` with a space; `request.ts`'s
 * `questionAndReferenceAnswerForCloze` joins the same pair with a literal
 * `____` blank marker) and, independently, for every topic-seeded prompt
 * (`resolveTopicPrompt` retrieves against the bare topic string, but
 * `buildExplainBackPromptContextFromTopic` wraps it as "In your own words:
 * explain ….") A false stale silently drops a correct answer from the
 * record; a missed real change accepts a grading whose source no longer
 * says what the judge read.
 *
 * Source-level assertion for `modal.ts` itself, same convention as every
 * other `modal-*.spec.ts` in this directory: it extends Obsidian's `Modal`,
 * and `obsidian`'s `package.json` `main` is `""`, so it cannot be loaded
 * under Vitest at all. Comments are stripped before matching so a doc
 * paragraph describing the freeze can't satisfy an assertion that the
 * freeze actually exists in the code. The cloze divergence itself IS
 * demonstrated behaviourally, through `request.ts`'s real, exported
 * `buildExplainBackPromptContextFromInstrument` (no `obsidian` import in
 * that file) compared against `modal.ts`'s own private `questionQuery`,
 * read from source text since it cannot be imported.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildExplainBackPromptContextFromInstrument } from '../../src/explain-back/request.js';
import { clozeFixture } from '../review/fixtures.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — see this file's module doc. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

function bodyBetween(startMarker: string, endMarker: string): string {
  const start = modal.indexOf(startMarker);
  const end = modal.indexOf(endMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return modal.slice(start, end);
}

describe('ol-egov.141.89.6.16: the cloze retrieval query and the prompt question text genuinely differ', () => {
  it('questionQuery (the actual retrieval call) space-joins a cloze before/after; context.question blank-marker-joins the same pair', () => {
    const cloze = clozeFixture({ before: 'The ', after: ' drives consolidation.' });
    const context = buildExplainBackPromptContextFromInstrument(cloze, []);
    expect(context.question).toBe(`${cloze.before}____${cloze.after}`);

    // `questionQuery` is private in modal.ts and cannot be imported (see
    // this file's module doc) — read its cloze branch straight from source.
    const questionQueryMatch = modal.match(
      /function questionQuery\(instrument: ReviewInstrument\): string \{[\s\S]*?\n\}/,
    );
    expect(questionQueryMatch).not.toBeNull();
    const questionQuerySource = questionQueryMatch?.[0] ?? '';
    expect(questionQuerySource).toMatch(
      /case 'cloze':\s*return `\$\{instrument\.before\} \$\{instrument\.after\}`;/,
    );
    const retrievalQuery = `${cloze.before} ${cloze.after}`;

    // The regression this whole bead is about: these two strings must never
    // be silently treated as interchangeable.
    expect(retrievalQuery).not.toBe(context.question);
  });
});

describe('ol-egov.141.89.6.16: the accept-time recheck reuses the frozen build-time query, never a second, rebuilt one', () => {
  it('ResolvedPrompt carries a query field', () => {
    expect(modal).toMatch(/interface ResolvedPrompt \{[\s\S]{0,900}?readonly query: string;/);
  });

  it('resolveInstrumentPrompt freezes the exact string it retrieved with onto the prompt', () => {
    const body = bodyBetween(
      'private async resolveInstrumentPrompt(',
      'private async resolveTopicPrompt(',
    );
    expect(body).toMatch(/const query = questionQuery\(instrument\);/);
    expect(body).toMatch(/const sourceBlocks = await this\.deps\.retrieveSourceBlocks\(query\);/);
    // The fix: `query` must be threaded onto the constructed ResolvedPrompt,
    // not silently dropped in favour of re-deriving it from
    // `context.question` at accept time.
    expect(body).toMatch(/const prompt: ResolvedPrompt = \{[\s\S]{0,200}?\n\s*query,\n\s*\};/);
  });

  it('resolveTopicPrompt freezes the exact topic string it retrieved with onto BOTH prompts it constructs (the insufficient-notes refusal and the answering phase)', () => {
    const body = bodyBetween('private async resolveTopicPrompt(', 'private async submitAnswer(');
    expect(body).toMatch(/const sourceBlocks = await this\.deps\.retrieveSourceBlocks\(topic\);/);
    const promptConstructions =
      body.match(/const prompt: ResolvedPrompt = \{[\s\S]{0,200}?\n\s*\};/g) ?? [];
    expect(promptConstructions).toHaveLength(2);
    for (const construction of promptConstructions) {
      expect(construction).toMatch(/query: topic,/);
    }
  });

  it('computeAcceptGrading passes the frozen prompt.query to buildObservationContext, never prompt.context.question', () => {
    const body = bodyBetween('private async computeAcceptGrading(', 'private discardGrading(');
    const observationCallStart = body.indexOf('await this.deps.buildObservationContext({');
    expect(observationCallStart).toBeGreaterThanOrEqual(0);
    const observationCallEnd = body.indexOf('})),', observationCallStart);
    expect(observationCallEnd).toBeGreaterThan(observationCallStart);
    const observationCall = body.slice(observationCallStart, observationCallEnd);
    expect(observationCall).toMatch(/query: prompt\.query,/);
    expect(observationCall).not.toMatch(/prompt\.context\.question/);
  });
});
