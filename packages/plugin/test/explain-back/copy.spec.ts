/**
 * The explain-back view's copy. In v0.9 the practice view's words are vocabulary registry §39's
 * (`[D-611]`), exactly; the words §39 retires, and the depth line `[D-603]` removes (F5.3 as
 * amended), are gone; and the voice charter (`[D-096]`, V1–V6) still binds every string.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.3 / [D-603] — the view states
 * no depth line" (rewritten for `ol-egov.141.89.6.129`): the four `copy.spec` scenarios.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as copy from '../../src/explain-back/copy.js';
import {
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_PASSAGES_HEADING,
  EXPLAIN_BACK_PRACTICE_NOTICE,
  EXPLAIN_BACK_SUBMIT_LABEL,
  explainBackReflectionPrompts,
  explainBackRelationReflectionPrompt,
} from '../../src/explain-back/copy.js';

/** Every exported string, and the reflection prompts for both shapes. */
const STATIC_STRINGS: readonly string[] = (Object.values(copy) as readonly unknown[]).filter(
  (value): value is string => typeof value === 'string',
);
const RELATION_SHAPE = {
  kind: 'relation',
  concept: 'Concept Alpha',
  neighbour: 'Concept Beta',
} as const;
const REFLECTION_PROMPTS = [
  ...explainBackReflectionPrompts({ kind: 'concept' }),
  ...explainBackReflectionPrompts(RELATION_SHAPE),
];
const ALL_STRINGS = [...STATIC_STRINGS, ...REFLECTION_PROMPTS];

/** The strings the practice view itself prints from §39. */
const PRACTICE_VIEW_STRINGS = [
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_PRACTICE_NOTICE,
  EXPLAIN_BACK_PASSAGES_HEADING,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_DISCARD_LABEL,
  ...REFLECTION_PROMPTS,
];

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const modalCode = stripComments(readFileSync(`${srcDir}explain-back/modal.ts`, 'utf8'));

describe("the practice view's words are registry §39's, exactly ([D-611])", () => {
  it('the submit control, the notice, the heading and the end controls', () => {
    expect(EXPLAIN_BACK_SUBMIT_LABEL).toBe('Show the passages');
    expect(EXPLAIN_BACK_PRACTICE_NOTICE).toBe('This is practice: nothing here is graded.');
    expect(EXPLAIN_BACK_PASSAGES_HEADING).toBe('From your notes');
    expect(EXPLAIN_BACK_DONE_LABEL).toBe('Done');
    expect(EXPLAIN_BACK_DISCARD_LABEL).toBe('Try again');
  });

  it('a concept prompt’s two reflection prompts', () => {
    expect(explainBackReflectionPrompts({ kind: 'concept' })).toEqual([
      'Read these alongside what you wrote.',
      'Is there anything here you would add, or put differently?',
    ]);
  });

  it('a relation prompt’s three, the third with both concepts named in place of the placeholders', () => {
    expect(explainBackReflectionPrompts(RELATION_SHAPE)).toEqual([
      'Read these alongside what you wrote.',
      'Is there anything here you would add, or put differently?',
      'What do these passages say links Concept Alpha and Concept Beta?',
    ]);
    expect(explainBackRelationReflectionPrompt('{concept}', '{neighbour}')).toBe(
      'What do these passages say links {concept} and {neighbour}?',
    );
  });

  it('the view renders these constants, never a re-typed copy of them', () => {
    for (const name of [
      'EXPLAIN_BACK_SUBMIT_LABEL',
      'EXPLAIN_BACK_PRACTICE_NOTICE',
      'EXPLAIN_BACK_PASSAGES_HEADING',
      'EXPLAIN_BACK_DONE_LABEL',
      'EXPLAIN_BACK_DISCARD_LABEL',
      'explainBackReflectionPrompts',
    ]) {
      expect(modalCode).toContain(name);
    }
    for (const text of PRACTICE_VIEW_STRINGS) expect(modalCode).not.toContain(`'${text}'`);
  });
});

describe('the retired words are gone (registry §39)', () => {
  it('no string the explain-back copy exports is "Check this" or "Checking against your notes…"', () => {
    for (const text of ALL_STRINGS) {
      expect(text).not.toBe('Check this');
      expect(text).not.toContain('Checking against your notes');
    }
  });

  it('the view prints neither, and draws no wait line after the submit control', () => {
    expect(modalCode).not.toContain('Check this');
    expect(modalCode).not.toContain('Checking against your notes');
    expect(modalCode).not.toMatch(/EXPLAIN_BACK_GRADING_LABEL/);
    // The one loading region left is the lookup's, before a question exists, and it has no words.
    expect(modalCode).toMatch(/root\.createDiv\(\{ cls: 'olea-explain-back-loading' \}\);/);
    expect(modalCode.match(/olea-explain-back-loading/g)).toHaveLength(1);
  });
});

describe('a reflection prompt is chosen by the prompt’s shape alone (F5.4)', () => {
  it('the copy function takes one argument, the shape', () => {
    expect(explainBackReflectionPrompts).toHaveLength(1);
  });

  it('the shape carries the kind and, for a relation, the two wordings, and nothing else', () => {
    const source = readFileSync(`${srcDir}explain-back/copy.ts`, 'utf8');
    const shapeType = source.slice(
      source.indexOf('export type ExplainBackReflectionShape'),
      source.indexOf('export const EXPLAIN_BACK_MODAL_TITLE'),
    );
    const fields = [...stripComments(shapeType).matchAll(/readonly (\w+)/g)].map((m) => m[1]);
    expect([...new Set(fields)].sort()).toEqual(['concept', 'kind', 'neighbour']);
  });

  it('the view chooses them from the prompt’s shape, never from her answer', () => {
    expect(modalCode).toMatch(/explainBackReflectionPrompts\(prompt\.shape\)/);
    expect(modalCode.match(/explainBackReflectionPrompts\(/g)).toHaveLength(1);
  });

  it('every explanation of one shape gets the same prompts', () => {
    expect(explainBackReflectionPrompts({ kind: 'concept' })).toEqual(
      explainBackReflectionPrompts({ kind: 'concept' }),
    );
    expect(explainBackReflectionPrompts(RELATION_SHAPE)).toEqual(
      explainBackReflectionPrompts({ ...RELATION_SHAPE }),
    );
  });
});

describe('no string the view prints is a depth line, a verdict or holds-up wording', () => {
  it('no function maps a depth level to a line: explainBackDepthHeading is gone', () => {
    expect(Object.keys(copy)).not.toContain('explainBackDepthHeading');
    expect(modalCode).not.toMatch(/explainBackDepthHeading|explainBackDepthPhrase/);
    const functions = Object.entries(copy)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(functions).toEqual([
      'explainBackReflectionPrompts',
      'explainBackRelationReflectionPrompt',
    ]);
  });

  it('never "holds up" / "hold up" (registry §9), and §39’s strings carry no correctness verdict word (V6)', () => {
    for (const text of ALL_STRINGS) {
      expect(text.toLowerCase()).not.toContain('holds up');
      expect(text.toLowerCase()).not.toContain('hold up');
    }
    for (const text of PRACTICE_VIEW_STRINGS) {
      for (const word of ['correct', 'partial', 'incorrect']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('none of §39’s strings states a verdict, uses a stage or vitality word, or forecasts (§9)', () => {
    const stageOrVitality =
      /\b(seed|sprout|sapling|tree|grove|wilt|wilting|faded|fading|holding|vital)\b/i;
    const verdictOrForecast = /\b(right|wrong|good|well|missed|ready|will|soon|likely|expect)\b/i;
    for (const text of PRACTICE_VIEW_STRINGS) {
      expect(text).not.toMatch(stageOrVitality);
      expect(text).not.toMatch(verdictOrForecast);
    }
  });
});

describe('[D-096] V1-V6 — the voice charter over the explain-back view’s strings', () => {
  it('V2 - names Olea, or names no actor at all, never "the system" or "I"', () => {
    for (const text of ALL_STRINGS) {
      expect(text).not.toMatch(/\bthe system\b/i);
      expect(text).not.toMatch(/\bI\b/);
      const oleaCount = (text.match(/\bOlea\b/g) ?? []).length;
      expect(oleaCount).toBeLessThanOrEqual(1);
    }
  });

  it('V4 - no apology anywhere in this set', () => {
    for (const text of ALL_STRINGS) {
      expect(text.toLowerCase()).not.toContain('sorry');
      expect(text.toLowerCase()).not.toMatch(/something went wrong/);
    }
  });

  it('V5 - no string in this set is a celebration', () => {
    for (const text of ALL_STRINGS) {
      expect(text).not.toMatch(/great|nice|well done|congrat/i);
    }
  });

  it('V6 - no effort/discipline language and no bare quotient anywhere in this set', () => {
    for (const text of ALL_STRINGS) {
      for (const word of ['effort', 'discipline', 'lazy', 'behind schedule']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
      expect(text).not.toMatch(/\d+%/);
    }
  });
});
